---
id: pl-55
tool: planner
title: The live harness prices whatever model it is pointed at, so pl-40 can run on three
kind: work-package
status: ready
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
$4 / $20 for Opus 5.5, with cache reads at $0.20 for the latter two. No ticket
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
