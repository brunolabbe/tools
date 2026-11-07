---
id: lg-102
tool: ledger
title: Say who paid and whose each receipt is from the queue, and file several at once
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-102 — Say who paid and whose each receipt is from the queue, and file several at once

## Why

After lg-92, a batch of photos is read into a queue, but each receipt still has
to be opened, checked and filed on its own with "File as Bruno's line". For a
batch where most receipts are ordinary shared groceries, that is a tap-through
per receipt. The owner (2026-11-03): "it should be easier to assign each
receipt to a person, instead of having to open every receipt and confirm the
person… we should also find a way to attribute batch receipt easily".

Three more things from the same report:

- **The receipt view files.** The owner wants it to be where a receipt is
  corrected, with filing done from the list.
- **"This was Vanessa's" reads as nothing.** It files the whole receipt as the
  other member's, a charge they owe in full (`destination.chargedTo`,
  `Receipts.tsx`). The label does not say that, and the owner could not tell
  what it did.
- **The payer is always whoever uploaded the photo** (`fileReceipt` passes
  `receipt.uploaded_by` to `fileLines`). The owner photographs receipts that
  the other member paid for.

## Decision — answered 2026-11-03 by the owner

Asked through `AskUserQuestion`.

1. What the list picks per receipt:
   - Whose it is only, with the payer still the uploader.
   - **Who paid, and whose it is (chosen).** Changes the contract.
2. How far "automatically save changes" goes:
   - Saved to the server as drafts, surviving a closed tab.
   - **For this visit only (chosen).** Edits survive going back to the list,
     but leaving the receipt screen still loses unfiled readings, as lg-92 says.
     No server storage.

## Build

This is a change to `@ledger/contract`, approved in this shape. A different
shape is a stop and a question.

1. **`@ledger/contract`** (`contract/src/receipts.ts`). The `line` destination
   gains `paidBy: string | null`: the member whose line it is, `null` meaning
   whoever uploaded the photo, so a request that omits it parses as before
   (`.nullable().default(null)`). Update `ReceiptDestination`'s comment:
   `chargedTo` names anyone but the payer, who is now `paidBy ?? uploader`.
2. **`api/src/receipts.ts`.** `fileReceipt` resolves the payer once
   (`paidBy ?? receipt.uploaded_by`) and uses it everywhere `uploaded_by` is
   used today, in `chargedToOf`'s "the other member" and in `fileLines`.
   `paidBy` must name a **current** member (refuse anyone else with the code
   the API already uses for an unknown or departed person; if none fits, stop
   and say so). `chargedTo` equal to the payer is refused as today. A
   `not-shared` item stays with the payer. Add tests at the end of their suites,
   including a filing whose `paidBy` is not the uploader and a request with no
   `paidBy` filing exactly as before.
3. **The queue** (`web/src/receipts/Queue.tsx`). Each read receipt's row gets
   two selects:
   - **Paid by**: each current member, then **Joint card**. It defaults to the
     uploader.
   - **Whose**: **Shared**, then for each member other than the payer
     "`<name>`'s — owes all of it". It defaults to Shared and is disabled, with
     a hint, for Joint card, where whose each item is stays item by item
     (lg-91).

   Each row also gets a checkbox, the list a **Select all**, and a bar that sets
   Paid by and Whose on every selected row and has **File selected**. Filing a
   row uses its picks and the reading as last edited, through the same
   `fileReceipt` request the form sends today. For Joint card it looks up
   matching rows and attaches when exactly one matches; with none or several,
   the row stays unfiled and says "Open it to choose the row".

4. **What batch filing refuses.** A row is not filed, and says why on the row,
   when the screen would refuse it opened: items that do not add up, a missing
   date or amount charged, an item charge with nobody chosen, or Taxable marks
   that do not give the printed taxes where they move money (an item left out,
   or a joint-account row's items in several categories: `TAXABLE_MATTERS`,
   from PR #748). The other
   rows still file. Filing goes one receipt at a time, and each row shows
   filed or its error as it comes back. No progress is faked.
5. **The receipt view** (`web/src/receipts/Receipts.tsx`) becomes the place to
   correct a receipt. It shows the same Paid by and Whose selects at its top,
   bound to that row's picks, since the item controls depend on them (Joint
   card turns `not-shared` items to charges, `payJointly`). It loses "File as
   …'s line", the "This was …'s" checkbox, the whole-receipt "Whose it was"
   select and the "Paid with …" buttons. Their meaning moves into the two
   selects. "Back to the queue" keeps the edits. The view keeps one **File
   it** button for a receipt that needs the row picked by hand (Joint card,
   several matches), which shows today's "Attach to this row" list.
6. **Edits are kept for the visit.** The queue holds each receipt's last-edited
   draft and picks, keyed by photo and part, in the screen's state. Leaving the
   screen loses them, as lg-92's notice beside **Read all** says. Keep that
   notice true.
7. **`e2e/layout.spec.ts`**: the queue with selects and checkboxes at 360 px and
   1280 px, with no horizontal page scroll.

