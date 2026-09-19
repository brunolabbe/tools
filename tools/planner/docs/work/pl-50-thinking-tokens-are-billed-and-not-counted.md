---
id: pl-50
tool: planner
title: The API reports how many billed output tokens were thinking; the seam drops it
kind: fix
status: done
milestone: P3
depends_on: [pl-39, pl-49]
difficulty: standard
---

# pl-50 — Thinking tokens are billed and not counted

## Why

[pl-40](./pl-40-prove-p3-against-a-real-model.md)'s Done when asks the Log's
usage table to give, per run, "calls, input, output, **thinking share of
output**, and cache reads." That column can never be filled by anything pl-40
writes, on any run, with any key — not because pl-40 is missing a
measurement, but because the seam it reads from throws the number away before
pl-40 ever sees it.

**The API reports it.** `BetaUsage.output_tokens_details`, declared in
`@anthropic-ai/sdk` 0.125.0 at `resources/beta/messages/messages.d.ts` line
2899 (prose, not a `file:line` citation — the package lives in `node_modules`,
which `scripts/citations.mjs` cannot resolve, the same way it cannot resolve a
citation into an unmerged sibling branch):

```ts
output_tokens_details: BetaOutputTokensDetails | null;
```

whose own doc comment says what it is: "Breakdown of output tokens by
category... how many of the billed output tokens were spent on internal
reasoning." pl-39's own header comment already says the surrounding fact —
"Thinking is billed as output and is invisible by default" — but stops at
noting that `usage.output_tokens` is inclusive; it does not say the API also
reports the split, because at the time pl-39 was built and gated, nobody had
read this far into the type.

**`usageOf` in `agent/src/providers/anthropic.ts:337-356` drops it.** It sums
`attempt.output_tokens` into `ModelUsage.outputTokens` and never reads
`attempt.output_tokens_details` at all — confirmed by reading the function,
not assumed: every field it touches is named there, and this one is not. The
seam it fills, `ModelUsage` in `agent/src/provider.ts:73-82`, has no field a
thinking share could go in even if `usageOf` read it.

**Found by pl-40's first gate, confirmed independently by both the builder
and the reviewer against the pinned SDK's own types** (the line above), not
assumed from pl-39's prose. It is pl-39's gap, not pl-40's: pl-40 only reads
`ModelReply.usage` the way every other caller does, and a gap in what that
carries is upstream of anything pl-40 could fix by writing a different
record. `agent/src/provider.ts` and `agent/src/providers/anthropic.ts` are
both outside pl-40's own declared scope — a contract-adjacent seam a work
package ticket does not touch mid-flight — which is why this is its own
ticket rather than a fold-in.

**Decided by the owner on 2026-09-18**, from three options the orchestrator
put with a recommendation: file this ticket now (taken), fold the
`ModelUsage` change into pl-40's branch behind an extra narrow gate, or drop
the column from pl-40's Log table entirely. The basis given: the defect is
pl-39's, pl-40's branch does not introduce it, and the fix reaches into the
model seam rather than into anything pl-40 owns.

## Build

1. **`ModelUsage` gains a field.** `agent/src/provider.ts`: add
   `thinkingTokens: number | null` beside `outputTokens`, with the same
   `null`-means-"nobody said" rule every other field here already follows —
   a provider that does not report thinking (the scripted one; possibly a
   future non-Anthropic one) reports `null`, never `0`.
