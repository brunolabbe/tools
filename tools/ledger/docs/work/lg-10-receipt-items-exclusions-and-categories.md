---
id: lg-10
tool: ledger
title: Read a receipt's items, split out what is not shared or is the other's, and categorise
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-17 · `76ce7d52..be6e4053` · Sonnet 5.5, depth full (`hard`)

No `high`. One `med` a `Done when` line depends on (F1, an open decision for the owner); two more `med` that no line depends on (F2, F3). Gate 1 of 2.

| Done when                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Taxable excluded item and its deposit at GST 5 % / QST 9.975 %: shared amount to the cent; excluded + shared = total | `books/test/receipts.test.ts` › "takes a taxable excluded item and its deposit off the shared amount, to the cent" (1 554 excluded, 922 shared, sum asserted equal to the 2 476 total, default table) ✓, and `api/test/receipts.test.ts` › "an item not shared, with its deposit and taxes, comes off the line, to the cent" (the stored line is 922 cents) ✓. Red when the rounding is truncated, and when the deposit is taxed (below). Independent sweep: 0 mismatches in 32 166 adding receipts.                                                                                                                 |
| 2. Lines that do not add up to the total cannot be filed; an API test proves it                                         | `api/test/receipts.test.ts` › "a receipt whose items do not add up to its total cannot be filed, and files once corrected" (422 `RECEIPT_DOES_NOT_ADD_UP`; no line, filing or item stored; then 200 once corrected) ✓. **Positive control:** with `itemsAddUp` forced to return true, this test and four more go red.                                                                                                                                                                                                                                                                                                |
| 3. A rate change mid-year uses the rate in effect on the receipt's date                                                 | `books/test/receipts.test.ts` › "a rate change mid-year uses the rate in effect on the receipt's date" (11,50 $ on 2026-06-30, 11,60 $ on 2026-07-01, invented table passed in) ✓, and › "the check reads the same dated rates" ✓. Red when `ratesOn` ignores the date (both go red). The shipped table has one entry, so the proof is on an invented table by design.                                                                                                                                                                                                                                               |
| 4. A merchant's previous category is proposed first on its next receipt                                                 | `api/test/receipts.test.ts` › "a merchant's previous category is proposed first on its next receipt" (`merchantCategoryId`, the same merchant spelled differently, another merchant gets none) ✓ and › "a merchant last filed on a row is proposed the category most of its items were given" ✓; `web/test/receipts.test.tsx` › "each item's category is editable, and the merchant's last category is proposed first" (option order) ✓. Red when `merchantCategory` returns null (two go red). Holds for the category as filed only: see F3.                                                                        |
| 5. An item marked the other's produces a charge equal to its excluded amount; shared + not shared + charged = total     | **On a period line, proven:** `api/test/receipts.test.ts` › "an item marked as the other's becomes a charge equal to its excluded amount, and the receipt still reconciles" (348 + 574 + 1 554 = 2 476; the charge is 1 554, charged to the other person, and both read back through the open period) ✓; `books/test/receipts.test.ts` › "splits three ways, each part off computed alike, and the three make the total" ✓. Red when the charge is not filed (two go red). **On a joint-account row: unproven (open decision)** — the build refuses the item and no test marks an item the other's on a row; see F1. |
| 6. Gates green                                                                                                          | `npm run check` exit 0 (run here). `npx vitest run --project ledger` 1 083 of 1 083, 60 of 60 files (run here). PR #498 at `be6e4053`: `check` ×2, `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review`, `test (ubuntu-latest)` and `test (windows-latest, informational)` all SUCCESS ✓.                                                                                                                                                                                                                                                                                                                    |

**Red/green at the base.** The branch's seven touched specs (141 tests) with the whole ledger `src` put back at the base and rebuilt: 55 of 141 fail, 86 pass, `contract`/`books` `dist` shown to hold no `splitReceipt` / `RECEIPT_DOES_NOT_ADD_UP`. With only `books/src` at the base: 39 of 141 fail. With only `api/src/receipts.ts` at the base: 14 of 141 fail. Seven single-line mutations of the head, each restored and the tree shown clean: itemsAddUp always true (5 red), `ratesOn` ignoring the date (2), rounding by truncation (8), the deposit taxed (7), `merchantCategory` returning null (2), the charge never filed (2), an off-list category id let through the read (1). None survived.

**Money, by a second method.** 40 000 seeded receipts (1 to 14 items; discounts and returned items; refunds; totals a cent to three cents out on a fifth), the branch's `splitReceipt` and `sharedAmount` read against an exact `Fraction` reference in Python: 0 mismatches in the 32 166 that add up, and the 7 834 that do not are refused by `itemsAddUp` exactly where the reference says. Among the 32 166, the excluded groups held 2 166 exact half-cent ties, 6 333 negative totals and 19 636 deposits, and 5 767 receipts carried a tip. The sweep can fail: rounding each item instead of the group gives 15 793 mismatches, half-even gives 2 949. Through `fileReceipt` on a migrated database: 6 000 receipts, 5 653 filed, 347 refused, 0 mismatches against the reference; in every filed case the filed lines plus the not-shared part equal the amount charged, to the cent, and the refusals are exactly the two the code names.

