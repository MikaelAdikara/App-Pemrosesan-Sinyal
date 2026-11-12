// Pustaka DSP kecil, ditulis dari nol supaya setiap langkah bisa ditelusuri di kelas.
// Semua fungsi bekerja pada Float64Array / number[] dan tidak bergantung pada library luar.

export type Arr = Float64Array | number[]

// ---------------------------------------------------------------- statistik
export const sum = (x: Arr) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s }
export const mean = (x: Arr) => (x.length ? sum(x) / x.length : 0)
export function variance(x: Arr) {
  const m = mean(x); let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2
  return x.length ? s / x.length : 0
}
export const std = (x: Arr) => Math.sqrt(variance(x))
export function median(x: Arr) {
  if (!x.length) return 0
  const s = Float64Array.from(x).sort(); const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
export function maxAbs(x: Arr) { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m }
export function corr(a: Arr, b: Arr) {
  const n = Math.min(a.length, b.length); const ma = mean(a), mb = mean(b)
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db }
  return sab / Math.sqrt(saa * sbb + 1e-30)
}
export const db10 = (p: number) => 10 * Math.log10(Math.max(p, 1e-30))
export const db20 = (a: number) => 20 * Math.log10(Math.max(a, 1e-15))

// ---------------------------------------------------------------- jendela
export type WindowName = 'rectangular' | 'hann' | 'hamming' | 'blackman'
export const WINDOW_LABEL: Record<WindowName, string> = {
  rectangular: 'Persegi', hann: 'Hann', hamming: 'Hamming', blackman: 'Blackman',
}
export function windowFn(name: WindowName, n: number) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = n === 1 ? 0 : (2 * Math.PI * i) / (n - 1)
    w[i] = name === 'hann' ? 0.5 - 0.5 * Math.cos(r)
      : name === 'hamming' ? 0.54 - 0.46 * Math.cos(r)
        : name === 'blackman' ? 0.42 - 0.5 * Math.cos(r) + 0.08 * Math.cos(2 * r)
          : 1
  }
  return w
}

// ---------------------------------------------------------------- FFT radix-2
export const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(1, n)))

/** FFT in-place (Cooley-Tukey, radix-2). panjang harus pangkat 2 */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

/** spektrum satu sisi |X[k]| untuk sinyal real, dengan jendela & zero padding */
export function spectrum(x: Arr, fs: number, win: WindowName = 'hann', nfft?: number) {
  const n = nfft ?? nextPow2(x.length)
  const w = windowFn(win, x.length)
  const re = new Float64Array(n), im = new Float64Array(n)
  const m = mean(x); let wsum = 0
  for (let i = 0; i < x.length; i++) { re[i] = (x[i] - m) * w[i]; wsum += w[i] }
  fft(re, im)
  const half = n / 2 + 1
  const mag = new Float64Array(half), freq = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    mag[k] = (Math.hypot(re[k], im[k]) * (k === 0 || k === n / 2 ? 1 : 2)) / wsum
    freq[k] = (k * fs) / n
  }
  return { mag, freq, df: fs / n, n }
}

/** spektrogram (STFT): matriks [frame][bin] dalam dB */
export function stft(x: Arr, fs: number, winLen: number, hop: number, win: WindowName = 'hann', fmax = fs / 2) {
  const n = nextPow2(winLen); const w = windowFn(win, winLen)
  const kmax = Math.min(n / 2, Math.floor((fmax * n) / fs))
  const frames: Float64Array[] = []; const times: number[] = []
  for (let s = 0; s + winLen <= x.length; s += hop) {
    const re = new Float64Array(n), im = new Float64Array(n)
    let m = 0; for (let i = 0; i < winLen; i++) m += x[s + i]; m /= winLen
    for (let i = 0; i < winLen; i++) re[i] = (x[s + i] - m) * w[i]
    fft(re, im)
    const f = new Float64Array(kmax + 1)
    for (let k = 0; k <= kmax; k++) f[k] = db10(re[k] * re[k] + im[k] * im[k])
    frames.push(f); times.push((s + winLen / 2) / fs)
  }
  return { frames, times, df: fs / n, kmax }
}

// ---------------------------------------------------------------- FIR
export type FirType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop'
export const FIR_LABEL: Record<FirType, string> = {
  lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', bandstop: 'Band-stop (notch)',
}

