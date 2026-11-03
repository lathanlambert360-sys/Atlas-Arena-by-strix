#!/usr/bin/env python3
"""Local Atlas HQ chat: authenticated browser -> read-only Codex CLI.

The user's ChatGPT conversation and ChatGPT-hosted Strix MCP connector cannot be
transferred through this backend. Codex uses its own local login and session.
No API keys or shell-command parameters are accepted through the HTTP API.
"""
from __future__ import annotations
import json
import atlas_tools
import atlas_actions
import mcp_client
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
ORCA_CHECK = {"verified": False, "checked": False, "error": None}

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
            "model":ORCA_MODEL if orca_ready() else None,
            "model_check":dict(ORCA_CHECK),
            "reference_archives":atlas_tools.references(),
            "mcp":mcp_client.inspect(),
            "tool_requests":atlas_actions.pending(db),
            "sandbox":"read-only"}

def send(db, workspace, message):
    if not isinstance(message,str) or not (1 <= len(message.strip()) <= 5000):
        return 400, {"ok":False,"error":"Message must be 1-5000 characters"}
    use_orca = orca_ready()
    if message.lstrip().startswith("/atlas "):
        return _local_command(db,message.strip())
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


def _local_command(db,command):
    """Actual local observations / original ZIP documents."""
    parts=command.split(" ",3)
    mode=parts[1].lower() if len(parts)>1 else ""
    try:
        if mode=="status":
            answer=json.dumps(atlas_tools.status(),indent=2,ensure_ascii=False)[:MAX_CONTENT]
        elif mode=="refs":
            if len(parts)>2 and parts[2] in atlas_tools.ARCHIVES:
                answer="\n".join(atlas_tools.inventory(parts[2]))[:MAX_CONTENT]
            else:
                answer=json.dumps(atlas_tools.references(),indent=2)[:MAX_CONTENT]
        elif mode=="read":
            if len(parts)<4:raise ValueError("Usage: /atlas read <archive-id> <member-path>")
            answer=atlas_tools.read_reference(parts[2],parts[3])
        else:
            answer="Commands: /atlas status | /atlas refs | /atlas refs <archive-id> | /atlas read <archive-id> <member-path>"
    except (ValueError,KeyError,FileNotFoundError,OSError) as exc:
        answer="Atlas resource error: "+str(exc)[:250]
    with LOCK:
        with connect(db) as con:
            for role,content in (("user",command),("assistant",answer)):
                con.execute("INSERT INTO atlas_chat_message(id,role,content,created) VALUES(?,?,?,?)",
                           (("usr-" if role=="user" else "ast-")+uuid.uuid4().hex,role,content,utcnow()))
    return 202,{"ok":True,"accepted":True}

def _references_for_model():
    """Actual document excerpts; original archive bytes stay untouched."""
    summaries=[]
    for record in atlas_tools.references():
        name=record["id"]
        if not record.get("available"):
            summaries.append(name+": not found on Kali")
            continue
        files=atlas_tools.inventory(name)
        candidates=[p for p in files if p.lower().endswith(("readme.md","skill.md"))]
        selection=candidates[:1] or files[:1]
        extracts=[]
        for member in selection:
            try: extracts.append("FILE "+member+"\n"+atlas_tools.read_reference(name,member,2100))
            except (ValueError,KeyError,OSError):pass
        summaries.append(name+": "+str(record.get("documents",0))+" files; "+", ".join(files[:8])+"\n"+"\n".join(extracts))
    return "\n\n".join(summaries)[:12000]

def _orca_worker(db):
    """Remote reasoning through OrcaRouter; no shell execution or scans."""
    with connect(db) as con:
        history = [dict(r) for r in con.execute(
            "SELECT role,content FROM atlas_chat_message ORDER BY rowid DESC LIMIT 24"
        ).fetchall()]
    evidence = atlas_tools.status()
    mcp = mcp_client.inspect()
    references = _references_for_model()
    messages = [{"role":"system","content":(
        "You are Atlas HQ's cybersecurity research assistant. "
        "Complement your own cyber harness with the BlackHAT Roadmap, "
        "Hacker Scripts, Hacker Laws and Security Audit references when provided. "
        "Use evidence-first reasoning for authorized bug-bounty projects; "
        "distinguish confirmed tests from hypotheses and do not invent tool output. "
        "Keep answers concise and directly responsive. "
        "Real local integration observations: "+json.dumps(evidence,ensure_ascii=False)[:6000]+
        "\nLive HexStrike MCP tool inventory: "+json.dumps(mcp,ensure_ascii=False)[:7500]+
        "\nOriginal reference document excerpts:\n"+references+
        "\nThe dashboard supports /atlas status, /atlas refs <id>, "
        "and /atlas read <id> <member-path>. "
        "When an MCP tool is needed, propose ONE JSON request in this format: "
        '<atlas_tool>{"name":"nmap_scan","arguments":{"target":"authorized.example"},'
        '"reason":"why the test matters"}</atlas_tool>. '
        "Use only tools named in the live inventory. Never claim to have run a tool "
        "until real tool output appears in the conversation. Operator approval is required."
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
        queued = atlas_actions.propose(db,answer) if isinstance(answer,str) else None
        if queued:
            answer += "\n\nHexStrike MCP tool call awaiting operator approval: "+queued
        with LOCK:
            ORCA_CHECK.update(verified=True,checked=True,error=None)
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

def test_orca():
    """Explicit on-demand API handshake. Does not alter saved chat history."""
    if not orca_ready():
        return 409, {"ok":False,"error":"OrcaRouter API key is not configured"}
    body = json.dumps({"model":ORCA_MODEL,"stream":False,"max_tokens":30,
        "messages":[{"role":"user","content":"Reply with OK."}]}).encode("utf-8")
    request = Request(ORCA_URL, method="POST", data=body, headers={
        "Authorization":"Bearer "+os.environ["ORCAROUTER_API_KEY"].strip(),
        "Content-Type":"application/json","Accept":"application/json"})
    try:
        with urlopen(request,timeout=35) as response:
            result=json.load(response)
        content=result["choices"][0]["message"]["content"]
        if not isinstance(content,str) or not content.strip():
            raise ValueError("Empty model response")
        with LOCK:
            ORCA_CHECK.update(verified=True,checked=True,error=None)
        return 200, {"ok":True,"verified":True,"model":ORCA_MODEL,"reply":content[:120]}
    except HTTPError as exc:
        error = "OrcaRouter HTTP "+str(exc.code)
    except (URLError, TimeoutError, KeyError, ValueError, OSError, TypeError, IndexError) as exc:
        error = "OrcaRouter request failed ("+type(exc).__name__+")"
    with LOCK:
        ORCA_CHECK.update(verified=False,checked=True,error=error)
    return 502, {"ok":False,"verified":False,"error":error}
