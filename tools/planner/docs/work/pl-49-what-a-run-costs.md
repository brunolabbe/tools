---
id: pl-49
tool: planner
title: Record what each run spent, token kind by token kind, and a report that prices it
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-09-14 · `origin/main...a4bd8a6` · defect hunt run directly (no `code-review` subagent — the reviewing agent has no `Skill` tool), medium depth. `a4bd8a6` is a pre-squash branch sha, kept because it is the tree these citations were reviewed against; the later commits `25db042` and `1b2fce5` change ticket text only and were checked as edits at `1b2fce5`.

| Done when                                                                                                        | Proof                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration test: fresh DB and one at the previous migration both reach the new one with the columns               | `migrations.test.ts:156 "carry a column for each token kind"` and `migrations.test.ts:165 "reads as unrecorded"` ✓                                                                                                                                            |
| `usageOf` reports input, cache-read and cache-write apart, summed across `iterations`                            | `anthropic-provider.test.ts:259 "inputTokens: 700"` (apart) and `anthropic-provider.test.ts:295 "cacheReadTokens: 300"` (summed across iterations) ✓                                                                                                          |
| A `done`, a `failed` and a `canceled` run each record usage; the canceled one counts replies that finished first | `run-usage.test.ts:140 "records every reply, each token kind"`, `run-usage.test.ts:158 "records the replies it was billed for before it failed"`, `run-usage.test.ts:180 "records the replies that finished before the cancellation"` ✓                       |
| A failing usage write leaves the run's outcome unchanged                                                         | `run-usage.test.ts:212 "leaves the run's outcome as it was, and says so"` ✓                                                                                                                                                                                   |
| Report prints token percentiles; with every price set prints dollars; with any unset names the missing setting   | `cost-report.test.ts:188 "prints p50, p95 and the mean of each token kind"`, `cost-report.test.ts:199 "prints dollars per run and in total, and says whose prices they are"`, `cost-report.test.ts:226 "prints no dollar figure and names what is missing"` ✓ |
| A non-numeric price refuses to boot                                                                              | `config-prices.test.ts:70 "a price that is not a number refuses the server's boot"` ✓                                                                                                                                                                         |
| `npm run check` and `npm test -- --project planner` are green                                                    | **verified** — reproduced independently: `check` exit 0, suite 59 files/967 tests at the tip, 55 files/931 tests at `95c6403` before any edit                                                                                                                 |
| The report runs inside the built image with `--days 1`                                                           | **unproven (gate)** — no image built; `Dockerfile`'s `WORKDIR /app` and `CMD ["node", "tools/planner/api/dist/main.js"]` are consistent with the deployment doc's path, checked by reading only                                                               |

- **low, closed** · Found against `a4bd8a6`: the unbuilt tickets for a re-plan run and for editing dates and budget each still named migration 9 as their own next number, which this ticket had already taken. Closed in a later commit on this branch that moves both off 9 onto 10 (noting pl-49 took 9 and the real number is whatever is next free at build time); verified by re-reading both tickets and by `node scripts/citations.mjs` on each (exit 0, 0 references, before and after).
- **findings** · hunt run directly at medium depth; 1 found, 1 carried (closed before commit), 0 dropped.
- NFR: security n/a (no URL or header handling touched) · performance n/a · reliability ✓ (`recordUsage` wraps the write, warns, never fails the run — `run-usage.test.ts:212 "leaves the run's outcome as it was, and says so"`) · maintainability — the low finding above, closed.

## Log

- 2026-09-14 — Filed from the owner's question about tracking usage, and about
  whether ads could pay for hosting. The owner chose this ticket over waiting
  until the planner goes public. The Why was read on `origin/main` `804aecc`,
  and nothing was run.
