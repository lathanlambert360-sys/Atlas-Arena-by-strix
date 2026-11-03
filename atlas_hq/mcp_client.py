"""Minimal localhost-only MCP streamable HTTP client for Atlas HQ.

Supports MCP initialize, tools/list and tools/call. All invocations originate
from operator-approved Atlas dashboard actions.
"""
import json
import os
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ENDPOINT = os.environ.get("ATLAS_HEX_MCP_URL","http://127.0.0.1:8000/mcp")
LOCK=threading.RLock()
VERSION="2025-03-26"
CACHE={"time":0.0,"result":None}

def parse(body,content_type):
    if "text/event-stream" in content_type:
        events=[]
        for block in body.replace("\r\n","\n").split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data:"):
                    try:events.append(json.loads(line[5:].strip()))
                    except ValueError:pass
        return next((item for item in reversed(events) if "result" in item or "error" in item),{})
    return json.loads(body) if body.strip() else {}

def request(method,params=None,session=None,notification=False):
    headers={"Content-Type":"application/json",
             "Accept":"application/json, text/event-stream",
             "MCP-Protocol-Version":VERSION}
    if session:headers["Mcp-Session-Id"]=session
    payload={"jsonrpc":"2.0","method":method}
    if not notification:
        payload["id"]=7
    if params is not None:payload["params"]=params
    req=Request(ENDPOINT,data=json.dumps(payload).encode(),headers=headers,method="POST")
    with urlopen(req,timeout=(90 if method=='tools/call' else 4)) as resp:
        body=resp.read(2_000_000).decode("utf-8","replace")
        return parse(body,resp.headers.get("Content-Type","")),resp.headers.get("Mcp-Session-Id",session)

def session():
    init,session_id=request("initialize",{
        "protocolVersion":VERSION,
        "capabilities":{},
        "clientInfo":{"name":"Atlas-Arena","version":"1.0"}
    })
    if "error" in init:raise RuntimeError("MCP initialization rejected")
    request("notifications/initialized",session=session_id,notification=True)
    return session_id

def list_tools():
    with LOCK:
        active=session()
        output,_=request("tools/list",session=active)
    if output.get("error"):raise RuntimeError("MCP tools/list rejected")
    return output.get("result",{}).get("tools",[])

def call_tool(name,arguments):
    with LOCK:
        active=session()
        output,_=request("tools/call",{"name":name,"arguments":arguments},active)
    if output.get("error"):raise RuntimeError("MCP tools/call rejected")
    return output.get("result",{})

def inspect():
    if CACHE["result"] is not None and time.monotonic()-CACHE["time"]<45:
        return CACHE["result"]
    try:
        names=[t.get("name","") for t in list_tools()]
        result={"connected":True,"count":len(names),"tools":names[:175]}
    except (HTTPError,URLError,RuntimeError,ValueError,OSError,TimeoutError) as exc:
        result={"connected":False,"error":type(exc).__name__,"detail":str(exc)[:180]}
    CACHE.update(time=time.monotonic(),result=result)
    return result
