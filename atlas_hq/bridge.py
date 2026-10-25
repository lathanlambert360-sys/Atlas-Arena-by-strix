#!/usr/bin/env python3
"""Independent, local-only Atlas HQ telemetry bridge.

This is a storage and display adapter, NOT an autonomous scanning agent.
It never executes a supplied command. Browser GETs read local SQLite state.
POST /api/event requires a per-user token and an existing authorized run.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import sqlite3
import chat_backend
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

MAX_BODY = 1024 * 1024
HOME = Path.home() / ".atlas-hq"
DEFAULT_DB = HOME / "runs.sqlite3"
DEFAULT_TOKEN = HOME / "ingest-token"
SITE = Path(__file__).resolve().parents[1] / "strix" / "interface" / "viewer" / "static"


def now():
    return datetime.now(timezone.utc).isoformat()


def connect(db):
    conn = sqlite3.connect(db, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS runs (
      name TEXT PRIMARY KEY, raw TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0,
      report TEXT, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      run TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (run, id)
    );
    CREATE TABLE IF NOT EXISTS events (
      run TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (run, id)
    );
    CREATE TABLE IF NOT EXISTS findings (
      run TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (run, id)
    );
    """)
    return conn


def decode(value):
    return json.loads(value)


def live_integrations():
    """Connection evidence only. Never run CLI commands or read authentication secrets."""
    entries = {}
    def mark(name, status, detail):
        entries[name] = {"status": status, "detail": detail}
    mark("kali", "connected", "Local SQLite event ingestion is available")
    try:
        with urlopen("http://127.0.0.1:8888/health", timeout=0.8) as reply:
            result = json.load(reply)
        ok = isinstance(result, dict) and result.get("healthy") is True
        mark("hexstrike", "connected" if ok else "error", "Loopback HexStrike API returned health status")
    except (URLError, HTTPError, TimeoutError, ValueError, OSError, json.JSONDecodeError):
        mark("hexstrike", "offline", "HexStrike local health endpoint is not responding")
    def available(tool, *candidates):
        return bool(shutil.which(tool) or any(Path(x).expanduser().is_file() for x in candidates))
    codex_ready = chat_backend.auth_status()
    mark("codex", "connected" if codex_ready else ("installed" if available("codex") else "missing"), "Local Codex CLI signed in" if codex_ready else "Local Codex CLI login required")
    mark("github", "installed" if available("gh") else "missing", "GitHub CLI; does not imply authenticated access")
    mark("rea", "installed" if available("rea", "~/tools/rea-skill-cli/node_modules/.bin/rea") else "missing", "REA CLI executable")
    for name, rel in (
        ("bugtraceai", "tools/BugTraceAI-CLI"),
        ("adstrike", "tools/AdStrike"),
    ):
        mark(name, "source_present" if (Path.home()/rel).is_dir() else "missing", "Repository present; MCP service registration not verified")
    mark("strix", "not_connected", "Independent dashboard has no Strix service dependency")
    return entries


def blank_run():
    return {
        "run_id": None, "run_name": "ATLAS HQ", "status": "idle",
        "scan_mode": None, "targets_info": [], "finished": True,
        "start_time": None, "end_time": None, "mcp_connection_status": [],
        "scan_results": {
            "executive_summary": "No run has been ingested. This independent local dashboard does not initiate scans.",
            "technical_analysis": None, "methodology": None, "recommendations": None,
        },
    }


def choose_run(db, name):
    if name:
        return db.execute("SELECT * FROM runs WHERE name=?", (name,)).fetchone()
    return db.execute("SELECT * FROM runs ORDER BY updated DESC LIMIT 1").fetchone()


