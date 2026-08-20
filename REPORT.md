# REPORT

The model discovers. The artifact is the contract. Replay is production.
Escalation is a control-plane event on a paused live session.

## 1. Architecture

Hands is a single Node CLI plus a **separate** target process. The target in
this slice is Heritage Core, a local frameset teller workstation with two
tenant skins. Hands never embeds the UI under test; it only talks to it
through a `SurfaceDriver`.

Discovery and replay share that driver and a `LiveSession` (one Chromium
context, one control owner: `automation` or `human`). They diverge at the
decision point: discovery calls an LLM; replay walks a Capability JSON and
does not.

I kept the process model small on purpose. A queue, a capability registry
service, and a multi-tenant control plane would demonstrate infra, not
judgment. The seams that matter are: (1) surface vs flow, (2) artifact vs
transcript, (3) automation vs human on the **same** session, (4) policy
checked on every navigate and act.

Trade-off: TypeScript + Zod + Playwright over a screenshot-coordinate CUA
SDK. Coordinates would “work” on anything, including desktop, but they make
replay brittle and unreviewable. Accessibility names and ranked locator
bundles are slower to implement and a better contract for a bank back office.

## 2. Artifact schema

`hands/v1` `Capability` is the agent-invocable unit. It is JSON, validated
on every load, versioned, and meant to be read by a person and by a calling
agent.

It records, at minimum:

- ordered steps with a risk class
- a **ranked locator bundle** per target (`ax_role_name` first, then label /
  text / structural path / css). Replay walks the list; first **unique**
  match wins; zero matches is a miss; many matches without `nth` is
  `ambiguous_target` — we do not guess
- typed parameters (including `pii`) and secret refs (never inlined
  passwords)
- typed outputs with extractors
- a named checkpoint as the success condition
- exception handlers with an explicit `then`: business outcome, recover,
  retry, escalate, or fail
- `status: draft | approved | deprecated` so irreversible unattended replay
  can be gated
- tenant binding: `canonical` vs `specialized` with optional per-step
  overrides

Locators are **captured from the live node at action time**, not invented by
the model after the fact. The LLM chooses *what* to click (role + name).
The driver returns the bundle that actually resolved. That is what makes
the artifact a recording rather than a hope.

A raw LLM transcript is still not a contract. Models repeat fills, record
`css: input` for `<input type=submit>` (no innerText), and bake a concrete
host:port into navigate. `polishCapability` is the compile pass that drops
consecutive duplicate fills, rewrites the entry URL to the parameter
template, strips `_top` frames, and upgrades weak submit locators to AX
names. The committed catalog inquiry is the **reviewed** polish of the live
gpt-4o run (`sourceRunId` on the artifact matches
`evidence/runs/discovery-llm-success`). Tests replay `polish(artifact.json)`
from that folder, not a separately invented flow.

`namePattern` is how one artifact spans First Federal (“Member Number”,
“Share Balance”) and Riverside (“Customer No.”, “Current Savings”). That is
canonicalization in the schema, not a second recording.

## 3. Determinism & error handling

Replay never asks the model what to do. Before and after each step it
observes the page and **classifies** host banners:

| Signature | Class | Default handler |
|---|---|---|
| Record not found | `not_found` | business outcome `MEMBER_NOT_FOUND` |
| Validation error | `validation_error` | `VALIDATION_ERROR` |
| Permission denied | `permission_denied` | `PERMISSION_DENIED` |
| Session expired | `session_expired` | **escalate** (human re-authenticates on this session) |
| System Notice / maintenance | `unexpected_dialog` | recover: dismiss OK, continue |

A recover that fires *before* a step retries the step (the dialog was in
the way). A recover that fires *after* a successful navigation does **not**
re-click the thing that already worked — that was a real footgun on Sign On
→ interstitial.

Waits are `domcontentloaded` plus a short settle, not `networkidle` forever.
Locator resolution is frame-aware (`header` / `main` on the frameset).

The result contract is a discriminated union: `success` with outputs,
`business_outcome` with a code, `escalated` with an intervention id, or
`failed` with step, expected, observed, and a screenshot. Business outcomes
and escalations also write a PNG — “no such member” is a legitimate result,
and the screenshot is how you debug a misclassification. Conflating it with
a crash is the mistake the brief warns about; the tests assert it is not.

