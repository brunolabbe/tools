---
id: lg-89
tool: ledger
title: Fold a rebate into the item it reduces, wherever it is printed
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-89 — Fold a rebate into the item it reduces, wherever it is printed

## Why

A receipt's rebate (`RABAIS`, `ÉCONOMIE`, a coupon) is read today as an item of
its own with a negative price (`receipts/src/reader.ts`, `RECEIPT_PROMPT`: "A
discount is an item with a negative price"). It is linked to nothing. When a
person leaves an item out of the shared amount (lg-10), its rebate stays
shared unless they find the rebate's line and tap it too, so the shared part
is wrong by the rebate and the taxes on it.

The owner asked on 2026-11-01 for leaving an item out to take off the item's
price, its consigne, its taxes and the rebate applied to it, together. The
consigne already works that way: the reader folds it into the item it follows
(`ReceiptItem.deposit`). This ticket does the same for a rebate. Most rebates
are printed directly under their item, but not all of them, so the reader has
to match a rebate to its item by text or product code, not by position.

## Decision — answered 2026-11-01 by the owner

Asked through `AskUserQuestion`. When an item is left out, how should its
rebate follow?

- **Fold into the item (chosen).** The reader folds a rebate into the item it
  applies to, as it does with consigne, wherever the rebate is printed.
- Auto-follow on screen: rebates stay separate lines, and a negative line under
  an item follows that item's share. Web only, but it guesses the link from the
  order of the lines.
- Leave it manual.

The owner's follow-up: a rebate is seldom printed away from its item, so the
reader should be "somewhat intelligent or flexible" about where it is printed.
**A rebate the reader cannot place stays a negative item of its own**, as today.
It is shared by default and can be left out by hand, so it is never lost.

Taxes (the owner asked): a folded rebate follows its item's `taxable` mark. A
rebate on a taxable item lowers the taxed amount, and the taxes taken off with
the item are computed on its net price.

## Build

This is a change to `@ledger/contract`, approved in this shape. A different
shape is a stop and a question.

1. **`@ledger/contract`** (`contract/src/receipts.ts`). `ReceiptItem` gains
   `discount: number | null`, in cents, `null` when none is folded in. It is
   negative for a rebate on a purchase and has the opposite sign on a returned
   item. `price` stays as printed. The item's **net** is `price + (discount ?? 0)`.
   `receiptItemSchema` takes it as `cents.nullable().default(null)`, so a request
   that omits it parses as before. Update the comment on `price` ("A discount or
   a returned item is negative"): a discount that was folded in is no longer
   an item.
2. **`books/src/receipts.ts`.** Every place that reads an item's `price` for
   money reads its net instead: `itemsAddUp`, `itemsCost` (tax on the net when
   taxable), `taxableFits` (the taxable part is the taxable items' nets),
   `splitReceipt`'s nothing-shared test, and `splitByCategory`. A deposit is
   still untaxed. Add cases to `books/test/receipts.test.ts`, at the end of
   their suites (they are listed under Done when).
3. **`receipts/src/reader.ts`.** Change `RECEIPT_PROMPT` and the tool schema
   the reader asks for:
   - fold each rebate, coupon or price reduction into the item it applies to,
     matching by product code or by text when the rebate is not printed
     directly under its item;
   - several rebates on one item add up into its `discount`;
   - a rebate that applies to the whole receipt, or that cannot be placed with
     confidence, stays an item of its own with a negative price.

   Parse and bound `discount` as `deposit` is parsed. Add reader tests on
   recorded responses: a folded rebate, a rebate printed three lines below its
   item, and a whole-receipt rebate left as its own item.

4. **`api`.** Add a `discount_cents` column to `receipt_items` through a new
   migration in `api/src/db/schema.ts`, nullable, so filings already stored
   read back as `null`. `fileReceipt` stores the column and reads it back, and
   `receiptsOnRows` (`api/src/slices.ts`) passes it through to the split.
5. **`web/src/receipts/Receipts.tsx`.** Each item gets a `Rebate` input beside
   `Deposit`, which a person can correct, with the same parsing. The live split
   and the add-up hint use the net. Add a case to `e2e/layout.spec.ts` only if
   the item row's layout changes at 360 px; the extra input must not make the
   page scroll sideways.
6. **The measurement.** A prompt change is proven by a read, not by a recorded
   response. Build three synthetic receipt images:
   - a rebate directly under its item;
   - a rebate printed below other items, naming its item's product code;
   - a whole-receipt coupon.

   Keep them in `receipts/test/fixtures/` beside the existing ones. Reading them
   with the live model costs money, so it is **the owner's paid read**. Ask for
   it, do not run it. Record the command to run, and where the result goes, in
   the Log.

## Done when

1. `books/test/receipts.test.ts` proves a taxable item with a folded rebate,
   left out, takes off price + discount + deposit + GST and QST on the net. It
   also proves the shared amount plus what was left out still equals what was
   paid, on at least one receipt where the rebate is the only difference between
   the old result and the new one.
2. `itemsAddUp` and `checkReceipt` accept a receipt whose items make its total
   only once their rebates are counted, and `taxable-differs` is computed on
   the nets. Tests prove both.
3. Reader tests on recorded responses prove a rebate printed away from its item
   is folded, and a whole-receipt rebate stays its own item.
4. A filing stored before the migration reads back with `discount: null` and the
   same split as before. An `api` test proves it on a migrated database.
5. On the screen, entering a rebate on an item updates the add-up check and the
   split live. A web test proves it.
6. `npm run check` and `npm test -- --project ledger` pass.
7. The owner's paid read of the three fixtures folds the first two rebates and
   leaves the third as its own item, and the Log records the result.

## Log
