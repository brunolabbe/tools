---
id: lg-59
tool: ledger
title: A paste cannot double-store a day the workbook both re-dated and reordered
kind: fix
status: ready
milestone: null
depends_on: [lg-40]
difficulty: hard
---

# lg-59 — A paste cannot double-store a day the workbook both re-dated and reordered

## Why

lg-40 lets a paste overlap the rows the workbook imported, one day at a time: a
day's workbook rows may be in any order, and each may be dated a day off the
bank's. That rule is `api/src/workbook-days.ts` on lg-40's branch (PR #548, not
yet on `main`). It cuts the workbook's rows into runs of one date. A day the
workbook both re-dated by a day and reordered therefore becomes two runs, and
the reading that matches the bank is not admitted. A shorter overlap, or a
continuation with `k = 0` on a balance that happens to coincide, can then be the
only reading that fits, and the paste is accepted and stores rows twice.

lg-40's gate 2 measured this (Sonnet 5.5, at its head `856d7efc` on PR #548; cited
as prose, not as a file and line on that branch):

- Its randomised probe c, seed 11, 1,500 trials a cell. A cell is `plain`,
  `reorder`, `shift`, or `both`, where `both` is reorder and shift together. In
  the `both` cells: 22 wrong accepts with the `repeating` alphabet and 31 with
  `tiny`. Zero wrong accepts in `distinct/both`, and zero in the plain, reorder
  and shift cells of all three alphabets.
- Its probe c2, where each day is re-dated or reordered and never both: zero
  wrong accepts in 4,500 trials (three alphabets, 1,500 each).
- Its option A cites zero wrong accepts in 3,600 trials on the realistic mix, a
  figure from the gate's own record and not re-derived in this filing.
- The base before lg-40 stored rows twice the same way more often: 256 of 1,920
  same-order and 8,936 of 59,336 reordered one-day histories, exhaustively over
  `±10.00`.

The probes are the gate's, in its scratch directory, which is not in the repo and
is not durable: `/tmp/claude-1000/-workspaces-tools/76d8bfd3-5bf4-4dc1-8f0f-5cfd08c6379a/scratchpad/lg-40/gate-1/gate-lg40c.test.ts`
(probe c) and `…/scratchpad/lg-40/gate-2/gate-lg40c2.test.ts` (probe c2). If they
are gone when this is built, Build step 1 rebuilds probe c from this paragraph and
records in the Log what it rebuilt. Probe c draws a bank history of 5 to 12 rows
over a few days, takes the workbook to be a prefix of it, re-dates each workbook
row by one day with probability 0.2 in `shift` and reorders each day with
probability one half in `reorder`, and pastes from a random row `i`. Its
alphabets are `distinct` (eight amounts), `repeating` (`±5.00`, `±10.00`) and
`tiny` (`±10.00`).

The gate's reading of probe c at lg-40's head, which Build step 1 re-measures
before any change. Ambiguous, as `repeating` / `tiny`: plain 167 / 364, reorder
165 / 376, shift 165 / 321, both 157 / 322; `distinct` is 0, 0, 1 and 0 across
plain, reorder, shift and both. Correct pastes refused (`refusedOther`) in the
`both` cells: 108 for `distinct`, 65 for `repeating`, 33 for `tiny`. Probe c2's
ambiguous count at the same head: 1, 155 and 347 for `distinct`, `repeating` and
`tiny`.

The wrong accepts have not been reduced to a small synthetic case. Build step 1
takes one from probe c's output.

## Build

1. **Measure before any change.** On lg-40's merged head, or on the head this
   branch is built on, which must include lg-40's code, run probe c and probe c2
   with seed 11. Record each cell's `correct`, `wrongAccept`, `ambiguous` and
   `refusedOther` in the Log. Take one wrong-accept line from probe c's output in
   a `repeating/both` cell and reduce it by hand, removing rows while the wrong
   accept stays. Record the reduced case in the Log; Done when 6 is written on it.
