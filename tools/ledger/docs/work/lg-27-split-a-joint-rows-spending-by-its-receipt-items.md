---
id: lg-27
tool: ledger
title: Split a joint-account row's spending by its receipt items' categories
kind: work-package
status: done
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

## Decision — answered

**The owner chose (a) on 2026-10-17:** each item's exact cost, summed per
category. The remainder, which is the rounding plus any tip, goes to the largest
category. The options are kept below as they were asked.

**The owner added a guard on 2026-10-17 (gate 1, F3):** when the remainder would
change the sign of the largest category, the row is charted whole under its own
category, as before.

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

By rule (a):

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

## Review

**Gate: FAIL**: 2026-10-17 · `8e50f0d4..89ad8b02` · Opus 5.5, depth full

| Done when                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A row with a receipt of items in two categories charts as two amounts that sum to the row's amount to the cent, by rule (a), and a test asserts both figures | `books/test/receipts.test.ts` › "two or more categories chart as amounts that sum to the row's amount, to the cent" (`toEqual` on 349 / 1 553 / 574, and the sum is 2 476) ✓. `api/test/stats.test.ts` › "a row with a basket charts as the basket's categories, summing to the row to the cent" (the three slices, and the chart total unchanged) ✓. A second method agrees: the gate's harness re-derives rule (a) on its own (exact cost per category, rounded half-up, remainder to the largest by magnitude, earlier of two equal) over 20 000 generated baskets. Each basket has 1 to 13 items, mixed taxable marks, deposits, `null` categories, discounts, refunds and forced ties. `splitByCategory` matches the re-derivation on 20 000 of 20 000, and the slices sum to the amount on 20 000 of 20 000. **proven** |
| 2. A tip on top of the receipt's total goes where the Decision says, and a test asserts it                                                                      | `books/test/receipts.test.ts` › "a tip charted on top of the total goes to the largest category" (alcohol 1 853) ✓. `api/test/stats.test.ts` › "a tip on top of the receipt's total charts under the largest category" (`[1_853, 574]`) ✓. Positive control: the remainder was sent to the smallest category instead (`>` became `<` in `splitByCategory`, books rebuilt, `dist/receipts.js` grepped for the mutated comparison). Both tests then fail, with 6 failed of 67 in `npx vitest run tools/ledger/books/test/receipts.test.ts tools/ledger/api/test/stats.test.ts`. The code was restored from the head sha and books rebuilt. **proven**                                                                                                                                                                           |
| 3. A row with no receipt, and one whose receipt has no items, chart as before                                                                                   | `api/test/stats.test.ts` › "a row with no receipt, and one whose receipt has no items, chart whole as before" (`toEqual(before)` after a filing with no items, and `before.get(1)` as the sum of whole rows) ✓. Its "before" is taken at the head, so the gate also compared the base with the head. The same API harness ran on a second tree at `8e50f0d4` and at the head, over the same fixture: a row with no receipt, a row filed through `POST /api/receipts/:id/file` with no items, and a card line filed with a `not-shared` item and a `theirs` item. Both trees gave `categories [{1: 7100}, {3: 574}]`, `accountCents 6752`, `totalCents 7674`, identical. **proven**                                                                                                                                            |
| 4. Gates green                                                                                                                                                  | PR #506 at `89ad8b02`: `check` ×2, `changes`, `test (ubuntu-latest)`, `codeql`, `CodeQL`, `dependency-review` and `docker` passed. `test (windows-latest, informational)` was still pending when read once, and is read, not graded. Locally, `npm test -- --project ledger` passed 1124 of 1124 (60 files) and `npm run check` exited 0. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **high** · F1 · no `Done when` line depends on it · shipped text is now false, in the unsafe direction. Two comments promise the reconciliation, and the branch breaks it for every split row:
  - The doc comment on `rowsQuerySchema` in `contract/src/api.ts` says "a list opened from the chart sums to the slice it was opened from less the card lines in that slice".
  - The comment on `countsAsSpending` in `api/src/rows.ts` says "One definition for the chart's sums and for the list opened from them, so the two cannot drift".

  `listRows` still files a split row whole under the row's own category. lg-18's gate 1 graded this same sentence, false for card lines, as a `high` (its F1).

  Reproduction: the gate's API harness on the head, fixture "all-after", one open period, no card lines. Every row was filed through the route.

  | Slice     | Chart | List from `GET /api/rows?scope=spending&spendingCategory=<id>` |
  | --------- | ----- | -------------------------------------------------------------- |
  | Groceries | 4 872 | 6 752                                                          |
  | Alcohol   | −416  | 0                                                              |
  | Household | 2 296 | 0                                                              |

  At `8e50f0d4` the same fixture gives Groceries 6 752 against a list of 6 752. The Alcohol and Household "Rows" buttons open a screen that says "No bank row matches." and "No card line matches.".

  **Open decision, for the remedy only.** Either way the text is false today.
  - (a) Recommended: reword both comments in this branch, saying the list leaves out the receipt split as well as the card lines, and file a ticket for a drill-down that follows the split. Two sentences. One of them is in `contract`, which lg-18 edited the same way in its fix round. Name the decision in the Log.
  - (b) Make the list follow the split in this branch. That changes `RowsResponse` (one row per slice) and the screen, which is outside this ticket's Build.

  The builder's Log raises the same gap and measures it the same way ("Groceries 82,52 $ … Alcohol 0"). It does not mention either comment.

