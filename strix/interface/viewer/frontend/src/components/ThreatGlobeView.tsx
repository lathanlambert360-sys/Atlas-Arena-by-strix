import { useState } from "react";
import { ExternalLink, Globe2, ShieldAlert } from "lucide-react";

// Independent intelligence panel. The globe is Kaspersky's published live widget.
// The CWE links are authoritative taxonomy references, not synthetic live alerts.
const cweColumns = [
  [
    { id: "CWE-79", title: "Cross-site scripting", group: "Injection" },
    { id: "CWE-89", title: "SQL injection", group: "Injection" },
    { id: "CWE-78", title: "OS command injection", group: "Injection" },
    { id: "CWE-918", title: "Server-side request forgery", group: "Network" },
    { id: "CWE-22", title: "Path traversal", group: "Files" },
    { id: "CWE-502", title: "Unsafe deserialization", group: "Execution" },
  ],
  [
    { id: "CWE-862", title: "Missing authorization", group: "Access control" },
    { id: "CWE-863", title: "Incorrect authorization", group: "Access control" },
    { id: "CWE-639", title: "User-controlled authorization key", group: "IDOR" },
    { id: "CWE-287", title: "Improper authentication", group: "Authentication" },
    { id: "CWE-352", title: "Cross-site request forgery", group: "Web" },
    { id: "CWE-362", title: "Race condition", group: "Concurrency" },
  ]
];
function CwePanel({ items, title }: { items: typeof cweColumns[number]; title: string }) {
  return <aside className="min-w-0 rounded-xl border border-[#252e36] bg-[#0b1016] p-3">
    <div className="mb-3 flex items-center gap-2 border-b border-[#222c36] pb-3">
      <ShieldAlert className="h-4 w-4 text-cyan-400" />
      <h3 className="text-sm font-semibold text-[#e5f3fc]">{title}</h3>
    </div>
    <div className="space-y-2">{items.map(item=><a key={item.id}
      target="_blank" rel="noopener noreferrer"
      href={`https://cwe.mitre.org/data/definitions/${item.id.slice(4)}.html`}
      className="block rounded-lg border border-[#202b35] bg-[#111922] p-3 transition-colors hover:border-cyan-500/50 hover:bg-[#16212c]">
      <span className="text-[11px] font-bold tracking-wider text-cyan-400">{item.id}</span>
      <p className="mt-1 text-xs font-medium text-[#ebf2fa]">{item.title}</p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-[#8593a2]">{item.group}</p>
    </a>)}</div>
    <a className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
      href="https://cwe.mitre.org/" target="_blank" rel="noopener noreferrer">
      MITRE CWE database <ExternalLink className="h-3 w-3"/>
    </a>
  </aside>;
}
export default function ThreatGlobeView() {
  const [reload, setReload] = useState(0);
  return <section className="space-y-4" aria-label="Global cyberthreat intelligence">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-cyan-400"/>
          <h1 className="text-xl font-semibold text-white">Global Threat Intelligence</h1></div>
        <p className="mt-1 text-xs text-[#96a5b1]">Kaspersky Cyberthreat Live Map · MITRE CWE intelligence panels</p>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <button className="rounded-lg border border-[#36404b] px-3 py-2 text-[#d0e4ef] hover:bg-[#17202a]" onClick={()=>setReload(r=>r+1)}>Reload globe</button>
        <a className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
          href="https://cybermap.kaspersky.com/en" target="_blank" rel="noopener noreferrer">Full interactive globe <ExternalLink className="h-3 w-3"/></a>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(190px,1fr)_minmax(0,3.1fr)_minmax(190px,1fr)]">
      <CwePanel title="CWE · Application" items={cweColumns[0]}/>
      <div className="min-w-0 overflow-hidden rounded-xl border border-[#263743] bg-black">
        <div className="flex items-center justify-between border-b border-[#263743] px-3 py-2 text-xs text-[#91a7b6]">
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500"/> Kaspersky global telemetry</span>
          <span>Official embedded live widget</span>
        </div>
        <iframe key={reload} title="Kaspersky live cyberthreat map" src="https://cybermap.kaspersky.com/en/widget/dynamic/dark"
          className="block h-[530px] min-h-[430px] w-full border-0 bg-black md:h-[650px]"
          loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        <p className="border-t border-[#263743] px-3 py-2 text-[11px] text-[#8b9ba8]">
          Based on data from Kaspersky. The widget represents Kaspersky detections; the CWE panels link to MITRE classifications.
        </p>
      </div>
      <CwePanel title="CWE · Access & Logic" items={cweColumns[1]}/>
    </div>
    <div className="flex flex-wrap gap-4 rounded-lg border border-[#252e36] bg-[#0b1016] p-3 text-xs">
      <a className="text-cyan-400 hover:underline" href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noopener noreferrer">CISA · Known Exploited Vulnerabilities ↗</a>
      <a className="text-cyan-400 hover:underline" href="https://nvd.nist.gov/vuln/search" target="_blank" rel="noopener noreferrer">NVD · CVE intelligence ↗</a>
      <a className="text-cyan-400 hover:underline" href="https://cwe.mitre.org/data/index.html" target="_blank" rel="noopener noreferrer">MITRE · CWE catalog ↗</a>
    </div>
  </section>;
}
