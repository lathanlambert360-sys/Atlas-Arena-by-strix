#!/usr/bin/env python3
"""Serve existing HexStrike FastMCP tool registry over localhost HTTP for Atlas."""
import argparse
import importlib.util
import sys
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--hex-root",default=str(Path.home()/"tools"/"hexstrike-ai"))
    parser.add_argument("--port",type=int,default=8000)
    args=parser.parse_args()
    root=Path(args.hex_root).expanduser().resolve()
    file=root/"hexstrike_mcp.py"
    if not file.is_file():parser.error("hexstrike_mcp.py not found at "+str(file))
    sys.path.insert(0,str(root))
    spec=importlib.util.spec_from_file_location("hexstrike_mcp_atlas",file)
    if spec is None or spec.loader is None:parser.error("Could not load HexStrike MCP module")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    hex_client=module.HexStrikeClient("http://127.0.0.1:8888",timeout=300)
    registry=module.setup_mcp_server(hex_client)
    print("Atlas HexStrike MCP: http://127.0.0.1:"+str(args.port)+"/mcp",flush=True)
    try:
        registry.run(transport="streamable-http",host="127.0.0.1",port=args.port)
    except TypeError:
        registry.settings.host="127.0.0.1"
        registry.settings.port=args.port
        registry.run(transport="streamable-http")

if __name__=="__main__":main()
