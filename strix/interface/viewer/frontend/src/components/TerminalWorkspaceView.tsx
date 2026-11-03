import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Terminal, Play, XCircle, Copy } from "lucide-react";

// Real interactive Kali PTYs on the authenticated local host: not event mockups.
type PTYResult = {ok?:boolean;running:boolean;slot:number;output:string;next_offset:number;error?:string};
type Session = {running:boolean;lines:string;offset:number;error:string};
const empty=():Session=>({running:false,lines:"",offset:0,error:""});
const NAMES=["Kali — Main","Kali — HexStrike","Kali — Research"];
const PRESETS=[
  {label:"HexStrike API",command:"cd ~/tools/hexstrike-ai && source hexstrike-env/bin/activate && python3 -u hexstrike_server.py --port 8888"},
  {label:"MCP Bridge",command:"cd ~/tools/hexstrike-ai && source hexstrike-env/bin/activate && python3 hexstrike_mcp.py --server http://127.0.0.1:8888 --timeout 600"},
  {label:"Atlas Diagnostics",command:"cd ~/Atlas-Arena-by-strix && python3 -c 'import sys;sys.path.insert(0,\"atlas_hq\");import mcp_client;print(mcp_client.inspect())'"},
  {label:"OpenAI Tunnel (T3)",command:"bash ~/Atlas-Arena-by-strix/atlas_hq/start_tunnel.sh"},
];
async function post(path:string,body:Record<string,unknown>):Promise<{ok:boolean;error?:string}> {
  const res=await fetch(path,{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok||!data.ok)throw Error(data.error||"Terminal request failed");
  return data;
}
const ANSI_16=[
 "#121212","#ff5668","#3cff87","#ffd84b","#5da9ff","#ff70d0","#25e4ff","#eeeeee",
 "#737b84","#ff8c9c","#00ff6a","#ffe86d","#79caff","#ff99e7","#62f6ff","#ffffff"
];
function ansiColor(n:number):string {
 if(n<16)return ANSI_16[n]||"#eafaff";
 if(n>=232)return "rgb("+[8+(n-232)*10,8+(n-232)*10,8+(n-232)*10].join(",")+")";
 const q=n-16,level=(v:number)=>v===0?0:55+v*40;
 return "rgb("+[level(Math.floor(q/36)%6),level(Math.floor(q/6)%6),level(q%6)].join(",")+")";
}
/** Render actual SGR color/weight from Kali's ANSI output (no synthetic all-green recoloring). */
function AnsiOutput({raw}:{raw:string}) {
 const segments=useMemo(()=>{
  let color="#00ff70",background:undefined|string,weight=400,dim=false;
  const parsed:{text:string;style:CSSProperties}[]=[];
  const src=raw.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"").replace(/\r(?!\n)/g,"\n");
  const rx=/\x1b\[([0-9;]*)m|\x1b\[[0-?]*[ -/]*[@-~]/g;
  let last=0,match:RegExpExecArray|null;
  const push=(text:string)=>{if(text)parsed.push({text,style:{color,backgroundColor:background,fontWeight:weight,opacity:dim?0.65:1}})};
  while((match=rx.exec(src))!==null){
   push(src.slice(last,match.index));
   last=rx.lastIndex;
   if(match[1]===undefined)continue;
   const codes=(match[1]||"0").split(";").map(v=>v===""?0:Number(v));
   for(let i=0;i<codes.length;i++){
    const c=codes[i];
    if(c===0){color="#00ff70";background=undefined;weight=400;dim=false}
    else if(c===1)weight=700;
    else if(c===2)dim=true;
    else if(c===22){weight=400;dim=false}
    else if(c===39)color="#00ff70";
    else if(c===49)background=undefined;
    else if(c>=30&&c<=37)color=ansiColor(c-30);
    else if(c>=90&&c<=97)color=ansiColor(c-90+8);
    else if(c>=40&&c<=47)background=ansiColor(c-40);
    else if(c>=100&&c<=107)background=ansiColor(c-100+8);
    else if((c===38||c===48)&&codes[i+1]===5&&codes[i+2]!==undefined){
     const v=ansiColor(codes[i+2]);if(c===38)color=v;else background=v;i+=2;
    }else if((c===38||c===48)&&codes[i+1]===2&&codes[i+4]!==undefined){
     const v="rgb("+codes.slice(i+2,i+5).map(n=>Math.max(0,Math.min(255,n))).join(",")+")";
     if(c===38)color=v;else background=v;i+=4;
    }
   }
  }
  push(src.slice(last));
  return parsed;
 },[raw]);
 return <>{segments.map((s,i)=><span key={i} style={s.style}>{s.text}</span>)}</>;
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
      setTerm(t=>({running:data.running,lines:(t.lines+(data.output||"")).slice(-115000),
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
  const onCommand=(e:React.FormEvent)=>{e.preventDefault();if(term.running&&cmd.trim())void send(cmd.replace(/\r\n/g,"\n")+"\n")};
  const runPreset=async(command:string)=>{if(!term.running){setTerm(t=>({...t,error:"Open this terminal first"}));return;}await send(command+"\n")};
  return <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-cyan-500/50 bg-[#01070b] shadow-[inset_0_0_16px_#00dfff0c]">
    <div className="flex flex-wrap items-center gap-2 border-b border-cyan-500/40 bg-[#05141c] px-3 py-2.5">
      <Terminal className="h-4 w-4 text-[#00f0ff] [text-shadow:0_0_8px_#00eaff80]" />
      <strong className="text-sm text-[#b7f9ff]">{NAMES[index]}</strong>
      <span className={"ml-auto text-[11px] "+(term.running?"text-emerald-400":"text-[#718675]")}>
        {term.running?"● LIVE PTY":"○ stopped"}
      </span>
      <button disabled={pending} onClick={()=>void start()}
        className="rounded border border-cyan-600/70 px-2 py-1 text-xs text-emerald-200 hover:bg-cyan-950 disabled:opacity-50"
        title="Start an interactive bash process"><Play className="inline h-3 w-3"/> Open</button>
      <button disabled={!term.running} onClick={()=>void send("\u0003",false)}
        className="rounded border border-[#565e54] px-2 py-1 text-xs text-[#c0cfc1] disabled:opacity-30">Ctrl+C</button>
      <button disabled={!term.running} onClick={()=>void stop()}
        className="text-rose-400 disabled:opacity-30" title="Close terminal"><XCircle className="h-4 w-4"/></button>
    </div>
    <pre ref={view} role="log" aria-label={NAMES[index]+" actual Kali terminal output"}
      className="h-[450px] overflow-auto whitespace-pre-wrap break-words bg-black px-3 py-3 font-mono text-[13px] leading-[20px] [text-shadow:0_0_5px_currentColor] text-[#00ff70]">
      {term.lines?<AnsiOutput raw={term.lines}/>:term.running?"Starting interactive Kali shell…":"Click Open to start a real interactive Kali shell."}
    </pre>
    <form onSubmit={onCommand} className="flex items-center border-t border-cyan-800/60 bg-[#03131b] px-2 py-1.5">
      <span className="px-1 text-emerald-400">$</span>
      <textarea rows={2} value={cmd} onChange={e=>setCmd(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(term.running&&cmd.trim())void send(cmd.replace(/\r\n/g,"\n")+"\n")}}}
        disabled={!term.running} spellCheck={false} autoComplete="off"
        aria-label={NAMES[index]+" shell command"}
        placeholder={term.running?"Paste commands here (multiline supported). Enter to run.":"Open a terminal first"}
        className="min-w-0 flex-1 resize-y bg-transparent px-2 py-2 font-mono text-sm text-[#d4fbff] outline-none placeholder:text-[#6995a5]"/>
      <button disabled={!term.running||!cmd} type="submit"
        className="rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30">Enter ↵</button>
    </form>
    <div className="flex flex-wrap gap-2 border-t border-cyan-900/50 px-2 py-2">
      {PRESETS.map(p=><button key={p.label} title={"Run now: "+p.command} onClick={()=>void runPreset(p.command)}
        disabled={!term.running} className="rounded border border-[#2b667b] disabled:opacity-40 px-2 py-1 text-[11px] text-[#7af2ff] hover:bg-[#0b3445]">{p.label}</button>)}
      <button onClick={()=>navigator.clipboard.writeText(term.lines)}
        className="ml-auto text-[#78cfe8]" title="Copy real terminal logs"><Copy className="h-4 w-4"/></button>
    </div>
    {term.error&&<p className="border-t border-red-900 px-3 py-2 text-xs text-red-400">{term.error}</p>}
  </section>;
}
export default function TerminalWorkspaceView() {
  const [windowsError,setWindowsError]=useState("");
  const openNative=async()=>{
    try {setWindowsError("");await post("/api/terminal/windows",{})}
    catch(e){setWindowsError(e instanceof Error?e.message:"Windows Terminal unavailable")}
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-6 w-6 text-emerald-400"/>
        <div><h1 className="text-2xl font-semibold text-emerald-300">Kali · Live Terminals</h1>
          <p className="text-xs text-[#94a89a]">Real interactive bash sessions running on your Kali WSL machine; stdout and stderr streamed into this dashboard.</p></div>
      </div>
      <button onClick={()=>void openNative()}
        className="rounded-lg border border-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/30">
        Open native Windows Terminal ↗
      </button>
    </div>
    {windowsError&&<p className="text-xs text-red-400">{windowsError}</p>}
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {[0,1,2].map(index=><PTY key={index} index={index}/>)}
    </div>
    <p className="text-xs text-[#8e9a90]">Terminal sessions are actual Kali bash processes—not simulated logs. The native Windows Terminal desktop window cannot be rendered inside Chrome; these PTYs give the dashboard real shell input and output.</p>
  </div>;
}
