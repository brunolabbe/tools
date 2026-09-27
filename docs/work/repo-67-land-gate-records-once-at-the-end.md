---
id: repo-67
tool: repo
title: Land gate records once, at the end, not every round
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-67 — land gate records once, at the end, not every round

## Why

**From the orchestrator's own measurement of the 2026-09-27 batch, not a
primary source this ticket can point at directly** — the owner asked for
this ticket after reading that batch's process review.

Every round in that batch committed its gate's section into the ticket as
soon as it landed, and the next fix round routinely moved or corrected the
very lines those sections cited. The cost was real: reviewer re-resolutions
and coordinate repoints on `pl-48`, `repo-60` and `repo-64`; `dl-53`'s three
separate landing stops; and, on `repo-64` alone, the same shape — a citation
repointed onto the very correction it should have been sent back for —
recurring three times as "finding D" across three gate rounds, each caught
only after the fact. `citations-gate.mjs` refuses these correctly every
time; the cost is landing mid-flight in the first place, not the checker.

## Build

Change the lander's default from "commit each gate's section as it lands"
to "hold every round's section in the PR thread and the scratch directory;
only the final gate re-issues every prior section, re-resolved against the
tip it is reviewing, and the lander commits all of them once, at the end."

- `records.md`: the multi-round paragraph and its remedies for a moved or
  corrected citation change shape — there is no "earlier round's committed
  coordinates" to repoint or send back if nothing was committed until the
  end.
- `dispatching.md`: the routing-findings section, and the re-gate section's
  instructions about returning corrected copies of earlier rounds.
- `roles/reviewer.md`: what a re-gate returns, and what the final gate must
  re-issue.
- `roles/builder.md` and `roles/fixer.md`: the Landing sections, which
  currently assume a mix of already-committed and newly-committed records.
- `scripts/review-record.mjs`: possibly, if the splice-order assumptions
  (per-round `--gate <n>` appends) no longer fit landing every section at
  once.

**Open question this Build must settle or raise, rather than assume:** how
`scripts/test/status.test.ts`'s `reviewedButReady` check and preflight's
`## Review` presence check apply to a ticket with no record at all until the
single landing commit. Both currently reason about a ticket that has been
"picked up" (carries a record) but is not yet `done`; if no record exists
until the end, that intermediate signal disappears. Settle it if the answer
is clear from re-reading those checks' own rules; raise it as an open
decision if it is not.

## Done when

- The role pages and `records.md` describe committing gate records once, at
  the landing commit, not per round.
- The `reviewedButReady`/`## Review`-presence question above is either
  settled in this ticket's Build with its reasoning, or raised as an
  explicit open decision.
- `npm run check` and the `repo` project's suite pass, including any test
  changes `review-record.mjs`'s own behaviour needs.

## Log

- 2026-09-27 — Filed on the owner's decision, from an `AskUserQuestion` after
  reading the orchestrator's process review of this batch. Not built here.
