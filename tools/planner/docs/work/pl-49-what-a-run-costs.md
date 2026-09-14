---
id: pl-49
tool: planner
title: Record what each run spent, token kind by token kind, and a report that prices it
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# pl-49 — What a run costs

**Packages:** `agent` (how usage is counted), `api` (the migration, the
recording, the price settings and the report).

## Why

**The owner's decision, 2026-09-14: record each run's cost now.** The question
behind it is whether a public planner could pay its own bill, with ads or
otherwise. That turns on what one run costs, and nothing measures it. The
planner stays behind Access for now (dl-49 says why), so today the reading is
for the owner's own bill.

- **pl-39's figure is an estimate, not a reading.** About $0.07 for a mean run
  and $2.30 in the worst case, from characters ÷ 4 over fixture briefs with no
  discovery block. A corridor run reads finds, and
  [pl-40](./pl-40-prove-p3-against-a-real-model.md) estimates up to ≈10.7k
  input tokens per finds-reading call.
- **The run already adds its tokens up, and the total is dropped.**
  `agent/src/orchestrator.ts:381` "function tally(" returns
  `{ calls, inputTokens, outputTokens }` as `FanOutResult.usage`.
  `api/src/runs/orchestrator.ts:327` "const result = await runFanOut({" is the
  only caller, and it reads `candidates` and `gaps`, never `usage`. No log line
  and no column carries it.
- **The input total cannot be priced as it stands.**
  `providers/anthropic.ts:333` "function usageOf(" adds
  `cache_read_input_tokens` and `cache_creation_input_tokens` into
  `inputTokens`. Anthropic bills a cache read at about 0.1× the input price and
  a cache write at about 1.25×, so a dollar figure from that sum is wrong in
  whichever direction the cache went.
- **A canceled run spent money too, and loses its count.**
  `agent/src/orchestrator.ts:180` "if (isCancellation(error, input.signal)) throw error;"
  rethrows before `tally` runs, so the replies that finished are not counted.

What ads could earn is outside this ticket. This measures the other side of
that comparison.

### Adopted rather than asked, and why

- **Columns on `plan_runs`, not a table of their own.** One run has one cost,
  and `plan_runs` already carries the run's lifecycle. Columns rather than JSON,
  because the report aggregates them.
- **Prices are settings, never a table in code.** They change, and they differ
  by model and by platform. With any price unset, the report prints tokens and
  says the dollars are unknown. It never guesses a rate.
- **The report applies today's prices to stored tokens, and says so.** Storing
  the rate beside each run would be exact across a price change, but it doubles
  the settings a run depends on for a case the owner has not met.
- **A reply served by a fallback model is counted apart.** `ModelReply` carries
  `servedModel`, and a refusal fallback bills at the fallback's rates. The
  report flags a window containing any as approximate rather than pricing it
  per model.
- **Numbers only.** No brief text, no place names, nothing a traveller wrote.

## Build

1. **Agent: keep the token kinds apart.** Widen `ModelUsage` in
   `agent/src/provider.ts` to `inputTokens`, `cacheReadTokens`,
   `cacheWriteTokens` and `outputTokens`, each `number | null`. `usageOf` stops
   summing the three input kinds, still summing each across `iterations`.
   `tally` sums each kind separately. Nothing in `@planner/contract` carried
   usage when this was filed. **Check again first**, and stop and raise it if
   something does, because a contract is not changed unilaterally. Check
   `agent/src/budget.ts` and anything else reading `inputTokens` so that it
   keeps meaning what it meant.
2. **Agent: a count that survives cancellation and failure.** Either report
   each reply's usage as it lands, through the `onProgress` the api already
   passes, or carry the running tally on the error that is rethrown. The
   builder picks. What is required is that the api can record the replies a
   canceled or failed run finished.
3. **Migration: columns on `plan_runs`.** `model`, `model_calls`,
   `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`,
   `fallback_calls`. All nullable: a queued run has spent nothing yet, and the
   `scripted` provider reports null counts.
4. **Record on every terminal state**: `done`, `failed` and `canceled`.
   Recording never fails a run. Wrap the write, log a `warn` and carry on.
5. **Settings.** `MODEL_PRICE_INPUT_PER_MTOK`, `MODEL_PRICE_OUTPUT_PER_MTOK`,
   `MODEL_PRICE_CACHE_READ_PER_MTOK` and `MODEL_PRICE_CACHE_WRITE_PER_MTOK`,
   unset by default. A value that is not a non-negative number refuses to boot,
   as the other model settings do. Add them to `.env.example` and the
   architecture's settings table.
6. **The report.** An entry point in `api/src` (for example `report.ts`) that
   opens the database **read-only**, so it cannot contend with the server's
   writer. It takes `--days N` and prints:
   - runs by terminal status
   - p50, p95 and mean of each token kind per run
   - dollars per run at the same points and in total, when all four prices are
     set, and otherwise a line naming the unset ones
   - whether any run in the window had a fallback call

   Check the path it runs from against the planner image's `WORKDIR` and
   command before documenting it under the planner's operating notes in
   `docs/02-DEPLOYMENT.md`.

## Done when

- A migration test takes a fresh database, and one at the previous migration,
  to the new one, and both have the columns.
- A test gives `usageOf` a message with input, cache-read and cache-write
  tokens and proves each is reported apart. With `iterations`, each kind is
  summed across the attempts.
- Tests prove a `done`, a `failed` and a `canceled` run each record usage. The
  canceled one counts the replies that finished before the cancellation.
- A test proves a failing usage write leaves the run's outcome unchanged.
- A report test against a seeded database prints the expected token
  percentiles. With every price set it prints the expected dollars. With any
  price unset it prints no dollar figure and names the missing setting.
- A test proves a non-numeric price refuses to boot.
- `npm run check` and `npm test -- --project planner` are green.
- The report runs inside the built image with `--days 1`. This is
  `unproven (gate)` until the container build runs.

## Log

- 2026-09-14 — Filed from the owner's question about tracking usage, and about
  whether ads could pay for hosting. The owner chose this ticket over waiting
  until the planner goes public. The Why was read on `origin/main` `804aecc`,
  and nothing was run.
