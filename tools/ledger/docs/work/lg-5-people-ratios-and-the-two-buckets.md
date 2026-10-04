---
id: lg-5
tool: ledger
title: People, salaries and ratios over time, and what each bucket owes whom
kind: work-package
status: ready
milestone: P2
depends_on: [lg-4]
difficulty: hard
---

# lg-5 — People, salaries and ratios over time, and what each bucket owes whom

## Why

This is the screen the workbook exists to produce: is the mortgage even, and
what is in the buffer ([00-ANALYSIS.md §4–5](../00-ANALYSIS.md)). It also lays
down the salary and ratio history the owner wants charted (§9).

## Build

1. Migration:
   - `people`, holding the display names. The email mapping stays in lg-3's
     configuration.
     - lg-4 already stores a **person id** (`Person.id`, the configured name)
       on rules and classifications, as plain text with no foreign key, and
       serves `GET /api/people` from that configuration. When this table lands,
       point that route at it, and keep the ids equal to the configured names
       so the rows lg-4 stored still name someone.
   - `salaries`: person, amount in cents, year, entered-at.
   - `ratios`: parts per million per person, effective-from date, and the
     salary records it came from, if any.
     All three are append-only, and a correction supersedes the earlier record.
2. `books`, pure:
   - **mortgage:** each person's own money in the bucket, which is their
     deposits − ½ × payments, as of any date.
     - The bucket is **not** shared (analysis §4). The two amounts sum to its
       balance exactly, and nothing in it is common.
     - Rounding: an odd-cent payment's halves differ by a cent. Give the extra
       cent to one person by a fixed rule, and assert that the sum still
       equals the balance.
   - **buffer:** the current-expenses balance as of any date, and each person's
     cumulative contributions to it.
   - **ratio from salaries:** parts per million, rounded half-up, with the two
     people summing to exactly 1 000 000.
3. Money is integer cents throughout. No `number` holding dollars crosses a
   function boundary.
4. `web`:
   - the home screen: each person's own money in the mortgage bucket, who has
     paid extra and by how much, and the buffer's
     balance;
   - a screen for entering a year's salaries, which proposes the derived ratio
     and its effective date for the person to confirm.

## Done when

1. Unit tests on a synthetic history prove:
   - each person's own money in the mortgage bucket, and that the two sum
     to its balance to the cent, including after an odd-cent payment;
   - the buffer's balance as of a past date, where a later row changes the
     present one;
   - that a derived ratio's two halves sum to 1 000 000.
2. Entering a corrected salary keeps the earlier one, and the earlier ratio
   still reads as in effect for its own dates.
3. The home screen shows both figures. A web test proves it.
4. Gates green.

## Log

