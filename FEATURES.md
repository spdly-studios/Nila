# Attendly feature guide

Attendly is a Render-hosted attendance and parent follow-up app. The live service is:

`https://nila-v80b.onrender.com`

## Pages

- `/` — attendance register and outbound parent calls
- `/history.html` — searchable call history with refresh, filters, tags, summaries, and transcript details
- `/analytics.html` — absence patterns, weekday clusters, and risk ranking
- `/settings.html` — browser-session AI configuration

All pages use the same navigation order: Attendance, Call history, Insights, Settings.

## Attendance

- Class-specific rosters are available for 8-A, 7-B, 10-C, and 6-A.
- Seeded students are present by default.
- Seeded students use `8637488905` as the default number.
- New students can be added with a different number.
- Attendance is submitted to the backend with date, class, roster, and present/absent state.
- The current staff name is Shivaprasad V.

## SnapServe calling

- Outbound calls are sent through the server relay, never directly with the SnapServe key in the browser.
- Student and parent identity are sent in explicit fields: `studentName`, `parentName`, `name`, and `pname`.
- The default language context is Tamil (`ta-IN`).
- The Nila prompt requires Tamil first, explicit language switching only when requested, one summary confirmation, and immediate call completion when there is nothing more to add.
- Inbound instructions first ask for the student name and then the reason for calling.

The complete agent prompt is in [SNAP_SERVE_AGENT_INSTRUCTIONS.md](SNAP_SERVE_AGENT_INSTRUCTIONS.md).

## Webhooks and call synchronization

SnapServe webhook URL:

`https://nila-v80b.onrender.com/api/webhooks/snapserve`

Enable `call.completed` and optionally `call.failed` in SnapServe. The relay verifies `X-SnapServe-Signature` using HMAC-SHA256 over `{timestamp}.{rawBody}` when `SNAPSERVE_WEBHOOK_SECRET` is configured.

Webhook data is stored, then the relay retrieves the complete call record from SnapServe. Call History refresh also imports the remote call list and retrieves related call logs, disposition, caller memory, meeting recording metadata, and agent details. This refresh works even when a call is not present in the relay’s memory.

## Stored data

On the Render persistent disk:

- `calls.json` — outbound request, identity, SnapServe record, original webhook, translated transcript, AI analysis, related records, and timestamps
- `attendance.json` — dated class attendance snapshots
- `activity.log` — attendance, call, webhook, AI, process, and error events

JSON writes use atomic replacement. The backend also provides:

- `GET /api/calls`
- `GET /api/calls?refresh=1`
- `GET /api/calls/:id`
- `POST /api/calls/:id/analyze`
- `GET /api/calls/export.csv`
- `GET /api/attendance`
- `POST /api/attendance`
- `GET /api/logs`
- `GET /api/diagnostics`

## AI processing

For multilingual transcripts:

1. The original transcript is preserved.
2. Non-English text is translated to English while preserving speaker labels.
3. Agent speech, instructions, metadata, and caller memory are excluded from analysis.
4. Muse Glimmer generates a concise parent-only summary and main reason.
5. Nemotron generates normalized reason tags.

Default Render variables:

```text
AI_ENDPOINT=https://integrate.api.nvidia.com/v1/chat/completions
AI_API_KEY=your-NVIDIA-key
AI_MODEL=meta/muse-glimmer-30b
AI_TAG_MODEL=nemotron-3-embed-1b
```

Call History supports automatic refresh analysis and manual `Generate analysis` / `Re-analyze` actions. If AI is unavailable, structured SnapServe disposition data and transcript speech provide a generic fallback.

The Settings page allows endpoint, summary model, and tag model overrides for the current browser session only.

## Call History

- Cards show student, parent, date/time, status, main reason, and tags.
- Search by student, parent, or reason.
- Filter by tag and call status.
- Click a call for the main reason, parent-only summary, English transcript, and original transcript.
- Export all stored calls as CSV.

## Insights

- Total recorded attendance days
- Total absence events
- Highest-absence weekday
- Frequent absentee ranking
- Weekday recurrence observations
- Class-wide absence clustering
- Repeated-absence risk queue

## Debugging and diagnostics

Browser errors and unhandled promise rejections are written to the browser console. Relay errors are written to Render logs and `activity.log`.

Use `/api/diagnostics` to check SnapServe, AI, and webhook configuration, stored record counts, and the latest webhook timestamp.

## Deployment

The service is configured in [render.yaml](render.yaml). Render should use:

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

`PUBLIC_URL` should be `https://nila-v80b.onrender.com`. The persistent disk is mounted at `/var/data` through `DATA_DIR` in the Render blueprint.

Callback tracking is intentionally not implemented.
