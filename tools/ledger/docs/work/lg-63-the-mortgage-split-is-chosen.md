---
id: lg-63
tool: ledger
title: A household chooses how the mortgage splits — shares, equally, or at the ratio — from a date
kind: work-package
status: ready
milestone: null
depends_on: [lg-23]
difficulty: hard
---

# lg-63 — A household chooses how the mortgage splits, from a date

## Why

`docs/00-ANALYSIS.md` §4 attributes every dollar in the mortgage bucket to one
person: `own = deposits − share of payments`. The share is not a setting.
`mortgageAsOf` (`books/src/buckets.ts`) and `mortgageOwnSeries`
(`books/src/stats.ts`) add up every joint row in the bucket **ever** and divide
the total equally (`splitCents(joint, ids.length)`) among everyone the books
have held up to that date. That is 50/50 for the household of two the tool was
built for, and it has two problems:

- **A household cannot say its split is not equal**, or that it follows the
  salaries the way the buffer does.
- **Adding a person re-splits the past.** Because the cumulative total is
  divided again whenever a name is added, a newcomer takes a share of every
  payment made before they joined. lg-23's reproduction measured it: with
  `casey` added to books of `alex` and `sam`, `/api/buckets` read `casey −23334`,
  `alex 26666`, `sam 16667`, where it had read `alex 14999`, `sam 5000`.

On 2026-10-19 the owner asked for the split to be configurable, and chose this
shape (below).

## Decision — answered 2026-10-19 by the owner

How should the mortgage split be configurable?

- **Dated shares** — a household sets each person's part, effective from a
  date, stored like a ratio.
- **Follow the salary ratio** — each payment split at the ratio in effect on its
  date; no new setting.
- **One undated setting** — one set of parts per household; changing it
  re-attributes the whole history.

**Answer: all three as modes of one dated record.** From a date, the household's
mortgage splits **by shares** (parts it names), **equally**, or **at the ratio**
in effect on each payment's date. Each payment is split by the record in effect
on _its_ date, so a later record never moves an earlier payment. Filed `ready`
and independent of [lg-55](./lg-55-a-household-with-no-mortgage.md); the two
touch the same card and the seam-mapper orders them at intake.

## Decision — answered 2026-10-20 by the owner, asked at intake

When a person retires at a close (lg-35) while a dated `shares` record is in
effect, how are later joint mortgage payments split?

1. **Redistribute pro rata** (recommended): from the retirement date, the
   retired person's part goes to the remaining people in proportion to their
   own parts, until a new record is filed. The sum always holds, nobody has to
   act, and the Own money card marks the change as it does for a new record.
2. **Fall back to equal**: the shares record lapses on the retirement date.
3. **Refuse the retirement** while a shares record names that person.

**Answer: 1, redistribute pro rata.** For `equal`, lg-35's rule already holds:
the retired person is out from the retirement's date, and Build 2's "people
the books hold on the payment's date" adds that a person is out before they
are first named. For `ratio`, the ratio confirmed at the close names only the
people who remain. A test covers a retirement under each of the three modes.

## Build

The contract change is the owner's decision above; it licenses this record and
nothing else in `@ledger/contract`.

1. **The record, in each household's books** (`api/src/db/schema.ts`, the next
   migration — append it, check `main` for the number at build time, since
   lg-55 also adds one). In the shape of `ratios` and `ratio_shares`: a
   `mortgage_splits` table with `effective_from` (`yyyy-mm-dd`), `mode`
   (`shares` · `equal` · `ratio`, a CHECK), `supersedes`, `entered_at`,
   `entered_by`; a `mortgage_split_shares` table of parts per million per person
   for `shares` only, summing to 1 000 000 (the API derives nothing here — it
   refuses a set that does not sum, as a test proves); and a `current_…` view so
   one record stands per date. Appended, never edited.
2. **What "equally" means now.** Equally among the people the books hold **on
   the payment's date** — not everyone ever. People change only at a close
   (lg-23, `confirmRatio`), so a ratio in effect on the date names them; with no
   ratio in effect, the people the bucket's rows have named by that date.
3. **What "at the ratio" means.** The ratio in effect on the payment's date
   (`ratioInEffect`, `books/src/ratio.ts`), its `ratio_shares` as they were
   confirmed — a corrected salary never moves a confirmed ratio, so it never
   moves the mortgage either. A payment dated before any ratio splits equally,
   and the Own money card's table says so on that row.
4. **No record means `equal`**, from the first row. For a household whose people
   never changed — every household today — every figure reads exactly as it
   does now. Only a household that gained a person sees the past stop moving,
   which is the defect above.
