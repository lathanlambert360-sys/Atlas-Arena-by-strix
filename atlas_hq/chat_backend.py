#!/usr/bin/env python3
"""Local Atlas HQ chat: authenticated browser -> read-only Codex CLI.

The user's ChatGPT conversation and ChatGPT-hosted Strix MCP connector cannot be
transferred through this backend. Codex uses its own local login and session.
No API keys or shell-command parameters are accepted through the HTTP API.
"""
from __future__ import annotations
import json
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

LOCK = threading.RLock()
AUTH = {"process": None, "lines": [], "checked": 0.0, "logged_in": False}
MAX_MESSAGES = 500
MAX_CONTENT = 12000
ORCA_URL = "https://api.orcarouter.ai/v1/chat/completions"
ORCA_MODEL = "orca/orcacyber-flash-1.0-free"

def orca_ready():
    return bool(os.environ.get("ORCAROUTER_API_KEY", "").strip())

def utcnow():
    return datetime.now(timezone.utc).isoformat()

def connect(db):
    con = sqlite3.connect(db, timeout=12)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=12000")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS atlas_chat_session(
      id INTEGER PRIMARY KEY CHECK(id=1), thread TEXT, status TEXT NOT NULL,
      error TEXT, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS atlas_chat_message(
      id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
      created TEXT NOT NULL
    );
    INSERT OR IGNORE INTO atlas_chat_session(id,thread,status,error,updated)
      VALUES(1,NULL,'idle',NULL,'');
    """)
    return con

def codex_exe():
    return shutil.which("codex")

def auth_status(force=False):
    with LOCK:
        current = time.monotonic()
        if force or current-AUTH["checked"]>8:
            exe = codex_exe()
            try:
                check = subprocess.run([exe, "login", "status"], capture_output=True,
                                       text=True, timeout=7) if exe else None
                AUTH["logged_in"] = bool(check and check.returncode==0 and
                                         "logged in" in check.stdout.lower() and
                                         "not logged in" not in check.stdout.lower())
            except (OSError, subprocess.TimeoutExpired):
                AUTH["logged_in"] = False
            AUTH["checked"] = current
        return bool(AUTH["logged_in"])

def device_auth_start():
    exe = codex_exe()
    if not exe:
        return False, "Codex CLI is not installed"
    with LOCK:
        proc = AUTH["process"]
        if proc is not None and proc.poll() is None:
            return True, "Device login is already running"
        AUTH["lines"] = []
        AUTH["checked"] = 0
        try:
            proc = subprocess.Popen([exe,"login","--device-auth"], stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
                stdin=subprocess.DEVNULL)
        except OSError as exc:
            return False, str(exc)
        AUTH["process"] = proc
        threading.Thread(target=_read_auth, args=(proc,), daemon=True).start()
        return True, "Device login started"

def _read_auth(proc):
    try:
        for ln in proc.stdout:
            with LOCK:
                AUTH["lines"].append(ln.rstrip()[:500])
                AUTH["lines"] = AUTH["lines"][-16:]
        proc.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        pass
    finally:
        with LOCK:
            AUTH["checked"] = 0

def state(db):
    with connect(db) as con:
        row = con.execute("SELECT thread,status,error,updated FROM atlas_chat_session WHERE id=1").fetchone()
        msgs = [dict(r) for r in con.execute(
            "SELECT id,role,content,created FROM atlas_chat_message ORDER BY rowid DESC LIMIT ?",(MAX_MESSAGES,)
        ).fetchall()]
    with LOCK:
        proc=AUTH["process"]
        device={"running":bool(proc and proc.poll() is None),
                "output":"\n".join(AUTH["lines"])[-2800:]}
    return {"available":orca_ready() or bool(codex_exe()),"authenticated":(True if orca_ready() else auth_status()),
            "session":{"status":row["status"],"updated":row["updated"],"error":row["error"]},
            "messages":list(reversed(msgs)),"device_auth":device,
            "engine":("OrcaCyber Flash (OrcaRouter)" if orca_ready() else "Local Codex CLI"),
            "provider":("orca" if orca_ready() else "codex"),
            "sandbox":"read-only"}

def send(db, workspace, message):
    if not isinstance(message,str) or not (1 <= len(message.strip()) <= 5000):
        return 400, {"ok":False,"error":"Message must be 1-5000 characters"}
    use_orca = orca_ready()
    if not use_orca and not auth_status(force=True):
        return 409, {"ok":False,"error":"OrcaRouter key missing and Codex is not signed in."}
    with LOCK:
        with connect(db) as con:
            row=con.execute("SELECT thread,status FROM atlas_chat_session WHERE id=1").fetchone()
            if row["status"] == "running":
                return 409, {"ok":False,"error":"Codex is answering the previous message"}
            ident="usr-"+uuid.uuid4().hex
            con.execute("INSERT INTO atlas_chat_message(id,role,content,created) VALUES(?,?,?,?)",
                        (ident,"user",message.strip(),utcnow()))
            con.execute("UPDATE atlas_chat_session SET status='running',error=NULL,updated=? WHERE id=1",(utcnow(),))
            previous_thread=row["thread"]
        if use_orca:
            target = _orca_worker
            arguments = (str(db),)
        else:
            target = _worker
            arguments = (str(db),str(workspace),previous_thread,message.strip())
        threading.Thread(target=target,args=arguments,daemon=True).start()
    return 202, {"ok":True,"accepted":True}

def _worker(db, workspace, session_id, user_prompt):
    exe=codex_exe()
    workdir=Path(workspace).resolve()
    if session_id:
        args=[exe,"exec","resume","--json","-c",'sandbox_mode="read-only"',
              "--skip-git-repo-check",session_id,"-"]
        prompt=user_prompt
    else:
        args=[exe,"exec","--json","--sandbox","read-only","-C",str(workdir),
              "--skip-git-repo-check","-"]
        prompt=(
            "You are Atlas HQ's locally authenticated Codex coding assistant. "
            "This is a NEW local session, not the user's current ChatGPT conversation. "
            "You can read available local repository files and reason about authorized projects. "
            "Do not start security scans or contact targets without their exact authorized scope. "
            "The workspace is read-only; tell the user when an operation requires separate permission. "
            "Prioritize short clear answers and state what you actually executed.\n\n"+
            user_prompt
        )
    output=[]
    thread_id=session_id
    errs=[]
    proc=None
    try:
        proc=subprocess.Popen(args, cwd=str(workdir), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        def errors():
            for ln in proc.stderr:
                if len(errs)<24:errs.append(ln.strip()[:240])
        threading.Thread(target=errors,daemon=True).start()
        proc.stdin.write(prompt)
        proc.stdin.close()
        started=time.monotonic()
        for line in proc.stdout:
            if time.monotonic()-started>240:
                proc.terminate()
                raise TimeoutError("Codex exceeded the four-minute per-turn limit")
            try: ev=json.loads(line)
            except json.JSONDecodeError:continue
            if not isinstance(ev,dict):continue
            if ev.get("type")=="thread.started" and isinstance(ev.get("thread_id"),str):
                thread_id=ev["thread_id"]
                with connect(db) as con:
                    con.execute("UPDATE atlas_chat_session SET thread=?,updated=? WHERE id=1",
                                (thread_id,utcnow()))
            if ev.get("type")=="item.completed" and isinstance(ev.get("item"),dict):
                item=ev["item"]
                if item.get("type")=="agent_message":
                    output.append(str(item.get("text") or ""))
            if ev.get("type")=="turn.failed":
                errs.append(str(ev.get("error",{}))[:500])
        code=proc.wait(timeout=6)
        if code:
            raise RuntimeError("Codex exited with code "+str(code)+": "+"; ".join(errs[-2:]))
        answer="\n\n".join(s for s in output if s.strip()).strip() or "Codex completed without a text response."
        if len(answer)>MAX_CONTENT:answer=answer[:MAX_CONTENT]+"\n[output truncated]"
        with connect(db) as con:
            con.execute("INSERT INTO atlas_chat_message(id,role,content,created) VALUES(?,?,?,?)",
                        ("ast-"+uuid.uuid4().hex,"assistant",answer,utcnow()))
            con.execute("UPDATE atlas_chat_session SET status='idle',error=NULL,thread=?,updated=? WHERE id=1",
                        (thread_id,utcnow()))
    except Exception as exc:
        with connect(db) as con:
            con.execute("UPDATE atlas_chat_session SET status='failed',error=?,thread=?,updated=? WHERE id=1",
                        (str(exc)[:450],thread_id,utcnow()))
    finally:
        if proc is not None and proc.poll() is None:proc.kill()


def _orca_worker(db):
    """Remote reasoning through OrcaRouter; no shell execution or scans."""
    with connect(db) as con:
        history = [dict(r) for r in con.execute(
            "SELECT role,content FROM atlas_chat_message ORDER BY rowid DESC LIMIT 24"
        ).fetchall()]
    messages = [{"role":"system","content":(
        "You are Atlas HQ's cybersecurity research assistant. "
        "Complement your own cyber harness with the BlackHAT Roadmap, "
        "Hacker Scripts, Hacker Laws and Security Audit references when provided. "
        "Use evidence-first reasoning for authorized bug-bounty projects; "
        "distinguish confirmed tests from hypotheses and do not invent tool output. "
        "Keep answers concise and directly responsive."
    )}] + list(reversed(history))
    payload = json.dumps({"model":ORCA_MODEL,"messages":messages,
                          "stream":False}).encode("utf-8")
    try:
        key = os.environ["ORCAROUTER_API_KEY"].strip()
        req = Request(ORCA_URL,data=payload,method="POST",headers={
            "Authorization":"Bearer "+key,
            "Content-Type":"application/json",
            "Accept":"application/json"
        })
        with urlopen(req,timeout=120) as reply:
            response = json.load(reply)
        answer = response["choices"][0]["message"]["content"]
        if not isinstance(answer,str) or not answer.strip():
            raise ValueError("OrcaRouter returned an empty text response")
        with connect(db) as con:
            con.execute("INSERT INTO atlas_chat_message(id,role,content,created) VALUES(?,?,?,?)",
                        ("ast-"+uuid.uuid4().hex,"assistant",answer[:MAX_CONTENT],utcnow()))
            con.execute("UPDATE atlas_chat_session SET status='idle',error=NULL,updated=? WHERE id=1",(utcnow(),))
    except HTTPError as exc:
        # Never echo API keys, authorization headers, or provider response bodies.
        error = "OrcaRouter HTTP "+str(exc.code)
        with connect(db) as con:
            con.execute("UPDATE atlas_chat_session SET status='failed',error=?,updated=? WHERE id=1",
                        (error,utcnow()))
    except (URLError, TimeoutError, KeyError, ValueError, OSError, TypeError, IndexError) as exc:
        error = "OrcaRouter request failed: "+type(exc).__name__
        with connect(db) as con:
            con.execute("UPDATE atlas_chat_session SET status='failed',error=?,updated=? WHERE id=1",
                        (error,utcnow()))
