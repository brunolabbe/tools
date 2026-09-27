---
id: repo-68
tool: repo
title: One gate for docs and records-only chore tickets
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-68 — one gate for docs and records-only chore tickets

## Why

**From the orchestrator's own measurement of the 2026-09-27 batch, not a
primary source this ticket can point at directly** — the owner asked for
this ticket after reading that batch's process review.

`repo-64` — a `chore` with no source change, only rule pages and ticket
records — took three Opus gates plus five builder rounds, at $60.18 total
(`$45.46`builder,`$14.72`gates, from`node scripts/agent-cost.mjs`) by the
orchestrator's own reading of that batch's accounting. `reference/sizing.md`
already says a self-generated docs ticket deserves at most one gate; this
batch's own step-12 ticket did not get that treatment, and paid for it in
rounds as much as in dollars.

## Build

- Add a row to `SKILL.md`'s _Which model built it_ pairing table for a
  docs/records-only chore — no source change, only rule pages, ticket files
  and history rows — naming its builder and gate model, matching
  `sizing.md`'s existing "at most one gate" guidance rather than the
  standard multi-round loop.
- Add the same row, with its reasoning, to `reference/sizing.md` beside the
  existing self-generated-docs-ticket guidance.
- The one gate this class gets is **post-PR and narrow**: it runs once the
  branch is pushed, and only re-opens for a second pass if that first gate
  finds something wrong — "a branch has shown it can be wrong" is the
  condition for a second gate, not a default second round.

## Done when

- `SKILL.md`'s pairing table and `sizing.md` both name the docs/records-only
  chore row, agree with each other, and cite this ticket's evidence for why
  it exists.
- The rule is stated as a default cap (one gate) with an explicit escalation
  path (a second, narrow gate, only once the first has found something),
  not an unconditional single-gate rule that would contradict `dispatching.md`'s
  _Do not cap the gate count_.

## Log

- 2026-09-27 — Filed on the owner's decision, from an `AskUserQuestion` after
  reading the orchestrator's process review of this batch. Not built here.
