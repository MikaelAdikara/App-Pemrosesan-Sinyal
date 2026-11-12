import { useEffect, useMemo, useState } from 'react'
import { loadModel, type Analysis } from '../data'
import { fmt, maxAbs, yRange } from '../dsp/core'
import { FS, nParams, PRE, POST, type Model } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Figure, Legend, Read, Slider } from '../components/ui'

const STAGES = [
  { key: 'band', title: 'Band-pass FIR 5–15 Hz', z: 'fokus ke energi QRS' },
  { key: 'deriv', title: 'Derivatif', z: 'H(z) = (1 − z⁻²)/2T' },
  { key: 'sq', title: 'Kuadrat', z: 'y = x², semua jadi positif' },
  { key: 'mwi', title: 'Integrator jendela 150 ms', z: 'H(z) = 1/54 Σ z⁻ᵏ' },
] as const

const FEAT_LABEL = ['RR sebelum / RR lokal', 'RR sesudah / RR sebelum', 'RR sebelum / median rekaman', 'Amplitudo R (relatif)', 'Lebar QRS (ms)', 'Energi QRS (relatif)', 'Korelasi dengan template', 'Daya 15–40 Hz', 'Daya 0–5 Hz']

export function DetectLab({ a, focus }: { a: Analysis; focus: number }) {
  const [model, setModel] = useState<Model | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const [thr, setThr] = useState(0.5)
  useEffect(() => { loadModel().then(setModel) }, [])

  const show = 6
  const start = Math.min(a.mv.length - show * FS, Math.floor(focus * FS))
  const inWin = a.beats.map((b, i) => ({ b, i })).filter(({ b }) => b.pos >= start && b.pos < start + show * FS)
  const sel = pick !== null && a.beats[pick] ? pick : (inWin.find(({ b }) => b.label === 'V' && b.pos - PRE > start) ?? inWin[1] ?? inWin[0])?.i ?? 0
  const beat = a.beats[sel]

  const cm = useMemo(() => {
    let tn = 0, fp = 0, fn = 0, tp = 0
    for (const b of a.beats) {
      if (!b.truth || b.truth === 'Q' || !b.x) continue
      const y = b.truth === 'V', p = b.prob >= thr
      if (y && p) tp++; else if (y) fn++; else if (p) fp++; else tn++
    }
    return { tn, fp, fn, tp }
  }, [a, thr])

  const detSe = a.det.tp / (a.det.tp + a.det.fn), detPpv = a.det.tp / (a.det.tp + a.det.fp)
  const vSe = cm.tp / Math.max(1, cm.tp + cm.fn), vPpv = cm.tp / Math.max(1, cm.tp + cm.fp)
  const ann = a.meta.beats.filter((b) => b[0] >= start && b[0] < start + show * FS)

  const yr = yRange([a.xf.subarray(start, start + show * FS)], 0.05)
  const dy: [number, number] = [yr[0] - 0.45, yr[1] + 0.5]

  const stageLayers = (key: typeof STAGES[number]['key']) => {
    const s = a.pt[key].subarray(start, start + show * FS)
    const m = maxAbs(s) || 1
    const ys = s.map((v) => v / m)
    return { ys, m }
  }

  return (
    <Bench controls={<>
      <div className="model-card">
        <h4>Model di browser</h4>
        <p>{model ? `${model.arch}, ${nParams(model)} parameter` : 'memuat…'}. Dilatih di Python pada 59.419 detak dari 24 pasien, lalu dijalankan di sini tanpa server.</p>
        {model && <dl>
          <div><dt>AUC lintas pasien</dt><dd>{fmt(model.cv.auc, 3)}</dd></div>
          <div><dt>Sensitivitas PVC</dt><dd>{fmt(model.cv.se * 100, 1)}%</dd></div>
          <div><dt>Waktu inferensi</dt><dd>{fmt(a.inferMs * 1000, 0)} µs/detak</dd></div>
        </dl>}
      </div>
      <Slider label="Ambang probabilitas PVC" value={thr} min={0.05} max={0.95} step={0.05} onChange={setThr} fmt={(v) => fmt(v, 2)} hint="Turunkan untuk menangkap lebih banyak PVC dengan risiko alarm palsu" />
      <p className="ctl-hint">Klik trace untuk memilih detak dan melihat fiturnya.</p>
    </>}>
      <div className="reads">
        <Read value={fmt(detSe * 100, 2) + '%'} label={`sensitivitas deteksi (${a.det.tp} dari ${a.det.tp + a.det.fn} detak)`} tone="teal" />
        <Read value={fmt(detPpv * 100, 2) + '%'} label="positive predictive value" />
        <Read value={cm.tp + cm.fn ? fmt(vSe * 100, 1) + '%' : '–'} label={`PVC tertangkap di rekaman ${a.meta.id}`} tone="red" />
        <Read value={cm.tp + cm.fp ? fmt(vPpv * 100, 1) + '%' : '–'} label="PPV PVC" />
      </div>
      <Figure title="Detak terdeteksi vs anotasi kardiolog" note={<Legend items={[{ color: C.cobalt, label: 'deteksi' }, { color: C.red, label: 'prediksi PVC' }, { color: C.ink3, label: 'anotasi MIT-BIH (huruf)' }]} />}>
        <Plot ariaLabel="Sinyal ECG dengan hasil deteksi dan label" height={230} grid="paper" x={[start / FS, start / FS + show]} y={dy} xLabel="detik" xTicks="auto"
          onClickX={(t) => {
            let best = sel, bd = Infinity
            inWin.forEach(({ b, i }) => { const d = Math.abs(b.pos / FS - t); if (d < bd) { bd = d; best = i } })
            setPick(best)
          }}
          layers={[
            { kind: 'line', x0: start / FS, dx: 1 / FS, ys: a.xf.subarray(start, start + show * FS), color: C.ink, width: 1.4 },
            ...(beat ? [{ kind: 'rect' as const, x0: (beat.pos - PRE) / FS, x1: (beat.pos + POST) / FS, color: 'rgba(43,63,217,.08)' }] : []),
            { kind: 'points', xs: inWin.map(({ b }) => b.pos / FS), ys: inWin.map(({ b }) => a.xf[b.pos]), colors: inWin.map(({ b }) => (b.prob >= thr ? C.red : C.cobalt)), r: 4 },
            ...ann.map((b) => ({ kind: 'text' as const, x: b[0] / FS, y: dy[1] - 0.22, text: b[1], color: b[1] === 'V' ? C.red : C.ink3 })),
            ...inWin.map(({ b }) => ({ kind: 'text' as const, x: b.pos / FS, y: dy[0] + 0.12, text: fmt(b.prob * 100, 0) + '%', color: b.prob >= thr ? C.red : C.ink3, weight: 500, size: 10 })),
          ]} />
      </Figure>
      <div className="stages">
        {STAGES.map((s) => {
          const { ys } = stageLayers(s.key)
          return (
            <Figure key={s.key} title={s.title} note={s.z}>
              <Plot ariaLabel={`Tahap Pan-Tompkins: ${s.title}`} height={110} grid="plain" x={[0, show]} y={s.key === 'sq' || s.key === 'mwi' ? [-0.05, 1.05] : [-1.05, 1.05]}
                layers={[
                  { kind: 'line', x0: 0, dx: 1 / FS, ys, color: s.key === 'mwi' ? C.cobalt : C.ink, width: 1.2 },
                  ...(s.key === 'mwi' ? [{ kind: 'line' as const, x0: 0, dx: 1 / FS, ys: a.pt.thr.subarray(start, start + show * FS).map((v) => v / stageLayers('mwi').m), color: C.red, dash: [4, 3], width: 1.2 }] : []),
                ]} />
            </Figure>
          )
        })}
      </div>
      {beat?.x && (
        <div className="beat-detail">
          <Figure title={`Detak pada ${fmt(beat.pos / FS, 2)} s`} note={beat.truth ? `anotasi: ${beat.truth === 'V' ? 'ventrikel (PVC)' : beat.truth === 'N' ? 'normal' : beat.truth}` : undefined}>
            <Plot ariaLabel="Bentuk detak terpilih dibandingkan template pasien" height={200} grid="paper" x={[-250, 450]} y={yRange([a.table.template, a.xf.subarray(beat.pos - PRE, beat.pos + POST)], 0.12)} xLabel="ms dari R" xTicks="auto"
              layers={[
                { kind: 'line', x0: -250, dx: 1000 / FS, ys: a.table.template, color: C.ink3, width: 1.4, dash: [4, 3] },
                { kind: 'line', x0: -250, dx: 1000 / FS, ys: a.xf.subarray(beat.pos - PRE, beat.pos + POST), color: beat.prob >= thr ? C.red : C.cobalt, width: 2 },
              ]} />
          </Figure>
          <div className="feat">
            <div className={'verdict ' + (beat.prob >= thr ? 'v' : 'n')}>
              <span>{beat.prob >= thr ? 'PVC' : 'Normal'}</span>
              <b>{fmt(beat.prob * 100, 1)}%</b>
            </div>
            <table>
              <tbody>
                {beat.x.map((v, i) => (
                  <tr key={i}><th>{FEAT_LABEL[i]}</th><td>{fmt(v, i === 4 ? 0 : 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Bench>
  )
}
