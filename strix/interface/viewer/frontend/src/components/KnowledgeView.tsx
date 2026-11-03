import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, RefreshCcw, FileCode2, ShieldCheck } from "lucide-react";
type Doc={path:string;bytes:number;sha256:string};
type Manifest={root:string;commit:string|null;tracked_source_files:number;total_source_bytes:number;documentation_files:number;indexed_documents:Doc[];agent_guide_readable:boolean;research_archives:{id:string;available:boolean;documents?:number}[]};
type OpenDoc={path:string;sha256:string;content:string;bytes:number};
export default function KnowledgeView() {
 const [manifest,setManifest]=useState<Manifest|null>(null);
 const [current,setCurrent]=useState<OpenDoc|null>(null);
 const [selected,setSelected]=useState("");
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const refresh=async()=>{
  setLoading(true);
  try {
    const res=await fetch("/api/knowledge",{cache:"no-store"});
    if(!res.ok)throw Error("HTTP "+res.status);
    setManifest(await res.json());setError("");
  }catch(e){setError(String(e))}
  finally{setLoading(false)}
 };
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),20000);return()=>clearInterval(timer)},[]);
 const open=async(path:string)=>{
  setSelected(path);setLoading(true);
  try {
   const res=await fetch("/api/knowledge/document?path="+encodeURIComponent(path),{cache:"no-store"});
   const doc=await res.json();
   if(!res.ok)throw Error(doc.error||"Could not read file");
   setCurrent(doc);setError("");
  }catch(e){setError(String(e))}
  finally{setLoading(false)}
 };
 return <main className="space-y-5 text-[#e8faff]">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><h1 className="flex items-center gap-2 text-xl font-semibold text-[#77f7ff]"><BookOpen className="h-6 w-6"/>Verified Strix Knowledge</h1>
   <p className="mt-1 text-sm text-[#83adbb]">Original source files, real SHA-256 hashes and local content — no mock documents.</p></div>
   <button onClick={()=>void refresh()} className="flex items-center gap-2 rounded border border-cyan-700 p-2 text-xs text-[#79eaff]"><RefreshCcw className="h-4 w-4"/>Refresh source</button>
  </header>
  {error&&<div className="rounded border border-red-700 p-3 text-red-300">{error}</div>}
  {manifest&&<>
   <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[["SOURCE FILES",manifest.tracked_source_files],["DOCS FOUND",manifest.documentation_files],
       ["SOURCE BYTES",manifest.total_source_bytes],["AGENT GUIDE",manifest.agent_guide_readable?"READABLE":"UNAVAILABLE"]].map(([label,val])=>
      <div key={String(label)} className="rounded-xl border border-[#155169] bg-[#051722] p-4"><p className="text-xs text-[#83b6c2]">{label}</p>
       <p className="mt-1 font-mono text-xl text-[#00efff]">{val}</p></div>)}
   </div>
   <div className="rounded-xl border border-emerald-800/50 bg-[#021a15] p-4 text-xs">
    <p className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-4 w-4"/>Repository inspected directly on Kali</p>
    <p className="mt-2 break-all font-mono text-[#9bccb8]">Commit: {manifest.commit||"Git HEAD unreadable"}</p>
    <p className="mt-1 break-all font-mono text-[#9bccb8]">Location: {manifest.root}</p>
   </div>
   <div className="rounded-xl border border-[#14506a] p-4">
    <p className="mb-3 flex items-center gap-2 text-sm text-[#77eaff]"><ShieldCheck className="h-4 w-4"/>Additional unmodified research archives</p>
    <div className="flex flex-wrap gap-2">{manifest.research_archives.map(r=><span key={r.id}
      className={"rounded border px-3 py-2 text-xs "+(r.available?"border-emerald-800 text-emerald-300":"border-red-700 text-red-300")}>
     {r.id} · {r.available?(r.documents||0)+" actual documents":"unavailable"}</span>)}</div>
   </div>
   <div className="grid gap-3 lg:grid-cols-[minmax(250px,1fr)_minmax(0,1.8fr)]">
    <section className="max-h-[650px] overflow-auto rounded-xl border border-[#185269] bg-[#04131c] p-3">
     <h2 className="mb-3 text-sm font-semibold text-cyan-300">Verified original Strix documents</h2>
     {manifest.indexed_documents.map(d=><button key={d.path} onClick={()=>void open(d.path)}
       className={"mb-1 block w-full rounded border px-2 py-2 text-left font-mono text-xs hover:bg-[#0a3444] "+(selected===d.path?"border-cyan-400 text-cyan-200":"border-[#143443] text-[#91cbd8]")}>
       <span className="flex items-center gap-2"><FileCode2 className="h-3 w-3"/>{d.path}</span>
       <span className="mt-1 block truncate text-[10px] text-[#648f9c]">SHA-256 {d.sha256}</span>
      </button>)}
    </section>
    <section className="min-w-0 rounded-xl border border-[#185269] bg-black p-3">
     {current?<><div className="mb-3 border-b border-[#185269] pb-2">
      <p className="break-all text-sm text-[#a4f6ff]">{current.path} · {current.bytes} bytes</p>
      <p className="break-all font-mono text-[11px] text-emerald-300">SHA-256: {current.sha256}</p>
     </div><pre className="max-h-[610px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#c9f9ff]">{current.content}</pre>
      </>:<div className="text-sm text-[#819ba4]">Select a real file to read its original bytes and verify its SHA-256.</div>}
    </section>
   </div>
  </>}
  {loading&&<p className="text-xs text-cyan-400">Inspecting local repository…</p>}
 </main>;
}