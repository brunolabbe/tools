---
id: lg-6
tool: ledger
title: Periods of personal-card spending, closed with the matching rule
kind: work-package
status: done
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

## Review

### Gate 1

**Gate: CONCERNS** — 2026-10-06 · `4907d9a..0862fd3` · Sonnet 5.5, depth full

No high. Money, append-only, boundaries, the eight routes and the simulation all held under attack (below). Four meds: one the acceptance line 6 depends on, one the "stands at the ratio afterwards" clause of line 2 depends on, and two that no `Done when` line depends on. Nothing has been fixed.

| Done when                                                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. §5 table reproduces; at r = 0.6, B spends 100, A nothing, A deposits 150.00                                                                                                        | **proven** — `books/test/settlement.test.ts` › "at r = 0.6, B spends 100 and A nothing, so A deposits 150.00" (`toEqual` on `depositCents: 15_000`, `netCents: 6_000`) and › "the three ways of settling: only the direct payment and the matching deposit are exact" (asserts 324/276, 360/240, 360/240, the table's three rows). Re-run on my own inputs, below                                                                                                                                                                                                                                                                                                 |
| 2. Cumulative: an under-asked settlement is caught up by the next close, which then stands exactly at the ratio; shares asserted to ppm                                               | **proven, with a gap (med 2)** — `books/test/settlement.test.ts` › "a settlement that asked too little is caught up by the next close, which then stands exactly at the ratio" (`16_500`; `(alex × 1e6) % total === 0`; `=== 600_000`; the next close has `payerId` null) and › "at a ratio with four decimals of a percent, the catch-up lands within a part per million" (`Math.round(alex × 1e6 / total)` equals the share); through the API `api/test/periods.test.ts` › "closing a period › a settlement that asked too little is caught up by the next close". The "stands at the ratio afterwards" clause is asserted only on a figure that divides evenly |
| 3. A recurring item makes one line a month; a period spanning a new year holds the right months                                                                                       | **proven** — `books/test/periods.test.ts` › "a period spanning a new year › holds exactly the months it covers" (the four dates Nov–Feb), › "recurringDates › one line a month, on the start's day of the month"; `api/test/periods.test.ts` › "the open period › holds each month of a recurring item it spans, across a new year"                                                                                                                                                                                                                                                                                                                               |
| 4. A closed period's settlement is matched when a later paste brings in the deposit                                                                                                   | **proven** — `api/test/periods.test.ts` › "closing a period › records the settlement, and a later paste bringing the deposit in matches it" (asserts `deposit.status` is `"matched"` with a numeric `rowId`, and that the open period then stands at nothing); `books/test/periods.test.ts` › "matchDeposits" (person, within a cent, folded, newest-first). The "same bucket" clause of Build 5 is not asserted by any API test (med 4)                                                                                                                                                                                                                          |
| 5. Simulation: random mixes of card spending and charges, both directions; after the computed deposit each person's cash out less buffer share equals what they consumed, to the cent | **proven** — `books/test/settlement.test.ts` › "the settlement's promise, simulated › each person's cash out less their buffer share equals what they consumed, to the cent", with its control › "and the simulation can fail: v2's direct amount, deposited into the buffer, misses". Re-run by me: worst residue 0.407 cent over 1 000 person-mixes (500 seeds × 2), bound is 0.5; control missed 500 of 500 (threshold 450). Can fail for the defect it targets: see the positive control                                                                                                                                                                      |
| 6. Gates green                                                                                                                                                                        | **unproven (gate)** — on head `0862fd3`, `gh pr checks 368`: `check` ×2, `changes`, `codeql` (the Actions job), `dependency-review`, `docker`, `test (ubuntu-latest)` and `test (windows-latest, informational)` pass; **the `CodeQL` check fails** (med 1). `headRefOid` is `0862fd3f2c0fa0fc9a352d2f40ab2baaab07e506`, the sha gated                                                                                                                                                                                                                                                                                                                            |

**Positive controls.** (a) Scratch copy of `books`, one edit: the divisor in `settleStretches` changed from the recipient's share to the payer's. `11 failed | 23 passed (34)`: every `Done when` 1, 2 and 5 test above is among the red, the simulation at `seed 1: expected 52089595362 to be less than or equal to 500000`. (b) Truncating instead of half-up: `4 failed`, the simulation at seed 2. (c) Before believing that no route edits a row in place, abort triggers (`BEFORE UPDATE` and `BEFORE DELETE`) were added to the three new tables in a scratch copy of migration 4, and a raw `UPDATE period_lines` and `DELETE FROM period_lines` were shown to raise them.

**Money, by hand and by a second method.** My own exact-rational reference (not the books' micro-unit one) agreed with `settleStretches` on 21 of 21 inputs, including: §5 (A deposits 15 000, net 6 000); the mirror, A spent 100 (B owes net 4 000, deposits 4 000 ÷ 0.6 = 6 666.67 → 6 667); ratio 581 234 ppm with B spending 123.45 (micro-cents 581 234 × 12 345 = 7 175 333 730, net 7 175.33 → 7 175, deposit 7 175 333 730 ÷ 418 766 = 17 134.47 → 17 134, by hand); half-cent ties in both directions (r = 0.2, B pays 2¢; r = 0.8, A pays 2¢; each 0.5 → 1); net ±0.5¢ → 1 for either payer; charges only (A owes 25.00: deposit 62.50; B owes 25.00: 41.67); and a ratio change (below). Two refund cases (a negative contribution, each person) I checked by hand and not against the reference: A −40.00 at 0.6 gives net 16.00, deposit 40.00; B −40.00 gives net 24.00, deposit 40.00. **Rounding happens once per figure**, in `roundHalfUp` inside `settleStretches`, on `depositCents` and on `netCents`, each straight from the same exact `bigint` sum in millionths of a cent; `cumulativeSettlement` only buckets, `owedMicro` only adds. The sign is taken (payer chosen) before rounding, and `roundHalfUp` only ever sees the magnitude, so a negative and a positive net round symmetrically. `bigint` cannot overflow; `cents()` refuses an unsafe integer. The one place precision can go is the closing `Number(bigint)` (low 10).

**Ratio change with a carried shortfall, §5 as written.** r = 0.6 then 0.5; B spends 100.00 under 0.6; A deposits 90.00 where 150.00 was asked, dated in the next period. Hand: stretch 1 owes +6 000, stretch 2 weighs A's 9 000 at 0.5 → −4 500, total 1 500, deposit 1 500 ÷ 0.5 = 3 000. Code: `payerId` alex, `depositCents` 3000, `netCents` 1500. The same 9 000 dated before the boundary: 6 000 − 0.4 × 9 000 = 2 400 → 4 800. Code agrees. Each stretch is weighed at its own ratio and the total divided by the recipient's share at the closing ratio, which is what §5 says; the code does it.

**Open (the owner's, not graded): the deposit that settles a closed period, when the ratio changes at that boundary.** A deposit is weighed at the ratio of the period its _date_ falls in, and a settlement's deposit is always dated after the period it settles. Through the API: ratio 0.6, B spends 100.00, close at 30 September (asks 150.00, net 60.00); ratio 0.5 from 1 October; A pays exactly 150.00 on 2 October, which matches as `matched`. The open period, with nothing spent in it, then says **sam deposits 30.00 (net 15.00)**. With the new ratio 0.7 it says **alex deposits 50.00 (net 15.00)**. With the ratio unchanged it says nobody owes. That is the arithmetic of a buffer re-owned at the new ratio; whether it is what the owner means is their question.

**Findings**

- **med 1** · **Done when 6 depends on it** · The default-setup `CodeQL` check is red on this head with one new alert, `js/missing-rate-limiting` ("This route handler performs a database access, but is not rate-limited"), on the closing line of the `GET /api/recurring` handler in `api/src/routes/periods.ts`. The route is rate limited, and I measured the guard: with `{ onRequest: read }` taken off that route in a scratch copy, `api/test/route-limits.test.ts` fails 1 of its 31 tests, "the routes that answer two verbs › GET recurring refuses the second request in a minute too". The repo's treatment is adr/005 and repo-91 (the `// codeql[js/missing-rate-limiting]` register comment with five fields, as lg-5 put on `routes/rules.ts` and `routes/salaries.ts`); `routes/periods.ts` carries none. Under adr/005 the check stays red on a pull request that touches the file until `security.yml` dismisses on a push to `main`, so the comment is the register and the owner's call is the check. The page's detailsUrl is `https://github.com/brunolabbe/tools/runs/112053145529`; `gh` cannot read an inline alert, so I read that page by a page fetch and resolved the alert's line against the head myself. The page said "1 new alert including 1 high severity". Reproduce: `gh pr checks 368` → `CodeQL  fail  4s  https://github.com/brunolabbe/tools/runs/112053145529`. Remedy: the register comment above `app.get(ROUTES.recurring, …)`, guard named as above (the Log's "read after the draft opens" is now measured).
- **med 2** · **Done when 2 depends on it (the clause "stands exactly at the ratio afterwards")** · Paying exactly what the screen asked does not settle the next close at nothing, whenever the figure did not divide evenly, which is nearly always: the sub-cent residue still names a payer, with 0.00 on both figures. Reproduce with books alone, from the repo root after a build: `node --input-type=module -e "import { settlement } from '@ledger/books'; const r=[{personId:'alex',partsPerMillion:600000},{personId:'sam',partsPerMillion:400000}]; console.log(JSON.stringify(settlement([{personId:'sam',cents:10001}],[],r))); console.log(JSON.stringify(settlement([{personId:'sam',cents:10001},{personId:'alex',cents:15002}],[],r)))"` → `{"payerId":"alex","depositCents":15002,"netCents":6001}` then `{"payerId":"sam","recipientId":"alex","depositCents":0,"netCents":0}` (A should pay 150.015 and pays 150.02; the 0.2 cent left over names sam). Through the API: ratio 0.6, sam 100.01 dated 10 September, close at 30 September (asks 150.02), alex's 150.02 pasted dated 2 October: `GET /api/periods/open` answers `payerId` sam, `depositCents` 0, `netCents` 0, by `settlementSentence` the screen says "sam deposits 0.00 into the buffer. Or pays alex 0.00 directly."; and closing the next period with nothing in it (the deposit dated 30 September) records `payer sam, deposit 0, net 0`, status `expected`, which by the screen's code then sits in "Deposits not seen yet" at 0.00 until a later close folds it. The tests that assert "settles at nothing" use 16 500 and 15 000, which divide exactly. Remedy (recommended, in `books`, where `Settlement.payerId`'s doc already promises `null`): return the nobody-owes result when `depositCents` is 0 (it implies `netCents` is 0, since the deposit is never smaller than the net), or `netCents` is 0 when the recipient's share is zero; add a test with an odd cent that closes the next period at nothing. Alternative: normalise only in `api/src/periods.ts`, which leaves the books returning a payer at 0.00 for the next caller.
- **med 3** · no `Done when` line depends on it · **open decision** · A line dated inside an already-closed period is accepted, counted at the next close, and listed nowhere. The default is the common case: the line form's date defaults to today and the screen's default last day is today, so closing today and then entering a receipt dated today does it. Reproduce (`api/test/periods.test.ts` helpers, clock 2026-10-03, ratio 0.6): add sam 100.00 on 2026-09-10; `POST /api/periods/close` `{start: null, end: "2026-10-03"}` → asks 150.00; `POST /api/period-lines` sam 40.00 dated 2026-10-03 → **200**; `GET /api/periods/open` → `start "2026-10-04"`, **`lines: []`**, `settlement.depositCents` **21000** (was 15000). The same with a line dated 2026-09-15 after closing 2026-09-30: 200, `lines: []`, deposit 22 500. By the screen's code (`Periods.tsx`; no browser was run) each person then reads "Nothing yet." while the sentence under it still asks for more. Counted once, never twice (every date takes the first period whose end is on or after it); the failure is that the open period's list cannot add up to its own settlement. The Log's "Not covered" records it, which is not the same as asking. Options: (a) refuse a line or a recurring item dated on or before the last closed end, with a new ledger code (a contract change, and a late receipt must then be dated today); (b) accept it and list it in the open period as a late entry, comparing the line's `entered_at` with the period's `closed_at`, so the list sums to the settlement; (c) leave it and say so on the screen. **Recommend (b)**: nothing is lost, the amount is still counted exactly once, and no code or contract changes.
- **med 4** · no `Done when` line depends on it (Build 3 and Build 5 clauses) · `bufferRows` in `api/src/periods.ts` filters on the bucket (`current-expenses`) and on a person being named, and no API test asserts either. In a scratch copy, replacing the bucket predicate with `1 = 1`: `41 passed (41)` across `periods.test.ts`, `classifications.test.ts`, `buckets.test.ts`; replacing `person_id IS NOT NULL` with `1 = 1`: `41 passed (41)`. A mortgage-bucket deposit counted as a buffer contribution, or a joint payment out of the buffer counted as someone's, is the silent-money failure Build 3 ("payments out of the buffer are not inputs", "every deposit into the current-expenses bucket") and Build 5 ("same bucket") exist to rule out. Fix: one API test with a same-amount deposit filed to the mortgage bucket and one joint buffer payment, asserting neither moves the settlement nor matches a deposit.
- **low 5** · Migration 4's table constraints have no test. Each removed in turn from a scratch copy, the branch's api tests `71 passed (71)` every time: the `periods_start` unique index (the one the Log says "backs" the double-close guard), `period_lines_supersedes`, `recurring_items_supersedes`, `amount_cents <> 0`, `charged_to <> person_id`, `monthly_cents > 0`, `end_date >= start_date`, the `formula` CHECK, the payer/recipient pairing CHECK, `deposit_cents >= 0`, `start_date <= end_date`. The three `current_*` views are held (each mutant red). lg-4's migration 2 has `classification-schema.test.ts` for the same job. I confirmed by hand that `periods_start` refuses a second first period (`UNIQUE`); only the test is missing.
- **low 6** · `matchDeposits`' boundary day is untested: › "a row filed to the payer, on or after the end, within a cent, is the deposit" asserts "after" (the 2nd against an end of the 31st) and "before" (the 30th) but not "on", and changing `>= end` to `> end` in a scratch copy of `books/src/periods.ts` leaves `34 passed (34)`. Of the 13 mutants I applied to `books/src/periods.ts`, 11 were killed, this one survived, and one (dropping the year rollover in `recurringDates`) did not complete the run (19 of 34 reported), so it is a crash or hang, not a pass.
- **low 7** · `linesThrough`'s `date <= through` filter in `api/src/periods.ts` is untested: removed in a scratch copy, `41 passed (41)`. The settlement is unaffected (it drops later dates itself); only the open period's list would show lines dated after the chosen last day.
- **low 8** · A mistaken recurring item cannot be removed, only shrunk to one line. The schema and the contract both require `endDate >= startDate`, and an item generates a line on its start date. Reproduce: add sam 999.99 a month from 2026-06-01, `POST /api/recurring/:id` with `endDate: "2026-06-01"` → 200; `GET /api/periods/open?end=2026-09-30` still holds 1 generated line. A line has a retirement; an item has no equivalent. (A start date moved far into the future is a workaround nobody is told about.) No `Done when` line depends on it.
- **low 9** · `nfr:performance` · `GET /api/periods/open?end=9999-12-31` with one monthly item (50.00 from 2026-01-01) answers 200 with 1 175 568 lines, 164 484 141 bytes, in 5 124 ms (in-process `inject`). Cause: `recurringDates` stops on the string comparison `date > last`, and `format` pads the year to four digits, so `"10000-01-31" < "9999-12-31"` and the loop runs on until the year is 99 990. The caller is one of two Access-gated people and reaches it only by typing year 9999 into the "Last day" box; I did not measure `end=9998-12-31` (about 95 000 lines per item by arithmetic).
- **low 10** · `nfr:reliability` · `Number(bigint)` in `roundHalfUp` is exact only to 2^53: a recipient share of 11 ppm or less with an amount near the contract's cap returns an imprecise deposit. Reproduce (repo root, after a build): `settlement([{personId:"a",cents:99999999999}],[],[{personId:"a",partsPerMillion:1},{personId:"b",partsPerMillion:999999}])` → `depositCents 99999899999000000`, exact `99999899999000001`, `Number.isSafeInteger` false. No live call site: a ratio that lopsided is not a household.
- **low 11** · `nfr:reliability` · A buffer row filed to a person the ratio does not name (a legacy lg-4 id that migration 3 enrolled) makes `GET /api/periods/open` and `POST /api/periods/close` answer `400 BAD_REQUEST "A contribution names someone the ratio does not."` for good, and the Period tab shows the failure instead of itself. Reproduce: insert `casey` into `people`, add a rule filing `Virement casey` to casey in `current-expenses`, paste a 50.00 row. No live call site for a household of two; lg-5's open low about three people is the same root.
- **dropped** · a third `BAD_REQUEST` with its own wording at the raise sites ("A period cannot end after today.") read as "copy replaced at the raise site, so the wrong code". Not a defect here: core's `BAD_REQUEST` is documented as widenable, and lg-5's `books/src/ratio.ts` does the same.
- **dropped** · `daysInMonth` uses `Date.UTC`, which reads years 0 to 99 as 19xx. The schema accepts `0000-01-01`, but no household date is there; no live call site.
- **dropped** · "today" being UTC for the close and the default last day, against the phone's local date in the line form. lg-5's choice, left open by the owner and named in the Log; used here only as the reason med 3 occurs in the evening.
- **findings** · the hunt returned 14; 11 carried (4 med, 7 low), 3 dropped. One owner question reported ungraded above, not counted.

**What I covered, against what exists.** Routes: 9 route-verb pairs on the 8 new paths, enumerated with `printRoutes({ includeHooks: true })`; all 9, and their `HEAD`s, carry `rateLimit()` in `onRequest`, and `route-limits.test.ts` has a 429 test for each (31 tests in the file, `LIMITED` over every `ROUTES` key plus the two-verb case for `recurring`). Error raise sites: 18 `throw new AppError` across `api/src/periods.ts`, `api/src/routes/periods.ts`, `books/src/settlement.ts`; none a bare `Error`; every code is `BAD_REQUEST` or `INTERNAL` (core) or one of the four new. The four new codes (`PERIOD_LINE_NOT_FOUND` 404, `RECURRING_ITEM_NOT_FOUND` 404, `PERIOD_NOT_OPEN` 409, `RATIO_NOT_IN_EFFECT` 422) duplicate nothing in `CORE_ERROR_CODES` (there is no core conflict or unprocessable code), each has its status line and default message, and `http-errors.test.ts` is parametrised over `LEDGER_ERROR_CODES`. Inputs: every body and the one query go through a contract schema (`periodLineDraftSchema`, `recurringItemDraftSchema`, `closePeriodRequestSchema`, `openPeriodQuerySchema`) and the two ids through a digits-only check; `2026-02-30`, `2026-13-01`, `2026-02-29` are refused with 400. Append-only: every read of the three new tables goes through a `current_*` view or is a by-id read of the row just inserted, and `periods` has one `INSERT` and one `SELECT`; the whole api suite with the abort triggers present passed 243 of 244 (the one failure is the health route's version string in my scratch copy, which has no `package.json`), and all nine route-verb pairs ran their success paths (10 calls) without tripping one. Migration 4 on a database at migration 3 holding a statement, a rule, a classification, two people, a salary, a ratio and its shares: applies, `user_version` 4, every old table's row count unchanged, `foreign_key_check` empty, `integrity_check` `ok`, the new tables empty, a `periods` row accepted against the old ratio, and migrating again changes nothing. Boundaries: a period closed today and the next open period (empty, start tomorrow, still states what is owed, `?end=tomorrow` fine, closing it 400; the builder's fix is held: reverting it turns "the open period after it is empty until tomorrow, and still says what is owed" red); a recurring item with start 2025-11-30 ending 2026-03-15 gives 11-30, 12-30, 01-30, 02-28 and stops (end inclusive); start 01-31 gives 01-31, 02-28, 03-31, 04-30, 05-31; the first period's null start takes a 2020 line, and a chosen start leaves it out for good (counted in no settlement and shown nowhere: by design, in the Log). **No date is counted twice**; a line is counted never when dated before a chosen first start, and later than the closing end only until the next close.

- NFR: security ✓ (all routes limited and validated; no value echoed in a refusal; no URL, header or subprocess) apart from low 9 · performance low 9 · reliability meds 2, low 10, 11 · maintainability low 5, 6, 7.

**Invariants walked.** Tool isolation (imports only `@ledger/*`); `AppError` and the taxonomy (above); contract edits, which are this ticket's own routes, types and codes, as lg-5's were, so not unilateral; no new workspace dependency, so the image list is untouched and `check` and `test` are green on the head; new tests sit under existing `test/` globs. Skipped as not touched by the diff: shell and process trees, `redactHeaders`/`redactUrl`, SSRF, progress.

**Counts.** `npm test -- --project ledger` at the head: 32 files, 465 passed (465), as the Log says. At the base sha, with this worktree's head-built `dist` (so five contract-listing tests fail there, an artefact): 28 files, 396 tests; the branch adds 4 files and 69 tests. The branch's changes to existing test files are additions only (`route-limits.test.ts`, `app.test.tsx`) and the version bump 3 → 4 in `schema.test.ts`; nothing deleted or reworded. **Not run:** a browser, an e2e spec (none exists), the container build locally (CI's `docker` passed on the head), `npm run check` locally (CI's two `check` jobs passed on the head).

**Open decisions, for the orchestrator to put to the owner.** (1) Med 3, options (a), (b), (c), recommend (b). (2) Med 2's remedy location, `books` (recommended) or `api`. (3) The owner's ratio-change question above, with its three numbers.

### Gate 2

**Gate: CONCERNS** — 2026-10-06 · `0862fd3..86b1c7c` (the round is `d725943..86b1c7c`; `d725943` is a merge of `origin/main` at `056aab7`) · Sonnet 5.5, depth full

No high. Gate 1's four meds are each repaired and re-measured. One new med in the round's own late-entry listing (no `Done when` line depends on it), and Done-when 6 is still `unproven (gate)`: on head `86b1c7c` the unit-test legs were still running at my one read and the `CodeQL` check is red with the one alert adr/005 expects. Nothing has been fixed by this gate.

**The merge.** `git diff-tree --cc d725943` prints only the commit line: no combined diff, so a clean merge with nothing resolved by hand. `git diff --stat 056aab7 d725943` is 28 files, 3 726 insertions, 16 deletions, the same figures as gate 1's range `4907d9a...0862fd3`: the merge added nothing to the branch's own change and lost nothing. lg-12's text in `tools/ledger/CLAUDE.md` and `README.md` sits in separate hunks from the branch's, and reads coherently.

| Done when                                                                   | Proof at `86b1c7c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, 3, 4, 5                                                                  | **proven**, unchanged and re-run: the ledger project is 33 files, 491 passed (491), the Log's figure (gate 1 saw 32 and 465; the round adds 1 file and 26 tests: 7 `books`, 18 `api`, 1 `web`). My exact-rational reference still agrees with `settleStretches` on 21 of 21 inputs, and the simulation still reads worst 0.407 cent over 1 000 person-mixes with its control missing 500 of 500. Done-when 4's "same bucket" clause, unproven at gate 1, is now asserted (below)                                                     |
| 2. Cumulative catch-up, "the result stands exactly at the ratio afterwards" | **proven**, and the gap gate 1 named is closed: `api/test/periods.test.ts` › "a deposit of exactly what was asked › settles the next close at nothing, though the figure did not divide evenly" (100.01, asked 150.02, paid 150.02: `payerId` null, then a close recording status `none`) and `books/test/settlement.test.ts` › "after the asked deposit is paid › a figure that did not divide evenly still settles the next close at nothing" and › "over many odd amounts and ratios, the next close never names a payer at 0.00" |
| 6. Gates green                                                              | **unproven (gate)** — on head `86b1c7c63173c6fa9d1c4de9cf2b8f57ebe93a3a` (the `headRefOid`, and the sha the `CodeQL` page reports), my one read of `gh pr checks 368`: `changes`, `check` ×2, `codeql` (the Actions job), `dependency-review`, `docker` pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` **still running**; `CodeQL` **fails**. Detail below                                                                                                                                                  |

**Earlier findings, one verdict each**

- **med 1 — fixed, and the check is still red as adr/005 says it will be.** The register comment is on `GET /api/recurring` only, the last comment line directly above the `app.get(` line (rule 1), with all five fields (query id, file, date, reasoning, guard test). Its guard claim holds on this tree: with `{ onRequest: read }` taken off that route in a scratch copy, `api/test/route-limits.test.ts` is `1 failed | 30 passed (31)`, "GET recurring refuses the second request in a minute too". The `CodeQL` check (detailsUrl `https://github.com/brunolabbe/tools/runs/112064503679`, read by a page fetch because `gh` cannot) reports the same single alert, `js/missing-rate-limiting`, on the closing line of that handler, "1 new alert including 1 high severity". Under adr/005 and repo-91 that is expected until `security.yml` dismisses on a push to `main`; whether the suppression comment matches an alert reported on the closing line is, as repo-91 says, not observable before that push. Done-when 6 therefore cannot be called proven on this head: the unit-test legs unfinished (the Windows one is informational), one check red by design. I did not poll again.
- **med 2 — fixed in `books`, verified.** Against an independent exact reference over 200 000 random inputs (random ratios including 0 and 1 000 000 ppm, one to four contributions, optional charge): 0 mismatches. 3 817 settle at nothing; 2 730 name a payer with a deposit of exactly 1 cent, so a genuine 1-cent deposit survives; 864 name a payer with deposit at least 1 and net 0. By hand: r = 0.2, B pays 2¢, owes 0.4¢, deposit 0.5¢ → `payerId` a, `depositCents` 1, `netCents` 0; B pays 1¢ → 0.25¢ → nobody. Two gaps, both low, below.
- **med 3 — fixed as the owner chose ((b)), with one new med below.** The chain-start argument reproduces; the table is under "med 5".
- **med 4 — fixed, verified.** In a scratch copy, the bucket predicate in `bufferRows` made `1 = 1`: `1 failed | 32 passed (33)`; the person predicate, the same; both named `api/test/periods.test.ts` › "what is not a deposit into the buffer › the same amount into the mortgage bucket, and a joint payment out of the buffer".
- **low 5 — fixed, verified, and the claim is exact.** `api/test/period-schema.test.ts` (11 tests). Each of migration 4's constraints removed in turn from a scratch copy, one test red every time, naming the matching test: the `periods_start` index (also when rebuilt on `start_date` alone, so a null start no longer collides), the two `supersedes` indexes, `amount_cents <> 0`, `charged_to <> person_id`, `monthly_cents > 0`, `end_date >= start_date`, the `formula`, payer/recipient pairing, `deposit_cents >= 0`, `net_cents >= 0` (one I had not listed) and `start_date <= end_date` CHECKs, giving the Log's "twelve". The three views are held by `periods.test.ts` instead (one test red for each line view, two for the item view). Three constraints outside the claim survive (`retired IN (0, 1)`, the `period_lines.person_id` and `periods.ratio_id` foreign keys): not a finding of this round, recorded.
- **low 6 — fixed.** `books/test/periods.test.ts` › "matchDeposits, on the boundary › a deposit dated on the period's last day is its deposit"; `>= end` made `> end` is `1 failed`.
- **low 7 — fixed.** `api/test/periods.test.ts` › "the open period's last day › a line dated after it is not listed"; without the `<= through` filter, `1 failed`.
- **lows 8, 9, 10, 11 — not fixed, left in the record** as the coordinator says. Re-checked unchanged at the new head: an item still cannot be removed, `?end=9999-12-31` is still unbounded, `Number(bigint)` is unchanged, a third person still makes open and close answer 400.

**The builder's account of med 3, checked.** (1) _"A mutant using the line's own time fails two tests"_: confirmed. `firstEntered` returning the record's own `entered_at` is `2 failed | 31 passed (33)`: › "a line on time, corrected after the close, is not listed as late" and › "a recurring item added after a close lists its months in that period as late". (2) _"An on-time line corrected or removed after its period closed is still not listed"_: confirmed, and the Log says so. (3) _Does the rule keep the open period's list summing to its settlement?_ Measured through the API (ratio 0.6; sam 100.00 on time; the close asks 150.00; the deposit figures are the open period's cumulative ask):

| After the close, this happens                         | What the next close counts that the last did not | List, chain start (as built) | List, own time (rejected)               |
| ----------------------------------------------------- | ------------------------------------------------ | ---------------------------- | --------------------------------------- |
| 50.00 entered late, dated 15 Sep                      | +75.00 (150 → 225)                               | lists 50.00 ✓                | lists 50.00 ✓                           |
| the same, after a _second_ close has counted it       | nothing                                          | **still lists 50.00** ✗      | still lists it ✗                        |
| on-time 100.00 corrected to 120.00                    | +30.00 (150 → 180)                               | nothing (omits)              | lists 120.00 (overstates)               |
| on-time 100.00 retired                                | −150.00 (to 0)                                   | nothing                      | nothing                                 |
| late 50.00 corrected to 60.00                         | its 60.00 (→ 240)                                | lists 60.00 ✓                | ✓                                       |
| late 50.00 retired                                    | nothing                                          | nothing ✓                    | ✓                                       |
| on-time item 20.00 → 30.00 a month, two closed months | +30.00 (60 → 90)                                 | nothing (omits)              | lists both months at 30.00 (overstates) |
| item added late, dated in closed months               | its months                                       | lists them ✓                 | ✓                                       |

So the builder's argument holds: chain start never overstates, own time does in two cases, and the choice is the better one. Neither rule makes the list sum in the correction and retirement rows (the stated residual, low 13) and both fail the second row (med 5).

**Findings in the round's lines**

- **med 5** · no `Done when` line depends on it · A late entry never leaves the open period's list. `enteredLate` compares a line's first entry with the close of the period **holding its date**, so once a _later_ close has counted the line it is still "entered after its period closed" and is listed in every open period after. Reproduce (`api/test/periods.test.ts` helpers with the `ticking` clock, ratio 0.6): add sam 100.00 on 2026-09-10; close `{start: null, end: "2026-09-30"}`; add sam 50.00 dated 2026-09-15 (late); `GET /api/periods/open` lists it, `depositCents` 22500; close `{start: "2026-10-01", end: "2026-10-03"}` (asks 225.00, the late line counted); then `GET /api/periods/open` → `start "2026-10-04"`, `lines` still `["2026-09-15" sam 5000 late true]`, and again with `?end=2026-10-20`. By the screen's code the open period's "Paid by sam" then reads 50.00 for a period in which sam paid nothing, in every period after. The settlement is not affected; the list and the per-person figure are. The contract's own words for `late`, "its period's settlement did not count it, so this one does", are false once a later close has counted it. Remedy (prototyped in a scratch copy, same probe: the line is listed in the open period before the second close and gone after it, and all 33 tests of `api/test/periods.test.ts` and `period-schema.test.ts` still pass): a record is late when its date falls in a closed period **and** its first entry is after the **last** close, that is, when no close has counted it yet. `books/test/periods.test.ts` › "enteredLate" encodes the holding-period reading ("dated in a closed period and first entered after it closed", with two closes) and would change with it; add a test with two closes.
- **low 12** · test gaps in the new rule: (a) a genuine deposit of 1 cent with a net of 0 is named, and nothing asserts it: in a scratch copy the rule keyed on `netCents === 0` instead of the deposit survives `41 passed (41)` (864 of my 200 000 inputs are this shape); the `<= 1` over-reach is caught by › "a half cent rounds up, whichever person owes", which is a net-1 case. (b) The rule's zero-share clause (`depositCents === null && netCents === 0`) is unreachable: a zero recipient share means the other share is 1 000 000, so what is owed is always a whole number of cents and `net` cannot round to 0; my 200 000 inputs reached it 0 times and removing it leaves `41 passed (41)`. Dead code with no live call site, and the Log's "or the net does where the recipient's share is zero" describes a case that cannot occur.
- **low 13** · carried from gate 1's med 3, stated in the Log and so recorded, not repaired: a correction or removal of an on-time line, and a correction of an on-time item, is counted by the next close and listed nowhere (rows 3, 4 and 7 above). The owner chose (b) for late entries; whether a signed difference should be listed is a further decision, not put to him here.
- **low 14** · `nfr:performance` · `firstEntered` reads both whole tables and walks every chain, and `linesThrough` runs it on each call, including from `settlementFor`, which passes no closed periods and discards the result: two full scans of each table, twice, per `GET /api/periods/open` and per close. Unmeasured; no live call site at a household's size.
- **dropped** · `${table}` interpolated into the `SELECT` in `firstEntered`: typed to two literals and never input, and the head's `CodeQL` run reports no injection alert. Not a defect.
- **dropped** · migration 4's SQL comment was edited in this round although "a migration, once shipped, is never edited": it is a comment, in a migration no `main` has shipped.
- **findings** · the hunt returned 6; 4 carried (1 med, 3 low), 2 dropped. Gate 1's 11 each have a verdict above.

**lg-13, checked.** `npm run status -- --show lg-13`: kind `fix`, status `ready`, milestone P3, depends on lg-6 (blocked by it, as written), difficulty `hard`, parses with no error. `node scripts/next-id.mjs lg` names `PR#368 lg-13` as the holder and `lg-14` as next free; lg-11 is spoken for in lg-4's Log, so lg-13 follows docs/01-TICKETS.md's rule of the union of the file list and the Logs. It carries a reproduction and a decision, so it clears "what does not get a ticket"; `## Review` is left out until something is built, as the format asks. Its reproduction matches mine row for row: ratio 0.6 → nobody owes; 0.5 → sam deposits 30.00, net 15; 0.7 → alex deposits 50.00, net 15; and its Done-when 2 figure (90.00 paid unmatched, 0.6 then 0.5: alex, 3000, 1500) is what I measured at gate 1.

- NFR: security ✓ (the route set is unchanged: the only edit under `routes/` is the comment) · performance low 14 · reliability med 5 · maintainability low 12.

**Not run or unverified.** The two unit-test legs' results (running at my read; not polled). Whether the `codeql[...]` suppression matches an alert on the closing line (repo-91: not observable before a push to `main`). The screen in a browser (the "Paid by" claim in med 5 is from the component's code). `npm run check` locally (CI's two `check` jobs passed on the head).

**Open decisions for the orchestrator.** None new. Med 5 has one remedy, recommended above; low 13 is the only question this gate would put to the owner, and only if he wants the corrections listed.

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
    the net is 0 too).
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

- 2026-10-06 — Round 2 after gate 2 (CONCERNS at `86b1c7c`, no high).
  - **The owner's decision.** Med 5, a late line listed for good: fix it at
    landing, leave it recorded, or file an lg- ticket. **Fix at landing**, with
    no third gate, since gate 2 raised no high — the orchestrator's
    recommendation.
  - **Med 5, fixed as gate 2 prototyped.** A record is late when its date falls
    in a closed period and its first entry is after the **last** close, so once
    a close has counted it, it leaves the list. `enteredLate` in `books`, and
    the contract's words for `late`. Red first: `api/test/periods.test.ts` ›
    "a late line, after the next close › is no longer listed: that close
    counted it" (the gate's two-close reproduction) and
    `books/test/periods.test.ts` › "enteredLate › not once a later close has
    counted it, though its own period closed before it" answered `2 failed |
199 passed (201)` across `books/test` and `api/test/periods.test.ts`,
    and pass after (`books` `dist` rebuilt; `grep -c lastClose` in
    `books/dist/periods.js` → 2). The holding-period test now reads "dated in
    a closed period and first entered after the last close".
  - **Low 12, fixed.** (a) `books/test/settlement.test.ts` › "a deposit of
    one cent › is asked for, though the direct amount rounds to nothing" (r =
    0.2, sam paid 2 cents: alex deposits 1, net 0). With the rule keyed on
    `netCents === 0`: `1 failed | 21 passed (22)`. (b) The zero-share clause
    is removed, with a comment saying why it cannot be reached, and the round-1
    entry's sentence describing it is struck from that entry.
  - **Lows 13 and 14 left in the record.** 13: a correction or removal of
    something on time is counted by the next close and listed nowhere; listing a
    signed difference would be a further decision. 14: `firstEntered` scans
    both tables per call; unmeasured, at a household's size.
  - **`awaiting` set** for Done when 6, by the owner's answer of 2026-10-06 to
    repo-88's first decision: a recorded adr/005 excusal makes the line
    awaiting the push to `main` that runs `security.yml`'s dismissal step,
    and the alert's state read after it.

- 2026-10-10 — The `awaiting` line closed. Done when 6, "Gates green", waited
  on the CodeQL alert on `GET /api/recurring` in `routes/periods.ts` reading
  dismissed or suppressed after the push to `main` that runs `security.yml`'s
  dismissal step. It does: alert #29 (Missing rate limiting,
  `routes/periods.ts:131`) reads closed as false positive. The reading is the
  owner's, taken from the repository's code-scanning page on `main`
  (`is:closed branch:main`) after #408 (`7709411e`) merged, and given as a
  screenshot; it was not re-run here. The alert's line is the route handler
  directly below its `codeql[js/missing-rate-limiting]` comment in the current
  source (`grep -n`: `periods.ts:130`/`131`).