5. **The arithmetic** (`books`, pure). `mortgageAsOf` and `mortgageOwnSeries`
   take the records and split **each joint row** by the record in effect on its
   date, accumulating per person. They stay one rule kept in two shapes, as
   today's comments say. Traps:
   - **Odd cents.** Today the odd cent is split once, on the cumulative total.
     Splitting per row with `splitCents` gives the odd cent to the first person
     every time, which drifts over hundreds of payments. Carry the remainder so
     the cumulative attribution is what one split of the total would give for a
     constant split, and say how in a comment.
   - **The sum.** `mortgageAsOf` throws if the parts do not sum to the balance;
     keep that, and add the same assertion to a test of the series.
   - **Two callers outside stats.** `books/src/workbook.ts` and
     `api/src/workbook-import.ts` call `mortgageAsOf` to check an import
     against the workbook, which is 50/50. With no record they must read as
     today; pass no records there, and keep their tests unchanged.
6. **The contract and the route** (`contract/src/api.ts`). Read the records,
   file one (mode, effective date, and parts for `shares`), and supersede one —
   the shape `ratios` uses. A `shares` record names exactly the people the books
   hold on its date; anything else is refused with a ledger code added in
   `contract/src/errors.ts` with its status in `api/src/http-errors.ts`. An
   effective date after today is refused by the schema. Any member may file one,
   as with a ratio; `rateLimitsFor(context).read` / `.write`, and
   `route-limits.test.ts` and `isolation.test.ts` pick the route up by
   themselves — make sure they do.
7. **The screens.**
   - A form beside the salaries and the ratio (`web/src/salaries/`): the mode
     standing today, its history, and filing a new one from a date, with the
     parts for `shares`.
   - **Own money card** (`web/src/stats/Cards.tsx`): the caption stops saying
     "less half of every payment" and says each person's share as the records
     set it. A range that crosses a change marks it, as a renewal is marked on
     the payment card, with the new mode in its note.
   - **Home** (`web/src/home/Home.tsx`): `leadSentence` is unchanged — it
     compares own money, which the split already decided.
8. **Docs.** `docs/00-ANALYSIS.md` §4: the formula becomes
   `own_P = deposits_P − Σ share_P(date) × payment`, the three modes, and that a
   later record never moves an earlier payment. The comments in
   `books/src/buckets.ts` and `books/src/stats.ts` that say "half" say the rule.

## Done when

1. A `books` test splits one history under each mode and finds each person's own
   money as the mode says, and the parts summing to the balance on every day.
2. A `books` test files a second record from a later date and finds every
   payment before it attributed exactly as before.
3. A `books` test adds a third person at a close and finds the first two's own
   money before that date unchanged — lg-23's reproduction, no longer moving.
4. A `books` test with no record finds today's figures for a household of two,
   and the workbook import's tests pass unchanged.
5. A `books` test splits many odd-cent payments equally and finds the parts
   within one cent of each other at the end.
6. An API test files each mode, refuses `shares` that do not sum or name the
   wrong people, refuses a date after today, and supersedes a record.
7. A web test renders the Own money card over a range that crosses a change and
   finds the marker and the new caption.
8. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-19: filed from the owner's question whether the mortgage split is a
  hard-coded 50/50. It is not a constant: it is equal among everyone the books
  have held, re-split over every past payment, which lg-23's table measured. The
  owner chose a dated record with three modes, `ready`, independent of lg-55.
