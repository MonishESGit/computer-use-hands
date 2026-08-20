# Evidence

Committed runs for the Hands demo. No secrets, cookies, or password literals.
Failure and business-outcome runs include a PNG of the live session.

## discovery-llm-success

Live OpenAI (`gpt-4o`) observe → decide → act against Heritage Core
(First Federal), goal: look up member 12345 and read the savings balance.

- `events.jsonl` — decisions and acts (redacted)
- `artifact.json` — raw compiled draft from that run (duplicate fills, weak submit locators)
- `artifact.polished.json` — same flow after `polishCapability` (what replay executes)
- `run.json` — success metadata

The catalog file `capabilities/lookup_member_savings_balance.json` is the
reviewed, approved form of that polish (`sourceRunId` matches this run).

## replay-success

Deterministic replay of the approved inquiry capability, `tenant=first-federal`,
`memberId=12345`. Outputs: Alicia Nguyen, $4,250.18. No LLM.

## replay-discovered-artifact

Same happy path, but the capability is `polish(artifact.json)` from the live
discovery run — not a separately authored flow.

## replay-member-not-found

Same artifact, `memberId=99999`. Result is `business_outcome` /
`MEMBER_NOT_FOUND`, not a hard failure. Screenshot: host “Record not found”
banner.

## replay-session-expired

`memberId=00000`. Result is `escalated` with `intervention.json`. Screenshot:
session-expired interstitial. This is the `hands hitl-demo` path.

## replay-permission-denied

`open_auxiliary_share`, `memberId=67890`. Result is `business_outcome` /
`PERMISSION_DENIED`. Submit is irreversible; the artifact is approved so
unattended replay is allowed. Screenshot: host permission banner.
