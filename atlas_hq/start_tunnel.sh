#!/usr/bin/env bash
# T3: attach the already running original HexStrike MCP bridge to OpenAI tunnel.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
unset CONTROL_PLANE_API_KEY
read -rsp "PASTE RUNTIME KEY: " CONTROL_PLANE_API_KEY
echo
export CONTROL_PLANE_API_KEY
exec tunnel-client run \
  --control-plane.tunnel-id tunnel_6a9444569f3c8191b92994c57787c097 \
  --mcp.server-url http://127.0.0.1:8000/mcp