2. **`usageOf` reads `output_tokens_details.reasoning_tokens`** (name it
   exactly what `BetaOutputTokensDetails` calls it — read the type, do not
   guess the field name from this ticket's prose) **for every attempt in
   `iterations`, summed the same way `output_tokens` already is**, and
   carries `null` through when an attempt's `output_tokens_details` is
   `null` rather than treating a missing breakdown as zero thinking.
3. **`addReplyUsage` in `agent/src/orchestrator.ts` carries it onto
   `RunUsage`** the same way every other `ModelUsage` field already reaches
   there, so a whole run's thinking share is summable the way its input and
   output already are.
4. **pl-40's harness records it.** `api/test/live/run.ts`'s `RecordedAttempt`
   already carries the full `usage` object verbatim; no structural change
   needed there beyond what the type change gives it for free — confirm by
   running the harness under scripted (still `null` throughout) and checking
   the emitted JSON carries the new key.
5. **pl-40's Done when line updates** to name the field pl-40's Log table
   actually reads it from, and its Log gets a dated line saying the column is
   fillable as of this ticket landing.

## Done when

- `ModelUsage.thinkingTokens` exists, documented the way its siblings are,
  `null` when a provider does not report it.
- `AnthropicProvider`'s existing fixture-driven tests
  (`agent/test/anthropic-provider.test.ts`) cover a reply whose
  `output_tokens_details` is present and one where it is `null`, each
  asserting `thinkingTokens` on the resulting `ModelUsage`.
- `ScriptedProvider`'s usage stays `null` throughout — a test pins this
  unchanged, since pl-39's "nobody said" rule must survive the new field.
- `RunUsage` and `addReplyUsage` carry the new field the same way the
  existing four do; `agent/test/fan-out-usage.test.ts` gets a case.
- pl-40's harness, re-run under the scripted provider, writes the new key
  (`null`) into every attempt's `usage` object with no other change to its
  output shape.
- `npm run check` and `npm test -- --project planner` pass.

## Review

### Gate 1

**Gate: FAIL** — 2026-09-19 · `origin/main...1460e24` (base `fb15bc9`); source coordinates below re-pointed to `7f3aa55`, where the gate-2 repair moved them, so they resolve at the tip · defect hunt run directly by the `ticket-reviewer` agent (opus; the builder ran sonnet), medium depth — no `Skill` tool, so no `code-review` subagent.

| Done when                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelUsage.thinkingTokens` exists, documented the way its siblings are, `null` when a provider does not report it                | exists and documented at `tools/planner/agent/src/provider.ts:95 "thinkingTokens: number"` and `tools/planner/agent/src/provider.ts:73 "is a subset of"` (what that doc claims: med 2); `null` when unreported at `tools/planner/agent/test/scripted-provider.test.ts:48 "thinkingTokens: null,"` ✓                                                                                                           |
| Anthropic fixture tests cover `output_tokens_details` present and `null`, each asserting `thinkingTokens`                         | present: `tools/planner/agent/test/anthropic-provider.test.ts:266 "thinkingTokens: 1_390"` ✓ · null: exercised as an absent key only, `tools/planner/agent/test/anthropic-provider.test.ts:242-244 "fixture carries no"` ✓ (low 5)                                                                                                                                                                            |
| `ScriptedProvider` usage stays `null` throughout, pinned by a test                                                                | `tools/planner/agent/test/scripted-provider.test.ts:41-49 "reports no usage rather than inventing token counts"` ✓                                                                                                                                                                                                                                                                                            |
| `RunUsage` and `addReplyUsage` carry the field the same way the existing four do; `fan-out-usage.test.ts` gets a case             | `tools/planner/agent/test/fan-out-usage.test.ts:73 "thinkingTokens: ordinary * 20 + 1"` and `tools/planner/agent/test/fan-out-usage.test.ts:134 "landed * (ORDINARY.thinkingTokens"` ✓ — two type-valid mutations of `tools/planner/agent/src/orchestrator.ts:218 "thinkingTokens: add(total.thinkingTokens"` each turn tests red; a run that mixes a `null` reply with a counted one is not asserted (med 3) |
| The pl-40 harness, re-run under scripted, writes the new key (`null`) into every attempt with no other change to its output shape | **verified** — ran `api/test/live/run.ts` under `MODEL_PROVIDER=scripted` at `fb15bc9` and at the tip: 25 files each, and a key-path diff adds `.specialists[].attempts[].usage.thinkingTokens` (all `null`) and the run-level `.usage.thinkingTokens`, which row 4 requires; nothing removed                                                                                                                 |
| `npm run check` and `npm test -- --project planner` pass                                                                          | **verified** — `check` exit 0; planner 71 files / 1184 tests at the tip and 71 / 1184 at `fb15bc9` (the branch adds assertions, not tests); the test-file diff adds keys and comments and removes or rewords no assertion. CI will still go red: high 1                                                                                                                                                       |

- **high** · CI `check` fails. `node scripts/citations-gate.mjs --against origin/main` exits 1 on `tools/planner/docs/work/pl-49-what-a-run-costs.md` with 7 moved citations: the lines this branch inserts in `anthropic-provider.test.ts` and `run-usage.test.ts` slide pl-49 merged anchors to 259, 295, 140, 158, 180 and 212 (twice). Re-point them in pl-49 record, as `c70dd8a` did for dl-51.
- **med** · Two findings, one decision (below). Within one reply, `thinkingTokens` and `outputTokens` do not cover the same attempts, yet `ModelUsage` documents the first as how much of the second was thinking. `tools/planner/agent/src/providers/anthropic.ts:373 "outputTokens += attempt.output_tokens;"` sums every `iterations` entry, while `tools/planner/agent/src/providers/anthropic.ts:375 "output_tokens_details?.thinking_tokens ?? null"` reads only the top level. The SDK (0.125.0, `resources/beta/messages/messages.d.ts`) declares `output_tokens_details` as a breakdown of the top-level `output_tokens` (line 4291 to 4298), and says `thinking_tokens` is always no more than that `output_tokens` (line 3006 to 3007). What the top-level count covers when there are several iterations is **not stated in the SDK**: its only statement is that `compaction` entries are excluded (line 4279). The serving-attempt-only reading rests on the hand-written `fallbackServed` fixture `_note`, not on the types. **Unmeasured**, and no fixture has both a fallback and a breakdown.
- **med** · Second finding of that mechanism. `addReplyUsage` sums past `null`: one reply at `null` and one at `1390` gives `thinkingTokens: 1390, outputTokens: 1610`, the same result as a run whose only thinking was 1390, whichever order they arrive in. Two `null` replies give `null`. Unlike the pl-49 cache kinds, a `null` here is per reply within one provider (adaptive thinking), and whether the API sends `null` or a zero for a reply that did not think is unmeasured.
- **low** · Two findings, one mechanism: stale SDK coordinates. pl-40 Log (`tools/planner/docs/work/pl-40-prove-p3-against-a-real-model.md:701-703 "naming the exact SDK type line"`) still calls that line `BetaUsage.output_tokens_details`, but it belongs to `BetaMessageDeltaUsage`; the `BetaUsage` field is at line 4298. The branch already edits pl-40 and did not correct it. The pl-50 Log cites `BetaOutputTokensDetails` as lines 2998 to 3007, stopping before the field at line 3009.
- **low** · No fixture sets `output_tokens_details: null`, the value the SDK actually declares; the null clause is proven through an absent key. `?.` treats both alike, and the mutation `?? 0` turns 4 tests red, so the behaviour is pinned; the test is narrower than the line.
- **dropped** · `usageOf` sums `compaction` output into `outputTokens` although the SDK excludes it from the top-level count. That is pl-49 code outside this range, and the planner does not enable compaction.
- **findings** · hunt run directly at medium depth; 7 returned, 6 carried, 1 dropped.
- NFR: security n/a (no URL, header or subprocess touched) · performance n/a · reliability ✓ (a missing breakdown is `null`, never a throw) · maintainability: med 2 and 3, low 4.

### Gate 2

**Gate: CONCERNS** — 2026-09-19 · `1460e24...7f3aa55` (the repair commit), re-read against `origin/main...7f3aa55` · same reviewer, medium depth.

| Gate-1 finding                                         | Settled by                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| high: pl-49 citations moved                            | re-pointed in pl-49 record; `node scripts/citations-gate.mjs --against origin/main` exit 0, 89 enforced, 0 failing ✓                                                                                                                                                                                                                                                          |
| med: thinking and output scope differ within a reply   | closed as documentation: `tools/planner/agent/src/provider.ts:75 "Within a single reply that took several attempts"`, `tools/planner/agent/src/orchestrator.ts:166 "Not proven to cover the same attempts"` and `tools/planner/agent/src/providers/anthropic.ts:348 "not stated by the SDK"` now say what is not known; recorded as unmeasured in both pl-50 and pl-40 Logs ✓ |
| med: null arithmetic reports a partial sum as complete | **open** — behaviour unchanged at `7f3aa55` on purpose; the remedy is an open decision with the orchestrator (document as a lower bound, null when coverage is incomplete, or carry a coverage count)                                                                                                                                                                         |
| low: stale SDK coordinates                             | pl-50 Log now cites 2998 to 3010; `tools/planner/docs/work/pl-40-prove-p3-against-a-real-model.md:739 "The decision-D entry above cites the wrong line"` corrects the earlier entry without rewriting it ✓                                                                                                                                                                    |
| low: no explicit-null fixture                          | `tools/planner/agent/test/anthropic-provider.test.ts:588 "expect(reply.usage.thinkingTokens).toBeNull();"`, a new test at the end of the file; the `?? 0` mutation now turns 5 of 33 red (was 4 of 32) ✓                                                                                                                                                                      |

- **med, open** · the null-arithmetic finding above, unchanged; it clears when the orchestrator decides and the chosen remedy lands with a test for a mixed `null` run.
- **findings** · repair diff read in full (7 files); 0 new returned, 0 carried, 0 dropped.
- Re-run at `7f3aa55`: `npm run check` exit 0; `npm test -- --project planner` 71 files / 1185 tests (one test added over gate 1); `npm run build` exit 0 before the suite.
- NFR: unchanged from gate 1.

## Log

### 2026-09-18 — filed

Filed by the orchestrator's direction, from pl-40's gate: found in gate round
1 (LOW 9) by `ticket-reviewer`, confirmed independently by the pl-40 builder
by reading `@anthropic-ai/sdk@0.125.0`'s own types rather than taking the
finding on trust, and put to the owner as one of four decisions on 2026-09-18.
The owner chose to file rather than fold in or drop the column, on the basis
that the defect belongs to pl-39's seam and pl-40's branch does not touch it.
No code was written here; `node scripts/next-id.mjs pl` reported `pl-50` free
at filing.

### 2026-09-19 — built

**What the ticket had wrong.** Build step 2 asked for `usageOf` to read
`output_tokens_details.reasoning_tokens` "for every attempt in `iterations`,
summed the same way `output_tokens` already is." Reading
`@anthropic-ai/sdk@0.125.0`'s own types directly (not assumed from the
ticket's prose, per its own instruction) found two things wrong with that:

1. **The field is named `thinking_tokens`, not `reasoning_tokens`** —
   `BetaOutputTokensDetails` (`node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:2998-3010`)
   declares exactly one field, `thinking_tokens: number`. The ticket's prose
   guessed a name from the doc comment's own wording ("internal reasoning")
   rather than the declared key, which is the exact trap its own parenthetical
   warned against.
2. **`output_tokens_details` does not exist on any per-iteration entry, so it
   cannot be summed "the same way `output_tokens` already is."** `usage.iterations`
   is `BetaIterationsUsage`, a union of `BetaMessageIterationUsage`,
   `BetaCompactionIterationUsage`, `BetaAdvisorMessageIterationUsage` and
   `BetaFallbackMessageIterationUsage` — read all four in the same file, and
   none declares `output_tokens_details`. Only the top-level `BetaUsage` (what
   `usageOf` receives as its `usage` parameter) has it. So the field is read
   once, from `usage` itself, never from `attempts` — see the doc comment
   added to `usageOf` in `agent/src/providers/anthropic.ts` for the full
   reasoning and its consequence (a declined fallback attempt's thinking, if
   any, is not reported anywhere the SDK's types can reach — an inherent API
   limitation, not a choice this code makes).

The existing `withThinking` fixture
(`agent/test/fixtures/anthropic-messages.json`) already had
`output_tokens_details` on its top-level `usage` and not on its `iterations[0]`
entry, which independently confirms this — whoever wrote that fixture during
pl-39 was already following the real shape, even though pl-39's `usageOf`
never read it and pl-40's gate read the ticket's own citation line (2899, which
is actually `BetaMessageDeltaUsage`'s field, a streaming-delta type not used
here) rather than the field's real host type.

**Unmeasured, found by this ticket's own gate (MED 2): what the top-level
`thinkingTokens` figure covers, within a reply that took several attempts, is
not stated by the SDK.** `outputTokens` is summed across every entry in
`usage.iterations`, on the documented basis that the top-level `output_tokens`
covers only the attempt that produced the final message (pl-49, resting on
the hand-written `fallbackServed` fixture's own `_note`, which in turn cites
the platform docs — not a guarantee in the SDK's types). `thinkingTokens` is
read once, from that same top-level object, because no per-iteration entry
ever carries a breakdown at all — so within one reply, the two fields are not
proven to describe the same attempts. No fixture combines a fallback with a
thinking breakdown, and the SDK's own comments say only that `thinking_tokens`
is "always ≤ `output_tokens`" and that a `compaction` entry's tokens are
excluded from the top level — nothing about a `fallback_message` entry's
thinking. `provider.ts`'s and `orchestrator.ts`'s doc comments now say this
plainly rather than asserting a scope the types do not state; pl-40's funded
run is where a real answer can be measured.

**Build steps 1–4 done as specified, corrected as above:**

- `ModelUsage.thinkingTokens: number | null` added
  (`agent/src/provider.ts`), documented as a subset of `outputTokens`, `null`
  meaning "nobody said."
- `usageOf` populates it from `usage.output_tokens_details?.thinking_tokens`
  (`agent/src/providers/anthropic.ts`).
- `RunUsage`/`emptyRunUsage`/`addReplyUsage` carry it through
  (`agent/src/orchestrator.ts`), summed with the same `add()` helper the other
  four fields use.
- `ScriptedProvider`'s reply literal gets `thinkingTokens: null`
  (`agent/src/providers/scripted.ts`).
- Every existing `ModelUsage`/`RunUsage` literal across the test suite needed
  the new required field added for the type to keep compiling:
  `agent/test/{ask,fan-out-usage,helpers,scripted-provider,anthropic-provider}.ts`
  and `api/test/run-usage.test.ts`. `fan-out-usage.test.ts`'s `ORDINARY` and
  `refused` fixtures were given distinct non-null `thinkingTokens` (20 and 1)
  so the "counts every reply..." and "a canceled fan-out..." tests exercise
  real summation across a fan-out, not just null-propagation — this is the
  case the ticket's Done-when asked for.
- pl-40's harness needed no structural change (confirmed, not assumed): its
  `RecordedAttempt.usage: ModelUsage` already carries the reply's `usage`
  object verbatim. Re-ran it end to end under `MODEL_PROVIDER=scripted`
  (`PLANNER_LIVE_RUN=1 node --import tsx api/test/live/run.ts --out <dir>
--max-usd 10`, no network, no key) and confirmed every attempt's emitted
  JSON now carries `"thinkingTokens": null` with no other change to the
  output shape.
- pl-40's Done-when line and Log updated in place
  (`pl-40-prove-p3-against-a-real-model.md`) to name the field and record
  that the column is now structurally fillable (still awaiting the owner's
  real run to put a non-null number in it).

**Fold-in considered and not taken.** pl-49 added a full DB column set for its
own per-kind breakdown (`plan_runs.input_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `output_tokens`, `fallback_calls` —
`api/src/db/schema.ts` migration, `api/src/db/runs.ts`'s `updateRunUsage`,
read back by `api/src/cost-report.ts`). A symmetrical `thinking_tokens` column
would be a small conceptual step from what this ticket already does, but it is
not small in the doing: it needs a new migration entry, a new
`updateRunUsage`/`RunUsageRow` column, a `cost-report.ts` read, and tests in
`api/test/run-usage.test.ts` and wherever `cost-report.ts` is tested — none of
which this ticket's Build or Done-when sections name, and it is not
"already-specified" elsewhere either. Doing it silently would also decide a
scope question (does the operator's cost report want a thinking-token line
today) the ticket never raised. Left as an open decision below rather than
folded in or done unilaterally.

