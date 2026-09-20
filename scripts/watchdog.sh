#!/data/data/com.termux/files/usr/bin/bash
# Watchdog: jika server mati (OOM / crash), angkat lagi otomatis.
# Funnel down (3x gagal beruntun) juga di-restart otomatis.
# Selama proses Termux masih ada, ini menjaga server tetap hidup.
# Tanpa Termux:API — tidak ada log baterai / wake-lock / notifikasi.
# Dijalankan oleh scripts/start-all.sh, dihentikan oleh scripts/stop.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
PORT="${PORT:-3000}"
HEALTH="http://127.0.0.1:$PORT/health"

# URL funnel dibaca dari file (ditulis funnel.sh), bukan hardcode,
# agar tetap benar di HP / node tailscale yang baru.
funnel_url() {
  [ -f .tunnel-url ] && cat .tunnel-url | tr -d '\n\r '
}

# Cek funnel: 3x gagal beruntun = down (bukan glitch sesaat)
funnel_down() {
  local url; url=$(funnel_url)
  [ -z "${url:-}" ] && return 1  # belum ada URL = belum bisa dinilai, jangan restart
  local fail=0
  for _ in 1 2 3; do
    curl -s -m 6 -o /dev/null "$url/health" || fail=$((fail + 1))
    sleep 2
  done
  [ "$fail" -ge 3 ]
}

# tunggu node tailscale online (setelah restart daemon)
ts_online() {
  for _ in $(seq 1 24); do
    tailscale-cli status 2>/dev/null | head -1 | grep -q '100\.' && return 0
    tailscale status 2>/dev/null | head -1 | grep -q '100\.' && return 0
    sleep 5
  done
  return 1
}

restart_funnel() {
  local url; url=$(funnel_url)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] FUNNEL down ($url), restart..." >> logs/watchdog.log
  local TS=tailscale-cli
  command -v "$TS" >/dev/null 2>&1 || TS=tailscale
  funnel_try() {
    "$TS" funnel --https=443 off >/dev/null 2>&1 || true
    sleep 3
    "$TS" funnel --bg --yes "http://localhost:$PORT" >/dev/null 2>&1 || true
    # edge butuh ~15-30s propagasi setelah re-register — cek berulang
    for _ in 1 2 3 4 5; do
      sleep 8
      url=$(funnel_url)
      if [ -n "${url:-}" ] && curl -s -m 8 "$url/health" | grep -q '"ok":true'; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] FUNNEL kembali OK ($url)" >> logs/watchdog.log
        return 0
      fi
    done
    return 1
  }
  funnel_try && return 0
  # off/on tidak cukup → daemon tailscaled rusak (efek Android kill).
  # Restart daemon dulu, tunggu online, baru re-register funnel.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] funnel masih down -> restart tailscaled" >> logs/watchdog.log
  if command -v sv >/dev/null 2>&1; then
    sv restart tailscaled >/dev/null 2>&1 || pkill -f 'tailscaled --statedir' 2>/dev/null || true
  else
    pkill -f 'tailscaled --statedir' 2>/dev/null || true
  fi
  ts_online || {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] tailscaled GAGAL online" >> logs/watchdog.log
    return 1
  }
  funnel_try && return 0
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] FUNNEL GAGAL restart, cek logs/funnel.log" >> logs/watchdog.log
  return 1
}

ITER=0
while true; do
  sleep 60
  ITER=$((ITER + 1))
  # cek funnel tiap ~5 menit, restart kalau down
  if [ $((ITER % 5)) -eq 0 ]; then
    if funnel_down; then
      restart_funnel
    fi
  fi
  if curl -s -m 3 "$HEALTH" | grep -q '"ok":true'; then
    continue
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] server tidak respon -> restart" >> logs/watchdog.log
  # bunuh node GlympFoto lama yang nyangkut (jangan sentuh node lain)
  pkill -f "node dist/src/index.js" 2>/dev/null || true
  sleep 2
  setsid nohup node dist/src/index.js >> logs/server.log 2>&1 < /dev/null &
  echo $! > logs/server.pid
  for i in $(seq 1 20); do
    curl -s -m 2 "$HEALTH" | grep -q '"ok":true' && break
    sleep 1
  done
  if curl -s -m 2 "$HEALTH" | grep -q '"ok":true'; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] server kembali OK" >> logs/watchdog.log
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] server GAGAL distart, cek logs/server.log" >> logs/watchdog.log
  fi
done
