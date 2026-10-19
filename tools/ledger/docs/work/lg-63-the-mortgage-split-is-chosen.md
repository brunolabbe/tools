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
