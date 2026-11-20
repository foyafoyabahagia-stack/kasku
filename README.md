# KasKu

Aplikasi keuangan pribadi profesional yang berjalan **hanya di GitHub + Netlify** — tanpa server, tanpa database eksternal, tanpa biaya bulanan.

- Dashboard web: ringkasan saldo, arus kas harian/bulanan, kategori pengeluaran, tabel transaksi.
- Bot Telegram: catat transaksi cukup lewat chat, laporan bulanan/tahunan dalam sekejap.
- Penyimpanan: Netlify Blobs (built-in). Login dashboard dilindungi kata sandi.

---

## Daftar fitur (v1)

**Pencatatan**
- `/masuk`, `/keluar` dari Telegram dengan nominal fleksibel (`35000`, `35rb`, `1,5jt`)
- Kategori otomatis dari keterangan, atau manual dengan `#Kategori`
- Tanggal per transaksi (hari, bulan, tahun) + override tanggal dari chat
- `/undo` dan tombol hapus pada balasan bot
- Tambah, ubah, hapus transaksi dari dashboard

**Periode bulan & tahun**
- Pemilih Bulan + Tahun terpisah, opsi "Rekap setahun"
- Tombol cepat: Bulan ini, Bulan lalu, Tahun ini
- Rekap tahunan 12 bulan (grafik + laporan bot)

**Analisis**
- Saldo total, pemasukan, pengeluaran, selisih per periode
- Perbandingan dengan periode sebelumnya
- Grafik arus kas harian (bulanan pada mode tahun)
- Donat kategori pengeluaran + persentase

**Pencarian & ekspor**
- Cari kata kunci, filter tipe & kategori, dibatasi periode terpilih
- Export CSV per bulan (`kasku-2026-11.csv`) atau per tahun
- Pagination "muat lebih banyak"

**Lainnya**
- Login kata sandi, cookie sesi HMAC (tanpa database sesi)
- Rate limit percobaan login
- Webhook Telegram diverifikasi dengan secret token + deduplikasi update
- Responsive mobile, mode gelap, tanpa framework dan tanpa build step

---

## Arsitektur

```
Telegram ──webhook──▶ /telegram  ─┐
                                  ├─▶ Netlify Functions (Node 20)
Browser ────/api/*───────────────┘        │
                                          ▼
                                   Netlify Blobs
                                   tx/2026-11 (JSON)
```

| Bagian | Teknologi |
| --- | --- |
| Hosting & CDN | Netlify |
| Backend | Netlify Functions (ESM, Web API Request/Response) |
| Data | Netlify Blobs, satu blob per bulan |
| Frontend | HTML + CSS + JavaScript murni (tanpa dependency) |
| Sumber kode | GitHub → auto deploy Netlify |

---

## Struktur folder

```
kasku/
├─ netlify.toml                  # redirect API, webhook, header keamanan
├─ package.json                  # dependensi: @netlify/blobs
├─ public/
│  ├─ index.html                 # dashboard + modal + halaman login
│  ├─ styles.css                 # tema terang/gelap, responsif
│  ├─ app.js                     # render, grafik SVG, form
│  └─ icon.svg
├─ netlify/functions/
│  ├─ api.mjs                    # REST: auth, summary, transaksi, export
│  ├─ telegram.mjs               # webhook bot
│  ├─ setup.mjs                  # daftar webhook sekali jalan
│  └─ lib/                       # logika bersama (murni, mudah diuji)
│     ├─ amount.mjs  dates.mjs  categories.mjs  analytics.mjs
│     ├─ store.mjs   auth.mjs   report.mjs      telegram-api.mjs
│     └─ entry.mjs
└─ test/smoke.mjs                # 59 pemeriksaan logika tanpa dependensi
```

---

## Setup (sekali saja)

### 1. Buat bot Telegram

