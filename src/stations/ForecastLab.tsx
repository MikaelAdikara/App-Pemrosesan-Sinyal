import { useMemo, useState } from 'react'
import type { Analysis } from '../data'
import { fitAR, fmt, forecastAR, roots } from '../dsp/core'
import { FS } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Figure, Formula, Legend, Read, Slider, Toggle } from '../components/ui'

/** deret HR per detak; opsi "NN": interval yang menyentuh detak V diganti interpolasi linear */
export function hrSeries(a: Analysis, clean: boolean) {
  const b = a.beats
  const rr = b.slice(1).map((x, i) => ({ t: x.pos / FS, rr: (x.pos - b[i].pos) / FS, bad: x.label === 'V' || b[i].label === 'V' }))
  const v = rr.map((r) => r.rr)
  // aturan NN: interval yang menyimpang > 20% dari median lokal juga dianggap ektopik/artefak
  rr.forEach((r, i) => {
    const w = v.slice(Math.max(0, i - 4), i + 5).sort((p, q) => p - q); const m = w[w.length >> 1]
    if (Math.abs(r.rr - m) / m > 0.2) r.bad = true
  })
  if (clean) {
    for (let i = 0; i < v.length; i++) if (rr[i].bad) {
      let l = i - 1; while (l >= 0 && rr[l].bad) l--
      let r = i + 1; while (r < v.length && rr[r].bad) r++
      const lv = l >= 0 ? rr[l].rr : r < v.length ? rr[r].rr : v[i]
      const rv = r < v.length ? rr[r].rr : lv
      v[i] = lv + ((rv - lv) * (i - l)) / (r - l)
    }
  }
  return { t: rr.map((r) => r.t), hr: v.map((x) => 60 / x), bad: rr.map((r) => r.bad) }
}

