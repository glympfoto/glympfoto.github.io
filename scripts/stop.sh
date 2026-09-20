#!/data/data/com.termux/files/usr/bin/bash
# Stop GlympFoto: server + watchdog. Funnel dimatikan, daemon tailscaled tetap jalan.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in logs/server.pid logs/watchdog.pid; do
  if [ -f "$f" ]; then
    PID=$(cat "$f" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "kill $PID ($f)"
      kill "$PID" 2>/dev/null || true
      sleep 1
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$f"
  fi
done
# bersihkan file pid lama (sisa era cloudflare/logcat) bila masih ada
rm -f logs/tunnel.pid logs/logcat.pid
# bunuh server GlympFoto yang nyangkut (jangan sentuh node lain)
if [ -f logs/server.log ]; then
  SPID=$(ps aux 2>&1 | grep "node dist/src/index.js" | grep -v grep | awk '{print $2}' | head -1)
  if [ -n "${SPID:-}" ]; then
    echo "kill server $SPID"
    kill "$SPID" 2>/dev/null || true
  fi
fi
# matikan funnel (daemon tailscaled tetap jalan)
if command -v tailscale-cli >/dev/null 2>&1; then tailscale-cli funnel off 2>/dev/null || true; fi
echo "stopped"
