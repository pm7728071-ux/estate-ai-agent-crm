# Estate AI Agent CRM

Autonomous real estate AI agent dashboard: **Live Inboxes**, **Agent Memory Bank**, **System Action Logs**.

Status: **hardening in progress; not yet approved for real customer data**. See [the production readiness gate](docs/PRODUCTION_READINESS.md). The `production-hardening` branch adds API token gating, fail-closed storage configuration, property inventory, persistent approval records, a refreshed dashboard, webhook hardening, and CI checks. Role-based identities, complete transactional persistence across the whole application, durable webhook idempotency, and financial go-live validation remain release blockers.

## Run locally
```bash
npm install && npm start   # http://localhost:3000
```

## API
- `GET /health` — health/readiness check (public)
- `GET/POST /api/inboxes` — client conversations
- `GET/POST /api/memories` — client/property/policy memory
- `GET/POST /api/tenants` — agency-scoped tenant register linked to property inventory
- `GET /api/rent/summary`, `GET/POST /api/rent/charges` — rent charges and arrears summary
- `GET/POST /api/rent/payments` — append-only payment records with duplicate reference checks
- `GET /api/rent/audit` — recent rent ledger audit events
- `GET/POST/PATCH /api/properties` — listing inventory and status
- `POST /api/properties/:id/verify` — explicit availability verification with a dated evidence note
- `GET /api/approvals`, `POST /api/approvals/:id/decision` — human review queue
- `GET /api/logs` — action log

All `/api/*` endpoints except `/api/health` require `Authorization: Bearer <ADMIN_API_TOKEN>` in production. The dashboard has a workspace-token field; the token stays in the current browser tab. Keep it secret. This is currently a **single-workspace shared-token gate**, not multi-tenant authentication or role-based access control.

## Deploy to Render
The `render.yaml` blueprint enables production mode, generates an API token, and requires secrets to be configured. In Render, set `MONGODB_URI` to a durable MongoDB deployment before starting the service; production intentionally refuses to start without it. Add Meta WhatsApp credentials only if using that integration. After deploy, copy `ADMIN_API_TOKEN` from Render's environment settings into the dashboard's Workspace access token field. Never put secrets in URLs, source code, screenshots, or commits.

## Rent ledger financial safety

The production rent ledger path uses separate MongoDB collections and transactions for charge/payment/audit writes. Configure a MongoDB replica set or sharded cluster with transaction support. Startup validates and migrates legacy rent-ledger records once per agency; inconsistent legacy data intentionally blocks startup. Back up MongoDB before deployment and verify the migration in staging first.

This is not yet approval to process real rent payments: provider/bank reconciliation, safe retry idempotency, reversal/credit-note workflows, restore drills, and independent security/accounting review are still required. Keep financial tests in staging until those gates are completed. See [the production readiness gate](docs/PRODUCTION_READINESS.md).

## Roadmap
Days 1–14 evaluation engine · 15–30 execution loop (understand → memory → act → verify → approval gate) · 31–45 prove improvement · 46–60 release evidence.

## WhatsApp (Meta Cloud API)

Webhook: `POST /webhook/whatsapp` (verification: `GET /webhook/whatsapp`).

Set these in Render → Environment, then paste the webhook URL into the Meta app:

| Variable | What it is |
|---|---|
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose; enter the same value in Meta's webhook setup |
| `WHATSAPP_TOKEN` | Meta permanent access token (System User) |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number ID from Meta → WhatsApp → API Setup |
| `WHATSAPP_APP_SECRET` | Required in production; validates X-Hub-Signature-256 |

Callback URL: `https://estate-ai-agent-crm.onrender.com/webhook/whatsapp`
Subscribe to the **messages** field. Configure the app secret and credentials before enabling production traffic. In production, requests without a valid signature are rejected. Webhook deduplication is currently in-memory and is not sufficient for multi-instance or restart-safe exactly-once processing. Do not process real customer data until authentication, tenant isolation, durable storage, and the remaining release gates in `docs/PRODUCTION_READINESS.md` are complete.