/** desain FIR metode jendela (windowed-sinc). N ganjil, fase linear, tunda (N-1)/2 */
export function firDesign(type: FirType, n: number, fs: number, f1: number, f2 = 0, win: WindowName = 'hamming') {
  if (n % 2 === 0) n += 1
  const m = (n - 1) / 2; const w = windowFn(win, n); const h = new Float64Array(n)
  const sinc = (fc: number, i: number) => { const t = i - m; const wc = (2 * fc) / fs; return t === 0 ? wc : Math.sin(Math.PI * wc * t) / (Math.PI * t) }
  for (let i = 0; i < n; i++) {
    let v: number
    if (type === 'lowpass') v = sinc(f1, i)
    else if (type === 'highpass') v = (i === m ? 1 : 0) - sinc(f1, i)
    else if (type === 'bandpass') v = sinc(f2, i) - sinc(f1, i)
    else v = (i === m ? 1 : 0) - (sinc(f2, i) - sinc(f1, i))
    h[i] = v * w[i]
  }
  // normalisasi gain di frekuensi acuan (DC untuk LP/BS, Nyquist untuk HP, tengah pita untuk BP)
  const fRef = type === 'lowpass' || type === 'bandstop' ? 0 : type === 'highpass' ? fs / 2 : (f1 + f2) / 2
  const g = Math.hypot(...freqzAt(h, [1], fRef, fs))
  for (let i = 0; i < n; i++) h[i] /= g
  return h
}

function freqzAt(b: Arr, a: Arr, f: number, fs: number): [number, number] {
  const w = (2 * Math.PI * f) / fs
  let br = 0, bi = 0, ar = 0, ai = 0
  for (let k = 0; k < b.length; k++) { br += b[k] * Math.cos(w * k); bi -= b[k] * Math.sin(w * k) }
  for (let k = 0; k < a.length; k++) { ar += a[k] * Math.cos(w * k); ai -= a[k] * Math.sin(w * k) }
  const den = ar * ar + ai * ai
  return [(br * ar + bi * ai) / den, (bi * ar - br * ai) / den]
}

/** respons frekuensi H(e^jw) di npts titik 0..fs/2 */
export function freqz(b: Arr, a: Arr = [1], fs: number, npts = 512) {
  const freq = new Float64Array(npts), mag = new Float64Array(npts), phase = new Float64Array(npts)
  for (let i = 0; i < npts; i++) {
    const f = (i / (npts - 1)) * (fs / 2); const [r, im] = freqzAt(b, a, f, fs)
    freq[i] = f; mag[i] = Math.hypot(r, im); phase[i] = Math.atan2(im, r)
  }
  return { freq, mag, phase }
}

/** konvolusi kausal y[n] = Σ h[k] x[n-k] (filter real-time, ada tunda) */
export function filterCausal(x: Arr, h: Arr) {
  const y = new Float64Array(x.length); const n = h.length
  for (let i = 0; i < x.length; i++) {
    let s = 0; const kmax = Math.min(n - 1, i)
    for (let k = 0; k <= kmax; k++) s += h[k] * x[i - k]
    y[i] = s
  }
  return y
}

/** konvolusi "same": tunda (N-1)/2 dikompensasi (setara fase nol untuk FIR simetris) */
export function filterSame(x: Arr, h: Arr) {
  const n = h.length; const m = (n - 1) >> 1; const y = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let s = 0
    for (let k = 0; k < n; k++) { const j = i + m - k; if (j >= 0 && j < x.length) s += h[k] * x[j] }
    y[i] = s
  }
  return y
}

/** IIR umum: a[0] y[n] = Σ b x - Σ a y */
export function lfilter(b: Arr, a: Arr, x: Arr) {
  const y = new Float64Array(x.length)
  for (let n = 0; n < x.length; n++) {
    let s = 0
    for (let k = 0; k < b.length; k++) if (n - k >= 0) s += b[k] * x[n - k]
    for (let k = 1; k < a.length; k++) if (n - k >= 0) s -= a[k] * y[n - k]
    y[n] = s / a[0]
  }
  return y
}

/** rata-rata bergerak terpusat (FIR h = 1/w), O(n) dengan running sum */
export function movingAvg(x: Arr, w: number) {
  const h = w >> 1; const n = x.length; const c = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i]
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1); y[i] = (c[hi] - c[lo]) / (hi - lo) }
  return y
}

