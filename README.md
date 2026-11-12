# Detak: lab sinyal jantung

Web app interaktif untuk tugas **Pemrosesan Sinyal (MAD62129)**, Sains Data FSTeM Universitas Brawijaya 2026/2027.
Seluruh rantai pemrosesan sinyal ECG berjalan di browser, di atas rekaman nyata **MIT-BIH Arrhythmia Database**.

| Stasiun | Konsep | Yang bisa dicoba |
|---|---|---|
| 1. Sensor & ADC | sampling, Nyquist, aliasing, kuantisasi uniform/μ-law, PCM vs DPCM | fs 30–360 Hz, 2–12 bit, rentang ADC, filter anti-aliasing |
| 2. Filter FIR | desain metode jendela, respons frekuensi, pole-zero, tunda grup | noise nyata NSTDB, jenis filter, jumlah tap, jendela, mode kausal |
| 3. Transformasi Fourier | FFT, resolusi Δf = fs/N, sintesis ulang, spektrogram STFT | panjang segmen, jendela, jumlah komponen |
| 4. Geser waktu | z⁻ᵏ, autokorelasi, plot Poincaré, penyelarasan detak | geseran k, jitter, jumlah detak dirata-ratakan |
| 5. Deteksi & klasifikasi | Pan-Tompkins, 9 fitur per detak, MLP di browser | ambang probabilitas, klik detak untuk melihat fitur |
| 6. Forecasting | AR(p) Yule-Walker, interval prediksi, pole di bidang-z | orde, data latih, horizon, pembersihan ektopik (NN) |
| 7. Banyak keluaran | ritme + forecast + HRV + kualitas sinyal sekaligus | prototipe gagasan multi-outcome |
| Ukur nadimu | kamera sebagai ADC (PPG), resampling, FIR, FFT | jari + flash, wajah (webcam), demo sintetis |

Integrasi browser yang dipakai: `requestVideoFrameCallback` (timestamp per frame kamera), kontrol flash `torch`
lewat MediaStream, Screen Wake Lock, Web Audio (bunyi detak), Vibration API, dan inferensi MLP langsung di klien
(tanpa server, ±5 µs per detak).

## Menjalankan

```bash
npm install
npm run dev
```

Build produksi: `npm run build` (output `dist/`). Di Vercel cukup import repo ini; framework Vite terdeteksi otomatis.

## Data & model

`public/data/` dibuat oleh `scripts/prepare_data.py` dari MIT-BIH (24 rekaman) dan MIT-BIH Noise Stress Test DB:

```bash
python scripts/prepare_data.py <folder berisi mitdb/ dan nstdb/>
npx tsx scripts/parity.ts   # uji: fitur & probabilitas TypeScript == Python
```

- 6 rekaman × 10 menit, disimpan sebagai kode ADC asli 11-bit (Int16), plus anotasi kardiolog.
- MLP 9-16-1 dilatih pada 59.419 detak; validasi lintas pasien (GroupKFold per rekaman): AUC 0,992, sensitivitas PVC 95,2%.

Sumber data: Moody & Mark (2001), Moody et al. (1984), Goldberger et al. (2000) PhysioNet.

Mikael Alexander Adikara Purnama, 245091101111005.