- **med** · F2 · no lg-27 `Done when` line depends on it; it contradicts lg-18's Done when 1 on `main` · **open decision**. After this branch, an override on a row with a receipt answers 200 and the chart does not move. lg-18's line reads "a row the map or a rule categorised wrongly can be given its own category from the web, and the stats screen then shows it under the new one". `receipt_items` is written once and never updated: no `UPDATE` or `DELETE` touches it anywhere in `tools/ledger`. So once a receipt is filed on a row, nothing on any screen can correct the categories the chart shows for that row. The web's one correction tool, `RowSpending` in the lg-18 list, succeeds silently and has no effect on the chart.

  Reproduction: the gate's harness, test "lg-18: an override on a receipted row". Row A (−24,76 $) has the basket filed on it, then gets `POST /api/spending-category-overrides {rowId: A, spendingCategoryId: 4}`.
  - At the head: status 200 with `"source":"override"`. The chart reads `{1: 4625, 2: 1553, 3: 574}` before and after, and category 4 never appears. The list for category 4 now holds A's 2 476.
  - At `8e50f0d4`: the same steps give `{1: 4276, 4: 2476}`.

  Options:
  - (a) Recommended: a row's own override wins over its split, so the row charts whole under the override. That is one condition on `row.spendingCategory?.source === "override"` in `spendingStats`, and it restores lg-18's line. The cost: correcting one item drops the whole row's split.
  - (b) Keep the split. `RowSpending` says the category comes from the receipt and offers no override on a receipted row, and a ticket is filed for editing an item's category.
  - (c) Accept it, and reword lg-18's line.

