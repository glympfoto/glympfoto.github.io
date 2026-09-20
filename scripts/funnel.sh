#!/data/data/com.termux/files/usr/bin/bash
# Nyalakan publik via Tailscale Funnel (pengganti cloudflared named).
# URL stabil per node tailscale, tercatat di .tunnel-url seperti sebelumnya.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs

TS="tailscale-cli"
command -v "$TS" >/dev/null 2>&1 || TS="tailscale"

# pastikan daemon jalan
if ! "$TS" status >/dev/null 2>&1; then
  echo "[$(date '+%H:%M:%S')] tailscaled belum jalan, start..."
  tailscaled-start 2>&1 | tail -n 3
  sleep 3
fi

# nyalakan funnel ke server lokal
"$TS" funnel --bg --yes http://localhost:3000 2>&1 | tee -a logs/funnel.log | head -n 8

URL=$("$TS" funnel status 2>&1 | grep -o 'https://[a-z0-9.-]*\.ts\.net' | head -1 || true)
if [ -n "${URL:-}" ]; then
  echo "$URL" > .tunnel-url
  echo "[$(date '+%H:%M:%S')] URL publik: $URL" | tee -a logs/funnel.log
else
  echo "[$(date '+%H:%M:%S')] funnel URL tidak ketemu, cek logs/funnel.log" | tee -a logs/funnel.log
fi
