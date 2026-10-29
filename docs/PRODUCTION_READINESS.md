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
- [x] Add a transaction-backed rent-ledger repository with normalized MongoDB collections, agency-scoped unique indexes, conditional balance updates, majority write concern, and a validated one-time legacy ledger migration. This is code-level hardening, not a go-live approval.
- [ ] Verify transaction support on the configured MongoDB replica set in staging; exercise duplicate-charge races, duplicate payment references, concurrent overpayment races, rollback, and migration failure recovery with integration tests.
- [ ] Calendar-backed viewing availability and booking. Hardcoded listing recommendations and fabricated viewing slots have been removed; the agent now defers to a human when it cannot verify availability.
- [ ] Enforce webhook signature validation in production and configure the Meta app secret. The current in-memory deduplication map is only a best-effort single-process safeguard; use durable idempotency keys for multiple instances/restarts.
- [ ] Add approval persistence and a real operator workflow. An approval response must not imply a message, booking, payment, or offer was sent unless the external system confirms it.
- [x] Add initial request payload limits, baseline security headers, a simple API rate limiter, and input validation on core property/approval routes; rate limiting is in-memory and not suitable for multi-instance production.
- [ ] Complete per-principal rate limits, consistent validation for every route, safe error responses, and audit events that avoid unnecessary personal data.
- [x] Initial GitHub Actions CI workflow for syntax checks, storage regression test, API token gate, explicit property verification, and approval-queue regression checks.
- [ ] Add authenticated API/security tests, dependency auditing, backup/restore checks, and a staging deployment.
- [ ] Configure a registered Aegis agent key in Render, enable `AEGIS_ENFORCE_ACTIONS=true`, and verify the connected action gate in staging before relying on it for consequential actions.
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

## Aegis action guard integration

- The CRM includes an opt-in `aegis-guard.js` client. When enabled, it calls the Aegis `POST /api/guard/action` endpoint for consequential external commitments; network failures, missing credentials, malformed responses, and denials block the action. The current CRM still places commitments in a human approval queue and does not send messages, sign leases, book viewings, or move money automatically.
- Configure Render secrets only after the Aegis action-guard endpoint is merged and deployed: `AEGIS_GATEWAY_URL=https://aegis-agent-4u79.onrender.com`, `AEGIS_AGENT_API_KEY=<registered Aegis agent key>`, and `AEGIS_ENFORCE_ACTIONS=true`. Never commit or paste the key into source files. Register the integration as its own Aegis agent and rotate/revoke its key if exposed.
- The gate's `PENDING_APPROVAL` decision is a policy verdict, not an approval token for execution. Any future approval execution endpoint must re-check the policy and independently enforce authorization immediately before the external side effect.
- Until the Aegis endpoint is merged/deployed and its credential is configured, the CRM integration is present in code but **not active**; the CRM's existing local approval gate remains the only control.

## Rent ledger release notes

- A new production path stores rent tenants, charges, payments, and audit events in separate MongoDB collections. Unique indexes enforce one charge per agency/tenant/month and one normalized payment reference per agency. Payment and charge/audit writes use MongoDB transactions; charge `paidCents` is conditionally updated to serialize concurrent payments.
- Startup performs a one-time legacy migration per agency. Invalid legacy rows, duplicate charge periods/references, payments without charges, or overpaid charges intentionally block startup rather than silently importing inconsistent balances. Back up the database before first deployment and verify migration logs.
- The transactional path requires a MongoDB replica set or sharded cluster that supports transactions. A standalone MongoDB server is not sufficient. The local/test JSON fallback is not a production financial store.
- **Still not approved for real financial operations:** no M-Pesa/bank provider reconciliation, idempotency-key protocol for safe client retries, reversal/credit-note workflow, immutable external export, tested backup restoration, or independent security/accounting review has been completed. Do not claim payments are received unless independently verified against the provider/bank.

- Initial tenant register, monthly rent charge, partial payment, arrears summary, and audit-event endpoints are implemented on `feature/rent-ledger-arrears`.
- Payment records are append-only through the current API; duplicate transaction references and overpayments are rejected, and rent charge duplicates are rejected per tenant and period.
- Input validation now rejects amounts with more than two decimal places, impossible calendar dates, unknown payment methods, and transaction references outside 3–100 characters; these checks reduce accidental data corruption but do not replace database-level financial constraints.
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
