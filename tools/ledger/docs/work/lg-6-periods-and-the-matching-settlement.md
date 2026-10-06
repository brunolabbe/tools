---
id: lg-6
tool: ledger
title: Periods of personal-card spending, closed with the matching rule
kind: work-package
status: ready
milestone: P3
depends_on: [lg-5]
difficulty: hard
---

# lg-6 — Periods of personal-card spending, closed with the matching rule

## Why

Shared spending on a personal card is gathered in periods, and closing a period
says who tops up the buffer and by how much. The workbook computed that amount
two different wrong ways. The owner decided to use the **matching rule**,
computed **cumulatively**, which is exact
([00-ANALYSIS.md §5](../00-ANALYSIS.md), which derives it and holds the worked
example).

## Build

1. Migration: `periods` (start, end, closed-at); `period_lines` (person, date,
   amount in cents, category, note, source); `recurring_items` (payer, monthly
   amount, start date, optional end date, label). All are append-only; a line is
   corrected by superseding it.
2. **A recurring item generates one dated line per month.** A period holds the
   lines dated inside it, so the month arithmetic in §6 of the analysis cannot
   happen.
3. `books`, pure: `settlement(contributions, charges, ratio)`, per analysis
   §5, _Charges between the two_.
   - **Contributions** are everything each person has put toward shared costs
     since the last point where they were even: shared period lines plus
     **every deposit into the current-expenses bucket**. Payments out of the
     buffer are **not** inputs.
   - **Charges** are amounts one person owes the other outright. The manual
     form is here; receipt items marked as the other's arrive with lg-10.
   - Net direct value is `r × (A + B) − A + charges A owes B − charges B owes
A`.
   - Returns: whoever owes deposits `net / (recipient's share)` into the
     buffer, rounded half-up to the cent once, at the end. With no charges, this
     is the matching rule `max(0, B × r/(1 − r) − A)`.
   - Also return `net` itself, so the screen can offer a direct transfer
     instead.
4. **The ratio in effect at the period's end applies.** A new ratio takes effect
   only at a period boundary, and what is owed across a boundary carries over as
   money (§5 of the analysis).
5. **Closing a period records the settlement it computed:** amount, payer, ratio
   and formula version. The tool then expects that deposit, and matches it when
   a paste brings it in: same person, same bucket, amount within a cent.
6. `web`:
   - the open period, with its lines per person, a manual line entry, and a
     manual charge ("this was the other person's");
   - the recurring items;
   - the close button, showing who deposits what;
   - the list of expected deposits not yet seen in a paste.

## Done when

1. The analysis's §5 table reproduces in a unit test: at r = 0.6, B spends 100
   and A spends nothing, so A deposits 150.00.
2. A cumulative case in which one earlier settlement under-asked produces the
   catch-up in the next close, and the result stands exactly at the ratio
   afterwards. A test asserts the shares to parts-per-million precision.
3. A recurring item produces one line per month, and a period spanning a new
   year holds the right months.
4. A closed period's settlement is matched when a later paste brings in the
   deposit.
5. A simulation-style test: random mixes of card spending and charges in both
   directions. After the computed deposit, with the buffer owned at the ratio,
   each person's cash out minus their buffer share equals what they consumed,
   to the cent.
6. Gates green.

## Log