2. **Measure the direction before choosing a rule.** The direction recorded at
   filing is: let a run span a row the workbook re-dated by a day, so that the
   reading matching the bank is admitted. Try it as an uncommitted experiment,
   run Build step 1's probes, and record each cell's counts beside the
   measurement from step 1. Its effect on the ambiguity refusal is unmeasured
   until this step. If the rise in ambiguity in the cells that have no day both
   re-dated and reordered (probe c's plain, reorder and shift cells, and probe c2)
   is large against the wrong accepts it removes, stop here. Record in the Log the
   measured costs and the options, and leave the choice to the owner; this ticket
   does not set the threshold.
3. Implement the chosen rule in `api/src/workbook-days.ts`, keeping lg-40's
   guarantees: a stored row is never edited, the workbook's wording and category
   stay on its rows, and only rows past the tail are inserted.
4. Update the header comment of `api/src/workbook-days.ts` so that it names the
   tolerance the rule now admits. lg-40's header names the day both re-dated and
   reordered as refused, and this change alters that.
5. The ambiguity refusal keeps working (lg-40's Build step 2). A reading that the
   new span makes possible counts like any other, so a paste with two surviving
   readings is refused with `STATEMENT_ROW_CONFLICT` and "two ways", and nothing is
   stored.
6. Record in the Log the rule as written, what it admits and refuses, and the
   before and after tallies from steps 1 and 2.

## Done when

1. Probe c's `repeating/both` and `tiny/both` cells: `wrongAccept` is 0 on this
   branch's head, against 22 and 31 at lg-40's head. The per-cell tallies are in
   the Log.
2. Probe c's `distinct/both` cell and its plain, reorder and shift cells, at all
   three alphabets: `wrongAccept` is 0.
3. Probe c2, with the `distinct`, `repeating` and `tiny` alphabets: `wrongAccept`
   is 0.
4. Probe c's `both` cells: `refusedOther` does not exceed the lg-40 head readings
   of 108, 65 and 33.
5. Probe c's and probe c2's `ambiguous` tallies, per cell, are recorded in the Log
   at lg-40's head and at this branch's head, with the change in each cell named.
   The record stands whether the count rises or falls.
6. A test in `api/test/workbook-days.test.ts` builds the reduced case from Build
   step 1 and asserts the outcome is either the true reading (`rowsAdded` and
   `rowsAlreadyPresent` equal the bank's new rows and its rows already stored), or
   the `STATEMENT_ROW_CONFLICT` refusal whose message says "two ways". Either way
   the workbook's rows are unchanged afterwards.
7. A test asserts that a paste with two surviving readings, where one reading
   comes from the new span, is refused with `STATEMENT_ROW_CONFLICT`. The
   ambiguity test that lg-40 adds passes unedited.
8. The tests lg-40 adds to `api/test/statements.test.ts`,
   `api/test/workbook-days.test.ts` and `api/test/workbook-import.test.ts` pass
   with their assertions unedited. The gate read 1,413 of 1,413 at lg-40's head.
9. A reviewer finds that the header comment of `api/src/workbook-days.ts` names
   the tolerance the rule admits, and names exactly the case that Done when 6
   tests.
10. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18 — filed by a maintenance dispatch from the orchestrator, on the
  owner's decision of 2026-10-18 about lg-40's gate 2 open decision. The options
  put were: file a new lg- ticket (the lg-40 builder's recommendation), leave it
  recorded only (the lg-40 gate's recommendation), or fix it in lg-40's branch.
  The owner chose to file. The reproduction is the gate's, not this filing's:
  nothing was run, and no code changed. The numbers in Why were read from the
  gate's head-run outputs, `/tmp/claude-1000/lg-40/g2/gate-lg40c.txt` (probe c at
  `856d7efc`, the `both` lines and the `refusedOther` counts) and
  `/tmp/claude-1000/lg-40/g2c2/gate-lg40c2.txt` (probe c2).