export function ForecastLab({ a, focus }: { a: Analysis; focus: number }) {
  const [p, setP] = useState(6)
  const [train, setTrain] = useState(240)
  const [h, setH] = useState(40)
  const [clean, setClean] = useState(true)

  const s = useMemo(() => hrSeries(a, clean), [a, clean])
  const cutDefault = Math.max(train + 5, s.t.findIndex((t) => t >= focus + 60))
  const cut = Math.min(s.hr.length - h - 1, Math.max(train + p + 2, cutDefault < 0 ? s.hr.length - h - 1 : cutDefault))

  const r = useMemo(() => {
    const hist = s.hr.slice(cut - train, cut)
    const m = fitAR(hist, p)
    const f = forecastAR(hist, m, h)
    const act = s.hr.slice(cut, cut + h)
    const mape = (pred: number[]) => (100 * act.reduce((acc, v, i) => acc + Math.abs(v - pred[i]) / v, 0)) / act.length
    const last = hist[hist.length - 1]
    const poles = roots([1, ...m.coef.map((c) => -c)])
    return { m, f, act, mapeAR: mape(f.mean), mapeNaive: mape(act.map(() => last)), mapeMean: mape(act.map(() => m.mu)), poles }
  }, [s, cut, train, p, h])

  const x0 = Math.max(0, cut - 90), x1 = cut + h
  const idx = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i)
  const ys = s.hr.slice(x0, x1)
  const lo = Math.min(...ys, ...r.f.mean.map((v, i) => v - 1.96 * r.f.se[i])) - 3
  const hi = Math.max(...ys, ...r.f.mean.map((v, i) => v + 1.96 * r.f.se[i])) + 3
  const maxPole = Math.max(...r.poles.map((z) => Math.hypot(z[0], z[1])))
  const better = r.mapeAR < r.mapeNaive

  return (
    <Bench controls={<>
      <Slider label="Orde AR (p)" value={p} min={1} max={16} onChange={setP} fmt={(v) => `AR(${v})`} />
      <Slider label="Data latih" value={train} min={40} max={500} step={10} onChange={setTrain} fmt={(v) => `${v} detak terakhir`} />
      <Slider label="Horizon" value={h} min={5} max={120} step={5} onChange={setH} fmt={(v) => `${v} detak ke depan`} />
      <Toggle label="Bersihkan detak ektopik (deret NN)" checked={clean} onChange={setClean} hint="Interval yang menyentuh PVC atau menyimpang > 20% dari median lokal diganti interpolasi. Ini langkah data engineering sebelum model." />
      <Formula>HR[n] − μ = Σ<sub>k=1</sub><sup>p</sup> a<sub>k</sub>(HR[n−k] − μ) + e[n]<br />H(z) = 1 / (1 − Σ a<sub>k</sub>z<sup>−k</sup>)</Formula>
    </>}>
      <div className="reads">
        <Read value={fmt(r.mapeAR, 2) + '%'} label={`MAPE AR(${p})`} tone={better ? 'teal' : 'red'} />
        <Read value={fmt(r.mapeNaive, 2) + '%'} label="MAPE naive (nilai terakhir)" />
        <Read value={fmt(r.mapeMean, 2) + '%'} label="MAPE rata-rata latih" />
        <Read value={fmt(maxPole, 3)} label={maxPole < 1 ? '|pole| maks < 1: stabil' : '|pole| ≥ 1: tidak stabil'} tone={maxPole < 1 ? 'ink' : 'red'} />
      </div>
      <Figure title={`Forecast detak jantung ${h} detak ke depan dari detik ${fmt(s.t[cut], 0)}`}
        note={<Legend items={[{ color: C.ink, label: 'aktual' }, { color: C.cobalt, label: 'forecast AR' }, { color: 'rgba(43,63,217,.25)', label: 'interval 95%' }]} />}>
        <Plot ariaLabel="Forecast detak jantung dengan model AR" height={280} grid="plain" x={[x0, x1]} y={[lo, hi]} xLabel="indeks detak" xTicks="auto" xFmt={(v) => v.toFixed(0)} yFmt={(v) => v.toFixed(0)} yLabel="detak/menit"
          layers={[
            { kind: 'rect', x0: cut - train, x1: cut, color: 'rgba(15,127,120,.06)' },
            { kind: 'band', xs: idx(h, cut), lo: r.f.mean.map((v, i) => v - 1.96 * r.f.se[i]), hi: r.f.mean.map((v, i) => v + 1.96 * r.f.se[i]), color: 'rgba(43,63,217,.13)' },
            { kind: 'line', xs: idx(ys.length, x0), ys, color: C.ink, width: 1.4 },
            { kind: 'points', xs: idx(ys.length, x0).filter((i) => s.bad[i]), ys: idx(ys.length, x0).filter((i) => s.bad[i]).map((i) => s.hr[i]), color: C.red, r: 2.5 },
            { kind: 'line', xs: idx(h, cut), ys: r.f.mean, color: C.cobalt, width: 2.2 },
            { kind: 'vline', x: cut, color: C.ink2, dash: [4, 3], label: 'sekarang' },
          ]} />
      </Figure>
      <div className="duo">
        <Figure title="Pole model AR di bidang-z" note="makin dekat lingkaran satuan, makin panjang memori">
          <Plot ariaLabel="Pole model AR" square grid="plain" x={[-1.3, 1.3]} y={[-1.3, 1.3]} xTicks={[-1, 0, 1]} yTicks={[-1, 0, 1]} yFmt={(v) => v.toFixed(0)}
            layers={[
              { kind: 'circle', cx: 0, cy: 0, r: 1, color: C.ink3, dash: [3, 3] },
              { kind: 'points', xs: r.poles.map((z) => z[0]), ys: r.poles.map((z) => z[1]), marker: 'cross', color: C.red, r: 5 },
            ]} />
        </Figure>
        <Figure title="Koefisien a_k" note="bobot tiap lag">
          <Plot ariaLabel="Koefisien model AR" height={240} grid="plain" x={[0.5, p + 0.5]} y={[Math.min(0, ...r.m.coef) - 0.1, Math.max(...r.m.coef, 0.1) + 0.1]} xTicks={idx(p, 1)} xFmt={(v) => v.toFixed(0)} yFmt={(v) => fmt(v, 1)}
            layers={[{ kind: 'stem', x0: 1, dx: 1, ys: r.m.coef, color: C.cobalt, r: 3.5 }]} />
        </Figure>
      </div>
      <p className="lesson">Forecasting di sini adalah filter IIR yang dijalankan ke depan: setiap nilai baru dihitung dari nilai-nilai yang sudah digeser z<sup>−1</sup>…z<sup>−p</sup>. Interval prediksi melebar karena galat ikut terakumulasi. Matikan pembersihan ektopik dan lihat MAPE memburuk: kualitas data menentukan forecast lebih dari orde model.</p>
    </Bench>
  )
}
