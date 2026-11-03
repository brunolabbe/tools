---
id: lg-101
tool: ledger
title: A rebate already taken off the printed price is taken off a second time
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# lg-101 — A rebate already taken off the printed price is taken off a second time

## Why

lg-89 folds a rebate into the item it reduces and reads the item's net as
`price + discount` (`books/src/receipts.ts`, `netPrice`). That assumes the
printed price is the price before the rebate. On many receipts the owner files,
it is not. The item's price is printed with the rebate already taken off, and
the rebate line (`RABAIS`, `ÉCONOMIE`) only shows what was saved. The reader
folds that line in anyway, so the rebate comes off twice and the items no longer
make the total.

**Reproduction (owner, 2026-11-03).** Most receipts with a rebate open with
"The items, deposits, rebates and taxes do not add up to the total. Correct
them to file." In synthetic form: an item printed `4.99`, a line `RABAIS -1.00`
under it, and a total of `4.99` with no tax. The reader answers
`price: 499, discount: -100`. `itemsAddUp` sums the net, `399`, against `499`
and fails, and `checkReceipt` flags `items-differ`. Clearing the Rebate field by
hand makes the receipt fileable, and that is what the owner does today.

## Decision — answered 2026-11-03 by the owner

Asked through `AskUserQuestion`: how should the ledger tell a rebate already in
the printed price from one that still has to come off?

- **The reader is told, and the arithmetic catches what it misses (chosen).**
  The prompt says some receipts print the price after the rebate. After every
  read, a deterministic check repairs a reading whose items make the total only
  with their rebates ignored.
- The arithmetic only: no paid read, but it cannot tell which item was already
  discounted when two repairs both add up.
- The reader only: if the model misreads, the error is still there.

## Build

**No contract change.** A rebate already in the printed price is not a discount
on that price, so such an item is stored as `price` = the printed price and
`discount: null`. That keeps `ReceiptItem.price`'s meaning ("as printed") and
`netPrice` unchanged, and the photo still shows the rebate line. Do not keep the
rebate as information on the item: that needs a new field, which is a change to
`@ledger/contract` and a stop and a question.

1. **`books/src/receipts.ts`.** Add `dropPrintedRebates(proposal)`, which
   returns the proposal unchanged when `itemsAddUp` already holds, or has no
   item with a `discount`. Otherwise it tries, in this order:
   - every item's `discount` set to `null`;
   - each subset of the discounted items with its discounts set to `null`,
     **only when there are at most 8 discounted items**, keeping the result only
     if **exactly one** subset makes `itemsAddUp` hold.

   It returns the first repair that adds up and is not ambiguous. If none
   does, it returns the reading unchanged, so the screen flags it as today.
   A repair must also leave `taxableFits` no worse than the reading had it. A
   repair that adds up while raising `taxable-differs` loses to no repair,
   because two wrongs can make a total. Comment why the subset search is
   bounded.

2. **`api/src/receipts.ts`.** Apply it to each proposal between `reader.read`
   and `checkReceipt` in the read route, so the flags and the screen see the
   repaired reading. Do **not** apply it in `fileReceipt`: what is filed is the
   form as the person left it, and a rebate they typed back in is theirs.
3. **`receipts/src/reader.ts`.** Add to `RECEIPT_PROMPT`'s rebate paragraph:
   when the printed price of an item already has the rebate taken off (the
   rebate line is shown for information, and the lines make the total without
   it), give the printed price and a `null` discount. Do not fold it. Update the
   file's header comment. Add a reader test on a recorded response of that
   shape.
4. **Fixture and paid read.** Add a fourth synthetic receipt beside lg-89's
   three in `receipts/test/fixtures/`: two items printed after their rebates,
   one rebate printed directly under its item and one three lines below it,
   naming its code. Extend `receipts/test/live/read-rebate-fixtures.ts` (and its
   expectations in `rebate-fixtures.ts`) to expect `discount: null` on both.
   That read is **the owner's paid read**: ask for it, do not run it. Record the
   command in the Log. lg-89's two `med` gate findings are in that script (the
   key file printed whole without a `LEDGER=` line, and `ANTHROPIC_CUSTOM_HEADERS`
   not refused). Fix both here: this ticket is the next one to run that script
   with a real key.
5. **Tests**, at the end of their suites: `books/test/receipts.test.ts` for each
   branch of `dropPrintedRebates`. Cover the all-items repair, a unique subset,
   two subsets that both add up (unchanged), nine discounted items (no subset
   search), a reading that adds up already (unchanged), and a repair that would
   raise `taxable-differs` (unchanged). Add an `api` read-route test proving a
   recorded double-counted reading comes back with no `items-differ`.

## Done when

1. `books/test/receipts.test.ts` proves each `dropPrintedRebates` case listed in
   Build step 5, including that an ambiguous or tax-worsening repair leaves the
   reading unchanged.
2. An `api` test proves that a reading of the reproduction's shape (`499`,
   `-100`, total `499`) comes back from the read route with `discount: null` and
   no `items-differ`, and that `fileReceipt` files a typed-back rebate as typed.
3. A reader test on a recorded response proves a rebate already in the printed
   price comes back with `discount: null`.
4. `read-rebate-fixtures.ts` refuses a key file of several lines with no
   `LEDGER=` line and refuses `ANTHROPIC_CUSTOM_HEADERS`, without printing
   either. A test proves both.
5. `npm run check` and `npm test -- --project ledger` pass.
6. The owner's paid read of the four fixtures leaves the fourth's two rebates
   unfolded and lg-89's three as before, and the Log records it.

## Log

### 2026-11-03 — filed (Claude Opus 5.5)

Filed from the owner's report on the receipt screen, with lg-102. lg-89 is not
wrong for receipts that print the price before the rebate; it never asked which
kind of receipt it had.
