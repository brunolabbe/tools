---
id: repo-53
tool: repo
title: Report what a batch costs from the task output files, not from subagent_tokens
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-53 — Report what a batch costs from the task output files, not from `subagent_tokens`

## Why

Every `cost` row on the orchestration history page converts `subagent_tokens`
at a rate measured once, on 2026-09-02. That figure excludes cache reads, and
cache reads are 94 to 97% of the bill: the tenth session's own measurement was
152,659 subagent tokens against 3.9 M and 5.8 M tokens all-in for a builder and
its reviewer. The `standard` trial in `repo-28` reported an "8% saving" from
the subagent figure that was wrong by an order of magnitude once cache reads
were counted, and its pairing decision was taken on the corrected number.

So the accounting table `SKILL.md` requires at the end of every batch, and the
`cost` field the history schema requires, both report a number that is not the
cost. Every efficiency decision this loop has made — which model builds, how
many gate rounds, whether to resume or re-dispatch — was argued from it.

The real figures exist. A backgrounded `Agent` dispatch hands the orchestrator
a task output file, and `dispatching.md` records that it carries
`cache_read_input_tokens`, `input_tokens` and `output_tokens` per request, plus
`/message/model`; the tenth session read one to confirm a reviewer's model. No
script reads them.

## Build

Add `scripts/agent-cost.mjs <output-file>...` that, for each file:

- sums `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
  and `output_tokens` over every assistant record;
- reads the model from `/message/model` and refuses a file where more than one
  value appears, naming both;
- prices the sums with a rate table keyed by model id, kept in the script with
  the date each rate was read, and prints the date beside the total;
- prints one row per file — model, four token sums, dollars — and a total row.

Then change the accounting table in `SKILL.md`'s _Reporting to the user_ and
the history schema's `cost` field to take their figures from this script, and
say that `subagent_tokens` is kept only as the series the earlier rows are in.

## Done when

- The script over a fixture of two short output files, one Sonnet and one
  Opus, prints the expected sums and dollars, and a test asserts them against
  hand-computed values.
- A file with two model ids is refused with both named, tested.
- A rate that is missing for a model id fails loudly rather than pricing at
  zero, tested.
- The accounting table and the history schema name the script as the source
  of `cost`.
- One real batch's table is produced with it and the difference from the
  subagent-token conversion is recorded in this Log.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  which found no cost decision in twenty-three sessions taken on the bill.