- **med** · F3 · no `Done when` line depends on it · **open decision**. The Decision rests on a premise: "the remainder is the rounding plus any tip". The data breaks it in reachable cases, and the largest category then changes sign. A row filing carries no amount: `fileReceipt` never compares the row with the receipt, and the web offers rows matching whatever "Charged to the card" the person types.
  - A basket paid 5,00 $ by card and the rest otherwise (a gift card) splits as Groceries 3,49 $, **Alcohol −4,23 $**, Household 5,74 $.
  - The same purchase receipt filed on a +24,76 $ refund row splits as Groceries +3,49 $, **Alcohol −33,99 $**, Household +5,74 $. A refund then raises two categories.
  - A remainder larger than the largest category (10 000 against 2 477) is all charted as alcohol, 9 077 of the 10 000.

  Those cases come from `npx vitest run tools/ledger/books/test/zz-gate-lg27.test.ts` (harness copied in, then removed), "adversarial remainders": `farBelow_500`, `oppositeSign_minus2476` and `pastLargest_10000`. Through the route, fixture "all-after" charts a period of Alcohol **−4,16 $**. Over the generated population, 3 491 of 20 000 baskets flip the sign of the target category, and 4 408 of 20 000 purchases chart some negative slice.

  The build follows the Decision literally. On a purchase, the period chart shows these negative slices exactly as it shows a refund.

  Options:
  - (a) Recommended: when the remainder would change the sign of the largest category, chart the row whole under its own category, as before. One guard.
  - (b) Spread a remainder beyond rounding in proportion to the categories.
  - (c) Keep it, and say so in the Decision.

