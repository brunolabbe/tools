---
id: lg-10
tool: ledger
title: Read a receipt's items, split out what is not shared or is the other's, and categorise
kind: work-package
status: ready
milestone: P4
depends_on: [lg-8]
difficulty: hard
---

# lg-10 — Read a receipt's items, split out what is not shared or is the other's, and categorise

## Why

A shared grocery run carries things only one person pays for, and the other
person should not share their price, their taxes or their deposit. The owner
also wants spending by type. Both need the receipt read line by line
([00-ANALYSIS.md §6](../00-ANALYSIS.md), _Items that are not shared_ and
_Categories_).

## Build

1. **Extend the model reader** (lg-8), which is called when the person wants items
   or categories, to return, as cents:
   - lines of `{ text, price, taxable, deposit? }`;
   - the subtotal, GST, QST and total;
   - a proposed category per line.
     The model reads and proposes; it computes nothing.
2. **`books`, pure: `sharedAmount(receipt, excluded, rates)`.**
   - The excluded part is each excluded item's price, plus its deposit, plus
     GST and QST on it if it is taxable.
   - The rates come from dated configuration, chosen by the receipt's date.
   - Round the excluded part once, half-up; the shared part is the total minus
     it.
   - Deposits carry no tax.
3. **Reconciliation:** lines + deposits + taxes must equal the total to the
   cent. If they don't, the receipt is shown for correction and cannot be filed
   until they do.
4. **Categories:**
   - a fixed starting list (groceries, alcohol, household, pharmacy,
     restaurant, other), editable in the database;
   - the model proposes, and the person confirms;
   - a merchant categorised before gets its last category proposed first.
     Categories never change who owes what.
5. **Storage:** the confirmed lines, with excluded flags and categories, are
   stored with the receipt, append-only like everything else. The period line
   carries the shared amount.
6. **An item marked as the other person's** becomes a charge (lg-6). The
   amount is its price, its deposit and its taxes, computed exactly like an
   excluded item's. It comes off the shared amount like one, and it is owed in
   full by the other person.
7. `web`: the item list, where a tap cycles an item through shared, not
   shared and the other's. The excluded amount and
   the shared amount update live, and the category is editable per item.

## Done when

1. A synthetic receipt with a taxable excluded item and its deposit, at GST 5 %
   and QST 9.975 %, yields a shared amount that tests assert to the cent, and
   excluded + shared = total.
2. A receipt whose lines do not add up to its total cannot be filed. An API test
   proves it.
3. A rate change mid-year uses the rate in effect on the receipt's date.
4. A merchant's previous category is proposed first on its next receipt.
5. An item marked as the other's produces a charge equal to its excluded amount,
   and the receipt still reconciles: shared + not shared + charged = total.
6. Gates green.

## Log