lg-101 touches the read route and the reader, not these files. Build it first
if both are dispatched, since batch filing is of little use while rebate
receipts are refused.

## Done when

1. An `api` test proves a filing with `paidBy` naming the other member makes
   that member's line, and a `not-shared` item stays with them. Another proves a
   departed or unknown `paidBy` is refused, and a request with no `paidBy` files
   as before.
2. A web test proves that setting Paid by and Whose on three selected rows and
   tapping **File selected** sends three filings with those destinations, one
   at a time, and marks each row filed.
3. A web test proves that a row whose items do not add up is not filed and says
   why, while the other selected rows file; another proves the same of a row
   whose Taxable marks are held (Build 4).
4. A web test proves Joint card attaches on exactly one match and leaves the row
   unfiled with "Open it to choose the row" on two.
5. A web test proves an edit made in the receipt view is still there after
   "Back to the queue", and is what the batch files.
6. A web test proves the receipt view has no line-filing button and no "This
   was …'s" checkbox.
7. `e2e/layout.spec.ts` covers the queue's new controls at 360 px and 1280 px.
8. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Log

### 2026-11-03 — filed (Claude Opus 5.5)

Filed from the owner's report on the receipt screen, with lg-101. Keeping edits
for the visit was going to be a third ticket. It is folded in here, because
filing from the list is what needs the edits kept, and it has nothing left to
decide on its own.

- 2026-11-03 — Build 4 and Done when 3 now name the Taxable hold that PR #748
  added to the receipt screen after this ticket was filed. Its gate found a batch
  built from the brief as written would file what the opened form refuses.

### 2026-11-07 — built (Claude Opus 5.5, builder)

Built on `1eafa0c6`. Every step of the Build is in; the gate is pending.

- **Contract and API (Build 1, 2).** The `line` destination has
  `paidBy: string | null`, `.nullable().default(null)`. `fileReceipt` resolves
  the payer once (`payerOf`) and hands it to `chargedToOf` and `fileLines`.
- **The code for an unknown or departed `paidBy` is `BAD_REQUEST`.** The
  dispatch named `PERSON_NOT_FOUND` as a candidate. It is not the code this path
  uses: `fileReceipt` already refuses a person it cannot take with
  `BAD_REQUEST`, through `requireKnownPerson` ("That person is not one of the
  household.") and `requireRowItems` for a departed member on a row. Its message
  is also wrong for a departed member, who was added: "That person is not one
  this household's members have been added as." A name the books never held
  gets `requireKnownPerson`'s message. A member who has left gets "Whoever paid
  is a current member of the household." No code was added and the taxonomy is
  unchanged.
- **The web.** `web/src/receipts/filing.ts` is new. It holds the draft, the two
  picks and `receiptState`, which the form and the batch both read, so a row in
  the list is held for exactly what its opened form holds (`refusal`). The queue
  (`Queue.tsx`) keeps each receipt's draft and picks by photo and part
  (`entries`). It files the selected ones one at a time, and each row says
  `Filing…`, `Not filed: <why>`, or filed with what it became.
  `Receipts.tsx` reads and writes the queue's entry, so "Back to the queue"
  keeps the edits.
- **Changing who paid moves each item's choice with it** (`repick`). An item
  the old payer kept is charged to them, and one charged to the new payer
  becomes theirs to keep. To and from the joint card it does what lg-91's two
  buttons did. The item select's first option is "Mine" when the payer is the
  person who took the photo, and the payer's name otherwise.
- **`paidBy` is sent only when it differs from the uploader.** A receipt filed
  as before sends the request it always sent.
- **Joint card from the list.** The list looks up the rows. With one match it
  attaches. With none or several the row says "Not filed: Open it to choose the
  row." Opened, **File it** lists the rows.

What the brief had wrong or left open:

- **A receipt typed in had no way to be filed.** Build 5 removes the view's
  line button and Done when 6 forbids one, but a receipt typed in from a photo
  that was not read (or whose read failed) had no row in the list. Such a
  receipt is now a row in the list like a read one, from the moment it is
  opened. If it is left blank it is dropped on the way back, so an accidental
  "Type it in" does not block **Read all** for that photo. lg-92's "1 receipt
  typed in from this photo, filed." line is gone, because the row now says it.
- **The view's "said" line after filing moved onto the row.** It used to be an
  `<output>` above the list. With several receipts filed at once, one line could
  not say which receipt it meant. Every lg-8 to lg-94 web test that read it
  now reads the row.
- **The existing web tests filed from the form's "File as …'s line".** About 40
  of them now file from the list through one helper (`fileFromQueue`). They
  assert what they did before. A refusal they read as the form's alert is now
  the row's `Not filed:` line (`rowRefusal`). `generated-ids.test.tsx`'s receipt
  anchor is now the Whose option `Sam's — owes all of it`.
- `tools/ledger/CLAUDE.md` still says a line is "paid by **whoever uploaded the
  photo**". It is not edited here, since the Build does not name it. The report
  proposes the line. `docs/00-ANALYSIS.md` §6 says the same and is corrected.
