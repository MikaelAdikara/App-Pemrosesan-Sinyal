import { useMemo, useState } from 'react'
import type { Analysis } from '../data'
import { yRange, entropy, filterSame, firDesign, fmt, maxAbs, quantMuLaw, quantUniform, spectrum, sqnr } from '../dsp/core'
import { FS } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Choice, Figure, Formula, Legend, Read, Slider, Toggle } from '../components/ui'

const FS_OPTIONS = [360, 180, 120, 90, 60, 45, 30]

export function AdcLab({ a, focus }: { a: Analysis; focus: number }) {
  const [fs, setFs] = useState(90)
  const [bits, setBits] = useState(6)
  const [range, setRange] = useState(5)
  const [aa, setAa] = useState(false)
  const [mu, setMu] = useState(false)
  const [hum, setHum] = useState(0.12)

  const r = useMemo(() => {
    const n = 10 * FS
    const start = Math.min(a.mv.length - n, Math.floor(focus * FS))
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = a.xf[start + i] + hum * Math.sin((2 * Math.PI * 60 * (start + i)) / FS)
    const k = FS / fs
    const src = aa && k > 1 ? filterSame(x, firDesign('lowpass', 121, FS, 0.45 * fs, 0, 'hamming')) : x
    const xs = new Float64Array(Math.floor(n / k))
    for (let i = 0; i < xs.length; i++) xs[i] = src[i * k]
    const Q = mu ? quantMuLaw(xs, bits, range) : quantUniform(xs, bits, range)
    const err = xs.map((v, i) => v - Q.q[i])
    // R-peak yang tersisa: rata-rata rasio puncak sampel/puncak analog di sekitar tiap detak
    const peaks = a.beats.map((b) => b.pos - start).filter((p) => p > 20 && p < n - 20)
    const ratios = peaks.map((p) => {
      const lo = Math.floor((p - 18) / k), hi = Math.ceil((p + 18) / k)
      return maxAbs(Q.q.subarray(Math.max(0, lo), Math.min(xs.length, hi))) / maxAbs(x.subarray(p - 18, p + 18))
    })
    const ret = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : NaN
    const dcode = Int32Array.from(Q.code, (c, i) => (i ? c - Q.code[i - 1] : c))
    const hPcm = entropy(Q.code), hDpcm = entropy(dcode.subarray(1))
    const spec = spectrum(xs, fs, 'hann', 4096)
    const alias = Math.abs(60 - Math.round(60 / fs) * fs)
    return { x, xs, q: Q.q, delta: Q.delta, err, sq: sqnr(xs, Q.q), ret, hPcm, hDpcm, spec, alias, k }
  }, [a, focus, fs, bits, range, aa, mu, hum])

  const zoomS = 2.4
  const nz = Math.floor(zoomS * FS)
  const nzs = Math.floor(nz / r.k)
  const bps = fs * bits
  const mbDay = (bps * 86400) / 8 / 1e6
  const clipped = maxAbs(r.x) > range

  return (
    <Bench controls={<>
      <Choice label="Laju sampling fs (Hz)" value={fs} onChange={setFs} options={FS_OPTIONS.map((v) => ({ value: v, label: String(v) }))} />
      <Slider label="Resolusi" value={bits} min={2} max={12} onChange={setBits} fmt={(v) => `${v} bit, ${2 ** v} level`} />
      <Choice label="Rentang input ADC" value={range} onChange={setRange} options={[{ value: 5, label: '±5 mV' }, { value: 2.5, label: '±2,5' }, { value: 1, label: '±1' }]} />
      <Slider label="Interferensi jala-jala 60 Hz" value={hum} min={0} max={0.3} step={0.01} onChange={setHum} fmt={(v) => fmt(v, 2) + ' mV'} />
      <Toggle label="Filter anti-aliasing sebelum sampling" checked={aa} onChange={setAa} hint="Low-pass FIR 121 tap, potong di 0,45·fs" />
      <Toggle label="Kuantisasi μ-law (non-uniform)" checked={mu} onChange={setMu} hint="Level rapat di amplitudo kecil, renggang di puncak R" />
      <Formula>x[n] = x(nT<sub>s</sub>), T<sub>s</sub> = 1/f<sub>s</sub><br />Δ = 2R / 2<sup>b</sup> = {fmt(r.delta * 1000, 1)} µV</Formula>
    </>}>
      <div className="reads">
        <Read value={fmt(r.sq, 1) + ' dB'} label="SQNR" tone={r.sq > 30 ? 'teal' : r.sq < 10 ? 'red' : 'ink'} />
        <Read value={fmt(r.ret * 100, 0) + '%'} label="amplitudo R tersisa" tone={r.ret < 0.8 ? 'red' : 'ink'} />
        <Read value={fs > 120 ? 'tidak ada' : fmt(r.alias, 0) + ' Hz'} label={fs > 120 ? '60 Hz di bawah Nyquist' : `60 Hz terlipat (Nyquist ${fs / 2} Hz)`} tone={fs <= 120 && !aa ? 'red' : 'ink'} />
        <Read value={fmt(mbDay, 1) + ' MB'} label={`per hari (${bps.toLocaleString('id-ID')} bit/s)`} />
      </div>
      {clipped && <p className="warn">Sinyal melewati rentang ±{fmt(range, 1)} mV: puncak terpotong (clipping), informasi hilang permanen.</p>}
      <Figure title={`Sampling & hold pada ${fs} Hz, ${bits} bit`} note={<Legend items={[{ color: C.ink3, label: 'analog (referensi 360 Hz)' }, { color: C.cobalt, label: 'sampel x[n]' }, { color: C.red, label: 'ZOH terkuantisasi' }]} />}>
        <Plot ariaLabel="Perbandingan sinyal analog, sampel, dan hasil kuantisasi" height={260} grid="paper"
          x={[0, zoomS]} y={yRange([r.x.subarray(0, nz)], 0.08)} xLabel="detik" xTicks="auto" yFmt={(v) => fmt(v, 1)} yLabel="mV"
          layers={[
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.x.subarray(0, nz), color: C.ink3, width: 1.2 },
            { kind: 'step', x0: 0, dx: 1 / fs, ys: r.q.subarray(0, nzs), color: C.red, width: 1.6 },
            ...(fs <= 120 ? [{ kind: 'stem' as const, x0: 0, dx: 1 / fs, ys: r.xs.subarray(0, nzs), color: C.cobalt, r: 2.2 }] : []),
          ]} />
      </Figure>
      <div className="duo">
        <Figure title="Galat kuantisasi e[n] = x[n] − Q(x[n])" note={`batas ±Δ/2 = ±${fmt(r.delta * 500, 1)} µV`}>
          <Plot ariaLabel="Galat kuantisasi" height={170} grid="plain" x={[0, zoomS]} y={[-r.delta * 0.75, r.delta * 0.75]} xLabel="detik" xTicks="auto"
            yFmt={(v) => fmt(v * 1000, 0)} yLabel="µV"
            layers={[
              { kind: 'hline', y: r.delta / 2, color: C.red, dash: [3, 3] }, { kind: 'hline', y: -r.delta / 2, color: C.red, dash: [3, 3] },
              { kind: 'step', x0: 0, dx: 1 / fs, ys: r.err.subarray(0, nzs), color: C.ink, width: 1 },
            ]} />
        </Figure>
        <Figure title={`Spektrum setelah sampling (0 – ${fs / 2} Hz)`} note="garis putus: letak 60 Hz yang terlipat">
          <Plot ariaLabel="Spektrum sinyal tersampel" height={170} grid="plain" x={[0, fs / 2]} y={[-80, 0]} xLabel="Hz" xTicks="auto" yFmt={(v) => v.toFixed(0)} yLabel="dB"
            layers={[
              { kind: 'line', xs: r.spec.freq, ys: r.spec.mag.map((m) => 20 * Math.log10(m / 1 + 1e-9)), color: C.ink, width: 1.2 },
              ...(fs <= 120 ? [{ kind: 'vline' as const, x: r.alias, color: C.red, dash: [4, 3], label: fs === 120 ? '60 Hz = Nyquist' : `alias ${r.alias} Hz` }] : []),
            ]} />
        </Figure>
      </div>
      <div className="encode">
        <div>
          <h4>Encoding</h4>
          <p>PCM menyimpan setiap kode utuh: <b>{bits} bit/sampel</b>. DPCM menyimpan selisih kode berurutan d[n] = c[n] − c[n−1]. Entropi selisihnya hanya <b>{fmt(r.hDpcm, 2)} bit</b> (kode mentah {fmt(r.hPcm, 2)} bit), jadi kompresi lossless bisa sampai <b>{fmt(bits / Math.max(0.5, r.hDpcm), 1)}×</b>.</p>
        </div>
        <div className="bitbar" aria-hidden>
          <span style={{ width: '100%' }}>PCM {bits} bit</span>
          <span className="d" style={{ width: Math.min(100, (r.hDpcm / bits) * 100) + '%' }}>DPCM {fmt(r.hDpcm, 1)}</span>
        </div>
      </div>
    </Bench>
  )
}
