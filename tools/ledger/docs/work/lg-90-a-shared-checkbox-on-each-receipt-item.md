---
id: lg-90
tool: ledger
title: A shared checkbox on each receipt item, and a picker for whose it is once unchecked
kind: work-package
status: ready
milestone: null
depends_on: [lg-89]
difficulty: standard
---

# lg-90 — A shared checkbox on each receipt item, and a picker for whose it is once unchecked

## Why

Today a person leaves an item out of the shared amount by tapping a button that
cycles through three states: shared, not shared, someone else's
(`web/src/receipts/Receipts.tsx`, `NEXT_SHARE`). On a phone, with twenty items,
it is hard to scan which items are left out. And reaching "someone else's"
takes two taps through "not shared". The owner asked on 2026-11-01 to be able to
"uncheck some items of the receipt list so these items are not part of the
total to share".

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`: a checkbox, or keep the cycling button?
**Chosen: a checkbox plus whose.** Each item gets a `Shared` checkbox, checked
by default. Unchecking it shows a choice of **mine** (`not-shared`, it stays
with whoever paid) or a person (`theirs`, a charge to them). The other option
was to keep the three-way button.

## Build

This is web only. `ItemShare`, `chargedTo` and `splitReceipt` do not change.
The screen maps onto them exactly as the button does today.

1. In `web/src/receipts/Receipts.tsx`, replace the share button with:
   - a checkbox, `aria-label` "`<item>` is shared", checked when `share` is
     `shared`;
   - once it is unchecked, one `select` labelled "Whose is `<item>`". Its first
     option is **Mine** (`not-shared`), followed by each other current member
     (`theirs`, with that `chargedTo`). With one other member, that is two
     options; with several, the select replaces today's separate `several`
     picker.
   - Checking the box again sets `share: "shared"` and `chargedTo: null`.
2. Unchecking defaults the select to **Mine**. A charge to someone is always
   the person's choice, never a default.
3. The live line "Not shared · `<name>` · Shared" stays, computed by
   `splitReceipt` as it is now. Each unchecked item shows what it takes off
   (price, deposit, rebate from lg-89, and taxes, through `sharedAmount` on that
   item alone), so the person can see why the total moved.
4. Leave the joint-row refusal (`fileAs`, "A receipt on a joint-account row is
   shared whole") as it is. lg-91 changes it.
5. Drop `NEXT_SHARE` and `nextShare`. Rewrite the web tests that tap the button
   (`web/test/receipts.test.tsx`, `generated-ids.test.tsx`) to use the checkbox
   and the select. Keep what they assert about the split.
6. Update `e2e/layout.spec.ts`'s receipt case so it unchecks an item and opens
   its select at 360 px, and the page must not scroll sideways.

## Done when

1. A web test unchecks an item and proves the item is `not-shared` and the
   split moves by that item's cost. It then picks a person and proves `theirs`
   with that `chargedTo` reaches `fileReceipt`'s request. Checking the item again
   proves it is back to `shared` with `chargedTo: null`.
2. A web test proves that an unchecked item on a household of two offers Mine
   and the one other person, and on a household of three offers Mine and both
   others.
3. A web test proves each unchecked item shows what it takes off, and the sum
   shown matches the "Not shared" and charge totals for one person's items.
4. `e2e/layout.spec.ts` covers an unchecked item with its select open at 360 px
   and 1280 px, with no horizontal page scroll.
5. `npm run check`, `npm test -- --project ledger` and `npm run e2e:ledger` pass.

## Log
