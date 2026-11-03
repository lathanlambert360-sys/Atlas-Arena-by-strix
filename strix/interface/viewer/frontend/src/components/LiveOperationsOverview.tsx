import { useEffect, useState } from "react";
import { Bot, Terminal, PlugZap, Database } from "lucide-react";
type Status = {
  provider?:string;engine?:string;model?:string;
  model_check?:{verified:boolean};mcp?:{connected:boolean;count?:number};
  reference_archives?:{available:boolean;id:string}[];
};
type Shell = {running:boolean};
export default function LiveOperationsOverview({compact=false}:{compact?:boolean}) {
  const [status,setStatus]=useState<Status|null>(null);
  const [shells,setShells]=useState<Shell[]>([{running:false},{running:false},{running:false}]);
  useEffect(()=>{
    let alive=true;
    const refresh=async()=>{
      try {
        const results=await Promise.all([
          fetch("/api/chat",{cache:"no-store"}).then(r=>r.json()),
          fetch("/api/terminal/status",{cache:"no-store"}).then(r=>r.json())
        ]);
        if(alive){setStatus(results[0]);setShells(results[1].sessions??[])}
      }catch{/* local server may be starting */}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),10000);
    return()=>{alive=false;clearInterval(timer)}
  },[]);
  const live=shells.filter(s=>s.running).length;
  const loaded=status?.reference_archives?.filter(x=>x.available).length??0;
  return <section className="rounded-xl border border-[#294134] bg-[#09120d] p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-emerald-300">Live Atlas Operations</h2>
      <span className="text-[11px] text-[#80ae91]">CURRENT LOCAL RUNTIME · separate from archived runs</span>
    </div>
    <div className={"grid gap-3 "+(compact?"grid-cols-1 sm:grid-cols-2":"grid-cols-1 sm:grid-cols-2 xl:grid-cols-4")}>
      {[
        {icon:<Bot className="h-4 w-4"/>,label:"Active AI agent",value:status?.provider==="orca"?"OrcaCyber Flash":status?.engine||"Checking…",detail:status?.model_check?.verified?"Live API verified":"Verification pending"},
        {icon:<PlugZap className="h-4 w-4"/>,label:"HexStrike MCP",value:status?.mcp?.connected?"Connected":"Disconnected",detail:status?.mcp?.connected?(status.mcp.count??0)+" discovered tools":"Check local bridge :8001"},
        {icon:<Terminal className="h-4 w-4"/>,label:"Kali shells",value:live+" / 3 running",detail:"Real PTYs · terminal tab"},
        {icon:<Database className="h-4 w-4"/>,label:"Research resources",value:loaded+" / 4 archives",detail:"Original files preserved"}
      ].map(x=><div key={x.label} className="rounded-lg border border-[#283b30] bg-[#0e1912] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-[#a0b8a8]">{x.icon}{x.label}</div>
        <p className="text-sm font-semibold text-white">{x.value}</p>
        <p className="mt-1 text-[11px] text-[#789581]">{x.detail}</p>
      </div>)}
    </div>
  </section>;
}