- 2026-10-06 — Built, on `origin/main` at `4907d9a`: migration 4
  (`period_lines` with `current_period_lines`, `recurring_items` with
  `current_recurring_items`, and `periods`, which holds the recorded
  settlement) in `api/src/db/schema.ts`; `settlement`, `settleStretches`,
  `cumulativeSettlement`, `recurringDates`, `periodIndexOf`, `dayAfter` and
  `matchDeposits` in `books`; `api/src/periods.ts` and eight routes
  (`GET /api/periods`, `GET /api/periods/open`, `POST /api/periods/close`,
  `POST /api/period-lines`, `/:id` and `/:id/retire`, `GET`/`POST
/api/recurring` and `POST /api/recurring/:id`), each rate limited; four codes,
  `PERIOD_LINE_NOT_FOUND` and `RECURRING_ITEM_NOT_FOUND` (404),
  `PERIOD_NOT_OPEN` (409) and `RATIO_NOT_IN_EFFECT` (422); and in `web` a
  Period tab holding the four parts of Build 6.
  - **The suite passes.** `npm test -- --project ledger` → `Test Files 32 passed
(32)`, `Tests 465 passed (465)`; `npm run check` exit 0.
  - **Done when, and where each is proved.** (1) `books/test/settlement.test.ts`
    › "at r = 0.6, B spends 100 and A nothing, so A deposits 150.00", and the
    analysis's whole table in "the three ways of settling: only the direct
    payment and the matching deposit are exact" (324/276, 360/240, 360/240).
    (2) `books/test/settlement.test.ts` › "a settlement that asked too little is
    caught up by the next close, which then stands exactly at the ratio" (165 =
    75 + 90; 225 : 150 is 600 000 ppm with no remainder, and the next close
    settles at nothing) and "at a ratio with four decimals of a percent, the
    catch-up lands within a part per million"; through the API,
    `api/test/periods.test.ts` › "a settlement that asked too little is caught up
    by the next close". (3) `books/test/periods.test.ts` › "a period spanning a
    new year › holds exactly the months it covers", and
    `api/test/periods.test.ts` › "holds each month of a recurring item it spans,
    across a new year". (4) `api/test/periods.test.ts` › "records the
    settlement, and a later paste bringing the deposit in matches it". (5)
    `books/test/settlement.test.ts` › "each person's cash out less their buffer
    share equals what they consumed, to the cent": 500 seeded mixes of card
    spending, charges both ways, deposits off the ratio and payments out of the
    buffer, at random ratios, in exact millionths of a cent; its twin "and the
    simulation can fail" deposits v2's amount instead and misses in more than
    450 of the 500.
  - **The tests can fail.** Each mutation applied alone, the named suite run,
    the file restored and `git status --short` empty after. In `books`
    (`settlement.test.ts` and `periods.test.ts`, 34 tests): dividing by the
    payer's share, `11 failed`; depositing v2's net, `12 failed`, the simulation
    among them; every stretch at the closing ratio, `2 failed`; truncating
    instead of half-up, `4 failed`; per period instead of cumulative, `3
failed`; a wrong year rollover, `2 failed`; no clamp to a short month, `1
failed`; two cents of tolerance, `1 failed`; the oldest expectation choosing
    first, `1 failed`; the first period's start day left out, `1 failed`. In
    `api/test/periods.test.ts` (14 then): no open-period check, `1 failed`; closed
    periods reweighed at today's ratio, `1 failed`; buffer deposits ignored, `2
failed`; recurring lines left out, `2 failed`. In `web/test/periods.test.tsx`
    (9 then): the direct amount shown as the deposit, the charge box ignored, and
    folded deposits listed as unseen, `1 failed` each.
  - **The five questions the intake read as unsettled, answered from the
    ticket and the analysis.** None has two readings that lead to different
    work, so none is an open decision.
    - _A boundary with a changed ratio._ `net` is linear in every contribution
      and charge, so the net of a history is the sum of its periods' nets, each
      at its own ratio; only the total is divided by the recipient's share at
      the ratio of the period being closed. That is "carries over as money" (§5,
      _Numbers_) exactly. A closed period is weighed at the ratio its settlement
      recorded, never at today's. Proved by `books/test/settlement.test.ts` ›
      "carries what was owed over as money, and divides it at the new ratio" (60
      owed at 0.6 stays 60, deposited as 120 at 0.5; reweighing would make it 50) and `api/test/periods.test.ts` › "what was owed before a ratio change
      carries over as money".
    - _The formula version._ `v1` and `v2` are the workbook's two, which lg-7
      imports as they happened and tells apart by the cell's formula text; `v3`
      is this ticket's: the matching rule over contributions since the two were
      last even, with charges, each period at its own ratio, rounded once. The
      contract's `SETTLEMENT_FORMULAS` holds the three, `periods.formula` has a
      `CHECK` on them, and §5 of the analysis now says so in a paragraph.
    - _How a recurring item's end is recorded._ As lg-4's rules and lg-5's
      salaries are corrected: a version that supersedes it, with `end_date` set
      (`POST /api/recurring/:id`). A new amount from some month on is an end and
      a new item, so the months before keep the amount they had; a typo is a
      correction of the same item.
    - _Which gates._ `scripts/preflight.mjs` and the pull request's CI checks.
      For the code-scanning `CodeQL` check, the precedent is `repo-91`'s answer
      (option 2) and lg-5: a `GET` that reads the database is flagged because
      CodeQL does not model core's limiter, and is excused in code under
      `docs/adr/005` with a measured guard test. What it reports on this
      branch is read after the draft opens.
    - _Tests for the four web parts._ Written though no line asks:
      `web/test/periods.test.tsx`, one or more per part (the open period's lines
      and totals; a line and a charge entered by hand, and a removal; the
      recurring items added and ended; the close button and who deposits what;
      the deposits not seen yet), and `web/test/app.test.tsx` › "the period tab
      shows the period screen".
  - **Decisions the brief left open, made here.**
    - **Only a closed period is a row.** The open period starts the day after
      the last closed one, so closing is one `INSERT` and nothing is ever
      updated. The first period's start is the point the two were last even,
      chosen by whoever closes it; `NULL` is the beginning of the books. What is
      dated before it is outside every period and counts in no settlement.
    - **A close names the start it saw.** A period the other person closed
      meanwhile is `PERIOD_NOT_OPEN`, never settled twice; a unique index on the
      start backs it in the database. A period cannot end after today (the
      API's clock, UTC, as lg-5 decided) or before it starts.
    - **A charge is a period line with `charged_to` set**, the person who owes
      it in full; `NULL` is shared. A line is never zero and may be negative (a
      refund on a shared purchase).
    - **A recurring item's lines are generated on every read and never
      stored**, one a month on its start's day, or the month's last day when
      that is shorter. A corrected item therefore changes the months it covers
      everywhere, and the next close catches the difference up.
    - **A date belongs to the first period whose end is on or after it**, so a
      gap goes to the later period and an overlap to the earlier, and every
      amount counts once. lg-7's imported periods do not have to be contiguous
      for the arithmetic, though `POST /api/periods/close` keeps the tool's own
      periods so.
    - **Matching is computed on every read**, from the rows' current
      classification, so reclassifying a row moves its match too. A deposit is
      a row filed to the payer in the buffer, dated on or after the period's
      end, within a cent; **the newest expectation chooses first**, because a
      close is cumulative and asks again for an earlier deposit never made. Such
      an earlier one reads `folded`, not `expected`, so the list of deposits not
      seen holds only what is still owed.
    - **The day a period is closed, the open period is empty**: it starts
      tomorrow and, as of today, ends the day before it starts. It is shown,
      with what is still owed, and cannot be closed. Found after the first
      preflight: `api/test/periods.test.ts` › "the open period after it is
      empty until tomorrow, and still says what is owed" answered `expected 400