- 2026-09-14 — Built on `origin/main` `95c6403`. The Why's four premises all
  held against the code. What the brief had wrong or left out:
  - **A failed specialist's replies were dropped too, not only a canceled
    run's.** `runFanOut` returned `replies: []` for any specialist that threw,
    so a refused reply or two malformed attempts were billed and never counted.
    Measured by running the new `agent/test/fan-out-usage.test.ts` against the
    `95c6403` orchestrator (`npx vitest run --project planner
tools/planner/agent/test/fan-out-usage.test.ts`, exit 1, 5 failed of 5): a
    fan-out with one refused reply counted `calls: 5, inputTokens: 500` where 6
    replies and 501 tokens were billed. The fix counts every reply at the seam,
    by wrapping `send` inside `runFanOut`, so this and cancellation are one
    mechanism.
  - **Step 2's first option needs a contract change.** `onProgress` carries
    `@planner/contract`'s `RunProgress`, which is forwarded to the browser, so a
    usage frame on it would widen the contract. Step 2 left the choice to the
    builder, so the running total goes through `FanOutInput.onUsage`, a
    callback beside `onProgress`. Nothing in `@planner/contract` carries usage
    before or after: checked with `grep -rni "usage\|token" contract/src`, no
    match.
  - **`inputTokens` changes meaning, and nothing depended on the old one.** It
    is now uncached input only, the Messages API's own `input_tokens`. Its only
    reader was `tally`; `budget.ts` and `runBudgetFor` count output tokens only
    and read no usage.
  - **A `failed` run with spend happens only after the fan-out.** `runFanOut`
    throws nothing but cancellation once a call has gone out, so the failed-run
    test fails the revision write with a trigger, after every specialist
    answered.
  - **`api/test/schema.test.ts` also pins the schema version**, not only
    `migrations.test.ts`. Both now expect 9.
  - **A price that is not a price refuses with `INTERNAL`, not
    `AGENT_UNCONFIGURED`.** That code's message is "No planning assistant is
    configured", which a price does not configure. `requiredEndpoint` in
    `server.ts` already uses `INTERNAL` for a deployment misconfiguration.
  - **Fallback detection is the provider's own rule.** A reply counts as a
    fallback when `servedModel` differs from the configured model: the
    comparison `AnthropicProvider` already logs, so the column and the log line
    cannot disagree.

  **Every new or changed spec was run unmutated, then red.** Each command is
  `npx vitest run --project planner <spec>`. Every one exited 0 unmutated,
  every red run exited 1, and each file was restored from `HEAD` afterwards.

  | Spec                         | Unmutated | Red run                                      | Failed                         |
  | ---------------------------- | --------- | -------------------------------------------- | ------------------------------ |
  | `run-usage.test.ts`          | 5 passed  | api orchestrator from `95c6403`              | 4 of 5                         |
  |                              |           | no `recordUsage` on cancel                   | 1 of 5, canceled               |
  |                              |           | no `recordUsage` on failure                  | 1 of 5, failed                 |
  |                              |           | `throw` inserted before the warn             | 1 of 5, failing write          |
  |                              |           | no `recordUsage` on done                     | 2 of 5, done and failing write |
  | `anthropic-provider.test.ts` | 32 passed | `anthropic.ts` from `95c6403`                | 5 of 32                        |
  |                              |           | cache kinds summed back into input           | 2 of 32                        |
  | `fan-out-usage.test.ts`      | 5 passed  | orchestrator from `95c6403`                  | 5 of 5                         |
  |                              |           | `askSpecialist` given the unwrapped provider | 5 of 5                         |
  | `cost-report.test.ts`        | 13 passed | percentile without its sort                  | 3 of 13                        |
  | `config-prices.test.ts`      | 9 passed  | the price check disabled                     | 6 of 9                         |
  | `migrations.test.ts`         | 9 passed  | `cache_read_tokens` dropped from migration 9 | 4 of 9                         |

  **The cost report's first fixture could not fail, and the red run caught
  it.** With the percentile's sort removed, only the pure `percentile` test
  failed (1 of 13). The seed was inserted out of order, but
  `selectFinishedRuns` sorts by `finished_at` and the seed's finish dates rose
  with run size, so the query handed the percentile sorted values. The finish
  dates are now out of size order; the same red run then failed 3 of 13, the
  token percentiles and the dollars included.

  **Gates, on the tree this entry was committed with.** `npm run check` exited 0. `npm test -- --project planner` exited 0 with 59 files and 967 tests; on
  `95c6403` before any edit the same command was 55 files and 931 tests.

  **Not done.** The Done-when line "the report runs inside the built image with
  `--days 1`" is `unproven (gate)`. No image was built here. The path
  `tools/planner/api/dist/report.js` was checked by reading the `Dockerfile`
  (`WORKDIR /app`, `CMD ["node", "tools/planner/api/dist/main.js"]`), not by
  running it. The rest of the report path was never run against a real model.
  Every count here came from test providers. The scripted provider reports
  none, and the Anthropic fixtures are pl-39's, written by hand.

  **Could have folded in, and did not.** pl-39's Build step still says
  `usage` is `input_tokens` plus both cache kinds, which this ticket replaced.
  A dated line on pl-39 would have been free. It was left alone because pl-39
  is another ticket's closed record, outside this batch, and the dispatch
  scoped edits to this ticket's files; it was raised with the orchestrator
  instead, beside whether pl-40 should `depends_on` this ticket.