**Verification.** Narrowest specs first, then the full project suite:

- `npx vitest run tools/planner/agent/test/anthropic-provider.test.ts
tools/planner/agent/test/scripted-provider.test.ts
tools/planner/agent/test/fan-out-usage.test.ts
tools/planner/agent/test/ask.test.ts --project planner` — 4 files, 54 tests,
  all passing.
- `npx vitest run tools/planner/api/test/run-usage.test.ts --project planner`
  — 1 file, 5 tests, all passing.
- **Proved red with the fix reverted**: temporarily forced `usageOf`'s
  `thinkingTokens` to `null` unconditionally and reran
  `anthropic-provider.test.ts` — the "thinking blocks are dropped..." test
  failed (`expected 1390, received null`), 1 of 32 failing; restored the fix
  and reran clean (32/32).
- `npm run check` — exit 0 (lint warnings are pre-existing, none in touched
  files; format and typecheck both clean).
- `npm test -- --project planner` — **71 files, 1184 tests**, all passing.
  One transient timeout in `revisions.test.ts` on an earlier run (a
  timing-sensitive test, unrelated file, not touched by this branch)
  reproduced as a flake: failed once under full-suite load, passed in
  isolation, passed again on a clean full-suite rerun.

**Open decision for the orchestrator: does the operator's cost report want a
`thinking_tokens` column now, or does it wait for its own ticket?** Options:

