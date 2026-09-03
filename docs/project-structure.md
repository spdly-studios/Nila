# Project Structure

Attendly is a browser-based attendance dashboard backed by a Node.js relay. The repository keeps page entry points at the root and groups shared frontend assets by type.

## Directory layout

```text
.
├── css/
│   ├── styles.css       # Shared dashboard styles
│   └── pitch.css        # Pitch deck styles
├── js/
│   ├── app.js           # Attendance register and parent-call workflow
│   ├── analytics.js     # Attendance insights and risk indicators
│   ├── history.js       # Call history, filters, details, and analysis
│   ├── settings.js      # Browser-session AI settings
│   ├── navigation.js    # Shared application navigation
│   └── pitch.js         # Pitch deck navigation and presentation behavior
├── docs/
│   └── project-structure.md
├── index.html           # Attendance dashboard
├── history.html         # Parent call history
├── analytics.html       # Attendance insights
├── settings.html        # AI configuration
├── docs.html            # Product and operations documentation
├── status.html          # Live relay status dashboard
├── pitch.html           # Attendly / Nila pitch deck
└── server.js            # Static file server and SnapServe relay
```

## Page and asset mapping

| Page | Stylesheet | Script | Purpose |
| --- | --- | --- | --- |
| `index.html` | `css/styles.css` | `js/app.js` | Mark attendance, add students, and start parent calls |
| `history.html` | `css/styles.css` | `js/history.js` | Review, filter, analyze, and export calls |
| `analytics.html` | `css/styles.css` | `js/analytics.js` | Identify absence trends and recurring risks |
| `settings.html` | `css/styles.css` | `js/settings.js` | Configure browser-session AI overrides |
| `pitch.html` | `css/pitch.css` | `js/pitch.js` | Present the Attendly product story |

## Adding frontend files

- Put shared dashboard styles in `css/styles.css`.
- Put pitch-only styles in `css/pitch.css`.
- Put browser scripts in `js/` and use a descriptive page-oriented filename.
- Reference assets from HTML with paths beginning `css/` or `js/`.
- Keep the HTML entry pages at the repository root so the existing server routes continue to work.

## Serving locally and on Render

`server.js` serves root HTML pages and nested static assets from the repository directory. It also exposes the attendance, call, webhook, diagnostics, and logging APIs. Render uses `render.yaml` to run the relay and mounts persistent data at `/var/data`.
