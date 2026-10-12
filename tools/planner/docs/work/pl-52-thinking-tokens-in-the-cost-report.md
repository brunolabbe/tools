---
id: pl-52
tool: planner
title: Give the run-cost report its own thinking-token column
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-12 · `34c2cba4..942fec1a` · Opus 5.5, depth full

| Done when                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration test: a fresh DB and one at the previous migration both reach the column, `NULL` for every pre-existing row | `api/test/migrations.test.ts` › "a fresh database's runs carry the column" and › "a database at user_version = 11 reaches the column, and a run already there reads back NULL" (asserts `{ thinking_tokens: null, output_tokens: 500 }` after `migrate`) ✓. The gate also built real databases at 9, 10 and 11 from the `schema.ts` that shipped each, migrated v9 and v11 with the branch: every other `plan_runs` column was unchanged, and `thinking_tokens` was `NULL` on every row |
| `updateRunUsage` writes `thinking_tokens`; a case reads back a non-null figure and a `null` one                       | `api/test/run-usage.test.ts` › "a reply's thinking tokens are summed into the run's own column, a subset of output and not an addition" (`expectedRow(answered, 0, 20)`) and › "a run no reply gave a thinking breakdown for records null, not zero" ✓. The `?? 0` mutation in `updateRunUsage` fails 4 of 655 api tests, this one among them                                                                                                                                           |
| `cost-report.test.ts`: mixed rows print the triple, unpriced, with the caveat; all-`null` prints `—`                  | `api/test/cost-report.test.ts` › "prints thinking as its own row over the runs that reported it, and says it is a lower bound" (`["8,000", "20,000", "11,000"]`, checked by hand: nearest-rank over 5,000 / 8,000 / 20,000), › "prints a dash, not a zero, when no run in the window reported a thinking breakdown", and › "never prices thinking: …" for "unpriced" ✓. Treating `null` as 0 in the report fails the first two                                                          |
| A mutation joining thinking into `TOKEN_KINDS` is caught by a dollar-total assertion                                  | Planted: 3 of 17 fail in `cost-report.test.ts` — › "never prices thinking: …" and › "with every price set, …" (total reads `$18.3250`, not `$17.5000`), and › "with every price unset, …" ✓                                                                                                                                                                                                                                                                                             |
| `npm run check` and `npm test -- --project planner` pass                                                              | verified at this head: check exit 0 ("All matched files use the correct format"); planner 1433 of 1433, 77 files. PR #467 CI all green on 942fec1a, Windows leg included                                                                                                                                                                                                                                                                                                                |

- **med** · open decision · no `Done when` line depends on it · **The thinking
  row's percentiles run over a narrower population than the output row it calls
  itself "part of", and can read larger than it.** `reported` drops a `NULL`
  per column, so the output row covers every metered run and the thinking row
  only those that reported a breakdown. Every run that finished before
  migration 12 is `NULL`, so for the first `--days` after the deploy the window
  mixes the two populations. Reproduction:
  `node --import tsx <scratch>/checks.mts <worktree> <scratch>` renders five
  runs, three before the deploy (output 100, thinking `NULL`) and two after
  (output 1,000, thinking 900):
  `output 100 1,000 460` above
  `thinking 900 900 900 … (2 of 5 runs reported a breakdown)`. The header gives
  the count but does not say why the two rows are not comparable, under a
  heading saying the thinking figure is part of the output figure. The cache
  rows already drop `NULL` per column, but none of them claims to be a subset of
  another row. **Options:** (1, recommended) also print the share
  `Σ thinking ÷ Σ output` over the runs that reported both, the figure pl-40's
  table used, so the comparison is made over one population. It is a few lines
  and one assertion. (2) Add one sentence to the header saying the triple covers
  only the N runs that reported a breakdown and is not comparable to the output
  row. Wording only. (3) Accept as is: the "N of M" count is the disclosure.
- **low** · `nfr:maintainability` · **A real zero has no test, and it will be
  the common production value.** The deployed default is
  `claude-sonnet-5-5` at `low` (`API_DEFAULTS` in `api/src/config.ts`), which
  pl-40's Log measured reporting zero thinking on all 94 replies. With both
  mutations below planted, all 655 api tests pass:
  `record.usage.thinkingTokens || null` in `updateRunUsage`, and
  `.filter((value) => value !== 0)` on the report's `thinking` sample
  (`node <scratch>/mutate2.mjs <worktree> zero-to-null-persist`, then
  `zero-dropped-report`, then `npx vitest run tools/planner/api/test`). The
  code is right today. A v12 database with one run at 0 and one at 120 printed
  `thinking 0 120 60 … (2 of 4 runs reported a breakdown)` through
  `dist/report.js`. No fixture pins it: the `THINKING` seed has no 0, and
  `MeteredProvider` is never given `thinking: 0`.
