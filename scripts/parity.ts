// Uji kesetaraan: fitur & probabilitas dari TypeScript harus sama dengan Python (scripts/feature_reference.json)
//   npx tsx scripts/parity.ts
import { readFileSync } from 'node:fs'
import { beatFeatures, mlpPredict, panTompkins, preprocess, matchBeats, type Model } from '../src/dsp/ecg'

const model: Model = JSON.parse(readFileSync('public/data/model.json', 'utf8'))
const ref = JSON.parse(readFileSync('scripts/feature_reference.json', 'utf8'))
const meta = JSON.parse(readFileSync('public/data/rec_119.json', 'utf8'))
const buf = readFileSync('public/data/rec_119.bin')
const adu = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
const mv = Float64Array.from(adu, (v) => (v - meta.baseline) / meta.gain)
const xf = preprocess(mv, model.lp)
const t = beatFeatures(xf, ref.pos)
let maxErr = 0, maxPErr = 0
for (let k = 0; k < 20; k++) {
  t.X[k].forEach((v, j) => { maxErr = Math.max(maxErr, Math.abs(v - ref.X[k][j]) / (Math.abs(ref.X[k][j]) + 1e-6)) })
  maxPErr = Math.max(maxPErr, Math.abs(mlpPredict(model, t.X[k]) - ref.p[k]))
}
console.log('idx sama:', JSON.stringify(t.idx) === JSON.stringify(ref.idx), 'galat relatif fitur maks:', maxErr.toExponential(2), 'galat prob maks:', maxPErr.toExponential(2))

const t0 = performance.now()
const pt = panTompkins(mv)
const m = matchBeats(pt.peaks, ref.pos, Math.round(0.15 * 360))
console.log('Pan-Tompkins rekaman 119:', { tp: m.tp, fp: m.fp, fn: m.fn }, 'Se', (m.tp / (m.tp + m.fn)).toFixed(4), 'PPV', (m.tp / (m.tp + m.fp)).toFixed(4), 'waktu', (performance.now() - t0).toFixed(0), 'ms')
