#!/bin/bash
# Make this laptop's Oasis runner reachable from the live site, with no account and no card:
#   1. the Oasis runner (server.py) on 127.0.0.1:8765, accepting runs only with the relay secret
#   2. a free Cloudflare quick tunnel to it (a random https://*.trycloudflare.com address)
#   3. a heartbeat that registers that address with the site's /api/oasis relay every 5 minutes
# Leave it running while the site should use Oasis; Ctrl-C stops all three.
# Needs OASIS_RELAY_SECRET in the repo-root .env (the same value as on Vercel).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${SITE:-https://riskforge-nzoia.vercel.app}"
PY="${PY:-$HOME/oasis-env/bin/python}"
CF="$HOME/bin/cloudflared"
SECRET="$(grep -E '^OASIS_RELAY_SECRET=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r' || true)"
[ -n "$SECRET" ] || { echo "OASIS_RELAY_SECRET missing in $ROOT/.env"; exit 1; }

if [ ! -x "$CF" ]; then
  mkdir -p "$HOME/bin"
  echo "Downloading cloudflared (Cloudflare's official tunnel client)..."
  curl -sSfL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o "$CF"
  chmod +x "$CF"
fi

pids=()
cleanup() { echo "stopping"; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# 1. the runner, restarted so it carries the secret
pkill -f "oasis-env/bin/python server.py" 2>/dev/null || true
cd "$ROOT/oasis"
# NUMBA_CPU_NAME=generic: reuse the Oasis kernel compiled by oasis/warmup.py instead of compiling again
NUMBA_CPU_NAME=generic RF_OASIS_PROCESSES=2 RF_RELAY_SECRET="$SECRET" RF_REQUIRE_SECRET=1 "$PY" server.py 8765 > "$HOME/rf_server.log" 2>&1 &
pids+=($!)
sleep 2

# 2. the tunnel
LOG="$HOME/rf_tunnel.log"
"$CF" tunnel --no-autoupdate --url http://127.0.0.1:8765 > "$LOG" 2>&1 &
pids+=($!)
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "The tunnel did not start; see $LOG"; exit 1; }
echo "Oasis runner is public at $URL"

# 3. keep the site pointed at it
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE/api/oasis" -H 'content-type: application/json' \
    -H "x-relay-secret: $SECRET" -d "{\"register\":\"$URL\"}" || echo 000)
  echo "$(date +%H:%M:%S)  registered with $SITE (HTTP $code)"
  sleep 300
done
