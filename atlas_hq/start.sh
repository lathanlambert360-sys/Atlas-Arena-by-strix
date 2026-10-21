#!/usr/bin/env bash
# One-shot, independent local Atlas HQ startup. No Docker and no scan execution.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT="$ROOT/strix/interface/viewer/frontend"
SITE="$ROOT/strix/interface/viewer/static"
if [[ ! -e "$SITE/index.html" || "$FRONT/src/App.tsx" -nt "$SITE/index.html" || "$FRONT/src/components/IndependentWorkspaceView.tsx" -nt "$SITE/index.html" ]]; then
  echo "[Atlas HQ] Building the original viewer with independent data adapters (one-time frontend build)."
  cd "$FRONT"
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  fi
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" npm run build
fi
cd "$ROOT"
exec python3 "$ROOT/atlas_hq/bridge.py" --site "$SITE" "$@"
