#!/usr/bin/env bash
# Infinite Cyber: start HexStrike API + HTTP MCP + OrcaCyber Atlas HQ.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEX_ROOT="$HOME/tools/hexstrike-ai"
if [[ -n "$(printenv ATLAS_HEX_ROOT 2>/dev/null || true)" ]]; then HEX_ROOT="$ATLAS_HEX_ROOT"; fi
PY="$HEX_ROOT/hexstrike-env/bin/python3"
LOG_DIR="$HOME/.atlas-hq/logs"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"
if [[ ! -x "$PY" ]]; then
  echo "[Atlas] HexStrike Python environment not found: $PY"
  exit 1
fi
check_port() {
  (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}
if ! check_port 8888; then
  echo "[Atlas] Starting HexStrike API :8888"
  (cd "$HEX_ROOT" && nohup "$PY" -u hexstrike_server.py --port 8888 \
      >>"$LOG_DIR/hexstrike-api.log" 2>&1 < /dev/null &)
else
  echo "[Atlas] HexStrike API :8888 already listening"
fi
for _ in 1 2 3 4 5 6 7 8; do
  if check_port 8888; then break; fi
  sleep 1
done
if ! check_port 8000; then
  echo "[Atlas] Starting original HexStrike tunnel MCP :8000"
  (cd "$ROOT" && nohup "$PY" -u "$ROOT/atlas_hq/serve_hex_mcp.py" \
      --hex-root "$HEX_ROOT" --port 8000 \
      >>"$LOG_DIR/hexstrike-tunnel-mcp.log" 2>&1 < /dev/null &)
else
  echo "[Atlas] Original tunnel MCP :8000 already listening"
fi
if ! check_port 8001; then
  echo "[Atlas] Starting Atlas dedicated HexStrike MCP HTTP :8001"
  (cd "$ROOT" && nohup "$PY" -u "$ROOT/atlas_hq/serve_hex_mcp.py" \
      --hex-root "$HEX_ROOT" --port 8001 \
      >>"$LOG_DIR/hexstrike-mcp.log" 2>&1 < /dev/null &)
else
  echo "[Atlas] Atlas MCP HTTP :8001 already listening"
fi
echo "[Atlas] Original MCP bridge :8000 is available for your T3 tunnel"
echo "[Atlas] T3 startup: bash $ROOT/atlas_hq/start_tunnel.sh"
echo "[Atlas] HexStrike logs: $LOG_DIR"
echo "[Atlas] Starting OrcaCyber dashboard :8917"
exec bash "$ROOT/atlas_hq/start.sh"
