import { useMemo, useState } from 'react'
import type { Analysis } from '../data'
import { yRange, autocorr, bestLag, corr, fmt } from '../dsp/core'
import { FS, PRE, POST } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Figure, Formula, Legend, Read, Slider } from '../components/ui'

function mulberry(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function ShiftLab({ a, focus }: { a: Analysis; focus: number }) {
  const [k, setK] = useState(90)
  const [jitter, setJitter] = useState(40)
  const [nAvg, setNAvg] = useState(30)

  const r = useMemo(() => {
    const n = 4 * FS; const start = Math.min(a.mv.length - n - 400, Math.floor(focus * FS) + 200)
    const x = a.xf.subarray(start, start + n)
    const shifted = new Float64Array(n)
    for (let i = 0; i < n; i++) { const j = i - k; shifted[i] = j >= 0 && j < n ? x[j] : a.xf[start + j] ?? 0 }
    const ac = autocorr(a.xf.subarray(start, start + 10 * FS), Math.round(2.5 * FS))
    let lag = 0
    for (let i = Math.round(0.3 * FS); i < ac.length - 1; i++) if (ac[i] > ac[i - 1] && ac[i] >= ac[i + 1] && ac[i] > 0.2) { lag = i; break }
    // Poincaré: RR[n] terhadap RR[n+1] (embedding dengan geseran satu detak)
    const rr = a.beats.slice(1).map((b, i) => ({ v: (b.pos - a.beats[i].pos) / FS, lab: b.label }))
    // detak dipotong dengan jitter acak, lalu disejajarkan ulang dengan korelasi silang ke template
    const rnd = mulberry(7)
    const nb = a.beats.filter((b) => b.label === 'N' && b.pos > PRE + 60 && b.pos + POST + 60 < a.xf.length).slice(0, nAvg)
    const W = PRE + POST
    const cut = nb.map((b) => { const d = Math.round((rnd() * 2 - 1) * (jitter / 1000) * FS); return { s: a.xf.slice(b.pos - PRE + d, b.pos - PRE + d + W), d } })
    const tmpl = a.table.template
    const aligned = cut.map(({ s }) => { const L = bestLag(tmpl, s, Math.round(0.08 * FS)); const o = new Float64Array(W); for (let i = 0; i < W; i++) o[i] = s[i + L] ?? 0; return o })
    const avg = (arr: Float64Array[]) => { const m = new Float64Array(W); arr.forEach((s) => s.forEach((v, i) => (m[i] += v / arr.length))); return m }
    const avgCut = avg(cut.map((c) => c.s)), avgAl = avg(aligned)
    return { x, shifted, ac, lag, rr, cut, aligned, avgCut, avgAl, c0: corr(tmpl, avgCut), c1: corr(tmpl, avgAl), sim: corr(x, shifted) }
  }, [a, focus, k, jitter, nAvg])

  const W = PRE + POST
  return (
    <Bench controls={<>
      <Slider label="Geseran k" value={k} min={-180} max={180} onChange={setK} fmt={(v) => `${v} sampel = ${fmt((v / FS) * 1000, 0)} ms`} hint="k > 0 menunda sinyal (ke kanan), k < 0 memajukan" />
      <Formula>y[n] = x[n − k] &nbsp;⟷&nbsp; Y(z) = z<sup>−k</sup>X(z)<br />|z<sup>−k</sup>| = 1, fase = −ωk</Formula>
      <Slider label="Jitter titik potong detak" value={jitter} min={0} max={80} onChange={setJitter} fmt={(v) => `±${v} ms`} />
      <Slider label="Detak dirata-ratakan" value={nAvg} min={5} max={120} onChange={setNAvg} fmt={(v) => `${v} detak`} hint={`noise turun ±√N = ${fmt(Math.sqrt(nAvg), 1)}× bila detak sejajar`} />
    </>}>
      <div className="reads">
        <Read value={fmt(r.sim, 2)} label="korelasi x[n] dan x[n−k]" tone={r.sim > 0.8 ? 'teal' : 'ink'} />
        <Read value={r.lag ? fmt((r.lag / FS) * 1000, 0) + ' ms' : '–'} label={r.lag ? `periode pola berulang (${fmt((60 * FS) / r.lag, 0)} siklus/menit)` : 'periode tidak tegas'} tone="cobalt" />
        <Read value={`${fmt(r.c0, 3)} → ${fmt(r.c1, 3)}`} label="kemiripan rata-rata dengan template" tone="teal" />
      </div>
      <Figure title="Operator tunda z⁻ᵏ" note={<Legend items={[{ color: C.ink3, label: 'x[n]' }, { color: C.cobalt, label: `x[n − ${k}]` }]} />}>
        <Plot ariaLabel="Sinyal asli dan sinyal tergeser" height={220} grid="paper" x={[0, 4]} y={yRange([r.x], 0.08)} xLabel="detik" xTicks="auto"
          layers={[
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.x, color: C.ink3, width: 1.2 },
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.shifted, color: C.cobalt, width: 1.7 },
          ]} />
      </Figure>
      <div className="trio">
        <Figure title="Autokorelasi R[ℓ]" note="puncak pertama = satu periode detak">
          <Plot ariaLabel="Autokorelasi sinyal ECG" height={190} grid="plain" x={[0, 2.5]} y={[-0.5, 1.05]} xLabel="lag (s)" xTicks="auto" yFmt={(v) => fmt(v, 1)}
            layers={[
              { kind: 'line', x0: 0, dx: 1 / FS, ys: r.ac, color: C.ink, width: 1.4 },
              ...(r.lag ? [{ kind: 'vline' as const, x: r.lag / FS, color: C.cobalt, dash: [4, 3], label: `ℓ = ${r.lag}` }] : []),
            ]} />
        </Figure>
        <Figure title="Plot Poincaré RR[n] vs RR[n+1]" note={<Legend items={[{ color: C.ink, label: 'N' }, { color: C.red, label: 'V' }]} />}>
          <Plot ariaLabel="Plot Poincaré interval RR" square grid="plain" x={[0.2, 1.8]} y={[0.2, 1.8]} xTicks={[0.5, 1, 1.5]} yTicks={[0.5, 1, 1.5]} yFmt={(v) => fmt(v, 1)} xLabel="RR[n] (s)"
            layers={[
              { kind: 'line', xs: [0.2, 1.8], ys: [0.2, 1.8], color: C.rule, width: 1 },
              { kind: 'points', xs: r.rr.slice(0, -1).map((q) => q.v), ys: r.rr.slice(1).map((q) => q.v), colors: r.rr.slice(1).map((q) => (q.lab === 'V' ? C.red : 'rgba(26,31,61,.45)')), r: 2 },
            ]} />
        </Figure>
        <Figure title="Rata-rata detak" note={<Legend items={[{ color: C.ink3, label: 'dipotong apa adanya' }, { color: C.cobalt, label: 'setelah disejajarkan' }]} />}>
          <Plot ariaLabel="Rata-rata detak sebelum dan sesudah penyelarasan" height={190} grid="paper" x={[-PRE / FS * 1000, POST / FS * 1000]} y={yRange([r.avgAl, r.avgCut], 0.15)} xLabel="ms dari R" xTicks="auto"
            layers={[
              ...r.aligned.slice(0, 20).map((s) => ({ kind: 'line' as const, x0: -PRE / FS * 1000, dx: 1000 / FS, ys: s, color: 'rgba(43,63,217,.12)', width: 1 })),
              { kind: 'line', x0: -PRE / FS * 1000, dx: 1000 / FS, ys: r.avgCut.subarray(0, W), color: C.ink3, width: 1.6 },
              { kind: 'line', x0: -PRE / FS * 1000, dx: 1000 / FS, ys: r.avgAl, color: C.cobalt, width: 2 },
            ]} />
        </Figure>
      </div>
      <p className="lesson">Geseran waktu adalah operasi paling dasar di deret waktu: fitur lag RR[n−1] untuk forecasting, plot Poincaré, dan penyelarasan detak dengan korelasi silang semuanya memakai z<sup>−k</sup>. Pada bigemini (rekaman 119) titik Poincaré membentuk dua gugus terpisah: pola ritme terlihat tanpa model apa pun.</p>
    </Bench>
  )
}
