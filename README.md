# GlympFoto — Private Photo Sharing Server untuk Android / Termux

Server foto privat yang berjalan **100% di HP Android via Termux**, tanpa VPS, R2, Supabase, Postgres, atau layanan berbayar. Upload → atur aturan → generate link → share → recipient buka → countdown server-side → foto kedaluwarsa → semua akses tercatat.

Mobile-first, premium minimal, bukan AI-slop.

**Setup baru (minimal):** tanpa Cloudflare, tanpa Termux:Boot, tanpa Termux:API. Satu-satunya akses publik adalah **Tailscale Funnel**. Storage default **internal** (`./storage`) agar pindah HP semudah mungkin.

---

## Daftar Isi

1. [Yang kamu butuhkan](#1-yang-kamu-butuhkan)
2. [Install baru di Termux](#2-install-baru-di-termux)
3. [Cara pakai harian](#3-cara-pakai-harian)
4. [Pindah ke HP / Termux baru (Full migrate)](#4-pindah-ke-hp--termux-baru-full-migrate)
5. [Akses publik via Tailscale Funnel](#5-akses-publik-via-tailscale-funnel)
6. [Habis reboot HP](#6-habis-reboot-hp)
7. [Agar tidak dibunuh Android](#7-agar-tidak-dibunuh-android)
8. [Mode Guest](#8-mode-guest-teman-upload-tanpa-token)
9. [API ringkas](#9-api-ringkas)
10. [Troubleshooting](#10-troubleshooting-termux)
11. [Struktur project](#11-struktur-project)
12. [Yang TIDAK dipakai (sengaja)](#12-yang-tidak-dipakai-sengaja)
13. [Wrapper GitHub Pages](#13-wrapper-github-pages)

---

## 1. Yang kamu butuhkan

- HP Android + aplikasi **Termux** (install dari **F-Droid**, bukan Play Store — versi Play Store sudah kadaluarsa).
- Akun **Tailscale** (gratis) — untuk URL publik. Daftar di `https://login.tailscale.com` dari browser biasa.
- Koneksi internet saat install (untuk `pkg` + `npm install`).
- Waktu ±10 menit.

Tidak perlu: Cloudflare, domain sendiri, Termux:Boot, Termux:API, root.

---

## 2. Install baru di Termux

### Langkah 1 — Siapkan repo

Code + wrapper GitHub Pages hidup satu repo di `https://github.com/glympfoto/glympfoto.github.io` (branch `main`, lihat [bagian 13](#13-wrapper-github-pages)). Di Termux **baru**:

```bash
pkg update -y && pkg install -y git
git clone https://github.com/glympfoto/glympfoto.github.io ~/glympfoto
cd ~/glympfoto
```

> Repo ini publik — aman, karena secret (`.env`, database, foto) semuanya di-`.gitignore` dan tidak ikut push. Kalau `git clone`/`push` diminta password: pakai **Personal Access Token** GitHub (bukan password akun). Buat di GitHub → Settings → Developer settings → Personal access tokens → centang `repo`.

### Langkah 2 — Jalankan installer

```bash
bash scripts/install.sh
```

Installer melakukan ini, berurutan (aman di-run ulang):

1. `pkg install nodejs-lts python make clang pkg-config wget openssh` — Node 22+ dibutuhkan (project ini jalan di Node 26).
2. Cek `tailscale-cli` / `tailscale` ada. Kalau belum ada, installer berhenti dan memberi tahu cara install — install dulu, lalu ulangi perintah ini.
3. `npm install --no-audit`.
4. Buat `.env` dari `.env.example` (kalau belum ada) + generate `ADMIN_TOKEN` acak 64 hex otomatis. **Catat isi `.env` — ini password adminmu.**
5. `mkdir data storage/originals storage/tmp logs` + `npm run db:init` + `npm run build`.
6. Cek login Tailscale (`tailscale status`). Kalau belum login, ikuti perintah `tailscale up` yang ditampilkan.
7. `bash scripts/start-all.sh` — start server + watchdog + funnel.

### Langkah 3 — Verifikasi

```bash
bash scripts/status.sh
# harus: server pid RUN, watchdog pid RUN, local OK, publik OK
```

Buka di HP: `http://127.0.0.1:3000` → login pakai `ADMIN_TOKEN` (atau `ADMIN_PASSWORD` kalau kamu set). Lihat URL publik:

```bash
cat .tunnel-url
# => https://namahpmu.xxxxx.ts.net
```

Bagikan `https://namahpmu.xxxxx.ts.net/g` untuk guest, atau link `/v/<token>` untuk viewer. **Tamu tidak perlu install Tailscale** — URL funnel dibuka di browser biasa.

### Konfigurasi (`.env`)

| Key | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server lokal |
| `ADMIN_TOKEN` | *(digenerate)* | Token darurat + fallback password. Wajib diganti/pakai hasil generate |
| `ADMIN_PASSWORD` | *(kosong)* | Password login dashboard. Kalau kosong, pakai `ADMIN_TOKEN` |
| `DATA_DIR` | `./data` | Lokasi SQLite |
| `STORAGE_DIR` | `./storage` | Lokasi foto. Biarkan internal agar migrate mudah |
| `DB_PATH` | `./data/glympfoto.db` | File database |
| `MAX_UPLOAD_MB` | `15` | Batas upload |
| `AUDIT_RETENTION_DAYS` | `90` | Retensi log audit (`0` = selamanya) |
| `GUEST_UPLOAD` | `0` | `1` = nyalakan halaman guest `/g` |
| `PUBLIC_HOST` | *(kosong)* | Domain pembungkus yang boleh iframe viewer. Kosong = paling ketat |

Ganti password admin:

```bash
# di .env, tambah/ubah:
ADMIN_PASSWORD=kata-sandi-kuat-pilihanmu
# restart:
bash scripts/stop.sh && bash scripts/start-all.sh
```

---

## 3. Cara pakai harian

```bash
cd ~/glympfoto
bash scripts/start-all.sh   # start server + watchdog + funnel
bash scripts/status.sh      # cek server + funnel + health lokal & publik
bash scripts/stop.sh        # stop semuanya (funnel off, daemon tailscale tetap jalan)
npm run logs                # tail -f logs/server.log logs/funnel.log
cat .tunnel-url             # lihat URL publik saat ini
```

- Dashboard admin: `http://127.0.0.1:3000` (atau URL publik + `/`).
- Halaman guest (kalau `GUEST_UPLOAD=1`): `http://127.0.0.1:3000/g` (atau URL publik + `/g`).
- Semua script idempoten: `start-all.sh` otomatis stop yang lama, rebuild kalau `src/` berubah, dan rotasi log >2MB.

---

## 4. Pindah ke HP / Termux baru (Full migrate)

Strateginya: **code via GitHub, data via 1 file backup**. Yang pindah: `.env` + database + semua foto. Yang tidak pindah (dibangun ulang): `node_modules/`, `dist/`, `logs/`.

### Di HP LAMA — bikin backup

```bash
cd ~/glympfoto
./scripts/backup.sh
# => backup-glympfoto-YYYYMMDD-HHMMSS.tar.gz  (.env + DB + foto)
```

- Varian hemat (tanpa foto, config saja): `./scripts/backup.sh --fresh`.
- Sebelum diarsip, script checkpoint WAL SQLite dulu agar database konsisten, dan mengecualikan `*.shm/*.wal/*.bak*` + `storage/tmp/*`.
- **Peringatan:** file backup berisi SECRET (`.env` ada `ADMIN_TOKEN`/`ADMIN_PASSWORD`). Jangan upload ke tempat publik. Pindahkan via kabel USB / Bluetooth / Syncthing / cloud pribadi.
- Cek isi: `tar -tzf backup-glympfoto-*.tar.gz | head`.

### Di HP BARU — restore

```bash
# 1. install fresh dulu (sekali saja)
git clone https://github.com/glympfoto/glympfoto.github.io ~/glympfoto
cd ~/glympfoto
bash scripts/install.sh
# kalau diminta: tailscale up (login 1x via browser)

# 2. copy file backup dari HP lama ke ~/glympfoto/, lalu:
./scripts/restore.sh backup-glympfoto-YYYYMMDD-HHMMSS.tar.gz
```

`restore.sh` melakukan: stop server → amankan `.env` aktif jadi `.env.sebelum-restore-*` → extract backup → `npm run db:init` (repair) → `npm run build` → `start-all.sh`.

### Verifikasi pindah

1. `bash scripts/status.sh` → local OK + publik OK.
2. Buka dashboard → **jumlah foto harus sama** seperti HP lama.
3. Buka satu **share link lama** (`/v/<token>`) → harus tetap jalan (token ikut pindah bersama DB).
4. Kalau URL publik belum muncul: `tailscale up` lalu `bash scripts/start-all.sh` lagi.

---

## 5. Akses publik via Tailscale Funnel

- Server listen di `0.0.0.0:3000`, dipublikasikan via `tailscale funnel --bg --yes http://localhost:3000` (lihat `scripts/funnel.sh`).
- URL stabil per node tailnet, mis. `https://namahpmu.xxxxx.ts.net`, tercatat di `.tunnel-url`.
- Login cukup sekali per HP baru: `tailscale up` → buka URL yang ditampilkan → login akun Tailscale-mu.
- Watchdog (`scripts/watchdog.sh`) cek server tiap 60 detik (auto-restart kalau crash) dan cek funnel tiap ~5 menit (re-register kalau down, restart daemon `tailscaled` kalau perlu). URL funnel dibaca dari `.tunnel-url`, bukan hardcode — jadi tetap benar di HP baru.
- Tamu/recipient **tidak perlu** akun atau aplikasi Tailscale.

---

## 6. Habis reboot HP

Tidak ada auto-start (Termux:Boot sengaja tidak dipakai). Setelah reboot:

```bash
cd ~/glympfoto
bash scripts/start-all.sh
```

Kalau `tailscale status` bilang logged out / daemon mati, jalankan `tailscale up` dulu.

---

## 7. Agar tidak dibunuh Android

Tanpa Termux:API tidak ada wake-lock, jadi Android lebih bebas membunuh Termux saat HP sleep. Lakukan ini sekali (tanpa aplikasi tambahan):

1. Android → Settings → Apps → Termux → Battery → **Unrestricted** (jangan Optimized).
2. Kalau lagi share link penting: biarkan Termux terbuka di foreground + HP charging.
3. Kalau server mati: buka Termux → `bash scripts/status.sh` → kalau FAIL, `bash scripts/start-all.sh`. Watchdog menangani crash/restart **selama proses Termux masih hidup**; kalau Termux-nya sendiri yang dibunuh OS, start manual adalah satu-satunya jalan.

---

## 8. Mode Guest (Teman Upload Tanpa Token)

```bash
# di .env
GUEST_UPLOAD=1
# restart
bash scripts/stop.sh && bash scripts/start-all.sh
```

- Halaman guest: `http://127.0.0.1:3000/g` (atau URL funnel + `/g`).
- Teman upload → atur durasi/max views/expiry → langsung dapat link. Tanpa token, tanpa login.
- **Tanpa riwayat view:** upload, view, dan image guest tidak ditulis ke audit log. File-nya sendiri **tampil di dashboard admin** bertanda GUEST agar kamu bisa awasi storage dan hapus manual — tapi siapa membukanya dan kapan tidak tercatat.
- **Tanpa sisa foto:** original guest otomatis dihapus permanen setelah link kedaluwarsa / max views tercapai dan sesi habis (sweep tiap jam + tiap ada view baru).
- Batasan guest: watermark selalu ON, expiry wajib (5 menit – 7 hari, default 24 jam), max views maks 20, upload 10x/jam per IP.
- Matikan lagi kalau sudah tidak perlu: `GUEST_UPLOAD=0` + restart.
- **Risiko:** siapa saja yang tahu URL `/g` bisa upload ke HP kamu. Jangan sebar ke publik, awasi storage.

---

## 9. API Ringkas

Login: `POST /api/login` `{password}` → cookie sesi (rate limit 10x/15 mnt). `POST /api/logout` mencabut sesi.
Semua `/api/*` (selain login/logout/guest) butuh cookie sesi, atau header `x-admin-token: <password>` / `Authorization: Bearer <password>`.

- `POST /api/photos` (multipart `photo`) → `{id, filename, mime, size, width, height}`
- `GET /api/photos` → `{photos: [...]}` (dengan `links` count)
- `GET /api/photos/:id/thumb?w=480` → `image/jpeg` (admin only)
- `DELETE /api/photos/:id` → hapus original + cascade links
- `POST /api/shares` `{photoId, openDurationSec, maxViews?, oneTime?, expiresInSec?, watermarkEnabled?}` → `{token, urlPath: /v/<token>}`
- `GET /api/shares?photoId=...`
- `POST /api/shares/:id/revoke`
- `DELETE /api/shares/:id`
- `GET /api/audit?limit=100&offset=0&action=VIEW_OPEN`
- `POST /api/audit/cleanup`
- `GET /api/settings` / `PUT /api/settings` `{auditRetentionDays}`
- `GET /v/:token` → HTML viewer (no-store, no-referrer, CSP)
- `POST /v/:token/open` → `{viewId, expiresAt, imageUrl, statusUrl, serverNow}` (atomic `BEGIN IMMEDIATE`)
- `GET /v/:token/status/:viewId` → `{remainingMs, serverNow}` atau `410`
- `GET /v/:token/img/:viewId` → `image/jpeg` watermarked, no-store (410 jika expired/revoked)
- `POST /v/:token/event` `{event, viewId}` → logging deterrence
- Honeypot: `GET /storage/*`, `/originals/*`, `/data/*` → `404` + `DOWNLOAD_ATTEMPT`

---

## 10. Troubleshooting Termux

- `tailscale: command not found` → install `tailscale-termux` dulu, lalu ulangi `bash scripts/install.sh`.
- `tailscale status` → `Logged out` → `tailscale up`, login via browser, lalu `bash scripts/start-all.sh`.
- `publik URL: (belum ada)` → cek `logs/funnel.log`. Biasanya belum `tailscale up`, atau funnel belum propagasi (±30 detik).
- `local FAIL` → cek `logs/server.log` (ekor 20 baris terakhir). Seringnya `.env` rusak atau port bentrok → `PORT=3001 bash scripts/start-all.sh` untuk coba port lain.
- `sharp` error `Could not load sharp` → pastikan `npm install` selesai dan `node_modules/@img/` ada. Kalau masih error: `rm -rf node_modules && npm install`.
- `better-sqlite3` error → **JANGAN** pakai `better-sqlite3`. Project ini pakai `node:sqlite` built-in. `rm -rf node_modules/better-sqlite3 && npm install`.
- DB locked `SQLITE_BUSY` → `bash scripts/stop.sh`, `rm data/*.db-shm data/*.db-wal`, `npm run db:init`, `bash scripts/start-all.sh`.
- Foto tidak muncul di viewer → cek `storage/originals` ada file, cek sesi belum expired, watermark Sharp butuh ~2-6 detik di wasm.
- Restore: `node_modules belum ada` → jalankan `bash scripts/install.sh` dulu sebelum `restore.sh`.
- `git clone` repo privat gagal auth → pakai Personal Access Token sebagai password.
- Tests (opsional, ~40 detik di HP): `npm test` → harus `Test Files 1 passed, Tests 17 passed`.
- Cleanup log lama & tmp: `npm run cleanup`.

---

## 11. Struktur Project

```
glympfoto/
  public/
    admin.html / admin.css / admin.js
    view.css / view.js
  src/
    config.ts      # env + lazy getters
    db.ts          # node:sqlite + initSchema
    app.ts         # Express + helmet + rate-limit + honeypot
    index.ts       # boot + cleanup tmp
    lib/
      audit.ts / files.ts / tokens.ts / watermark.ts
    middleware/
      adminAuth.ts / security.ts / rateLimit.ts
    routes/
      photos.ts / shares.ts / viewer.ts / audit.ts
  scripts/
    install.sh     # installer Termux baru (satu perintah)
    backup.sh      # backup Full: .env + DB + foto (1 file)
    restore.sh     # restore ke HP baru
    init-db.ts / cleanup.ts / fix-orphans.ts
    start-all.sh / stop.sh / status.sh / watchdog.sh / funnel.sh
  tests/
    security.test.ts  # 17 tests
  data/               # SQLite (WAL)
  storage/
    originals/        # private (jangan taruh di public/)
    tmp/              # multer temp + cleanup 30 menit
```

**Schema SQLite**
- `photos(id, filename, stored_name, mime, size, width, height, created_at)`
- `share_links(id, photo_id, token, one_time, max_views, views_count, expires_at, open_duration_sec, watermark_enabled, revoked, created_at)`
- `view_sessions(id, share_id, token, view_number, opened_at, expires_at_image, ip, user_agent)`
- `audit_logs(id, view_id, share_token, timestamp, ip, user_agent, action, status, detail)`
- `settings(key, value)` — `audit_retention_days`

---

## 12. Yang TIDAK dipakai (sengaja)

- **Cloudflare Tunnel:** sudah dihapus total (`scripts/tunnel.sh` dibuang). Alasan: URL acak tiap restart, satu dependensi lebih sedikit. Konsekuensi: kalau Tailscale down, tidak ada jalur cadangan.
- **Termux:Boot:** tidak ada auto-start habis reboot. Konsekuensi: start manual (lihat [bagian 6](#6-habis-reboot-hp)).
- **Termux:API:** tidak ada wake-lock, notifikasi URL, atau log baterai. Semua pemakaian lama sudah dibersihkan dari script. Konsekuensi: baca [bagian 7](#7-agar-tidak-dibunuh-android).
- **Storage `/sdcard`:** default kembali internal `./storage`. Kalau kamu masih pakai `/sdcard/GlympFoto` di `.env` lama, backup/restore tetap jalan tapi kamu wajib `termux-setup-storage` manual di HP baru. Untuk setup baru, biarkan `./storage`.

---

## 13. Wrapper GitHub Pages

Repo ini ganda: selain code app Termux, branch `main` juga menayangkan wrapper publik di `https://glympfoto.github.io` (file `index.html` + `404.html` di root). Wrapper ini iframe yang menunjuk ke Tailscale Funnel HP-mu, jadi tamu bisa buka link cantik tanpa tahu URL `ts.net` aslinya.

- **Sumber wrapper:** `pages/index.html`, `pages/404.html`, `pages/CNAME`. Edit di sini.
- **Deploy:** copy ke root lalu push — GitHub Pages redeploy ±1 menit:
  ```bash
  cp pages/index.html ./index.html
  cp pages/404.html ./404.html
  git add index.html 404.html && git commit -m "Update wrapper" && git push
  ```
  (File root dan `pages/` saat ini identik — jangan edit root langsung, nanti divergen.)
- **Ganti URL funnel:** cukup ganti satu baris `var BASE = '...'` di `pages/index.html` + `pages/404.html`, copy ke root, push. Lihat juga `PUBLIC_HOST` di `.env` (domain yang boleh iframe viewer — harus cocok dengan domain wrapper).
- Jangan taruh secret di file wrapper — repo ini publik.

---

## Lisensi

MIT
