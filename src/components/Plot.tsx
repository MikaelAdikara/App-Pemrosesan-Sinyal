import { useEffect, useRef, useState } from 'react'
import type { Arr } from '../dsp/core'

export const C = {
  paper: '#FFF8F6', minor: '#F6D3CD', major: '#EBA49B', ink: '#1A1F3D', ink2: '#5B607C', ink3: '#9A9DB2',
  cobalt: '#2B3FD9', red: '#D3213F', teal: '#0F7F78', amber: '#C77700', rule: '#E6DAD7',
}

type XS = { xs: Arr } | { x0: number; dx: number }
export type Layer =
  | ({ kind: 'line'; ys: Arr; color?: string; width?: number; dash?: number[]; alpha?: number } & XS)
  | ({ kind: 'step'; ys: Arr; color?: string; width?: number } & XS)
  | ({ kind: 'stem'; ys: Arr; color?: string; r?: number; base?: number } & XS)
  | ({ kind: 'band'; lo: Arr; hi: Arr; color: string } & XS)
  | { kind: 'points'; xs: Arr; ys: Arr; color?: string; colors?: string[]; r?: number; marker?: 'dot' | 'ring' | 'cross' }
  | { kind: 'vline'; x: number; color?: string; dash?: number[]; label?: string; width?: number }
  | { kind: 'hline'; y: number; color?: string; dash?: number[]; label?: string }
  | { kind: 'rect'; x0: number; x1: number; y0?: number; y1?: number; color: string }
  | { kind: 'text'; x: number; y: number; text: string; color?: string; align?: CanvasTextAlign; size?: number; weight?: number }
  | { kind: 'heat'; frames: Float64Array[]; x0: number; x1: number; y0: number; y1: number; vmin: number; vmax: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; color?: string; dash?: number[] }

export interface PlotProps {
  layers: Layer[]
  x: [number, number]; y: [number, number]
  height?: number
  grid?: 'paper' | 'plain' | 'none'
  xTicks?: number[] | 'auto'; yTicks?: number[] | 'auto'
  xFmt?: (v: number) => string; yFmt?: (v: number) => string
  xLabel?: string; yLabel?: string
  square?: boolean
  ariaLabel: string
  onClickX?: (x: number) => void
}

function niceTicks(a: number, b: number, n = 6) {
  const span = b - a; if (span <= 0) return [a]
  const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v)
  return out
}

const defFmt = (v: number) => {
  const a = Math.abs(v)
  return (a >= 100 || v === 0 ? v.toFixed(0) : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',')
}

// skala warna spektrogram: kertas -> kobalt -> tinta -> merah
const STOPS = [[255, 248, 246], [246, 211, 205], [235, 164, 155], [43, 63, 217], [26, 31, 61]]
function heatColor(t: number) {
  t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(t)); const f = t - i
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f))
}

