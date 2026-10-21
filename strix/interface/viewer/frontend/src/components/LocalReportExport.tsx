import type { LoadedRun } from "@/data/serverSource";
import { Download, FileText } from "lucide-react";

function saveFile(name: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function md(run: LoadedRun): string {
  const s = run.summary;
  const sections = [
    "# " + (s.runName || "Assessment") + " — Local Report",
    "", "Run ID: " + (s.runId || "none"),
    "Status: " + (s.status || "unknown"),
    "Targets: " + (s.targets.join(", ") || "none"),
    "Start: " + (s.startTime || "unknown"),
    "End: " + (s.endTime || "in progress"), "",
    "## Executive Summary", s.executiveSummary || "Not supplied.", "",
    "## Technical Analysis", s.technicalAnalysis || "Not supplied.", "",
    "## Methodology", s.methodology || "Not supplied.", "",
    "## Recommendations", s.recommendations || "Not supplied.", "",
    "## Findings (" + run.vulnerabilities.length + ")"
  ];
  for(const v of run.vulnerabilities) sections.push("", "### " + v.title, "Severity: " + v.severity, "Target: " + (v.target || "unspecified"), "", v.description || "No description recorded.", "", "Evidence: " + (v.evidence || "Not attached."));
  sections.push("", "## Agent Activity", run.transcript.agents.length + " agents; " + run.transcript.events.length + " recorded events.", "", "All results require independent verification before disclosure or submission.");
  return sections.join("\n");
}
export default function LocalReportExport({ run }: { run: LoadedRun | null }) {
  const available = Boolean(run && (run.summary.runId || run.vulnerabilities.length || run.transcript.events.length));
  const name = (run?.summary.runName || "atlas-assessment").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 65) || "atlas-assessment";
  return <div className="rounded-xl border border-[#222] bg-[rgba(255,255,255,0.02)] p-5 space-y-3">
    <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-[#888]"/><h2 className="text-sm font-semibold text-white">Local evidence export</h2></div>
    <p className="text-xs text-[#888]">Download the currently selected run directly in your browser; no external account, email delivery or cloud upload.</p>
    <div className="flex flex-wrap gap-2">
      <button className="inline-flex items-center gap-2 rounded-lg border border-[#444] px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!available} onClick={()=>run&&saveFile(name+".md",md(run),"text/markdown;charset=utf-8")}><Download className="h-4 w-4"/>Download Markdown</button>
      <button className="inline-flex items-center gap-2 rounded-lg border border-[#444] px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={!available} onClick={()=>run&&saveFile(name+".json",JSON.stringify({run:run.raw,vulnerabilities:run.vulnerabilities,transcript:run.transcript,reportMarkdown:run.reportMarkdown},null,2),"application/json")}><Download className="h-4 w-4"/>Download evidence JSON</button>
    </div>
    {!available&&<p className="text-xs text-[#666]">No run evidence is loaded. Export becomes available when data is attached to this dashboard.</p>}
  </div>;
}
