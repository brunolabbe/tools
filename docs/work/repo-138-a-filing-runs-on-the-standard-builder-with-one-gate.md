---
id: repo-138
tool: repo
title: A filing runs on the standard builder with one gate, not on Haiku with two
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-138 — A filing runs on the standard builder with one gate, not on Haiku with two

## Why

`orchestrate-tickets`' pairing table (`SKILL.md`, _Which model built it_) sends
"a filing whose reproduction is in hand" to `builder-mechanical` (Haiku 5.5) as
a maintenance dispatch, gated narrow by `ticket-reviewer-sonnet` after the pull
request opens. The row was priced on lg-24's filing at $0.10 (owner,
2026-10-14), against $0.63 and $1.17 for two filings on `builder-standard`.

The filings of the last eight batches did not run that way. Every one made
numerical claims — an option's cost, a measurement in the Why, a "only remedy"
sentence — and the first gate found at least one false, which opened a round
and a second gate. The Haiku filing is cheap; the two gates it needs are not.
The review of 2026-11-01 read it off the accounting tables and filed this.

## Reproduction

From `reference/history.md`'s entries, 2026-10-31 and 2026-11-01 (each figure
is that entry's accounting row):

| Filing                    | Filer       | Gate 1                                       | Round              | Gate 2          | Landing | Total |
| ------------------------- | ----------- | -------------------------------------------- | ------------------ | --------------- | ------- | ----- |
| lg-82 (tools-54 second)   | Haiku $1.43 | Sonnet xhigh $2.52, CONCERNS, 4 meds         | by the filer       | $2.39, PASS     | $0.51   | $6.85 |
| lg-83 (tools-54 third)    | Haiku $1.10 | $1.71, CONCERNS, 3 meds (false option costs) | by the filer       | $2.23, PASS     | $0.49   | $5.54 |
| repo-133 (tools-54 third) | Haiku $1.64 | $1.56, CONCERNS, 4 meds                      | by the filer       | $1.55, CONCERNS | $0.52   | $5.27 |
| lg-80 (tools-54)          | Haiku $0.54 | $1.10, CONCERNS, 1 med                       | fresh Sonnet $1.21 | $1.73, PASS     | $0.54   | $5.11 |
| repo-126 (tools-5e)       | Haiku $0.13 | $1.60, CONCERNS, 2 meds                      | Sonnet $1.01       | $2.33, CONCERNS | $0.50   | $5.58 |

Five of five filings in the period took two gates; the gates cost $3.3 to
$4.9 of each $5.1 to $6.9 total. The one-gate filings in the same period
(lg-81's one-line fix, pl-65's Build line) had no numerical claim to get wrong:
$1.54 and $1.14.

The `builder-standard` builds of the same period, for scale: repo-130 $2.13,
repo-133's build $1.25, repo-120 $1.25, lg-69 $2.71 — each with one gate and no
round.

## Decision — open

What the filing row should read.

- **(a) `builder-standard` (Sonnet 5.5, high), one narrow `ticket-reviewer-sonnet`
  gate after the pull request opens**, the same as the docs-only chore row.
  Expected cost about $1.50 to file plus $1.50 to gate, against $5 to $7 today;
  the bet is that a Sonnet filer gets its option costs right often enough that
  the second gate is not needed. Recommended. Risk: a filing that still fails
  gate 1 costs the same round it does today, on a dearer filer.
- **(b) Keep Haiku, drop gate 2 for filings.** A filing's round is applied by
  the filer and the ticket lands `needs-decision` with gate 1's section and
  the round's Log on the thread; the owner reads the corrected costs before
  answering. Saves one gate ($1.5 to $2.4) per filing; keeps the $0.10 filer
  for the trivial case. Risk: a round that introduces a new false cost reaches
  the owner ungated — repo-133's and repo-126's gate 2 each found one.
- **(c) Keep the row.** The two-gate pattern is the price of a correct
  `needs-decision` filing; $5 is cheap against a wrong answer.

The rule "a different model gates, not a cheaper one" (`SKILL.md`) holds under
(a) and (b).

## Build

1. Edit the filing row of the pairing table in
   `.claude/skills/orchestrate-tickets/SKILL.md` and the sentence under it that
   cites lg-24, naming this ticket and the five filings above as the
   measurement that moved it.
2. If (a): `reference/dispatching.md`, _A gate prompt carries_, needs no change;
   `roles/builder.md`'s "maintenance" paragraph loses "a filing whose
   reproduction is in hand" from its list.
3. If (b): `reference/records.md`, _When there is no ticket_, gains the
   one-gate filing shape.

## Done when

1. The pairing table's filing row reads as the answer says, and no other page
   still sends a filing to the old row (`grep -rn "filing whose reproduction"
   .claude/skills`).
2. The first three filings after the merge are logged in `reference/history.md`
   with their per-agent cost, so the next review can read the row against
   this ticket's table.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); figures copied from the
  entries, not re-run.