- 2026-10-21 — Built on `lg-63-mortgage-split-modes` from `main` at `2d1b22bb`.
  The owner's answer of 2026-10-20 (a retirement under `shares`) is recorded
  above, in the branch's first commit.
  - **What was built.** Migration 15, `mortgage_splits` with
    `mortgage_split_shares` and the `current_mortgage_splits` view (one record
    per day; filing for a day supersedes it, the same split again files nothing).
    `GET`/`POST /api/mortgage-splits`, any member, `read`/`write` limits, a date
    after today refused by `mortgageSplitRequestSchemaOn`, shares that do not
    sum or name a person twice refused by the schema (400), shares naming other
    people than the books hold on their day `MORTGAGE_SHARES_WRONG_PEOPLE`
    (409). In `books`, `split.ts`: `MortgageSplitter` answers each date's
    split, `JointSplit` sums joint rows per split and splits each sum once
    (`apportion`, largest remainders, a tie to the earlier id). `mortgageAsOf`
    and `mortgageOwnSeries` take the ratios and records as a fifth parameter,
    `NO_SPLIT_HISTORY` by default, so `workbook.ts` and `workbook-import.ts`
    pass nothing and read as before. The stats series' points carry the split
    on their day and `splitChanged`; the response carries the split at the
    range's end. A form beside the salaries (`web/src/salaries/MortgageSplit.tsx`);
    the Own money card's caption, markers, notes and a `Split` table column.
  - **What the brief had wrong.**
    - Build 5's odd cent "split once, on the cumulative total" and Build 2's
      "everyone ever" were stale since lg-35 (#583): `mortgageAsOf` already
      took retirements and split through `JointTotals`, one part per set of
      retired people. `JointSplit` replaces it, keyed on the split's weights
      reduced by their divisor, so lg-35's rule is the `equal` case and its four
      tests in `books/test/people.test.ts` pass unchanged — the left-and-came-back
      case included, since a split that returns sums into the same total. That is
      how the remainder is "carried": per split, not per row.
    - Build 2's "with no ratio in effect, the people the bucket's rows have named
      by that date" would leave a joint row before anyone's first deposit with
      nobody to split it (`books/test/stats.test.ts` › "gives the odd cent of a
      joint total to the person who sorts first" is exactly that row), and would
      move the figures of a household of two whose first payment came before the
      second person's first deposit, against Build 4. Built instead: before the
      first ratio, the first ratio's people — the first period's, as
      `requireSamePeopleInOpenPeriod` reads them — or, in books with no ratio at
      all, everyone listed; in both, anyone a row has named by the date. A ratio
      in effect names the people alone.
    - Build 1's migration number: 13 is lg-55's and 14 lg-35's; this is 15, and
      nine `user_version` assertions moved from 14 to 15 (`schema.test.ts`,
      `auto-file.test.ts`, `spending-backfill.test.ts`).
    - Build 5's "add the same assertion to a test of the series": the series
      test already summed its parts (`books/test/stats.test.ts` › "agrees with
      mortgageAsOf …"); `split.test.ts` adds it under every mode.
    - Build 6's sweeps "pick the route up by themselves" by failing until told:
      `route-limits.test.ts` › "every route in the contract is accounted for"
      and `isolation.test.ts` › "covers every route the app answers" both failed
      on the new route, and now walk it (`helpers/routes.ts`, the two-verb list,
      `WRITES` and `READS`).
    - Build 7's card needs the split per day, which the record alone does not
      give: `MortgageOwnPoint` gained `split` and `splitChanged`, and
      `MortgageOwnResponse` `split`, beside the record's own types. A reading of
      the licence "this record and nothing else", put to the orchestrator.
    - Two tests asserted the defect and now assert the fix:
      `books/test/buckets.test.ts` › "a person a row names who was not listed
      still gets their money" (casey −45 433 → 1 234, sam's lead 80 000 → 80 001)
      and `api/test/more-than-two.test.ts` › lg-23's reproduction (alex 26 666,
      casey −23 334, sam 16 667 → 14 999, 0, 5 000).
    - lg-55's `Cards.tsx` collision is gone: it merged first (#581).
  - **Done when**, each with its test:
    1. `books/test/split.test.ts` › "one history under each mode" (four tests).
       The history: `alex`, `casey`, `sam`, every day 2026-01-02 → 2026-08-15;
       deposits on 2026-01-02, 2026-04-01 and 2026-07-02; joint rows of −700.01,
       −700.03, +0.01, −700.01, −700.01, −700.03, −700.01, −700.02 on the 15th
       of January to August; ratios 60 / 15 / 25 % from 2026-01-01 and 70 / 30 %
       from 2026-07-01; casey retired from 2026-07-01; shares 50 / 20 / 30 %. Each
       mode's own money is worked by hand in the test's comments, casey retiring
       under each, and a fourth history changes mode twice (equal, shares from
       2026-04-01, ratio from 2026-08-01). The parts sum to the balance on all
       226 days, as of each day and in the series.
    2. `split.test.ts` › "a record from a later date leaves every day before it
       exactly as it was": 89 days, 2026-01-02 → 2026-03-31.
    3. `split.test.ts` › "a third person added at a close leaves the first two's
       own money before it unchanged", every day 2026-01-02 → 2026-06-30; and
       `api/test/more-than-two.test.ts` through the build.
    4. `split.test.ts` › "with no record, a household of two reads what one split
       of the cumulative total always gave", 200 days, with and without a ratio;
       `api/test/workbook-import.test.ts` and `books/test/workbook.test.ts`
       unchanged and passing.
    5. `split.test.ts` › "many odd-cent payments split equally leave the parts
       within a cent of each other": 500 payments, three people; per-row
       rounding drifts by more than 100 cents on the same rows.
    6. `api/test/mortgage-splits.test.ts` (seven tests).
    7. `web/test/mortgage-split.test.tsx` › "over a range that crosses a change,
       the own-money card marks it and names the new split".
    8. `npm run check` exit 0; `npm test -- --project ledger` 1 658 of 1 658
       in 78 files, exit 0.
  - **Not done, and why.** Under `shares`, a person added at a later close is
    named by no part and takes none until a new record: the parts are the
    household's, and the owner's answer covered a retirement, not an arrival.
    Raised with the orchestrator rather than settled here. Nothing else already
    specified was made free by this work: the other open ledger tickets (lg-38,
    lg-56, lg-58) touch neither the split nor the card.
