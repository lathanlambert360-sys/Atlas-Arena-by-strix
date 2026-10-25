import { useMemo, useState } from "react";
import { Terminal, Copy, Check } from "lucide-react";
import type { TranscriptEvent } from "@/data/serverSource";

type TerminalItem = { id: string; agent: string; at: string; cmd: string; output: string; error: string; exit: number|null; status: string };
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
const SESSIONS = ["Kali · Main", "Kali · Session 2", "Kali · Session 3"] as const;
function safeText(value: unknown): string { return typeof value === "string" ? value : ""; }

export default function TerminalWorkspaceView({ events }: { events: TranscriptEvent[] }) {
  const [filters, setFilters] = useState<string[]>(["", "", ""]);
  const [agents, setAgents] = useState<string[]>(["all", "all", "all"]);
  const [copied, setCopied] = useState<string|null>(null);
  const lines = useMemo((): TerminalItem[] => events.flatMap(event => {
    if (event.type !== "tool") return [];
    const d = asRecord(event.data), tool = String(d.tool_name ?? "");
    if (!["exec_command", "write_stdin", "terminal_execute"].includes(tool)) return [];
    const args = asRecord(d.args), result = asRecord(d.result);
    return [{
      id: event.id, agent: event.agent_id, at: event.timestamp,
      cmd: String(args.command ?? args.cmd ?? args.chars ?? ""),
      output: typeof d.result === "string" ? d.result : safeText(result.content),
      error: safeText(result.error),
      exit: typeof result.exit_code === "number" ? result.exit_code : null,
      status: String(d.status ?? "unknown"),
    }];
  }).reverse().slice(0, 750), [events]);
  const distinctAgents = useMemo(() => Array.from(new Set(lines.map(item => item.agent))).sort(), [lines]);
  const copy = async (id:string, value:string) => {
    try { await navigator.clipboard.writeText(value); setCopied(id); setTimeout(() => setCopied(null), 1300); }
    catch { /* clipboard permissions may deny copy */ }
  };
  return <div className="space-y-5">
    <div className="flex items-start gap-3">
      <Terminal className="h-5 w-5 shrink-0 text-emerald-400" />
      <div><h1 className="text-2xl font-semibold text-emerald-400">Cyber ∞ Security — Atlas Terminal</h1>
        <p className="mt-1 text-sm text-[#888]">Three independent views of observed Strix/Kali/Codex terminal events. Existing bridge and telemetry remain unchanged.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {SESSIONS.map((name, index) => {
        const visible = lines.filter(item =>
          (agents[index] === "all" || item.agent === agents[index]) &&
          (item.agent + " " + item.cmd + " " + item.output + " " + item.error).toLowerCase().includes(filters[index].toLowerCase())
        ).slice(0, 250);
        return <section key={name} className="min-w-0 overflow-hidden rounded-xl border border-emerald-900/60 bg-[#050a06]">
          <div className="flex flex-wrap items-center gap-2 border-b border-emerald-900/60 bg-[#06140a] p-3">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <strong className="text-sm text-emerald-300">{name}</strong>
            <span className="ml-auto text-[11px] text-emerald-600">{visible.length} events</span>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-emerald-950 px-3 py-2">
            <select aria-label={name + " agent"} className="min-w-0 flex-1 rounded border border-emerald-900 bg-black px-2 py-1.5 text-xs text-emerald-300" value={agents[index]} onChange={e => setAgents(prev => prev.map((v,i) => i === index ? e.target.value : v))}>
              <option value="all">All agents</option>
              {distinctAgents.map(agent => <option key={agent} value={agent}>{agent}</option>)}
            </select>
            <input aria-label={name + " filter"} className="min-w-0 flex-1 rounded border border-emerald-900 bg-black px-2 py-1.5 text-xs text-emerald-300 placeholder:text-emerald-900" placeholder="Filter output" value={filters[index]} onChange={e => setFilters(prev => prev.map((v,i) => i === index ? e.target.value : v))} />
          </div>
          <div className="h-[520px] overflow-y-auto px-3 py-3 font-mono text-xs leading-5 text-emerald-400" role="log" aria-label={name + " output"}>
            {visible.length === 0 ? <div className="text-emerald-700">[ATLAS] No matching event telemetry. Awaiting authenticated collector data.</div> :
              visible.map(item => <div key={item.id} className="mb-4 border-b border-emerald-950 pb-3">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-emerald-700">
                  <span className="min-w-0 flex-1 truncate">{item.agent} · {item.at}</span>
                  <span>{item.status}</span>
                  <button title="Copy command" aria-label="Copy command" onClick={() => void copy(name+item.id,item.cmd)}>{copied === name+item.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
                </div>
                <div className="whitespace-pre-wrap break-all text-emerald-300"><span className="text-emerald-600">kali@atlas:~$ </span>{item.cmd || "(unlabelled command)"}</div>
                {item.output && <pre className="mt-1 whitespace-pre-wrap break-words text-emerald-400">{item.output}</pre>}
                {item.error && <pre className="mt-1 whitespace-pre-wrap break-words text-red-400">{item.error}</pre>}
                {item.exit !== null && <div className={item.exit === 0 ? "text-emerald-500" : "text-red-400"}>{item.exit === 0 ? "EXPLOIT SUCCESS / COMMAND EXIT 0 (not vulnerability proof)" : "EXPLOIT FAILURE / COMMAND EXIT " + item.exit}</div>}
              </div>)
            }
          </div>
        </section>;
      })}
    </div>
    <p className="text-xs text-[#666]">These are three independent views of authenticated command telemetry, not three newly provisioned shell processes. Exit code 0 does not prove exploitation. No command execution is exposed through this dashboard.</p>
  </div>;
}
