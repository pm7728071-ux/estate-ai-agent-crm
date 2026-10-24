# Estate AI Agent CRM

Autonomous real estate AI agent dashboard: **Live Inboxes**, **Agent Memory Bank**, **System Action Logs**.

Built as part of a 60-day evaluation-to-evidence program (started 2026-10-24). Free tier throughout: Node/Express, JSON persistence, no paid services.

## Run locally
```bash
npm install && npm start   # http://localhost:3000
```

## API
- `GET /health` — uptime check
- `GET/POST /api/inboxes` — client conversations (`POST /api/inboxes/:id/reply` — agent drafts a reply)
- `GET/POST /api/memories` — the agent's learned knowledge (type, entry, confidence)
- `GET /api/logs` — timestamped, attributable action log

## Deploy to Render (free plan)
The repo includes a `render.yaml` blueprint. In Render: **New → Blueprint → select this repo → Apply** — build `npm install`, start `node server.js`, health check `/health`.

## Roadmap
Days 1–14 evaluation engine · 15–30 execution loop (understand → memory → act → verify → approval gate) · 31–45 prove improvement · 46–60 release evidence.
