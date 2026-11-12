import { useEffect, useRef, useState } from 'react'
import { filterSame, firDesign, fmt, mean, movingAvg, spectrum } from '../dsp/core'
import { C, Plot } from '../components/Plot'
import { Choice, Figure, Read } from '../components/ui'

// Kamera sebagai ADC: setiap frame = satu sampel (fs ≈ 30 Hz), tiap piksel 8 bit (256 level).
// Rata-rata kanal merah (ujung jari + flash) atau hijau (wajah) mengikuti volume darah: sinyal PPG.

type Mode = 'finger' | 'face' | 'demo'
const FSU = 30                     // laju sampel seragam setelah resampling
const WIN_S = 12
const LP = firDesign('lowpass', 31, FSU, 4, 0, 'hamming')

interface Sample { t: number; v: number }

function synth(t: number, bpm: number) {
  // PPG sintetis: gelombang sistolik + notch dikrotik, ditambah drift napas dan noise sensor
  const ph = (t * bpm) / 60 % 1
  const pulse = Math.exp(-((ph - 0.18) ** 2) / 0.006) + 0.35 * Math.exp(-((ph - 0.45) ** 2) / 0.01)
  return 150 + 4 * pulse + 1.5 * Math.sin(2 * Math.PI * 0.25 * t) + (Math.random() - 0.5) * 0.8
}