1. Buka [@BotFather](https://t.me/BotFather) → `/newbot` → ikuti instruksi.
2. Simpan **token** (format `123456:ABC-DEF...`). Jangan bagikan.
3. Opsional: `/setcommands` untuk memasang daftar perintah.

### 2. Unggah kode ke GitHub

```bash
cd kasku
git init
git add .
git commit -m "KasKu: aplikasi keuangan dengan bot Telegram"
git branch -M main
git remote add origin https://github.com/USERNAME/kasku.git
git push -u origin main
```

### 3. Hubungkan ke Netlify

1. Netlify → **Add new site** → **Import an existing project** → pilih repo GitHub.
2. Build command dan publish directory **sudah diatur** di `netlify.toml`
   (publish: `public`, command: tanpa build). Klik **Deploy**.

### 4. Isi environment variables

Netlify → **Site configuration → Environment variables** → tambah satu per satu,
lalu **Deploy → Trigger deploy**.

| Variabel | Wajib | Isi |
| --- | --- | --- |
| `APP_PASSWORD` | ya | Kata sandi dashboard (gunakan yang kuat) |
| `SESSION_SECRET` | disarankan | String acak panjang, mis. hasil `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | ya | Token dari BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | disarankan | String acak `A-Z a-z 0-9 _ -` untuk memvalidasi webhook |
| `TELEGRAM_ALLOWED_CHAT_ID` | disarankan | Chat ID kamu; pisahkan koma bila lebih dari satu |
| `SETUP_TOKEN` | ya (untuk setup) | Token rahasia untuk membuka `/setup` |
| `TZ` | disarankan | `Asia/Jakarta` (menentukan "hari ini") |

Cara cepat membuat secret:

```bash
openssl rand -hex 32
```

### 5. Daftarkan webhook

Buka:

```
https://SITUS-ANDA.netlify.app/setup?token=SETUP_TOKEN_KAMU
```

Halaman akan menampilkan URL webhook dan status dari Telegram.
Untuk memeriksa ulang: tambahkan `&action=info`. Untuk melepas: `&action=delete`.

### 6. Kunci bot ke akunmu

1. Kirim `/start` ke bot — balasan menampilkan **Chat ID** kamu.
2. Salin nilai itu ke `TELEGRAM_ALLOWED_CHAT_ID` di Netlify, lalu deploy ulang.
3. Uji: `/keluar 25000 kopi`.

### 7. Masuk dashboard

Buka `https://SITUS-ANDA.netlify.app` → masukkan `APP_PASSWORD`.

> Semua data disimpan di Netlify Blobs milik situs ini. Tidak ada layanan pihak ketiga lain.

---

## Perintah bot

| Perintah | Contoh | Keterangan |
| --- | --- | --- |
| `/keluar` | `/keluar 35000 makan siang` | Catat pengeluaran |
| `/masuk` | `/masuk 8500000 gaji november` | Catat pemasukan |
| Tanggal | `/keluar 35rb kopi 18/11` | Tanggal opsional: `18/11`, `18-11-2026`, `2026-11-18` |
| Kategori | `/keluar 5000 parkir #Transport` | Timpa kategori otomatis |
| `/saldo` | `/saldo` | Saldo total + ringkasan bulan ini |
| `/laporan` | `/laporan` | Bulan berjalan |
| `/laporan 10` | `/laporan 10` | Oktober tahun ini |
| `/laporan 10 2026` | `/laporan 10 2026` | Oktober 2026 |
| `/laporan 2026` | `/laporan 2026` | Rekap 12 bulan |
| `/tahun` | `/tahun` | Rekap tahun berjalan |
| `/undo` | `/undo` | Batalkan transaksi terakhir |
| `/kategori` | `/kategori` | Daftar kategori |
| `/help` | `/help` | Bantuan |

Nominal menerima `35000`, `35.000`, `35rb`, `35k`, `1,5jt`, `2 juta`, `Rp 35.000`.

---

## Pengembangan lokal

```bash
npm install
npm test              # 59 pemeriksaan logika (tanpa dependensi)
npx netlify-cli dev   # dashboard + function + Blobs lokal
```

Saat `netlify dev` berjalan, buat `.env` dari `.env.example` (jangan di-commit).
Jika Blobs lokal tidak tersedia di mesinmu, uji lewat **Deploy Preview**.

Pengujian logika mencakup parsing nominal/tanggal, penebakan kategori,
perhitungan laporan, input bot, dan format pesan.

---

## Keamanan

- Dashboard dilindungi kata sandi (`APP_PASSWORD`); cookie `HttpOnly`, `Secure`, `SameSite=Lax`, HMAC-SHA256, berlaku 12 jam.
- Pembatasan 8 percobaan login per 10 menit per IP.
- Webhook Telegram menolak request tanpa header `X-Telegram-Bot-Api-Secret-Token` yang cocok.
- Bot hanya melayani chat ID di `TELEGRAM_ALLOWED_CHAT_ID`.
- Update Telegram dideduplikasi agar retry tidak membuat transaksi ganda.
- Endpoint `/setup` mensyaratkan `SETUP_TOKEN`.

Catatan: `SETUP_TOKEN` sebaiknya dikosongkan setelah webhook terpasang.

---

## Batasan & biaya

- Netlify Blobs free tier jauh lebih dari cukup untuk pemakaian pribadi
  (ribuan transaksi per bulan tetap kecil).
- Ringkasan "Saldo total" membaca seluruh bulan yang ada. Untuk belasan tahun data
  masih cepat; jika suatu saat sangat besar, tambahkan ringkasan agregat per tahun.
- Satu sumber data per situs (satu pengguna). Multi-user ada di roadmap.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| Bot diam saja | Cek `TELEGRAM_BOT_TOKEN`, lalu buka `/setup?token=...&action=info`. Pastikan `url` terisi. |
| "Bot ini privat" | Chat ID belum masuk `TELEGRAM_ALLOWED_CHAT_ID`; kirim `/start` untuk melihat ID. |
| Balasan "Terjadi kesalahan di server" | Buka **Netlify → Functions → api → Logs** untuk melihat stack trace. |
| Login selalu kembali ke halaman masuk | `SESSION_SECRET`/`APP_PASSWORD` kosong atau berubah setelah deploy. |
| Dashboard kosong padahal bot jalan | Pastikan `TZ` benar; transaksi tersimpan di bulan sesuai tanggalnya. |
| Webhook 403 | `TELEGRAM_WEBHOOK_SECRET` di Netlify berbeda dengan yang dipakai saat `setWebhook`; jalankan `/setup` lagi setelah mengubahnya. |

---

## Roadmap

P1: multi-dompet, budget per kategori + notifikasi, transaksi berulang (scheduled function),
laporan bulanan otomatis ke Telegram, import CSV, kategori custom, audit log.

P2: multi-user, target tabungan, hutang/piutang, OCR struk, voice note, PWA, backup otomatis.

---

## Lisensi

MIT — lihat `LICENSE`.
