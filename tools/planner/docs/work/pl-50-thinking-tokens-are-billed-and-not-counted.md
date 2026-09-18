---
id: pl-50
tool: planner
title: The API reports how many billed output tokens were thinking; the seam drops it
kind: fix
status: ready
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

**The API reports it.** `@anthropic-ai/sdk@0.125.0`'s
`resources/beta/messages/messages.d.ts:2899` declares, on `BetaUsage`:

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
