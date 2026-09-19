---
id: pl-52
tool: planner
title: Give the run-cost report its own thinking-token column
kind: fix
status: ready
milestone: null
depends_on: [pl-40]
difficulty: standard
---

# pl-52 — Give the run-cost report its own thinking-token column

## Why

pl-49 gave `plan_runs` a column per token kind it prices — `input_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `output_tokens` — and
`cost-report.ts` reads them back into `p50`/`p95`/mean figures and dollars.
pl-50 added a fifth kind to the in-process `RunUsage`/`ModelUsage` seam,
`thinkingTokens`, but deliberately stopped at the seam: nothing persists it,
and `cost-report.ts` has never heard of it. This ticket is that fold-in,
filed rather than done inline because it reaches into the DB schema and the
report's own output shape — a decision pl-50's own Build section did not
raise and a migration is not "small" in the sense that note requires.

**What this column means is narrower than its siblings, and the ticket says
so up front so the report does not overclaim:** pl-50's owner decided
(`RunUsage.thinkingTokens`'s own doc comment, `agent/src/orchestrator.ts`)
that summing `thinkingTokens` across replies is **a lower bound over the
replies that reported a breakdown, never a guaranteed total for the run** —
`addReplyUsage` sums past a `null` reply the same way pl-49's own kinds do,
so a run that mixes a reply with no breakdown and one that reported some
reads identical to a run whose only reply thought that much. Whether that
gap matters in practice — how often a mixed-null run or a multi-attempt,
thinking-enabled reply actually occurs — is what pl-40's funded run
measures, hence `depends_on: [pl-40]`: this ticket can be built before that
run reports back, but the report's own wording about what the column proves
should reflect what that run found, not guess ahead of it.

## Build

1. **Migration**: `ALTER TABLE plan_runs ADD COLUMN thinking_tokens INTEGER;`
   in `api/src/db/schema.ts`, at the next free migration number
   (`MIGRATIONS.length` at build time — do not hardcode a number another
   ticket may have already taken), following migration 9's own comment
   pattern for why a new token kind is a new column rather than folding into
   an existing one.
2. **`updateRunUsage`** in `api/src/db/runs.ts` writes `record.usage.thinkingTokens`
   into the new column, alongside the five it already writes.
3. **`RunUsageRow`** in `api/src/cost-report.ts` gains `thinking_tokens: number
| null`, and `selectFinishedRuns`'s query selects it.
4. **The report prints a thinking-token line, priced never** —
   `thinkingTokens` is a subset of `outputTokens`, already billed at the
   output rate (`ModelUsage`'s own doc comment, `agent/src/provider.ts`), so
   it must **not** join `TOKEN_KINDS` (that array prices each of its entries
   at its own rate; doing that here would double-bill the tokens `output_tokens`
   already counted). Print it as a percentile/mean triple the way the other
   kinds are, labelled to say what it is: a share of output already priced
   above, not an addition to the bill.
5. **The report's own wording states the lower-bound caveat**, briefly, next
   to that line — something a reader of the report can act on without going
   to find `RunUsage`'s doc comment: this figure undercounts wherever a run
   mixed a reply with no breakdown and one with one, and (separately) wherever
   a reply itself fell back across several attempts. Word it from whatever
   pl-40's funded run found by the time this is built — if the run is still
   `in-flight` when this ticket is picked up, word it from the doc comment's
   own caveat instead and say so in the Log.
6. **`USAGE_SCHEMA_VERSION`** stays at 9 or bumps, whichever `migrations.test.ts`'s
   existing pattern for an additive column expects — read that test before
   deciding, do not guess.

## Done when

- The migration test (fresh DB and one at the previous migration) both reach
  the new column, reading back `NULL` for every pre-existing row.
- `updateRunUsage` writes `thinking_tokens`; a `run-usage.test.ts` case reads
  a run back with a non-null figure and one with `null` (a scripted run).
- `cost-report.test.ts` gets a case: a report over rows that mix a
  `thinking_tokens` figure with rows that have none prints the percentile
  triple, unpriced, and the caveat sentence — and a case where every run's
  `thinking_tokens` is `null` prints `—` the way an unmetered run already
  does for the other kinds, not a false zero.
- A mutation that joins `thinkingTokens` into `TOKEN_KINDS` (double-billing
  it) is caught by an existing or new dollar-total assertion.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-09-19 — filed

Filed by the orchestrator's direction, from the owner's multi-select of
follow-ups after pl-50's gate raised it as an open decision (whether the
operator's cost report should get a `thinking_tokens` column now or as its
own ticket). The owner ticked this one. Id reserved by the orchestrator
ahead of `node scripts/next-id.mjs pl`, which would otherwise be free to
allocate it to a concurrent session's ticket; not re-checked here per that
instruction. No code was written for this ticket — pl-50's branch documents
the decision it is built from but does not touch `api/src/db/schema.ts`,
`api/src/db/runs.ts` or `api/src/cost-report.ts`.