export function Plot(p: PlotProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(600)
  const height = p.height ?? 220

  useEffect(() => {
    const el = wrap.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el); return () => ro.disconnect()
  }, [])

  const padL = p.yFmt === undefined && p.yTicks === undefined ? 12 : 44
  const padB = p.xTicks === undefined && !p.xLabel ? 10 : 30
  const padT = 10, padR = 12

  useEffect(() => {
    const c = cv.current; if (!c) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const H = p.square ? Math.min(w, 300) : height
    c.width = (p.square ? Math.min(w, 300) : w) * dpr; c.height = H * dpr; c.style.height = H + 'px'
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, c.width, H)
    const CW = p.square ? Math.min(w, 300) : w
    const pw = CW - padL - padR, ph = H - padT - padB
    const [x0, x1] = p.x, [y0, y1] = p.y
    const X = (v: number) => padL + ((v - x0) / (x1 - x0)) * pw
    const Y = (v: number) => padT + (1 - (v - y0) / (y1 - y0)) * ph

    // latar & grid
    g.fillStyle = p.grid === 'paper' ? C.paper : '#fff'
    g.fillRect(padL, padT, pw, ph)
    if (p.grid === 'paper') {
      const minor = 7.5
      g.lineWidth = 1
      for (let i = 0; i * minor <= pw; i++) {
        g.strokeStyle = i % 5 ? C.minor : C.major
        g.beginPath(); g.moveTo(padL + i * minor + 0.5, padT); g.lineTo(padL + i * minor + 0.5, padT + ph); g.stroke()
      }
      for (let j = 0; j * minor <= ph; j++) {
        g.strokeStyle = j % 5 ? C.minor : C.major
        g.beginPath(); g.moveTo(padL, padT + ph - j * minor - 0.5); g.lineTo(padL + pw, padT + ph - j * minor - 0.5); g.stroke()
      }
    }
    const xt = p.xTicks === 'auto' || (p.xTicks === undefined && p.xLabel) ? niceTicks(x0, x1, Math.max(3, Math.floor(pw / 80))) : p.xTicks ?? []
    const yt = p.yTicks === 'auto' || (p.yTicks === undefined && p.yFmt) ? niceTicks(y0, y1, Math.max(3, Math.floor(ph / 40))) : p.yTicks ?? []
    if (p.grid === 'plain') {
      g.strokeStyle = C.rule; g.lineWidth = 1
      for (const v of yt) { g.beginPath(); g.moveTo(padL, Math.round(Y(v)) + 0.5); g.lineTo(padL + pw, Math.round(Y(v)) + 0.5); g.stroke() }
    }

    g.save(); g.beginPath(); g.rect(padL, padT, pw, ph); g.clip()
    const xsOf = (l: XS, _n?: number) => ('xs' in l ? (i: number) => l.xs[i] : (i: number) => l.x0 + i * l.dx) as (i: number) => number
    for (const l of p.layers) {
      g.setLineDash([]); g.globalAlpha = 1
      if (l.kind === 'line' || l.kind === 'step') {
        const n = l.ys.length; if (!n) continue
        const xf = xsOf(l, n)
        g.strokeStyle = l.color ?? C.ink; g.lineWidth = l.width ?? 1.4; g.lineJoin = 'round'
        if (l.kind === 'line' && l.dash) g.setLineDash(l.dash)
        if (l.kind === 'line' && l.alpha !== undefined) g.globalAlpha = l.alpha
        g.beginPath()
        const pxPer = n / pw
        if (l.kind === 'line' && pxPer > 2 && !('xs' in l)) {
          // min/max per kolom piksel supaya tetap tajam & cepat
          let col = -1, mn = 0, mx = 0, first = true
          for (let i = 0; i < n; i++) {
            const cx = Math.floor(X(xf(i))); const v = l.ys[i]
            if (cx !== col) {
              if (col >= 0) { if (first) { g.moveTo(col, Y(mn)); first = false } g.lineTo(col, Y(mn)); g.lineTo(col, Y(mx)) }
              col = cx; mn = mx = v
            } else { mn = Math.min(mn, v); mx = Math.max(mx, v) }
          }
          if (col >= 0) { g.lineTo(col, Y(mn)); g.lineTo(col, Y(mx)) }
        } else {
          for (let i = 0; i < n; i++) {
            const px = X(xf(i)), py = Y(l.ys[i])
            if (i === 0) g.moveTo(px, py)
            else if (l.kind === 'step') { g.lineTo(px, Y(l.ys[i - 1])); g.lineTo(px, py) } else g.lineTo(px, py)
          }
          if (l.kind === 'step' && n > 1) g.lineTo(X(xf(n - 1) + (xf(n - 1) - xf(n - 2))), Y(l.ys[n - 1]))
        }
        g.stroke()
      } else if (l.kind === 'stem') {
        const n = l.ys.length; const xf = xsOf(l, n); const b = Y(l.base ?? 0)
        g.strokeStyle = l.color ?? C.ink; g.fillStyle = l.color ?? C.ink; g.lineWidth = 1.2
        for (let i = 0; i < n; i++) {
          const px = X(xf(i)), py = Y(l.ys[i])
          g.beginPath(); g.moveTo(px, b); g.lineTo(px, py); g.stroke()
          g.beginPath(); g.arc(px, py, l.r ?? 2.4, 0, 7); g.fill()
        }
      } else if (l.kind === 'band') {
        const n = l.lo.length; const xf = xsOf(l, n)
        g.fillStyle = l.color; g.beginPath()
        for (let i = 0; i < n; i++) i ? g.lineTo(X(xf(i)), Y(l.hi[i])) : g.moveTo(X(xf(i)), Y(l.hi[i]))
        for (let i = n - 1; i >= 0; i--) g.lineTo(X(xf(i)), Y(l.lo[i]))
        g.closePath(); g.fill()
      } else if (l.kind === 'points') {
        for (let i = 0; i < l.xs.length; i++) {
          const px = X(l.xs[i]), py = Y(l.ys[i]); const col = l.colors?.[i] ?? l.color ?? C.ink; const r = l.r ?? 2.5
          g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6
          if (l.marker === 'ring') { g.beginPath(); g.arc(px, py, r, 0, 7); g.stroke() }
          else if (l.marker === 'cross') { g.beginPath(); g.moveTo(px - r, py - r); g.lineTo(px + r, py + r); g.moveTo(px + r, py - r); g.lineTo(px - r, py + r); g.stroke() }
          else { g.beginPath(); g.arc(px, py, r, 0, 7); g.fill() }
        }
      } else if (l.kind === 'vline') {
        g.strokeStyle = l.color ?? C.ink2; g.lineWidth = l.width ?? 1; if (l.dash) g.setLineDash(l.dash)
        g.beginPath(); g.moveTo(Math.round(X(l.x)) + 0.5, padT); g.lineTo(Math.round(X(l.x)) + 0.5, padT + ph); g.stroke()
        if (l.label) { g.setLineDash([]); g.fillStyle = l.color ?? C.ink2; g.font = '600 11px "Instrument Sans", sans-serif'; g.textAlign = 'left'; g.fillText(l.label, X(l.x) + 4, padT + 12) }
      } else if (l.kind === 'hline') {
        g.strokeStyle = l.color ?? C.ink2; g.lineWidth = 1; if (l.dash) g.setLineDash(l.dash)
        g.beginPath(); g.moveTo(padL, Math.round(Y(l.y)) + 0.5); g.lineTo(padL + pw, Math.round(Y(l.y)) + 0.5); g.stroke()
        if (l.label) { g.setLineDash([]); g.fillStyle = l.color ?? C.ink2; g.font = '600 11px "Instrument Sans", sans-serif'; g.textAlign = 'right'; g.fillText(l.label, padL + pw - 4, Y(l.y) - 4) }
      } else if (l.kind === 'rect') {
        g.fillStyle = l.color
        const ya = l.y1 === undefined ? padT : Y(l.y1), yb = l.y0 === undefined ? padT + ph : Y(l.y0)
        g.fillRect(X(l.x0), ya, X(l.x1) - X(l.x0), yb - ya)
      } else if (l.kind === 'text') {
        g.fillStyle = l.color ?? C.ink; g.font = `${l.weight ?? 600} ${l.size ?? 11}px "Instrument Sans", sans-serif`; g.textAlign = l.align ?? 'center'
        g.fillText(l.text, X(l.x), Y(l.y))
      } else if (l.kind === 'heat') {
        const nf = l.frames.length; if (!nf) continue
        const nb = l.frames[0].length
        const img = g.createImageData(nf, nb)
        for (let i = 0; i < nf; i++) for (let k = 0; k < nb; k++) {
          const [r, gg, b] = heatColor((l.frames[i][k] - l.vmin) / (l.vmax - l.vmin))
          const o = ((nb - 1 - k) * nf + i) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255
        }
        const off = document.createElement('canvas'); off.width = nf; off.height = nb; off.getContext('2d')!.putImageData(img, 0, 0)
        g.imageSmoothingEnabled = true
        g.drawImage(off, X(l.x0), Y(l.y1), X(l.x1) - X(l.x0), Y(l.y0) - Y(l.y1))
      } else if (l.kind === 'circle') {
        g.strokeStyle = l.color ?? C.ink3; g.lineWidth = 1; if (l.dash) g.setLineDash(l.dash)
        g.beginPath(); g.ellipse(X(l.cx), Y(l.cy), Math.abs(X(l.cx + l.r) - X(l.cx)), Math.abs(Y(l.cy + l.r) - Y(l.cy)), 0, 0, 7); g.stroke()
      }
    }
    g.restore()

    // sumbu
    g.fillStyle = C.ink2; g.font = '11px "Instrument Sans", sans-serif'
    const xf = p.xFmt ?? defFmt, yf = p.yFmt ?? defFmt
    g.textAlign = 'center'
    for (const v of xt) g.fillText(xf(v), X(v), padT + ph + 15)
    g.textAlign = 'right'
    for (const v of yt) g.fillText(yf(v), padL - 6, Y(v) + 4)
    if (p.xLabel) { g.textAlign = 'right'; g.fillStyle = C.ink3; g.fillText(p.xLabel, padL + pw, padT + ph + 28) }
    if (p.yLabel) { g.save(); g.translate(11, padT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = C.ink3; g.fillText(p.yLabel, 0, 0); g.restore() }
    g.strokeStyle = p.grid === 'paper' ? C.major : C.rule; g.lineWidth = 1
    g.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1)
  }, [p, w, height, padL, padB])

  const onClick = p.onClickX ? (e: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect(); const pw = w - padL - padR
    p.onClickX!(p.x[0] + ((e.clientX - r.left - padL) / pw) * (p.x[1] - p.x[0]))
  } : undefined

  return (
    <div ref={wrap} className="plot">
      <canvas ref={cv} role="img" aria-label={p.ariaLabel} onClick={onClick} style={{ width: p.square ? Math.min(w, 300) : '100%', display: 'block', margin: p.square ? '0 auto' : undefined, cursor: onClick ? 'crosshair' : undefined }} />
    </div>
  )
}
