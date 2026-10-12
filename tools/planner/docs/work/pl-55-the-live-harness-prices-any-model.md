---
id: pl-55
tool: planner
title: The live harness prices whatever model it is pointed at, so pl-40 can run on three
kind: work-package
status: done
milestone: P3
depends_on: []
difficulty: standard
---

# pl-55 — The live harness prices whatever model it is pointed at

**Packages:** `api`, and only under `api/test/`: `test/live/run.ts` and the two
tests beside it. No `src` change.

## Why

**Decided by the owner on 2026-10-12:** pl-40's paid run measures **Claude Haiku
5.5 (`claude-haiku-5-5`), Claude Sonnet 5.5 (`claude-sonnet-5-5`) and Claude Opus
5.5 (`claude-opus-5-5`)**, under the same protocol, rather than `claude-opus-5`
alone. The deployed default stays `claude-opus-5` until those numbers are in.
Choosing among the three is a later decision, and it is made on the run's results
(pl-40's Log). Two things prompted this. All three models were released after the
2026-09-13 choice. And their rates span about forty times, Haiku to Opus, which
only a measurement can weigh against the quality a specialist loses. Sonnet was
added to give the comparison a middle point rather than two ends.

**Also decided on 2026-10-12:** the model, the effort and the prices are
**variables, not code**, because they change over time and updating them should
not need a commit. The deployed half already holds:

- `MODEL` and `MODEL_EFFORT` choose the model and the effort (`api/src/config.ts`,
  `loadApiConfig`).
- pl-49's four `MODEL_PRICE_*` variables (`MODEL_PRICE_VARIABLES`) price the cost
  report. Their doc comment is explicit: "Settings, never a table in code".

The harness is the one place that breaks this. `api/test/live/run.ts` prices its
session spend stop and every record's `observedUsd` from a hard-coded
`OPUS_5_PRICES` ($5 / $25 per MTok). Pointing it at another model with `MODEL`
works, and the adapter accepts both models as-is. But the dollars come out wrong:
the stop on Haiku 5.5 would trip about fifty times too early, Sonnet 5.5's
about two and a half times too early, and Opus 5.5's figures would read 25% high. pl-40's dollar table would then quote rates nobody
paid. Its records also do not say which effort they ran at, so two runs at
different efforts read the same.

## Build

1. **Prices come from `config.modelPrices`, never from a constant.** Remove
   `OPUS_5_PRICES`. `runCeilingUsd(budget, worstInputTokensPerCall, prices)` and
   `observedUsd(usage, prices)` take the rates as an argument.
   `SessionSpendStop` receives them in its constructor. Read them once in `main()`
   through one exported function, say `livePricesFor(config)`, which:
   - under `MODEL_PROVIDER=anthropic`, **refuses when any of the four is unset**,
     naming each unset variable by its `MODEL_PRICE_VARIABLES` name. It runs
     after `assertLiveRunConsent` and **before `createModelProvider`**, because a
     spend stop with no rate is no stop at all.
   - under any other provider, prices an unset rate as 0. The scripted provider
     reports `null` usage, so every dollar figure is 0 anyway, and the keyless
     scripted run in pl-40's Build step 6 has to keep working with nothing set.

   Do not add a fallback table keyed by model id "for convenience". That table is
   the thing this ticket removes, and it would be stale the day a price changes.

2. **Every record says what it ran under.** Beside `requestedModel`, add
   `effort` (`config.modelEffort`) and `prices` (the four rates it was priced
   at) to `LiveRunRecord`. A record read months later then states its own
   assumptions, without the shell that produced it.

3. **The tests pass rates explicitly.** `live-gate.test.ts` pins the filing's
   golden ceilings ($2.24, $2.73, $0.68) at Opus 5's rates. Keep those numbers,
   passing `{ inputPerMTok: 5, outputPerMTok: 25, … }` as a named fixture in the
   test, since the arithmetic is the same at any rate. Add:
   - a test that the same budget at a different rate scales the ceiling
     linearly. Use any synthetic pair; the point is that nothing in the function
     still reads a constant.
   - tests over `livePricesFor`: refuses under `anthropic` with one rate unset
     and names that variable; passes with all four set; returns zeros under
     `scripted` with none set.

4. **Words.** The file header (`run.ts` lines 37–40) and the spend-stop comment
   name `claude-opus-5` and Opus 5's rates as what the run uses. Rewrite them to
   say the run measures whatever `MODEL` names, at the rates `MODEL_PRICE_*` give.
   The usage message in `parseCli` should name the price variables, because
   they are now required for a paid run.

5. **The scripted run still completes A–D end to end**, with only
   `PLANNER_LIVE_RUN=1` set and no price variables, writing records in their new
   shape to a scratch directory. That is how the builder proves the harness, as
   pl-40's own Build step 6 did.

## How the owner runs pl-40 afterwards

**Five runs, decided by the owner on 2026-10-12:**

| Model      | Effort                  | Why                                                                                       |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Haiku 5.5  | `low`, `medium`, `high` | What effort buys, measured where a run costs cents, including whether `high` hits the cap |
| Sonnet 5.5 | `low`                   | The three models compared like for like, at the level that ships                          |
| Opus 5.5   | `low`                   | Likewise                                                                                  |

`low` is what `MODEL_EFFORT` defaults to and what pl-39 chose. Holding it fixed
across the three models keeps the model the only variable. The effort sweep is on
Haiku alone because it is the only model where a sweep costs nothing worth
weighing. On Opus, `high` would multiply the most expensive run for a level that
may never ship. What to watch at `high`: thinking counts against the 8,000-token
`MAX_OUTPUT_TOKENS`, so long thinking turns into `length` stops and re-asks. That
is a cost in pl-40's table, not a reason to raise the cap here.

Each run goes into its own directory, named `<model>-<effort>`.
`live-records.test.ts` already walks `fixtures/live/` recursively (pl-40 gate 2),
so the directories need no test change:

```bash
PLANNER_LIVE_RUN=1 MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=… \
  MODEL=claude-haiku-5-5 MODEL_EFFORT=low \
  MODEL_PRICE_INPUT_PER_MTOK=… MODEL_PRICE_OUTPUT_PER_MTOK=… \
  MODEL_PRICE_CACHE_READ_PER_MTOK=… MODEL_PRICE_CACHE_WRITE_PER_MTOK=… \
  node --import tsx tools/planner/api/test/live/run.ts \
    --out tools/planner/api/test/fixtures/live/claude-haiku-5-5-low --max-usd 1
```

Then the same command with `MODEL_EFFORT=medium` and `MODEL_EFFORT=high` for
Haiku, `MODEL=claude-sonnet-5-5` with `--max-usd 5`, and `MODEL=claude-opus-5-5`
with `--max-usd 10`, each with its own rates and its own `--out`. **Read the
rates from Anthropic's pricing page on the day.** On 2026-10-12 the cached model
table read, per MTok in and out: $0.10 / $0.50 for Haiku 5.5 (on prompts up to
100K tokens; this harness's largest is about 10.7k), $2 / $10 for Sonnet 5.5, and
$4 / $20 for Opus 5.5, with cache reads at $0.20 for the latter two. (The
pricing page itself said $0.10 for Sonnet 5.5's cache reads that same day, and
pl-40's run used it — the cached table was wrong, which is the point.) No ticket
should be the source of a rate.

## Done when

- `grep -nE 'claude-|PerMTok: [0-9]' tools/planner/api/test/live/run.ts` finds no
  model id and no literal rate in code. Comments and the usage text may name
  variables.
- Under `MODEL_PROVIDER=anthropic` with a `MODEL_PRICE_*` unset, the harness
  refuses before a provider is constructed, naming the variable. Proved by a test
  over `livePricesFor`.
- `runCeilingUsd` still reproduces the filing's $2.24 / $2.73 / $0.68 at Opus 5's
  rates passed in, and a test shows the ceiling following the rates it is given.
- A scripted A–D run with no price variables completes and writes records that
  carry `effort` and `prices`. `live-records.test.ts` is green over a copy of them.
- `npm run check` and `npm test -- --project planner` pass.

## Traps

**Haiku 5.5 has no server-side fallback.** The adapter sends
`fallbacks: "default"` unconditionally, and Haiku 5.5 accepts that form. A declined
request just stays declined, with `stop_reason: "refusal"`. A list of fallback
models, by contrast, returns a 400 on Haiku 5.5, so do not "fix" the adapter
towards one. The consequence for pl-40 is that rule (c) cannot trip on the Haiku
run. A refusal there shows up as a specialist gap, which pl-40's table already
counts.

**Sonnet 5.5 only takes the `"default"` form of `fallbacks`, and only on the
Claude API.** That is the form the adapter sends, and the harness talks to
`ANTHROPIC_BASE_URL`, so this holds. It stops holding if anyone points the
harness at another platform.

**Sonnet 5.5 declines in more categories than the others** (its safety
classifiers add `general_harms`, which benign work can also trigger). A refusal
rate that differs between the three models is a finding for pl-40's table, not
noise to average away.

**Token counts do not compare across the three models.** Their tokenizers differ, so
`count_tokens` over the same prompt gives different numbers. pl-40's comparison
is in dollars and in reply quality, never in tokens.

**Effort defaults differ (`medium` on Opus 5.5 and Haiku 5.5, `high` on Sonnet
5.5), and none of the three can run without thinking the way `disabled` once did.**
Neither matters here, because `MODEL_EFFORT` defaults to `low` and is sent
explicitly, and the adapter never disables thinking. Both would matter if someone
"simplified" the effort line out of the adapter.

## Review

**Gate: PASS** — 2026-10-12 · `ed4ccb9f..b499e1db` · Sonnet 5.5, depth full

Range: `git diff ed4ccb9fc3605e6d8b5b1b31f38dcded8c0a7694...b499e1db5b14625755352010eece291eb35aa1ff` — two files, both under `tools/planner/api/test/`: `live/run.ts` and `live-gate.test.ts`. No `src` change, no contract change, no new workspace. The branch carries no ticket Log entry, so there was nothing to check a claim against. The pull request's own CI at this head: `check`, `e2e`, `docker`, `codeql`, `CodeQL` and `dependency-review` green; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still in progress when read, so the local run below is the proof for Done when 5's second half.

| Done when                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grep -nE 'claude-\|PerMTok: [0-9]' run.ts` finds no model id and no literal rate                                                                               | **verified** — ran it at the head: no output, exit 1. No test asserts it. The pattern only matches a rate spelled `PerMTok: <digit>`: the mutation `input * 5` in finding 1 is not matched by it.                                                                                                                                                                                                                                    |
| Under `anthropic` with a `MODEL_PRICE_*` unset the harness refuses before a provider is constructed, naming the variable; proved by a test over `livePricesFor` | refusal and naming: `api/test/live-gate.test.ts` › "livePricesFor (pl-55)" › "under anthropic, refuses with one rate unset and names that variable" ✓ (loops all four variables, asserts `Refusing: <VAR> is unset.`) and › "under anthropic with none set, names all four" ✓. **Ordering ("before a provider is constructed"): verified, not proven** — no test covers `main()`; see finding 2. I ran the process both ways, below. |
| `runCeilingUsd` reproduces $2.24 / $2.73 / $0.68 at Opus 5's rates passed in, and a test shows the ceiling following the rates                                  | `live-gate.test.ts` › "runCeilingUsd" goldens (now passing `OPUS_5_RATES`, a fixture in the test) ✓; › "runCeilingUsd follows the rates it is given (pl-55)" › "the same budget at a synthetic rate prices its own token counts, not Opus 5's", "scaling every rate by k scales the ceiling by k" (k = 0.02, 0.4, 3), "zero rates are a zero ceiling…" ✓. Mutation-checked, below.                                                   |
| A scripted A–D run with no price variables completes and writes records carrying `effort` and `prices`; `live-records.test.ts` green over a copy                | **verified** by running it — nothing on the branch asserts the record shape. 25 of 25 records (6 A + 15 B + 3 C + 1 D) carry `effort: "low"` and `prices` of four zeros; `live-records.test.ts` › 43 of 43 over a copy under `fixtures/live/claude-scripted-low/`; positive control below.                                                                                                                                           |
| `npm run check` and `npm test -- --project planner` pass                                                                                                        | **verified** — `npm run check` exit 0; `npm test -- --project planner` exit 0, 77 of 77 files, 1312 of 1312 tests (`live-gate.test.ts` alone: 27 of 27). The pull request's `test (ubuntu-latest)` leg was still running at the head.                                                                                                                                                                                                |

**What I ran, in the order the dispatch gave**

1. _The real thing._ With `PLANNER_LIVE_RUN=1` the only variable set (every `MODEL*`, `MODEL_PRICE_*`, `ANTHROPIC_*` removed with `env -u`), `node --import tsx tools/planner/api/test/live/run.ts --out <scratch>` exited 0. Header line: `provider=scripted model=scripted effort=low prices={…all 0}`; `session total observed: $0.0000 (max $10.00)`. Then `MODEL_PROVIDER=anthropic`, a fake key, three rates set and one unset: `Error: Refusing: MODEL_PRICE_CACHE_WRITE_PER_MTOK is unset. …`, process exit 1, no output directory created. **Ordering, by differential** (both the price and the key missing, so whichever refusal prints ran first): `MODEL_PRICE_OUTPUT_PER_MTOK` unset and no key prints the price refusal; all four set and no key prints `AppError: MODEL_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set` out of `createModelProvider`. **Positive control for that probe:** I moved `livePricesFor` below `createModelProvider` in `main()`; the same probe then printed the key error instead, so the probe can see the regression. `live-gate.test.ts` stayed 27 of 27 green under that move (finding 2). With all four set and a fake key the header line reads `provider=anthropic … prices={"inputPerMTok":1,"outputPerMTok":5,"cacheReadPerMTok":0.1,"cacheWritePerMTok":1.25}`; the fake key appears in no log.
2. _Is any rate read from anywhere but `livePricesFor`?_ No. Enumerated every dollar site in `run.ts`: `runCeilingUsd` (called only from `SessionSpendStop.assertRoomFor`), `observedUsd` (called from `SessionSpendStop.record` and `runOne`), the printed `$… observed` lines (from `record.observedUsd`) and `spend.spentUsd`. All take the one `prices` object `main()` builds; `runOne` receives it as `prices`, set D's `configD` is `{ ...config, maxOutputTokens }` and carries no price of its own (prices travel beside `config`, not in it). `config.modelPrices` is read only inside `livePricesFor`; the only other reader in `tools/planner` is `src/cost-report.ts`, which the harness does not call. Second method: I priced one `RunUsage` and one budget by hand at Haiku-, Sonnet- and Opus-shaped rates and compared with `observedUsd` and `runCeilingUsd` — 3 of 3 sets equal to 1e-12, `null` usage prices 0. End to end through the process: anthropic, fake key, unreachable base URL, `--max-usd` below the ceiling — rates 0.1/0.5 and `--max-usd 0.03` stops with "set A's next run could bill up to $0.04" (hand: 80,000 × 0.5 + 47,830 × 0.1 per MTok = $0.0448); rates 4/20 and `--max-usd 1.5` stops at "$1.79" (hand: $1.6 + $0.1913 = $1.7913). Both before any call.
3. _Would the new tests fail if a constant crept back?_ Yes for `runCeilingUsd`; **no for `observedUsd`** (finding 1). Mutating the line in `runCeilingUsd` that sums the two terms, on the detached tree, restoring with `git checkout b499e1db -- tools/planner/api/test/live/run.ts` after each: output term → literal `25`: 3 of 27 red (the three new `follows the rates it is given` tests); input term → literal `5`: the same 3 of 27 red; the 24 others stay green, as they should, since they pass Opus 5's rates. The goldens alone could not catch either, because they pass `5`/`25`.
4. _`live-records.test.ts` over a copy._ The 25 scripted records copied to `tools/planner/api/test/fixtures/live/claude-scripted-low/`: 43 of 43 green. Positive control: `headers` planted in `set-a-resort.json` → 1 failed | 42 passed, naming `claude-scripted-low/set-a-resort.json.headers: a record must never carry a key named this`. The whole copy removed afterwards; `git status --short` empty.

**Findings**

- **low** · no `Done when` line depends on it · `observedUsd` is priced by nothing a test or a run can see. Reproduction, on the detached head: replace the two rate reads in `observedUsd` with literals (`input * 5 +` and `output * 25 +` in place of `input * prices.inputPerMTok +` and `output * prices.outputPerMTok +`) and run `npx vitest run tools/planner/api/test/live-gate.test.ts` → **27 of 27 pass**. The scripted run cannot expose it either, because its usage is `null` and every dollar is 0 whatever the rate. The Done-when grep does not match `* 5` either. This is the function that prices every record's `observedUsd` and the session total, and so every figure in pl-40's dollar table; the ticket removes the constant from it and nothing holds it out. Remedy, cheap: one golden test in `live-gate.test.ts` for `observedUsd` at two different rate sets with all four token kinds non-zero, with the expected dollars written out by hand. Worked values for usage input 12,345 / output 6,789 / cache read 4,000 / cache write 1,500: $0.09713 at rates 2 / 10 / 0.2 / 2.5, and $0.19346 at 4 / 20 / 0.2 / 5 (per MTok), both equal to `observedUsd`'s output when I called it. `SessionSpendStop` is not exported, so its use of the same rates stays checked only by the end-to-end stop runs in item 2. Not a shape shared with sibling tickets.
- **low** · no `Done when` line depends on it · `main()`'s ordering — `livePricesFor` before `createModelProvider` — is the whole reason the ticket says "a spend stop with no rate is no stop at all", and no test holds it. Reproduction: move the `const prices = livePricesFor(config);` and `new SessionSpendStop(maxUsd, prices)` lines to just after `createModelProvider(config, logger)` and run `live-gate.test.ts` → 27 of 27 pass; the process probe flips (item 1 above). The ticket's Done-when line names a test over `livePricesFor` as the proof, and the build did that, so this is not graded higher. A pin would be a subprocess test: spawn `node --import tsx tools/planner/api/test/live/run.ts --out <tmp>` with `PLANNER_LIVE_RUN=1 MODEL_PROVIDER=anthropic` and one `MODEL_PRICE_*` unset and no key, and assert stderr names the variable and not `ANTHROPIC_API_KEY`. It needs no network, no key and takes about a second. Optional.
- **dropped** · "a bare `Error` where the repo wants `AppError`" — `livePricesFor` throws `new Error`, as the file's other eight throws do (`assertLiveRunConsent`, `parseCli`, `SessionSpendStop`); it is a test-tree script that no service imports. Not a defect.
- **dropped** · "the Done-when grep is weak" — true (finding 1 shows `* 5` evades it) but it is the ticket's wording, not the build's; the build removed every literal and the grep is clean. Recorded in the first row.
- **not raised** · an explicit `0` for a rate under `anthropic` is accepted (pl-49's parser accepts non-negative rates); all four at `0` would make every ceiling $0 and the spend stop inert. Settled by the dispatch, not re-opened.
- **findings** · the hunt returned 4; 2 carried (both low), 2 dropped; plus 1 settled item not raised.
- NFR: security ✓ (the key is not printed by any path run; `prices` in a record are rates, not credentials) · performance n/a · reliability ✓ (refusal precedes any network client; spend stop follows the supplied rates, checked by hand arithmetic) · maintainability — findings 1 and 2.

Invariants walked: no cross-tool import (only `../../src/config.ts`, same package); style (`import type`, `.ts` extensions, no `any`) clean under `npm run check`; no new test file, so no `tsconfig.tests.json` registration. Skipped as not touchable by this diff: SSRF, process-tree kill, `redactUrl`/`redactHeaders`, contract edits, `Dockerfile` closure.

## Log

### 2026-10-12 — filed

Filed from a session that started by asking what is next on the planner: the
answer was pl-40, unblocked since pl-41 and pl-50 landed, and waiting only on a
funded key. The owner asked whether it could run on Haiku to save money. The
adapter turned out to accept both new models with no change (checked against
the Haiku 5.5 and Opus 5.5 notes in the Claude API reference: thinking is
adaptive, `output_config.format` and `effort` are supported, and
`fallbacks: "default"` is accepted). The owner then asked why Sonnet was
missing from the options. It had no good reason to be, and it was added as a
third model. Asked what effort each model would run at, the owner chose
`low` on all three plus Haiku at `medium` and `high`. The reasons are in the
table above. So the only obstacle is the harness's
hard-coded rates. The filing session began folding the price change in and
stopped at the owner's request: the change goes through its own ticket. Nothing
was changed in code.

### 2026-10-12 — built (PR #458)

Built on Opus 5.5 in one session, gated by Sonnet 5.5. `OPUS_5_PRICES` is gone.
`livePricesFor(config)` takes `Pick<ApiConfig, "modelProvider" |
"modelPrices">`, so its tests build the config through `loadApiConfig` from an
env and exercise pl-49's parser too. It returns `LivePrices`, which is
`ModelPrices` with every rate a `number`. Under `anthropic` it names _every_
unset variable in one refusal, not only the first. `main()` also prints the
effort and rates on its header line, so a run's terminal output states them as
the records do.

The brief had one gap. It asked for a test that the ceiling follows its rates,
but said nothing about `observedUsd`, which prices every record and the session
total. Gate 1 showed that no test held it: literal `5` and `25` in its body
left every test green, and the scripted run cannot see a rate because its usage
is `null`. The Done-when grep does not match `input * 5` either. Gate 1 also
showed that no test held `main()`'s ordering: moving `livePricesFor` below
`createModelProvider` left every test green. Both were `low`, and both were
fixed after the gate, by tests only. One is a hand-worked golden for
`observedUsd` at two rate sets over all four token kinds. The other is a
subprocess test that runs `run.ts` with one rate and the key both missing, and
asserts which refusal prints. Each was shown red under its mutant and green
without it. No code under test changed, so they were not re-gated.

For pl-40's owner run: a rate explicitly set to `0` under `anthropic` is
accepted, because pl-49's parser accepts any non-negative rate, and four zeros
make the spend stop inert. Read the rates off the pricing page, as the brief
says.