to be 200` before the change, and the period screen would have shown that
      400 in place of itself the day of every close.
    - **A recipient whose share is zero** (one salary of zero, which lg-5
      allows) cannot be settled through shared money: the deposit is `null`,
      the status `direct`, and the screen says to pay directly.
  - **What the brief had wrong.**
    - Build 1's three tables hold no charge, which Build 3 and Build 6 need;
      it is a column on `period_lines`. `periods` also holds the settlement
      Build 5 records (formula, ratio, payer, recipient, deposit and net), and
      its start is nullable for the first period.
    - Build 3's `settlement(contributions, charges, ratio)` takes one ratio, so
      it cannot carry Build 4's boundary. It exists as written, and is the
      one-ratio case of `settleStretches(stretches, ratio)`;
      `cumulativeSettlement(periods, lines, deposits)` builds the stretches.
    - "Every deposit into the current-expenses bucket" is every row filed to a
      person there, net of money returned to them, as lg-5's Log said it would
      be.
    - Done when 2's "parts-per-million precision" is exact only when the
      deposit divides evenly. After rounding, what is left is under half a cent
      of net, so one test asserts the identity exactly on round figures and the
      other the nearest part per million on totals above 10 000 $; Done when 5's
      "to the cent" is likewise asserted as within half a cent.
  - **Fold-in: none taken.** Nothing specified was made free. lg-5's two open
    lows (the home screen's "Both have paid the same." with three people, and
    "today" being UTC) touch this work but were left open by the owner, so they
    are not folded; the close's "today" follows lg-5's choice.
  - **Not covered.** No e2e spec and no browser or phone: every screen ran in
    jsdom with the API client faked. A line dated inside an already-closed
    period counts at the next close but is not listed in the open period, which
    shows only its own days. lg-7 will need the first imported period to start
    where the two were last even, and the workbook's 53-day overlap repaired or
    accepted, since an overlap's days count in the earlier period.

- 2026-10-06 — Round 1 after gate 1 (CONCERNS at `0862fd3`), with the owner's
  answers, and `origin/main` at `056aab7` merged in (#363, lg-12; no
  conflict).
  - **The owner's decisions, each as question, answer and whose recommendation
    it followed.**
    - **The buffer's balance at a ratio change** (the builder's open decision):
      keep §5 as built, keep it and file a ticket for exactness, or add a
      boundary adjustment here. **Keep §5 as built** — the builder's
      recommendation.
    - **Re-asked with gate 1's sharper case** (a settlement's deposit paid
      exactly and matched, then weighed at the next period's ratio: sam
      deposits 30.00 at 0.5, alex 50.00 at 0.7): keep §5 as built, weigh a
      matched deposit at its period's ratio in this round, or keep now and file
      a ticket. **Keep now, and file it**: `lg-13`, filed in this branch, not
      built; its Log holds the reproduction as re-run here.
    - **Med 3, a line dated inside a closed period**: refuse it, list it in the
      open period as late, or leave it and say so. **List it as late** — gate
      1's recommendation.
    - **Med 2, where a sub-cent residue becomes "nobody owes"**: in `books` or
      only in `api`. **In `books`** — gate 1's recommendation.
  - **Med 1, fixed.** `// codeql[js/missing-rate-limiting]` above
    `GET /api/recurring` in `api/src/routes/periods.ts`, with adr/005's five
    fields, as lg-5's two are. The guard, measured again on this round's tree:
    without `{ onRequest: read }` on that route,
    `api/test/route-limits.test.ts` answers `1 failed | 30 passed (31)`,
    "GET recurring refuses the second request in a minute too". The check stays
    red on this pull request until `security.yml` dismisses on a push to
    `main`, as adr/005 says. By gate 1's reading of the check's page, only
    `GET /api/recurring` was flagged, not
    `GET /api/periods` or `GET /api/periods/open`, so only it carries the
    comment. The first entry's "read after the draft opens" is this.
  - **Med 2, fixed in `books`.** `settleStretches` returns nobody owing
    when the deposit rounds to 0 (the deposit is never smaller than the net, so
    the net is 0 too), or the net does where the recipient's share is zero.
    Red first: `books/test/settlement.test.ts` › "a figure that did not
    divide evenly still settles the next close at nothing" (100.01, asked
    150.02, paid 150.02) and › "over many odd amounts and ratios, the next close
    never names a payer at 0.00" (2 000 seeded trials) failed, `2 failed | 20
