import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldCheck, RefreshCcw, LogIn } from "lucide-react";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created: string };
type ChatState = {
  available: boolean; authenticated: boolean; engine: string; provider: "orca" | "codex"; sandbox: string;
  model: string | null; model_check: { checked: boolean; verified: boolean; error: string | null };
  session: { status: string; error: string | null; updated: string };
  messages: ChatMessage[];
  device_auth: { running: boolean; output: string };
  mcp?: {connected:boolean; count?:number; tools?:string[]; error?:string};
  reference_archives?: {id:string;available:boolean;documents?:number}[];
  tool_requests?: {id:string;tool:string;arguments:string;reason:string;status:string;created:string}[];
};
export default function AtlasChatView() {
  const [data,setData] = useState<ChatState|null>(null);
  const [draft,setDraft] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement|null>(null);
  const lastSeen = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const res=await fetch("/api/chat",{cache:"no-store"});
      if(!res.ok)throw new Error("Local chat backend unavailable (HTTP "+res.status+")");
      const status=await res.json() as ChatState;
      setData(status);
      if(status.messages.length!==lastSeen.current) {
        lastSeen.current=status.messages.length;
        requestAnimationFrame(()=>bottom.current?.scrollIntoView({behavior:"smooth",block:"end"}));
      }
    } catch(e) {
      setError(e instanceof Error?e.message:"Could not contact local chat backend");
    }
  },[]);
  useEffect(()=>{
    void refresh();
    const timer=setInterval(()=>{void refresh()},1800);
    return ()=>clearInterval(timer);
  },[refresh]);
  const post=async(path:string, body:Record<string,unknown>)=>{
    const res=await fetch(path,{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const result=await res.json() as {ok?:boolean;error?:string};
    if(!res.ok||!result.ok)throw new Error(result.error??"Request failed");
    return result;
  };
  const send=async(e:FormEvent)=>{
    e.preventDefault();
    if(!draft.trim()||!data?.authenticated||busy||data.session.status==="running")return;
    setBusy(true);setError("");
    try {await post("/api/chat",{message:draft.trim()});setDraft("");await refresh()}
    catch(e){setError(e instanceof Error?e.message:"Unable to send")}
    finally{setBusy(false)}
  };
  const testModel=async()=>{
    setBusy(true);setError("");
    try {await post("/api/chat/model/test",{});await refresh()}
    catch(e){setError(e instanceof Error?e.message:"Model test failed");await refresh()}
    finally{setBusy(false)}
  };
  const decideTool=async(id:string,approve:boolean)=>{
    setBusy(true);setError("");
    try { await post("/api/chat/tool/decide",{id,approve});await refresh() }
    catch(e){setError(e instanceof Error?e.message:"Tool decision failed")}
    finally{setBusy(false)}
  };
  const connect=async()=>{
    setBusy(true);setError("");
    try {await post("/api/chat/auth/start",{});await refresh()}
    catch(e){setError(e instanceof Error?e.message:"Authentication could not start")}
    finally{setBusy(false)}
  };
  const active=data?.session.status==="running";
  return <div className="mx-auto flex max-w-5xl flex-col gap-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3"><Bot className="mt-1 h-6 w-6 text-white"/><div>
        <h1 className="text-2xl font-semibold text-white">Atlas Chat</h1>
        <p className="mt-1 text-sm text-[#999]">Work from Kali in one place—chat alongside your terminals, agents and findings.</p>
      </div></div>
      <button onClick={()=>void refresh()} className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#aaa] hover:text-white">
        <RefreshCcw className="mr-2 inline h-3.5 w-3.5"/>Refresh
      </button>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#282828] bg-[#0f0f0f] p-3 text-xs text-[#aaa]">
      <span className={`h-2 w-2 rounded-full ${data?.authenticated?"bg-emerald-400":"bg-yellow-500"}`}/>
      <span>{data?.authenticated?(data.provider==="orca"?(data.model_check?.verified?"OrcaCyber verified":"OrcaCyber configured"):"Codex signed in"):data?.available?"Codex sign-in required":"AI provider unavailable"}</span>
      <span className="text-[#555]">·</span><span>{data?.engine??"Local Kali"}</span>
      <span className="text-[#555]">·</span><span>Read-only session</span>
      {data?.provider==="orca"&&<button disabled={busy||active} onClick={()=>void testModel()} className="ml-auto rounded-lg border border-cyan-700 px-3 py-1.5 text-cyan-300 hover:bg-cyan-950/30 disabled:opacity-40">Test model</button>}
      {active&&<span className="ml-auto animate-pulse text-emerald-300">Atlas is responding…</span>}
    </div>
    {data?.provider==="orca"&&data.model_check?.verified&&<div className="text-xs text-emerald-400">Verified live API response from {data.model}</div>}
    <div className="flex flex-wrap gap-2 text-[11px] text-[#a5b4c5]">
      <span className="rounded border border-[#303840] px-2 py-1">
        HexStrike MCP: {data?.mcp?.connected?("CONNECTED · "+(data.mcp.count??0)+" tools"):"NOT CONNECTED"}
      </span>
      {data?.reference_archives?.map(r=><span key={r.id}
        className={`rounded border px-2 py-1 ${r.available?"border-emerald-900 text-emerald-300":"border-[#303840]"}`}>
        {r.id}: {r.available?(r.documents??0)+" docs":"not loaded"}
      </span>)}
    </div>
    {data?.tool_requests?.filter(t=>t.status==="pending"||t.status==="running").map(t=>
      <section key={t.id} className="rounded-xl border border-amber-700/60 bg-amber-950/15 p-4">
        <h2 className="text-sm font-semibold text-amber-200">HexStrike MCP · {t.tool}</h2>
        <p className="mt-2 text-xs text-[#c9c9c9]">{t.reason}</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-2 text-xs">{t.arguments}</pre>
        <div className="mt-3 flex gap-3">
          {t.status==="pending"?<>
          <button disabled={busy} onClick={()=>void decideTool(t.id,true)}
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve tool call</button>
          <button disabled={busy} onClick={()=>void decideTool(t.id,false)}
            className="rounded border border-[#555] px-3 py-2 text-xs text-white disabled:opacity-40">Reject</button>
          </>:<span className="text-xs text-amber-300">HexStrike executing…</span>}
        </div>
      </section>)}
    {error&&<div role="alert" className="rounded-lg border border-red-800 bg-red-950/25 p-3 text-sm text-red-300">{error}</div>}
    {!data?.authenticated&&<section className="rounded-xl border border-[#333] bg-[#151515] p-5">
      <h2 className="mb-2 font-semibold text-white">Connect your existing Codex login</h2>
      <p className="text-sm text-[#999]">Sign in once. Codex uses your own account; no Strix credits or OpenAI API key are required for this login method.</p>
      <button disabled={!data?.available||busy||data?.device_auth.running} onClick={()=>void connect()}
        className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
        <LogIn className="mr-2 inline h-4 w-4"/> {data?.device_auth.running?"Waiting for sign-in…":"Connect Codex"}
      </button>
      {data?.device_auth.output&&<pre className="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#333] bg-black p-3 font-mono text-sm text-[#ccc]">{data.device_auth.output}</pre>}
      <p className="mt-3 text-xs text-[#777]">If a verification address and code appear above, open the address and approve login. This panel updates automatically.</p>
    </section>}
    <div className="min-h-[280px] max-h-[55vh] space-y-4 overflow-y-auto rounded-xl border border-[#282828] bg-[rgba(255,255,255,0.02)] p-4 sm:p-6">
      {(!data||data.messages.length===0)&&<div className="py-14 text-center"><Bot className="mx-auto mb-3 h-8 w-8 text-[#666]"/>
        <p className="text-white">Atlas HQ chat is ready for OrcaCyber or Codex.</p>
        <p className="mt-2 text-sm text-[#777]">Once signed in, messages and replies appear here and persist on Kali.</p></div>}
      {data?.messages.map(msg=><div key={msg.id} className={`flex ${msg.role==="user"?"justify-end":"justify-start"}`}>
        <div className={`max-w-[92%] rounded-xl border px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words sm:max-w-[85%] ${msg.role==="user"?"border-[#555] bg-[#242424] text-white":"border-[#252525] bg-[#0b0b0b] text-[#ddd]"}`}>
          <p className="mb-2 text-xs font-semibold text-[#777]">{msg.role==="user"?"You":(data?.provider==="orca"?"Atlas (OrcaCyber)":"Atlas (Codex)")}</p>{msg.content}
        </div>
      </div>)}
      {active&&<div className="text-sm text-[#888]">Reading your request…</div>}
      <div ref={bottom}/>
    </div>
    {data?.session.error&&<div className="rounded-lg border border-red-900 p-3 text-sm text-red-400">Atlas error: {data.session.error}</div>}
    <form className="flex gap-3 rounded-xl border border-[#333] bg-[#111] p-3" onSubmit={e=>void send(e)}>
      <textarea aria-label="Message Atlas" value={draft} rows={2}
        onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send(e as unknown as FormEvent)}}}
        disabled={!data?.authenticated||active}
        placeholder={data?.authenticated?"Ask Atlas to investigate a repository, analyze a result or organize a run…":"Connect an AI model to enable chat"}
        className="min-h-[65px] max-h-40 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-[#666] disabled:opacity-60"/>
      <button type="submit" disabled={!data?.authenticated||!draft.trim()||busy||active}
        className="self-end rounded-lg bg-white p-3 text-black disabled:opacity-35" title="Send message">
        <Send className="h-4 w-4"/></button>
    </form>
    <p className="flex items-start gap-2 text-xs leading-5 text-[#777]">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/>OrcaCyber can inspect local HexStrike MCP tools and original research archives. Proposed MCP tool calls require your approval; actual output is recorded in chat. Local commands: /atlas status · /atlas refs · /atlas read.
    </p>
  </div>;
}
