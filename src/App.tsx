import { useCallback, useEffect, useRef, useState } from 'react'
import { loadManifest, loadRecord, type Analysis, type Manifest } from './data'
import { FS } from './dsp/ecg'
import { fmt } from './dsp/core'
import { Monitor } from './components/Monitor'
import { AdcLab } from './stations/AdcLab'
import { FilterLab } from './stations/FilterLab'
import { FourierLab } from './stations/FourierLab'
import { ShiftLab } from './stations/ShiftLab'
import { DetectLab } from './stations/DetectLab'
import { ForecastLab } from './stations/ForecastLab'
import { MultiLab } from './stations/MultiLab'
import { PulseCam } from './stations/PulseCam'

const STATIONS = [
  { id: 'adc', name: 'Sensor & ADC', lead: 'Elektroda menangkap tegangan analog x(t). ADC mengambil sampel tiap Tₛ detik dan membulatkannya ke 2ᵇ level. Ubah fs dan jumlah bit, lalu lihat apa yang hilang.', C: AdcLab },
  { id: 'filter', name: 'Filter FIR', lead: 'Noise nyata dari MIT-BIH Noise Stress Test ditambahkan ke ECG bersih. Rancang filter FIR dengan metode jendela dan ukur kenaikan SNR serta harga tundanya.', C: FilterLab },
  { id: 'fourier', name: 'Transformasi Fourier', lead: 'FFT memecah sinyal menjadi sinusoid. Ritme jantung muncul sebagai sisir harmonik, dan sinyal bisa disusun ulang dari sedikit komponen.', C: FourierLab },
  { id: 'shift', name: 'Geser waktu', lead: 'Operator z⁻ᵏ menggeser sinyal sebanyak k sampel. Dari situ lahir autokorelasi, plot Poincaré, dan penyelarasan detak.', C: ShiftLab },
  { id: 'detect', name: 'Deteksi & klasifikasi', lead: 'Pan-Tompkins menemukan setiap puncak R dengan rantai filter LTI. Sembilan fitur per detak masuk ke MLP kecil yang berjalan di browser untuk mengenali PVC.', C: DetectLab },
  { id: 'forecast', name: 'Forecasting', lead: 'Deret detak jantung diperlakukan sebagai sinyal dan diprediksi dengan model AR(p), yaitu filter IIR yang pole-nya bisa dibaca di bidang-z.', C: ForecastLab },
  { id: 'multi', name: 'Banyak keluaran', lead: 'Satu aliran detak, empat keluaran sekaligus: ritme, forecast, HRV, dan kualitas sinyal. Prototipe untuk pertanyaan pengembangan berikutnya.', C: MultiLab },
] as const
type StationId = typeof STATIONS[number]['id']

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function readUrl() {
  const q = new URLSearchParams(location.search)
  const h = location.hash.replace('#', '')
  return {
    rec: q.get('rec') ?? '119',
    t: Number(q.get('t') ?? 30),
    station: (STATIONS.some((s) => s.id === h) ? h : 'adc') as StationId,
    cam: h === 'kamera',
    paused: q.has('pause'),
  }
}