`--assist` is a single, opt-in locator repair after a miss: one policy-checked
LLM call may propose a better role+name for **that step**, then replay
continues. It cannot add steps or leave the allowlist. Off by default.

UI drift is secondary here (enterprise UIs are stable) and is handled by
the ranked locator list, not by an open-ended model loop.

## 4. Heterogeneity & multi-tenant

**Surface.** `Observation` / `ActionIntent` / ranked `Locator` are the
language. The web driver fills them from Playwright’s accessibility tree
and frames. A desktop driver would fill the same types from OS AX / UIA.
`DesktopDriver` exists as that seam and throws `SurfaceNotImplemented` —
the flow compiler and replay engine do not import Playwright.

**Tenants.** Hundreds of institutions run ~20 vendor apps. The artifact
binds to `vendorApp` (Heritage Core 1.0.0) and a tenant mode. Canonical
capabilities store `namePattern` aliases from a small vendor glossary.
Specialized capabilities can point at `baseCapabilityId` and override
targets per step when a tenant truly diverged.

Detection of drift is replay evidence: locator_miss / ambiguous_target
rates per tenant, plus `metadata.confidence`. I did not build a control
plane for that; I did not paint the schema into a per-tenant rewrite.

The demonstration is concrete: one committed inquiry artifact replays on
`first-federal` and `riverside` with different visible labels. Open-product
uses the same glossary (`Open Auxiliary Share` | `Open Sub-Account`).

## 5. Escalation & handoff

Stuck is a classified state (discovery `status=stuck`, replay handler
`escalate`, or an unrecoverable locator miss you choose to escalate). An
`InterventionRequest` carries run id, step, reason, and a screenshot.

Control transfer is real: `LiveSession.control.owner` flips to `human`,
automation acts throw `NotInControlError`, and the **headed Chromium
window is the same session**. The operator page (`apps/operator`) is
deliberately bare: reason, observation digest (refreshed live), screenshot,
human action log, resume / complete / abort. `POST /inject` exists so CI
can play the human without a person. Playwright listeners (and a document
click binding) record what the human did while they owned the session.

The demo path is `hands hitl-demo`: replay member `00000`, classify session
expired, pause, serve the operator at `http://127.0.0.1:3450`, print the
URL. A person uses the live window (Return to Sign On, log in again) and
hits Resume. `--unattended` records `intervention.json` and aborts, which
is what CI needs.

Resume sets owner back to `automation`. Discovery can compile `human_step`
records; replay can continue at the next step. A full co-browse console
is out of scope; the control-plane seam is not.

## 6. Safety

Policy is YAML (`policies/heritage-core.yaml`), loaded and enforced in
code, not in the prompt.

- **Allowlist:** loopback hosts, tenant path prefixes, action types.
  Off-origin navigation is `policy_violation`.
- **Risk:** labels matching Post/Confirm/Submit are irreversible.
  Unattended irreversible replay requires `status=approved`. Discovery of
  those steps should be headed or explicitly allowed. Inquiry is safe;
  `open_auxiliary_share` marks Submit as irreversible and is approved so
  the permission-denied path can run unattended. A draft of that artifact
  would be blocked — the gate is the point.
- **Redaction:** password patterns and named fields are stripped from
  logs, events, and artifact text. Credentials are `secret_ref`. Member
  identifiers are typed `pii: identifier` so a later store can tokenize
  them; they are not treated as passwords.

Limits: the allowlist is origin/path/action, not a full data-classification
firewall. Screenshots can still contain on-screen PII — we keep them in
run evidence and do not put them in the artifact. A production system
would add screenshot redaction and a secret broker.

## 7. Cuts

Shipped thin-but-real: every core requirement, plus two stretches that
match the company’s problem — **agent-facing catalog** (`hands catalog` /
`hands invoke` / `GET /capabilities`) and **canonical cross-tenant
replay**. The inquiry capability is the stretch; open-product exists only
to make permission-denied and the irreversible gate observable, not as a
third product surface.

Left out, deliberately:

- A real desktop AX driver (seam only).
- WebRTC co-browse / cursor sharing (headed session + operator page).
- Queues, multi-tenant routing, artifact registries.
- Screenshot-coordinate clicking as the primary observe/act channel.
- Open-ended LLM recovery on replay (`--assist` is one locator repair).

Next: screenshot PII masks, and a desktop adapter behind the existing
driver interface.
