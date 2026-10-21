import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldCheck, RefreshCcw, LogIn } from "lucide-react";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created: string };
type ChatState = {
  available: boolean; authenticated: boolean; engine: string; sandbox: string;
  session: { status: string; error: string | null; updated: string };
  messages: ChatMessage[];
  device_auth: { running: boolean; output: string };
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
      <span>{data?.authenticated?"Codex signed in":data?.available?"Codex sign-in required":"Codex CLI unavailable"}</span>
      <span className="text-[#555]">·</span><span>Local Kali</span>
      <span className="text-[#555]">·</span><span>Read-only session</span>
      {active&&<span className="ml-auto animate-pulse text-emerald-300">Atlas is responding…</span>}
    </div>
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
        <p className="text-white">Atlas HQ chat is ready for a local Codex connection.</p>
        <p className="mt-2 text-sm text-[#777]">Once signed in, messages and replies appear here and persist on Kali.</p></div>}
      {data?.messages.map(msg=><div key={msg.id} className={`flex ${msg.role==="user"?"justify-end":"justify-start"}`}>
        <div className={`max-w-[92%] rounded-xl border px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words sm:max-w-[85%] ${msg.role==="user"?"border-[#555] bg-[#242424] text-white":"border-[#252525] bg-[#0b0b0b] text-[#ddd]"}`}>
          <p className="mb-2 text-xs font-semibold text-[#777]">{msg.role==="user"?"You":"Atlas (Codex)"}</p>{msg.content}
        </div>
      </div>)}
      {active&&<div className="text-sm text-[#888]">Reading your request…</div>}
      <div ref={bottom}/>
    </div>
    {data?.session.error&&<div className="rounded-lg border border-red-900 p-3 text-sm text-red-400">Codex error: {data.session.error}</div>}
    <form className="flex gap-3 rounded-xl border border-[#333] bg-[#111] p-3" onSubmit={e=>void send(e)}>
      <textarea aria-label="Message Atlas" value={draft} rows={2}
        onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send(e as unknown as FormEvent)}}}
        disabled={!data?.authenticated||active}
        placeholder={data?.authenticated?"Ask Atlas to investigate a repository, analyze a result or organize a run…":"Connect Codex to enable chat"}
        className="min-h-[65px] max-h-40 flex-1 resize-y bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-[#666] disabled:opacity-60"/>
      <button type="submit" disabled={!data?.authenticated||!draft.trim()||busy||active}
        className="self-end rounded-lg bg-white p-3 text-black disabled:opacity-35" title="Send message">
        <Send className="h-4 w-4"/></button>
    </form>
    <p className="flex items-start gap-2 text-xs leading-5 text-[#777]">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0"/>This is a new local Codex AI session, not this existing ChatGPT conversation. The Strix Core MCP connected to ChatGPT does not automatically pass into Codex. Codex starts read-only and does not run scans by itself.
    </p>
  </div>;
}