- **low** · `nfr:maintainability` · `THINKING_CAVEAT` in
  `api/src/cost-report.ts` ships "The one funded run measured (574 replies,
  three models)" in operator output, with no ticket id or date to find that run
  by. It goes stale the day a second measurement exists. Every figure in it is
  true against pl-40's Log (see dropped).
- **dropped** · `USAGE_SCHEMA_VERSION` moving to 12 gates something wrongly.
  `runReport` in `api/src/cost-report.ts` is its only reader, and the only
  `user_version` reader outside tests besides `migrate`. Through the built
  `dist/report.js`, real databases at 9, 10 and 11 are each refused with exit 1
  and the sentence. 12 reads with exit 0, and v9 and v11 read after the
  branch's `migrate`, printing `—` / "0 of 2". With the constant put back at 9,
  › "a database at migration 11 … is refused too" fails with
  `SqliteError: no such column: thinking_tokens`, as the Log says.
- **dropped** · `UNDO_MIGRATION_12` unfaithful. A base-built v11 schema and a
  branch-built one wound back by it are identical across `sqlite_master` and
  every table's `table_info`.
- **dropped** · caveat or Log figures that differ from pl-40. 574 is the sum of
  pl-40's Calls column (128 + 128 + 130 + 94 + 94). The three models are
  Haiku, Sonnet and Opus 5.5. "Every one of the 574 replies reported
  `thinkingTokens`" and "Zero fallbacks in 574 replies" are both in its Log.
  "Nearly every reply" at zero for Sonnet and Opus at `low` matches 94 of 94
  and 91 of 94.
- **dropped** · Done when 2's "(a scripted run)": the `null` case wraps the
  scripted provider in `MeteredProvider` with a `null` breakdown rather than
  running it bare. The line's intent (a run with no breakdown persists `NULL`)
  is asserted, and the `?? 0` mutation is caught. Not a defect.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- Invariants: contract untouched, no new error code, no spawn, no logging of
  URLs or headers, style clean (check green). Route enumeration, Dockerfile and
  test registration skipped: the diff touches none of them.
- NFR: security n/a · performance n/a · reliability ✓ (additive migration
  proven on real v9, v10 and v11 databases) · maintainability — the two lows
  above.

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

### 2026-10-12 — built

Built from `origin/main` at 34c2cba4, after pl-40's funded run (#462) landed, so
step 5's caveat is worded from that run and not from the doc comment.

**Migration 12, not a hard-coded number.** `MIGRATIONS.length` was 11 at build
time, so `ALTER TABLE plan_runs ADD COLUMN thinking_tokens INTEGER;` is
migration 12 in `api/src/db/schema.ts`, with migration 9's comment pattern for
why it is a column of its own: it is a subset of `output_tokens` and must stay
separable from it. `updateRunUsage` writes `record.usage.thinkingTokens`.
`RunUsageRow` and `selectFinishedRuns` carry it.

**The report prints it apart and prices it never.** A "Thinking per run" block
under the token table, one `statRow` (p50, p95, mean, `—` over an empty sample),
headed "part of the output above, already priced there, not an addition to the
bill (N of M runs reported a breakdown)". It is not in `TOKEN_KINDS`, whose doc
comment now says why. Joining it in (`{ label: "thinking", column:
"thinking_tokens", price: "outputPerMTok" }`) fails three `cost-report.test.ts`
cases: the total reads `$18.3250` where the four billed kinds make `$17.5000`,
and the "every price unset" message names the output price twice.

**Step 5, the caveat, worded from pl-40's Log ("Decision A's two questions").**
That run measured both questions: 574 replies across three models, every one
reported `thinkingTokens`, so no run mixed a null breakdown with a reported one;
and nothing fell back, so no multi-attempt thinking reply was observed. The
sentence therefore says the report undercounts in both cases and that the one
funded run showed neither, "so the gap has not been seen, which is not the same
as ruled out". It does not say the gap is rare: that run cannot say how often.
Two things the wording cannot carry: all 574 replies came from the Anthropic
provider (a scripted run reports `null` for every reply, which the `—` and the
"N of M reported" count already show), and Sonnet and Opus 5.5 at `low`
reported _zero_ thinking on nearly every reply, which is a reported figure, not
a null.

