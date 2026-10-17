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
5. On a period line, an item marked as the other's produces a charge equal to its
   excluded amount, and the receipt still reconciles: shared + not shared +
   charged = total. (On a joint-account row every item is shared: decision 3.)
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

## Decisions after gate 1 — answered 2026-10-17 by the owner, not open

Gate 1 (at `be6e4053`) returned CONCERNS with no `high`. The orchestrator put
these to the owner through `AskUserQuestion`, labelled here by the gate's finding
numbers and numbered on from the two above. They also settle the three open
decisions in the builder's first report: its (1) is decision 3, its (2) is
decision 6, and its (3) is amended by decision 4.

**3 (F1). The question was:** an item marked not shared, or the other's, on a
receipt attached to a joint-account row is refused with a 400, and the brief
never says what a row should do. Options: **(a)** keep the refusal, record it
here, reword Done when 5 to "on a period line", and change the refusal's text, in
the API and on the screen, to say a receipt on a row is shared whole without
pointing at a line; **(b)** allow both on a row, which needs a rule for who owes
whom for money that left the joint account. **The answer: (a)**, the builder's
recommendation and the gate's.

**4 (F3). The question was:** a merchant's last category reads the line as it
was filed, so a correction of that line (`correctLine`) is ignored. Options:
**(a)** follow the `supersedes` chain to the line's standing version; **(b)**
leave it as filed and say so. **The answer: (a)**, the gate's recommendation. It
amends the builder's own definition of "its last category".

**5 (F2). The question was:** a misread taxable mark moves money between shared
and not shared and nothing flags it, while the reader's comment said the
reconciliation catches an item misread. Options: **(a)** correct the comment
now and file a ticket for a non-blocking flag; **(b)** add the flag in this
round; **(c)** correct the comment only. **The answer: (a)**, the gate's
recommendation. The ticket is
[lg-26](./lg-26-flag-taxable-marks-that-do-not-give-the-printed-taxes.md).

**6 (F5). The question was:** lg-9 (Build 1) and lg-15 (Build 7) promise a joint
row's spending split by its receipt items' categories "once lg-10 lands", and
nothing owns that work. Options: **(a)** file a ticket for it and point both
sentences at it; **(b)** leave both tickets as they read. **The answer: (a)**,
the builder's recommendation and the gate's. The ticket is
[lg-27](./lg-27-split-a-joint-rows-spending-by-its-receipt-items.md), and its
allocation rule is its own Decision.

