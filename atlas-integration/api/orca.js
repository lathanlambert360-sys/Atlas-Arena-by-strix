// Atlas Arena's server-side OrcaRouter adapter.
// Configure ORCAROUTER_API_KEY and ATLAS_DASHBOARD_TOKEN as server-only secrets.
// Never use NEXT_PUBLIC_ or VITE_ prefixes for secrets.
const MODEL = process.env.ORCA_MODEL || "orca/orcacyber-flash-1.0-free";
const BASE = "https://api.orcarouter.ai/v1";
const MAX_BODY = 64 * 1024;
function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}
export default async function handler(req, res) {
  if (req.method === "GET") return reply(res, 200, {
    service:"atlas-orca", model:MODEL, configured:!!process.env.ORCAROUTER_API_KEY,
    authenticationConfigured:!!process.env.ATLAS_DASHBOARD_TOKEN
  });
  if (req.method !== "POST") return reply(res,405,{error:"Method not allowed"});
  const access = process.env.ATLAS_DASHBOARD_TOKEN;
  if (!access || req.headers.authorization !== "Bearer " + access)
    return reply(res,401,{error:"Unauthorized"});
  if (!process.env.ORCAROUTER_API_KEY)
    return reply(res,503,{error:"OrcaRouter API key not configured"});
  const input = typeof req.body === "string" ? (()=>{try{return JSON.parse(req.body)}catch{return null}})() : req.body;
  if (!input || !Array.isArray(input.messages) || JSON.stringify(input).length > MAX_BODY ||
      input.messages.length > 32 ||
      !input.messages.every(m=>["user","assistant","system"].includes(m.role) &&
        typeof m.content === "string" && m.content.length <= 16000))
    return reply(res,400,{error:"Invalid messages"});
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),45000);
    let upstream;
    try {
      upstream = await fetch(BASE+"/chat/completions",{
        method:"POST",signal:controller.signal,
        headers:{"Authorization":"Bearer "+process.env.ORCAROUTER_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({model:MODEL,messages:input.messages,stream:false,
          ...(Number.isInteger(input.max_tokens) ? {max_tokens:Math.min(4096,Math.max(1,input.max_tokens))}:{})})
      });
    } finally {clearTimeout(timer)}
    const data = await upstream.json().catch(()=>({}));
    if (!upstream.ok) return reply(res,502,{error:"OrcaRouter upstream request failed",upstreamStatus:upstream.status});
    return reply(res,200,{model:data.model||MODEL,
      message:data.choices?.[0]?.message?.content||"",
      usage:data.usage||null,latencyMs:Date.now()-started,
      upstreamId:data.id||null});
  } catch (e) {
    return reply(res,502,{error:e?.name==="AbortError"?"OrcaRouter timeout":"OrcaRouter connection failed"});
  }
}
