import { aami, beatFeatures, FS, matchBeats, mlpPredict, panTompkins, preprocess, type BeatTable, type Model, type PTStages } from './dsp/ecg'

export interface RecordMeta {
  id: string; title: string; desc: string; fs: number; gain: number; baseline: number; bits: number
  lead: string; seconds: number; n: number; beats: [number, string][]; counts: Record<string, number>
}
export interface Manifest { records: { id: string; title: string; desc: string; counts: Record<string, number>; beats: number }[] }

export interface Beat { pos: number; label: 'N' | 'V'; prob: number; truth?: string; x?: number[] }

export interface Analysis {
  meta: RecordMeta
  adu: Int16Array        // kode ADC asli 11-bit
  mv: Float64Array       // mV = (adu - baseline) / gain
  xf: Float64Array       // setelah preprocessing FIR
  pt: PTStages
  table: BeatTable
  beats: Beat[]          // detak terdeteksi + label model
  det: { tp: number; fp: number; fn: number }
  inferMs: number
}

const base = import.meta.env.BASE_URL + 'data/'
const cache = new Map<string, Promise<unknown>>()
function once<T>(key: string, f: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, f())
  return cache.get(key) as Promise<T>
}

export const loadManifest = () => once('manifest', () => fetch(base + 'manifest.json').then((r) => r.json() as Promise<Manifest>))
export const loadModel = () => once('model', () => fetch(base + 'model.json').then((r) => r.json() as Promise<Model>))
const loadBin = (name: string) => once('bin:' + name, () => fetch(base + name).then((r) => r.arrayBuffer()).then((b) => new Int16Array(b)))

export const NOISES = { bw: 'Baseline wander', ma: 'Artefak otot', em: 'Gerak elektroda' } as const
export type NoiseName = keyof typeof NOISES
export function loadNoise(name: NoiseName) {
  return once('noise:' + name, async () => {
    const adu = await loadBin(`noise_${name}.bin`)
    return Float64Array.from(adu, (v) => v / 200)
  })
}

export function loadRecord(id: string): Promise<Analysis> {
  return once('rec:' + id, async () => {
    const [meta, adu, model] = await Promise.all([
      fetch(base + `rec_${id}.json`).then((r) => r.json() as Promise<RecordMeta>), loadBin(`rec_${id}.bin`), loadModel(),
    ])
    const mv = Float64Array.from(adu, (v) => (v - meta.baseline) / meta.gain)
    const xf = preprocess(mv, model.lp)
    const pt = panTompkins(mv)
    const ref = meta.beats.map((b) => b[0])
    const m = matchBeats(pt.peaks, ref, Math.round(0.15 * FS))
    const table = beatFeatures(xf, pt.peaks)
    const t0 = performance.now()
    const probs = table.X.map((x) => mlpPredict(model, x))
    const inferMs = (performance.now() - t0) / Math.max(1, probs.length)
    const byIdx = new Map(table.idx.map((i, k) => [i, k]))
    const beats: Beat[] = pt.peaks.map((pos, i) => {
      const k = byIdx.get(i); const prob = k === undefined ? 0 : probs[k]
      const r = m.pair.get(i)
      return { pos, prob, label: prob >= 0.5 ? 'V' : 'N', truth: r === undefined ? undefined : aami(meta.beats[r][1]), x: k === undefined ? undefined : table.X[k] }
    })
    return { meta, adu, mv, xf, pt, table, beats, det: { tp: m.tp, fp: m.fp, fn: m.fn }, inferMs }
  })
}
