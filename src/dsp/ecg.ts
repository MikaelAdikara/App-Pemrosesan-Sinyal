// Pipeline ECG: preprocessing FIR, detektor Pan-Tompkins, fitur per detak, dan MLP kecil.
// Fitur & preprocessing mencerminkan scripts/prepare_data.py baris per baris.
import { corr, filterSame, firDesign, fft, maxAbs, median, movingAvg, sum } from './core'

export const FS = 360

export interface Model {
  features: string[]; mean: number[]; scale: number[]
  W1: number[][]; b1: number[]; W2: number[][]; b2: number[]
  lp: number[]; arch: string
  cv: { auc: number; se: number; ppv: number; spec: number; n: number; n_V: number; cm: number[][] }
}

/** baseline = MA 200 ms -> MA 600 ms; high-pass = x - baseline; lalu low-pass FIR 40 Hz */
export function preprocess(x: Float64Array, lp: number[]) {
  const base = movingAvg(movingAvg(x, 71), 215)
  const hp = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) hp[i] = x[i] - base[i]
  return filterSame(hp, lp)
}

function findPeaks(x: Float64Array, distance: number) {
  const cand: number[] = []
  for (let i = 1; i < x.length - 1; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1]) cand.push(i)
  const order = cand.slice().sort((a, b) => x[b] - x[a])
  const keep = new Uint8Array(x.length); const taken: number[] = []
  const blocked = new Uint8Array(x.length)
  for (const p of order) {
    if (blocked[p]) continue
    keep[p] = 1; taken.push(p)
    for (let j = Math.max(0, p - distance + 1); j < Math.min(x.length, p + distance); j++) blocked[j] = 1
  }
  return taken.sort((a, b) => a - b)
}

export interface PTStages { band: Float64Array; deriv: Float64Array; sq: Float64Array; mwi: Float64Array; thr: Float64Array; peaks: number[] }

const BP_5_15 = firDesign('bandpass', 73, FS, 5, 15, 'hamming')

/** Pan-Tompkins (1985) versi robust: bandpass -> derivatif -> kuadrat -> MWI -> threshold adaptif + search-back */
export function panTompkins(x: Float64Array, fs = FS): PTStages {
  const band = filterSame(x, BP_5_15)
  const deriv = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) deriv[i] = ((band[Math.min(x.length - 1, i + 1)] - band[Math.max(0, i - 1)]) / 2) * fs
  const sq = deriv.map((v) => v * v)
  const mwi = movingAvg(sq, Math.round(0.15 * fs) | 1)
  const pk = findPeaks(mwi, Math.round(0.2 * fs))
  const thrTrace = new Float64Array(x.length)
  const h0 = pk.filter((p) => p < 10 * fs).map((p) => mwi[p]).sort((a, b) => a - b)
  let spki = median(h0.slice(-8)); let npki = 0.5 * median(h0)
  let th = npki + 0.25 * (spki - npki)
  const acc: number[] = []; const rr: number[] = []
  let last = 0
  for (const p of pk) {
    thrTrace.fill(th, last, p); last = p
    const v = Math.min(mwi[p], 3 * spki)
    if (mwi[p] > th) {
      if (acc.length && rr.length) {
        const rrAvg = sum(rr.slice(-8)) / Math.min(8, rr.length)
        if (p - acc[acc.length - 1] > 1.66 * rrAvg) {
          const cand = pk.filter((q) => q > acc[acc.length - 1] + 0.2 * fs && q < p - 0.2 * fs && mwi[q] > th / 2)
          if (cand.length) {
            const q = cand.reduce((a, b) => (mwi[b] > mwi[a] ? b : a))
            rr.push(q - acc[acc.length - 1]); acc.push(q)
            spki = 0.25 * Math.min(mwi[q], 3 * spki) + 0.75 * spki
          }
        }
      }
      if (acc.length) rr.push(p - acc[acc.length - 1])
      acc.push(p); spki = 0.125 * v + 0.875 * spki
    } else npki = 0.125 * v + 0.875 * npki
    th = npki + 0.25 * (spki - npki)
  }
  thrTrace.fill(th, last)
  const hw = Math.round(0.075 * fs); const out = new Set<number>()
  for (const p of acc) {
    let best = p, bv = -1
    for (let j = Math.max(0, p - hw); j < Math.min(x.length, p + hw); j++) if (Math.abs(band[j]) > bv) { bv = Math.abs(band[j]); best = j }
    out.add(best)
  }
  return { band, deriv, sq, mwi, thr: thrTrace, peaks: [...out].sort((a, b) => a - b) }
}

