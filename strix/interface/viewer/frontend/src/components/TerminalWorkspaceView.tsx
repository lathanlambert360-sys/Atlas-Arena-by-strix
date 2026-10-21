import { useMemo, useState } from "react";
import { Terminal, Copy, Check } from "lucide-react";
import type { TranscriptEvent } from "@/data/serverSource";

type TerminalItem = { id: string; agent: string; at: string; cmd: string; output: string; error: string; exit: number|null; status: string };
function asRecord(v: unknown): Record<string,unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
}
export default function TerminalWorkspaceView({ events }: { events: TranscriptEvent[] }) {
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState<string|null>(null);
  const lines = useMemo((): TerminalItem[] => events.flatMap(event => {
    if(event.type !== "tool")return [];
    const d=asRecord(event.data);
    const tool=String(d.tool_name??"");
    if(!["exec_command","write_stdin","terminal_execute"].includes(tool))return [];
    const args=asRecord(d.args), result=asRecord(d.result);
    const cmd=String(args.command??args.cmd??args.chars??"");
    return [{id:event.id,agent:event.agent_id,at:event.timestamp,cmd,
      output:typeof d.result==="string"?d.result:String(result.content??""),
      error:String(result.error??""),exit:typeof result.exit_code==="number"?result.exit_code:null,
      status:String(d.status??"unknown")}];
  }).filter(e=>(e.agent+" "+e.cmd+" "+e.output).toLowerCase().includes(filter.toLowerCase())).reverse().slice(0,250),[events,filter]);
  const copy = async (id:string, value:string) => { try { await navigator.clipboard.writeText(value);setCopied(id);setTimeout(()=>setCopied(null),1300); } catch { /* permissions may deny clipboard */ }};
  return <div className="space-y-5">
    <div className="flex items-start gap-3"><Terminal className="h-5 w-5 shrink-0 text-[#888]"/><div><h1 className="text-2xl font-semibold text-white">Kali Terminal</h1>
      <p className="mt-1 text-sm text-[#888]">Observed commands and output from the selected run. No commands are executed by this page.</p></div></div>
    <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="flex items-center justify-between gap-4"><span className="text-sm text-white">Terminal records ({lines.length})</span>
        <input aria-label="Filter terminal output" className="max-w-xs w-full rounded-md border border-[#333] bg-black px-3 py-2 text-sm outline-none focus:border-[#777]" placeholder="Filter output" value={filter} onChange={e=>setFilter(e.target.value)}/></div>
      {lines.length===0?<p className="mt-5 text-sm text-[#777]">No terminal activity has been attached. The Kali event bridge accepts verified command output and Codex events; new records appear here when ingested.</p>:
      <div className="mt-4 space-y-4">{lines.map(item=><section key={item.id} className="overflow-hidden rounded-lg border border-[#262626]">
        <div className="flex items-center gap-2 border-b border-[#262626] px-3 py-2 text-xs text-[#888]"><span className="truncate">{item.agent}</span><span className="ml-auto shrink-0">{item.status}</span><span className="shrink-0">{item.exit!==null?`exit ${item.exit}`:""}</span></div>
        <div className="flex items-start gap-2 bg-black px-3 py-3 text-sm"><span className="text-emerald-400">$</span><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-white">{item.cmd||"(no command label)"}</code><button className="text-[#888] hover:text-white" title="Copy command" onClick={()=>void copy(item.id,item.cmd)}>{copied===item.id?<Check className="h-4 w-4"/>:<Copy className="h-4 w-4"/>}</button></div>
        {(item.output||item.error)&&<pre className="max-h-[420px] overflow-auto border-t border-[#222] bg-[#0b0b0b] px-3 py-3 font-mono text-xs leading-5 text-[#aaa] whitespace-pre-wrap break-words">{item.output}{item.error? "\n"+item.error:""}</pre>}
        <div className="border-t border-[#222] px-3 py-1.5 text-[11px] text-[#555]">{item.at}</div>
      </section>)}</div>}
    </div>
    <p className="text-xs text-[#555]">The terminal is a replay/evidence window, not a remotely exposed shell. Execute authorized commands in Kali and attach outputs with the provided collector or Codex event adapter.</p>
  </div>;
}