- **med** · **a `Done when` line depends on it (5)** · **open decision, for the owner** · F1 — an item that is not shared, or the other's, on a **joint-account row** is refused with a 400, and the brief never says what a row should do. The ticket's Decisions record two choices and not this one; the Log calls it open. `fileReceipt` throws `BAD_REQUEST` for any `share` other than `shared` when the destination is a row, and the screen refuses the same before asking. `api/test/receipts.test.ts` › "a receipt on a joint-account row keeps its items' categories, and refuses an item left out" asserts the refusal with a not-shared item; **no test marks an item the other's on a row**, at either layer. Read literally, Done when 5 ("an item marked as the other's produces a charge") is not met there; read with Build 5 and 6 (the period line carries the shared amount; a charge is lg-6's) it is a line-only promise. No test asserts the opposite of the line for `theirs`, so this is `unproven (open decision)` and not a `high`. The refusal text is also wrong for the case a row exists for: it says "file it as a line to leave items out", and a line is paid by whoever uploaded the photo, so filing a purchase that left the joint account as a line adds a contribution the person did not make (`receipts.ts` header: "not a line since the money already left the buffer"). **Options:** (a) keep the refusal, record it in the ticket's Decisions, reword Done when 5 to "on a period line", and change both texts to say the receipt on a row is shared whole without pointing at a line; (b) allow `not-shared` and `theirs` on a row, which needs the owner to say who owes whom for money that left the joint account, and what the row's amount becomes. **Recommendation: (a).** Reproduce: `git show be6e4053:tools/ledger/api/src/receipts.ts` and read the `else` branch of `fileReceipt`.
- **med** · no `Done when` line depends on it · F2 — **a misread `taxable` mark changes the money and nothing flags it**, while `receipts/src/reader.ts` says "the reconciliation check is what catches an item misread". `itemsAddUp` sums prices, deposits and the printed taxes and never looks at `taxable`; `taxesFit` asks only whether some part of the subtotal gives both taxes. Reproduce (`node` on the built `books`, receipt = the branch's own basket, bread 3,49 $ untaxed, six-pack 12,99 $ taxable with a 0,60 $ deposit marked not shared, soap 4,99 $ taxable): marked as printed, `checkReceipt` gives `[]` and the split is shared 922, not shared 1 554; with the six-pack misread as not taxable, `checkReceipt` still gives `[]` and the split is shared 1 117, not shared 1 359 — 1,95 $ moved to the shared side, the screen saying "It adds up." The person sees a Taxable box per item and can fix it; the model's reading of the tax code is unmeasured on real photos (the Log says so). **Options:** (a) add a non-blocking flag when the taxable items' prices do not give the printed GST and QST by the same arithmetic `taxesFit` uses, here or as a follow-up ticket carrying this reproduction; (b) leave it to the person and correct the comment so it does not promise the check catches an item misread. **Recommendation:** (b) at the landing, (a) as a ticket. The comment's falsehood runs the unsafe way (it overstates coverage) but its readers are maintainers, not the person, hence `med` and not `high`.
- **med** · no `Done when` line depends on it · F3 — **"its last category" ignores a correction of the filed line.** `merchantCategory` in `api/src/receipts.ts` joins `period_lines` on the id the filing named, which is the version as filed; a correction is a new row that supersedes it (`correctLine`), so the next proposal for the merchant is still the first category. Reproduce (a temporary spec in `api/test/`: migrate in memory, file a 20,00 $ Pharmaprix receipt as a line under Groceries (1), `correctLine` it to Pharmacy (3), call `merchantCategory(db, "Pharmaprix", ids)`): returns 1, not 3. A removed line (`retireLine`) also still counts, which may be intended. Done when 4 holds as filed. **Options:** (a) follow the `supersedes` chain from the filing's line to the standing version (a recursive CTE, or the view's row whose chain reaches it); (b) leave it as filed and say so in the comment. **Recommendation:** (a), a few lines and one test.
- **low** · `nfr:maintainability` · F4 — the rates are written out in two places that a rate change will not touch: the web label `FLAG_LABELS["tax-differs"]` ("not 5 % and 9.975 %") and the contract's doc on `tax-differs`. Decision 2 and `SALES_TAX_RATES`' own comment say a rate change is "an entry added" to the table; after the first one the label tells a person the wrong rates. False in the safe direction (it is a hint, the arithmetic is right). Both pre-date the branch; the branch is what makes them stale-able.
- **low** · F5 — lg-9 promises the receipt split of a joint row's spending "once lg-10 lands" (Build 1; its Log: "it arrives with lg-10"), and lg-15 says the same; lg-10's brief has no such line, the build rightly leaves it (how a row's taxes and tip divide among categories is decided nowhere), and the `spendingStats` comment now says so. Nothing owns the work: it is stated as arriving here and does not. **Options:** (a) file a ticket for it and point lg-9's and lg-15's sentences at it; (b) leave both tickets as they read. **Recommendation:** (a), in this pull request, since the sentences are false once it merges. Reproduce: `grep -n "lg-10" tools/ledger/docs/work/lg-9-history-and-stats.md tools/ledger/docs/work/lg-15-spending-categories-on-bank-rows.md`.
- **low** · F6 — `SALES_TAX_RATES` must be oldest first with each `from` once: `ratesOn` takes the last entry whose day has come, in array order. Documented, asserted by nothing; the first rate change is the call site, and an entry added out of order silently gives a receipt the wrong rate. A one-line test of the shipped table (ascending, unique) closes it.
- **dropped** · the new code `RECEIPT_DOES_NOT_ADD_UP` (422) as unjustified or wrong: no core code fits (it would mean nothing to a tool that never heard of receipts), `RECEIPT_UNREADABLE` is the model failing, `STATEMENT_TOTAL_MISMATCH` is a paste; the ledger `CLAUDE.md` has a code arrive with the ticket that first throws it, with its status in `http-errors.ts` in the same change, and both are. Exhaustive maps over the unions: `DEFAULT_ERROR_MESSAGES`, `FLAG_LABELS` and `NEXT_SHARE` are typed `Record`s and carry the new members; `STATUS_BY_CODE` is `Partial` and has it; no web map keyed by error code exists. None missed.
- **dropped** · `BAD_REQUEST` with call-site copy at four raise sites in `fileReceipt`/`fileLines`, against the rule that re-worded copy means the wrong code: the same tool already does this for semantic refusals at the base (`requireLinePeople`, `requireFreeName`), and `BAD_REQUEST`'s own doc allows it. A house pattern, not this branch's.
- **dropped** · the categories sent to the model unbounded or unescaped: the list is `JSON.stringify` of names (escaped), each at most 60 characters by `spendingCategoryDraftSchema`; the count has no cap, a household-authored list with no live call site. The model's answer maps by folded name to an id of the offered list, and the API drops any id outside it again (`withOfferedCategories`) and refuses one at filing (`requireSpendingCategory`): an off-list id never reaches storage by the API path (the mutation that lets one through goes red).
- **dropped** · "the first person who is not the payer" as the charge target: the tool has at most two names ever (ledger `CLAUDE.md`), `fileLines` refuses when there is no other, and a charge as lg-6 files it is a line by the payer with `chargedTo` the other, which is how `cumulativeSettlement` reads it. The web names the same person by the same rule.
- **dropped** · the sign guard when the typed charge is negative or `sharedAmount` is handed repeated or out-of-range places: the first is typed by the person against their own items, the second is called only with places read from the items. No live call site.
- **dropped** · migration 9 as unsafe: it is appended and migrations 1 to 8 are untouched; it applies on a database at 8 holding a filing (`api/test/schema.test.ts` › "keeps a filing stored before it, with no charge and no items, and refuses an item's unknown share"); the code only inserts into `receipt_items`; each household has its own file, and `api/test/isolation.test.ts` sweeps every table read from `sqlite_master` with a write that now carries an item.
- **findings** · the hunt returned 12 candidates; 6 carried (F1 to F6), 6 dropped.
- Invariants walked: tool boundary ✓ (no import from another tool); `AppError` codes ✓; contract edits are additive and follow the ticket's Build, the code with its status (the Decisions say "neither is a contract decision" of the two gaps they settle, and the contract additions are not discussed there); new tests registered ✓ (no new spec file, seven existing ones touched, all in the ledger project); `Dockerfile` ✓ (no new workspace); routes ✓ (none added, the isolation route-coverage test passes); style ✓ (`npm run check`). Skipped: shell, SSRF, redaction (no new logging of an item or a URL), progress.
- NFR: security ✓ (isolation, category ids validated, prompt escaped; category names travel to the model with the photo, which the screen names before sending) · performance ✓ (`merchantCategory` scans a household's filings per proposal, trivial at this size) · reliability — filing is one immediate transaction and every refusal leaves nothing stored (tested); the real model's answer to the new nested schema is **unmeasured** (no key, fixtures only) · maintainability — F4, F6.
- Unmeasured: Haiku's reading of items, deposits and tax codes on a real photo; Anthropic accepting the new output schema; the screen in a real browser (the component tests are the proof).

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