// ---------------------------------------------------------------- akar polinom (zero FIR, pole AR)
export type Complex = [number, number]

/** akar polinom c[0] z^n + c[1] z^(n-1) + ... + c[n] (Durand-Kerner) */
export function roots(cIn: Arr): Complex[] {
  let c = Array.from(cIn)
  while (c.length && Math.abs(c[0]) < 1e-14) c.shift()
  let zerosAtOrigin = 0
  while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-14) { c.pop(); zerosAtOrigin++ }
  const n = c.length - 1; const out: Complex[] = []
  for (let i = 0; i < zerosAtOrigin; i++) out.push([0, 0])
  if (n < 1) return out
  c = c.map((v) => v / c[0])
  // Aberth-Ehrlich: konvergen kubik, tebakan awal di lingkaran satuan (zero FIR umumnya di sekitarnya)
  let z: Complex[] = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * (k + 0.25)) / n + 0.1
    return [Math.cos(a), Math.sin(a)]
  })
  const evalPD = (zr: number, zi: number) => {
    let pr = 1, pi = 0, dr = 0, di = 0
    for (let k = 1; k <= n; k++) {
      const ndr = dr * zr - di * zi + pr; di = dr * zi + di * zr + pi; dr = ndr
      const npr = pr * zr - pi * zi + c[k]; pi = pr * zi + pi * zr; pr = npr
    }
    return [pr, pi, dr, di]
  }
  for (let it = 0; it < 500; it++) {
    let delta = 0
    for (let i = 0; i < n; i++) {
      const [zr, zi] = z[i]
      const [pr, pi, dr, di] = evalPD(zr, zi)
      const dd = dr * dr + di * di
      if (!(dd > 0) || !Number.isFinite(dd)) continue
      const wr = (pr * dr + pi * di) / dd, wi = (pi * dr - pr * di) / dd   // w = p/p'
      let sr = 0, si = 0
      for (let j = 0; j < n; j++) if (j !== i) {
        const ar = zr - z[j][0], ai = zi - z[j][1]; const m = ar * ar + ai * ai + 1e-300
        sr += ar / m; si -= ai / m
      }
      const er = 1 - (wr * sr - wi * si), ei = -(wr * si + wi * sr)
      const em = er * er + ei * ei
      const cr = (wr * er + wi * ei) / em, ci = (wi * er - wr * ei) / em
      if (!Number.isFinite(cr) || !Number.isFinite(ci)) continue
      z[i] = [zr - cr, zi - ci]
      delta = Math.max(delta, Math.hypot(cr, ci))
    }
    if (delta < 1e-12) break
  }
  return out.concat(z)
}

// ---------------------------------------------------------------- ADC
/** kuantisasi uniform midrise di rentang [-R, R], b bit. return nilai & kode */
export function quantUniform(x: Arr, bits: number, R: number) {
  const L = 2 ** bits; const d = (2 * R) / L
  const q = new Float64Array(x.length); const code = new Int32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const k = Math.min(L - 1, Math.max(0, Math.floor((x[i] + R) / d)))
    code[i] = k; q[i] = -R + (k + 0.5) * d
  }
  return { q, code, delta: d }
}

/** kuantisasi μ-law: kompres -> uniform -> ekspansi */
export function quantMuLaw(x: Arr, bits: number, R: number, mu = 255) {
  const L = 2 ** bits; const d = 2 / L
  const q = new Float64Array(x.length); const code = new Int32Array(x.length)
  const ln = Math.log(1 + mu)
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i] / R))
    const y = (Math.sign(v) * Math.log(1 + mu * Math.abs(v))) / ln
    const k = Math.min(L - 1, Math.max(0, Math.floor((y + 1) / d)))
    const yq = -1 + (k + 0.5) * d
    code[i] = k; q[i] = (R * Math.sign(yq) * ((1 + mu) ** Math.abs(yq) - 1)) / mu
  }
  return { q, code, delta: (2 * R) / L }
}

export function sqnr(x: Arr, xq: Arr) {
  const e = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) e[i] = x[i] - xq[i]
  return db10(variance(x) / (variance(e) + 1e-30))
}

