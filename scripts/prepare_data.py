"""Menyiapkan data & model untuk web app Detak.

    python scripts/prepare_data.py <folder_data>

<folder_data> berisi mitdb/ (24 rekaman MIT-BIH) dan nstdb/ (bw, em, ma),
sama seperti hasil kode/download_data.py di folder tugas.

Output ke public/data/:
  rec_<id>.bin     kode ADC asli 11-bit (Int16, little endian), kanal MLII, 10 menit pertama
  rec_<id>.json    metadata (fs, gain, baseline) + anotasi detak kardiolog
  noise_<n>.bin    noise nyata NSTDB (Int16 adu, gain 200/mV), 10 menit
  model.json       koefisien FIR + MLP kecil (8-16-1) untuk klasifikasi PVC di browser
  manifest.json    daftar rekaman

Fitur di sini dicerminkan 1:1 oleh src/dsp/features.ts, jadi model yang dilatih di Python
dijalankan dengan pipeline yang sama di browser.
"""
import json
import os
import sys

import numpy as np
import scipy.signal as ss
import wfdb
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, confusion_matrix

DATA = sys.argv[1] if len(sys.argv) > 1 else "data"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data")
os.makedirs(OUT, exist_ok=True)

FS = 360
RECS = ["100", "101", "103", "105", "106", "109", "118", "119", "200", "201", "203", "205",
        "207", "208", "209", "210", "213", "214", "215", "219", "221", "223", "228", "233"]
APP_RECS = {
    "100": ("Ritme sinus normal", "Rekaman paling bersih. Titik awal untuk melihat bentuk P-QRS-T."),
    "106": ("PVC sering", "Detak ventrikel prematur muncul di antara detak normal."),
    "119": ("Bigemini ventrikel", "Pola normal-PVC-normal-PVC: ritme berpasangan yang tegas."),
    "208": ("PVC + fusion", "Ratusan PVC dan detak fusion. Uji berat untuk klasifikasi."),
    "203": ("Multiform, bising", "PVC multiform, flutter atrium, dan noise. Rekaman tersulit di MIT-BIH."),
    "228": ("Artefak sensor", "Ada lonjakan artefak yang pernah menjatuhkan detektor versi pertama."),
}
SECONDS = 600
BEAT_SYMS = set("NLRBAaJSVrFejnE/fQ?")
AAMI = {**{s: "N" for s in "NLRej"}, **{s: "S" for s in "AaJS"}, **{s: "V" for s in "VE"}, "F": "F"}

# ---------- pipeline filter FIR (dicerminkan di src/dsp/features.ts) ----------
LP = ss.firwin(61, 40, fs=FS, window="hamming")


def moving_avg(x, w):
    """rata-rata bergerak terpusat, w ganjil; di tepi dibagi jumlah sampel yang tersedia"""
    h = w // 2
    c = np.concatenate([[0.0], np.cumsum(x)])
    n = len(x)
    i = np.arange(n)
    lo = np.maximum(0, i - h)
    hi = np.minimum(n, i + h + 1)
    return (c[hi] - c[lo]) / (hi - lo)


def conv_same(x, b):
    """konvolusi FIR simetris, tunda (N-1)/2 dikompensasi (fase nol)"""
    return np.convolve(x, b, mode="same")


def preprocess(x):
    base = moving_avg(moving_avg(x, 71), 215)   # MA 200 ms lalu 600 ms = estimasi baseline (FIR low-pass)
    return conv_same(x - base, LP)             # high-pass (x - baseline) lalu low-pass FIR 40 Hz


PRE, POST = 90, 162   # 0,25 s sebelum R dan 0,45 s sesudah R
QH = 36               # setengah jendela QRS, 100 ms
NFFT = 256


def hann(n):
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / (n - 1))


HANN = hann(PRE + POST)
FEATS = ["rr_pre/rr_lokal", "rr_post/rr_pre", "rr_pre/rr_rekaman", "amplitudo_R", "lebar_QRS_ms",
         "energi_QRS", "korelasi_template", "daya_15_40Hz", "daya_0_5Hz"]


