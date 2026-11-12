import { useMemo, useState } from 'react'
import type { Analysis } from '../data'
import { yRange, fft, fmt, nextPow2, spectrum, stft, WINDOW_LABEL, type WindowName } from '../dsp/core'
import { FS } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Choice, Figure, Formula, Legend, Read, Slider, Toggle } from '../components/ui'

export function FourierLab({ a, focus }: { a: Analysis; focus: number }) {
  const [seconds, setSeconds] = useState(10)
  const [win, setWin] = useState<WindowName>('hann')
  const [raw, setRaw] = useState(true)
  const [keep, setKeep] = useState(40)
  const [fmax, setFmax] = useState(60)

  const r = useMemo(() => {
    const n = Math.floor(seconds * FS); const start = Math.max(0, Math.min(a.mv.length - n, Math.floor(focus * FS)))
    const src = raw ? a.mv : a.xf
    const x = src.slice(start, start + n)
    const sp = spectrum(x, FS, win)
    const mags = sp.mag.map((m) => 20 * Math.log10(m + 1e-9))
    // puncak fundamental ritme jantung di 0,6–3 Hz
    let kHr = 0
    for (let k = 1; k < sp.freq.length; k++) if (sp.freq[k] > 0.6 && sp.freq[k] < 3 && sp.mag[k] > sp.mag[kHr]) kHr = k
    // sintesis Fourier: simpan K koefisien terbesar dari FFT 2 detik
    const m = nextPow2(2 * FS); const re = new Float64Array(m), im = new Float64Array(m)
    const s2 = a.xf.subarray(start, start + m)
    re.set(s2)
    fft(re, im)
    const order = Array.from({ length: m / 2 + 1 }, (_, k) => k).sort((p, q) => Math.hypot(re[q], im[q]) - Math.hypot(re[p], im[p]))
    const keepSet = new Set(order.slice(0, keep))
    const r2 = new Float64Array(m), i2 = new Float64Array(m)
    for (let k = 0; k <= m / 2; k++) if (keepSet.has(k)) { r2[k] = re[k]; i2[k] = im[k]; if (k && k < m / 2) { r2[m - k] = re[k]; i2[m - k] = -im[k] } }
    fft(r2, i2, true)
    let e = 0, p = 0; for (let i = 0; i < m; i++) { e += (s2[i] - r2[i]) ** 2; p += s2[i] ** 2 }
    // spektrogram 60 detik
    const n60 = 60 * FS; const s60 = Math.max(0, Math.min(a.mv.length - n60, start))
    const sg = stft(a.xf.subarray(s60, s60 + n60), FS, 2 * FS, Math.round(0.25 * FS), 'hann', 40)
    let sgMax = -Infinity; sg.frames.forEach((f) => f.forEach((v) => { if (v > sgMax) sgMax = v }))
    return { x, sp, mags, kHr, recon: r2, orig: s2, energyKept: 1 - e / p, m, sg, s60, sgMax }
  }, [a, focus, seconds, win, raw, keep])

  const hr = r.sp.freq[r.kHr]
  return (
    <Bench controls={<>
      <Slider label="Panjang segmen" value={seconds} min={2} max={60} onChange={setSeconds} fmt={(v) => `${v} s`} hint={`N = ${(seconds * FS).toLocaleString('id-ID')} sampel → Δf = fs/N = ${fmt(1 / seconds, 3)} Hz`} />
      <Choice label="Jendela" value={win} onChange={setWin} options={(Object.keys(WINDOW_LABEL) as WindowName[]).map((v) => ({ value: v, label: WINDOW_LABEL[v] }))} />
      <Toggle label="Sinyal mentah (sebelum filter)" checked={raw} onChange={setRaw} hint="Matikan untuk melihat spektrum setelah preprocessing FIR" />
      <Choice label="Tampilkan sampai" value={fmax} onChange={setFmax} options={[{ value: 10, label: '10 Hz' }, { value: 60, label: '60 Hz' }, { value: 180, label: '180 Hz' }]} />
      <Slider label="Komponen yang disimpan" value={keep} min={1} max={200} onChange={setKeep} fmt={(v) => `${v} dari ${r.m / 2 + 1}`} />
      <Formula>X[k] = Σ<sub>n=0</sub><sup>N−1</sup> x[n]·e<sup>−j2πkn/N</sup><br />f<sub>k</sub> = k·f<sub>s</sub>/N</Formula>
    </>}>
      <div className="reads">
        <Read value={fmt(hr, 2) + ' Hz'} label={`puncak ritme = ${fmt(hr * 60, 0)} detak/menit`} tone="cobalt" />
        <Read value={fmt(r.sp.df, 3) + ' Hz'} label={`resolusi bin (FFT ${r.sp.n.toLocaleString('id-ID')} titik)`} />
        <Read value={fmt(r.energyKept * 100, 1) + '%'} label={`energi kembali dari ${keep} komponen`} tone="teal" />
      </div>
      <Figure title="Spektrum magnitudo |X(f)|" note="harmonik ritme jantung terlihat sebagai sisir di frekuensi rendah">
        <Plot ariaLabel="Spektrum magnitudo ECG" height={240} grid="plain" x={[0, fmax]} y={[-90, 0]} xLabel="Hz" xTicks="auto" yFmt={(v) => v.toFixed(0)} yLabel="dB"
          layers={[
            { kind: 'line', xs: r.sp.freq, ys: r.mags, color: C.ink, width: 1.2 },
            { kind: 'points', xs: [hr], ys: [r.mags[r.kHr]], color: C.cobalt, r: 4 },
            ...[2, 3, 4, 5].map((k) => ({ kind: 'vline' as const, x: hr * k, color: 'rgba(43,63,217,.35)', dash: [2, 4] })),
            ...(fmax >= 60 ? [{ kind: 'vline' as const, x: 60, color: C.red, dash: [4, 3], label: '60 Hz' }] : []),
          ]} />
      </Figure>
      <div className="duo">
        <Figure title={`Sintesis ulang dari ${keep} sinusoid`} note={<Legend items={[{ color: C.ink3, label: 'asli' }, { color: C.cobalt, label: 'IFFT terpotong' }]} />}>
          <Plot ariaLabel="Rekonstruksi sinyal dari komponen Fourier terbesar" height={200} grid="paper" x={[0, r.m / FS]} y={yRange([r.orig], 0.1)} xLabel="detik" xTicks="auto"
            layers={[
              { kind: 'line', x0: 0, dx: 1 / FS, ys: r.orig, color: C.ink3, width: 1.1 },
              { kind: 'line', x0: 0, dx: 1 / FS, ys: r.recon, color: C.cobalt, width: 1.7 },
            ]} />
        </Figure>
        <Figure title="Spektrogram 60 detik (STFT, jendela 2 s)" note="sumbu tegak 0–40 Hz">
          <Plot ariaLabel="Spektrogram STFT ECG" height={200} grid="none" x={[r.s60 / FS, r.s60 / FS + 60]} y={[0, 40]} xLabel="detik" xTicks="auto" yTicks={[0, 10, 20, 30, 40]} yFmt={(v) => v.toFixed(0)}
            layers={[{ kind: 'heat', frames: r.sg.frames, x0: r.s60 / FS + r.sg.times[0], x1: r.s60 / FS + r.sg.times[r.sg.times.length - 1], y0: 0, y1: r.sg.kmax * r.sg.df, vmin: r.sgMax - 42, vmax: r.sgMax }]} />
        </Figure>
      </div>
      <p className="lesson">Ritme yang teratur menghasilkan <b>sisir harmonik</b> di kelipatan {fmt(hr, 2)} Hz. Pada rekaman dengan PVC, sisir ini melebar karena jarak antar-detak tidak lagi tetap. Energi QRS ada di 5–15 Hz, dan inilah alasan detektor Pan-Tompkins memakai band-pass di pita itu.</p>
    </Bench>
  )
}
