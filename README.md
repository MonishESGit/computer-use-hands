# Hands

Hands turns a one-time LLM computer-use run into a **typed, reviewable
capability** that an agent can invoke later **without the model in the
decision loop**.

This is a working vertical slice: discovery against a live UI, a versioned
artifact, deterministic replay with an explicit error taxonomy, safety
guardrails, and human takeover of the same live session.

## Status

Scaffold only on `main`. Setup, demo commands, and the design write-up land
as the runtime is built. See `REPORT.md` once it exists.

## Requirements

- Node.js 20+
- An OpenAI API key for **discovery** only (replay does not call the model)

## Quick start (as modules land)

```bash
cp .env.example .env   # then set OPENAI_API_KEY
npm install
```

Replay and the local stand-in app will not need a model key.

## Layout

```
apps/heritage-core/   local legacy-style core-banking stand-in (two tenants)
apps/operator/        minimal operator surface for live-session handoff
src/                  runtime: surface, artifact, replay, agent, policy, HITL
capabilities/         saved capability artifacts
evidence/             discovery + replay runs (logs, screenshots, artifacts)
policies/             allowlists and redaction rules
```

## License

MIT
