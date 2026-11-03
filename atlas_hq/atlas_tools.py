"""Local Atlas dashboard telemetry and unchanged ZIP reference access."""
import json
import socket
import zipfile
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

ROOT=Path.home()/"orcacyber"/"references"
ARCHIVES={
    "blackhat-roadmap":"The-BlackHAT-roadmap-main(8).zip",
    "hacker-scripts":"hacker-scripts-master(2).zip",
    "hacker-laws":"hacker-laws-main(3).zip",
    "security-audit":"security-audit-skill-main(10).zip",
}

def references():
    result=[]
    for name,fn in ARCHIVES.items():
        p=ROOT/fn
        item={"id":name,"available":p.is_file()}
        if p.is_file():
            try:
                with zipfile.ZipFile(p) as z:
                    docs=[s for s in z.namelist() if s.lower().endswith((".md",".txt",".rst"))]
                    item["documents"]=len(docs)
                    item["sample_paths"]=docs[:25]
            except (OSError,zipfile.BadZipFile):
                item["available"]=False
        result.append(item)
    return result

def read_reference(name,member,limit=14000):
    if name not in ARCHIVES:raise ValueError("Unknown archive")
    with zipfile.ZipFile(ROOT/ARCHIVES[name]) as z:
        item=z.getinfo(member)
        if item.file_size>1_000_000 or not member.lower().endswith((".md",".txt",".rst")):
            raise ValueError("Unsupported document")
        return z.read(member).decode("utf-8","replace")[:limit]

def inventory(name):
    if name not in ARCHIVES:raise ValueError("Unknown archive")
    with zipfile.ZipFile(ROOT/ARCHIVES[name]) as z:
        return [p for p in z.namelist() if p.lower().endswith((".md",".txt",".rst"))][:250]

def probe(url):
    try:
        with urlopen(url,timeout=3) as res:
            raw=res.read(350000)
            try:return {"connected":True,"response":json.loads(raw)}
            except ValueError:return {"connected":True,"http":res.status}
    except (URLError,HTTPError,OSError,TimeoutError) as exc:
        return {"connected":False,"error":type(exc).__name__}

def status():
    with socket.socket() as sock:
        sock.settimeout(1)
        try:
            sock.connect(("127.0.0.1",8000))
            bridge={"reachable":True,"mcp_initialized":False}
        except OSError:
            bridge={"reachable":False,"mcp_initialized":False}
    return {
        "hexstrike":probe("http://127.0.0.1:8888/health"),
        "hexstrike_tools":probe("http://127.0.0.1:8888/api/tools/status"),
        "mcp_bridge":bridge,
        "references":references()
    }


def strix_agent_context():
    """Original Strix OSS agent guide, read straight from checked-out repository."""
    root=Path(__file__).resolve().parents[1]
    excerpts=[]
    for relative in ("AGENTS.md","README.md"):
        file=root/relative
        if not file.is_file():continue
        text=file.read_text(encoding="utf-8",errors="replace")
        excerpts.append(relative+"\n"+text[:3200])
    return "\n\n".join(excerpts)[:6200]
