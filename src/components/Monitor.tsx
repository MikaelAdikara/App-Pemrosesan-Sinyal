import { useEffect, useRef } from 'react'
import type { Analysis } from '../data'
import { FS } from '../dsp/ecg'
import { C } from './Plot'

// Monitor ECG gaya kertas EKG standar: 25 mm/s, 10 mm/mV, kotak kecil 1 mm, kotak besar 5 mm.
// Trace digambar dengan sapuan (sweep) seperti monitor pasien; label detak dari model di browser.

interface Props {
  a: Analysis
  playing: boolean
  speed: number
  timeRef: React.MutableRefObject<number>
  sound: boolean
  onTick: (t: number) => void
  onBeat?: (label: 'N' | 'V') => void
}

let audio: AudioContext | null = null
function blip(v: boolean) {
  audio ??= new AudioContext()
  const t = audio.currentTime
  const o = audio.createOscillator(); const g = audio.createGain()
  o.type = v ? 'triangle' : 'sine'; o.frequency.value = v ? 520 : 1046
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + (v ? 0.22 : 0.09))
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.25)
}

export function Monitor({ a, playing, speed, timeRef, sound, onTick, onBeat }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const gridCv = useRef<HTMLCanvasElement | null>(null)
  const st = useRef({ playing, speed, sound, onTick, onBeat })
  st.current = { playing, speed, sound, onTick, onBeat }

  useEffect(() => {
    const c = cv.current!, el = wrap.current!
    let W = 0, H = 0, dpr = 1, mm = 4
    let raf = 0, last = performance.now(), lastTick = 0
    let lastBeatIdx = -1
    const beats = a.beats
    const dur = a.meta.seconds
    const resize = () => {
      dpr = Math.min(2.5, window.devicePixelRatio || 1)
      W = el.clientWidth; H = el.clientHeight
      mm = W < 640 ? 3.2 : 4
      c.width = W * dpr; c.height = H * dpr
      const gc = document.createElement('canvas'); gc.width = W * dpr; gc.height = H * dpr
      const g = gc.getContext('2d')!; g.scale(dpr, dpr)
      g.fillStyle = C.paper; g.fillRect(0, 0, W, H)
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i * mm <= W; i++) {
        if ((i % 5 === 0) !== (pass === 1)) continue
        g.strokeStyle = i % 5 ? C.minor : C.major; g.lineWidth = i % 5 ? 0.6 : 1
        g.beginPath(); g.moveTo(i * mm, 0); g.lineTo(i * mm, H); g.stroke()
      }
      const mid = Math.round(H * 0.58)
      for (let pass = 0; pass < 2; pass++) for (let j = -60; j <= 60; j++) {
        const y = mid + j * mm; if (y < 0 || y > H) continue
        if ((j % 5 === 0) !== (pass === 1)) continue
        g.strokeStyle = j % 5 ? C.minor : C.major; g.lineWidth = j % 5 ? 0.6 : 1
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke()
      }
      // pulsa kalibrasi 1 mV (10 mm) di kiri, seperti mesin EKG
      g.strokeStyle = C.ink; g.lineWidth = 1.6; g.beginPath()
      const x0 = mm * 2
      g.moveTo(x0, mid); g.lineTo(x0 + mm, mid); g.lineTo(x0 + mm, mid - 10 * mm); g.lineTo(x0 + 6 * mm, mid - 10 * mm); g.lineTo(x0 + 6 * mm, mid); g.lineTo(x0 + 7 * mm, mid); g.stroke()
      g.fillStyle = C.ink2; g.font = '600 10px "Instrument Sans", sans-serif'; g.fillText('1 mV', x0, mid - 10 * mm - 6)
      gridCv.current = gc
      paint(performance.now())
    }

    const paint = (now: number) => {
      const s = st.current
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      if (s.playing) timeRef.current = (timeRef.current + dt * s.speed) % dur
      const t = timeRef.current
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (gridCv.current) g.drawImage(gridCv.current, 0, 0, W, H)
      const cal = mm * 9                // area pulsa kalibrasi
      const pxPerS = 25 * mm
      const span = (W - cal) / pxPerS   // detik yang muat di layar
      const mid = Math.round(H * 0.58)
      const head = cal + ((t % span) / span) * (W - cal)
      const gap = 0.22 * pxPerS
      const Y = (v: number) => mid - v * 10 * mm
      const sweepStart = t - (t % span)
      // dua bagian: pass sekarang (sweepStart..t) dan sisa pass lama (t - span + gap .. sweepStart)
      const seg = (ta: number, tb: number, xOff: number) => {
        const ia = Math.max(0, Math.floor(ta * FS)), ib = Math.min(a.mv.length - 1, Math.floor(tb * FS))
        if (ib <= ia) return
        g.beginPath()
        for (let i = ia; i <= ib; i++) {
          const x = xOff + ((i / FS) - ta) * pxPerS; const y = Y(a.xf[i])
          i === ia ? g.moveTo(x, y) : g.lineTo(x, y)
        }
        g.stroke()
      }
      g.lineJoin = 'round'; g.lineCap = 'round'
      g.strokeStyle = C.ink; g.lineWidth = 1.7
      seg(sweepStart, t, cal)
      const oldA = t - span + gap / pxPerS
      if (oldA < sweepStart && t >= span) {
        g.globalAlpha = 0.9
        seg(oldA, sweepStart, cal + ((oldA - (sweepStart - span)) * pxPerS))
        g.globalAlpha = 1
      }
      // label detak
      g.font = '700 12px "Instrument Sans", sans-serif'; g.textAlign = 'center'
      const visA = t - span + gap / pxPerS
      for (let k = 0; k < beats.length; k++) {
        const bt = beats[k].pos / FS
        if (bt > t || bt < visA) continue
        const x = bt >= sweepStart ? cal + (bt - sweepStart) * pxPerS : cal + (bt - (sweepStart - span)) * pxPerS
        const isV = beats[k].label === 'V'
        const top = mid - 26 * mm
        g.fillStyle = isV ? C.red : C.ink2
        if (isV) {
          g.beginPath(); g.arc(x, top - 4, 10, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText('V', x, top)
        } else g.fillText('N', x, top)
        if (k > 0 && beats[k - 1].pos / FS >= visA) {
          const rr = (beats[k].pos - beats[k - 1].pos) / FS * 1000
          const xp = beats[k - 1].pos / FS >= sweepStart || bt < sweepStart
            ? x - ((beats[k].pos - beats[k - 1].pos) / FS) * pxPerS / 2 : null
          if (xp !== null) {
            g.fillStyle = C.ink3; g.font = '500 10px "Instrument Sans", sans-serif'
            g.fillText(Math.round(rr) + '', xp, H - 10)
            g.font = '700 12px "Instrument Sans", sans-serif'
          }
        }
      }
      // kepala sapuan
      const hi = Math.min(a.xf.length - 1, Math.floor(t * FS))
      g.fillStyle = C.cobalt; g.beginPath(); g.arc(head, Y(a.xf[hi]), 3.6, 0, 7); g.fill()
      g.globalAlpha = 0.15; g.beginPath(); g.arc(head, Y(a.xf[hi]), 10, 0, 7); g.fill(); g.globalAlpha = 1

      // event detak baru (suara / getar)
      let bi = lastBeatIdx
      while (bi + 1 < beats.length && beats[bi + 1].pos / FS <= t) bi++
      if (bi !== lastBeatIdx) {
        if (s.playing && bi === lastBeatIdx + 1 && bi >= 0) {
          const isV = beats[bi].label === 'V'
          if (s.sound) { blip(isV); if (isV) navigator.vibrate?.(60) }
          s.onBeat?.(beats[bi].label)
        }
        lastBeatIdx = bi
      }
      if (now - lastTick > 200) { s.onTick(t); lastTick = now }
    }
    const loop = (now: number) => { paint(now); raf = requestAnimationFrame(loop) }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(el)
    raf = requestAnimationFrame(loop)
    // repaint saat posisi digeser dari luar (rAF bisa berhenti di tab tersembunyi)
    const iv = setInterval(() => { if (!st.current.playing) paint(performance.now()) }, 250)
    return () => { cancelAnimationFrame(raf); clearInterval(iv); ro.disconnect() }
  }, [a, timeRef])

  return (
    <div ref={wrap} className="monitor">
      <canvas ref={cv} role="img" aria-label={`EKG berjalan rekaman ${a.meta.id}, 25 mm per detik, 10 mm per milivolt`} />
    </div>
  )
}