def beat_features(xf, pos):
    """pos = posisi R (sampel). return (idx_beat_valid, X)"""
    rr = np.diff(pos) / FS
    rr_rec = np.median(rr)
    valid = [i for i in range(1, len(pos) - 1) if pos[i] - PRE >= 0 and pos[i] + POST <= len(xf)]
    segs = np.array([xf[pos[i] - PRE:pos[i] + POST] for i in valid])
    amps = np.abs(segs[:, PRE - 5:PRE + 5]).max(axis=1)
    amp_rec = np.median(amps)
    template = np.median(segs, axis=0)
    fr = np.arange(NFFT // 2 + 1) * FS / NFFT
    X = []
    for k, i in enumerate(valid):
        sgm = segs[k]
        rr_pre, rr_post = rr[i - 1], rr[i]
        loc = rr[max(0, i - 10):i].mean()
        base = np.median(sgm[:36])
        q = sgm[PRE - QH:PRE + QH]
        qa = np.abs(q - base)
        thr = 0.3 * qa.max()
        sp = np.abs(np.fft.rfft(sgm * HANN, NFFT)) ** 2
        tot = sp.sum() + 1e-12
        X.append([rr_pre / loc, rr_post / rr_pre, rr_pre / rr_rec,
                  qa.max() / amp_rec, (qa > thr).sum() / FS * 1000, np.sum((q - base) ** 2) / amp_rec ** 2,
                  np.corrcoef(sgm, template)[0, 1],
                  sp[(fr >= 15) & (fr < 40)].sum() / tot, sp[fr < 5].sum() / tot])
    return np.array(valid), np.array(X)


def load(r):
    rec = wfdb.rdrecord(f"{DATA}/mitdb/{r}", physical=False)
    ann = wfdb.rdann(f"{DATA}/mitdb/{r}", "atr")
    ch = rec.sig_name.index("MLII") if "MLII" in rec.sig_name else 0
    return rec, ch, ann


# ---------- dataset latih: 24 rekaman penuh ----------
Xs, ys, gs = [], [], []
for r in RECS:
    rec, ch, ann = load(r)
    adu = rec.d_signal[:, ch].astype(float)
    mv = (adu - rec.baseline[ch]) / rec.adc_gain[ch]
    xf = preprocess(mv)
    pos = np.array([s for s, sym in zip(ann.sample, ann.symbol) if sym in BEAT_SYMS])
    sy = [sym for sym in ann.symbol if sym in BEAT_SYMS]
    idx, X = beat_features(xf, pos)
    lab = [AAMI.get(sy[i]) for i in idx]
    keep = [k for k, l in enumerate(lab) if l is not None]
    Xs.append(X[keep]); ys += [1 if lab[k] == "V" else 0 for k in keep]; gs += [r] * len(keep)
    print(r, len(keep))
X = np.vstack(Xs); y = np.array(ys); g = np.array(gs)


def make():
    return MLPClassifier(hidden_layer_sizes=(16,), activation="relu", alpha=1e-3, max_iter=600,
                         random_state=7)


# validasi jujur: lintas pasien (GroupKFold per rekaman)
prob = np.zeros(len(y))
for tr, te in GroupKFold(n_splits=6).split(X, y, g):
    sc = StandardScaler().fit(X[tr])
    # seimbangkan kelas dengan oversampling PVC
    pos_i = np.where(y[tr] == 1)[0]; rep = max(1, int((y[tr] == 0).sum() / max(1, len(pos_i))) // 2)
    tri = np.concatenate([tr, np.repeat(tr[pos_i], rep)])
    m = make().fit(sc.transform(X[tri]), y[tri])
    prob[te] = m.predict_proba(sc.transform(X[te]))[:, 1]
pred = (prob >= 0.5).astype(int)
tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
cv = dict(auc=float(roc_auc_score(y, prob)), se=float(tp / (tp + fn)), ppv=float(tp / (tp + fp)),
          spec=float(tn / (tn + fp)), n=int(len(y)), n_V=int(y.sum()), cm=[[int(tn), int(fp)], [int(fn), int(tp)]])
print("lintas pasien", cv)

sc = StandardScaler().fit(X)
pos_i = np.where(y == 1)[0]; rep = max(1, int((y == 0).sum() / len(pos_i)) // 2)
alli = np.concatenate([np.arange(len(y)), np.repeat(pos_i, rep)])
m = make().fit(sc.transform(X[alli]), y[alli])
model = dict(features=FEATS, mean=sc.mean_.tolist(), scale=sc.scale_.tolist(),
             W1=m.coefs_[0].T.tolist(), b1=m.intercepts_[0].tolist(),
             W2=m.coefs_[1].T.tolist(), b2=m.intercepts_[1].tolist(),
             lp=LP.tolist(), cv=cv, arch="MLP 9-16-1 (ReLU, sigmoid)")
json.dump(model, open(f"{OUT}/model.json", "w"))

# referensi fitur untuk uji kesetaraan Python vs TypeScript (rekaman 119)
rec, ch, ann = load("119")
mv = (rec.d_signal[:SECONDS * FS, ch] - rec.baseline[ch]) / rec.adc_gain[ch]
pos = np.array([s for s, sym in zip(ann.sample, ann.symbol) if sym in BEAT_SYMS and s < SECONDS * FS])
idx, Xr = beat_features(preprocess(mv.astype(float)), pos)
json.dump(dict(pos=pos.tolist(), idx=idx.tolist(), X=Xr[:20].tolist(),
               p=m.predict_proba(sc.transform(Xr[:20]))[:, 1].tolist()),
          open(os.path.join(os.path.dirname(__file__), "feature_reference.json"), "w"))

# ---------- rekaman untuk app ----------
manifest = []
for r, (title, desc) in APP_RECS.items():
    rec, ch, ann = load(r)
    n = SECONDS * FS
    adu = rec.d_signal[:n, ch].astype(np.int16)
    adu.tofile(f"{OUT}/rec_{r}.bin")
    beats = [[int(s), sym] for s, sym in zip(ann.sample, ann.symbol) if s < n and sym in BEAT_SYMS]
    meta = dict(id=r, title=title, desc=desc, fs=FS, gain=float(rec.adc_gain[ch]), baseline=int(rec.baseline[ch]),
                bits=11, lead=rec.sig_name[ch], seconds=SECONDS, n=int(n), beats=beats,
                counts={k: sum(1 for b in beats if AAMI.get(b[1]) == k) for k in "NSVF"})
    json.dump(meta, open(f"{OUT}/rec_{r}.json", "w"))
    manifest.append(dict(id=r, title=title, desc=desc, counts=meta["counts"], beats=len(beats)))
    print("app", r, meta["counts"])

for nm in ["bw", "ma", "em"]:
    rec = wfdb.rdrecord(f"{DATA}/nstdb/{nm}", physical=False)
    rec.d_signal[:SECONDS * FS, 0].astype(np.int16).tofile(f"{OUT}/noise_{nm}.bin")

json.dump(dict(records=manifest, fs=FS, seconds=SECONDS), open(f"{OUT}/manifest.json", "w"))
print("selesai")
