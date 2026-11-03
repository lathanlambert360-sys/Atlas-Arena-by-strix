import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, Play, RefreshCcw, XCircle, Copy, ExternalLink } from "lucide-react";

// Real interactive Kali PTYs on the authenticated local host: not event mockups.
type PTYResult = {ok?:boolean;running:boolean;slot:number;output:string;next_offset:number;error?:string};
type Session = {running:boolean;lines:string;offset:number;error:string};
const empty=():Session=>({running:false,lines:"",offset:0,error:""});
const NAMES=["Kali — Main","Kali — HexStrike","Kali — Research"];
const PRESETS=[
  {label:"HexStrike API",command:"cd ~/tools/hexstrike-ai && source hexstrike-env/bin/activate && python3 -u hexstrike_server.py --port 8888"},
  {label:"MCP Bridge",command:"cd ~/tools/hexstrike-ai && source hexstrike-env/bin/activate && python3 hexstrike_mcp.py --server http://127.0.0.1:8888 --timeout 600"},
  {label:"Atlas Diagnostics",command:"cd ~/Atlas-Arena-by-strix && python3 -c 'import sys;sys.path.insert(0,\"atlas_hq\");import mcp_client;print(mcp_client.inspect())'"},
];
async function post(path:string,body:Record<string,unknown>):Promise<{ok:boolean;error?:string}> {
  const res=await fetch(path,{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok||!data.ok)throw Error(data.error||"Terminal request failed");
  return data;
}
function cleanAnsi(s:string):string {
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"")
    .replace(/\r(?!\n)/g,"\n").replace(/\x08/g,"");
}
function PTY({index}:{index:number}) {
  const slot=index+1;
  const [term,setTerm]=useState<Session>(empty);
  const [cmd,setCmd]=useState("");
  const [pending,setPending]=useState(false);
  const view=useRef<HTMLPreElement|null>(null);
  const pos=useRef(0);
  const active=useRef(false);
  const refresh=useCallback(async()=>{
    if(!active.current)return;
    try {
      const res=await fetch("/api/terminal/output?slot="+slot+"&offset="+pos.current,{cache:"no-store"});
      if(!res.ok)throw Error("Terminal session unavailable: HTTP "+res.status);
      const data=await res.json() as PTYResult;
      pos.current=data.next_offset;
      setTerm(t=>({running:data.running,lines:(t.lines+cleanAnsi(data.output||"")).slice(-115000),
        offset:data.next_offset,error:""}));
    }catch(e){setTerm(t=>({...t,error:String(e)}))}
  },[slot]);
  useEffect(()=>{
    active.current=true;
    void refresh();
    const timer=setInterval(()=>void refresh(),600);
    return()=>{active.current=false;clearInterval(timer)}
  },[refresh]);
  useEffect(()=>{if(view.current)view.current.scrollTop=view.current.scrollHeight},[term.lines]);
  const start=async()=>{
    setPending(true);
    try{
      await post("/api/terminal/start",{slot});
      pos.current=0;
      setTerm({...empty(),running:true});
      await refresh()
    }catch(e){setTerm(t=>({...t,error:String(e)}))}
    finally{setPending(false)}
  };
  const send=async(value:string,echo=true)=>{
    try {
      await post("/api/terminal/input",{slot,data:value});
      if(echo&&value.endsWith("\n"))setCmd("");
    }catch(e){setTerm(t=>({...t,error:String(e)}))}
  };
  const stop=async()=>{try{await post("/api/terminal/stop",{slot});await refresh()}catch(e){setTerm(t=>({...t,error:String(e)}))}};
  const onCommand=(e:React.FormEvent)=>{e.preventDefault();if(term.running&&cmd)void send(cmd+"\n")};
  return <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-emerald-900/70 bg-[#030b07]">
    <div className="flex flex-wrap items-center gap-2 border-b border-emerald-900/70 bg-[#08180f] px-3 py-2.5">
      <Terminal className="h-4 w-4 text-emerald-400" />
      <strong className="text-sm text-emerald-200">{NAMES[index]}</strong>
      <span className={"ml-auto text-[11px] "+(term.running?"text-emerald-400":"text-[#718675]")}>
        {term.running?"● LIVE PTY":"○ stopped"}
      </span>
      <button disabled={pending} onClick={()=>void start()}
        className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-950 disabled:opacity-50"
        title="Start an interactive bash process"><Play className="inline h-3 w-3"/> Open</button>
      <button disabled={!term.running} onClick={()=>void send("\u0003",false)}
        className="rounded border border-[#565e54] px-2 py-1 text-xs text-[#c0cfc1] disabled:opacity-30">Ctrl+C</button>
      <button disabled={!term.running} onClick={()=>void stop()}
        className="text-rose-400 disabled:opacity-30" title="Close terminal"><XCircle className="h-4 w-4"/></button>
    </div>
    <pre ref={view} role="log" aria-label={NAMES[index]+" actual Kali terminal output"}
      className="h-[450px] overflow-auto whitespace-pre-wrap break-words bg-black px-3 py-3 font-mono text-[12px] leading-[18px] text-emerald-400">
      {term.lines||(term.running?"Starting interactive Kali shell…":"Click Open to start a real interactive Kali shell.")}
    </pre>
    <form onSubmit={onCommand} className="flex items-center border-t border-emerald-900 bg-[#051108] px-2 py-1.5">
      <span className="px-1 text-emerald-400">$</span>
      <input value={cmd} onChange={e=>setCmd(e.target.value)}
        disabled={!term.running} spellCheck={false} autoComplete="off"
        aria-label={NAMES[index]+" shell command"}
        placeholder={term.running?"Enter Kali command…":"Open a terminal first"}
        className="min-w-0 flex-1 bg-transparent px-2 py-2 font-mono text-sm text-white outline-none placeholder:text-[#6b8275]"/>
      <button disabled={!term.running||!cmd} type="submit"
        className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30">Enter ↵</button>
    </form>
    <div className="flex flex-wrap gap-2 border-t border-emerald-950 px-2 py-2">
      {PRESETS.map(p=><button key={p.label} title={p.command} onClick={()=>setCmd(p.command)}
        className="rounded border border-[#2b4a39] px-2 py-1 text-[11px] text-emerald-300 hover:bg-[#153022]">{p.label}</button>)}
      <button onClick={()=>navigator.clipboard.writeText(term.lines)}
        className="ml-auto text-[#8da699]" title="Copy real terminal logs"><Copy className="h-4 w-4"/></button>
    </div>
    {term.error&&<p className="border-t border-red-900 px-3 py-2 text-xs text-red-400">{term.error}</p>}
  </section>;
}
export default function TerminalWorkspaceView() {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-6 w-6 text-emerald-400"/>
        <div><h1 className="text-2xl font-semibold text-emerald-300">Kali · Live Terminals</h1>
          <p className="text-xs text-[#94a89a]">Real interactive bash sessions running on your Kali WSL machine; stdout and stderr streamed into this dashboard.</p></div>
      </div>
      <a href="http://127.0.0.1:8917/" className="inline-flex items-center gap-2 text-xs text-emerald-400">
        Local execution · 127.0.0.1 <ExternalLink className="h-3 w-3"/></a>
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {[0,1,2].map(index=><PTY key={index} index={index}/>)}
    </div>
    <p className="text-xs text-[#8e9a90]">Terminal sessions are actual Kali bash processes—not simulated logs. The native Windows Terminal desktop window cannot be rendered inside Chrome; these PTYs give the dashboard real shell input and output.</p>
  </div>;
}
