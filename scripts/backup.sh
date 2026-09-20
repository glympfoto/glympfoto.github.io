#!/data/data/com.termux/files/usr/bin/bash
# Backup Full GlympFoto: .env + database + foto (storage internal ./storage).
# Hasil: 1 file backup-glympfoto-YYYYMMDD-HHMMSS.tar.gz di folder projek.
# Tidak ikut: node_modules/, dist/, logs/, *.pid, .tunnel-url, *.shm/*.wal.
# Catatan: backup berisi SECRET (.env) — simpan di tempat aman, jangan upload publik.
set -euo pipefail
cd "$(dirname "$0")/.."

# --fresh = config saja (tanpa foto). Default = full.
MODE="${1:---full}"
OUT="./backup-glympfoto-$(date +%Y%m%d-%H%M%S).tar.gz"

if [ ! -f .env ]; then echo "Tidak ada .env — batal."; exit 1; fi
if [ ! -f data/glympfoto.db ] && [ ! -f "${DB_PATH:-./data/glympfoto.db}" ]; then
  echo "Database tidak ketemu — jalankan npm run db:init dulu. Batal."
  exit 1
fi

# Checkpoint WAL agar .db konsisten (abaikan kalau gagal — DB tetap dibackup apa adanya)
node -e "
const db = require('node:sqlite');
try {
  const path = (process.env.DB_PATH || './data/glympfoto.db');
  const d = new db.DatabaseSync(path);
  d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  d.close();
} catch (e) { console.error('checkpoint skip:', e.message); }
" 2>/dev/null || true

if [ "$MODE" = "--fresh" ]; then
  tar -czf "$OUT" .env data/glympfoto.db 2>/dev/null \
    || tar -czf "$OUT" .env data 2>/dev/null
  echo "Backup FRESH tersimpan: $OUT (tanpa foto)"
else
  tar -czf "$OUT" \
    --exclude='*.shm' --exclude='*.wal' --exclude='*.bak.*' \
    --exclude='storage/tmp/*' \
    .env data/glympfoto.db storage/originals 2>/dev/null \
    || tar -czf "$OUT" .env data storage 2>/dev/null
  echo "Backup FULL tersimpan: $OUT (.env + DB + foto)"
fi
ls -lh "$OUT"
echo ""
echo "Pindah ke HP baru:"
echo "  1. Install fresh: git clone <repo> ~/glympfoto && bash scripts/install.sh"
echo "  2. Copy file backup ini ke HP baru, lalu:"
echo "     ./scripts/restore.sh $(basename "$OUT")"
