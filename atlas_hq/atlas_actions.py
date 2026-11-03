"""Explicitly approved Atlas <-> HexStrike MCP tool dispatch, with SQLite evidence."""
import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

MAX_EVIDENCE=18000
NAME=re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,90}$")
REQUEST=re.compile(r"<atlas_tool>\s*(\{.*?\})\s*</atlas_tool>",re.DOTALL)
LOCK=threading.RLock()

def now():
    return datetime.now(timezone.utc).isoformat()

def connect(db):
    c=sqlite3.connect(db,timeout=12)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA busy_timeout=12000")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS atlas_tool_requests(
      id TEXT PRIMARY KEY, tool TEXT NOT NULL, arguments TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
      result TEXT
    );
    """)
    return c

def pending(db):
    with connect(db) as c:
        return [dict(r) for r in c.execute(
            "SELECT id,tool,arguments,reason,status,created,result "
            "FROM atlas_tool_requests WHERE status IN ('pending','running') "
            "ORDER BY rowid DESC LIMIT 5")]

def propose(db,text):
    match=REQUEST.search(text)
    if not match:return None
    try:
        doc=json.loads(match.group(1))
        name=doc["name"]
        args=doc["arguments"]
        why=str(doc.get("reason","Requested by Atlas"))[:450]
        if not isinstance(name,str) or not NAME.fullmatch(name) or not isinstance(args,dict):
            return None
        if len(json.dumps(args))>8500:return None
    except (ValueError,TypeError,KeyError):
        return None
    ident="hex-"+uuid.uuid4().hex
    with connect(db) as c:
        c.execute("INSERT INTO atlas_tool_requests(id,tool,arguments,reason,status,created)"
                  " VALUES(?,?,?,?,?,?)",
                  (ident,name,json.dumps(args,ensure_ascii=False),why,"pending",now()))
    return ident

def decide(db,ident,approved,worker_callback):
    with LOCK:
        with connect(db) as c:
            record=c.execute("SELECT * FROM atlas_tool_requests WHERE id=? AND status='pending'",
                             (ident,)).fetchone()
            if record is None:return 404,{"ok":False,"error":"Request unavailable"}
            if not approved:
                c.execute("UPDATE atlas_tool_requests SET status='rejected' WHERE id=?",(ident,))
                return 200,{"ok":True,"status":"rejected"}
            c.execute("UPDATE atlas_tool_requests SET status='running' WHERE id=?",(ident,))
            args=json.loads(record["arguments"])
            name=record["tool"]
        threading.Thread(target=_execute,args=(str(db),ident,name,args,worker_callback),daemon=True).start()
    return 202,{"ok":True,"status":"running"}

def _execute(db,ident,name,params,worker_callback):
    import mcp_client
    try:
        inventory=mcp_client.list_tools()
        if name not in [t.get("name") for t in inventory]:
            raise ValueError("Tool not advertised by connected HexStrike MCP bridge")
        data=mcp_client.call_tool(name,params)
        result=json.dumps(data,ensure_ascii=False)[:MAX_EVIDENCE]
        status="completed"
    except Exception as exc:
        result="HexStrike MCP call failed: "+type(exc).__name__+": "+str(exc)[:250]
        status="failed"
    with connect(db) as c:
        c.execute("UPDATE atlas_tool_requests SET status=?,result=? WHERE id=?",
                  (status,result,ident))
        c.execute("INSERT INTO atlas_chat_message(id,role,content,created) VALUES(?,?,?,?)",
                  ("ast-"+uuid.uuid4().hex,"assistant",
                   "Verified HexStrike MCP tool result for "+name+":\n"+result,now()))
        c.execute("UPDATE atlas_chat_session SET status='idle',error=NULL,updated=? WHERE id=1",(now(),))
    # The observed result is now in persistent chat context for OrcaCyber.
    # The user can send the next message to continue analysis.
