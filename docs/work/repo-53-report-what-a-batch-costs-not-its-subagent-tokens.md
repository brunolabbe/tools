---
id: repo-53
tool: repo
title: Report what a batch costs from the task output files, not from subagent_tokens
kind: work-package
status: done
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
- 2026-09-20 — Built `scripts/agent-cost.mjs` plus
  `scripts/test/agent-cost.test.ts` and its fixtures under
  `scripts/test/fixtures/agent-cost/`, on branch `repo-53-agent-cost` off
  `orchestrate-skill-sweep` (`f9d981f`). Sums the four `usage` fields over
  every assistant record per file (verified against a real task output file,
  `agent-ac9491c3ec452c459.jsonl`, whose 438 assistant records were all one
  model — the multi-model and no-assistant-record fixtures had to be built by
  hand since no real file on this machine exercises either), refuses a file
  with two model ids or an unrated model id (both tested, both exit loudly
  rather than pricing at zero), and refuses a file with no assistant records
  too — a guard the ticket did not ask for but that the same "don't zero-price
  a bad file" reasoning covers for free, so it is folded in here rather than
  filed separately. Rates for `claude-opus-5`, `claude-sonnet-5`,
  `claude-haiku-4-5-20251001` and `claude-fable-5-1` read 2026-09-20 from the
  `claude-api` skill's cached table plus `shared/prompt-caching.md`'s
  Economics section (cache write 1.25× input at the default 5-minute TTL,
  cache read 0.1× input except Fable 5.1's flat $0.25/MTok) — recorded as
  `RATES_READ_ON` in the script and printed beside every row's dollar figure,
  not split by cache TTL since the ticket's summed field doesn't distinguish
  them either.

  **Scope was narrowed by the dispatch, not by this ticket**: I was told not
  to touch anything under `.claude/`, so `SKILL.md`'s accounting table and
  `reference/history.md`'s `cost` field are _not_ changed here — that wiring
  is the orchestrator's to do after this branch merges. The text I would have
  written, for the orchestrator to use or adjust:

  - `SKILL.md`'s accounting table (`### End every batch with a per-agent
accounting table`): add a **Cost** column, priced by running
    `node scripts/agent-cost.mjs <task-output-file>` over each agent's own
    output file rather than converting `subagent_tokens`; keep the **Tokens**
    column and its three caveats exactly as they are, but add a line saying
    `subagent_tokens` is now kept only as the series the pre-repo-53 rows are
    already in, not as a cost proxy.
  - `reference/history.md`'s schema table: reword the `cost` row from "the
    conversion measured 2026-09-02 was $0.0182 per 1k subagent tokens" to
    something like _"actual dollars from `scripts/agent-cost.mjs` over the
    batch's task output files, with the date `agent-cost.mjs` printed beside
    its own total — not a `subagent_tokens` conversion, which `repo-53`
    retired because it excludes cache reads (94–97% of the bill)."_
  - The last "Done when" line — one real batch's table produced with the
    script, and the difference from the old `subagent_tokens` conversion
    recorded here — needs a real task output file from a live batch, which a
    narrowed-scope build dispatch does not have; that is the owner's to do
    once this merges and the `.claude/` wiring lands, not left silent.

  Gates run in this worktree: `npm run check` (exit 0 after fixing one
  `unicorn/no-array-sort` lint error and adding `agent-cost.mjs` to
  `scripts/test/tsconfig.json`'s `include`, both fixed here — the `tsconfig`
  omission is the kind next-id.mjs's own comment already warns about), `npx
vitest run scripts/test/agent-cost.test.ts` (19/19 passed),
  `npx vitest run --project repo` (365/365 passed), full `npm test` (exit 0;
  176 files, 3171 tests, all passed — run because `scripts/test/tsconfig.json`
  is shared config).
