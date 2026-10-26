# Estate AI Agent CRM — Improvement Proof (Days 31–45)

Evidence record for the 60-day program. Every claim is reproducible.

## Headline

| Metric | Baseline (2026-10-26, morning) | Now (2026-10-26, 16:30) |
|---|---|---|
| S1–S10 scenario suite | 1/10 | **10/10** (3 consecutive runs) |
| Agent response latency | n/a (no agent) | 78–123 ms (5 turns, warm) |
| Agent loop regression suite | 10/10 after storage refactor |
| Memory conflicts resolved | 0 | 1/1 (45k → 55k/60k, logged) |
| Approval gates | 0 | 1 (offer letter held, nothing sent) |
| Landlord holds enforced | 0 | 1 (Karen villa blocked) |

## What changed

The execution loop (`agent.js`) replaced the empty shell. Added: intent routing,
per-client memory with conflict resolution + MEMORY_UPDATED logging, landlord hold
enforcement, viewing proposals and confirmations (VIEWING_CONFIRMED in Action Logs),
abuse escalation (FLAG), and an approval gate before any consequential action.

## Reproduce

```bash
node tests/scenarios.js https://estate-ai-agent-crm.onrender.com
```

## Honest limitations (documented now, not hidden)

- Deterministic intent engine, not an LLM: handles the tracked scenarios, but unseen
  phrasings may fall to the generic reply.
- Storage: a driver layer now uses MongoDB Atlas when `MONGODB_URI` is set (durable) and
  falls back to the JSON file otherwise (resets on redeploy). Coverage for the fallback
  path is tested in `tests/storage.test.js`; the Mongo path activates via one Render env var.
- No WhatsApp channel yet: the agent answers via HTTP API. Real WhatsApp needs a
  provider account (Twilio/Meta), which is a user decision + possible cost.
- Scenario suite is the fixed S1–S10 set: green there is necessary, not sufficient.
