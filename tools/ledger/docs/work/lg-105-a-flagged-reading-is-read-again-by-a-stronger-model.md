---
id: lg-105
tool: ledger
title: A reading the arithmetic flags is read again by a stronger model
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-105 — A reading the arithmetic flags is read again by a stronger model

## Why

The arithmetic check (`checkReceipt` in `books`, lg-8, lg-10, lg-26) catches a
misread: an item price a few cents off, or a rebate folded in or left out.
`items-differ` blocks filing, in the screen and in the API
(`RECEIPT_DOES_NOT_ADD_UP`). What happens next is manual. A flagged reading
reaches the person, who finds the wrong line on the photo and corrects it by
hand. Nothing hands the reading back to a model.

The owner reports (2026-11-09) that this happens often enough to matter: some
receipts have their rebates placed correctly and some do not, and some have an
item a few cents off. The check flagged each one, and the owner fixed them by
hand. The check works; the cost is the manual correction afterwards.

## Decision — answered 2026-11-09 by the owner

Asked through `AskUserQuestion`: what should happen to a reading flagged
`items-differ` (or another arithmetic flag) before the person sees it?

- Haiku re-reads once, told the gap the check found. One more Haiku call per
  flagged read; keeps lg-8's Haiku-only choice.
- **A stronger model (Sonnet) re-reads the photo (chosen).** Probably more
  accurate per retry, costs several times more per retry, and amends lg-8's
  choice of Haiku as the only reader (2026-10-12).
- Haiku re-reads with the gap, then Sonnet if it still does not add up: most
  accurate, but two mechanisms to build and measure.
- Keep it manual.

This amends lg-8 rather than replacing it: Haiku still reads first and every
receipt that adds up is read once, by Haiku alone.

## Build

1. **`api/src/config.ts`.** Add `RECEIPT_ESCALATION_MODEL` to
   `ReceiptReaderConfig` as `escalationModel: string | null`, defaulting to
   `claude-sonnet-5-5` (export the default from `@ledger/receipts` beside
   `DEFAULT_RECEIPT_MODEL`). An empty value turns escalation off, so the owner
   can go back to Haiku alone without a deploy. Document it wherever
   `RECEIPT_MODEL` is documented (grep for it: the README, the compose file, the
   setup docs).
2. **`api/src/server.ts` (or wherever the reader is built).** Build a second
   reader with `createModelReader` and the escalation model, when one is
   configured. Same key, same options. `receipts/src/reader.ts` does not change:
   the reader stays "reads, and does nothing else". The decision to read again
   belongs to `api`, which already owns the check.
