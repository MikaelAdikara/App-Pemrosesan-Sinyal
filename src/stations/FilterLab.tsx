import { useEffect, useMemo, useState } from 'react'
import { loadNoise, NOISES, type Analysis, type NoiseName } from '../data'
import { yRange, db10, filterCausal, filterSame, FIR_LABEL, firDesign, fmt, freqz, roots, WINDOW_LABEL, type FirType, type WindowName } from '../dsp/core'
import { FS } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { Bench, Choice, Figure, Formula, Legend, Read, Slider, Toggle } from '../components/ui'

type Mix = Record<NoiseName, number>

export function FilterLab({ a, focus }: { a: Analysis; focus: number }) {
  const [noise, setNoise] = useState<Record<NoiseName, Float64Array> | null>(null)
  const [mix, setMix] = useState<Mix>({ bw: 1, ma: 0.6, em: 0 })
  const [hum, setHum] = useState(0.12)
  const [type, setType] = useState<FirType>('bandpass')
  const [taps, setTaps] = useState(541)
  const [zoomLow, setZoomLow] = useState(false)
  const [win, setWin] = useState<WindowName>('hamming')
  const [f1, setF1] = useState(0.7)
  const [f2, setF2] = useState(40)
  const [causal, setCausal] = useState(false)

  useEffect(() => {
    Promise.all((Object.keys(NOISES) as NoiseName[]).map((k) => loadNoise(k).then((v) => [k, v] as const)))
      .then((e) => setNoise(Object.fromEntries(e) as Record<NoiseName, Float64Array>))
  }, [])

  const h = useMemo(() => firDesign(type, taps, FS, type === 'highpass' ? f1 : type === 'lowpass' ? f2 : f1, f2, win), [type, taps, f1, f2, win])
  const resp = useMemo(() => freqz(h, [1], FS, 720), [h])
  const lowResp = useMemo(() => { const f = Array.from({ length: 400 }, (_, i) => (i / 399) * 10); const r = freqz(h, [1], FS, 7200); return { freq: f, mag: f.map((v) => r.mag[Math.round((v / 180) * 7199)]) } }, [h])
  const zeros = useMemo(() => (taps <= 121 ? roots(h) : null), [h, taps])

  const r = useMemo(() => {
    if (!noise) return null
    const n = 10 * FS; const start = Math.min(a.mv.length - n, Math.floor(focus * FS))
    const clean = a.mv.slice(start, start + n)
    const cm = clean.reduce((s, v) => s + v, 0) / n
    for (let i = 0; i < n; i++) clean[i] -= cm
    const noisy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      noisy[i] = clean[i] + mix.bw * noise.bw[start + i] + mix.ma * noise.ma[start + i] + mix.em * noise.em[start + i]
        + hum * Math.sin((2 * Math.PI * 60 * i) / FS)
    }
    const run = causal ? filterCausal : filterSame
    const out = run(noisy, h), ref = run(clean, h)
    // SNR dihitung di 8 detik tengah supaya efek tepi filter tidak ikut
    const lo = FS, hi = n - FS
    let ps = 0, pn = 0, ps2 = 0, pn2 = 0
    for (let i = lo; i < hi; i++) { ps += clean[i] ** 2; pn += (noisy[i] - clean[i]) ** 2; ps2 += ref[i] ** 2; pn2 += (out[i] - ref[i]) ** 2 }
    return { clean, noisy, out, snrIn: db10(ps / pn), snrOut: db10(ps2 / pn2) }
  }, [a, focus, noise, mix, hum, h, causal])

  const delayMs = ((taps - 1) / 2 / FS) * 1000
  const show = 5
  const nShow = show * FS
  const isBand = type === 'bandpass' || type === 'bandstop'

  return (
    <Bench controls={<>
      <h4 className="ctl-group">Campurkan noise nyata (NSTDB)</h4>
      {(Object.keys(NOISES) as NoiseName[]).map((k) => (
        <Slider key={k} label={NOISES[k]} value={mix[k]} min={0} max={2} step={0.05} onChange={(v) => setMix({ ...mix, [k]: v })} fmt={(v) => fmt(v, 2) + '×'} />
      ))}
      <Slider label="Jala-jala 60 Hz" value={hum} min={0} max={0.3} step={0.01} onChange={setHum} fmt={(v) => fmt(v, 2) + ' mV'} />
      <h4 className="ctl-group">Desain filter FIR</h4>
      <Choice label="Jenis" value={type} onChange={(t) => {
        setType(t)
        if (t === 'bandstop') { setF1(55); setF2(65); setTaps(Math.max(taps, 181)) } else if (t === 'lowpass') setF2(40)
        else { setF1(0.7); setF2(40) }
      }}options={(Object.keys(FIR_LABEL) as FirType[]).map((v) => ({ value: v, label: FIR_LABEL[v] }))} />
      {type !== 'lowpass' && <Slider label={isBand ? 'Tepi bawah f₁' : 'Frekuensi potong'} value={f1} min={type === 'bandstop' ? 40 : 0.1} max={type === 'bandstop' ? 70 : 10} step={0.1} onChange={setF1} fmt={(v) => fmt(v, 1) + ' Hz'} />}
      {type !== 'highpass' && <Slider label={isBand ? 'Tepi atas f₂' : 'Frekuensi potong'} value={f2} min={type === 'bandstop' ? 50 : 15} max={type === 'bandstop' ? 80 : 150} step={0.5} onChange={setF2} fmt={(v) => fmt(v, 1) + ' Hz'} />}
      <Slider label="Panjang filter N (tap)" value={taps} min={11} max={801} step={2} onChange={setTaps} fmt={(v) => `${v} tap`} hint={taps > 121 ? 'Diagram pole-zero tampil untuk N ≤ 121' : undefined} />
      <Choice label="Jendela" value={win} onChange={setWin} options={(Object.keys(WINDOW_LABEL) as WindowName[]).map((v) => ({ value: v, label: WINDOW_LABEL[v] }))} />
      <Toggle label="Mode real-time (kausal)" checked={causal} onChange={setCausal} hint="Keluaran tertunda (N−1)/2 sampel. Matikan untuk analisis offline fase-nol." />
      <Formula>y[n] = Σ<sub>k=0</sub><sup>N−1</sup> h[k]·x[n−k]<br />H(z) = Σ h[k]·z<sup>−k</sup></Formula>
    </>}>
      <div className="reads">
        <Read value={r ? fmt(r.snrIn, 1) + ' dB' : '…'} label="SNR masuk" tone="red" />
        <Read value={r ? fmt(r.snrOut, 1) + ' dB' : '…'} label="SNR keluar" tone="teal" />
        <Read value={fmt(delayMs, 0) + ' ms'} label={`tunda grup ((N−1)/2 = ${(taps - 1) / 2} sampel)`} tone={causal ? 'red' : 'ink'} />
        <Read value={(taps * FS).toLocaleString('id-ID')} label="perkalian per detik" />
      </div>
      <Figure title={causal ? 'Kausal: keluaran bergeser ke kanan sebesar tunda grup' : 'Fase-nol: tunda dikompensasi, puncak R tetap di tempat'}
        note={<Legend items={[{ color: C.ink3, label: 'ECG + noise' }, { color: C.cobalt, label: 'hasil filter' }, { color: C.red, label: 'ECG bersih', dash: true }]} />}>
        <Plot ariaLabel="Sinyal ECG bernoise dan hasil filter" height={270} grid="paper" x={[0, show]} y={r ? yRange([r.clean.subarray(FS, FS + nShow), r.out.subarray(FS, FS + nShow)], 0.15) : [-2, 2]} xLabel="detik" xTicks="auto" yFmt={(v) => fmt(v, 0)} yLabel="mV"
          layers={r ? [
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.noisy.subarray(FS, FS + nShow), color: C.ink3, width: 1 },
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.clean.subarray(FS, FS + nShow), color: C.red, width: 1, dash: [4, 3] },
            { kind: 'line', x0: 0, dx: 1 / FS, ys: r.out.subarray(FS, FS + nShow), color: C.cobalt, width: 1.7 },
          ] : []} />
      </Figure>
      <div className="trio">
        <Figure title="Respons magnitudo |H(e^jω)|" note={<button type="button" className="mini" onClick={() => setZoomLow(!zoomLow)}>{zoomLow ? 'Lihat 0–180 Hz' : 'Perbesar 0–10 Hz'}</button>}>
          <Plot ariaLabel="Respons frekuensi filter" height={190} grid="plain" x={[0, zoomLow ? 10 : 180]} y={[-90, 5]} xLabel="Hz" xTicks={zoomLow ? [0, 2, 4, 6, 8, 10] : [0, 30, 60, 90, 120, 150, 180]} yFmt={(v) => v.toFixed(0)} yLabel="dB"
            layers={[
              { kind: 'rect', x0: 0, x1: 0.7, color: 'rgba(199,119,0,.14)' },
              { kind: 'rect', x0: 59, x1: 61, color: 'rgba(211,33,63,.18)' },
              { kind: 'rect', x0: 40, x1: 180, y0: -90, y1: 5, color: 'rgba(91,96,124,.05)' },
              { kind: 'line', xs: zoomLow ? lowResp.freq : resp.freq, ys: (zoomLow ? lowResp : resp).mag.map((m) => 20 * Math.log10(m + 1e-9)), color: C.cobalt, width: 1.6 },
            ]} />
        </Figure>
        <Figure title="Respons impuls h[n]" note={`${taps} koefisien, simetris`}>
          <Plot ariaLabel="Respons impuls filter FIR" height={190} grid="plain" x={[0, taps - 1]} y={[Math.min(...h) * 1.15, Math.max(...h) * 1.15]} xLabel="n" xTicks="auto"
            layers={[taps <= 151 ? { kind: 'stem', x0: 0, dx: 1, ys: h, color: C.ink, r: 1.6 } : { kind: 'line', x0: 0, dx: 1, ys: h, color: C.ink }]} />
        </Figure>
        <Figure title="Bidang-z" note={zeros ? `${zeros.length} zero, pole di z = 0` : 'perkecil N untuk melihat'}>
          {zeros ? (
            <Plot ariaLabel="Diagram pole-zero filter FIR" square grid="plain" x={[-1.6, 1.6]} y={[-1.6, 1.6]} xTicks={[-1, 0, 1]} yTicks={[-1, 0, 1]} yFmt={(v) => v.toFixed(0)}
              layers={[
                { kind: 'circle', cx: 0, cy: 0, r: 1, color: C.ink3, dash: [3, 3] },
                { kind: 'points', xs: zeros.map((z) => z[0]), ys: zeros.map((z) => z[1]), marker: 'ring', color: C.cobalt, r: 3.2 },
                { kind: 'points', xs: [0], ys: [0], marker: 'cross', color: C.red, r: 5 },
                { kind: 'text', x: 0.12, y: 0.12, text: `×${taps - 1}`, color: C.red, align: 'left' },
              ]} />
          ) : <div className="pz-empty">Akar polinom orde {taps - 1} terlalu banyak untuk digambar dengan jelas.</div>}
        </Figure>
      </div>
      <p className="lesson">FIR tidak punya pole selain di z = 0, jadi <b>selalu stabil</b>. Harganya: pita transisi yang tajam di 0,5 Hz butuh ratusan tap, dan tiap tap menambah tunda {fmt(1000 / FS / 2, 2)} ms. Itu sebabnya monitor real-time memisahkan high-pass (moving average) dari low-pass.</p>
    </Bench>
  )
}
