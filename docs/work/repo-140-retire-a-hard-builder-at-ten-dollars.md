---
id: repo-140
tool: repo
title: Retire a hard builder at about ten dollars, not fifteen
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-140 — Retire a hard builder at about ten dollars, not fifteen

## Why

`SKILL.md` step 6: a builder is resumed for one round and one owner stop, and
sooner retired for fresh agents when `agent-cost.mjs` shows it past about $15.
The figure came from pl-60 (resumed four times to $38.03) and pl-62 (retired at
$12.01, the ticket $34.24 against pl-60's $47.50).

The `hard` builders of the last eight batches reached $15 to $20 on their first
build, before any round, so the bar never fired early: it was read at the first
report, and the choice was already "fresh agent for every later step". A bar
at about $10 names the same choice before the first build is reported, which
is when the dispatch can still be split (a measurement step, then the build),
and it matches what the fresh agents that finished those tickets cost.

## Reproduction

`builder-hard` (Opus 5.5, high) rows from `reference/history.md`, 2026-10-25 to
2026-10-31, first dispatch of each ticket:

| Ticket   | First build                                         | Later agents on the ticket                                            | Ticket total |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| lg-66    | $19.30 (retired at the first report)                | fresh builder, rounds 1 and 2: $15.33; three gates $9.45; fixer $0.53 | $44.61       |
| lg-76    | $20.14 (one resume for an e2e seed)                 | two gates $5.28; fixers $2.36                                         | $27.73       |
| repo-131 | $15.86 (build + round 1 + an owner's lift; retired) | three gates $5.73; fixer $1.31                                        | $22.90       |
| lg-67    | $10.39                                              | one gate $3.28; fixer $1.00; maintenance $0.05                        | $14.72       |
| lg-71    | $9.42                                               | two gates $4.61; fixers $1.10                                         | $15.13       |
| lg-74    | $6.60                                               | one gate $3.06; fixer $0.54                                           | $10.20       |
| lg-78    | $6.39                                               | one gate $2.52; fixer $0.49                                           | $9.41        |
| lg-77    | $7.17                                               | one gate $2.77; fixer $0.46                                           | $10.40       |

Three of eight first builds passed $15; none of the five under $10.40 needed a
round. The fresh agents that finished the three expensive tickets cost $0.53 to
$15.33 each, and every one that was a fixer cost under $1.40.

## Decision — open

- **(a) Lower the bar to about $10**, read at the first report: a builder past
  it is not resumed for a round; the round goes to a fresh `builder-hard`
  handed the branch, its head and the Log, as the page already says for later
  steps. Recommended: it is the figure the page's own data now gives, and it
  changes nothing for the five tickets under it.
- **(b) Keep $15 and add a dispatch split**: a `hard` ticket whose Build has a
  measurement step is dispatched as two agents from the start, the
  measurement on `builder-standard`. Addresses lg-66's shape (a 50-minute
  first build) without touching the bar; does nothing for lg-76 and repo-131,
  whose first builds were the work.
- **(c) Both.**

## Build

1. `.claude/skills/orchestrate-tickets/SKILL.md` step 6, the resume paragraph:
   the figure, and this ticket's table in place of pl-60's sentence as the
   measurement.
2. If (b) or (c): `reference/dispatching.md`, _A builder prompt carries_, a
   bullet on splitting a `hard` dispatch at a measurement step.

## Done when

1. `grep -n '\$15' .claude/skills/orchestrate-tickets/SKILL.md` finds nothing
   under step 6, and the paragraph names the new figure with this ticket.
2. The next `hard` ticket's entry in `reference/history.md` names which bar
   its builder was read against.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); figures copied from the
  entries, not re-run.
