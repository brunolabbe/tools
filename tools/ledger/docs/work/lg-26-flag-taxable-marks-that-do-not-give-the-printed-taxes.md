---
id: lg-26
tool: ledger
title: Flag a receipt whose taxable items do not give its printed GST and QST
kind: fix
status: ready
milestone: P4
depends_on: [lg-10]
difficulty: standard
---

# lg-26 — Flag a receipt whose taxable items do not give its printed GST and QST

## Why

A misread taxable mark moves money between the shared and the not-shared
amounts, and nothing flags it. lg-10 computes what an item takes off the shared
amount, including GST and QST on its price when the item is marked taxable. The
two checks do not look at that mark:

- the reconciliation, `itemsAddUp` in `tools/ledger/books/src/receipts.ts`, sums
  prices, deposits and the printed taxes, so it is blind to the mark;
- `taxesFit` asks only whether _some_ part of the subtotal gives both printed
  taxes, never whether the items marked taxable are that part.

The model's reading of a receipt's tax codes is unmeasured on real photos
(lg-10's Log). lg-10's gate 1 found this (finding F2), and on 2026-10-17 the
owner chose to correct the reader's comment, which had claimed the check catches
an item misread, and to file this ticket.

## Reproduction

The basket from lg-10's tests, with the six-pack not shared:

- bread 3,49 $, untaxed;
- a six-pack 12,99 $, taxable, with a 0,60 $ deposit;
- soap 4,99 $, taxable.

The printed taxes are GST 0,90 $ and QST 1,79 $, and the total is 24,76 $. This
is `BASKET` in `tools/ledger/books/test/receipts.test.ts`. Run `checkReceipt`
and `splitReceipt` from `books` on it, with the six-pack marked `not-shared`:

```
as printed (beer T, soap T)      flags [] split {"sharedCents":922,"notSharedCents":1554,"chargedCents":0}
beer misread as not taxable      flags [] split {"sharedCents":1117,"notSharedCents":1359,"chargedCents":0}
```

With the six-pack's mark misread, 1,95 $ moves to the shared side, and the
screen still says "It adds up."

**The converse, with no tax lines** (lg-10's gate 2, N3). This is a zero-rated
grocery receipt, the case lg-8 measured as common, with both taxes `null`:

- milk 10,00 $, marked `not-shared`;
- bread 10,00 $, shared;
- total 20,00 $.

```
milk marked taxable=false:   flags [] split {"sharedCents":1000,"notSharedCents":1000,"chargedCents":0}
milk marked taxable=true:    flags [] split {"sharedCents":850,"notSharedCents":1150,"chargedCents":0}
```

With the milk misread as taxable, the not-shared part takes 1,50 $ of tax that
nobody charged, and nothing flags it.

## Build

1. **`contract`:** a new flag in `RECEIPT_FLAGS`, for example `taxable-differs`.
   It means: the prices of the items marked taxable, taken as the taxable part,
   do not give both printed taxes at the rates on the receipt's date. It is
   **non-blocking**, like every flag but `items-differ`: the person checks the
   Taxable boxes, and files.
2. **`books`:** in `checkReceipt`, when the receipt has items, raise the flag
   unless the sum of the taxable items' prices lies in both ranges
   `taxableRange` gives for the printed GST and QST. That is the same arithmetic
   `taxesFit` uses, with the taxable part fixed instead of searched for.
   - **Both taxes absent count as printed zero** when the receipt has items, so
     that an item marked taxable on a receipt with no tax lines is flagged (the
     converse in the Reproduction).
   - One tax absent is already `tax-missing`, and is left to that flag.
   - No item means no flag.
   - A refund's parts are checked as their magnitudes, as `taxesFit` checks
     them.
3. **`web`:** its label in `FLAG_LABELS`, telling the person to check which items
   are taxable.
4. **Traps.**
   - A store that rounds tax per line, not on the taxable subtotal, could raise
     the flag on a correct reading. It is non-blocking, so that costs a glance,
     not a filing. Note it in the Log if a fixture shows it.
   - `FLAG_LABELS["tax-differs"]` and the contract's doc for `tax-differs` write
     the rates out (lg-10 gate 1, F4). Do not copy that into the new label.

## Done when

1. The reproduction's misread basket (six-pack not taxable) is flagged, and the
   basket as printed is not; a `books` test asserts both.
2. A receipt with items, all untaxed, and no tax lines is not flagged.
3. The Reproduction's receipt with no tax lines and the milk marked taxable is
   flagged; a `books` test asserts it.
4. The screen shows the flag's label for the misread basket, and filing is not
   blocked by it; a `web` test proves both.
5. Gates green.

## Log

- 2026-10-17 — Fixed at landing by owner choice: lg-10's gate 2, N3 — "(i) Its
  reproduction says to run "the gate's script, `node taxable-mark.mjs <tree>`",
  which exists only in a gate's scratch directory; the basket is in the repo
  (`BASKET` in `books/test/receipts.test.ts`), so cite that. (ii) … The new flag
  should treat both taxes absent as printed zero when the receipt has items, so
  that a taxable mark with no tax printed is flagged; add it to Build 2 and a
  Done when line." Each check below reads only the section it names:
  - `sed -n '/^## Reproduction/,/^## Build/p' <this file> | grep -c "taxable-mark.mjs"`
    → `0`, and the same for `"BASKET"` → `1`;
  - `sed -n '/^## Build/,/^## Done when/p' <this file> | grep -c "Both taxes absent count as printed zero"`
    → `1`;
  - `sed -n '/^## Done when/,/^## Log/p' <this file> | grep -c "no tax lines and the milk marked taxable"`
    → `1`.