passed (22)`, and pass after. Through the API,
    `api/test/periods.test.ts` › "settles the next close at nothing, though
    the figure did not divide evenly" failed against the old `books` `dist`
    (`expected { … } to match object { payerId: null, … }`) and passes after
    rebuilding it (`grep -c "depositCents === 0"` in
    `books/dist/settlement.js` → 1). The next close then records `payer
null`, status `none`, and is never listed as a deposit not seen.
  - **Med 3, fixed as the owner chose.** A line or a recurring item's month
    dated inside a closed period and **first entered** after that period
    closed is listed in the open period with `late: true`, and the screen
    says "entered after its period closed" and counts it in its payer's
    figure. "First entered" is the start of its chain of corrections
    (`enteredLate` in `books`, `firstEntered` in `api/src/periods.ts`):
    the gate's "compare the line's `entered_at`" would list the correction
    of an on-time line in full, though the next close counts only its
    difference, and ending an on-time recurring item would list every month it
    ever made. Red first: `api/test/periods.test.ts` › "dated the day of the
    close, it is listed in the open period as late" (the gate's reproduction:
    40.00 listed, deposit 210.00), "dated well inside the closed period, it is
    listed too, and counted once" and "a recurring item added after a close
    lists its months in that period as late" answered `3 failed` before the
    change; `web/test/periods.test.tsx` › "a line entered after its period
    closed is listed as late, and in its payer's figure" failed before
    `lineLabel` changed. These tests run on a clock that moves a second a
    read; on the suite's fixed clock a close and a later entry share an
    instant, and nothing entered at the instant of a close is late. **Still
    not listed**: a line on time that is corrected or removed after its period
    closed. The next close counts the difference, as it counts everything since
    the two were last even; the list does not show it.
  - **Med 4, tested.** `api/test/periods.test.ts` › "the same amount into
    the mortgage bucket, and a joint payment out of the buffer": neither moves
    the 150.00 asked nor matches it. Red against each mutant: the bucket
    predicate in `bufferRows` made `1 = 1`, `1 failed | 21 passed (22)`;
    the person predicate, the same.
  - **Lows fixed: 5, 6 and 7**, each red against the mutant the gate named.
    - Low 5: `api/test/period-schema.test.ts`, 11 tests, each refusal beside
      a row the database accepts. Each of migration 4's twelve constraints
      removed in turn: `1 failed | 10 passed (11)` every time. The first draft
      let four survive (the formula, deposit, net and pairing checks), because
      its "later" fixture ended before it started and was refused by another
      check; the fixture now is accepted on its own, and asserts so.
    - Low 6: `books/test/periods.test.ts` › "a deposit dated on the period's
      last day is its deposit"; with `>= end` made `> end`, `1 failed | 15
passed (16)`.
    - Low 7: `api/test/periods.test.ts` › "a line dated after it is not
      listed"; without `linesThrough`'s `date <= through`, `1 failed`.
  - **Lows left in the record: 8, 9, 10 and 11.** Each states a defect and not
    its remedy, and none has a live call site in a household of two (8: an item
    is ended, not removed; 9: a year typed as 9999; 10: a share of 11 ppm or
    less; 11: a third person, lg-5's open low).
  - **The suite.** `npm test -- --project ledger` → `Test Files 33 passed
(33)`, `Tests 491 passed (491)` (465 at `0862fd3`, and this round's 26: 7 in `books`, 18 in
    `api`, 1 in `web`).
