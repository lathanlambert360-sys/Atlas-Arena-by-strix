// Atlas Arena cloud API. Transparent status only; never fabricate execution.
const json = (res,status,data) => {
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.end(JSON.stringify(data));
};
export default function handler(req,res) {
  const url=new URL(req.url,"https://arena.local");
  // Preserve the requested route across Vercel's /api/:path* -> /api/entry rewrite.
  const route=Array.isArray(req.query?.route) ? req.query.route.join("/") :
    typeof req.query?.route==="string" ? req.query.route :
    url.searchParams.get("route") || url.pathname.replace(/^\/api\/?/,"");
  const path=route.replace(/^\/+|\/+$/g,"");
  const get=req.method==="GET";
  const disabled={ok:false,error:"backend_not_connected",message:"Atlas Arena cloud viewer is online, but the authenticated Atlas HQ backend has not been connected. Run the local HQ viewer or configure a persistent authenticated backend."};
  if(get&&path==="health")return json(res,200,{service:"atlas-arena",status:"online",execution:"not_configured",connectors:{atlas:"cloud_viewer",codex:"not_connected",hexstrike:"not_connected"},backend_connected:false});
  if(get&&path==="chat")return json(res,200,{available:false,authenticated:false,engine:"not_connected",sandbox:"unavailable",session:{status:"offline",error:"Atlas HQ backend not connected",updated:new Date().toISOString()},messages:[],device_auth:{running:false,output:""}});
  if(get&&path==="integrations")return json(res,200,{timestamp:new Date().toISOString(),integrations:{
    kali:{status:"not_connected",detail:"Cloud viewer has no authenticated connection to local Kali."},
    hexstrike:{status:"not_connected",detail:"HexStrike is connected to other clients, not this Vercel server."},
    codex:{status:"not_connected",detail:"Codex process is not connected to Vercel backend."},
    github:{status:"not_connected",detail:"No account-level GitHub execution adapter is connected."},
    rea:{status:"not_connected",detail:"Local REA CLI is not connected."},
    bugtraceai:{status:"not_connected",detail:"MCP bridge unavailable."},
    adstrike:{status:"not_connected",detail:"MCP bridge unavailable."},
    strix:{status:"not_connected",detail:"Independent of Strix Cloud."}
  }});
  if(get&&path==="run")return json(res,200,{run_id:null,run_name:"ATLAS ARENA",status:"idle",scan_mode:null,targets_info:[],finished:true,start_time:null,end_time:null,scan_results:{executive_summary:"No authenticated execution backend is connected. No run data is available.",technical_analysis:null,methodology:null,recommendations:null},mcp_connection_status:[]});
  if(get&&path==="runs")return json(res,200,{locked:false,count:0,runs:[]});
  if(get&&path==="vulnerabilities")return json(res,200,[]);
  if(get&&path==="report")return json(res,200,{markdown:null});
  if(get&&path==="transcript")return json(res,200,{agents:[],events:[]});
  if(get&&path==="capabilities")return json(res,200,{can_steer:false});
  if(get&&path==="auth/status")return json(res,200,{verified:false,email:null});
  if(path==="chat"||path==="chat/auth/start"||path==="event"||path==="auth/forget"||
     ["agents/steer","feedback","auth/otp/start","auth/otp/verify","report/send"].includes(path))
    return json(res,503,disabled);
  return json(res,404,{ok:false,error:"unknown_atlas_route",path});
}
