#!/data/data/com.termux/files/usr/bin/bash
# Start GlympFoto: server + watchdog + publik via Tailscale Funnel.
# Tanpa cloudflared / Termux:Boot / Termux:API.
# Habis reboot HP: buka Termux lalu jalankan file ini manual.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
mkdir -p logs data storage/originals storage/tmp

# Rotasi log: jaga ukuran < 2MB, simpan versi lama (.1)
rotate_log() {
  local f="$1"
  [ -f "$f" ] || return 0
  local sz; sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "${sz:-0}" -gt 2097152 ]; then
    mv "$f" "$f.1"
    : > "$f"
  fi
}

# build jika perlu — cek SEMUA file src, bukan cuma index.ts
NEWEST_SRC=$(find src scripts -name '*.ts' -newer dist/src/index.js 2>/dev/null | head -1)
if [ ! -f dist/src/index.js ] || [ -n "$NEWEST_SRC" ]; then
  echo "[$(date '+%H:%M:%S')] build... (berubah: ${NEWEST_SRC:-dist belum ada})"
  ./node_modules/.bin/tsc || npx tsc
fi

# stop yang lama kalau ada
bash scripts/stop.sh 2>/dev/null || true

echo "[$(date '+%H:%M:%S')] start server..."
# append (jangan truncate) — crash trace harus tertinggal untuk debugging
rotate_log logs/server.log
setsid nohup node dist/src/index.js >> logs/server.log 2>&1 < /dev/null &
echo $! > logs/server.pid
echo "server pid $(cat logs/server.pid)"

PORT="${PORT:-3000}"
# tunggu health
for i in $(seq 1 15); do
  if curl -s -m 2 "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then
    echo "[$(date '+%H:%M:%S')] server OK"
    break
  fi
  sleep 1
done

# Watchdog: angkat server lagi kalau crash / OOM
echo "[$(date '+%H:%M:%S')] start watchdog (cek 60s, auto-restart)..."
setsid nohup bash scripts/watchdog.sh >> logs/watchdog.log 2>&1 < /dev/null &
echo $! > logs/watchdog.pid
echo "watchdog pid $(cat logs/watchdog.pid)"

echo "[$(date '+%H:%M:%S')] start publik (tailscale funnel)..."
bash scripts/funnel.sh
echo ""
echo "GlympFoto siap:"
echo "  Lokal:  http://127.0.0.1:$PORT  (admin)  &  http://127.0.0.1:$PORT/g (guest)"
if [ -f .tunnel-url ]; then
  echo "  Publik: $(cat .tunnel-url)          (admin)"
  echo "          $(cat .tunnel-url)/g        (guest)"
else
  echo "  Publik: (belum ada — cek logs/funnel.log, pastikan 'tailscale up' sudah login)"
fi
echo "  URL:    cat .tunnel-url"
echo "  Log:    tail -f logs/server.log logs/funnel.log"
echo "  Status: bash scripts/status.sh"
echo "  Stop:   bash scripts/stop.sh"
