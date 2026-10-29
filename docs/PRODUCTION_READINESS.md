# Production readiness gate

This document is an operational checklist, not a claim of certification or completed production readiness.

## Current release status

**Not yet approved for real customer data.** This branch adds agency-token routing and tenant-scoped state, but it still requires CI/staging validation, per-user identities and roles, backups/restore drills, privacy/retention controls, and a security review before onboarding real agencies.

## P0 — required before real customers

- [x] Initial shared bearer-token gate for non-public API routes; production requires `ADMIN_API_TOKEN` (single-workspace only, not a complete identity system).
- [x] Initial tenant/agency scoping for API reads/writes: the authenticated bearer token maps to a server-side tenant ID; request-supplied tenant IDs are ignored.
- [ ] Replace shared per-agency bearer keys with individual user identities, session expiry, roles, revocation/rotation, and agency-member management before handling real tenant personal data.
- [x] Production refuses startup without MongoDB configuration or when MongoDB is unreachable rather than silently using JSON.
- [x] Initial tenant-scoped MongoDB documents (`tenant:<id>`) and tenant-specific JSON development files; legacy `db` state is migrated only to the default tenant.
- [ ] Replace whole-document writes with normalized tenant-scoped collections, concurrency-safe updates/transactions, indexes, and versioned migrations before multi-user production workloads.
- [ ] Calendar-backed viewing availability and booking. Hardcoded listing recommendations and fabricated viewing slots have been removed; the agent now defers to a human when it cannot verify availability.
- [ ] Enforce webhook signature validation in production and configure the Meta app secret. The current in-memory deduplication map is only a best-effort single-process safeguard; use durable idempotency keys for multiple instances/restarts.
- [ ] Add approval persistence and a real operator workflow. An approval response must not imply a message, booking, payment, or offer was sent unless the external system confirms it.
- [x] Add initial request payload limits, baseline security headers, a simple API rate limiter, and input validation on core property/approval routes; rate limiting is in-memory and not suitable for multi-instance production.
- [ ] Complete per-principal rate limits, consistent validation for every route, safe error responses, and audit events that avoid unnecessary personal data.
- [x] Initial GitHub Actions CI workflow for syntax checks, storage regression test, API token gate, explicit property verification, and approval-queue regression checks.
- [ ] Add authenticated API/security tests, dependency auditing, backup/restore checks, and a staging deployment.
- [ ] Establish privacy notices, retention/deletion controls, access procedures, incident response, and applicable Kenyan data-protection obligations before processing personal data.

## Implemented on `production-hardening` (not yet independently validated)

- Modernized responsive CRM styling and added property inventory and human approval views.
- Added create/list/update-status property APIs and an explicit verification action; changing a listing to available no longer automatically marks it verified. The agent only recommends records with a recorded verification note and timestamp.
- Added persisted approval records and explicit approve/reject decisions. Decisions are recorded only and do not trigger external actions.
- Added an initial workspace token field to the UI; token is held in session storage for the current tab.
- Hardened WhatsApp signature handling and passed the workspace token to internal agent calls.


## Multi-agency configuration (this branch)

- Set `ADMIN_API_TOKEN` to a unique random secret of at least 32 characters for the legacy/default workspace.
- Set `AGENCY_API_KEYS` to a JSON object mapping stable agency IDs to distinct random secrets, for example `{"agency-nairobi":"<unique-secret-of-at-least-32-characters>"}`. Keep this variable in Render's secret environment settings; never commit actual tokens.
- Every API request is assigned to the tenant whose configured token authenticated it. The API does not accept a tenant ID from request bodies or query strings as authority.
- MongoDB tenant records use separate IDs in the `tenant_state` collection. The legacy `db` record is copied only to the `default` tenant; newly configured agency tenants start with empty state.
- Provision keys out-of-band, provide each agency only its own key, and rotate/revoke keys promptly. This first version uses shared agency-level keys, not per-user identity or role-based access control.
- **Do not onboard real tenant personal data yet.** Wait until the tenant-isolation tests pass in CI, a staging deployment is verified, and per-user access, privacy/retention/deletion, audit, backups and recovery are reviewed.

## Rent ledger release notes

- Initial tenant register, monthly rent charge, partial payment, arrears summary, and audit-event endpoints are implemented on `feature/rent-ledger-arrears`.
- Payment records are append-only through the current API; duplicate transaction references and overpayments are rejected, and rent charge duplicates are rejected per tenant and period.
- The rent ledger has not yet been independently executed against staging or reviewed for concurrent financial writes. Do not treat this as accounting-grade or payment-provider-integrated functionality until transaction-safe persistence, reversal workflows, reconciliation, backups, and security review are completed.

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
