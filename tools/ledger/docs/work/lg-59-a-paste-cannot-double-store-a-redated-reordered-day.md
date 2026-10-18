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
bank's. That rule is `api/src/workbook-days.ts`, on `main` since lg-40's PR #548
merged as `f07e9c25`. It cuts the workbook's rows into runs of one date. A day the
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

1. **Measure before any change.** On `main` at or after `f07e9c25` (lg-40's
   merge), run probe c and probe c2
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
- 2026-10-18 — builder (Opus 5.5), **stopped at Build step 2's stop condition;
  no source changed on this branch.** The rule is the owner's to choose, as
  options below.

  **Probes.** The gate's originals were still on disk and were used unchanged,
  not rebuilt: probe c from
  `/tmp/claude-1000/-workspaces-tools/76d8bfd3-5bf4-4dc1-8f0f-5cfd08c6379a/scratchpad/lg-40/gate-1/gate-lg40c.test.ts`
  (sha256 `e461a876…d26de3`) and probe c2 from `…/lg-40/gate-2/gate-lg40c2.test.ts`
  (sha256 `2c8fc618…577ebc`). Each was copied into `api/test/`, run with
  `GATE_SEED=11` through `npx vitest run`, and deleted. Each vitest run exits 1:
  the probe's one test passes the 20 s `testTimeout`, which is reported only after
  the synchronous body has finished, so every cell line is still written.

  **Step 1, at `335efcd4` (`main`, which holds lg-40's `f07e9c25`).** Probe c's and
  probe c2's outputs are byte-identical to the gate's at `856d7efc` (`cmp` exit 0
  against `/tmp/claude-1000/lg-40/g2/gate-lg40c.txt` and
  `…/g2c2/gate-lg40c2.txt`). The counts are in the `lg-40` column of the table
  below.

  **The reduced case (for Done when 6).** Taken from probe c's second
  `repeating/both` wrong accept, then reduced greedily: one bank row dropped at a
  time, along with its workbook row, while the paste was still accepted wrongly.
  The bank's rows are 2026-02-21 −5.00, 2026-02-21 −10.00, 2026-02-21 +10.00 and
  2026-02-22 −5.00. The workbook holds the first three, listed as −10.00 (21st),
  −5.00 (dated the 20th) and +10.00 (21st), from an opening of 1,000.00. A paste of
  the bank's last three rows, opening from 995.00, is accepted at `335efcd4` with
  0 already present and 3 added. The truth is 2 present and 1 added. The
  workbook's day is cut into the runs `[−10.00]`, `[−5.00]` and `[+10.00]`, so
  the true `k = 2` overlap is weighed against the run `[+10.00]` alone and fails.
  Since −10.00 + 10.00 = 0, the paste opens from the tail's balance, so `k = 0`
  fits and is the only reading. Under every variant below this case is refused
  as ambiguous ("two ways"), which Done when 6 accepts.

  **Step 2: the variants tried, all uncommitted.** Each rewrote `overlaps` in
  `statements.ts` to read the workbook rows near the stretch's edges (within two
  days; three for M) and cut runs over them. `workbookStarts` was widened to match.
  The workbook import's `dayRuns` was not touched: lg-40's test pins
  `[01, 01, 02, 01]` as three runs, and Done when 8 keeps that test unedited.

  - **S**: a run continues across a change of date when the two dates are a day
    apart and the row on the far side of the changed one returns to the run's
    date. Discarded. Chains such as `[23, 24, 23, 24]` swallow two days, and
    the date window then refuses a reading lg-40 admitted. Measured: `tiny/shift`
    wrong accepts 0 → 1, `distinct/shift` and c2 `repeating` refused 0 → 1 each.
    `both` wrong accepts 22 → 13 and 31 → 19.
  - **S2**, the filed direction in its narrowest form: a row dated a day off,
    listed between two rows of one date, belongs to their run, unless a neighbour
    of it is such a row too, in which case lg-40's cut stands.
  - **M1 / M2**, the widest form: every cut between two of the workbook's dates
    is optional. The stretch matches if some cutting into blocks, each spanning
    at most one (M1) or two (M2) calendar days, matches block by block
    (`matchPart`, each bank row within a day of the block's dates). It is searched
    as a walk over the date boundaries.

  Each cell is `correct / wrongAccept / ambiguous / refusedOther`, 1,500 trials:

  | cell                | lg-40                | S2                   | M1                 | M2                 |
  | ------------------- | -------------------- | -------------------- | ------------------ | ------------------ |
  | c distinct/plain    | 1500 / 0 / 0 / 0     | 1500 / 0 / 0 / 0     | 1500 / 0 / 0 / 0   | 1498 / 0 / 2 / 0   |
  | c distinct/reorder  | 1500 / 0 / 0 / 0     | 1500 / 0 / 0 / 0     | 1500 / 0 / 0 / 0   | 1499 / 0 / 1 / 0   |
  | c distinct/shift    | 1499 / 0 / 1 / 0     | 1499 / 0 / 1 / 0     | 1499 / 0 / 1 / 0   | 1498 / 0 / 2 / 0   |
  | c distinct/both     | 1392 / 0 / 0 / 108   | 1426 / 0 / 0 / 74    | 1483 / 0 / 1 / 16  | 1499 / 0 / 1 / 0   |
  | c repeating/plain   | 1333 / 0 / 167 / 0   | 1333 / 0 / 167 / 0   | 1239 / 0 / 261 / 0 | 1154 / 0 / 346 / 0 |
  | c repeating/reorder | 1335 / 0 / 165 / 0   | 1335 / 0 / 165 / 0   | 1237 / 0 / 263 / 0 | 1156 / 0 / 344 / 0 |
  | c repeating/shift   | 1335 / 0 / 165 / 0   | 1322 / 0 / 178 / 0   | 1250 / 0 / 250 / 0 | 1165 / 0 / 335 / 0 |
  | c repeating/both    | 1256 / 22 / 157 / 65 | 1266 / 17 / 171 / 46 | 1243 / 3 / 249 / 5 | 1174 / 0 / 326 / 0 |
  | c tiny/plain        | 1136 / 0 / 364 / 0   | 1136 / 0 / 364 / 0   | 977 / 0 / 523 / 0  | 900 / 0 / 600 / 0  |
  | c tiny/reorder      | 1124 / 0 / 376 / 0   | 1124 / 0 / 376 / 0   | 950 / 0 / 550 / 0  | 862 / 0 / 638 / 0  |
  | c tiny/shift        | 1179 / 0 / 321 / 0   | 1165 / 0 / 335 / 0   | 1033 / 0 / 467 / 0 | 927 / 0 / 573 / 0  |
  | c tiny/both         | 1114 / 31 / 322 / 33 | 1115 / 20 / 341 / 24 | 997 / 3 / 496 / 4  | 881 / 0 / 619 / 0  |
  | c2 distinct         | 1499 / 0 / 1 / 0     | 1499 / 0 / 1 / 0     | 1497 / 0 / 3 / 0   | 1497 / 0 / 3 / 0   |
  | c2 repeating        | 1345 / 0 / 155 / 0   | 1336 / 0 / 164 / 0   | 1276 / 0 / 224 / 0 | 1198 / 0 / 302 / 0 |
  | c2 tiny             | 1153 / 0 / 347 / 0   | 1142 / 0 / 358 / 0   | 984 / 0 / 516 / 0  | 884 / 0 / 616 / 0  |

  Totals. The **cells with no day both re-dated and reordered** are probe c's
  plain, reorder and shift cells plus probe c2, 18,000 trials in all:

  | measure                                 | lg-40 | S2          | M1           | M2             |
  | --------------------------------------- | ----- | ----------- | ------------ | -------------- |
  | wrong accepts, `both` cells             | 53    | 37 (−16)    | 6 (−47)      | 0 (−53)        |
  | ambiguous, cells with no such day       | 2,062 | 2,109 (+47) | 3,058 (+996) | 3,762 (+1,700) |
  | ambiguous, `both` cells                 | 479   | 512         | 746          | 946            |
  | correct pastes refused, `both` cells    | 206   | 144         | 25           | 0              |
  | `distinct` only: ambiguous, no such day | 2     | 2           | 4            | 8              |

  **Why this stops.** Every variant raises ambiguity in the cells that have no
  such day by more than it removes wrong accepts. S2 adds 47 to remove 16, M1
  adds 996 to remove 47, and M2 adds 1,700 to remove 53. Only M2 meets Done when
  1–4; S2 and M1 leave wrong accepts and miss Done when 1. Wall time is not a
  cost to weigh: probe c took 112–133 s and c2 30–40 s across all four, on a
  shared machine.

  **Open decision, for the owner.**

  - **A. M2** (recommended): meets Done when 1–4. It removes every wrong
    accept and every refused correct paste in the `both` cells. It nearly doubles
    the ambiguity refusal with the adversarial alphabets, where every movement is
    ±5.00 or ±10.00, but adds only 6 in 6,000 trials with `distinct`. An
    ambiguity stores nothing and asks for a longer paste; a wrong accept stores
    rows twice and says nothing. What it changes: "a day" becomes a block of
    the workbook's rows spanning up to two calendar days. The header of
    `workbook-days.ts`, the header of `statements.ts` and the
    `workbookMismatch` wording all say so.
  - **B. S2**, the direction as filed: 53 → 37 wrong accepts for +47
    ambiguous. It is the smallest change to lg-40's day, but Done when 1 has to
    be rewritten to accept the residue.
  - **C. M1**: 53 → 6 for +996. Done when 1 has to be rewritten too.
  - **D. No rule change.** Keep lg-40's rule and record the residue: 53 wrong
    accepts in 9,000 adversarial `both` trials, zero with `distinct`. This was
    lg-40's gate recommendation.

  The experiment diffs (S2 alone, and S2 with M behind an environment switch)
  and the reduction harness are in this session's scratch directory, which is not
  durable. The variants above are described closely enough to rebuild them.
  **Fold-in:** nothing was made free. With the rule unchosen, no source changed.

- 2026-10-18 — **the owner's answer**, relayed by the orchestrator. The
  question as put: "lg-59 stopped at its step-2 stop condition … Which rule?"
  The options: "A: M2, two-day blocks (builder's rec)", "B: S2, the direction as
  filed", "C: M1, one-day blocks" and "D: No rule change". The owner chose **A:
  M2**.

- 2026-10-18 — builder (Opus 5.5), **M2 built** in `115bc190`.

  **The rule as written.**
  - In `workbook-days.ts`: `matchStretch` cuts the stored stretch, with the
    workbook rows next to it, into blocks.
  - A block is a row a paste stored (compared field for field by the caller),
    or consecutive workbook rows cut where the workbook's date changes, whose
    dates are at most `WIDEST_BLOCK_DAYS` (2) days apart.
  - Some cutting must match block by block. The search walks the cuts from the
    oldest row up, keeping which cuts some matching cutting reaches.
  - A block matches by `matchBlock`: each pasted row dated from the day before
    the block's earliest date to the day after its latest, then `matchPart`
    with any date. Blocks wholly outside the stretch are not compared.
  - In `statements.ts`: `overlaps` reads the workbook rows within two days of
    the stretch's ends (`nearby`, replacing `restOfDay`). `workbookStarts`
    reads three days either side, since a block's row may be that far from a
    pasted row of it.
  - The workbook import's `dayRuns` and `alignDays` are unchanged. lg-40's
    `dayRuns` test pins `[01, 01, 02, 01]` as three runs.
  - The headers of both files and the `workbookMismatch` message now say a day
    is the workbook's rows dated no more than 2 days apart. The
    `workbook-days.ts` header names the reduced case below as the case admitted.

  **What it admits and refuses.**
  - Admitted: a day the workbook both re-dated by a day and reordered. A
    reading a block makes possible counts like any other, so two are refused as
    ambiguous.
  - Refused: rows more than two days apart in one block, and a pasted row two
    days from every date of its block.
  - Refused as before: a day whose amounts differ by one row, and a part that
    starts and ends inside a block of more than `LONGEST_SEARCHED_DAY` rows.

  **Observed while writing the tests, not a change.** When the true reading is
  refused, a block's end can still admit a false one. A paste whose third row
  the bank dates two days after the workbook's day (−5.00, −10.00, +10.00 then
  +3.00, over the reduced case's workbook) was accepted as 1 present and 3
  added. The block `[−5.00 on the 20th, +10.00 on the 21st]` ends on the pasted
  −5.00's balance. It is lg-59's failure, a refused true reading leaving a
  false one, reached through a date two days off. The probes never date a row
  two days off, so they do not count it, and lg-40's rule refuses the same true
  reading. No ticket filed: the bank's date is the truth, and a workbook date
  two days off is outside what either rule tolerates. The test of a two-days-off
  row uses amounts that do not cancel, so it shows the refusal it names.

  **Probe c and probe c2 on `115bc190`.** These are the gate's probes, seed 11,
  as in the step-1 entry. The cell lines are byte-identical to experiment M2's
  (`cmp` exit 0); each vitest run exits 1 on the 20 s timeout, as before. Each
  cell is `correct / wrongAccept / ambiguous / refusedOther`, then the change in
  `ambiguous`:

  | cell                | lg-40 (`335efcd4`)   | this branch (`115bc190`) | ambiguous |
  | ------------------- | -------------------- | ------------------------ | --------- |
  | c distinct/plain    | 1500 / 0 / 0 / 0     | 1498 / 0 / 2 / 0         | +2        |
  | c distinct/reorder  | 1500 / 0 / 0 / 0     | 1499 / 0 / 1 / 0         | +1        |
  | c distinct/shift    | 1499 / 0 / 1 / 0     | 1498 / 0 / 2 / 0         | +1        |
  | c distinct/both     | 1392 / 0 / 0 / 108   | 1499 / 0 / 1 / 0         | +1        |
  | c repeating/plain   | 1333 / 0 / 167 / 0   | 1154 / 0 / 346 / 0       | +179      |
  | c repeating/reorder | 1335 / 0 / 165 / 0   | 1156 / 0 / 344 / 0       | +179      |
  | c repeating/shift   | 1335 / 0 / 165 / 0   | 1165 / 0 / 335 / 0       | +170      |
  | c repeating/both    | 1256 / 22 / 157 / 65 | 1174 / 0 / 326 / 0       | +169      |
  | c tiny/plain        | 1136 / 0 / 364 / 0   | 900 / 0 / 600 / 0        | +236      |
  | c tiny/reorder      | 1124 / 0 / 376 / 0   | 862 / 0 / 638 / 0        | +262      |
  | c tiny/shift        | 1179 / 0 / 321 / 0   | 927 / 0 / 573 / 0        | +252      |
  | c tiny/both         | 1114 / 31 / 322 / 33 | 881 / 0 / 619 / 0        | +297      |
  | c2 distinct         | 1499 / 0 / 1 / 0     | 1497 / 0 / 3 / 0         | +2        |
  | c2 repeating        | 1345 / 0 / 155 / 0   | 1198 / 0 / 302 / 0       | +147      |
  | c2 tiny             | 1153 / 0 / 347 / 0   | 884 / 0 / 616 / 0        | +269      |

  **Tests**, appended to `api/test/workbook-days.test.ts`:
  - The reduced case (Done when 6). Its outcome on this branch is the
    "two ways" refusal.
  - The two readings it leaves, 2 stored from the block and 0 stored from the
    continuation (Done when 7).
  - A re-dated and reordered day with amounts that do not cancel, accepted with
    its true counts and the workbook's rows untouched.
  - A row two days off, refused.
  - Unit tests of `matchBlock` and `matchStretch`.

  Against lg-40's source (`git checkout 2f8e937d --` the two source files,
  restored from `115bc190`), 8 of the 9 new tests fail. The ninth, the
  two-days-off refusal, already held there. Only the test file's
  `import type { DayEntry }` line was replaced; no lg-40 assertion was edited.

  **Left as is.** `workbookMismatch` still names a continuing row only if it is
  dated on or after the day before the workbook's newest. That is advice in a
  refusal, not a reading, and no test or probe reached it.

  **Fold-in:** nothing else was made free.
