# Attendly

Attendly is a static attendance UI with a server-side SnapServe relay.

## Run the relay

Use Node.js 18 or newer. Set the API key in the server environment, never in the browser:

```powershell
$env:SNAPSERVE_API_KEY = "sk_live_your_key_here"
$env:ALLOWED_ORIGIN = "https://spdly-studios.github.io"
npm start
```

Deploy `server.js` to a Node host, then open Attendly Settings and enter that relay's public URL. GitHub Pages can host the UI, but it cannot run the relay itself.

The relay implements `POST /api/calls/outbound` and `GET /api/calls/:id` against `https://app.snapserve.ai/api`, using the documented `Authorization: Bearer` server request.
