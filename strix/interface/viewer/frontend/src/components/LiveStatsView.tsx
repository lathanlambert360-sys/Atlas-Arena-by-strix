import { useEffect, useState } from "react";
import { Activity, Database, ShieldCheck, Terminal, Bot, RefreshCcw } from "lucide-react";
type Stats={
 timestamp:string;source:string;runs:number;active_runs:number;events:number;agents:number;findings:number;
 severities:Record<string,number>;tool_calls:Record<string,number>;chat_messages:number;
 terminals:{slot:number;running:boolean}[];
};
export default function LiveStatsView({compact=false}:{compact?:boolean}) {
 const [stats,setStats]=useState<Stats|null>(null),[error,setError]=useState("");
 const refresh=async()=>{
  try {const res=await fetch("/api/stats",{cache:"no-store"});
    if(!res.ok)throw Error("HTTP "+res.status);
    setStats(await res.json());setError("");
  }catch(e){setError(String(e))}
 };
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer)},[]);
 const metrics=stats?[
  ["RUNS",stats.runs],["ACTIVE",stats.active_runs],["EVENTS",stats.events],
  ["AGENTS",stats.agents],["FINDINGS",stats.findings],["ORCAC YBER MESSAGES".replace(" ",""),stats.chat_messages],
  ["HEXSTRIKE MCP COMPLETED",stats.tool_calls?.completed??0],
  ["KALI PTY ONLINE",stats.terminals?.filter(t=>t.running).length??0]
 ]:[];
 return <section className="space-y-4 rounded-xl border border-cyan-500/30 bg-[#020b10] p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <h2 className="flex items-center gap-2 text-base font-semibold text-[#75f3ff]"><Activity className="h-5 w-5"/>Live Strix Mission Tracker</h2>
   <div className="flex items-center gap-2 text-xs text-[#87aab4]">{stats?.timestamp||"Reading local runtime"}
    <button onClick={()=>void refresh()} aria-label="Refresh live statistics"><RefreshCcw className="h-4 w-4 text-cyan-400"/></button>
   </div>
  </div>
  {error&&<p className="text-red-400">Statistics request failed: {error}</p>}
  {stats&&<>
   <div className={"grid gap-2 "+(compact?"grid-cols-2 sm:grid-cols-4":"grid-cols-2 md:grid-cols-4 xl:grid-cols-8")}>
    {metrics.map(([name,value])=><div key={name} className="rounded-lg border border-[#14516a] bg-[#061b25] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#78b9c8]">{name}</p>
      <p className="mt-2 font-mono text-2xl font-bold text-[#00efff] [text-shadow:0_0_9px_#00d5ff80]">{value}</p>
    </div>)}
   </div>
   <div className="flex flex-wrap gap-3 text-xs">
    {Object.entries(stats.severities||{}).map(([severity,count])=><span key={severity} className="rounded border border-[#164252] px-2 py-1 text-[#d5f4ff]">
      {severity.toUpperCase()}: <strong>{count}</strong></span>)}
   </div>
   <p className="text-[11px] text-[#75a0ad]">SOURCE: {stats.source} · Updated every 5 seconds · Counts reflect stored local runs and completed tool evidence, not unverified vulnerability claims.</p>
  </>}
 </section>;
}