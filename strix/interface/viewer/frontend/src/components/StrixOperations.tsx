import {useEffect,useMemo,useState} from "react";
import {AlertCircle,ArrowUpRight,CheckCircle2,ChevronDown,Code2,Download,Loader2,Play,RefreshCw,Search,ShieldCheck} from "lucide-react";
import "./StrixOperations.css";

type Param={name:string;in:"path"|"query";required:boolean;type:string;description:string;enum:unknown[]};
type Op={id:string;method:"GET"|"POST"|"PATCH"|"PUT"|"DELETE";path:string;title:string;tag:string;description:string;parameters:Param[];request_formats:string[];enabled:boolean;dangerous:boolean};
type Catalog={source:string;sha256:string;generated_utc:string;operations:Op[]};
type Connection={configured:boolean;base:string;catalog_operations:number;source:string;spec_sha256:string};
const TAGS:Record<string,string[]>={
 "Dashboard":["Analytics"],"Home":["Analytics"],"Pentests":["Scans","Schedules","Run Logs"],
 "Issues":["Vulnerabilities"],"PR Reviews":["PR Reviews"],"Supply Chain":["Supply Chain"],
 "Containers":["Containers"],"Repositories":["Repositories"],"Domains":["Assets","Test Users"],
 "Asset Discovery":["Asset Discovery"],"Knowledge":["Knowledge"],"Integrations":["Integrations","Connectors","Webhooks"],
 "API":["Tokens","CLI","Uploads"],"Settings":["Organization","Members","Workspaces","Invitations","Billing","License","Audit"],
 "Agents":["Chat","LLM","Run Logs"]
};
const NEED_SCOPE=/scan|pentest|discovery|retest|review|schedule/i;

function BlobDownload({value}:{value:{base64:string;content_type:string;filename?:string}}){
 function download(){
  const bytes=atob(value.base64);const data=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++)data[i]=bytes.charCodeAt(i);
  const url=URL.createObjectURL(new Blob([data],{type:value.content_type}));
  const disposition=value.filename||"";
  const filename=/filename="?([^";]+)"?/i.exec(disposition)?.[1]||"strix-export";
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
 }
 return <button className="so-action" onClick={download}><Download size={14}/> Download actual Strix export</button>;
}