export function PulseCam() {
  const [mode, setMode] = useState<Mode>('demo')
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [torch, setTorch] = useState<boolean | null>(null)
  const [view, setView] = useState<{ raw: number[]; filt: Float64Array; spec: ReturnType<typeof spectrum> | null; bpm: number; fsHat: number; jitter: number; q: number; levels: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const buf = useRef<Sample[]>([])
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => () => stopRef.current(), [])

  const start = async () => {
    setErr(''); buf.current = []; setView(null)
    let wake: WakeLockSentinel | null = null
    try { wake = await navigator.wakeLock?.request('screen') } catch { /* tidak wajib */ }
    let stopped = false
    let stream: MediaStream | null = null
    const t0 = performance.now()
    if (mode === 'demo') {
      const id = setInterval(() => {
        const t = (performance.now() - t0) / 1000
        // jitter frame nyata: kadang frame terlambat
        if (Math.random() < 0.06) return
        buf.current.push({ t, v: Math.round(synth(t, 72 + 6 * Math.sin(t / 9))) })   // dibulatkan = kuantisasi 8 bit
      }, 1000 / 30)
      stopRef.current = () => { clearInterval(id); stopped = true; wake?.release() }
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode === 'finger' ? 'environment' : 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } }, audio: false })
      } catch (e) {
        setErr('Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau pakai mode demo.'); wake?.release(); return
      }
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
      if (mode === 'finger' && caps.torch) {
        try { await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }); setTorch(true) } catch { setTorch(false) }
      } else setTorch(mode === 'finger' ? false : null)
      const v = videoRef.current!; v.srcObject = stream; await v.play()
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30
      const g = cv.getContext('2d', { willReadFrequently: true })!
      const ch = mode === 'finger' ? 0 : 1
      const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
        if (stopped) return
        g.drawImage(v, 0, 0, 40, 30)
        // ROI: tengah (jari) atau dahi (wajah)
        const [x, y, w, h] = mode === 'finger' ? [10, 8, 20, 14] : [14, 3, 12, 7]
        const d = g.getImageData(x, y, w, h).data
        let s = 0; for (let i = ch; i < d.length; i += 4) s += d[i]
        buf.current.push({ t: meta.mediaTime, v: s / (w * h) })
        v.requestVideoFrameCallback(onFrame)
      }
      v.requestVideoFrameCallback(onFrame)
      stopRef.current = () => { stopped = true; stream?.getTracks().forEach((tr) => tr.stop()); wake?.release() }
    }
    setRunning(true)
    const loop = setInterval(() => {
      if (stopped) { clearInterval(loop); return }
      const b = buf.current; if (b.length < 20) return
      const tEnd = b[b.length - 1].t
      while (b.length && b[0].t < tEnd - WIN_S - 2) b.shift()
      const raw = b.filter((s) => s.t >= tEnd - WIN_S)
      if (raw.length < 30) return
      const dts = raw.slice(1).map((s, i) => s.t - raw[i].t)
      const fsHat = 1 / mean(dts)
      const jitter = Math.sqrt(mean(dts.map((d) => (d - 1 / fsHat) ** 2))) * 1000
      // resampling ke grid seragam 30 Hz (interpolasi linear) = mengembalikan asumsi x[n] = x(nT)
      const n = Math.floor((raw[raw.length - 1].t - raw[0].t) * FSU)
      const u = new Float64Array(n); let j = 0
      for (let i = 0; i < n; i++) {
        const t = raw[0].t + i / FSU
        while (j < raw.length - 2 && raw[j + 1].t < t) j++
        const a = raw[j], c = raw[j + 1]; const f = (t - a.t) / (c.t - a.t || 1)
        u[i] = a.v + (c.v - a.v) * Math.max(0, Math.min(1, f))
      }
      const base = movingAvg(u, FSU + 1)
      const filt = filterSame(u.map((x, i) => x - base[i]), LP)
      const spec = spectrum(filt, FSU, 'hann', 2048)
      let kb = 0, pb = 0, tot = 0
      spec.freq.forEach((f, k) => { if (f >= 0.7 && f <= 3.5) { tot += spec.mag[k] ** 2; if (spec.mag[k] > pb) { pb = spec.mag[k]; kb = k } } })
      let near = 0; spec.freq.forEach((f, k) => { if (Math.abs(f - spec.freq[kb]) < 0.15) near += spec.mag[k] ** 2 })
      const levels = new Set(raw.map((s) => Math.round(s.v))).size
      setView({ raw: raw.map((s) => s.v), filt, spec, bpm: spec.freq[kb] * 60, fsHat, jitter, q: near / (tot || 1), levels })
    }, 500)
  }

  const stop = () => { stopRef.current(); setRunning(false) }
  const ok = view && view.q > 0.35

  return (
    <div className="cam">
      <div className="cam-side">
        <h3>Ukur nadimu sendiri</h3>
        <p>Kamera ponsel adalah ADC: setiap frame satu sampel (sekitar 30 Hz), setiap piksel 8 bit. Ujung jari yang menempel di lensa dengan flash menyala memantulkan cahaya merah yang naik-turun mengikuti volume darah.</p>
        <Choice label="Sumber sinyal" value={mode} onChange={(m) => { stop(); setMode(m) }} options={[
          { value: 'finger', label: 'Ujung jari + flash' }, { value: 'face', label: 'Wajah (webcam)' }, { value: 'demo', label: 'Demo sintetis' },
        ]} />
        <ul className="steps">
          {mode === 'finger' && <><li>Tutup lensa kamera belakang dengan ujung telunjuk, jangan ditekan terlalu keras.</li><li>Diam 15 detik sampai spektrum menunjukkan satu puncak tegas.</li></>}
          {mode === 'face' && <><li>Duduk di tempat terang, wajah di tengah kamera.</li><li>Dahi dipakai sebagai area ukur (kanal hijau paling peka terhadap hemoglobin).</li></>}
          {mode === 'demo' && <li>Sinyal PPG sintetis 72 bpm dengan drift napas, noise, dan frame yang kadang terlambat, untuk dicoba tanpa kamera.</li>}
        </ul>
        <button type="button" className="btn-main" onClick={running ? stop : start}>{running ? 'Hentikan pengukuran' : 'Mulai mengukur'}</button>
        {err && <p className="warn">{err}</p>}
        {torch === false && running && <p className="ctl-hint">Flash tidak bisa dikendalikan dari browser ini. Pakai cahaya lampu dari belakang jari.</p>}
        <p className="ctl-hint">Video diproses di perangkatmu dan tidak dikirim ke mana pun. Ini alat belajar, bukan alat medis.</p>
        <video ref={videoRef} playsInline muted className={running && mode !== 'demo' ? 'cam-video on' : 'cam-video'} />
      </div>
      <div className="cam-main">
        <div className="reads">
          <Read value={view ? (ok ? fmt(view.bpm, 0) : '…') : '–'} label={view ? (ok ? 'detak/menit dari puncak FFT' : 'mencari puncak yang tegas') : 'belum mengukur'} tone="red" />
          <Read value={view ? fmt(view.fsHat, 1) + ' Hz' : '–'} label={view ? `fs terukur, jitter ${fmt(view.jitter, 1)} ms` : 'laju frame'} />
          <Read value={view ? String(view.levels) : '–'} label="level kuantisasi terpakai dari 256" />
          <Read value={view ? fmt(view.q * 100, 0) + '%' : '–'} label="daya di sekitar puncak (kualitas)" tone={ok ? 'teal' : 'ink'} />
        </div>
        <Figure title="Sampel mentah dari kamera" note="nilai rata-rata kanal, 0–255">
          <Plot ariaLabel="Sinyal mentah kamera" height={150} grid="plain" x={[0, view?.raw.length || 1]} y={view ? [Math.min(...view.raw) - 0.5, Math.max(...view.raw) + 0.5] : [0, 1]} yFmt={(v) => fmt(v, 0)}
            layers={view ? [{ kind: 'step', x0: 0, dx: 1, ys: view.raw, color: C.ink2, width: 1 }] : []} />
        </Figure>
        <Figure title="PPG setelah resampling 30 Hz, detrend MA, dan low-pass FIR 4 Hz">
          <Plot ariaLabel="Sinyal PPG terfilter" height={190} grid="paper" x={[0, view ? view.filt.length / FSU : WIN_S]} y={view ? [Math.min(...view.filt) * 1.2, Math.max(...view.filt) * 1.2] : [-1, 1]} xLabel="detik" xTicks="auto"
            layers={view ? [{ kind: 'line', x0: 0, dx: 1 / FSU, ys: view.filt, color: C.red, width: 2 }] : []} />
        </Figure>
        <Figure title="Spektrum 0–4 Hz" note="pita nadi 0,7–3,5 Hz (42–210 bpm)">
          <Plot ariaLabel="Spektrum PPG" height={160} grid="plain" x={[0, 4]} y={[0, view?.spec ? Math.max(...view.spec.mag) * 1.1 || 1 : 1]} xLabel="Hz" xTicks="auto"
            layers={view?.spec ? [
              { kind: 'rect', x0: 0.7, x1: 3.5, color: 'rgba(211,33,63,.06)' },
              { kind: 'line', xs: view.spec.freq, ys: view.spec.mag, color: C.ink, width: 1.4 },
              ...(ok ? [{ kind: 'vline' as const, x: view.bpm / 60, color: C.red, label: fmt(view.bpm, 0) + ' bpm' }] : []),
            ] : []} />
        </Figure>
      </div>
    </div>
  )
}
