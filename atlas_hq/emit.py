#!/usr/bin/env python3
"""Explicit, user-driven ingest of Kali run records into the local Atlas HQ viewer.

This CLI never starts a scan, shells out, or contacts public targets.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

DEFAULT_TOKEN = Path.home() / ".atlas-hq" / "ingest-token"


def now():
    return datetime.now(timezone.utc).isoformat()


def call(base, route, token=None, payload=None):
    u = urlsplit(base)
    if u.scheme != "http" or u.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Only the local independent viewer at http://127.0.0.1 is supported.")
    url = base.rstrip("/") + route
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    if body is not None and len(body) > 1024 * 1024:
        raise ValueError("Event exceeds the 1 MiB local ingestion limit.")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["X-Atlas-HQ-Token"] = token
    req = Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(req, timeout=15) as response:
            return json.load(response)
    except HTTPError as exc:
        raise ValueError(f"Local viewer returned HTTP {exc.code}: {exc.read(1500).decode('utf-8', 'replace')}") from exc
    except URLError as exc:
        raise ValueError(f"Local viewer not reachable: {exc.reason}") from exc


def main():
    ap = argparse.ArgumentParser(description="Send observed records to Atlas HQ local viewer")
    ap.add_argument("--url", default="http://127.0.0.1:8917")
    ap.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN)
    commands = ap.add_subparsers(dest="kind", required=True)

    p = commands.add_parser("init", help="Start a new explicitly authorized run record")
    p.add_argument("--run", required=True)
    p.add_argument("--target", action="append", required=True)
    p.add_argument("--authorized", action="store_true", required=True, help="Acknowledge that targets are authorized and scope has been verified")
    p.add_argument("--mode", default="manual")

    p = commands.add_parser("agent", help="Record an agent or terminal actor")
    p.add_argument("--run", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--parent")
    p.add_argument("--status", default="running")

    p = commands.add_parser("log", help="Store actual terminal output from a file or stdin")
    p.add_argument("--run", required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--command", required=True, help="Observed command label (NOT executed by this tool)")
    p.add_argument("--file", type=Path)
    p.add_argument("--exit-code", type=int, default=0)
    p.add_argument("--mcp", help="Optional MCP connection associated with this tool call")

    p = commands.add_parser("finding", help="Import a recorded finding JSON object; no validation implied")
    p.add_argument("--run", required=True)
    p.add_argument("--file", required=True, type=Path)

    p = commands.add_parser("report", help="Attach an existing markdown report")
    p.add_argument("--run", required=True)
    p.add_argument("--file", required=True, type=Path)

    p = commands.add_parser("finish", help="Mark a record finished; never launches or terminates commands")
    p.add_argument("--run", required=True)
    p.add_argument("--status", default="completed")

    p = commands.add_parser("event", help="Import an exact known-schema JSON event envelope")
    p.add_argument("--file", required=True, type=Path)

    args = ap.parse_args()
    token = args.token_file.read_text().strip()
    if args.kind == "init":
        event = {"run": args.run, "kind": "run", "data": {
            "run_id": args.run, "run_name": args.run, "status": "running",
            "start_time": now(), "scan_mode": args.mode,
            "targets_info": [{"original": t} for t in args.target],
            "mcp_connection_status": [], "finished": False,
            "scan_results": {},
        }}
    elif args.kind == "agent":
        ts = now()
        event = {"run": args.run, "kind": "agent", "data": {
            "id": args.id, "name": args.name, "parent_id": args.parent,
            "status": args.status, "created_at": ts, "updated_at": ts,
        }}
    elif args.kind == "log":
        content = args.file.read_text(errors="replace") if args.file else sys.stdin.read()
        item = {
            "id": str(uuid.uuid4()), "type": "tool", "agent_id": args.agent,
            "timestamp": now(), "version": 1, "data": {
                "tool_name": "exec_command", "args": {"command": args.command},
                "result": {"content": content, "exit_code": args.exit_code},
                "status": "completed" if args.exit_code == 0 else "failed",
            },
        }
        if args.mcp:
            item["data"]["mcp_connection"] = args.mcp
        event = {"run": args.run, "kind": "tool", "data": item}
    elif args.kind == "finding":
        finding = json.loads(args.file.read_text())
        if not isinstance(finding, dict) or not finding.get("title"):
            raise ValueError("Finding must be a JSON object with a title")
        finding.setdefault("id", str(uuid.uuid4()))
        finding.setdefault("timestamp", now())
        event = {"run": args.run, "kind": "finding", "data": finding}
    elif args.kind == "report":
        event = {"run": args.run, "kind": "report", "data": {"markdown": args.file.read_text()}}
    elif args.kind == "finish":
        raw = call(args.url, "/api/run?" + urlencode({"run": args.run}), token=token)
        if not raw.get("run_id"):
            raise ValueError("The requested run was not initialized")
        raw.update({"status": args.status, "finished": True, "end_time": now()})
        event = {"run": args.run, "kind": "run", "data": raw}
    else:
        event = json.loads(args.file.read_text())
        if not isinstance(event, dict):
            raise ValueError("Event file must contain a JSON object")
    response = call(args.url, "/api/event", token=token, payload=event)
    print(json.dumps(response))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"atlas-hq: {exc}", file=sys.stderr)
        raise SystemExit(1)
