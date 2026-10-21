# Atlas HQ — independent viewer and Kali data bridge

This branch preserves Strix OSS viewer layout and its existing graph, terminal, transcript,
findings, history, reporting and MCP display components. The original `main` branch is
unchanged. Atlas HQ runs on a separate local SQLite API, not Strix Cloud.

## Start on Kali / WSL

From the **atlas-hq-independent branch** at the repository root:

```bash
bash atlas_hq/start.sh
```

Open `http://127.0.0.1:8765/` in the browser on the same host (on Windows with
WSL2 forwarding enabled, the same address usually works in Windows Chrome).
The startup script builds the original React viewer once if its static files
are stale, then runs a **stdlib-only Python server**. Subsequent starts require
no Node, Docker, paid Strix credit, remote service or background scan.

The only runtime files created are `~/.atlas-hq/runs.sqlite3` and
`~/.atlas-hq/ingest-token` (created mode 0600). Backend binds loopback only.
The ingest token is mandatory for every write. **Do not publicly expose port
8765 or share the token.**

## Attach observed Kali activity (second terminal)

The following commands **record** a manually selected authorized activity;
none of the commands below initiates a scan or runs a shell command.

```bash
# 1. State the target you are authorized to work on
python3 atlas_hq/emit.py init --run my-authorized-run --target https://authorized.example --authorized

# 2. Register a Kali terminal / agent in the original agent graph
python3 atlas_hq/emit.py agent --run my-authorized-run --id kali-1 --name "Kali terminal"

# 3. After performing an authorized command yourself, attach its real output
python3 atlas_hq/emit.py log --run my-authorized-run --agent kali-1 \
  --command "command executed by the operator" --file ./captured-command-output.txt --exit-code 0

# 4. Optional: attach an actual observed finding; JSON title required
python3 atlas_hq/emit.py finding --run my-authorized-run --file ./observed-finding.json

# 5. Optional: attach a report and finish the record
python3 atlas_hq/emit.py report --run my-authorized-run --file ./report.md
python3 atlas_hq/emit.py finish --run my-authorized-run
```

For actual terminal streams, supply an actual captured output file or pipe
existing stdout to `emit.py log`. Command labels are not executed.

### API formats

- `GET /api/health`: independent bridge status.
- `GET /api/run`, `/api/runs`, `/api/transcript`, `/api/vulnerabilities`,
  `/api/report`: the same read contracts as the original viewer.
- `POST /api/event` with `X-Atlas-HQ-Token`: append record envelope
  `{"run":"run-id","kind":"run|agent|tool|chat|finding|report","data":{...}}`.
  First event must be a `run` containing a user-supplied authorized target
  in `targets_info:[{"original":"..."}]`. The HTTP API does not verify a
  program's scope; `--authorized` records the operator's assertion.
- `GET /api/capabilities` returns `{"can_steer":false}`. Run-control execution,
  agent steering and report email are **not connected**, rather than pretended.

### What is operational and what remains a connector

- Working in-browser: original navigation, graph/transcript rendering for imported
  events, finding views, local history, Markdown/JSON downloads, PR review queue,
  local operator roster and live MCP connection status **when provided by a run**.
- Strix Cloud-exclusive PR auditing, collaboration invitations, hosted integrations,
  email OTP/PDF generation and automatic agent execution are **not included in
  the open-source fork**. The similarly named local tabs are transparent local
  organizers; they do not impersonate working cloud services.
- GPT-6 is **not** silently connected as an API backend. Connecting an approved
  ChatGPT/OpenAI execution provider is a separate authenticated integration.
- The standalone Vercel preview is a **UI demonstration** with an empty read-only
  API and browser-local organizers; local Kali records appear only when the
  local bridge hosts the viewer. A cloud browser cannot directly read local Kali
  files without a separate, explicitly authorized secure connection.

Every target still requires program-specific scope checks and human authorization
before executing security tests. This project is an organizer and evidence viewer,
not an automated scanner.