**Step 6, `USAGE_SCHEMA_VERSION` bumps from 9 to 12.** `migrations.test.ts` has
no pattern for it: it never mentions the constant, and its only version
assertions are the current `user_version` (every `toBe(11)` there and in
`schema.test.ts` became `toBe(12)`, and each wound-back test gained
`UNDO_MIGRATION_12`). The constant's own doc comment is the rule ("the schema
version that added the columns this reads"), and `runReport` opens the database
read-only without migrating it, so a database at 9, 10 or 11 has the other
usage columns and would fail the query on this one. Measured: with the constant
left at 9, the new `cost-report.test.ts` case "a database at migration 11 has
the usage columns but not thinking_tokens, and is refused too" fails with
`SqliteError: no such column: thinking_tokens`; at 12 it is refused with the
existing sentence. The sentence itself changed from "run costs are recorded from
version N" to "this report reads run costs from version N", which stays true for
a database at 9 to 11.

**Folded in:** `docs/02-DEPLOYMENT.md` "What the runs cost" gains a paragraph on
the thinking row and the version-12 refusal; that section described the report's
output, so it would have been stale otherwise. **Not folded in:** nothing else
was made free.

### 2026-10-12 — gate 1 round 1: three findings, owner's answers recorded

Gate 1 graded `942fec1a` CONCERNS. Its one open decision was put to the owner
(2026-10-12, `AskUserQuestion`):

- **Question:** the thinking row's percentiles run over only the runs that
  reported a breakdown, while the output row it calls itself "part of" covers
  every metered run, so right after migration 12 the thinking row can read
  larger than the output row. What should the report do?
- **Options:** (1) also print the share `Σ thinking ÷ Σ output` over the runs
  that reported both; (2) one header sentence saying the triple covers only the
  runs that reported a breakdown; (3) accept as is, the "N of M" count being the
  disclosure.
- **Choice:** (1), the gate's recommendation.
- **Question:** the two lows (a real zero has no test; the caveat cites "the one
  funded run" with no id or date): fix both, or leave them recorded?
- **Choice:** fix both.

**Med, fixed: the share line.** `thinkingShare` in `api/src/cost-report.ts` sums
thinking and output over the runs where both are non-null, and the report prints
`share  20.6% of output: total thinking ÷ total output over the 3 runs that
reported both` under the thinking row. It is `—` when no run reported both or
when their output sums to 0 (no division, no NaN), and `0.0%` when runs reported
both and thought nothing. Tests in `cost-report.test.ts`: "prints the share of
output over the runs that reported both, so the comparison is one population"
(20.6%, run 2 excluded); "a window that mixes runs from before the migration
with runs after it reads the share, not the narrower row" (the gate's five-run
reproduction, 90.0% over 2 runs); "prints a dash, not a zero, when no run in the
window reported a thinking breakdown" (share `—` over 0 runs, no `NaN`); "the
share is 0.0% for runs that all thought nothing, and a dash when there was no
output to divide" (Σ output 0 and the empty list).

**Low, fixed: a real zero.** `run-usage.test.ts` "a reply that reported zero
thinking records zero, not null" (`MeteredProvider({ thinking: 0 })`) and
`cost-report.test.ts` "a real zero is a figure: it is kept in the row and the
share, not read as unreported" (one run at 0, one at 120, row `0 120 60`). Both of
the gate's mutations now fail a test (`mutate2.mjs … zero-to-null-persist` fails
the first with 1 failed | 659 passed of 660; `zero-dropped-report` fails the
second, also 1 of 660), each reverted afterwards.

**Low, fixed: the caveat's citation.** It now reads "The funded run of 2026-10-12
(pl-40: 574 replies, three models)", so the run can be found and the sentence
can be seen to go stale when a second measurement exists.

- 2026-10-12 — **Gate 2's one low, _fixed at landing_** (the owner chose that
  over leaving it recorded; ticket text only, no code changed).

  **Question.** Gate 2 passed with one low finding: the round-1 entry quotes the
  share line as `31.3% … over the 2 runs`, a figure no test produces. Land it
  how?

  **Options.** Fix it at landing (recommended); leave it recorded.

  **Choice.** Fix it at landing. The example is now `20.6% … over the 3 runs`,
  the figure pinned by `cost-report.test.ts` "prints the share of output over
  the runs that reported both, so the comparison is one population". Proof it is
  in a test, and that 31.3 is in none, by two greps. First
  `grep -n "20.6% of output" tools/planner/api/test/cost-report.test.ts`
  prints line 272,
  `"share        20.6% of output: total thinking ÷ total output over the 3 runs that reported both",`
  and then `grep -rn "31\.3%" tools/planner/api/test tools/planner/api/src`
  prints nothing, exit 1.
