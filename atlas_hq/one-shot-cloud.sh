#!/usr/bin/env bash
# ATLAS ARENA: existing self-hosted backend + temporary Cloudflare browser route.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "[ATLAS] Current git revision: $(git rev-parse --short HEAD)"
command -v codex >/dev/null || { echo "[FAIL] Codex CLI not installed on this host"; exit 1; }
codex login status || { echo "[FAIL] Authenticate Codex on this host first"; exit 1; }
CLOUDFLARED="$(command -v cloudflared || true)"
if [[ -z "$CLOUDFLARED" && -x /tmp/cloudflared ]]; then CLOUDFLARED=/tmp/cloudflared; fi
[[ -n "$CLOUDFLARED" ]] || { echo "[FAIL] cloudflared missing; install from official release before continuing"; exit 1; }
TOKEN="$HOME/.atlas-hq/ingest-token"
test -s "$TOKEN" || { echo "[FAIL] Missing Atlas token. Run bash atlas_hq/start.sh once to initialize"; exit 1; }
if ss -ltn | grep -q '127.0.0.1:8917'; then
  echo "[ATLAS] Existing bridge on port 8917: terminate its PID before replacing origin configuration."
  PID="$(pgrep -f '[p]ython3.*atlas_hq/bridge.py.*8917' | head -n 1 || true)"
  if [[ -z "$PID" ]]; then echo "[FAIL] Port owned by unknown process. Do not terminate it automatically."; exit 1; fi
  kill "$PID"
  for i in {1..20}; do ss -ltn | grep -q '127.0.0.1:8917' || break; sleep 0.2; done
fi
if [[ -f "$HOME/atlas-tunnel.pid" ]]; then kill "$(cat "$HOME/atlas-tunnel.pid")" 2>/dev/null || true; fi
nohup "$CLOUDFLARED" tunnel --url http://127.0.0.1:8917 >"$HOME/atlas-tunnel.log" 2>&1 </dev/null &
echo "$!" >"$HOME/atlas-tunnel.pid"
PUBLIC=""
for i in {1..30}; do
  PUBLIC="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$HOME/atlas-tunnel.log" | head -n 1 || true)"
  [[ -n "$PUBLIC" ]] && break
  sleep 1
done
[[ -n "$PUBLIC" ]] || { echo "[FAIL] Tunnel URL not available; review ~/atlas-tunnel.log"; exit 1; }
ATLAS_HQ_PUBLIC_ORIGIN="$PUBLIC" nohup bash "$ROOT/atlas_hq/start.sh" >"$HOME/atlas-arena.log" 2>&1 </dev/null &
echo "$!" >"$HOME/atlas-arena.pid"
for i in {1..30}; do ss -ltn | grep -q '127.0.0.1:8917' && break; sleep 1; done
HEALTH="$(curl -fsS --max-time 5 -H "X-Atlas-HQ-Token: $(cat "$TOKEN")" http://127.0.0.1:8917/api/health)" || { echo "[FAIL] Atlas health check failed"; exit 1; }
echo "[ATLAS] Backend health: $HEALTH"
echo "[ATLAS] Codex: $(codex --version)"
echo
echo "[ATLAS] AUTHENTICATED BROWSER URL - DO NOT SHARE"
printf '%s/?token=%s\n' "$PUBLIC" "$(cat "$TOKEN")"
echo "[ATLAS] HTTPS tunnel is temporary and internet-reachable; enable an authenticated network gate before real investigations."
