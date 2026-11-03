#!/usr/bin/env bash
# One-command Atlas HQ: independent original-style viewer on Kali (no Docker).
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Persist the locally entered OrcaRouter key across Atlas HQ restarts.
KEY_FILE="$HOME/.atlas-hq/orcarouter-key"
mkdir -p "$HOME/.atlas-hq"
chmod 700 "$HOME/.atlas-hq"
if [[ -z "${ORCAROUTER_API_KEY:-}" && -s "$KEY_FILE" ]]; then
  ORCAROUTER_API_KEY="$(cat "$KEY_FILE")"
  export ORCAROUTER_API_KEY
fi
if [[ -z "${ORCAROUTER_API_KEY:-}" && -t 0 ]]; then
  read -rsp "Paste OrcaRouter API key: " ORCAROUTER_API_KEY
  echo
  if [[ -n "$ORCAROUTER_API_KEY" ]]; then
    (umask 077; printf '%s' "$ORCAROUTER_API_KEY" > "$KEY_FILE")
    chmod 600 "$KEY_FILE"
    export ORCAROUTER_API_KEY
  fi
fi
if [[ -n "${ORCAROUTER_API_KEY:-}" ]]; then
  # Configure the unmodified Strix engine through its native OpenAI-compatible
  # provider settings.  The viewer remains the upstream Strix viewer.
  export STRIX_LLM="openai/orca/orcacyber-flash-1.0-free"
  export LLM_API_BASE="https://api.orcarouter.ai/v1"
  export LLM_API_KEY="$ORCAROUTER_API_KEY"
  export STRIX_API_TYPE="chat_completions"
  echo "[Strix] OrcaCyber configured: $STRIX_LLM"
else
  echo "[Strix] OrcaRouter key not configured"
fi
FRONT="$ROOT/strix/interface/viewer/frontend"
SITE="$ROOT/strix/interface/viewer/static"
# Rebuild when tracked frontend source revision changes (file timestamps alone are unreliable after git clone).
FRONT_REV="$(git -C "$ROOT" log -1 --format=%H -- strix/interface/viewer/frontend 2>/dev/null || true)"
BUILD_MARKER="$SITE/.atlas-frontend-revision"
REBUILD=0
if [[ -n "$FRONT_REV" && "$(cat "$BUILD_MARKER" 2>/dev/null || true)" != "$FRONT_REV" ]]; then REBUILD=1; fi
if [[ ! -f "$SITE/index.html" ]]; then REBUILD=1
elif [[ "$FRONT/package-lock.json" -nt "$SITE/index.html" ]]; then REBUILD=1
elif find "$FRONT/src" -type f -newer "$SITE/index.html" -print -quit | grep -q .; then REBUILD=1
fi
if [[ "$REBUILD" == 1 ]]; then
  echo "[Strix] Building the restored upstream viewer."
  cd "$FRONT"
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  fi
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}" npm run build
  if [[ -n "$FRONT_REV" ]]; then printf "%s" "$FRONT_REV" > "$BUILD_MARKER"; fi
fi
cd "$ROOT"
exec python3 "$ROOT/atlas_hq/bridge.py" --site "$SITE" --port 8917 "$@"
