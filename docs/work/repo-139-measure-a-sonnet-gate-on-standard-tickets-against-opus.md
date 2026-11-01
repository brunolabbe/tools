---
id: repo-139
tool: repo
title: Measure a Sonnet gate on standard tickets against the Opus gates in the log
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-139 — Measure a Sonnet gate on standard tickets against the Opus gates in the log

## Why

The pairing table gates a `standard` ticket (built by `builder-standard`,
Sonnet 5.5) with `ticket-reviewer-opus` (Opus 5.5, high), by the rule that a
different model gates. On the `standard` tickets of the last eight batches the
Opus gate was the largest line of the ticket — larger than the build it
checked — and the table has never been measured against the alternative the
rule also allows: `ticket-reviewer-sonnet` at xhigh, which gates `hard`
tickets today and is a different model from nothing a Sonnet builder wrote.

This is a measurement, not a change: one batch of `standard` tickets gated on
Sonnet xhigh, with its findings read against the Opus gates in the log. The
rule changes only if the numbers say so, in a ticket of its own.

## Reproduction

Opus gate 1 cost against the build it gated, `standard` tickets, from
`reference/history.md`'s 2026-10-31 and 2026-11-01 entries:

| Ticket                  | Build (Sonnet high) | Gate 1 (Opus high) | Gate verdict    |
| ----------------------- | ------------------- | ------------------ | --------------- |
| repo-130                | $2.13               | $3.67              | PASS, 6 lows    |
| repo-133 (build)        | $1.25               | $2.65              | PASS, 5 lows    |
| repo-120                | $1.25               | $3.62              | PASS, 4 lows    |
| lg-69                   | $2.71               | $4.14              | PASS, 4 lows    |
| lg-80 (tools-54 second) | $1.22               | $3.11              | CONCERNS, 1 med |
| lg-75                   | $2.29               | $2.68              | PASS, 4 lows    |
| lg-72                   | $5.05               | $3.92              | FAIL, 1 high    |
| repo-121 (tools-5e)     | $1.23               | $3.21              | PASS, 5 lows    |
| repo-124                | $2.00               | $2.26              | FAIL, 1 high    |
| repo-128 (tools-97)     | $2.75               | $4.26              | PASS, 2 lows    |

Ten gates, $33.52, two highs. Sonnet xhigh gates on `hard` tickets in the same
period cost $2.04 to $4.41 (repo-131 $2.04 and $2.08, lg-78 $2.52, lg-77 $2.77,
lg-67 $3.28, lg-71 $3.27, lg-66 $4.41) and found highs on lg-66 (gate 2) and
repo-131 (gate 1). The two populations are not comparable as they stand —
different tickets, different builders — which is why this is a ticket.

## Build

1. Pick the next batch of three or more `standard` tickets the owner selects
   (`SKILL.md` step 2), and in the dispatch use `ticket-reviewer-sonnet` at its
   pinned xhigh for gate 1 of each, depth `medium` as the Opus row gets. Say in
   each gate dispatch that it is this ticket's measurement. Nothing else about
   the batch changes: rounds, gate 2 and landings follow the table.
2. For each ticket record: gate 1's cost from `node scripts/agent-cost.mjs
   --agent <id>`, its verdict, its counts by severity, and the number of
   findings the orchestrator or the builder refuted.
3. Read the ten Opus rows above the same way from their gates' full reports on
   the pull request threads (verdict, counts by severity, refuted).
4. Write both tables into this ticket's Log and in `reference/history.md`'s
   entry for the batch, and state the comparison: cost per gate, findings per
   gate, highs, refuted findings. A conclusion the numbers do not support is a
   `high` on a measurement ticket (`gate.md`), so state what the numbers show
   and no more; three tickets is enough to see cost, not enough to see the
   rate of a `high`, and the Log says so.
5. If the Sonnet gates found fewer or no more refuted findings at a lower
   cost, file a `needs-decision` ticket to change the `standard` row; if not,
   close this one with the numbers.

## Done when

1. At least three `standard` tickets have a gate 1 on `ticket-reviewer-sonnet`
   recorded in their `## Review` with the model named in the header line.
2. This ticket's Log holds both tables (Build 2 and 3) with every cost read
   from `agent-cost.mjs` and every count from a gate's own section.
3. The batch's `reference/history.md` entry names this ticket and carries the
   same rows.
4. Either a follow-up `needs-decision` ticket exists naming the row change
   with these numbers as its reproduction, or the Log closes the question.

## Log

- 2026-11-01 — Filed from the 2026-11-01 review's reading of the eight
  batches' accounting tables (session tools-5d); the table above is copied
  from the entries, not re-run.
