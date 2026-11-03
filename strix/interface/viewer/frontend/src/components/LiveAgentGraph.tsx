import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";
import AgentGraph from "@/components/live/AgentGraph";
import type { AgentNode } from "@/types/events";
type Model = { provider?:string;engine?:string;model_check?:{verified:boolean};session?:{status?:string};mcp?:{connected:boolean;count?:number} };
export default function LiveAgentGraph() {
  const [model,setModel]=useState<Model|null>(null);
  useEffect(()=>{
    let mounted=true;
    const sync=async()=>{try{
      const r=await fetch("/api/chat",{cache:"no-store"});
      if(r.ok&&mounted)setModel(await r.json());
    }catch{/* backend unavailable */}};
    void sync();const timer=setInterval(()=>void sync(),6000);
    return()=>{mounted=false;clearInterval(timer)}
  },[]);
  const label=model?.provider==="orca"?"OrcaCyber Flash":"Local Codex CLI";
  const state=model?.session?.status==="running"?"running":model?.model_check?.verified?"completed":"waiting";
  const graph=useMemo(()=>{
    const createdAt=new Date().toISOString();
    const node:AgentNode={
      id:"atlas-current-model",
      name:label,
      task:model?.mcp?.connected?("Atlas Chat · "+(model.mcp.count??0)+" HexStrike MCP tools"):"Atlas Chat · awaiting HexStrike bridge",
      status:state,
      parentId:null,children:[],createdAt,toolCount:0,messageCount:0
    };
    return new Map([[node.id,node]]);
  },[label,state,model?.mcp?.connected,model?.mcp?.count]);
  return <div className="rounded-xl border border-emerald-900/60 bg-[#07140b] p-5">
    <div className="mb-3 flex items-center gap-2">
      <Bot className="h-4 w-4 text-emerald-400"/>
      <h2 className="text-sm font-semibold text-emerald-200">Active Atlas Agent</h2>
      <span className="ml-auto text-xs text-[#799987]">{model?.model_check?.verified?"OrcaRouter API verified":"Local status"}</span>
    </div>
    <div className="h-[250px] overflow-hidden rounded-lg border border-emerald-950">
      <AgentGraph agents={graph} selectedAgentId={null} onSelectAgent={()=>{}} eventsLoaded eventsEmpty={false} scanCompleted={false}/>
    </div>
  </div>;
}
