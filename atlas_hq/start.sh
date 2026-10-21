#!/usr/bin/env bash
# One-command Atlas HQ: independent original-style viewer on Kali (no Docker).
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT="$ROOT/strix/interface/viewer/frontend"
SITE="$ROOT/strix/interface/viewer/static"
# Only rebuild when frontend source changed; README / bridge commits never trigger npm.
REBUILD=0
if [[ ! -f "$SITE/index.html" ]]; then REBUILD=1
elif [[ "$FRONT/package-lock.json" -nt "$SITE/index.html" ]]; then REBUILD=1
elif find "$FRONT/src" -type f -newer "$SITE/index.html" -print -quit | grep -q .; then REBUILD=1
fi
if [[ "$REBUILD" == 1 ]]; then
  echo "[Atlas HQ] One-time viewer build from independent source."
  cd "$FRONT"
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  fi
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}" npm run build
fi
cd "$ROOT"
exec python3 "$ROOT/atlas_hq/bridge.py" --site "$SITE" --port 8917 "$@"