- 2026-10-04 — Built, on `origin/main` at `3a7d8a9`: migration 3 (`people`,
  `salaries` with `current_salaries`, `ratios` with `current_ratios`, and
  `ratio_shares`) in `api/src/db/schema.ts`; `mortgageAsOf`, `bufferAsOf`,
  `splitCents`, `ratioFromSalaries` and `ratioInEffect` in `books`;
  `api/src/people.ts`, `api/src/buckets.ts` and `api/src/salaries.ts`;
  `GET /api/buckets`, `GET`/`POST /api/salaries` and `GET`/`POST /api/ratios`,
  each rate limited; one code, `SALARY_NOT_FOUND` (404); and in `web` a home
  screen, now the first tab, and a salaries screen.
  - **The suite passes.** `npm test -- --project ledger` → `Test Files 28 passed
(28)`, `Tests 391 passed (391)`; `npm run check` exit 0.
  - **Done when, and where each is proved.** (1) `books/test/buckets.test.ts`:
    "the two sum to the balance to the cent, right after an odd-cent payment",
    "each person's own money is their deposits less half of every payment", and
    "the parts sum to the balance on every date of a long, varied history, and
    never drift"; "its balance as of a past date leaves out a later row that
    changes today's"; `books/test/ratio.test.ts`, "rounds half-up, and the two
    halves still sum to exactly 1 000 000", "on an exact half both would round
    up, so the first takes it and the sum holds" and "sums to 1 000 000 and is
    within half a part of exact, over many salaries". The same, through the
    API, in `api/test/buckets.test.ts`. (2) `api/test/salaries.test.ts`, "keeps
    the earlier record, and the earlier ratio still reads as in effect for its
    own dates". (3) `web/test/home.test.tsx`, "shows each person's own money in
    the mortgage, who has paid extra, and the buffer's balance".
  - **The tests can fail.** Each mutation applied to the source alone and
    restored; books rebuilt where the API reads its `dist`. Dropping the odd cent
    in `splitCents` (`index < 0`): the two bucket suites → `10 failed | 7 passed
(17)`, the API's included, since the sum check throws. The same with the sum
    check disabled → `8 failed | 9 passed (17)`. Rounding each joint row
    separately instead of the cumulative total → `1 failed | 10 passed (11)`,
    the long history's "never drift". Rounding both ratio shares on their own →
    `1 failed | 7 passed (8)` (the exact half); truncating → `2 failed`.
    Ignoring `asOf` in the books → `6 failed | 5 passed (11)`. Taking the latest
    ratio whatever the date → `1 failed | 11 passed (12)`, Done-when 2's test. A
    correction that deletes the earlier salary → 4 failed, the source scan among
    them. The home screen showing the mortgage's balance as the buffer's, or the
    first person's amount on both lines → `1 failed | 2 passed (3)` each.
    `GET /api/people` answered from the configuration again → `1 failed`.
  - **The seam facts held.** `routes/rules.ts` served `GET /api/people` from
    `peopleOf(context)` with "lg-5 gives people a table of their own"; the schema
    had no `people` table; new routes take `rateLimitsFor`. All four checked
    before relying on them.
  - **Decisions the brief left open, made here.**
    - **People.** `people(id, added_at)`, where `id` is the configured name,
      which is what is shown. Boot adds each name `ACCESS_PEOPLE` holds that the
      table does not (`INSERT OR IGNORE`), and nothing removes one, so a person
      the configuration stops naming still names their rows. `GET /api/people`
      and the check on a rule's or a salary's person read the table. No separate
      display-name column: see the open decision in the report.
    - **The odd cent** is split once, on the cumulative joint total and never
      per payment, and goes to the person whose id sorts first, whichever sign
      it has. A row filed to a person is wholly theirs and a joint row is halved,
      which is `deposits − ½ × payments` exactly, and also places a joint rebate
      or a person's own withdrawal without a special case. `mortgageAsOf`
      throws `INTERNAL` if the parts ever stop summing to the balance.
    - **The ratio's rounding.** The first person by id takes their share
      rounded half-up and the second the remainder: equal to rounding both
      whenever that sums to 1 000 000, and on the exact tie the first takes the
      extra part. Arithmetic in `bigint`.
    - **Contributions to the buffer** are the sum of the rows filed to that
      person, so a row filed to them that took money out counts against them.
      Joint rows (payments out) are nobody's. **lg-6 reads "every deposit"; this
      is that, net of money returned to the same person.**
    - **A ratio is confirmed by naming salary records**, and the API derives it
      again from them; a record corrected since the proposal is
      `SALARY_NOT_FOUND`. Confirming another ratio for a day that has one
      supersedes it; the same one twice is one record. The proposal's date is
      the day of entry by the API's clock, which the person can change.
    - **A corrected salary does not move a confirmed ratio.** It proposes a new
      one; until that is confirmed the earlier stands, so a settlement made with
      it stays recomputable.
    - **Same salary sent again files nothing.** A year re-sent unchanged adds no
      record.
    - **Ratios have a fourth table**, `ratio_shares`, one row per person, rather
      than per-person columns, so the schema does not fix the household at two.
      The arithmetic does: the ratio is between two people, and the lead is
      `null` for any other number.
    - **The home screen counts what is unclassified**, since neither bucket
      includes a row the inbox still holds.
  - **What the brief had wrong.** "All three are append-only, and a correction
    supersedes the earlier record" fits salaries and ratios; `people` has nothing
    to correct once a name is its id. The brief names three tables; the ratio's
    per-person parts take a fourth.
  - **Fold-in: none taken.** `tools/ledger/CLAUDE.md` and `README.md` were
    updated to say what lg-5 adds, which is this ticket's own work. Nothing else
    specified was made free.
  - **Not covered.** No e2e spec and no browser: both screens ran in jsdom with
    the API client faked. Five tabs now wrap on a narrow screen; that was not
    looked at on a phone. Neither bucket counts the account's balance before the
    first stored row, so until lg-7 imports the history the two balances sum to
    the account's balance less that opening amount.
