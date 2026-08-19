# Evidence

Committed runs for the Hands demo. No secrets, cookies, or password literals.

## discovery-llm-success

Live OpenAI (`gpt-4o`) observe → decide → act against Heritage Core
(First Federal), goal: look up member 12345 and read the savings balance.

- `events.jsonl` — decisions and acts (redacted)
- `artifact.json` — compiled draft capability from that run
- `run.json` — success metadata

Replay in production uses the **reviewed, approved** artifact in
`capabilities/lookup_member_savings_balance.json` (canonical locators,
namePatterns). The discovery artifact is the proof the loop happened.

## replay-success

Deterministic replay of the approved capability, `tenant=first-federal`,
`memberId=12345`. Outputs: Alicia Nguyen, $4,250.18. No LLM.

## replay-member-not-found

Same artifact, `memberId=99999`. Result is `business_outcome` /
`MEMBER_NOT_FOUND`, not a hard failure.
