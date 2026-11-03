#!/usr/bin/env bash
# Restart ONLY the Atlas-owned port 8917 process; never kill other programs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8917
if command -v fuser >/dev/null 2>&1; then
  PIDS="$(fuser -n tcp "$PORT" 2>/dev/null || true)"
  for pid in $PIDS; do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if [[ "$args" == *"$ROOT/atlas_hq/bridge.py"* ]]; then
      echo "[Strix] Stopping prior dashboard backend PID $pid"
      kill "$pid" 2>/dev/null || true
    elif [[ -n "$args" ]]; then
      echo "[Strix] Port $PORT belongs to another program; refusing to stop it: $args"
      exit 1
    fi
  done
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ! fuser -n tcp "$PORT" >/dev/null 2>&1; then break; fi
    sleep .25
  done
fi
# Remove outdated built JS only; never delete chat history or stored keys.
rm -f "$ROOT/strix/interface/viewer/static/.atlas-frontend-revision"
echo "[Strix] Rebuilding original-style Cloud dashboard with current React source"
exec bash "$ROOT/atlas_hq/start.sh"