- 2026-09-14 — Two owner decisions, relayed by the orchestrator, which
  verified the premises on `origin/main` first and put both to the owner with
  AskUserQuestion. Both went the way the builder recommended.
  - **Should pl-40 `depends_on` pl-49?** Options: add it in pl-49's pull
    request (recommended), or leave pl-40 as it is. **Chosen: add it.**
    pl-40's frontmatter is now `depends_on: [pl-39, pl-49]`, and nothing else
    in pl-40 changed. Its harness sums the fan-out's `usage`, and its Log table
    wants cache reads as a column of their own, which only this ticket's split
    provides.
  - **Should pl-49's pull request correct pl-39's stale usage text?** Options:
    a dated one-line Log entry on pl-39 without rewriting its Build
    (recommended), or leave pl-39 alone. **Chosen: the dated Log line.** pl-39's
    Build is unchanged.
- 2026-09-14 — **Migration 9, settled by the orchestrator, not the owner.** The
  gate found that pl-44 and pl-47, both unbuilt, still named migration 9 as
  theirs, and it declined to choose between patching them now and leaving a
  note. The orchestrator settled it: root `CLAUDE.md` says a sentence the
  change at hand makes stale is fixed in that change, not filed, and this
  branch is what took 9.
  - **pl-44:** the Build step 7 heading, its "Today's last is" sentence, the
    unique-index bullet, the migrations-tests bullet and the Done-when now say
    10 and `user_version = 9`. Each says pl-49 took 9 and the real number is
    whatever is next free at build time. "Take the next free number at build
    time" is kept as the rule. The heading, the unique-index bullet and the
    Done-when are the three lines the orchestrator named. The other two stated
    the same number, and were fixed so they would not contradict the heading.
  - **pl-47:** step 1's parenthetical only. Its dated filing Log, which
    recorded 9 as free on 2026-09-13, is left as it was, because it was true
    then.
- 2026-09-15 — **The `## Review` section above was transcribed by the builder,
  verbatim, from the gate's own text.** The gate (`ticket-reviewer`, dispatched
  as `sonnet`) sent it as a message and did not write it into this file. Three
  things differ from the text the gate sent:
  - **One header sentence.** The orchestrator directed it: `a4bd8a6` is a
    pre-squash branch sha, kept because it is the tree the citations were
    reviewed against.
  - **An anchor on `run-usage.test.ts:206`** in the reliability line. The
    orchestrator directed it as a mechanical repair, using the anchor the
    gate's own table row already carries.
  - **oxfmt's table padding.**

  No verdict, row, finding or severity changed.
