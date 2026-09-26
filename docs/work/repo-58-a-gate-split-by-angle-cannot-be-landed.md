---
id: repo-58
tool: repo
title: A gate split by angle cannot be landed by the record script, and nothing writes its verdict
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-58 — A gate split by angle cannot be landed by the record script, and nothing writes its verdict

## Why

The orchestration rework of 2026-09-26 added a trial to
`.claude/skills/orchestrate-tickets/reference/dispatching.md`: split a large
branch's gate into three gates on one model, each with an angle —
`acceptance`, `defects`, `invariants` — on the argument that a gate's cost grows
faster than its length, since every turn re-reads the transcript so far. The
sentinelle repository reviews every diff with parallel angles. A second-pass
review of that change (session code-09, 2026-09-26) found the split could not
be run end to end in this repo, and the section was shelved before it merged.
Four things block it, each read off the staged files:

1. **The record script refuses it.** `scripts/review-record.mjs` requires the
   first section's first line to be exactly `## Review`, and refuses a second
   `### Gate 1`. The gate role had each angle return `### Gate <n> — <angle>`,
   so three angles of one round cannot share a number, and the first one's
   heading loses its angle when it becomes `## Review`.
2. **Two angles cannot satisfy the section format.** `review-ticket`'s
   `gate.md` requires a `findings` line — the count of what the defect hunt
   returned, carried and dropped — and only the `defects` angle runs the hunt
   (steps 1, 2, 3 and 6).
3. **Nothing writes the ticket's verdict.** The angle table assigned `gate.md`
   step 7, the verdict, to no angle, and "the ticket's verdict is the worst of
   the angles'" had no writer: the lander commits every section verbatim and
   may not compose one.
4. **The cost argument counted turns only.** Each angle pays its own farm,
   build, page read and ticket read before its first turn of review, which the
   `n²/2` argument leaves out.

## Open question — do not settle it here

**Fix the split, or drop it.**

- **Fix:** `review-record.mjs` gains a first-splice form that accepts an angle
  heading and one gate number shared by a round's angles; `gate.md` assigns
  step 7 and the `findings` line per angle; the rule for the ticket's verdict
  gets a writer — a fourth, short dispatch that reads the angles' sections and
  returns the verdict line, or the orchestrator writing a verdict-only
  subsection under its own name. The size threshold (~500 changed lines
  outside `docs/`) stays a guess until measured.
- **Drop:** delete the shelved section, and rely on the existing rule — split a
  gate when its attack list needs two kinds of setup — which has one measured
  batch behind it (two gates at 114 k and 113 k, both finding things).

Recommendation: measure first. Take one large gated branch's transcript and
read, with `node scripts/agent-cost.mjs`, how its cost splits between the setup
turns and the review turns. If the review turns dominate, fix; if setup
dominates, drop.

## Build

Once the question is answered, per the answer above. Either way, the shelved
section in `dispatching.md` changes in the same pull request.

## Done when

- The question above is answered on this page, with how it was taken.
- Fix: a round split three ways lands with `scripts/review-record.mjs` in one
  commit per angle, the verdict is written by a named party, and a test in
  `scripts/test/review-record.test.ts` splices an angle heading as a first
  review. Drop: `dispatching.md` carries no angle split.

## Log

- 2026-09-26 — filed while shelving the section, from the second-pass review's
  reproduction above. Nothing built.
