#!/usr/bin/env python3
"""Run an explicitly authorized Codex CLI session and attach its observed JSONL
events to the independent local Atlas HQ dashboard.

Run control is CLI-only and human-initiated. The browser cannot invoke this
adapter, and neither this script nor the viewer modifies Codex sandbox policy.
"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_EVENT_TEXT = 180_000
TOKEN_FILE = Path.home() / ".atlas-hq" / "ingest-token"


def now():
    return datetime.now(timezone.utc).isoformat()


def send(base, token, run, kind, data):
    obj = {"run": run, "kind": kind, "data": data}
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    if len(body) > 950_000:
        raise ValueError("Codex event exceeded the local storage payload limit")
    req = Request(base.rstrip("/") + "/api/event", data=body,
                  headers={"X-Atlas-HQ-Token": token, "Content-Type": "application/json"},
                  method="POST")
    try:
        with urlopen(req, timeout=8) as resp:
            result = json.load(resp)
            if not result.get("ok"):
                raise ValueError("Ingestion endpoint refused event")
    except (URLError, HTTPError) as exc:
        raise ValueError("Could not reach authenticated local Atlas HQ collector: " + str(exc)) from exc


def clipped(text):
    val = str(text or "")
    return val if len(val) <= MAX_EVENT_TEXT else val[:MAX_EVENT_TEXT] + "\n[ATLAS HQ: event truncated at " + str(MAX_EVENT_TEXT) + " characters]"


def codex_item(item, event_type, agent_id):
    if not isinstance(item, dict):
        return None
    kind = item.get("type", "")
    ident = "cx-" + str(item.get("id") or uuid.uuid4())
    timestamp = now()
    state = "running" if event_type in ("item.started", "item.updated") else (
        "failed" if item.get("status") in ("failed", "error") else "completed"
    )
    if kind == "command_execution":
        result = {"content": clipped(item.get("aggregated_output", "")),
                  "exit_code": item.get("exit_code") if isinstance(item.get("exit_code"), int) else None}
        return "tool", {"id": ident, "type": "tool", "agent_id": agent_id,
            "timestamp": timestamp, "version": 1, "data": {
                "tool_name": "exec_command", "args": {"command": clipped(item.get("command", ""))},
                "result": result, "status": state}}
    if kind == "agent_message" and event_type == "item.completed":
        return "chat", {"id": ident, "type": "chat", "agent_id": agent_id,
            "timestamp": timestamp, "version": 1,
            "data": {"role": "assistant", "content": clipped(item.get("text", ""))}}
    return None


def main():
    ap = argparse.ArgumentParser(description="Human-started Codex CLI -> Atlas HQ agent/terminal stream")
    ap.add_argument("--run", required=True, help="Unique run name (avoid overwriting prior runs)")
    ap.add_argument("--target", action="append", required=True, help="Explicit authorized scope (repeatable)")
    ap.add_argument("--scope-confirmed", action="store_true", required=True, help="Confirm target(s) are authorized before starting")
    ap.add_argument("--prompt-file", type=Path, required=True)
    ap.add_argument("--workdir", type=Path, required=True)
    ap.add_argument("--sandbox", choices=("read-only", "workspace-write"), default="read-only")
    ap.add_argument("--url", default="http://127.0.0.1:8917")
    ap.add_argument("--token-file", type=Path, default=TOKEN_FILE)
    args = ap.parse_args()

    from urllib.parse import urlsplit, urlencode
    p = urlsplit(args.url)
    if p.scheme != "http" or p.hostname not in ("localhost", "127.0.0.1", "::1"):
        ap.error("Collector must be an authenticated local-only Atlas HQ instance")
    cwd = args.workdir.expanduser().resolve(strict=True)
    if not cwd.is_dir():
        ap.error("--workdir must refer to an existing local directory")
    prompt = args.prompt_file.expanduser().read_text(encoding="utf-8")
    if not prompt.strip():
        ap.error("Prompt file is empty")
    binary = shutil.which("codex")
    if not binary:
        ap.error("Codex CLI is not installed in PATH")

    token = args.token_file.expanduser().read_text().strip()
    if len(token) < 20:
        ap.error("Collector token is missing or invalid")

    # Do not overwrite a different existing run.
    read_url = args.url.rstrip("/") + "/api/run?" + urlencode({"run": args.run})
    request = Request(read_url, headers={"X-Atlas-HQ-Token": token})
    try:
        with urlopen(request, timeout=6) as resp:
            existing = json.load(resp)
        if existing.get("run_id"):
            ap.error("Run name already exists; select a unique --run identifier")
    except HTTPError as exc:
        if exc.code != 404:
            raise

    run_data = {
        "run_id": args.run, "run_name": args.run,
        "status": "running", "scan_mode": "codex-human-approved",
        "targets_info": [{"original": t} for t in args.target],
        "start_time": now(), "end_time": None, "finished": False,
        "mcp_connection_status": [],
        "scan_results": {"methodology": "User-authorized Codex CLI session, sandbox: " + args.sandbox,
                         "executive_summary": None, "technical_analysis": None, "recommendations": None},
    }
    send(args.url, token, args.run, "run", run_data)
    agent_id = "codex-" + uuid.uuid4().hex[:12]
    agent = {"id": agent_id, "name": "Codex (local CLI)", "parent_id": None,
             "status": "running", "created_at": now(), "updated_at": now()}
    send(args.url, token, args.run, "agent", agent)
    cmd = [binary, "exec", "--json", "--sandbox", args.sandbox,
           "-C", str(cwd), "--skip-git-repo-check", "-"]
    full_prompt = ("AUTHORIZED SCOPE (operator confirmed):\n"
        + "\n".join(" - " + t for t in args.target)
        + "\nDo not access assets outside this authorization or initiate unsanctioned tests.\n"
        + "Stay inside the configured sandbox.\n\nOPERATOR TASK:\n" + prompt)
    print("Atlas HQ run:", args.run, "| sandbox:", args.sandbox, "| working dir:", cwd, flush=True)
    completed_count = 0
    exit_code = 1
    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1)
        # Keep stdout and stderr draining independently to avoid pipe deadlocks.
        from threading import Thread
        errors = []
        def drain_stderr():
            for line in proc.stderr:
                if len(errors) < 15:
                    errors.append(clipped(line.strip())[:1000])
        t = Thread(target=drain_stderr, daemon=True)
        t.start()
        proc.stdin.write(full_prompt)
        proc.stdin.close()
        for line in proc.stdout:
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(ev, dict):
                continue
            typ = str(ev.get("type", ""))
            if typ not in ("item.started", "item.completed", "item.updated"):
                continue
            parsed = codex_item(ev.get("item"), typ, agent_id)
            if parsed:
                kind, item = parsed
                send(args.url, token, args.run, kind, item)
                if typ == "item.completed":
                    completed_count += 1
        exit_code = proc.wait()
        t.join(timeout=3)
        if exit_code:
            print("Codex exited with", exit_code, "stderr tail:", errors[-3:], file=sys.stderr)
    except KeyboardInterrupt:
        print("Interrupted; stopping this Codex process", file=sys.stderr)
        if "proc" in locals():
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill()
        exit_code = 130
    finally:
        agent.update({"status": "completed" if exit_code == 0 else "failed", "updated_at": now()})
        run_data.update({"status": "completed" if exit_code == 0 else "failed",
                         "end_time": now(), "finished": True})
        try:
            send(args.url, token, args.run, "agent", agent)
            send(args.url, token, args.run, "run", run_data)
        except (ValueError, OSError) as exc:
            print("Failed to persist final status:", exc, file=sys.stderr)
    print("Codex terminal items ingested:", completed_count, "| exit code:", exit_code, flush=True)
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as exc:
        print("atlas-hq codex connector:", exc, file=sys.stderr)
        sys.exit(1)
