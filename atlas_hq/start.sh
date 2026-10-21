#!/usr/bin/env bash
# One-command Atlas HQ: independent original-style viewer on Kali (no Docker).
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT="$ROOT/strix/interface/viewer/frontend"
SITE="$ROOT/strix/interface/viewer/static"
REV="$(cd "$ROOT" && (git rev-parse HEAD 2>/dev/null || echo unknown))"
MARKER="$SITE/.atlas-hq-build-rev"
if [[ ! -e "$SITE/index.html" || ! -f "$MARKER" || "$(cat "$MARKER")" != "$REV" ]]; then
  echo "[Atlas HQ] One-time original viewer build from independent source."
  cd "$FRONT"
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  fi
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}" npm run build
  echo "$REV" > "$MARKER"
fi
cd "$ROOT"
exec python3 "$ROOT/atlas_hq/bridge.py" --site "$SITE" --port 8917 "$@"
