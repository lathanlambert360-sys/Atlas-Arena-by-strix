# Atlas Arena → OrcaCyber gateway

Branch: `atlas-hq-independent`. Free-route integration, not Strix Cloud BYOK.

## Setup
Copy `atlas-integration/api/orca.js` to the Vercel Vite dashboard project's root `api/orca.js`.
Set these **server-side** Vercel environment variables:
- `ORCAROUTER_API_KEY` — actual OrcaRouter API credential
- `ATLAS_DASHBOARD_TOKEN` — strong random password used to authorize dashboard requests
- `ORCA_MODEL` — optional, default `orca/orcacyber-flash-1.0-free`

Use `atlas-integration/orcaClient.js` in the dashboard's browser app. Enter the dashboard access token in the UI and keep it in memory. Never ship the OrcaRouter key in browser code.

GET `/api/orca` returns gateway configuration and live deployment status.
POST `/api/orca` sends real messages to OrcaRouter and returns model text, token usage, request ID, and elapsed time.
A 503 means the key is missing; 502 means upstream failed. No fabricated successes.

The original dashboard frontend is NOT in this repository path. Installing the backend here does not alter the hosted Strix UI or deploy it to Vercel. Move these files into the actual dashboard source before deploying and validating its knowledge/statistics/terminal panels.

Smoke test (after deployment):
```bash
curl -s https://YOUR_DASHBOARD_DOMAIN/api/orca
curl -s https://YOUR_DASHBOARD_DOMAIN/api/orca -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ATLAS_DASHBOARD_TOKEN" \
  -d '{"messages":[{"role":"user","content":"Reply with OK"}]}'
```
