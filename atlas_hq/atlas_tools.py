"""Local Atlas dashboard telemetry and unchanged ZIP reference access."""
import json
import hashlib
import subprocess
import socket
import mcp_client
import zipfile
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

ROOT=Path.home()/"orcacyber"/"references"
BUILTIN_ROOT=Path(__file__).resolve().parent/"references"
ARCHIVES={
    "blackhat-roadmap":"The-BlackHAT-roadmap-main(8).zip",
    "hacker-scripts":"hacker-scripts-master(2).zip",
    "hacker-laws":"hacker-laws-main(3).zip",
    "security-audit":"security-audit-skill-main(10).zip",
}
DIRECTORIES={
    "api-anything":BUILTIN_ROOT/"api-anything",
    "hackingtool":BUILTIN_ROOT/"hackingtool",
}

DOC_SUFFIXES=(".md",".txt",".rst")

def references():
    result=[]
    for name,fn in ARCHIVES.items():
        p=ROOT/fn
        item={"id":name,"available":p.is_file()}
        if p.is_file():
            try:
                with zipfile.ZipFile(p) as z:
                    docs=[s for s in z.namelist() if s.lower().endswith(DOC_SUFFIXES)]
                    item["documents"]=len(docs)
                    item["sample_paths"]=docs[:25]
            except (OSError,zipfile.BadZipFile):
                item["available"]=False
        result.append(item)
    for name,root in DIRECTORIES.items():
        docs=[]
        if root.is_dir():
            docs=[str(p.relative_to(root)) for p in root.rglob("*")
                  if p.is_file() and p.suffix.lower() in DOC_SUFFIXES]
        result.append({"id":name,"available":bool(docs),"documents":len(docs),
                       "sample_paths":docs[:25]})
    return result

def read_reference(name,member,limit=14000):
    if name in ARCHIVES:
        with zipfile.ZipFile(ROOT/ARCHIVES[name]) as z:
            item=z.getinfo(member)
            if item.file_size>1_000_000 or not member.lower().endswith(DOC_SUFFIXES):
                raise ValueError("Unsupported document")
            return z.read(member).decode("utf-8","replace")[:limit]
    if name in DIRECTORIES:
        root=DIRECTORIES[name].resolve()
        file=(root/member).resolve()
        if not file.is_relative_to(root) or file.suffix.lower() not in DOC_SUFFIXES:
            raise ValueError("Unsupported document")
        if not file.is_file() or file.stat().st_size>1_000_000:
            raise ValueError("Document missing or too large")
        return file.read_text(encoding="utf-8",errors="replace")[:limit]
    raise ValueError("Unknown archive")

def inventory(name):
    if name in ARCHIVES:
        with zipfile.ZipFile(ROOT/ARCHIVES[name]) as z:
            return [p for p in z.namelist() if p.lower().endswith(DOC_SUFFIXES)][:250]
    if name in DIRECTORIES:
        root=DIRECTORIES[name]
        return [str(p.relative_to(root)) for p in root.rglob("*")
                if p.is_file() and p.suffix.lower() in DOC_SUFFIXES][:250]
    raise ValueError("Unknown archive")

def probe(url):
    try:
        with urlopen(url,timeout=3) as res:
            raw=res.read(350000)
            try:return {"connected":True,"response":json.loads(raw)}
            except ValueError:return {"connected":True,"http":res.status}
    except (URLError,HTTPError,OSError,TimeoutError) as exc:
        return {"connected":False,"error":type(exc).__name__}

def status():
    def port_ready(port):
        with socket.socket() as sock:
            sock.settimeout(0.7)
            try:sock.connect(("127.0.0.1",port));return True
            except OSError:return False
    api=port_ready(8888)
    return {
        "hexstrike":{"reachable":api,"port":8888,"health_http":("deferred: health collection may be slow" if api else "offline")},
        "hexstrike_tools":{"source":"live MCP tool inventory","tools_available":mcp_client.inspect().get("count",0)},
        "mcp_bridge":{"port":8000,"reachable":port_ready(8000),"role":"existing T3 tunnel MCP"},
        "atlas_mcp":{"port":8001,"reachable":port_ready(8001),"protocol":mcp_client.inspect()},
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


def strix_knowledge_manifest():
    """Inspectable, original repository evidence; hashes are of local bytes."""
    root=Path(__file__).resolve().parents[1]
    all_paths=[]
    for prefix in ("strix","skills","AGENTS.md","README.md"):
        base=root/prefix
        if base.is_file():
            all_paths.append(base)
        elif base.is_dir():
            all_paths.extend(p for p in base.rglob("*") if p.is_file() and
                             ".git" not in p.parts and "node_modules" not in p.parts and
                             ".venv" not in p.parts and "static" not in p.parts and
                             "__pycache__" not in p.parts)
    size=sum(p.stat().st_size for p in all_paths)
    docs=[p for p in all_paths if p.suffix.lower() in (".md",".txt",".rst",".yaml",".yml",".toml")]
    snippets=[]
    for path in docs:
        rel=str(path.relative_to(root))
        if len(snippets)>=120:break
        snippets.append({"path":rel,"bytes":path.stat().st_size,
                         "sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    try:
        head=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],capture_output=True,text=True,timeout=2)
        commit=head.stdout.strip() if head.returncode==0 else None
    except (OSError,subprocess.TimeoutExpired):commit=None
    return {"root":str(root),"commit":commit,"tracked_source_files":len(all_paths),
            "total_source_bytes":size,"documentation_files":len(docs),
            "indexed_documents":snippets,"agent_guide_readable":bool(strix_agent_context()),
            "research_archives":references()}

def strix_document(path):
    """Read only original Strix documentation, not secrets or executable sources."""
    root=Path(__file__).resolve().parents[1]
    file=(root/path).resolve()
    if not file.is_relative_to(root):raise ValueError("Path outside repository")
    if path not in ("AGENTS.md","README.md") and not path.startswith("strix/") and not path.startswith("skills/"):
        raise ValueError("Unknown Strix knowledge path")
    if file.suffix.lower() not in (".md",".txt",".rst",".yaml",".yml",".toml"):
        raise ValueError("Only documentation files may be read")
    if not file.is_file() or file.stat().st_size>500000:
        raise ValueError("File missing or too large")
    raw=file.read_bytes()
    return {"path":str(file.relative_to(root)),"sha256":hashlib.sha256(raw).hexdigest(),
            "content":raw.decode("utf-8","replace")[:32000],"bytes":len(raw)}