def summarize_run(row, db):
    raw = decode(row["raw"])
    severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for finding in db.execute("SELECT data FROM findings WHERE run=?", (row["name"],)):
        s = str(decode(finding["data"]).get("severity", "low")).lower()
        severity[s if s in severity else "low"] += 1
    targets = raw.get("targets_info") or []
    target = (targets[0].get("original") if targets and isinstance(targets[0], dict) else None)
    return {
        "name": row["name"], "target": target, "scan_mode": raw.get("scan_mode"),
        "status": raw.get("status"), "start_time": raw.get("start_time"),
        "end_time": raw.get("end_time"), "finished": bool(row["finished"]),
        "severity_counts": severity,
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "AtlasHQ/1.0"

    def log_message(self, fmt, *args):
        # Do not log private target details, command output or ingest headers.
        if os.environ.get("ATLAS_HQ_ACCESS_LOG") == "1":
            super().log_message(fmt, *args)

    def reply(self, status, body):
        data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        query_token = parse_qs(url.query).get("token", [None])[0]
        if query_token and secrets.compare_digest(query_token, self.server.token):
            self.send_response(303)
            self.send_header("Location", url.path or "/")
            self.send_header("Set-Cookie", "atlas_hq_session=" + self.server.token + "; Path=/; HttpOnly; SameSite=Strict")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
            session = cookies["atlas_hq_session"].value if "atlas_hq_session" in cookies else ""
        except Exception:
            session = ""
        header_token = self.headers.get("X-Atlas-HQ-Token", "")
        if not (secrets.compare_digest(session, self.server.token) or secrets.compare_digest(header_token, self.server.token)):
            return self.reply(403, {"ok": False, "error": "viewer_session_required"})
        if not url.path.startswith("/api/"):
            if url.path not in ("/", "/index.html") and not (self.directory and (Path(self.directory) / url.path.lstrip("/")).is_file()):
                self.path = "/index.html"
            return super().do_GET()
        endpoint = url.path[5:]
        args = parse_qs(url.query)
        name = args.get("run", [None])[0]
        with connect(self.server.db) as db:
            row = choose_run(db, name)
            if name and row is None and endpoint in ("run", "transcript", "vulnerabilities", "report"):
                return self.reply(404, {"error": "run_not_found"})
            if endpoint == "chat":
                return self.reply(200, chat_backend.state(self.server.db))
            if endpoint in ("health", "integrations"):
                integrations = live_integrations()
                if endpoint == "integrations":
                    return self.reply(200, {"integrations": integrations, "timestamp": now()})
                return self.reply(200, {"service": "atlas-hq", "status": "online", "execution": "collector_only",
                    "connectors": {k: v["status"] for k,v in integrations.items()}})
            if endpoint == "run":
                return self.reply(200, decode(row["raw"]) if row else blank_run())
            if endpoint == "runs":
                records = db.execute("SELECT * FROM runs ORDER BY updated DESC").fetchall()
                return self.reply(200, {"locked": False, "count": len(records), "runs": [summarize_run(r, db) for r in records]})
            if endpoint == "vulnerabilities":
                return self.reply(200, [decode(r["data"]) for r in db.execute(
                    "SELECT data FROM findings WHERE run=? ORDER BY rowid", (row["name"],))] if row else [])
            if endpoint == "transcript":
                if not row:
                    return self.reply(200, {"agents": [], "events": []})
                agents = [decode(r["data"]) for r in db.execute("SELECT data FROM agents WHERE run=? ORDER BY rowid", (row["name"],))]
                events = [decode(r["data"]) for r in db.execute("SELECT data FROM events WHERE run=? ORDER BY rowid", (row["name"],))]
                return self.reply(200, {"agents": agents, "events": events})
            if endpoint == "report":
                return self.reply(200, {"markdown": row["report"] if row else None})
            if endpoint == "capabilities":
                return self.reply(200, {"can_steer": False})
            if endpoint == "auth/status":
                return self.reply(200, {"verified": False, "email": None})
        return self.reply(404, {"error": "route_not_found"})

    def do_POST(self):
        endpoint = urlsplit(self.path).path
        if endpoint in ("/api/chat", "/api/chat/auth/start"):
            # Chat actions require the local browser session and a same-origin POST.
            cookies = SimpleCookie()
            try:
                cookies.load(self.headers.get("Cookie", ""))
                session = cookies["atlas_hq_session"].value if "atlas_hq_session" in cookies else ""
            except Exception:
                session = ""
            if not secrets.compare_digest(session, self.server.token):
                return self.reply(403, {"ok": False, "error": "local_viewer_session_required"})
            origin = self.headers.get("Origin", "")
            allowed = {"http://127.0.0.1:" + str(self.server.server_port),
                       "http://localhost:" + str(self.server.server_port)}
            public_origin = os.environ.get("ATLAS_HQ_PUBLIC_ORIGIN", "").rstrip("/")
            if public_origin.startswith("https://") and public_origin.count("/") == 2:
                allowed.add(public_origin)
            if origin not in allowed:
                return self.reply(403, {"ok": False, "error": "same_origin_required"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 2 <= size <= 20000:
                    return self.reply(413, {"ok": False, "error": "invalid_message_size"})
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    return self.reply(400, {"ok": False, "error": "invalid_body"})
            except (ValueError, json.JSONDecodeError):
                return self.reply(400, {"ok": False, "error": "invalid_body"})
            if endpoint == "/api/chat/auth/start":
                ok, msg = chat_backend.device_auth_start()
                return self.reply(200 if ok else 503, {"ok": ok, "message": msg})
            code, result = chat_backend.send(self.server.db, self.server.chat_workspace,
                                             payload.get("message"))
            return self.reply(code, result)
        if endpoint != "/api/event":
            return self.reply(503, {"ok": False, "error": "independent_execution_or_email_backend_not_configured"})
        if not secrets.compare_digest(self.headers.get("X-Atlas-HQ-Token", ""), self.server.token):
            return self.reply(403, {"ok": False, "error": "invalid_ingest_token"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400, {"ok": False, "error": "invalid_content_length"})
        if not 1 <= size <= MAX_BODY:
            return self.reply(413, {"ok": False, "error": "invalid_payload_size"})
        try:
            obj = json.loads(self.rfile.read(size))
            if not isinstance(obj, dict):
                raise ValueError("Envelope must be an object")
            name = obj.get("run")
            kind = obj.get("kind")
            data = obj.get("data")
            if not isinstance(name, str) or not (1 <= len(name) <= 100) or any(c in name for c in "/\\\\"):
                raise ValueError("Invalid run identifier")
            if kind not in ("run", "agent", "tool", "chat", "finding", "report"):
                raise ValueError("Unknown event kind")
            if not isinstance(data, dict):
                raise ValueError("Event data must be an object")
            with connect(self.server.db) as db:
                old = choose_run(db, name)
                if kind != "run" and old is None:
                    raise ValueError("Initialize an authorized run before appending events")
                if kind == "run":
                    targets = data.get("targets_info")
                    if not isinstance(targets, list) or not targets or not all(isinstance(t, dict) and isinstance(t.get("original"), str) and t["original"] for t in targets):
                        raise ValueError("Run must include at least one explicit authorized target")
                    raw = dict(data)
                    raw.setdefault("run_id", name)
                    raw.setdefault("run_name", name)
                    raw.setdefault("start_time", now())
                    raw.setdefault("scan_mode", "manual")
                    raw.setdefault("status", "running")
                    raw.setdefault("mcp_connection_status", [])
                    raw.setdefault("scan_results", {})
                    raw.setdefault("finished", False)
                    db.execute("INSERT INTO runs(name,raw,finished,updated) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET raw=excluded.raw,finished=excluded.finished,updated=excluded.updated",
                               (name, json.dumps(raw), int(raw["finished"] is True), now()))
                elif kind == "report":
                    content = data.get("markdown")
                    if not isinstance(content, str):
                        raise ValueError("Report markdown must be text")
                    db.execute("UPDATE runs SET report=?,updated=? WHERE name=?", (content, now(), name))
                else:
                    ident = data.get("id")
                    if not isinstance(ident, str) or not ident or len(ident) > 150:
                        raise ValueError("Event id is required (1-150 characters)")
                    payload = dict(data)
                    if kind == "agent":
                        payload.setdefault("name", ident)
                        payload.setdefault("parent_id", None)
                        payload.setdefault("status", "running")
                        payload.setdefault("created_at", now())
                        payload.setdefault("updated_at", now())
                        table = "agents"
                    elif kind in ("tool", "chat"):
                        if not isinstance(payload.get("agent_id"), str) or not payload["agent_id"]:
                            raise ValueError("agent_id is required")
                        payload["type"] = "tool" if kind == "tool" else "chat"
                        payload.setdefault("timestamp", now())
                        payload.setdefault("version", 1)
                        payload.setdefault("data", {})
                        table = "events"
                    else:
                        payload.setdefault("timestamp", now())
                        table = "findings"
                    db.execute(f"INSERT INTO {table}(run,id,data) VALUES(?,?,?) ON CONFLICT(run,id) DO UPDATE SET data=excluded.data",
                               (name, ident, json.dumps(payload)))
                    db.execute("UPDATE runs SET updated=? WHERE name=?", (now(), name))
            return self.reply(200, {"ok": True, "run": name, "kind": kind})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self.reply(400, {"ok": False, "error": str(exc)})


def main():
    ap = argparse.ArgumentParser(description="Local-only Atlas HQ viewer + event bridge")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--site", type=Path, default=SITE)
    ap.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN)
    args = ap.parse_args()
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        ap.error("This bridge is local-only. Use an explicitly secured reverse proxy for remote access.")
    if not args.site.is_dir() or not (args.site / "index.html").is_file():
        ap.error(f"Frontend is not built at {args.site}. Build frontend once with npm ci && npm run build.")
    args.db.parent.mkdir(parents=True, exist_ok=True)
    args.token_file.parent.mkdir(parents=True, exist_ok=True)
    if not args.token_file.exists():
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        fd = os.open(args.token_file, flags, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(secrets.token_urlsafe(32))
    token = args.token_file.read_text().strip()
    if len(token) < 20:
        ap.error("Ingest token is invalid or too short")
    with connect(args.db):
        pass
    with chat_backend.connect(args.db):
        pass
    handler = partial(Handler, directory=str(args.site.resolve()))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.db = args.db
    server.token = token
    server.chat_workspace = Path(__file__).resolve().parents[1]
    print(f"Atlas HQ independent local viewer: http://127.0.0.1:{args.port}/?token={token}", flush=True)
    print("Data stays in", args.db, "- event ingestion requires the local token file", flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
