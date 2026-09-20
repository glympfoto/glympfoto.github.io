#!/data/data/com.termux/files/usr/bin/bash
# Restore backup Full ke Termux baru.
# Syarat: sudah git clone + bash scripts/install.sh sekali (agar deps + build ada).
# Pakai: ./scripts/restore.sh <file-backup.tar.gz>
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Pakai: ./scripts/restore.sh <file-backup.tar.gz>"
  exit 1
fi
BACKUP="$1"
if [ ! -f "$BACKUP" ]; then echo "File tidak ketemu: $BACKUP"; exit 1; fi

if [ ! -d node_modules ]; then
  echo "node_modules belum ada — jalankan dulu: bash scripts/install.sh"
  exit 1
fi

echo "Stop server lama (kalau jalan)..."
bash scripts/stop.sh 2>/dev/null || true

echo "Backup .env sekarang (jaga-jaga)..."
[ -f .env ] && cp .env ".env.sebelum-restore-$(date +%Y%m%d-%H%M%S)" || true

echo "Extract $BACKUP ..."
tar -xzPf "$BACKUP"

echo "Perbaiki struktur..."
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
mkdir -p "${DATA_DIR:-./data}" "${STORAGE_DIR:-./storage}/originals" "${STORAGE_DIR:-./storage}/tmp" logs

echo "Repair DB + build..."
npm run db:init
npm run build

echo "Start..."
bash scripts/start-all.sh

echo ""
echo "Restore selesai. Cek:"
echo "  - Buka http://127.0.0.1:3000 → login → jumlah foto harus sama seperti HP lama"
echo "  - Coba buka satu share link lama (harus tetap jalan)"
echo "  - Kalau URL publik belum muncul: tailscale up && bash scripts/start-all.sh"
echo "File .env lama (sebelum restore) tersimpan sebagai .env.sebelum-restore-* bila ada."
