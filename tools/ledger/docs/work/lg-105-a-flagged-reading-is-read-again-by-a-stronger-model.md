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
     proposals carrying `items-differ`, or else fewer flags in total. Otherwise
     keep the first. Compare whole readings, never mix proposals from the two:
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
- A test with an escalation reading that is no better (same or more flags)
  shows the first reading is returned, with `model` naming the first model.
- A test with a first reading that adds up shows the escalation reader is never
  called.
- A test with an escalation reader that throws shows the first reading is
  returned and the failure is logged, with no credential in the log line.
- A test with `RECEIPT_ESCALATION_MODEL` set empty shows no second reader is
  built and a flagged reading is returned as read.
- `npm run check` and the ledger suite pass.

## Log
