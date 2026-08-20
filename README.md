# Hands

Hands turns a one-time LLM computer-use run into a **typed, reviewable
capability** that an agent can invoke later **without the model in the
decision loop**.

The model discovers. The artifact is the contract. Replay is production.
Escalation is a control-plane event on a paused live session.

This repository is a working vertical slice of that idea, aimed at the
environment in the brief: stable but exception-prone back-office UIs,
no clean DOM, and many institutions running the same vendor product.

## What it does

1. Accepts a goal + target (a Heritage Core tenant URL).
2. Runs an observe → decide → act loop against a real browser (Playwright,
   accessibility snapshot first).
3. Compiles the successful run into a versioned `hands/v1` Capability JSON,
   then **polishes** it (duplicate fills, templated entry URL, AX locators
   instead of `css: input`) so the recording itself is what replay executes.
4. Replays that artifact deterministically, with a result contract that
   distinguishes **success**, **business outcomes** (member not found,
   validation, permission denied), **recoverable** conditions (maintenance
   interstitial), and **escalation** (session expired → human on the same
   Chromium session).
5. On stuck or escalate, pauses that live session, opens a minimal operator
   page, records what the human did, and resumes. Failure and business
   outcomes capture a screenshot under the run's evidence directory.

## Requirements

- Node.js 20+
- Playwright Chromium (installed below)
- `OPENAI_API_KEY` **only** for `hands discover` against a live model
  (and optional `--assist`). Replay, tests, `--scripted` discovery, and
  HITL inject do not need a key.

## Setup

```bash
cp .env.example .env    # set OPENAI_API_KEY if you will run live discovery
npm install
npx playwright install chromium
```

Demo teller credentials for the local stand-in (not real): `teller` / `teller`.
They are resolved at runtime from `HANDS_TELLER_USER` / `HANDS_TELLER_PASSWORD`
and stored in artifacts as `secret_ref`, never as literals.

## Demo path

**Terminal 1 — target app**

```bash
npm run heritage
```

Heritage Core listens on `http://127.0.0.1:3401`:

- First Federal CU: `/t/first-federal/login`
- Riverside Community Bank: `/t/riverside/login` (same vendor app, different labels)

**Terminal 2 — discovery (LLM, or `--scripted` without a key)**

```bash
npx tsx src/cli.ts discover \
  --goal "Log in as the teller and look up member 12345. Read the current savings balance." \
  --tenant first-federal
```

Pass `--scripted` to drive the same loop with a fixture client (used in CI).
Pass `--headed` to watch Chromium. Pass `--hitl` to open the operator page
if the model gets stuck, on the **same** browser session.

The compiler writes a draft under `capabilities/*.discovered.json`. The
committed catalog file `capabilities/lookup_member_savings_balance.json` is
the **reviewed** form of the live gpt-4o run in
`evidence/runs/discovery-llm-success/` (`sourceRunId` matches). Tests replay
both the catalog file and `polish(artifact.json)` from that run.

**Replay — no model**

```bash
npx tsx src/cli.ts replay \
  --capability capabilities/lookup_member_savings_balance.json \
  --param tenant=first-federal --param memberId=12345
```

Expected business outcome (not a crash) — screenshot in the run evidence:

```bash
npx tsx src/cli.ts replay \
  --capability capabilities/lookup_member_savings_balance.json \
  --param tenant=first-federal --param memberId=99999
```

Session expired is an **escalation**, not a hard fail. `--hitl` starts the
operator against the paused live window:

```bash
npx tsx src/cli.ts hitl-demo
```

Same thing, unattended (boots operator, records `intervention.json`, aborts):

```bash
npx tsx src/cli.ts hitl-demo --unattended
```

Permission denied on an irreversible submit (approved capability required):

```bash
npx tsx src/cli.ts invoke open_auxiliary_share --tenant=first-federal --memberId=67890
```

Cross-tenant reuse of the **same** canonical inquiry artifact:

```bash
npx tsx src/cli.ts replay \
  --capability capabilities/lookup_member_savings_balance.json \
  --param tenant=riverside --param memberId=12345
```

Invoke by name (catalog):

```bash
npx tsx src/cli.ts catalog
npx tsx src/cli.ts invoke lookup_member_savings_balance --tenant=first-federal --memberId=12345
```

`--assist` is off by default: one policy-checked locator repair if replay
misses a control. It does not put the model back in the decision loop.

## Tests

```bash
npm test
```

Unit tests cover schema, policy, redaction, classification, and discovery
polish. Integration tests boot Heritage Core and Chromium: happy-path
replay, Riverside labels, not-found / validation / permission-denied
outcomes, session-expired escalation, the polished live-discovery artifact,
scripted discovery, bounded assist, and a live-session inject/resume
handoff. No model key required.

## Layout

```
apps/heritage-core/   local legacy-style core-banking stand-in (two tenants)
apps/operator/        operator page for live-session handoff
src/artifact/         Hands v1 schema, parameters, canonical names, polish
src/surface/          AX-first driver (web) + desktop seam
src/session/          long-lived browser, automation | human owner
src/policy/           allowlist, irreversible gate, redaction
src/replay/           deterministic executor + error taxonomy + optional assist
src/agent/            discovery loop, compiler, OpenAI + scripted clients
src/hitl/             intervention + operator HTTP
src/catalog/          filesystem catalog + agent-facing HTTP tools
src/evidence/         jsonl + screenshots
capabilities/         reviewed artifacts (inquiry + open-product)
evidence/             demo discovery + replay runs (including failure PNGs)
policies/             heritage-core.yaml
```

## Design write-up

See [REPORT.md](./REPORT.md).

## License

MIT
