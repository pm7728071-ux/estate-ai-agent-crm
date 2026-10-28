# Production readiness gate

This document is an operational checklist, not a claim of certification or completed production readiness.

## Current release status

**Not ready for real customer data or unsupervised property commitments.** The existing app is an evaluation prototype. Complete every P0 item below and validate it in a staging environment before onboarding customers.

## P0 — required before real customers

- [x] Initial shared bearer-token gate for non-public API routes; production requires `ADMIN_API_TOKEN` (single-workspace only, not a complete identity system).
- [ ] Tenant/agency scoping on every read and write; derive tenant identity from the authenticated principal, never from request input.
- [x] Production refuses startup without MongoDB configuration or when MongoDB is unreachable rather than silently using JSON.
- [ ] Replace the single global state document with durable, tenant-scoped collections, indexes, transactions where needed, and controlled schema migrations.
- [ ] Calendar-backed viewing availability and booking. Hardcoded listing recommendations and fabricated viewing slots have been removed; the agent now defers to a human when it cannot verify availability.
- [ ] Enforce webhook signature validation in production and configure the Meta app secret. The current in-memory deduplication map is only a best-effort single-process safeguard; use durable idempotency keys for multiple instances/restarts.
- [ ] Add approval persistence and a real operator workflow. An approval response must not imply a message, booking, payment, or offer was sent unless the external system confirms it.
- [ ] Add request validation, payload limits, per-principal rate limits, secure headers, safe error responses, and audit events that avoid unnecessary personal data.
- [x] Initial GitHub Actions CI workflow for syntax checks and storage regression test.
- [ ] Add authenticated API/security tests, dependency auditing, backup/restore checks, and a staging deployment.
- [ ] Establish privacy notices, retention/deletion controls, access procedures, incident response, and applicable Kenyan data-protection obligations before processing personal data.

## Implemented on `production-hardening` (not yet independently validated)

- Modernized responsive CRM styling and added property inventory and human approval views.
- Added create/list/update-status property APIs, with verification notes and timestamps; the agent only recommends records marked available with a recorded verification note and timestamp.
- Added persisted approval records and explicit approve/reject decisions. Decisions are recorded only and do not trigger external actions.
- Added an initial workspace token field to the UI; token is held in session storage for the current tab.
- Hardened WhatsApp signature handling and passed the workspace token to internal agent calls.

## P1 — reliability and customer value

- [ ] Durable inbound/outbound message queue with retries, dead-letter handling, provider delivery status, and idempotent processing.
- [ ] Conversation timeline with source channel, timestamps, delivery status, human handoff, and clear AI-generated draft labels.
- [ ] Property verification workflow with owner/agent identity checks, listing freshness, duplicate detection, and change history.
- [ ] Observability: structured redacted logs, latency/error metrics, alerts, and readiness/liveness checks.
- [ ] Role-based access (agency owner, agent, reviewer), session expiry, and credential rotation.

## Distinctive product direction

Build an **Evidence-First Property Agent** rather than claiming that a feature is impossible to copy:

1. Every property answer cites the listing facts and last verification time used.
2. A "trust ledger" records listing changes, consent, approvals, and external booking confirmations with append-only event records.
3. A deal-readiness checklist identifies missing documents and unresolved questions without declaring legal ownership or authenticity on its own.
4. A client preference passport lets the client inspect, correct, export, and delete their saved preferences.
5. A local-first communication workflow supports WhatsApp, SMS/email integrations where configured, and human handoff with a complete timeline.

These are product hypotheses to validate with Kenyan estate agencies, not claims that no competitor offers similar functionality.

## Deployment rules

- Keep secrets in the hosting provider's secret manager/environment settings; never commit them.
- Set `NODE_ENV=production` and configure the Meta webhook app secret before enabling inbound WhatsApp processing.
- Do not use demo seed data or public unauthenticated API endpoints in a live workspace.
- Confirm database persistence and restore from a tested backup before go-live.
- Run regression and security tests against staging. A green scenario suite is necessary, not sufficient.
