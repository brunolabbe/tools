---
id: lg-28
tool: ledger
title: Make the spending drill-down list follow a receipt's split
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-17 · `6b42ee19..c0a78c84` · Opus 5.5, depth standard

| Done when                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Every category's list, a receipt-only one included, sums to its slice less its card lines; an API test files a basket and asserts it per category | `api/test/stats.test.ts` › "every category's list sums to its slice, the one only a receipt creates and the uncategorised included" ✓ — the `listedSum(response)` against `slices.get(one.id)` loop over every `categories` id plus `none`; red with the slice path removed. The card-line clause is carried by the lg-18 test "a category's list sums to its slice of the chart less the card lines, for every category and for none" in the same file. The gate's own fixture (a split row and a card line in one slice, a period boundary, a split refund) agreed on 14 of 14 period × category comparisons |
| 2. Override, refused split, no receipt, no items: each listed once, whole, as charted                                                                | `api/test/stats.test.ts` › "a row with an override, a refused split, no receipt and no items each list once, whole" ✓ — the `holders` and `[amountCents, sliceCents]` assertions for A, E, F, D and G. Passes at the base by nature, and goes red when the shared decision stops honouring the override and when a whole row is given `sliceCents`                                                                                                                                                                                                                                                             |
| 3. A web test shows a split row's slice amount under the category it was opened from                                                                 | `web/test/stats-rows.test.tsx` › "a row split by its receipt shows the slice it counts for under the category it was opened from (lg-28)" ✓ — `.amount` is `formatCents(-574)`, not `-2476`; red with `shown()` returning `amountCents`                                                                                                                                                                                                                                                                                                                                                                        |
| 4. Gates green                                                                                                                                       | **unproven (gate)** — on `c0a78c84` every check but two has passed; `test (windows-latest, informational)` and `CodeQL` were still pending when read. Locally `npm run check` exit 0 and `npm test -- --project ledger` 1179 of 1179 (plus the gate's own spec, removed)                                                                                                                                                                                                                                                                                                                                       |

- **low** · `nfr:maintainability` · no `Done when` line depends on it · the note
  `PeriodRows` shows on a split row ("… of its … is in this category, the rest in
  the others its items chose") is false when every item chose one category:
  `chartedAs` in `api/src/slices.ts` returns `split: true` for a one-slice split, so
  `sliceCents` equals `amountCents` and there is no rest. False in the safe
  direction (the figure is right, only the sentence is wrong). Verified by reading,
  not run.
- **low** · `nfr:reliability` · no `Done when` line depends on it · no test on the
  branch puts a split row and a card line in one slice, a split refund (negative
  items on a positive row, which splits and carries a positive `sliceCents`), a
  negative slice inside a purchase, or a period boundary. The gate's fixture covers
  all four and the invariant holds; a missing fixture, not a defect.
- **dropped** · `slices.ts` is a new file with no test file of its own, and
  `rows.ts` gains a branch (`sliceEntries`) with none either. `chartedAs` and
  `receiptsOnRows` are moved from `stats.ts`, not new, and `rows.ts` has always been
  tested over HTTP in `stats.test.ts` and `spending-categories.test.ts`; five
  mutations of the two files each turn a test red. Not graded under the
  no-test-file rule.
- **dropped** · a page boundary inside one row's slices: impossible by
  construction. A category list holds a row at most once (`splitByCategory` keys by
  category), so entries and rows count the same; walking 14 lists at limit 1 and 2
  showed no duplicate or skip and a constant `total`. Not a defect.
- **dropped** · two receipts filed on one row are merged into one item list under
  the first filing's date in `receiptsOnRows`. That is lg-27's behaviour, moved
  unchanged, and the chart and the list read it alike. Out of the reviewed range.
- **findings** · the hunt returned 5; 2 carried, 3 dropped.
- Invariants: the contract change (`StoredRow.sliceCents?`) is the one Build 1
  authorises and the pull request declares it. No zod schema, type guard or Fastify
  response schema reads `StoredRow`, so nothing drops the field. No new `AppError`,
  no new workspace import, no spawn, URL or log line. Style ✓. Skipped: SSRF,
  redaction, process trees, progress, Dockerfile (nothing in the diff reaches them).
- NFR: security n/a (the query schema is unchanged) · performance ✓ (one
  `receipt_items` scan per scoped category list, next to the existing full row
  scan) · reliability: above · maintainability: above; `chartedAs` is the single
  decision, and the chart's own read never expands.

## Log

- 2026-10-17 — Filed from lg-27's gate 1 (F1), on the owner's answer to reword
  the two comments and file this ticket rather than make the list follow the
  split in lg-27.
- 2026-10-17 — Built (`ecdad51b`). `chartedAs(row, receipts)` in
  `api/src/slices.ts` is the one decision of how a row is charted (override wins,
  sign guard, no receipt, no items → whole; else `splitByCategory`);
  `receiptsOnRows` moved there from `stats.ts`. `spendingStats` and `listRows`
  both call it.
  - **The contract change is `StoredRow.sliceCents?: number`**, on the row inside
    `RowsResponse`: the part of a receipt-split row the list puts under the
    category it was asked for, signed as `amountCents` (money out negative), set
    only for a split row in a `scope=spending` list with a `spendingCategory`.
    Everything else is listed as before. A list then sums, in `sliceCents ??
amountCents`, to minus the slice less the card lines. `total` and `offset`
    count entries after the expansion.
  - **Reading of Build 2 the code decides, not the ticket:** the slice-following
    list is only `scope=spending` with a category. `fetchUncategorisedRows`
    (`web/src/api/spending.ts`, the Spending screen) asks `spendingCategory=none`
    with no scope to work through each row's _own_ missing category; a split row
    must stay in it until a person categorises the row. Unscoped lists are
    unchanged and a test pins it.
  - **Open question 2 of the dispatch (null slice under `none`) is determined**,
    so I did not raise it: `spendingByPeriod` charts a `categoryId: null` entry
    as the uncategorised slice, whose "Rows" button asks `spendingCategory=none`
    with `scope=spending`; "a row once for each slice spendingStats charts"
    therefore puts a receipt's uncategorised-item slice in the `none` list, and
    the row's own category is not consulted for a split row. The test
    "every category's list sums to its slice" has such a slice (row B, 17,76 $).
  - Claim 1 reproduced as a hazard: with `listRows` emitting per-slice entries for
    `scope=spending` with no category, 5 of 35 tests in `api/test/stats.test.ts`
    fail (the lg-27 chart tests double-count). The shipped code emits per-slice only
    when a category is asked for, and `spendingStats` asks for none. Claim 3: the
    test enumerates `categories` from the chart (the seed list, Alcohol and
    Household among them, which only row A's receipt creates) plus `none`.
  - Red before green, by removing the slice path (`rows.ts`) and, for the screen,
    making `shown()` return `amountCents`: API 2 of 35 failed ("every category's
    list sums to its slice", "paging counts entries"), web 1 of 19 ("a row split by
    its receipt shows the slice"). The whole-row test (Done when 2) cannot fail
    without the fix by nature: it pins that the new path leaves those rows alone.
  - Both comments are restored: `rowsQuerySchema` (now also the new field) and
    `countsAsSpending`.
  - Fold-in: nothing else was made free; lg-29 (`SalaryEntryResponse`) is a
    different region and file.
