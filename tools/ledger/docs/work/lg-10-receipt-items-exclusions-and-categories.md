---
id: lg-10
tool: ledger
title: Read a receipt's items, split out what is not shared or is the other's, and categorise
kind: work-package
status: ready
milestone: P4
depends_on: [lg-8, lg-15]
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

1. **Extend the model reader** (lg-8, Claude Haiku 5.5 since the 2026-10-12
   measurement) to return, as cents:
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
   - the list is [lg-15](./lg-15-spending-categories-on-bank-rows.md)'s
     spending categories, which bank rows and period lines already use; this
     ticket reads it and never creates a second one (filed 2026-10-06, when
     lg-15 took the list over from this step);
   - the model proposes from that list, and the person confirms;
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

## Decisions — answered 2026-10-16 by the owner at dispatch, not open

Two gaps in the Build, put to the owner by the orchestrator through
`AskUserQuestion`, each with the orchestrator's recommendation first, and each
answered with it. Neither is a contract decision.

**1. The question was:** what happens when the model proposes a category that is
not in lg-15's list? Options: **(a)** drop the proposal — that line arrives with
no proposed category, the person picks one when confirming, the merchant's last
category still comes first when there is one, and nothing is refused; **(b)**
refuse the read — the whole receipt read fails with a typed error. **The answer:
(a), drop the proposal.**

**2. The question was:** where do the dated GST and QST rates live (Build 2)?
Options: **(a)** a dated table in `books` — replace the `GST_RATE` and `QST_RATE`
constants in `tools/ledger/books/src/receipts.ts` (`const GST_RATE = 5_000;`,
`const QST_RATE = 9_975;`) with a table chosen by the receipt's date, which the
existing reconciliation check reads too, so that a rate change is a code change;
**(b)** stored configuration in the database (a migration, a route and a
screen). **The answer: (a), a dated table in `books`.**

## Log
