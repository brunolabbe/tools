---
id: lg-92
tool: ledger
title: Upload several receipt photos at once, and confirm them from a queue
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-92 — Upload several receipt photos at once, and confirm them from a queue

## Why

The receipt screen takes one photo at a time (`web/src/receipts/Receipts.tsx`,
a `type="file"` input with `capture="environment"` and no `multiple`). One
photo can already hold up to `MAX_RECEIPTS_PER_PHOTO` (10) receipts side by
side, each filed as its own `part`. But lg-8 measured only two side by side,
and long grocery receipts placed next to each other get small in the image. The
owner asked on 2026-11-01 to read "a bunch of receipts at the same time", for
example a week's worth after shopping.

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`. **Chosen: build multi-photo upload.** The other
options were to first measure several long receipts in one photo with a paid
read, and to leave it as it is.

## Build

This is web only. The contract and the routes do not change. Each photo goes
through the same three routes as today:

1. `POST ROUTES.receipts` to upload;
2. `POST ROUTES.receiptRead` to read;
3. `POST ROUTES.receiptFile` to file each part.

The fact that shapes the build: **reads are rate-limited to 5 a minute per
person** (`rateLimitReceiptReadsPerMinute`, `api/src/config.ts`, the paid
route's own bucket, lg-8 gate 1, F4). A batch of twelve would get 429s. Do not
raise the limit to fit the batch. It is the cap on what a person can spend.

1. Add a second input that takes several photos (`multiple`, no `capture`, so
   a phone opens its gallery). The camera input stays as it is.
2. Check each photo's size before upload, as today. One that is too large is
   listed as refused, and the rest go on.
3. Upload the photos one at a time. As today, a photo leaves the house only on
   the person's tap: show one **Read all** button with the same notice naming
   the model.
4. Read the photos **one at a time**. On a 429, wait as long as the response's
   `Retry-After` header says, then go on. Show "`n` of `N` read". That count
   is real, so it is not faked progress. A read that fails stays in the queue
   with a retry button and does not stop the others.
5. The queue lists every receipt each photo produced (a photo can produce
   several parts). Opening one shows today's confirmation form, unchanged,
   including lg-89 and lg-90's item controls once those have landed. Filing it
   returns to the queue and marks it filed. Nothing is filed without the
   person's tap on that receipt, as today.
6. The queue lives in the screen's state. Leaving the screen loses the
   unfiled readings, but not the photos, which are stored. Say so beside
   **Read all**. Bringing back stored, unread photos is not part of this ticket.
7. `e2e/layout.spec.ts`: a case with a queue of several receipts at 360 px and
   1280 px.

If lg-90 has merged when this is built, rebase onto it, since both touch
`Receipts.tsx`. Neither changes the other's logic.

## Done when

1. A web test selects three photos and proves three uploads and, after
   **Read all**, three reads, one at a time. Nothing is read before the tap.
2. A web test proves that a 429 with `Retry-After` on the second read delays
   that read and does not drop it, and the count reaches "3 of 3 read". Use
   fake timers, not a real wait.
3. A web test proves that a read failing for another reason leaves that photo
   with a retry and the others read.
4. A web test proves a photo of two receipts gives two queue entries, and
   filing one marks only that one filed.
5. `e2e/layout.spec.ts` covers the queue at 360 px and 1280 px with no
   horizontal page scroll.
6. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Log

2026-11-01, builder (Sonnet 5.5), branch `lg-92-multi-photo-queue`, stacked on
lg-89's landed head `54df4ee6` (PR #717): web only, as the Build says. The
contract and the routes did not change.

- **Where it lives.** `web/src/receipts/Queue.tsx` holds the queue (a hook,
  `useReceiptQueue`, and its view); `Receipts.tsx` gained a `queue` stage and a
  second input, "Choose several photos" (`multiple`, no `capture`), on the photo
  step. The queue's state is the hook's, held by `Receipts`, so it survives
  opening a form and coming back; `Start over` clears it. The form is today's,
  with lg-89's Rebate input untouched; from the queue its last button reads
  "Back to the queue" instead of "Start over", and filing returns to the list
  with that receipt marked "filed".
- **The brief's `Retry-After` header was not reachable from the screen.**
  `requestJson` threw an `AppError` that dropped the response headers. The
  server sends the same number in the body (`details.retryAfterSec`,
  `rate-limit.ts`), but the Build says the header, so `client.ts` now puts the
  header's seconds into `details.retryAfterSec` of a `RATE_LIMITED` error, over
  the body's copy, and the queue reads that. A wait is held between 1 and 120 s,
  and 15 s with no usable number; five waits in a row on one photo and the read
  is reported failed, with its retry. Not a contract or route change.
- **Upload failures** are listed with the oversize photos as left out, rather
  than kept in the queue: the file is not held for a retry, and choosing it
  again is the retry. The Build named only the size check.
- **Existing e2e case changed.** `Receipt fits a phone and a desktop, with a
  photo kept and an item typed` found its file input with
  `input[type="file"]`, which the screen's second input made ambiguous; it now
  asks for it by the camera label.
- **Not folded in:** nothing else already specified became free. lg-90 and lg-91
  (per-item checkbox, leaving an item out of a joint row) are unbuilt and wait
  on lg-89's merge; their item controls were left alone.

Proof, from the worktree root (`/tmp/.../lg-92/build/` holds the logs):

- `npx vitest run tools/ledger/web/test/receipts.test.tsx`: 33 of 33 (28 before
  this change; the five new are at the end of the file: the four below and a
  size-limit one).
- Done when 1: "three photos go up one at a time and nothing is read before Read
  all, then three reads, one at a time": three uploads in selection order, no read
  before the tap, reads `[11, 12, 13]`, at most one in flight.
- Done when 2: "a 429 with Retry-After delays that read, drops nothing, and the
  count reaches 3 of 3": fake timers; 7 s wait, still two calls at 6,999 ms,
  reads `[11, 12, 12, 13]` at 7,000 ms, "3 of 3 read".
- Done when 3: "a read that fails for another reason keeps that photo with a
  retry and reads the rest": "2 of 3 read", the failure shown, `Try again` reads
  that photo alone, "3 of 3 read".
- Done when 4: "a photo of two receipts gives two entries, and filing one marks
  only that one": one `file` request with `part: 1`, the other still a button.
- `npx vitest run tools/ledger/web/test/client-retry-after.test.ts`: 3 of 3 (the
  header over the body's copy; no header keeps the body; a 500 is given no wait).
- `npx vitest run tools/ledger/web`: 316 of 316 in 25 files.
- Done when 5: `E2E_PORT=8392 npm run e2e:ledger`: 30 passed, exit 0, including
  `the receipt queue fits a phone and a desktop, kept and then read` at the end
  of the suite, which measures the queue before a read and after one (four
  photos with 70-character names, a 55-character merchant) at 360 and 1280 px.
  The 360 px screenshots were opened: names wrap, buttons stay inside the card.
- Done when 6: `npm run check` exit 0. `npm test -- --project ledger` was not run
  whole on this first build (CI runs it on the draft); the web project is the
  316 above.