- **low** · F4 · "largest" means largest by magnitude, so on a purchase whose biggest line is a separately categorised discount, the tip lands on the discount. Items of 10,00 $, 10,00 $ and −15,00 $ (category 5), charged 8,00 $ with a 3,00 $ tip, chart `[1000, 1000, −1200]`: the tip shrinks the discount, and no spending category receives it. 474 of 20 000 generated purchases chose a negative category as the target. The Decision does not say which reading it meant, and the condition is rare.
- **low** · F5 · two comments state wrong figures, in the safe direction; the rounded cents are unaffected. The comment above the new `books/test/receipts.test.ts` block and the branch's Log give the six-pack as "15,53525 $" and the soap as "5,73725 $". The exact costs are 15,5352525 $ (1 299 × 1,14975 + 60) and 5,7372525 $ (499 × 1,14975).
- **dropped** · "the split charts an excluded item as joint spending". This cannot happen. `fileReceipt` refuses a row filing that has any item that is not `shared`: the harness got 400, "A receipt on a joint-account row is shared whole", at both base and head. Excluded items exist only on line filings, whose `row_id` is NULL, so `receiptsOnRows` never reads them. The line fixture holding a `not-shared` and a `theirs` item charts identically at base and head. `receiptsOnRows` reads `share` and `splitByCategory` ignores it. That would matter only if rows ever accepted excluded items: no live call site.
- **dropped** · "a row can carry two filings, or a receipt be unfiled or replaced". The partial unique index `receipt_filings_row` prevents a second filing: the harness got 409 `ROW_ALREADY_DOCUMENTED` through the route and `UNIQUE constraint failed: receipt_filings.row_id` from raw SQL. A filing names a line or a row, never both (`CHECK`). No code path deletes or updates a filing.
- **dropped** · "a row outside the spending scope picks up a split". It does not. A basket was filed through the route on a row filed to Sam and on an unfiled transfer in. Both were accepted (200, as at the base), and neither is charted: `accountCents` stays 6 752.
- **dropped** · the API tests attach receipts with raw SQL, not through the route. The harness filed the same basket through the route and got the same 1 553 and 574, so the shortcut proves the same thing.
- **findings** · the hunt returned 9: 5 carried, 4 dropped.
- Invariants checked: no import across tools, no new error code, contract untouched (only F1's remedy would edit it), no new workspace or Dockerfile line, specs added to existing registered files, style. Skipped as untouched by the diff: shell and process trees, redaction, SSRF, progress, routes.
- NFR: security n/a (read-only SQL with no input) · performance: `receiptsOnRows` reads every filed row's items on each stats call, whatever the range, the same shape as `listRows`; acceptable · reliability: F3 · maintainability: F1, F5.

### Gate 2

**Gate: PASS**: 2026-10-17 · `89ad8b02..b21aa3c6` · Opus 5.5, re-gate of the round's own commit (`git log --first-parent --no-merges 89ad8b02..b21aa3c6` lists only `b21aa3c6`)

Nothing in this round is a `high`.

| Done when                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Two categories, summing to the row to the cent                             | Unchanged from gate 1, and still green: `books/test/receipts.test.ts` › "two or more categories chart as amounts that sum to the row's amount, to the cent" and `api/test/stats.test.ts` › "a row with a basket charts as the basket's categories, summing to the row to the cent" ✓. The gate's books harness re-derives the rule independently, now with the owner's sign guard, over 20 000 generated baskets. It agrees with `splitByCategory` on 20 000 of 20 000. Every split that is not empty sums to the row's amount. **proven** |
| 2. A tip goes where the Decision says                                         | Unchanged from gate 1: the books test "a tip charted on top of the total goes to the largest category" and the api test "a tip on top of the receipt's total charts under the largest category" ✓. **proven**                                                                                                                                                                                                                                                                                                                              |
| 3. A row with no receipt, and one whose receipt has no items, chart as before | `api/test/stats.test.ts` › "a row with no receipt, and one whose receipt has no items, chart whole as before" ✓. The gate's API harness, run on this head over the gate-1 "dw3" fixture, gives `{1: 7100, 3: 574}` with `accountCents 6752`, the same as it gave at `8e50f0d4`. **proven**                                                                                                                                                                                                                                                 |
| 4. Gates green                                                                | PR #506 at `b21aa3c6`: every check passed, including `test (ubuntu-latest)` and `test (windows-latest, informational)`. Locally, `npm test -- --project ledger` gave 1129 of 1129 (60 files) and `npm run check` exited 0. **proven**                                                                                                                                                                                                                                                                                                      |

- **F1 (high)** · **fixed**.
  - Both comments are now true. `rowsQuerySchema` in `contract/src/api.ts` says the list "files a row under the row's own category even when its receipt's items split the row" and names lg-28. `countsAsSpending` in `api/src/rows.ts` now claims only that the chart and the list count the same rows.
  - Measured against the gate's API harness on this head (fixture "all-after"): the Groceries slice is 2 198 and its list 6 752, so the list and the slice still differ, as both comments now say.
  - The owner's answers apply the same way to both: an overridden row and a guarded row are each charted whole and listed whole under the same category. The "override-after" fixture gives list = slice, 4 276 and 2 476.
  - A grep of `tools/ledger` finds no other copy of the old claim. The sum claim on `periodLinesQuerySchema` is about card lines, which the split does not touch.
  - lg-28 checks out:
    - The format parses: `npm run status -- --show lg-28` gives `fix`, `ready`, `standard`, blocked by lg-27.
    - The id is free on `origin/main` (`b9f01370`) and in the open PRs #504 and #508.
    - Its reproduction table is gate 1's, and it names `89ad8b02`.
    - `depends_on: [lg-27]`.
- **F2 (med)** · **fixed**.
  - `spendingStats` charts a row whole when `row.spendingCategory?.source === "override"`.
  - Test: `api/test/stats.test.ts` › "an override on a receipted row moves the chart: the row charts whole under it (F2)". It asserts 2 476 under Pharmacy and that the alcohol and household slices are gone.
  - Red/green: with only that condition removed, it is the one failure, 1 failed of 72 in `npx vitest run tools/ledger/books/test/receipts.test.ts tools/ledger/api/test/stats.test.ts`. Restored, all 72 pass.
  - The gate's own harness on this head gives `{1: 4276, 4: 2476}` after the override on A. That is identical to `8e50f0d4`, so lg-18's Done when 1 holds again for a row with a receipt.
- **F3 (med)** · **fixed, by the owner's sign guard.**
  - `splitByCategory` answers `[]` when the remainder would change the sign of the largest category.
  - Tests: books › "a basket part paid by card gives no split, where it gave Alcohol −4,23 $" and "a purchase's receipt on a refund row gives no split"; api › "a basket part paid by card, and one filed on a refund row, chart whole (F3)".
  - Red/green: with only the guard removed (books rebuilt, `dist/receipts.js` grepped for `Math.sign(adjusted)`: 0 matches), exactly those 3 fail, 3 failed of 72. Restored and rebuilt (1 match), all pass.
  - The two fixes red separately add up to the builder's "4 of 72".
  - Across the generated population:
    - Sign flips of the target category: 0 of 20 000 (gate 1: 3 491).
    - Charted whole by the guard: 3 503 of 20 000.
    - Purchases charting a negative slice: 2 823 of 15 311 (gate 1: 4 408). All 2 823 come from categories whose own items already net negative (discount lines); 0 come from the remainder.
  - Correction to my own gate 1 text: "4 408 of 20 000 purchases" should have read "of 15 311 purchases". The generator's seed is the same, so that is the gate 1 denominator.
  - Through the route, "all-after" now charts Groceries 2 198, Alcohol 3 406 and Household 1 148, with no negative slice. Checked by hand: A and B are split, and C, D, E and F are whole.
  - `pastLargest_10000` still splits as `[349, 9077, 574]`. Per the dispatch, that is the owner's rule as worded and not a finding.
- **F4 (low)** · **not fixed**, recorded as the dispatch directs. The builder reasoned that the guard leaves it unchanged and did not run it; the gate ran it on this head: `tipToDiscount` is still `[1000, 1000, −1200]`.
- **F5 (low)** · **fixed**. Both the block comment in `books/test/receipts.test.ts` and the Log now read 15,5352525 $ and 5,7372525 $. A grep of `tools/ledger` for the old figures finds none.
- **Helper change checked:** `startWithReceipts(more = [])` appends rows after D. The `git diff 89ad8b02 b21aa3c6` of `api/test/stats.test.ts` changes no line in the gate-1 tests, and they call it with no argument, so their fixture is unchanged.
- **dropped** · the guard also returns `[]` when the remainder brings the largest category to exactly 0 (`Math.sign(0)` is not the target's sign), so such a row charts whole. That is the conservative result, and nothing relies on the difference.
- **dropped** · comment lines in `contract/src/api.ts` run past 100 columns. Nine lines in that file already do, and `npm run check` passes.
- **findings** · the round's lines raise 2: 0 carried, 2 dropped.

## Log

- 2026-10-17 — Owner answered the Decision through `AskUserQuestion` with
  options (a), (b) and (c) as written, (a) recommended, and chose (a).
  `status: ready`. Done when 2 puts the tip in the largest category.
- 2026-10-17 — Built by rule (a). `splitByCategory(amountCents, { date, items }, table)`
  is at the end of `tools/ledger/books/src/receipts.ts`, additive, so it reuses
  the private `itemsCost` and `roundCents` without exporting them or touching
  `checkReceipt` and `taxableRange` (lg-26 edits those). Each category's items
  are summed exactly, then rounded once, half-up; the difference from the row's
  amount goes to the category with the largest magnitude, the earlier of two
  equal; an item with no category is `null`; a category that comes to nothing is
  dropped; a receipt with no items answers `[]`. `spendingStats` reads
  `receipt_filings.row_id` and `receipt_items` once (`receiptsOnRows`) and uses
  the split in place of the row's whole amount when it answers any; otherwise
  the row is whole as before. `spendingStats`' comment is corrected.
  - The lg-10 basket (bread 3,49 $, six-pack with deposit and taxes 15,5352525 $,
    soap 5,7372525 $) costs 24,77 $ item by item against the 24,76 $ printed, so
    the rounding alone takes a cent off the six-pack: 3,49 / 15,53 / 5,74. With a
    3,00 $ tip on top the six-pack is 18,53 $. Both are asserted in
    `books/test/receipts.test.ts` and, through the route, in
    `api/test/stats.test.ts`.
  - **Not folded in, and it is a real gap:** the lg-18 drill-down
    (`GET /api/rows?scope=spending&spendingCategory=<id>`) lists a row under the
    row's own category, so it does not follow the split. Measured with a basket
    row attached on top of the test's three other rows: the chart says
    Groceries 61,25 $, Alcohol 15,53 $, Household 5,74 $; the lists say
    Groceries 82,52 $, Alcohol 0, Household 0 (`PROBE` test, run once and
    removed). A list that matches the chart has to show a row once per slice,
    with the slice's amount, which changes `RowsResponse`'s contract and the
    screen, and is a decision, not a piece already specified. Left for the
    orchestrator to file or ask.
- 2026-10-17 — Gate 1 (`8e50f0d4..89ad8b02`) failed with F1 (high), F2 and F3
  (med), F4 and F5 (low). The owner answered each through `AskUserQuestion`, each
  option the gate's recommended one, and the round applies them:
  - **F1: reword and file lg-28.** The `rowsQuerySchema` comment in
    `contract/src/api.ts` and the `countsAsSpending` comment in `api/src/rows.ts`
    said the chart and its list cannot drift; both now say the list files a
    receipted row under its own category until
    [lg-28](./lg-28-make-the-spending-drill-down-follow-a-receipts-split.md).
    Rejected: making the list follow the split in this branch (it changes
    `RowsResponse`). The comments are comment-only edits; `RowsResponse` is
    untouched.
  - **F2: an override wins over the split.** `spendingStats` charts a row whole
    when `row.spendingCategory.source` is `override`, since `receipt_items` is
    never edited and the override is the one correction left. Rejected: keeping
    the split and offering no override on a receipted row; rewording lg-18.
    Cost: overriding a receipted row drops its whole split.
  - **F3: guard on a sign flip.** `splitByCategory` answers `[]` (so the caller
    keeps the row whole) when the remainder would change the sign of the largest
    category; the sentence is added to the Decision above. Rejected: spreading
    the remainder in proportion; keeping it and saying so.
  - **F5: fixed.** The exact costs are 15,5352525 $ and 5,7372525 $, in the
    block comment of `books/test/receipts.test.ts` and in this Log.
  - **F4: left as recorded**, as the coordinator asked. The gate's example
    (10,00 $, 10,00 $ and a −15,00 $ discount in category 5, charged 8,00 $ with
    a 3,00 $ tip) is not changed by the guard: the largest category is the
    discount, −15,00 $ becomes −12,00 $, the sign is the same, so the guard does
    not fire.
  - **Not covered by the guard, and said so:** the gate's third case, a 100,00 $
    charge against a 24,77 $ basket (a remainder of 75,23 $), does not change the
    largest category's sign (15,54 $ becomes 90,77 $), so by the owner's wording
    it is still split. `books/test/receipts.test.ts` › "a remainder is still
    split when it leaves the largest category's sign alone" pins that. Whether to
    chart it whole too is an open decision for the owner (reported, not settled).
    **Answered, 2026-10-17:** the owner was asked through `AskUserQuestion`,
    with the options "Keep the sign guard as worded", "Also: remainder > largest
    category" and "Also: a threshold I'll name", and chose **keep the sign guard
    as worded**. The build already matches, and the pinning test stays. The
    orchestrator's round-1 dispatch had wrongly said the 10 000 case would chart
    whole; the builder raised that it would not, and this is the answer.
  - Tests, each failing without its fix (the fix removed, the two tests'
    spec files run, then restored): F3 in books, "a basket part paid by card
    gives no split" and "a purchase's receipt on a refund row gives no split",
    and through the route "a basket part paid by card, and one filed on a refund
    row, chart whole (F3)"; F2 "an override on a receipted row moves the chart:
    the row charts whole under it (F2)". With both fixes removed, 4 failed and 68
    passed of 72.
  - Fold-in: lg-28 is filed, not folded in, since it changes `RowsResponse` and
    the screen (a decision the owner already took).
