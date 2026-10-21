// Atlas Arena owns these routes. No Strix services, tokens or credit spending.
// The headquarters remains read-only until an execution backend is configured.
const json=(res,status,data)=>{res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(data));};
export default function handler(req,res){
 const path=(new URL(req.url,"https://arena.local")).pathname.replace(/^\/api\/?/,"");
 const get=req.method==="GET";
 if(get&&path==="health")return json(res,200,{service:"atlas-arena",status:"online",execution:"not_configured",connectors:{atlas:"chatgpt-workspace",codex:"not_configured",claude:"deferred"}});
 if(get&&path==="integrations")return json(res,200,{timestamp:new Date().toISOString(),integrations:{
    kali:{status:"not_connected",detail:"Cloud preview cannot reach local Kali; open the authenticated local viewer."},
    hexstrike:{status:"not_connected",detail:"Local HexStrike API is not publicly exposed."},
    codex:{status:"not_connected",detail:"Codex CLI event adapter runs only on the authorized local host."},
    github:{status:"not_connected",detail:"No GitHub account token is linked to this public viewer."},
    rea:{status:"not_connected",detail:"REA local CLI is not linked to this cloud deployment."},
    bugtraceai:{status:"not_connected",detail:"No remote MCP bridge configured."},
    adstrike:{status:"not_connected",detail:"No remote MCP bridge configured."},
    strix:{status:"not_connected",detail:"The application is intentionally independent from Strix Cloud."}
 }});
 if(get&&path==="run")return json(res,200,{run_id:null,run_name:"ATLAS ARENA",status:"idle",scan_mode:null,targets_info:[],finished:true,start_time:null,end_time:null,scan_results:{executive_summary:"No assessment has been created. Configure an authorized target and a separate execution backend.",technical_analysis:null,methodology:null,recommendations:null},mcp_connection_status:[]});
 if(get&&path==="runs")return json(res,200,{locked:false,count:0,runs:[]});
 if(get&&path==="vulnerabilities")return json(res,200,[]);
 if(get&&path==="report")return json(res,200,{markdown:null});
 if(get&&path==="transcript")return json(res,200,{agents:[],events:[]});
 if(get&&path==="capabilities")return json(res,200,{can_steer:false});
 if(get&&path==="auth/status")return json(res,200,{verified:false,email:null});
 if(req.method==="POST"&&path==="event")return json(res,200,{ok:true});
 if(req.method==="POST"&&path==="auth/forget")return json(res,200,{ok:true});
 if(req.method==="POST"&&["agents/steer","feedback","auth/otp/start","auth/otp/verify","report/send"].includes(path))return json(res,503,{ok:false,error:"independent_backend_not_configured"});
 return json(res,404,{ok:false,error:"unknown_atlas_route",path});
}
