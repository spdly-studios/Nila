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

The relay implements `POST /api/calls/outbound`, `POST /api/webhooks/snapserve`, and `GET /api/calls/:id`. Outbound requests automatically include the webhook URL. When SnapServe calls the webhook, the relay fetches the final call details and persists the complete record to `calls.json` using the documented `Authorization: Bearer` server request.
