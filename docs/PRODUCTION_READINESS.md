# Production readiness gate

This document is an operational checklist, not a claim of certification or completed production readiness.

## Current release status

**Not ready for real customer data or unsupervised property commitments.** The existing app is an evaluation prototype. Complete every P0 item below and validate it in a staging environment before onboarding customers.

## P0 — required before real customers

- [ ] Authentication for every non-public API route, including inboxes, memories, logs, agent actions, and administrative operations.
- [ ] Tenant/agency scoping on every read and write; derive tenant identity from the authenticated principal, never from request input.
- [ ] Replace the single global state document and JSON fallback with durable, tenant-scoped records, indexes, and controlled schema migrations. In production, fail startup if required durable storage is unavailable; do not silently downgrade to ephemeral storage.
- [ ] Replace hardcoded sample property inventory and viewing slots with verified inventory and calendar-backed availability. If availability cannot be verified, say so and offer a human follow-up.
- [ ] Enforce webhook signature validation in production and configure the Meta app secret. The current in-memory deduplication map is only a best-effort single-process safeguard; use durable idempotency keys for multiple instances/restarts.
- [ ] Add approval persistence and a real operator workflow. An approval response must not imply a message, booking, payment, or offer was sent unless the external system confirms it.
- [ ] Add request validation, payload limits, per-principal rate limits, secure headers, safe error responses, and audit events that avoid unnecessary personal data.
- [ ] Add automated API/security tests, CI, dependency auditing, backup/restore checks, and a staging deployment.
- [ ] Establish privacy notices, retention/deletion controls, access procedures, incident response, and applicable Kenyan data-protection obligations before processing personal data.

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
