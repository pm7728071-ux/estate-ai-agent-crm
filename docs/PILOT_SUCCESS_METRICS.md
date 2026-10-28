# Pilot scorecard and go/no-go rules

This scorecard exists to prove the product's worth with measured evidence. Fill it in with the customer; do not invent values.

## Customer and pilot
- Agency:
- Pilot owner:
- Start/end dates:
- Data mode: synthetic / explicitly consented
- Current workflow:
- Most expensive pain identified:
- Agreed success target:

## Baseline versus pilot

| Metric | Baseline period/value | Pilot period/value | Source | Pass? |
|---|---|---|---|---|
| Median first-response time | | | Timestamp sample | |
| Inquiries with a next step recorded | | | Inbox review | |
| Missed/forgotten follow-ups | | | Agency's own review | |
| Repeated questions due to lost context | | | Staff sample | |
| Unsupported availability claims | | | QA sample; target zero | |
| Correct human handoffs | | | Approval queue sample | |
| Staff minutes per inquiry | | | Timed sample | |
| Staff active on 3+ days/week | | | Usage review | |
| Would pay to continue? | | | Direct manager answer | |

## Weekly review

- What did the agent get wrong?
- What did it refuse to guess correctly?
- What still required manual work?
- Did the team use it without being reminded?
- Was any personal or confidential data entered unexpectedly?
- What is the single highest-value fix for next week?

## Safety gates

Stop the pilot and investigate if:
- A user can access another agency's records.
- Real customer data appears in an environment without an approved privacy/security setup.
- The system claims a property is verified without recorded evidence.
- A message, viewing, offer, payment, or legal commitment is described as completed when the external system has not confirmed it.
- A secret, access token, or sensitive personal data is exposed in logs or screenshots.

## Decision at the end

**Continue and charge** only if repeated usage, measured improvement, and a credible buyer commitment are all present.

**Change the product** if the same pain is confirmed but users do not complete the workflow.

**Change the target customer/problem** if interviews do not reveal frequent, costly pain or no decision-maker will pay.

Record the decision and evidence:
- Decision:
- Evidence:
- Customer quote (with permission):
- Next experiment:
- Owner/date:
