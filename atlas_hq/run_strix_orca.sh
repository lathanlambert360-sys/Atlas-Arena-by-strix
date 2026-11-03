#!/usr/bin/env bash
# Run the original Strix engine with OrcaCyber through OrcaRouter.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="$HOME/.atlas-hq/orcarouter-key"

if [[ -z "${ORCAROUTER_API_KEY:-}" && -s "$KEY_FILE" ]]; then
  ORCAROUTER_API_KEY="$(cat "$KEY_FILE")"
fi
if [[ -z "${ORCAROUTER_API_KEY:-}" && -t 0 ]]; then
  read -rsp "Paste OrcaRouter API key: " ORCAROUTER_API_KEY
  echo
  mkdir -p "$HOME/.atlas-hq"
  chmod 700 "$HOME/.atlas-hq"
  (umask 077; printf '%s' "$ORCAROUTER_API_KEY" > "$KEY_FILE")
fi
if [[ -z "${ORCAROUTER_API_KEY:-}" ]]; then
  echo "OrcaRouter API key is required" >&2
  exit 1
fi

export STRIX_LLM="openai/orca/orcacyber-flash-1.0-free"
export LLM_API_BASE="https://api.orcarouter.ai/v1"
export LLM_API_KEY="$ORCAROUTER_API_KEY"
export STRIX_API_TYPE="chat_completions"

cd "$ROOT"
if command -v uv >/dev/null 2>&1; then
  exec uv run strix "$@"
fi
exec python3 -m strix.interface.main "$@"
