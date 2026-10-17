---
id: lg-28
tool: ledger
title: Make the spending drill-down list follow a receipt's split
kind: fix
status: ready
milestone: P5
depends_on: [lg-27]
difficulty: standard
---

# lg-28 — Make the spending drill-down list follow a receipt's split

## Why

[lg-27](./lg-27-split-a-joint-rows-spending-by-its-receipt-items.md) charts a
joint-account row with a receipt under its items' categories, but the list the
chart opens ([lg-18](./lg-18-show-a-filed-rows-spending-category-where-it-can-be-changed.md),
`GET /api/rows?scope=spending&spendingCategory=<id>`) still files that row whole
under the row's own category. Every category's list therefore stops matching its
slice for a row that has a receipt, and a slice the receipt created has an empty
list behind it. The owner chose on 2026-10-17 to word the two comments that
promised the match as it stands and to file this ticket, rather than change
`RowsResponse` inside lg-27 (gate 1, F1).

Reproduction, from lg-27's gate 1: its API harness on `89ad8b02`, fixture
"all-after", one open period, no card lines, every row filed through the route.

| Slice     | Chart | List from `GET /api/rows?scope=spending&spendingCategory=<id>` |
| --------- | ----- | -------------------------------------------------------------- |
| Groceries | 4 872 | 6 752                                                          |
| Alcohol   | −416  | 0                                                              |
| Household | 2 296 | 0                                                              |

At `8e50f0d4`, before lg-27, the same fixture gave Groceries 6 752 against a list
of 6 752. The Alcohol and Household "Rows" buttons open a screen that says "No
bank row matches." and "No card line matches.". (The Alcohol figure is negative
there because lg-27 gate 1's F3 had not yet been fixed; the mismatch does not
depend on it.) The builder's own measurement on `89ad8b02` with a basket
attached to one row: chart Groceries 6 125, Alcohol 1 553, Household 574; lists
8 252, 0 and 0.

## Build

1. **`contract`:** `RowsResponse` has to say a row can be in a list for part of
   its amount: a row listed under a category it was split into carries that
   slice's amount alongside its own `amountCents`. Name the field, keep the
   existing fields, and say in the doc comment what the list now sums to. This is
   a contract change; follow the repo's rule for one and say so in the pull
   request.
2. **`api`:** `listRows` with `spendingCategory` (and `none`) lists a row once for
   each slice `spendingStats` charts for it, and no more, using the same split
   (`splitByCategory`, the override and the sign guard of lg-27) so the two cannot
   drift. A row with no receipt, or charted whole, is listed as it is now.
   Factor the decision of how a row is charted into one function that both
   `spendingStats` and `listRows` call; do not copy it.
3. **`web`:** the list shows a split row's slice amount for the category it was
   opened from, and says the row has a receipt. The "Rows" buttons on a slice a
   receipt created open a list that is not empty.
4. Restore the two comments lg-27 reworded when it found them false —
   `rowsQuerySchema` in `contract/src/api.ts` and `countsAsSpending` in
   `api/src/rows.ts` — to the claim that a list opened from the chart sums to its
   slice less the card lines in that slice.

## Done when

1. For every spending category, including one that only a receipt's items create,
   the list opened from its slice sums to the slice less the card lines in it; an
   API test files a basket on a row and asserts it for each category.
2. A row with an override, a row whose split was refused by the sign guard, a row
   with no receipt and one whose receipt has no items each list under one
   category with their whole amount, as the chart charts them; a test asserts it.
3. A web test shows a split row's slice amount under the category it was opened
   from.
4. Gates green.

## Log

- 2026-10-17 — Filed from lg-27's gate 1 (F1), on the owner's answer to reword
  the two comments and file this ticket rather than make the list follow the
  split in lg-27.
