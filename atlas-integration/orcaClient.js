// Browser integration for the original Strix-style Atlas dashboard.
// Access tokens remain in memory. No simulated responses or fake telemetry.
export function createOrcaClient({accessToken,endpoint="/api/orca"}={}) {
  if (!accessToken) throw new Error("Dashboard access token required");
  return {
    async status() {
      const r=await fetch(endpoint,{cache:"no-store"});
      if (!r.ok) throw new Error("Gateway health check failed");
      return r.json();
    },
    async chat(messages, max_tokens=2048) {
      const r=await fetch(endpoint,{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+accessToken},
        body:JSON.stringify({messages,max_tokens})
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||"Orca request failed");
      return data;
    }
  };
}
// Bind your dashboard's send action to client.chat(messages).
// Render response.message into the terminal/chat panel.
// Render response.usage and response.latencyMs into the stats tracker.
// Do not display an active-model badge unless status().configured is true.
