---
id: repo-70
tool: repo
title: The orchestrator dry-runs a record mechanic before prescribing it
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-70 — the orchestrator dry-runs a record mechanic before prescribing it

## Why

**From the orchestrator's own measurement of the 2026-09-27 batch, not a
primary source this ticket can point at directly** — the owner asked for
this ticket after reading that batch's process review.

Three of the orchestrator's own dispatch instructions this batch were
impossible or wrong as written, and each cost a builder a stop or a round
to discover:

- Ordering a byte-for-byte splice before coordinate re-resolution, when
  `review-record.mjs --verify` refuses a section it finds `MOVED` — the
  order was impossible on its face.
- Instructing "declare as evidence" for a citation whose text had only
  moved (into the builder's own correction, quoting it), not been deleted
  outright — the tool itself calls a declaration wrong for a citation a
  tree still verifies, and named repoint as what it needed instead.
- Instructing to merge `main` into a branch "only on a conflict," when what
  the citations gate actually needed was `main`'s own `GRANDFATHERED` list,
  reachable independently of whether a merge would conflict.

## Build

Add a step to `SKILL.md` (near steps 6 and 9, where records are routed and
landed) that has the orchestrator dry-run a record mechanic on a scratch
copy before writing it into a dispatch or a direct message:

- A prescribed splice order: run `review-record.mjs` (or `--verify`) against
  a scratch copy in the order the dispatch is about to name, and confirm it
  does not refuse.
- A prescribed repoint or declaration: run the relevant `git log -S` check
  (per `records.md`'s pin-or-declare test) and confirm the remedy matches
  what the citation actually needs before naming it.
- A prescribed merge: confirm what the merge is actually for (a conflict, a
  ratchet list, a citation the base doesn't have yet) before naming the
  condition that triggers it.

## Done when

- `SKILL.md` names this dry-run step explicitly, at both step 6 (routing)
  and step 9 (landing), with the three failure shapes above as the worked
  examples.
- A later batch's history row can point at a prescribed mechanic that was
  dry-run and held, as the measurement that the step is doing something.

## Log

- 2026-09-27 — Filed on the owner's decision, from an `AskUserQuestion` after
  reading the orchestrator's process review of this batch. Not built here.
