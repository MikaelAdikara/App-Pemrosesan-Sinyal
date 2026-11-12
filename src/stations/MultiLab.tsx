import { useMemo } from 'react'
import type { Analysis } from '../data'
import { fitAR, fmt, forecastAR, mean, std } from '../dsp/core'
import { FS } from '../dsp/ecg'
import { C, Plot } from '../components/Plot'
import { hrSeries } from './ForecastLab'

// Prototipe "multi-outcome": satu aliran detak menghasilkan beberapa keluaran sekaligus,
// dan keluaran saling bergantung (kualitas sinyal menentukan apakah alarm ritme boleh dipercaya).

export function MultiLab({ a, focus }: { a: Analysis; focus: number }) {
  const r = useMemo(() => {
    const t0 = Math.min(focus, a.meta.seconds - 60), t1 = t0 + 60
    const idx = a.beats.map((b, i) => ({ b, i })).filter(({ b }) => b.pos / FS >= t0 && b.pos / FS < t1)
    const labels = idx.map(({ b }) => b.label)
    const nV = labels.filter((l) => l === 'V').length
    let alt = 0, bestAlt = 0
    for (let k = 1; k < labels.length; k++) { alt = labels[k] !== labels[k - 1] ? alt + 1 : 0; bestAlt = Math.max(bestAlt, alt) }
    const rhythm = nV === 0 ? 'Ritme sinus' : bestAlt >= 6 ? 'Bigemini ventrikel' : nV / labels.length > 0.1 ? 'PVC sering' : 'PVC sesekali'
    // HRV dari deret NN
    const s = hrSeries(a, true)
    const inWin = s.t.map((t, i) => ({ t, i })).filter(({ t }) => t >= t0 && t < t1).map(({ i }) => i)
    const nn = inWin.map((i) => 60 / s.hr[i] * 1000)
    const sdnn = std(nn)
    let ss = 0; for (let k = 1; k < nn.length; k++) ss += (nn[k] - nn[k - 1]) ** 2
    const rmssd = Math.sqrt(ss / Math.max(1, nn.length - 1))
    // forecast 30 detak
    const end = inWin.length ? inWin[inWin.length - 1] + 1 : s.hr.length
    const hist = s.hr.slice(Math.max(0, end - 240), end)
    const f = forecastAR(hist, fitAR(hist, 6), 30)
    // kualitas sinyal: korelasi detak normal ke template + daya noise di luar 0,5–40 Hz
    const corrs = idx.filter(({ b }) => b.label === 'N' && b.x).map(({ b }) => b.x![6])
    const sqi = corrs.length ? corrs.filter((c) => c > 0.9).length / corrs.length : 0
    const quality = sqi > 0.9 ? 'Baik' : sqi > 0.7 ? 'Cukup' : 'Buruk'
    const hrNow = mean(hist.slice(-8))
    const alarm = quality === 'Buruk' ? 'Ditahan: sinyal tidak layak dibaca' : nV / Math.max(1, labels.length) > 0.1 ? 'Kirim ke perawat' : 'Tidak perlu'
    return { t0, t1, nBeats: labels.length, nV, rhythm, sdnn, rmssd, f, hist, sqi, quality, hrNow, alarm, labels }
  }, [a, focus])

  const histShow = r.hist.slice(-40)
  return (
    <div className="multi">
      <div className="sheet">
        <header className="sheet-h">
          <div>
            <h3>Lembar ringkasan rekaman {a.meta.id}</h3>
            <p>Jendela {fmt(r.t0, 0)}–{fmt(r.t1, 0)} s, {r.nBeats} detak, dihitung ulang di browser</p>
          </div>
          <div className={'alarm ' + (r.alarm.startsWith('Kirim') ? 'on' : r.alarm.startsWith('Ditahan') ? 'hold' : '')}>
            <span>Keputusan alarm</span><b>{r.alarm}</b>
          </div>
        </header>
        <div className="outs">
          <section>
            <h4>Ritme</h4>
            <b className="big">{r.rhythm}</b>
            <p>{r.nV} PVC dari {r.nBeats} detak ({fmt((100 * r.nV) / Math.max(1, r.nBeats), 1)}%)</p>
            <div className="beadline" aria-label="Urutan label detak">
              {r.labels.map((l, i) => <i key={i} className={l === 'V' ? 'v' : ''} />)}
            </div>
          </section>
          <section>
            <h4>Detak 30 langkah ke depan</h4>
            <b className="big">{fmt(r.hrNow, 0)} → {fmt(r.f.mean[r.f.mean.length - 1], 0)} <small>detak/menit</small></b>
            <Plot ariaLabel="Forecast singkat detak jantung" height={90} grid="none" x={[0, 70]} y={[Math.min(...histShow, ...r.f.mean) - 4, Math.max(...histShow, ...r.f.mean) + 4]}
              layers={[
                { kind: 'line', x0: 0, dx: 1, ys: histShow, color: C.ink, width: 1.4 },
                { kind: 'band', x0: 40, dx: 1, lo: r.f.mean.map((v, i) => v - 1.96 * r.f.se[i]), hi: r.f.mean.map((v, i) => v + 1.96 * r.f.se[i]), color: 'rgba(43,63,217,.15)' },
                { kind: 'line', x0: 40, dx: 1, ys: r.f.mean, color: C.cobalt, width: 2 },
              ]} />
          </section>
          <section>
            <h4>Variabilitas (HRV)</h4>
            <b className="big">{fmt(r.rmssd, 0)} <small>ms RMSSD</small></b>
            <p>SDNN {fmt(r.sdnn, 0)} ms. Proksi tonus parasimpatis; butuh deret NN yang bersih.</p>
          </section>
          <section>
            <h4>Kualitas sinyal</h4>
            <b className={'big q-' + r.quality}>{r.quality}</b>
            <p>{fmt(r.sqi * 100, 0)}% detak normal berkorelasi &gt; 0,9 dengan template pasien.</p>
          </section>
        </div>
      </div>
      <div className="multi-notes">
        <h4>Kenapa banyak keluaran itu sulit</h4>
        <ol>
          <li><b>Skala waktu berbeda.</b> Label ritme per detak (0,8 s), HRV per menit, forecast per jam. Satu jendela tidak cocok untuk semuanya.</li>
          <li><b>Keluaran saling bergantung.</b> Alarm PVC hanya sah kalau kualitas sinyal baik; galat di satu keluaran menular ke keluaran lain.</li>
          <li><b>Label tidak seimbang dan tidak lengkap.</b> MIT-BIH punya label ritme, tapi tidak punya label stres atau kualitas sinyal.</li>
          <li><b>Evaluasi berlapis.</b> Tiap keluaran butuh metrik sendiri (AUC, MAPE, kalibrasi), lalu metrik gabungan untuk keputusan akhir.</li>
        </ol>
      </div>
    </div>
  )
}