export default function App() {
  const init = useRef(readUrl()).current
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [recId, setRecId] = useState(init.rec)
  const [a, setA] = useState<Analysis | null>(null)
  const [playing, setPlaying] = useState(!init.paused)
  const [speed, setSpeed] = useState(1)
  const [sound, setSound] = useState(false)
  const [now, setNow] = useState(init.t)
  const [focus, setFocus] = useState(init.t)
  const [station, setStation] = useState<StationId>(init.station)
  const [cam, setCam] = useState(init.cam)
  const [flash, setFlash] = useState<'N' | 'V' | null>(null)
  const timeRef = useRef(init.t)

  useEffect(() => { loadManifest().then(setManifest) }, [])
  useEffect(() => {
    let live = true; setA(null)
    loadRecord(recId).then((r) => { if (live) setA(r) })
    return () => { live = false }
  }, [recId])
  useEffect(() => {
    const on = () => { const u = readUrl(); setCam(u.cam); if (!u.cam) setStation(u.station) }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on)
  }, [])

  const go = (id: StationId) => { setStation(id); setCam(false); history.replaceState(null, '', '#' + id) }
  const togglePlay = () => { if (playing) setFocus(Math.floor(timeRef.current)); setPlaying(!playing) }
  const scrub = (t: number) => { timeRef.current = t; setNow(t); setFocus(Math.floor(t)) }
  const onBeat = useCallback((l: 'N' | 'V') => { setFlash(l); setTimeout(() => setFlash(null), 180) }, [])

  const beatsBefore = a ? a.beats.filter((b) => b.pos / FS <= now) : []
  const last = beatsBefore.slice(-9)
  const hr = last.length > 2 ? (60 * (last.length - 1)) / ((last[last.length - 1].pos - last[0].pos) / FS) : NaN
  const nV = beatsBefore.filter((b) => b.label === 'V').length
  const st = STATIONS.find((s) => s.id === station)!
  const recInfo = manifest?.records.find((r) => r.id === recId)

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setCam(false) }}>
          <svg viewBox="0 0 40 24" aria-hidden><path d="M1 14h9l3-6 4 14 5-21 4 13h13" /></svg>
          <span>Detak</span>
        </a>
        <p className="tag">Laboratorium sinyal jantung untuk mata kuliah Pemrosesan Sinyal, dibangun di atas rekaman nyata MIT-BIH.</p>
        <nav className="modes" aria-label="Mode">
          <button type="button" className={!cam ? 'on' : ''} onClick={() => { setCam(false); history.replaceState(null, '', '#' + station) }}>Lab sinyal</button>
          <button type="button" className={cam ? 'on' : ''} onClick={() => { setCam(true); setPlaying(false); history.replaceState(null, '', '#kamera') }}>Ukur nadimu</button>
        </nav>
      </header>

      {cam ? <main className="wrap"><PulseCam /></main> : (
        <main>
          <section className="hero" aria-label="Monitor EKG">
            <div className="tabs" role="tablist" aria-label="Pilih rekaman pasien">
              {manifest?.records.map((r) => (
                <button key={r.id} role="tab" aria-selected={r.id === recId} className={r.id === recId ? 'on' : ''} onClick={() => setRecId(r.id)}>
                  <b>{r.id}</b><span>{r.title}</span>
                </button>
              ))}
            </div>
            <div className="hero-body">
              <div className="scope">
                {a ? <Monitor a={a} playing={playing} speed={speed} timeRef={timeRef} sound={sound} onTick={setNow} onBeat={onBeat} /> : <div className="monitor loading">Memuat rekaman {recId} dan menjalankan detektor…</div>}
              </div>
              <aside className={'vitals' + (flash === 'V' ? ' flash-v' : flash ? ' flash-n' : '')}>
                <div className="hr">
                  <span className="hr-v">{Number.isFinite(hr) ? Math.round(hr) : '––'}</span>
                  <span className="hr-u">detak per menit</span>
                </div>
                <dl>
                  <div><dt>PVC terdeteksi</dt><dd className={nV ? 'red' : ''}>{nV}</dd></div>
                  <div><dt>Detak ke-</dt><dd>{beatsBefore.length}</dd></div>
                  <div><dt>Lead</dt><dd>{a?.meta.lead ?? '–'}</dd></div>
                  <div><dt>ADC</dt><dd>11 bit, 360 Hz</dd></div>
                </dl>
                <p className="rec-desc">{recInfo?.desc}</p>
              </aside>
            </div>
            <div className="transport">
              <button type="button" className="play" onClick={togglePlay} aria-label={playing ? 'Jeda' : 'Putar'}>
                {playing ? <svg viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg>
                  : <svg viewBox="0 0 16 16" aria-hidden><path d="M4 2l10 6-10 6z" /></svg>}
              </button>
              <span className="time">{mmss(now)}<small> / {mmss(a?.meta.seconds ?? 600)}</small></span>
              <input className="scrub" type="range" min={0} max={(a?.meta.seconds ?? 600) - 1} step={1} value={Math.floor(now)} aria-label="Posisi rekaman"
                style={{ '--pct': (now / (a?.meta.seconds ?? 600)) * 100 + '%' } as React.CSSProperties}
                onChange={(e) => scrub(Number(e.target.value))} />
              <div className="speed" role="radiogroup" aria-label="Kecepatan">
                {[1, 2, 4].map((s) => <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
              </div>
              <label className="snd"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Bunyi detak</label>
            </div>
          </section>

          <nav className="chain" aria-label="Rantai pemrosesan sinyal">
            <ol>
              {STATIONS.map((s, i) => (
                <li key={s.id}>
                  <button type="button" className={s.id === station ? 'on' : ''} aria-current={s.id === station ? 'step' : undefined} onClick={() => go(s.id)}>
                    <span className="n">{i + 1}</span>{s.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <section className="wrap station" aria-labelledby="st-title">
            <div className="st-head">
              <h2 id="st-title">{st.name}</h2>
              <p>{st.lead}</p>
              <p className="seg-info">Rekaman {recId}, mulai detik {fmt(focus, 0)}. Jeda monitor atau geser posisi untuk menganalisis bagian lain.</p>
            </div>
            {a ? <st.C a={a} focus={Math.min(focus, (a.meta.seconds) - 62)} /> : <p className="loading-t">Menyiapkan analisis…</p>}
          </section>
        </main>
      )}

      <footer className="foot wrap">
        <p>Data: MIT-BIH Arrhythmia Database dan MIT-BIH Noise Stress Test Database (Moody &amp; Mark 2001; Goldberger et al. 2000, PhysioNet). Semua pemrosesan sinyal berjalan di browser.</p>
        <p>Tugas Pemrosesan Sinyal MAD62129, Sains Data FSTeM Universitas Brawijaya 2026/2027. Mikael Alexander Adikara Purnama, 245091101111005.</p>
      </footer>
    </div>
  )
}