export default function StrixOperations({page,focusOperation}:{page:string;focusOperation?:{id:string;nonce:number}|null}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[connection,setConnection]=useState<Connection|null>(null);
 const [search,setSearch]=useState(""),[selected,setSelected]=useState<string>(""),[params,setParams]=useState<Record<string,string>>({});
 const [body,setBody]=useState(""),[confirmed,setConfirmed]=useState(false),[authorized,setAuthorized]=useState(false);
 const [pending,setPending]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<unknown>(null);
 const [status,setStatus]=useState<number|null>(null),[showAll,setShowAll]=useState(false);
 useEffect(()=>{
  let mounted=true;
  void Promise.all([fetch("/api/strix/catalog",{credentials:"same-origin"}),fetch("/api/strix/connection",{credentials:"same-origin"})])
   .then(async([a,b])=>{
    if(!a.ok||!b.ok)throw Error("Strix gateway is not available on this backend");
    const [c,co]=await Promise.all([a.json(),b.json()]);
    if(mounted){setCatalog(c);setConnection(co)}
   }).catch(e=>{if(mounted)setError(String(e))});
  return ()=>{mounted=false};
 },[]);
 useEffect(()=>{setSearch("");setSelected("");setParams({});setBody("");setResult(null);setStatus(null);setConfirmed(false);setAuthorized(false);setShowAll(false)},[page]);
 useEffect(()=>{if(focusOperation?.id){setSelected(focusOperation.id);setParams({});setBody("");setResult(null);setStatus(null);setError("");setConfirmed(false);setAuthorized(false)}},[focusOperation?.nonce]);
 const relevant=useMemo(()=>{
  const ops=catalog?.operations||[];
  const tags=TAGS[page]||[];
  return ops.filter(op=>(showAll||tags.includes(op.tag))&&
   (op.title+" "+op.id+" "+op.path+" "+op.tag).toLowerCase().includes(search.toLowerCase()));
 },[catalog,page,search,showAll]);
 const op=catalog?.operations.find(x=>x.id===selected);
 const writes=op?.method!=="GET";
 const scanWrite=Boolean(writes&&op&&NEED_SCOPE.test(op.id));
 const canExecute=Boolean(op?.enabled&&connection?.configured&&!pending&&(!writes||(confirmed&&(!scanWrite||authorized))));
 function choose(value:string){setSelected(value);setParams({});setBody("");setResult(null);setStatus(null);setError("");setConfirmed(false);setAuthorized(false)}
 async function invoke(){
  if(!op||!canExecute)return;
  setPending(true);setError("");setResult(null);setStatus(null);
  let payloadBody:unknown=null;
  if(body.trim()){try{payloadBody=JSON.parse(body)}catch{setError("Request body must be valid JSON.");setPending(false);return}}
  try{
   const res=await fetch("/api/strix/execute",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({operation_id:op.id,parameters:params,body:payloadBody,confirmed:!writes||confirmed,authorized})
   });
   const payload=await res.json();
   setStatus(res.status);setResult(payload);
   if(!res.ok)setError("Strix returned HTTP "+res.status+". Inspect the real upstream response below.");
  }catch(e){setError(String(e))}
  finally{setPending(false)}
 }
 return <section className="so-panel" aria-label="Strix API workflow actions">
  <header className="so-heading">
   <div><div className="so-eyebrow"><Code2 size={14}/> STRIX REST API · INFINITE GATEWAY</div><h2>Operational workflows</h2><p>Direct Strix API actions, authenticated by your local backend. No simulated execution.</p></div>
   <span className={"so-status "+(connection?.configured?"on":"")}>{connection?.configured?"API token configured":"API token not configured"}</span>
  </header>
  {!connection?.configured&&<div className="so-notice"><AlertCircle size={17}/>
    <span>Set <code>STRIX_API_TOKEN</code> in the backend environment to enable real Strix Cloud actions. The browser never stores your token. Existing local features remain available.</span></div>}
  <div className="so-toolbar"><label className="so-search"><Search size={16}/><input aria-label="Find a Strix API operation" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search Strix workflows..." /></label>
   <label className="so-all"><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/> All API categories</label>
   <span>{relevant.length} documented operations</span>
  </div>
  <div className="so-layout">
   <div className="so-list" role="list" aria-label="Strix operations">
    {relevant.length===0&&<div className="so-hint">No matching operations in this category.</div>}
    {relevant.map(item=><button key={item.id} className={"so-option "+(selected===item.id?"selected":"")} onClick={()=>choose(item.id)}>
      <span className={"so-method m-"+item.method.toLowerCase()}>{item.method}</span><span><b>{item.title}</b><small>{item.tag} · {item.path}</small></span><ChevronDown size={13}/></button>)}
   </div>
   <div className="so-detail">
    {op?<><div className="so-operation-top"><span className={"so-method m-"+op.method.toLowerCase()}>{op.method}</span><h3>{op.title}</h3></div>
     <code className="so-path">{op.path}</code><p className="so-desc">{op.description||"Operation documented in the Strix OpenAPI specification."}</p>
     {op.parameters.map(p=><label className="so-field" key={p.in+":"+p.name}><span>{p.name} <small>({p.in}) {p.required?"required":"optional"}</small></span>
      {p.enum?.length?<select value={params[p.name]||""} onChange={e=>setParams({...params,[p.name]:e.target.value})}><option value="">Select value</option>{p.enum.map(v=><option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>
       :<input value={params[p.name]||""} type={p.type==="integer"||p.type==="number"?"number":"text"} onChange={e=>setParams({...params,[p.name]:e.target.value})} placeholder={p.description||p.name}/>}</label>)}
     {op.method!=="GET"&&op.request_formats.includes("application/json")&&
       <label className="so-field"><span>JSON request body <small>based on the documented API contract</small></span><textarea value={body} onChange={e=>setBody(e.target.value)} rows={6} spellCheck={false} placeholder={'{\n  "field": "value"\n}'} /></label>}
     {writes&&<label className="so-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I authorize this real Strix {op.method} operation and understand it may change my account or consume credits.</label>}
     {scanWrite&&<label className="so-check"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/> The selected target and operation are within my testing authorization and program scope.</label>}
     <button className="so-action" disabled={!canExecute} onClick={()=>void invoke()}>{pending?<Loader2 className="so-spin" size={16}/>:writes?<ShieldCheck size={16}/>:<Play size={16}/>} {pending?"Contacting Strix...":writes?"Execute authorized action":"Fetch live Strix data"}</button>
     {!op.enabled&&<p className="so-hint">This operation requires a request media type not supported by the JSON gateway.</p>}
     {status!==null&&<p className="so-result-status"><CheckCircle2 size={15}/> Upstream response · HTTP {status}</p>}
     {result!==null&&<div className="so-output"><div>Actual API response</div>{typeof result==="object"&&result!==null&&"binary" in result&&Boolean((result as {binary?:boolean}).binary)?
        <BlobDownload value={result as unknown as {base64:string;content_type:string;filename?:string}}/>:
        <pre>{JSON.stringify(result,null,2)}</pre>}</div>}
    </>:<div className="so-hint so-select">Select a workflow to review its request inputs, required permissions and live response. Writes are never executed automatically.</div>}
   </div>
  </div>
  {error&&<div className="so-error" role="alert">{error}</div>}
  <footer className="so-foot">Contract: <a target="_blank" rel="noopener noreferrer" href="https://docs.app.strix.ai">Strix API documentation <ArrowUpRight size={12}/></a> · {catalog?.operations.length||"—"} catalogued operations · Live responses require your Strix access and permissions.</footer>
 </section>;
}
