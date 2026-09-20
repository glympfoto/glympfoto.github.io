#!/data/data/com.termux/files/usr/bin/bash
# GlympFoto installer — Termux baru, tanpa cloudflared / Termux:Boot / Termux:API.
# Publik hanya via Tailscale Funnel. Storage internal (./storage).
# Pakai:  bash scripts/install.sh        (di dalam hasil git clone)
# atau fresh: git clone <repo-privat> ~/glympfoto && cd ~/glympfoto && bash scripts/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1/6 Dependensi Termux ==="
pkg update -y
pkg install -y nodejs-lts python make clang pkg-config wget openssh

if ! command -v tailscale-cli >/dev/null 2>&1 && ! command -v tailscale >/dev/null 2>&1; then
  echo ""
  echo "Tailscale belum ada. Install manual:"
  echo "  pkg install tailscale-termux   # atau ikuti instruksi repo tailscale-termux"
  echo "Lalu jalankan lagi: bash scripts/install.sh"
  exit 1
fi

echo "node: $(node --version) | npm: $(npm --version)"
TS="tailscale-cli"; command -v "$TS" >/dev/null 2>&1 || TS="tailscale"
echo "tailscale: $("$TS" version 2>/dev/null | head -1)"

echo ""
echo "=== 2/6 npm install ==="
npm install --no-audit

echo ""
echo "=== 3/6 File .env ==="
if [ ! -f .env ]; then
  cp .env.example .env
  # generate secret acak, ganti placeholder
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  # ganti ADMIN_TOKEN placeholder bila masih default
  if grep -q 'ganti-dengan-token-acak-panjang' .env; then
    sed -i "s#^ADMIN_TOKEN=.*#ADMIN_TOKEN=$SECRET#" .env
    echo ".env dibuat + ADMIN_TOKEN acak digenerate."
  else
    echo ".env dibuat dari .env.example."
  fi
  echo "WAJIB: cat .env lalu simpan ADMIN_TOKEN / ADMIN_PASSWORD di tempat aman."
else
  echo ".env sudah ada — tidak ditimpa."
fi

echo ""
echo "=== 4/6 Direktori + DB + build ==="
if [ -f .env ]; then set -a; source .env 2>/dev/null; set +a; fi
SD="${STORAGE_DIR:-./storage}"
mkdir -p data "$SD/originals" "$SD/tmp" logs
[ -f "$SD/originals/.gitkeep" ] || touch "$SD/originals/.gitkeep"
[ -f "$SD/tmp/.gitkeep" ] || touch "$SD/tmp/.gitkeep"
npm run db:init
npm run build

echo ""
echo "=== 5/6 Tailscale login (sekali saja) ==="
if ! "$TS" status >/dev/null 2>&1; then
  echo "Belum login Tailscale. Jalankan:"
  echo "  $TS up"
  echo "Ikuti URL login di browser, lalu lanjut ke langkah 6."
else
  echo "Tailscale sudah login."
fi

echo ""
echo "=== 6/6 Start server + funnel ==="
bash scripts/start-all.sh

echo ""
echo "Selesai. Simpan baik-baik isi .env (ADMIN_TOKEN / ADMIN_PASSWORD)."