/** cocokkan deteksi ke anotasi (toleransi sampel). return TP/FP/FN dan pasangan */
export function matchBeats(det: number[], ref: number[], tol: number) {
  const used = new Uint8Array(det.length); let tp = 0; let j0 = 0
  const pair = new Map<number, number>()   // idx det -> idx ref
  ref.forEach((r, ri) => {
    while (j0 < det.length && det[j0] < r - tol) j0++
    let best = -1, bd = tol + 1
    for (let j = j0; j < det.length && det[j] <= r + tol; j++) if (!used[j] && Math.abs(det[j] - r) < bd) { best = j; bd = Math.abs(det[j] - r) }
    if (best >= 0) { used[best] = 1; tp++; pair.set(best, ri) }
  })
  return { tp, fp: det.length - tp, fn: ref.length - tp, pair }
}

// ---------------------------------------------------------------- fitur per detak
export const PRE = 90, POST = 162, QH = 36, NFFT = 256
const HANN = Float64Array.from({ length: PRE + POST }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (PRE + POST - 1)))

export interface BeatTable { idx: number[]; X: number[][]; segs: Float64Array[]; template: Float64Array }

export function beatFeatures(xf: Float64Array, pos: number[], fs = FS): BeatTable {
  const rr: number[] = []
  for (let i = 1; i < pos.length; i++) rr.push((pos[i] - pos[i - 1]) / fs)
  const rrRec = median(rr)
  const idx: number[] = []
  for (let i = 1; i < pos.length - 1; i++) if (pos[i] - PRE >= 0 && pos[i] + POST <= xf.length) idx.push(i)
  const segs = idx.map((i) => xf.slice(pos[i] - PRE, pos[i] + POST))
  const ampRec = median(segs.map((s) => maxAbs(s.subarray(PRE - 5, PRE + 5))))
  const template = new Float64Array(PRE + POST)
  const col = new Float64Array(segs.length)
  for (let t = 0; t < PRE + POST; t++) { for (let k = 0; k < segs.length; k++) col[k] = segs[k][t]; template[t] = median(col) }
  const X = idx.map((i, k) => {
    const s = segs[k]
    const rrPre = rr[i - 1], rrPost = rr[i]
    const loc = rr.slice(Math.max(0, i - 10), i); const locM = sum(loc) / loc.length
    const base = median(s.subarray(0, 36))
    const q = s.subarray(PRE - QH, PRE + QH)
    let qmax = 0, energy = 0
    for (let j = 0; j < q.length; j++) { const a = Math.abs(q[j] - base); qmax = Math.max(qmax, a); energy += (q[j] - base) ** 2 }
    let width = 0; for (let j = 0; j < q.length; j++) if (Math.abs(q[j] - base) > 0.3 * qmax) width++
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT)
    for (let j = 0; j < s.length; j++) re[j] = s[j] * HANN[j]
    fft(re, im)
    let tot = 0, p1540 = 0, p05 = 0
    for (let b = 0; b <= NFFT / 2; b++) {
      const p = re[b] * re[b] + im[b] * im[b]; const f = (b * fs) / NFFT
      tot += p; if (f >= 15 && f < 40) p1540 += p; if (f < 5) p05 += p
    }
    tot += 1e-12
    return [rrPre / locM, rrPost / rrPre, rrPre / rrRec, qmax / ampRec, (width / fs) * 1000, energy / ampRec ** 2,
      corr(s, template), p1540 / tot, p05 / tot]
  })
  return { idx, X, segs, template }
}

export function mlpPredict(m: Model, x: number[]) {
  const z = x.map((v, i) => (v - m.mean[i]) / m.scale[i])
  const h = m.W1.map((row, j) => Math.max(0, row.reduce((s, w, i) => s + w * z[i], m.b1[j])))
  const o = m.W2[0].reduce((s, w, j) => s + w * h[j], m.b2[0])
  return 1 / (1 + Math.exp(-o))
}

export const nParams = (m: Model) => m.W1.length * m.W1[0].length + m.b1.length + m.W2[0].length + m.b2.length

export const AAMI: Record<string, 'N' | 'S' | 'V' | 'F' | 'Q'> = {
  N: 'N', L: 'N', R: 'N', e: 'N', j: 'N', A: 'S', a: 'S', J: 'S', S: 'S', V: 'V', E: 'V', F: 'F',
}
export const aami = (sym: string) => AAMI[sym] ?? 'Q'