Gate 1's F6 (the shipped rate table is asserted ordered by no test) is fixed in
the same round. F4 (the rates written out in `FLAG_LABELS["tax-differs"]` and in
the contract's doc for `tax-differs`) stays recorded and is not fixed.

## Decision after gate 2 — answered 2026-10-17 by the owner, not open

**7 (N1). The question was:** a line since removed still sets its merchant's
category, because the retirement copies the line. What should happen? Options:
**(a)** keep counting it; **(b)** skip removed lines, falling back to the
filing's items and then to older filings. **The answer: (a), keep counting it**,
the builder's recommendation and the gate's. Gate 2's N2 and N3 were fixed at
the landing, by the owner's choice of the same day.

## Log

### 2026-10-16 — built (Claude Opus 5.5, builder), gate pending

**What was built.**

- **`contract`.** `ReceiptItem` (`text`, `price`, `taxable`, `deposit`,
  `spendingCategoryId`, `share`) and `ITEM_SHARES` (`shared`, `not-shared`,
  `theirs`). `ReceiptProposal.items`, which the request schema defaults to `[]`,
  so a receipt typed in with no items files on its total as lg-8 filed one.
  The flag `items-differ`, `CheckedProposal.merchantCategoryId`,
  `ReceiptFiling.chargeLineId`, and the error code `RECEIPT_DOES_NOT_ADD_UP`
  (422).
- **`books`.** `SALES_TAX_RATES` and `ratesOn` replace the two constants
  (decision 2), and `checkReceipt` reads them by the receipt's date.
  `itemsAddUp` is Build 3's reconciliation. `sharedAmount(receipt, excluded,
rates)` is Build 2, exact in `bigint` hundred-thousandths of a cent and
  rounded once, half-up and away from zero. `splitReceipt` is the three-way
  split; it computes the other's part exactly as an excluded one.
- **`receipts`.** The schema and the prompt add the items and a category name
  per item. `read(photo, signal?, categories?)` takes the list, and an item's
  name is folded and mapped to an id. A name not in the list is dropped
  (decision 1). An item with no price or no text read is left out, and
  reconciliation flags the gap.
- **`api`.** Migration 9 adds `receipt_items` and `receipt_filings.charge_line_id`.
  A read offers the non-retired list, drops any item id outside it (whatever
  reader is plugged in) and answers `merchantCategoryId`. Filing:
  - it refuses items that do not make the total, and an item category not in
    the list;
  - on a line, it files what was charged less the not-shared and the other's
    parts, plus a charge line to the other person;
  - on a row, it refuses any item that is not shared;
  - it stores the items.
- **`web`.** The item list:
  - each item's text, price, deposit, taxable mark and category are editable,
    and items can be added and removed;
  - a tap cycles an item's share, and "Not shared · sam's · Shared" updates
    live from `splitReceipt`;
  - every picker lists the merchant's last category first, and the line's
    picker starts on it;
  - filing is refused while the items do not add up.

**Done when.**

| Line | Proved by                                                                                                                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `books/test/receipts.test.ts` › the items (lg-10) › "takes a taxable excluded item and its deposit off the shared amount, to the cent" (15,54 $ off, 9,22 $ shared, sum 24,76 $), and `api/test/receipts.test.ts` › "an item not shared, with its deposit and taxes, comes off the line, to the cent" (line 922) |
| 2    | `api/test/receipts.test.ts` › "a receipt whose items do not add up to its total cannot be filed, and files once corrected" (422 `RECEIPT_DOES_NOT_ADD_UP`, no line, filing or item stored)                                                                                                                       |
| 3    | `books/test/receipts.test.ts` › the dated rates (lg-10) › "a rate change mid-year uses the rate in effect on the receipt's date" (11,50 $ on 2026-06-30, 11,60 $ on 2026-07-01, with an invented table)                                                                                                          |
| 4    | `api/test/receipts.test.ts` › "a merchant's previous category is proposed first on its next receipt", and `web/test/receipts.test.tsx` › "each item's category is editable, and the merchant's last category is proposed first"                                                                                  |
| 5    | `api/test/receipts.test.ts` › "an item marked as the other's becomes a charge equal to its excluded amount, and the receipt still reconciles" (348 + 574 + 1 554 = 2 476), and `books` › "splits three ways…"                                                                                                    |
| 6    | preflight; see the report                                                                                                                                                                                                                                                                                        |

**What the brief left open, and what was done with it.**

- **A tip.** Build 5's "the period line carries the shared amount" is read as
  what the card was charged less the parts off, so a tip stays shared.
  `sharedAmount` takes the printed total as Build 2 says, and `splitReceipt`
  takes what was paid.
- **A receipt on a joint-account row** (lg-8's other destination). The Build
  does not say what an item not shared, or the other's, means when the money
  left the joint account. This build refuses both (400): the items are stored
  for their categories, and every one is shared. This is an open decision in
  the builder's report, not a choice made here.
- **"Its last category"** is a merchant's newest filing that was given one. That
  is the category of the line it became, else the category most of its items
  were given; a retired category is not proposed. The merchant is matched
  folded, as a rule matches a description. The line's picker starts on it; an
  item keeps the model's proposal, and per decision 1 a dropped one is not
  replaced.
- **Nothing left to file.** A receipt whose items are all not shared, with no
  tip, is refused (400): a filing must name a line, and migration 8's `CHECK`
  holds that.
- **The rate table starts on 2013-01-01**, when QST became 9.975 % of the price
  alone. A receipt dated earlier is taken at that entry, and one with no date at
  the latest.
- **The prompt's lg-10 lines are unmeasured on real photos.** No key was
  available, and every test answers from fixtures.
- **For lg-23.** `fileLines` in `api/src/receipts.ts` takes "the other person"
  as the first person who is not the payer. A household of more than two needs
  the request to name who is charged. Nothing here touches `periods` or
  `Settlement`.

**Fold-ins.** lg-9's Build 1, the receipt split of a joint-account row's spending
by its items' categories, is the piece this work brings closest. It is not
folded in. How a row's taxes and any tip divide among categories is a rule
nobody has written, so the work is not "already specified". The stale comment
on `spendingStats` now says so. It is an open decision in the builder's report.

**Commands.** `npx vitest run tools/ledger/books/test/receipts.test.ts` gave 30 of
30; `npx vitest run tools/ledger/receipts/test/reader.test.ts` gave 19 of 19;
`npx vitest run tools/ledger/api/test/receipts.test.ts` gave 44 of 44;
`npx vitest run tools/ledger/web/test/receipts.test.tsx` gave 14 of 14;
`npm run check` exited 0. `npm test -- --project ledger` first gave 1 081 of
1 083: `auto-file.test.ts` asserts the latest migration number (8), bumped to 9
as lg-8 had bumped it. The rerun of that file gave 24 of 24.

**Not measured.** No red/green by mutating the source: the harness's classifier
refused a temporary edit to `itemsAddUp`. Each new test's failure before this
branch is implied by the behaviour not existing on `main`; no command showed it.
(Gate 1 then ran seven mutations of its own, and none survived.)

### 2026-10-17 — gate 1's round (Claude Opus 5.5, builder), gate re-check pending

This round answers gate 1's findings, as the owner decided them above:

- **F1 (decision 3).** Done when 5 now reads "on a period line". The refusal on a
  row, in `fileReceipt` and on the screen, now says "A receipt on a joint-account
  row is shared whole: every item on it stays shared." It no longer sends the
  person to file the receipt as a line. New test: `api/test/receipts.test.ts` ›
  "a joint-account row's items (lg-10 gate 1, F1)" › "refuses an item marked as
  the other's on a row, files nothing, and says the row is shared whole". The
  web row test now also asserts the text names no line.
- **F3 (decision 4).** `merchantCategory` follows the `supersedes` chain from the
  filed line to its newest version, with a recursive CTE. New test:
  `api/test/receipts.test.ts` › "a merchant's last category, corrected (lg-10
  gate 1, F3)" › "is the category of the line as it now stands, not as it was
  filed". It corrects a filed Pharmaprix line from Groceries to Pharmacy through
  `POST /api/period-lines/:id`.
- **A removed line is open.** The chain from a removed line ends on the
  retirement, which copies the line's last category, so that category still
  counts. No test pins it either way. Whether a removed line should still count
  is open, in the builder's report.
- **F2 (decision 5).** The reader's comment now says the reconciliation catches
  a misread price or deposit, not a misread taxable mark. Filed
  [lg-26](./lg-26-flag-taxable-marks-that-do-not-give-the-printed-taxes.md).
  The reproduction was re-run here with the gate's `taxable-mark.mjs`: as
  printed, flags `[]` and shared 922; the six-pack misread, flags `[]` and
  shared 1 117.
- **F5 (decision 6).** Filed
  [lg-27](./lg-27-split-a-joint-rows-spending-by-its-receipt-items.md). lg-9's
  Build 1 sentence, lg-15's Build 7 sentence and the `spendingStats` comment
  now point at it.
- **F6.** New test: `books/test/receipts.test.ts` › "the shipped rate table
  (lg-10 gate 1, F6)" › "is oldest first, with each day once". Its helper is
  also shown to be false on a table with an entry out of order and on one with a
  day given twice.

**Red first.**

- The F1 and F3 tests were run against this branch's source at `be6e4053`,
  before any fix:
  `npx vitest run tools/ledger/api/test/receipts.test.ts -t "gate 1"` gave
  "expected 1 to be 4" for F3 and "expected 'A receipt on a joint-account row is
  s…' not to contain 'line'" for F1, so 2 failed. Both pass after the fix.
- The web assertion's red is the old text, read with
  `git show be6e4053:tools/ledger/web/src/receipts/Receipts.tsx`: "…shared
  whole: file it as a line to leave items out.".
- The F6 test is a guard on a table already in order, so it cannot fail against
  `be6e4053`. Its two `false` cases show the check can fail.

**Commands.**

- `npx vitest run` on the four touched specs gave 110 of 110: books 31, reader
  19, api 46, web 14.
- `npm test -- --project ledger` gave 1 086 of 1 086, 60 files.
- `npm run check` exited 0, and `node scripts/status.mjs --json` exited 0 with
  lg-26 and lg-27 in.

### 2026-10-17 — landing

- 2026-10-17 — Fixed at landing by owner choice: gate 2, N1 — "Whichever the
  owner picks, add one test that pins it and rewrite the comment to state it as
  decided, at the landing." (The answer is decision 7.)
  `npx vitest run tools/ledger/api/test/receipts.test.ts -t "a line since removed still sets its merchant's category"`
  → `Tests  1 passed | 47 skipped (48)`.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, N2 — "A
  `WHERE chain.depth < 10000` on the recursive step closes it."
  `npx vitest run tools/ledger/api/test/receipts.test.ts -t "still answers when a hand-edited file makes a line supersede itself"`
  → `Tests  1 passed | 47 skipped (48)`. Before the guard, the same file under
  `timeout -k 5 60 … -t "gate 2" --pool=threads` → `exit=124`, with no result
  in 60 s.