3. **`readReceipt` in `api/src/receipts.ts`.** After the first reading is
   repaired and checked as today, escalate when **any** proposal carries a flag
   from `RECEIPT_FLAGS`. Read the whole photo again with the escalation reader,
   with the same offered categories, then repair and check that reading exactly
   as the first.
   - **Keep the escalated reading only if it is strictly better**: fewer
     proposals carrying `items-differ`, or, when those are equal, fewer flags
     in total; and never a reading with fewer proposals than the first (the
     owner's answer of 2026-11-10, in the Log). Otherwise keep the first. Compare whole readings, never mix proposals from the two:
     a photo holding two receipts may come back in a different order or count,
     and matching proposals across readings is a guess.
   - **One escalation, never a loop.** A reading that is still flagged goes to
     the person, as it does today.
   - **An escalation that fails** (timeout, unreachable, busy, refused) keeps the
     first reading and logs the failure through the existing logger, with the
     usual redaction. The person must not lose a reading Haiku already
     answered because Sonnet failed.
   - `signal` is passed to both reads, so a person who hangs up stops either.
4. **`ReadReceiptResponse.model`** already names the model whose reading is
   returned. Set it to the escalation model when its reading is kept. The
   screen says the photo went to that model, which is now true of both.
   **Trap:** the upload answer's `reader` (`UploadedReceipt`) names the one
   model the photo _will_ go to, before the person asks for a read. With
   escalation the photo may go to two. Saying both needs a contract field,
   and changing `@ledger/contract` means stopping to ask the owner. Whether
   the screen's sentence must name the second model is that question; until
   it is answered, word the screen's existing sentence so it stays true
   ("read by Claude"), if that needs no contract change.

   **Answered 2026-11-10 by the owner, at intake** (relayed in the builder's
   dispatch). The question: the upload answer's `reader` names the one model
   the photo will go to, but with escalation a flagged photo goes to two; how
   should the screen handle that?
   - **Reword the screen's existing sentence to "read by Claude". No contract
     change; the response's `model` still names the model whose reading was
     kept (chosen).**
   - Add a contract field to `UploadedReceipt` naming the escalation model, so
     the screen can say both.
   - Leave the sentence naming the first model only.

   So `@ledger/contract` is not changed. The "until it is answered" above is
   superseded by this answer: the rewording is the decision, not a stopgap. If
   the rewording turns out to need a contract change, the build stops and
   reports it as an open decision.

5. **Timeout.** Two reads can take twice as long. The route's own timeout, if
   there is one above the reader's per-attempt `DEFAULT_READ_TIMEOUT_MS`, must
   leave room for the second. Measure it: find what stops the request, rather
   than assuming there is nothing.

**Not in scope.** A rebate folded into the wrong item still adds up, so nothing
here escalates it; only the person catches it (`reader.ts`'s header says so).
Do not escalate on anything but a flag.

## Done when

- A test in `api/test` with a fake first reader that answers a reading flagged
  `items-differ` and a fake escalation reader that answers one that adds up
  shows the response carries the escalated reading, with no flags, and
  `model` naming the escalation model.
- A test with an escalation reading that is no better (no fewer `items-differ`
  proposals, and no fewer flags when those tie) shows the first reading is
  returned, with `model` naming the first model.
- A test with a first reading that adds up shows the escalation reader is never
  called.
- A test with an escalation reader that throws shows the first reading is
  returned and the failure is logged, with no credential in the log line.
- A test with `RECEIPT_ESCALATION_MODEL` set empty shows no second reader is
  built and a flagged reading is returned as read.
- `npm run check` and the ledger suite pass.

## Log

### 2026-11-10 — build (builder, Opus 5.5)

Built on `a100f429`. Steps 1–5 are in place, with the owner's answer above for
step 4: `@ledger/contract` is not changed.

- **Step 1.** `RECEIPT_ESCALATION_MODEL` → `ReceiptReaderConfig.escalationModel`,
  `DEFAULT_ESCALATION_MODEL = "claude-sonnet-5-5"` exported from
  `@ledger/receipts` beside `DEFAULT_RECEIPT_MODEL`. Unset is the default and
  empty (or blank) is `null`, unlike every other variable in `config.ts`, where
  blank is unset. Documented in `tools/ledger/.env.example` and in the root
  `docs/02-DEPLOYMENT.md` table, the two places `RECEIPT_MODEL` is. **The
  brief named a compose file and a README: neither names `RECEIPT_MODEL`.**
  `compose.ledger.prod.yaml` passes only the key, and the deployment doc says
  the other rows go in an override file, so the new row follows it.
- **Step 2.** Built in `api/src/server.ts` (`receiptReadersFor`) with the same
  key, logger and options; only `model` differs. `receipts/src/reader.ts` gains
  only the constant: the reader is unchanged. **Built from configuration only
  when the first reader is**: beside a handed-in `receiptReader`, the
  escalation is `escalationReader` or none, so a test that hands in a fake
  reader and a key (`receipts.test.ts`'s "what is logged" does) cannot build a
  real Sonnet reader by accident. Two test-only options, `modelReader` (the
  factory, `createModelReader` by default) and `receiptReadDeadlineMs`.
  `api/test/helpers/no-model-environment.ts` clears `RECEIPT_ESCALATION_MODEL`
  from the host too.
- **Step 3.** `readReceipt` reads again when any proposal carries any flag, with
  the same categories and the same repair and check, and keeps the second
  reading only when `isBetter` says so. **The brief's rule, applied as written,
  keeps a reading that dropped a receipt**: an empty reading ("not a receipt")
  has no flags, and a reading of one receipt out of two has fewer. `isBetter`
  never keeps a reading with fewer proposals than the first. The builder
  reported it as an open decision, and the owner answered it (below). The
  failure log line is
  `warn "a flagged receipt was not read again; the first reading is kept"`
  with `model`, `code` (`AppError.from(error).code`) and `outOfTime`. It holds
  no message, cause, URL or header, so `redactHeaders` and `redactUrl` have
  nothing to redact.
- **Step 4.** `model` names the escalation model when its reading is kept. The
  screen's sentence now reads "where it is read by Claude." / "where they are
  read by Claude, one at a time." The upload's `reader` still decides whether
  the offer shows. **The brief says "the screen says the photo went to that
  model"**: no screen reads `ReadReceiptResponse.model` (`grep -rn "\.model"
  tools/ledger/web/src` → nothing), so only the upload's sentence named a
  model.
- **Step 5, measured.** Nothing in the API stops a slow read. The scratch run
  (`what-stops.mts`: the app listening, a fake reader answering after 130 s,
  Node's `fetch`):
  `server timeouts (ms): requestTimeout=0 headersTimeout=60000 timeout=0 keepAliveTimeout=72000`
  then `read 200 after 130.0 s`. `headersTimeout` bounds only the request's
  own headers. The web's `requestJson` sets no timeout. What stops it is the
  edge. `docs/02-DEPLOYMENT.md` says Cloudflare answers `524` to an origin
  silent for 125 s, and keeps the downloader's wait under 100 s. The
  Cloudflare docs did not load here (WebFetch failed on both pages), so that
  figure is the repo's, not re-measured. The first read is already up to
  3 × 60 s per lg-8's gate, which is unchanged. The second read is therefore
  given `READ_DEADLINE_MS = 100_000` from the route's start, minus what the
  first took. A second reading still going then is aborted, and the first
  reading is answered (`outOfTime: true` in the log line).
- **A defect the tests found in the build itself:** `AbortSignal.timeout`
  refuses a fractional delay. The first cut passed
  `deadline - performance.now()` straight in, and every escalating read
  answered 500, losing the first reading. The delay is now floored. Everything
  the second reading takes is inside its `try`, so nothing it throws can cost
  the first reading again.

Tests: `tools/ledger/api/test/receipt-escalation.test.ts`, 13 tests: one per
Done-when line, plus the deadline, both signals, the factory's "same key and
options", "nothing built beside a handed-in reader", and `isBetter`. In
`web/test/receipts.test.tsx`, the two assertions that read the model's name in
the sentence now read "read by Claude".

Fold-in: none was free. The ledger `CLAUDE.md`'s "the screen names the model
beside that button" (Rules, receipts paragraph) and "Claude Haiku 5.5 through
Anthropic's SDK" (Layout) are now stale. A `CLAUDE.md` is edited only when the
Build names it, so both are proposed to the orchestrator instead.

### 2026-11-10 — owner's answers after gate 1 (recorded by the fixer, Sonnet 5.5)

Three questions, answered by the owner on 2026-11-10 and relayed in the fixer's
dispatch.

1. **Gate 1, F1: which criterion ranks first in `isBetter`?** `isBetter` counts
   the proposals carrying `items-differ` before it counts flags in total, and no
   test asserted the order; Done when 2's parenthetical read as total flags
   only. Options: **A, keep the order (`items-differ` first), reword Done when
   2, add two assertions (chosen; the gate's recommendation)**; B, total flags
   only, which drops a second reading that clears the filing blocker but adds
   two other flags; C, either criterion wins (`a || b`), which keeps a reading
   that adds a blocking proposal when its total is lower. Done when 2 and Build
   3 now say the order; the assertions are in the next entry.
2. **The builder's open decision: a second reading with fewer proposals than
   the first.** Read as written, Build 3 keeps it whenever it has fewer flags,
   and an empty reading ("not a receipt") has none. Options: **1, never keep a
   second reading with fewer proposals (chosen; the builder's recommendation,
   already built)**; 2, the brief literally; 3, require the same count. So
   this is the owner's answer, not "the builder's call" as the build entry first
   wrote it; Build 3's "or else fewer flags in total" is corrected to say what
   is built.
3. **`tools/ledger/CLAUDE.md`'s receipts paragraph, stale after the build.**
   Options: **the lander or this branch edits it (chosen)**; the owner edits it;
   file a ticket. The owner authorised that one sentence ("and the screen names
   the model beside that button"), which now reads that the screen says the
   photo goes to Anthropic to be read by Claude, and that a flagged reading is
   read again, once, by `RECEIPT_ESCALATION_MODEL`. Nothing else in any
   `CLAUDE.md` changed, so the Layout line "Claude Haiku 5.5 through
   Anthropic's SDK" the build entry named stays as it was.

### 2026-11-10 — gate 1 findings applied (fixer, Sonnet 5.5)

- **F1** (`isBetter`'s order). `TAX_OFF` (two flags, none `items-differ`) joins
  the fixtures, and "fewer proposals that block filing outranks fewer flags in
  total" asserts both directions: `TAX_OFF` over `CENTS_OFF` is kept, the
  reverse is refused. Mutants run with gate 1's `mutate.mjs` on the committed
  tree, 1 of 15 failing each: total flags only, `a || b`, and flags first.
- **F2** (`left <= 0`). A first reader that answers a flagged reading after
  120 ms against a 50 ms deadline: the second reader is called 0 times, the
  first reading is answered, and the one `was not read again` line carries
  `outOfTime: true` and no `code`. Deleting the branch fails it (1 of 15): the
  second reader is then asked.
- **F4** (stale headers). `Receipts.tsx` and `receipts/src/reader.ts` no longer
  say the screen names one model or that Haiku reads alone. The
  `@ledger/contract` comments are untouched, as the owner's answer of
  2026-11-10 covers them.
- **F6.** The owner's answer on fewer proposals is above, and Build 3 says what
  is built.
- Not this round, left as gate 1 wrote them: no minimum time for the second
  read, and the escalation default being Sonnet when `RECEIPT_MODEL` is Sonnet.

### 2026-11-10 — owner's answer at the landing (recorded by the lander, Sonnet 5.5)

- **The Layout line of `tools/ledger/CLAUDE.md`: does the lander add the second
  model?** Options: **add "and Sonnet 5.5 for a flagged reading (lg-105)" after
  "Anthropic's SDK" (chosen, the orchestrator's recommendation)**; leave the
  line as it was. The owner's answer, 2026-11-10, relayed in the lander's
  dispatch. Only that sentence changed, re-wrapped; the entry above that said
  the Layout line stays is superseded by this answer.
- 2026-11-10 — Fixed at landing by owner choice: the Layout line of `tools/ledger/CLAUDE.md`
  naming Sonnet 5.5 for a flagged reading. `git diff c7767dd8 HEAD -- tools/ledger/CLAUDE.md | grep -v 'Fixed at landing' | grep -c '^+.*Sonnet 5.5 for a flagged reading'` → 1.
