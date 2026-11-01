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