/** entropi Shannon (bit/simbol) dari deret kode integer */
export function entropy(code: ArrayLike<number>) {
  const m = new Map<number, number>()
  for (let i = 0; i < code.length; i++) m.set(code[i], (m.get(code[i]) ?? 0) + 1)
  let h = 0
  for (const c of m.values()) { const p = c / code.length; h -= p * Math.log2(p) }
  return h
}

// ---------------------------------------------------------------- korelasi
/** autokorelasi ternormalisasi untuk lag 0..maxLag */
export function autocorr(x: Arr, maxLag: number) {
  const m = mean(x); const n = x.length; const r = new Float64Array(maxLag + 1)
  let r0 = 0; for (let i = 0; i < n; i++) r0 += (x[i] - m) ** 2
  for (let k = 0; k <= maxLag; k++) {
    let s = 0; for (let i = 0; i + k < n; i++) s += (x[i] - m) * (x[i + k] - m)
    r[k] = s / (r0 + 1e-30)
  }
  return r
}

/** lag terbaik (dalam ±maxLag) yang memaksimalkan korelasi silang a terhadap b */
export function bestLag(a: Arr, b: Arr, maxLag: number) {
  let best = 0, bv = -Infinity
  for (let k = -maxLag; k <= maxLag; k++) {
    let s = 0
    for (let i = 0; i < a.length; i++) { const j = i + k; if (j >= 0 && j < b.length) s += a[i] * b[j] }
    if (s > bv) { bv = s; best = k }
  }
  return best
}

// ---------------------------------------------------------------- AR & forecasting
/** Yule-Walker via Levinson-Durbin. model x[n] - μ = Σ a_k (x[n-k] - μ) + e[n] */
export function fitAR(x: Arr, p: number) {
  const mu = mean(x); const n = x.length
  const r = new Float64Array(p + 1)
  for (let k = 0; k <= p; k++) { let s = 0; for (let i = 0; i + k < n; i++) s += (x[i] - mu) * (x[i + k] - mu); r[k] = s / n }
  let a = new Float64Array(p + 1); a[0] = 1; let e = r[0]
  for (let k = 1; k <= p; k++) {
    let acc = r[k]; for (let j = 1; j < k; j++) acc += a[j] * r[k - j]
    const kk = -acc / e
    const na = a.slice()
    for (let j = 1; j < k; j++) na[j] = a[j] + kk * a[k - j]
    na[k] = kk; a = na; e *= 1 - kk * kk
  }
  const coef = Array.from(a.slice(1), (v) => -v)   // a_k pada x[n-k]
  return { coef, mu, sigma2: e }
}

/** forecast h langkah + standar error (dari bobot psi MA(∞)) */
export function forecastAR(hist: Arr, model: { coef: number[]; mu: number; sigma2: number }, h: number) {
  const p = model.coef.length; const buf = Array.from(hist).slice(-p).map((v) => v - model.mu)
  const out: number[] = []; const se: number[] = []
  const psi = [1]
  for (let j = 1; j < h; j++) { let s = 0; for (let k = 1; k <= Math.min(p, j); k++) s += model.coef[k - 1] * psi[j - k]; psi.push(s) }
  let cum = 0
  for (let s = 0; s < h; s++) {
    let v = 0; for (let k = 0; k < p; k++) v += model.coef[k] * (buf[buf.length - 1 - k] ?? 0)
    buf.push(v); out.push(v + model.mu)
    cum += psi[s] ** 2; se.push(Math.sqrt(model.sigma2 * cum))
  }
  return { mean: out, se }
}

// ---------------------------------------------------------------- utilitas
/** rentang sumbu [min, max] dengan margin */
export function yRange(arrs: Arr[], pad = 0.08, floor?: [number, number]): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const a of arrs) for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i] }
  if (floor) { lo = Math.min(lo, floor[0]); hi = Math.max(hi, floor[1]) }
  if (!Number.isFinite(lo)) return [-1, 1]
  const m = (hi - lo) * pad || 0.5
  return [lo - m, hi + m]
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export function linspace(a: number, b: number, n: number) { return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)) }
export function slice(x: Arr, a: number, b: number) {
  const lo = Math.max(0, Math.floor(a)), hi = Math.min(x.length, Math.floor(b))
  return x instanceof Float64Array ? x.subarray(lo, hi) : Float64Array.from(x.slice(lo, hi))
}
export const fmt = (v: number, d = 1) => Number.isFinite(v) ? v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'
