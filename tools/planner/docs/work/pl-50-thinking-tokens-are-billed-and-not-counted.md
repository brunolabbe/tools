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
   `BetaOutputTokensDetails` (`node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:2998-3007`)
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
