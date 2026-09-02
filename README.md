# Attendly

Attendly is a static attendance UI with a server-side SnapServe relay.

## Run the relay

Use Node.js 18 or newer. Set the API key in the server environment, never in the browser:

```powershell
$env:SNAPSERVE_API_KEY = "sk_live_your_key_here"
$env:ALLOWED_ORIGIN = "https://spdly-studios.github.io"
npm start
```

Deploy `server.js` to a Node host and set `PUBLIC_URL` to its public HTTPS URL. The UI uses its own origin by default, so users no longer need to enter a relay URL repeatedly. `DATA_DIR` may be set to a writable directory for persisted call records. GitHub Pages can host the UI, but it cannot run the relay itself.

The relay implements `POST /api/calls/outbound`, `POST /api/webhooks/snapserve`, `GET /api/calls/:id`, `GET /api/calls`, and `GET /api/logs`. Attendance records are stored in `attendance.json`; calls retain the outbound request, webhook payload, final SnapServe details, and timestamps in `calls.json`; operational events are written to `activity.log`. Writes are atomic so a restart cannot leave a partially written JSON file. Outbound requests automatically include the webhook URL. When SnapServe calls the webhook, the relay fetches and stores the final call details using the documented `Authorization: Bearer` server request.

Use [SNAPSERVE_AGENT_INSTRUCTIONS.md](SNAPSERVE_AGENT_INSTRUCTIONS.md) as the Nila agent system prompt in SnapServe. It keeps the website’s student/parent identity fields aligned with SnapServe’s prompt variables and stored webhook data.

Inbound calls are included automatically when Call History is refreshed: the relay imports SnapServe’s full call list regardless of direction and stores `direction`, caller number, student identity, transcript, summary, disposition, logs, memory, recording metadata, and webhook data.

Call-reason analysis uses NVIDIA’s OpenAI-compatible API by default. Set `AI_API_KEY` to the same NVIDIA key. Optional overrides are `AI_ENDPOINT` (default `https://integrate.api.nvidia.com/v1/chat/completions`) and `AI_MODEL` (default `meta/muse-glimmer-30b`). The analyzer is re-run automatically when the model changes, and its short main-reason label is kept separate from SnapServe’s full call summary.
