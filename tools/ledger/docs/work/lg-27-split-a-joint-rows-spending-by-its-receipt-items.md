---
id: lg-27
tool: ledger
title: Split a joint-account row's spending by its receipt items' categories
kind: work-package
status: needs-decision
milestone: P5
depends_on: [lg-10]
difficulty: standard
---

# lg-27 — Split a joint-account row's spending by its receipt items' categories

## Why

The spending stats count a joint-account row whole, under the row's own spending
category (`spendingStats` in `tools/ledger/api/src/stats.ts`). A row with a receipt
attached carries more than that: lg-10 stores the receipt's items, each with its
own spending category (`receipt_items`). A 24,76 $ grocery run with a six-pack
in it charts as 24,76 $ of Groceries, when the owner asked for alcohol to show
as alcohol (`docs/00-ANALYSIS.md` §6, _Categories_).

[lg-9](./lg-9-history-and-stats.md) (Build 1) and
[lg-15](./lg-15-spending-categories-on-bank-rows.md) (Build 7) both promised this
split "once lg-10 lands". lg-10 did not build it, because nothing says how a row's
amount divides among categories. The item prices do not make the row's amount: the
taxes are printed once, on the taxable items together, and the card may have
been charged a tip on top. lg-10's gate 1 (finding F5) found that nothing owned
the work, and the owner chose on 2026-10-17 to file this ticket and point both
sentences at it.

## Decision — open, for the owner

**How do a row's taxes, deposits and any tip divide among its items' categories?**
The row's amount is the card's charge. Its items are prices, deposits and a
taxable mark, and the printed GST and QST cover the taxable items together.

- **(a) Each item's exact cost, as lg-10 computes an excluded one.** That is the
  price, plus the deposit, plus GST and QST on the price if it is taxable, at
  the rates on the receipt's date (`itemsCost` in
  `tools/ledger/books/src/receipts.ts`), summed per category. Each category is
  rounded once, half-up, and the remainder goes to the largest category. The
  remainder is the rounding plus any tip. Recommended: it is the arithmetic the
  shared amount already uses, so a category's figure and an excluded item's
  figure agree.
- **(b) In proportion to each category's prices before tax**, with the
  remainder to the largest category. This is simpler, but it puts tax on
  zero-rated groceries and takes it off taxed items.
- **(c) Prices and deposits per category; taxes and any tip under the row's own
  category.** This is exact for the items, but a "Groceries" row keeps the beer's
  taxes.

## Build

Once the Decision is answered:

1. **`books`, pure:** a function from a row's amount and its receipt items (with
   the receipt's date) to amounts per spending category. It must sum to the
   row's amount to the cent. An item with no category counts as uncategorised.
2. **`api`:** in `spendingStats`, a joint-account row with a receipt filed on it
   (`receipt_filings.row_id`) and at least one item contributes its split instead
   of its whole amount under its own category. A row with a receipt but no items
   stays whole. A row with no receipt is unchanged.
3. Correct the comment on `spendingStats`, which says the split is not built.

## Done when

1. A row with a receipt of items in two categories charts as two amounts that
   sum to the row's amount to the cent, by the rule the Decision chose; a test
   asserts both figures.
2. A row with a tip charted on top of its receipt's total puts the tip where the
   Decision says; a test asserts it.
3. A row with no receipt, and one whose receipt has no items, chart as before.
4. Gates green.

## Log