1. **(Recommended) File a small follow-up ticket** for the
   `schema.ts`/`runs.ts`/`cost-report.ts` persistence, symmetrical with
   pl-49's. Keeps this ticket's diff to the seam it named and gives the
   DB/reporting change its own Done-when and its own gate, the same way
   pl-49's own column set got one.
2. Fold it into this branch now. Cheap in isolation, but widens this ticket
   past its own Build section and its own Done-when, on a scope question its
   filing did not raise.
3. Leave it unrecorded — nobody asked for the report to carry it yet, and
   `RunUsage.thinkingTokens` is available in-process (e.g. to a caller that
   wants it before it is ever persisted) regardless of whether the DB stores
   it.

### 2026-09-19 — gate round 1 repaired

Repaired the gate's high, both meds (one closed, one left open by
instruction) and both lows, at `7f3aa55`:

- **High (pl-49's citations moved)** — re-pointed the 7 anchors
  `citations-gate.mjs` found moved in
  `tools/planner/docs/work/pl-49-what-a-run-costs.md`, to their current lines.
- **Med (thinking/output scope within a reply)** — rewrote the doc comments
  in `ModelUsage` (`agent/src/provider.ts`), `RunUsage.thinkingTokens`
  (`agent/src/orchestrator.ts`) and `usageOf` (`agent/src/providers/anthropic.ts`)
  to say plainly that the SDK does not state whether the top-level
  `output_tokens_details` a reply carries spans every attempt or only the
  serving one — recorded as unmeasured above and in pl-40's Log, rather than
  asserted.
- **Med (null-arithmetic partial sum)** — left untouched, on the gate's own
  instruction not to change `add()` or `RunUsage`'s shape before the
  orchestrator answers the open decision it raised (see below).
- **Low (stale SDK coordinates)** — `BetaOutputTokensDetails` above now cites
  `2998-3010` (the field is at 3009); added a correction note to pl-40's new
  2026-09-19 Log entry pointing at its 2026-09-18 entry's `:2899`
  misattribution, without editing that shipped entry.
- **Low (no explicit-`null` fixture)** — added a test at the very end of
  `anthropic-provider.test.ts` (after every describe and every helper
  function, so no already-merged citation moves again) that sets
  `output_tokens_details: null` explicitly and asserts `thinkingTokens` is
  `null`. The `?? 0` mutation now turns 5 of 33 tests red (was 4 of 32).

Verified: `node scripts/citations-gate.mjs --against origin/main` — 89
enforced, 0 failing; `npm run check` — exit 0; `npm test -- --project
planner` — 71 files, 1185 tests, all passing; re-ran the red proof against
the repaired tree (`thinkingTokens` forced to `null`, then to `?? 0`) and
both mutations failed as expected, restored clean afterward.

**Second open decision, raised by the gate and confirmed independently: does
`addReplyUsage`'s null-skipping sum correctly represent a run that mixes a
reply with no reported thinking and one that reports some?** Reproduced the
gate's own repro (`node --import tsx --input-type=module -e "..."` summing a
`null`-thinking reply with a `1390`-thinking reply): the total reads
`thinkingTokens: 1390`, indistinguishable from a run whose only reply thought
1390 tokens — a lower bound presented as a total, with no signal that
coverage is partial. This mirrors pl-49's cache-kind nulls in shape but not in
cause: those are per-provider (all-or-nothing), while this one is per-reply
within one provider (adaptive thinking, and whether the API ever sends a
literal `0` rather than omitting the breakdown is itself unmeasured — every
fixture here is hand-written). Options, sent to the orchestrator by the gate:
document the summed field as a lower bound; null the sum once coverage is
known incomplete; or carry a coverage count alongside it. Left unresolved in
code per the gate's explicit instruction; whichever remedy the orchestrator
picks needs its own test for a mixed-`null` run before this closes.

### 2026-09-19 — gate round 2: CONCERNS, `## Review` committed

The gate re-read the repair diff in full (7 files, 0 new findings) and came
back `CONCERNS`: every gate-1 finding closed except the null-arithmetic med,
which stays open on the orchestrator's decision above. The gate re-pointed
four of gate 1's own source coordinates to where the round-1 repair moved
them (`provider.ts` 90→95, `anthropic.ts` 368/370→373/375,
`orchestrator.ts` 212→218) and said so in Gate 1's header, then sent the
combined Gate 1 + Gate 2 `## Review` text above for this ticket to carry
verbatim.

**Every citation in that section was re-resolved against this tree before
committing** (`sed -n '<line>p' <file>` on all 17 anchored citations,
one at a time) rather than trusted on the gate's word — all 17 matched
exactly, so the section above is transcribed **unchanged** from what the
gate sent. Nothing here differs from its text.
