import { useEffect, useState } from "react";
import { ArrowUpRight, Bot, CircleCheck, Clock3, GitPullRequest, Plug, Shield, Users } from "lucide-react";
import type { McpConnectionStatus } from "@/data/serverSource";

type Review = { id: string; url: string; note: string; status: "queued" | "reviewing" | "reviewed"; created: string };
type Member = { id: string; name: string; role: "Owner" | "Reviewer" | "Operator" };
type Page = "pr-reviews" | "integrations" | "members";

function readLocal<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function useStored<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readLocal(key, fallback));
  const update = (v: T) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage disabled */ } };
  return [value, update];
}
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 ${className}`}>{children}</section>;
}
function Heading({ icon: Icon, title, text }: { icon: typeof Bot; title: string; text: string }) {
  return <div className="flex items-start gap-3"><Icon className="h-5 w-5 shrink-0 text-[#888]" aria-hidden="true" /><div><h1 className="text-2xl font-semibold text-white">{title}</h1><p className="mt-1 text-sm text-[#888]">{text}</p></div></div>;
}
const input = "w-full rounded-lg border border-[#333] bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#777]";
const button = "rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-40";
function ReviewPage() {
  const [items, setItems] = useStored<Review[]>("atlas_hq_pr_review_queue", []);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:" || !["github.com", "gitlab.com", "bitbucket.org"].includes(u.hostname) || !u.pathname || u.pathname === "/") throw new Error("Use a GitHub, GitLab, or Bitbucket HTTPS pull request URL.");
      if (items.some(i => i.url === u.href)) throw new Error("This review is already in the queue.");
      setItems([{ id: crypto.randomUUID(), url: u.href, note: note.trim(), status: "queued", created: new Date().toISOString() }, ...items]);
      setUrl(""); setNote(""); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Invalid pull request URL"); }
  };
  return <div className="space-y-6">
    <Heading icon={GitPullRequest} title="PR Security Reviews" text="Track authorized code reviews without launching a scan. The queue is saved in this browser." />
    <Panel>
      <h2 className="mb-3 text-sm font-semibold text-white">Add pull request</h2>
      <form onSubmit={add} className="space-y-3">
        <input aria-label="Pull request URL" className={input} placeholder="https://github.com/owner/repo/pull/123" value={url} onChange={e=>setUrl(e.target.value)} />
        <input aria-label="Review notes" className={input} placeholder="Scope / review notes (optional)" value={note} onChange={e=>setNote(e.target.value)} />
        <div className="flex items-center justify-between gap-3"><p role="alert" className="text-xs text-red-400">{error}</p><button className={button} type="submit" disabled={!url.trim()}>Add to queue</button></div>
      </form>
    </Panel>
    <Panel>
      <h2 className="mb-3 text-sm font-semibold text-white">Review queue ({items.length})</h2>
      {items.length === 0 ? <p className="text-sm text-[#888]">No pull requests queued.</p> :
      <div className="space-y-3">{items.map(item=><div key={item.id} className="rounded-lg border border-[#292929] px-3 py-3">
        <div className="flex items-center justify-between gap-3"><a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-sm text-white hover:underline">{item.url} <ArrowUpRight className="inline h-3 w-3" /></a><span className="shrink-0 text-xs capitalize text-[#888]">{item.status}</span></div>
        {item.note && <p className="mt-2 text-xs text-[#888]">{item.note}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="rounded-md border border-[#333] bg-black px-2 py-1 text-xs" aria-label="Review status" value={item.status} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,status:e.target.value as Review["status"]}:i))}>
            <option value="queued">Queued</option><option value="reviewing">Reviewing</option><option value="reviewed">Reviewed</option>
          </select>
          <span className="text-xs text-[#666]">{new Date(item.created).toLocaleString()}</span>
          <button className="ml-auto text-xs text-[#888] hover:text-red-400" onClick={()=>setItems(items.filter(i=>i.id!==item.id))}>Remove</button>
        </div>
      </div>)}</div>}
      <p className="mt-4 text-xs text-[#666]">Queue status is organizational only; no automated PR audit, repository access, or authorization is implied.</p>
    </Panel>
  </div>;
}
type ConnectionEvidence = { status: string; detail: string };
type ConnectionsResponse = { timestamp: string; integrations: Record<string, ConnectionEvidence> };
function IntegrationPage({ connections }: { connections: McpConnectionStatus[] }) {
  const [backend, setBackend] = useState<ConnectionsResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/integrations", {cache: "no-store"});
        if (!res.ok) throw new Error("Integration status endpoint unavailable (HTTP " + res.status + ")");
        const data = await res.json() as ConnectionsResponse;
        if (mounted) { setBackend(data); setError(""); }
      } catch(err) {
        if(mounted) setError(err instanceof Error ? err.message : "Unable to reach backend");
      }
    };
    void refresh();
    const timer = setInterval(()=>{void refresh()}, 15000);
    return ()=>{mounted=false;clearInterval(timer)};
  }, []);
  const integrations = Object.entries(backend?.integrations ?? {});
  return <div className="space-y-6">
    <Heading icon={Plug} title="Integrations" text="Live local bridge checks and current run MCP connections. No Strix Cloud dependency." />
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Local execution environment</h2>
        <span className="text-xs text-[#777]">Auto-refresh every 15 s</span>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-400">{error}</p> : null}
      {integrations.length === 0 ? <p className="mt-3 text-sm text-[#888]">No local integration telemetry available from this deployment.</p> :
        <div className="mt-4 space-y-2">
          {integrations.map(([name, value]) => {
            const connected = value.status === "connected";
            const installed = value.status === "installed" || value.status === "source_present";
            return <div key={name} className="flex gap-3 border-t border-[#252525] py-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-400" : installed ? "bg-yellow-400" : "bg-[#666]"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium capitalize">{name}</span><span className="text-xs text-[#888]">{value.status.replaceAll("_"," ")}</span></div>
                <p className="mt-1 text-xs text-[#666]">{value.detail}</p>
              </div>
            </div>;
          })}
        </div>}
      <p className="mt-3 text-xs text-[#555]">An installed CLI is not an active authenticated API connection. Connection statuses are read-only; no tool or scan is launched by this page.</p>
    </Panel>
    <Panel>
      <h2 className="mb-3 text-sm font-semibold text-white">MCP Connections ({connections.length})</h2>
      {connections.length === 0 ? <p className="text-sm text-[#888]">No MCP connection roster has been attached to this run.</p> : <div className="space-y-2">{connections.map(c=><div key={c.name} className="flex items-center gap-3 border-t border-[#222] pt-2"><span className={`h-2 w-2 rounded-full ${c.dead?"bg-red-400":"bg-emerald-400"}`}/><div className="flex-1 text-sm">{c.name}</div><span className="text-xs text-[#888]">{c.dead?"Offline":`${c.toolCount} tools`}</span></div>)}</div>}
    </Panel>
  </div>;
}
function MembersPage() {
  const [members,setMembers] = useStored<Member[]>("atlas_hq_local_roster",[]);
  const [name,setName] = useState("");
  const [role,setRole] = useState<Member["role"]>("Reviewer");
  return <div className="space-y-6">
    <Heading icon={Users} title="Members" text="A local operator roster for organizing work; not an access-control system." />
    <Panel>
      <h2 className="mb-3 text-sm font-semibold text-white">Local team directory ({members.length})</h2>
      <form onSubmit={e=>{e.preventDefault();if(!name.trim())return;setMembers([...members,{id:crypto.randomUUID(),name:name.trim(),role}]);setName("")}} className="mb-4 flex flex-wrap gap-2">
        <input aria-label="Member name" className={`${input} flex-1`} placeholder="Member name" value={name} onChange={e=>setName(e.target.value)} />
        <select aria-label="Member role label" className="rounded-lg border border-[#333] bg-black px-3 text-sm" value={role} onChange={e=>setRole(e.target.value as Member["role"])}><option>Reviewer</option><option>Operator</option><option>Owner</option></select>
        <button type="submit" className={button} disabled={!name.trim()}>Add</button>
      </form>
      {members.length===0?<p className="text-sm text-[#888]">No local roster entries.</p>:<div className="space-y-2">{members.map(m=><div key={m.id} className="flex items-center gap-3 border-t border-[#222] py-2 text-sm"><Shield className="h-4 w-4 text-[#888]"/><span className="flex-1">{m.name}</span><span className="text-xs text-[#888]">{m.role}</span><button className="text-xs text-[#888] hover:text-red-400" onClick={()=>setMembers(members.filter(i=>i.id!==m.id))}>Remove</button></div>)}</div>}
      <p className="mt-4 text-xs text-[#666]">Adding a person here does not invite them, give account access, or assign permissions. Shared membership requires an independent authenticated backend.</p>
    </Panel>
  </div>;
}
export default function IndependentWorkspaceView({ page, connections }: {page: Page;connections: McpConnectionStatus[]}) {
  if(page==="pr-reviews")return <ReviewPage/>;
  if(page==="integrations")return <IntegrationPage connections={connections}/>;
  return <MembersPage/>;
}
