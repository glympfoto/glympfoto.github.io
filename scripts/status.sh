#!/data/data/com.termux/files/usr/bin/bash
# Status GlympFoto: server lokal + funnel publik + ekor log.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
PORT="${PORT:-3000}"
echo "=== GlympFoto Status ==="
for f in logs/server.pid logs/watchdog.pid; do
  if [ -f "$f" ]; then PID=$(cat "$f"); echo -n "$f: $PID "; kill -0 "$PID" 2>/dev/null && echo "RUN" || echo "DEAD"; else echo "$f: -"; fi
done
ps aux 2>&1 | grep -E "node dist/src/index|tailscaled" | grep -v grep | head -5
echo "---"
if command -v tailscale-cli >/dev/null 2>&1; then tailscale-cli funnel status 2>/dev/null | head -n 5 || true; fi
curl -s -m 3 "http://127.0.0.1:$PORT/health" && echo " [local OK]" || echo "local FAIL"
if [ -f .tunnel-url ]; then URL=$(cat .tunnel-url); echo "publik URL: $URL"; curl -s -m 8 "$URL/health" && echo " [publik OK]" || echo "publik FAIL"; else echo "publik URL: (belum ada, cek logs/funnel.log)"; fi
echo "--- logs tail ---"
tail -5 logs/server.log 2>/dev/null | head
tail -5 logs/funnel.log 2>/dev/null | head
