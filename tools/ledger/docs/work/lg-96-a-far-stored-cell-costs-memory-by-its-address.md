---
id: lg-96
tool: ledger
title: A stored cell far down or across a sheet costs memory by its address
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-96 — A stored cell far down or across a sheet costs memory by its address

## Why

`readSheets` (`tools/ledger/api/src/xlsx.ts`) builds every sheet's grid before
anything bounds it. `rowsOf` makes one row for every row up to the last stored
one, and makes each row as wide as its own last cell that holds a value. So a sheet
holding one cell at `A1048576` pays for 1 048 576 rows, and a sheet whose rows
each hold a cell in column `XFD` pays for its row count times 16 384 places.
Neither cost is bounded where it is built. The rows and cells bounds in
`workbook-describe.ts` count only after the grid exists, and the 40-sheet bound
counts only after every sheet has been read. None of `workbook-zip.ts`'s bounds
(bytes, inflated size, entries) sees the cost, because the cost follows the
address, not the file's size.

Found by lg-88's gate (PR #733, the row axis: its section carries the far cell as a
`dropped` bullet, "out of the reviewed range", and its full report as an open
decision; it was not fixed in lg-88). It is not lg-88's to fix.
[lg-88](./lg-88-a-merged-range-costs-memory-by-its-area.md) is the sibling: the
same function, the same missing bound, a cost by area instead of by address. lg-88's
decision (option 3) removes merged places but keeps `last = data.length`, so the
row axis stays on `main` after lg-88 lands. The column axis is not in lg-88's
brief at all.

`readSheets` has two callers. The describe route reads it before its bounds.
The owner's `import` command (`api/src/import-command.ts`) reads it with no bound
at all, so a fix in describe alone would leave the command as it is.

## Reproduction

Measured on `c9b1afdd` (this ticket's filing; its only difference from `83eac952`,
the base it was filed on and `origin/main` on 2026-11-01, is this file, so the code
read is the same). The readings are gate 1's of this ticket, not the filer's: the filer
ran the lg-88 gate's scripts (see the Log), and gate 1 found that the first version of
this section, run as it described, did not give its figures.

**The fixture is written by one process and read by another.** Each case is two
processes, run one at a time. The first builds the workbook with the test helper
`tools/ledger/api/test/helpers/xlsx-file.ts` (`SheetWriter`, `workbookOf`), writes
the bytes to a file and exits. The second reads the file, calls `gc()`, takes
`process.resourceUsage().maxRSS`, makes the call, takes `maxRSS` again, and prints
the growth. Building in the measuring process does not work: writing a sheet whose
`!ref` spans `A1:A1048576` or `A1:XFD1000` costs more than the read, so it raises the
process's peak first, to a level the call's own peak does not exceed by much, and the delta
understates it. Run that way, case 1
read +20.7, +21.2 and +20.4 MB, and case 4 at 1 000 rows +31.8 MB, against the figures
below. The machine is WSL2 on Linux, so a reading varies by run: every reading a case
was given is in the table.

What the second process has loaded before its baseline moves the delta too, so the
baseline is taken after the same imports each time. Gate 1's script imports
`readSheets`, `describeWorkbook` and `xlsx` before `gc()` and the baseline, which puts the
baseline at about 135 to 155 MB. Gate 2 wrote a script from these steps alone: with
`readSheets` imported before the baseline, case 1 read +81.7, +81.2, case 4 at 1 000 rows
+205.1, +206.5 and the control +10.0, +13.5; with it imported after the baseline, +98.1,
+100.0, +225.8, +223.5 and +28.5, +29.3. A figure from another script can read tens of MB
away from the table's, so a branch is compared with the base by one script on both.

Fixtures are synthetic. Read the file with `readSheets` from
`tools/ledger/api/src/xlsx.ts`. The repo holds no script for this: gate 1's is
`measure2.mts` in its scratch directory, an `.mts` file that imports the worktree's
modules by absolute path and runs from the worktree root as
`node --expose-gc --import tsx <script>`, once with a `build` argument and once with
a `run` argument. Write an equivalent in a scratch directory; that directory does not
outlive the session.

The cases:

1. **One far cell.** One sheet, `A1` = `Alex`, `A1048576` = `far`, through
   `readSheets`. Three runs.
2. **One far sheet through the route.** The same sheet through
   `describeWorkbook` (`workbook-describe.ts`), passing `readSheets` as its
   `readSheets` dependency and a model stub that answers with
   `stopReason: "refusal"`, the request as `{ file: <base64>, consent: true }`.
3. **Ten far sheets through the route.** Ten sheets, each `A1` = `Alex` and
   `A1048576` = `far`, through case 2's call. It returns `WORKBOOK_TOO_LARGE`.
4. **A far column.** 4 000 rows, each row `r` holding `XFD` + `r` = `far`, and
   `A1` = `Alex`, through `readSheets`. The control is the same with the cell in
   column `B`.
5. **Forty `<sheet>` entries over one far sheet.** One worksheet part holding `A1` =
   `Alex` and `A100000` = `far` (not case 1's address), with `xl/workbook.xml` listing 40
   `<sheet>` entries (`r:id` `dup1` to `dup40`) and `xl/_rels/workbook.xml.rels` giving
   each a relationship to `worksheets/sheet1.xml`. The file stays 10 parts. Through
   `readSheets`. The control is the same file with one entry. Gate 3's `dup-far.mts`
   builds it: `workbookOf` for the base file, the test helper's `entriesOf` to open it, the
   two files patched, `zipOf` to write it.

| Case                                                                          | Gate 1 of this ticket, `c9b1afdd`                                                   | Gate of PR #733, `83eac952`              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| 1. one far cell, `readSheets`                                                 | +62.9, +62.0, +62.5 MB; 131–158 ms; 15 909 B                                        | +49.3 MB                                 |
| 2. one far sheet, through the route                                           | +63.0, +58.0 MB; process peak 203.3, 197.7 MB; `WORKBOOK_TOO_LARGE`                 | not run                                  |
| 3. ten far sheets, through the route                                          | +532.9, +497.6, +522.9 MB; process peak 673.6, 643.7, 663.2 MB; 1.6–1.8 s; 24 986 B | +408 MB; process peak 592.5 MB; 24 904 B |
| 3. five far sheets, through the route                                         | +282.7 MB (one run)                                                                 | not run                                  |
| 4. 1 000 / 2 000 / 4 000 rows at `XFD`                                        | +186.1 / +363.6 / +719.2 and +728.6 MB; 1.7 / 3.4 / 6.4–8.0 s; 71 / 128 / 242 KB    | not run                                  |
| 4. control, 4 000 rows at `B`                                                 | +4.3, +4.7 MB; 60 ms; 234 KB                                                        | not run                                  |
| 5. 40 `<sheet>` entries over one far sheet, `readSheets` (gate 3, `9f1069cc`) | +198.3, +197.5 MB; 40 sheets read; 516–522 ms; 6 029 B                              | not run                                  |
| 5. control, one entry                                                         | +9.6, +9.5 MB; 1 sheet read; 38–39 ms; 5 614 B                                      | not run                                  |
| 40 far sheets (the count the bound admits)                                    | **not measured**: linear extrapolation from case 3, about +1.9 to +2.1 GB           | not measured                             |
| 20 000 rows at `XFD` (the row bound)                                          | **not measured**: linear extrapolation from case 4, about +3.6 GB                   | not measured                             |

The fixer of the round that rewrote this section re-ran three of these cases with
gate 1's `measure2.mts`, once each, one at a time, on a tree at `c9b1afdd`: case 1
read +60.6 MB (gate 1: +62.0 to +62.9), case 4 at 1 000 rows +182.7 MB (+186.1) and the
control +4.9 MB (+4.3, +4.7); the rest of the table is gate 1's alone.

The 40 is the count `MAX_WORKBOOK_SHEETS` admits, not the most a file pays for: the
count is checked after every sheet is built (option 1's second cost). The two
extrapolations are linear and read off these rows, not run. Case 3's three
ten-sheet readings give 49.8 to 53.3 MB a sheet, and 40 sheets then come to about
2.0 to 2.1 GB; the step from five sheets (+282.7, one run) to ten gives about 47 MB a
sheet, and 40 sheets then come to about 1.9 GB. Case 4's three readings give 0.18 to
0.19 MB a row, so 20 000 rows come to about 3.6 GB. Both are several times the 512 MB
container, and neither is the bound: the readings are one to three runs each, and the
ticket's remedy has to be sized against the range, not the mean.

The gate of PR #733 read +408 MB for the same ten sheets. Its report gives no sha for
that reading and no output file stands behind it, so it is a figure in a report and
nothing more. None of the five ten-sheet readings gate 1 took, +497.6 to +532.9 in the
table and +496.0 and +496.3 with the fixture built in the measuring process, is near
it. This ticket does not use it, and does not explain the difference.

Case 5 is the multiplier's reproduction, and gate 3's measurement, not the filer's. The
row count of one entry is 100 000, and 40 entries cost about 20 times one (+198 against
+9.6 MB), so the cost is `rowsOf`'s, once per entry: SheetJS's own parse of the two files
adds nothing above the process's load peak (0.0 on four runs). The inflate bound counts
a worksheet part once and `readSheets` builds it once per entry, so a 10-part file of
20 000 entries, 214 034 bytes, declaring 3 950 299 bytes inflated against the 4 194 304
bound, passes `workbookEntries`, `declaredInflatedSize` and `countInflated`, and the
same shape holding `A1` only reads as 20 000 sheets through `readSheets` (1 062 ms). 20
000 far sheets are not run: about 100 GB at the 40-entry rate, an extrapolation. The
mechanism needs no far cell. A real sheet full of cells is multiplied the same way (the
cells bound counts its cells only after the build), and `Confirm` takes the same path as
`Describe`; both are by reading, not run. Option 1's running total across sheets, or its
early `<sheet>` count, is what closes it.

Why case 4 is not caught: at 4 000 rows, and at the 20 000-row bound, the
describe bounds count rows (20 000 at most) and non-null cells (200 000 at most).
Case 4 has 4 001 non-null cells and 4 000 rows, so both bounds admit it, and it
is not refused. This is counted from the source, not run through the route.
Case 4's file is 242 KB, far below the 4 MiB bound.

## Decision — answered 2026-11-07

**The owner's answers, 2026-11-07, at two checkpoints, relayed in the dispatch
(the options below are the ones offered; the orchestrator's recommendation was
first in each).**

1. **Which bound stops a stored address from costing memory in `readSheets`, and
   where it sits.** Offered: option 1 bound the extent (the ticket's
   recommendation) / option 2 sparse rows and cells / option 3 cut per-sheet cost /
   keep waiting. **Chosen: option 1.**
2. **What the cap counts, and how a workbook is closed.** Offered: the sum of each
   row's width as a running total across sheets (the orchestrator's recommendation) /
   rows times the widest row, as a running total / a per-sheet cap plus an early
   `<sheet>` count. **Chosen: the sum of each row's width, kept as a running total
   across sheets in `readSheets` and refused once it passes one workbook-wide slot
   cap.** No early `<sheet>` count and no separate per-sheet slot cap: the running
   total also bounds a single sheet. The per-sheet row refusal past
   `MAX_WORKBOOK_ROWS` from Build 1 stays.
3. **The cap's value.** Offered: 2,000,000 (recommended) / 1,000,000 / 4,000,000
   slots. **Chosen: 2,000,000 slots, workbook-wide.** The owner's basis: at this
   ticket's ~11 MB per million slots that is about 22 MB. The orchestrator read one
   real workbook's extent, structure only and no content: 14 sheets, 1,719 rows,
   11,196 slots by the sum (15,016 by rows times widest), the largest sheet 121 rows
   by 13 columns. That workbook is not in the repo.
4. **The `details.bound` name.** Offered: `slots` with the contract edit approved
   (recommended) / `area` with the edit approved / reuse `cells`, no edit. **Chosen:
   `slots`.** The owner approves the one prose edit to the `WORKBOOK_TOO_LARGE` doc
   comment's list of bounds in `tools/ledger/contract/src/errors.ts` (currently "its
   sheets, its rows or cells, or the request it would make"). It is the only
   contract edit approved.
5. **The import command.** Offered: the same bounds (recommended) / the import stays
   unbounded. **Chosen: the same bounds.** The command refuses what the route
   refuses, so the unbounded test the Build had is replaced by one that the command
   refuses past the slot cap.

**Answers after the build, 2026-11-07 (relayed by the orchestrator, recorded here by the
builder in the first commit of the round that follows).**

6. **Gap rows.** The builder's reading: the owner's sum of each row's width gives a far
   cell on the row axis one slot a sheet, so a part listed many times at `A1` and
   `A19000` would pass the cap while building hundreds of millions of empty rows.
   Offered: A, a row counts `max(width, 1)` slots, a gap row one (the builder's
   recommendation, as built) / B, the plain sum plus a workbook-wide row total refused as
   `rows`. **Chosen: A.**
7. **The cap, re-asked with the builder's measurement** (the premise moved from about
   22 MB to a worst case of +90 MB). Offered: keep 2,000,000 (the orchestrator's
   recommendation) / lower to 1,000,000. **Chosen: keep.**

**Answers after gate 1 (`e2e6a6cb`), 2026-11-08 (relayed by the orchestrator).**

8. **F2, the parse that no running total bounds.** Offered: refuse `<sheet>` entries that
   share a worksheet part, before the parse (the gate's and the orchestrator's
   recommendation) / the early `<sheet>` count the owner declined at answer 2 / count
   value cells in `placesOf` against `MAX_WORKBOOK_CELLS` / record it and file a ticket.
   **Chosen: refuse shared parts.** Before the parse, a workbook in which two or more
   `<sheet>` entries of `workbook.xml` resolve to the same worksheet part is refused,
   under an existing code and `details.bound` name; where none fits, the builder stops.
   The orchestrator's unverified reading, that `MAX_WORKBOOK_INFLATED_BYTES` is a
   whole-file total so that distinct parts cannot multiply the parse, was checked:
   `declaredInflatedSize` sums `declaredSize` over every entry and `countInflated` adds
   the bytes of every entry into one `total` that it compares to the bound, so it holds
   (`workbook-zip.ts`, and the comment of `workbook-parts.ts`). The code is
   `WORKBOOK_NOT_XLSX`, which has no `details.bound`: see the Log, round 1, for why it
   fits and what `WORKBOOK_TOO_LARGE` with `sheets` would have misdescribed.
9. **F4, what the command refuses.** Offered: reword to "the reader's bounds" (the gate's
   and the orchestrator's recommendation) / give the command all the route's bounds.
   **Chosen: reword.** Answer 5 is superseded below; no code changes.
10. **The cap, re-asked after F2.** Offered: keep 2,000,000 and have gate 2 re-measure
    (the orchestrator's recommendation) / lower to 1,000,000. **Chosen: keep 2,000,000.**
    The "about 22 MB" text and the Log's "+90 MB" are corrected to what is measured after
    F1 and F2 (Log, round 1: +129 MB the worst built). **Basis corrected in round 2 (gate 2's
    F2):** "the worst built" held only for files the round 1 check let through, and 14
    listings of one part, later ones spelled `sheet_x0031_`, were let through and read +375.1
    MB. The cap is kept as answered; the figure is now the worst for a workbook whose sheets
    are each a part of its own, which round 2's check enforces (Log, round 2: +132.8 MB the
    worst built at that head). **Basis corrected again at the landing (gate 3's F2):** round
    2's check does not enforce it. The +129 MB and +132.8 MB are the worst measured for
    sheets that are each a part of their own, not the worst that gets through. Gate 3 read
    +367.5 MB (peak 448.9 MB) through a zip entry whose local-header name differs from its
    central-directory name, and +352.5 MB (peak 435.4 MB) through a comments part that 14
    sheets' `.rels` all name. The cap is kept as answered; those two are lg-104's (answer
    14).

**Answers after round 1 and after gate 2 (`c2e36eb7`), 2026-11-08 (relayed by the
orchestrator, recorded here by the builder in the first commit of round 2).**

11. **Which code a shared part gets** (answered after round 1, before gate 2; not recorded
    until now). Offered: `WORKBOOK_NOT_XLSX` (the builder's recommendation, as built) /
    `WORKBOOK_TOO_LARGE` with `sheets` / `WORKBOOK_TOO_LARGE` with a new bound name.
    **Chosen: `WORKBOOK_NOT_XLSX`.**
12. **F2 after gate 2: the seven spellings of one part that the copy of SheetJS's rules does
    not know.** Gate 2 (FAIL at `c2e36eb7`) found `sharedSheetPart` answers `undefined` for
    entities in a target (`sheet&#49;.xml`, `&#x77;orksheets/`, `sheet_x0031_.xml`), a `>` inside
    a quoted `name`, an empty `r:id` beside `strRelID`, sheets with no id beside a
    relationship `Id="undefined"` and a `<sheet` followed by a tab, each of which SheetJS reads
    as two sheets over one part; `densex14`'s part listed 14 times with later entries spelled
    `sheet_x0031_` read unrefused through `readSheets` (1,960,000 cells, +375.1 MB, peak
    457.4 MB, 6.2 s), and a file `workbookEntries` refuses skipped the check altogether.
    Offered: fail closed on SheetJS's own sheet list (gate 2's and the orchestrator's
    recommendation) / patch the copy's seven rules / land as is and file a ticket.
    **Chosen: fail closed.** Before the parse: read the sheet list with SheetJS's
    `bookSheets: true` (or whatever call lists the sheets without parsing them; measure that
    it parses none); refuse unless every sheet that list names resolves, by
    `workbook-parts.ts`, to a distinct worksheet part that exists, and the counts match;
    refuse in `readSheets` whatever `workbookEntries` refuses, so the import command gets the
    same pre-parse refusal as the route. The owner accepts that the command now refuses those
    files. The code stays `WORKBOOK_NOT_XLSX` (answer 11). Round 2 also does gate 2's F3
    (walk `!data` by what it defines in `placesOf`; re-run `stubd.sh`, and push back with a
    measurement if that is wrong), N2 (105 admitted beside 106 refused) and N1 (show it moot or
    leave it), and corrects every text the round falsifies, in place.

**Answers after round 2 and after gate 3 (`3b8e95d4`), 2026-11-08 (relayed by the
orchestrator, recorded here by the lander).**

13. **The import command's message for a non-zip or `.ods` file** (answered after round 2).
    The command now refuses such a file as `WORKBOOK_NOT_XLSX` with the route's message,
    which names a comma-separated CSV although the command reads none. Offered: leave the
    route's `WORKBOOK_NOT_XLSX` message, CSV wording included (the builder's and the
    orchestrator's recommendation) / command-specific wording / reword the contract string.
    **Chosen: leave it.**
14. **What to do after gate 3's high** (gate 3 FAIL at `3b8e95d4`; gate 2's F2 still high,
    "fixed in part"; by the orchestrate-tickets rule a third gate with a high open goes to
    the owner). Offered: land and file the rest (the orchestrator's recommendation, and gate
    3's option 3) / round 3, patching the copy again (gate 3's recommendation) / round 3,
    one sheet per read / measure option 2 first. **Chosen: land and file the rest.** The
    remaining multipliers go to a new ticket, lg-104, filed in its own pull request. This
    ticket lands with F2 open at high; `main` has no bound at all, so the branch is not a
    regression. The landing rewords the shipped text that promised the unsafe direction
    (`xlsx.ts`, `workbook-bounds.ts`) and answer 10's basis, and changes no code and no
    assertion.

**Superseded (2026-11-08, answer 9):** ~~5. The import command. Offered: the same bounds
(recommended) / the import stays unbounded. Chosen: the same bounds. The command refuses
what the route refuses, so the unbounded test the Build had is replaced by one that the
command refuses past the slot cap.~~ **Now:** the command takes the reader's bounds, the
per-sheet rows (`MAX_WORKBOOK_ROWS`), the slots (`MAX_WORKBOOK_SLOTS`) and the shared-part
refusal, all of which are in `readSheets`. It has none of the route's other bounds: no
40-sheet bound, no workbook-wide rows sum, no cells bound (those are `describeWorkbook`'s,
after the read). The test that the command refuses past the slot cap stays.

Intake read at `08f78f69`: lg-88 (#733, `13a2602b`) has merged, so `rowsOf` no longer
extends a row to a merge-covered place and the cost bullet that names "on `main`
before lg-88 merges" no longer applies. The base figures above were taken at
`c9b1afdd`, before lg-88, and are re-run at `08f78f69` (Build 4).

The question and the options as filed, left as they were:

The question: which bound stops a stored address from costing memory in
`readSheets`, and where it sits.

Options, recommended first:

**1. Bound a sheet's stored extent in `readSheets`, before `rowsOf` builds the
grid (recommended).** `readSheets` already has both numbers: the sheet's
`!data` length (the rows up to the last stored one) and the widest stored column,
found in one pass over `!data`. Refuse the sheet as `WORKBOOK_TOO_LARGE` when its
rows pass `MAX_WORKBOOK_ROWS` (the gate's example), and when rows times width pass
a new slot cap. This covers both measured axes for one sheet, and both callers; what
it leaves open across sheets is its second cost. Costs:

- A slot cap to choose. Case 4 prices a slot at about 11 MB per million (its 4 000-row
  readings, 719.2 and 728.6 MB over 65.5 million slots). The cap has to sit above the
  largest real sheet, whose extent only the owner can read off a real workbook; the repo holds no real data, and the ticket does
  not guess one.
- The bound is per sheet, and the multiplier is the file's sheet count, which nothing
  bounds before the grids are built. `describeWorkbook` calls `readSheets` first and
  checks `MAX_WORKBOOK_SHEETS` (40) after, so every sheet in the file is built whatever
  its count; the parts do not bound it: `workbook.xml` can list any number of `<sheet>`
  entries that relate to one worksheet part, and each entry is built; only the 4 MiB
  inflated bound, applied to `workbook.xml` and its relationships, limits the count, at
  about 20 000 (gate 3 of this ticket: a 214 034-byte file of 10 parts and 20 000 entries
  passes the zip and inflate checks; 40 entries over one far sheet read +198.3, +197.5 MB
  against +9.6, +9.5 for one; 20 000 far sheets not run). Gate 2 of this ticket measured
  it through `describeWorkbook`, each sheet holding
  `A1` and `A100000` (not the Reproduction's fixture), the file written by one process and
  read by another: 1 sheet +7.6, +8.8 MB; 40 sheets +184.6, +180.1 MB
  (`WORKBOOK_TOO_LARGE`, `bound` `rows`); 100 sheets +416.8, +434.7 MB
  (`WORKBOOK_TOO_LARGE`, `bound` `sheets`, a 116 040-byte file). The hundred are built,
  then refused for being more than 40. So a per-sheet cap divided by 40 bounds nothing,
  and a per-sheet cap alone does not bound a workbook: at about 11 MB per million slots,
  a cap sized only above the largest real sheet can still admit hundreds of MB, against
  the 512 MB container, and a per-sheet row cap of 20 000 admits any number of sheets at
  20 000 narrow rows, which the workbook-wide row check then refuses after they are
  built. What bounds a workbook is a running total across sheets, kept in `readSheets`
  and refused when it passes a workbook-wide slot cap, or a sheet count checked before
  the build. The running total is a second number to choose and a second
  `details.bound` question. The sheet count meant here counts the `<sheet>` entries of
  `workbook.xml`, not the zip's parts, which `workbookEntries` already bounds and which do
  not see this; a names-only read (`bookSheets`) is a direction for it, not run. Either
  one closes case 5 below. Without one of the two, option 1 closes a sheet and not a
  workbook.
- "Rows times its widest stored column" overstates the cost. `rowsOf` ends a row at its
  last cell that holds a value (`holds`: a stub with no formula, an empty string and an
  error with no code do not, read from the source and not run) or, on `main` before lg-88
  merges, at a place a merge covers: a merge `A1:XFD1` with only `A1` stored gives one row
  of width 16 384 (gate 2, measured). So a bound written as "the widest stored column"
  over `!data` would count stubs the row never builds. The cost is the sum of each row's
  width, and the product is that sum only if every row is as wide as the widest. A sheet with one wide row and
  many narrow ones costs far less than the product, and a cap sized by the product
  refuses it sooner than its memory justifies. The sum comes out of the same single
  pass over `!data`, so the owner picks which of the two the cap is written against.
- The refusal must pass through `describeWorkbook`. Its `readSheets` call sits in a
  `try` that turns any error into `WORKBOOK_NOT_XLSX`, so a `WORKBOOK_TOO_LARGE`
  thrown inside `readSheets` would be reported as the wrong code. The describe
  catch must rethrow it, as the inflated-size path already does.
- A `details.bound` name for the slot cap. `rows` and `cells` already exist; a new
  name such as `area` edits the contract's prose list of bounds in
  `tools/ledger/contract/src/errors.ts`. The contract is not edited unilaterally,
  so that edit is the owner's to approve.
- The owner's import command changes. It has no row bound today, so it would now
  refuse a sheet past `MAX_WORKBOOK_ROWS`. Whether the command keeps the route's
  bounds is a separate choice, and the owner makes it.
- Small for one sheet: one function and a test per axis. It is the mechanism lg-88's
  option 2 would use. Closing a workbook adds a second piece in `readSheets`, a running
  total across sheets or an early `<sheet>` count, and a test of its own (case 5).

**2. Build only the stored rows and cells (sparse).** `rowsOf` keeps a row for each
stored row and leaves gaps and unstored columns absent, not `null` places. Memory
then follows the stored cells, and no refusal is added. Costs: the `Sheet` type in
`@ledger/books` must admit a missing row and cell, and every reader of a sheet's
row count or row width changes. A loose grep of `.rows` names `books/src/workbook.ts`,
`api/src/layout-view.ts`, `workbook-days.ts`, `workbook-import.ts` and
`workbook-describe.ts`; the reader count is not measured. The memory of a holey
1 048 576-row array is unmeasured. A far cell is still read, so a sheet at
`A1048576` shows that many rows in the layout view. Largest change, and it crosses
into `@ledger/books`.

**3. Cut what a sheet costs, not where it is spent (shared empty row, and fewer
sheets).** Let every gap row share one empty row, and lower `MAX_WORKBOOK_SHEETS`
from 40. A shared row cuts the row axis's per-row arrays. Lowering the constant cuts no
cost on its own: `describeWorkbook` checks the count after `readSheets` has built every
sheet (100 sheets were built, then refused, in option 1's second cost), so only a count
checked before the build would. Neither cuts the column axis, which is still built in
every row, or one sheet's cost. The saving from a shared row is unmeasured. The sheet
limit is a product limit, so it is the owner's.

**4. Accept the ceiling and document it.** No code change. By extrapolation, 40 far sheets
(the count the bound admits; a file can hold far more, option 1's second cost) reach about
1.9 to 2.1 GB and a 20 000-row far-column sheet about 3.6 GB, against a 512 MB container
(`compose.ledger.prod.yaml`). The process is killed rather than
refused. Not recommended.

Option 2 closes both axes. Option 1 closes them for a sheet, and for a workbook only
with its running total or an early sheet-count check. Option 1 changes no reader, and
its costs are a number (two, with the total) and a name the owner picks. Option 2 changes the `Sheet` shape. Options 3 and 4
leave the column axis open.

## Build

Option 1, as the owner answered it (Decision, above).

1. In `readSheets` (`api/src/xlsx.ts`), before `rowsOf`: read each sheet's extent
   from `!data` in one pass, without building the grid. Refuse a sheet whose last
   stored row passes `MAX_WORKBOOK_ROWS` (`details.bound` `rows`), and keep a running
   total across sheets of the sum of each row's width, refusing once it passes
   2,000,000 slots (`details.bound` `slots`). No per-sheet slot cap, no early
   `<sheet>` count. Both as `WORKBOOK_TOO_LARGE`.
2. In `describeWorkbook`, let the refusal through its `readSheets` `try`, so the code
   stays `WORKBOOK_TOO_LARGE`.
3. In `contract/src/errors.ts`, the one approved prose edit: the `WORKBOOK_TOO_LARGE`
   doc comment's list of bounds names the slots. No code, schema or type changes.
4. Tests in `api/test/xlsx.test.ts` and `api/test/workbook-describe.test.ts`: one per
   axis (case 1 and case 4), each asserting the code and `details.bound`, plus case 4's
   control at column `B` reading unchanged. One more for the multiplier: case 5 with
   its far cell moved under the per-sheet row bound, so that every entry passes the
   row refusal and only the running total refuses. **Superseded
   2026-11-08 (answer 8):** a part listed under several sheets is refused before it is
   parsed, so case 5 no longer reaches the running total; the multiplier test is that
   refusal, and the running total across sheets is tested over distinct parts.
5. Re-run the Reproduction's cases that the base figures were taken for, on the branch
   with the same script (or one that loads the same modules before its baseline), and on
   the base at `08f78f69` with it, one at a time, and put each figure in the Log
   beside the base figures above. The extrapolated cases that were never run (20,000 far
   sheets, a 20,000-row far-column sheet) are not run.
6. The import command has the reader's bounds: a test that `import:ledger` refuses a
   workbook past the slot cap, with `WORKBOOK_TOO_LARGE`'s message and exit 2.
7. (Round 1, gate 1's F1 and F3.) `rowsOf` builds exactly the rows `placesOf` charged and
   reads no row of `!data` past the last that holds a value; a row is walked by the cells
   it defines. A test that the build never touches the stub tail.
8. (Round 1, answer 8.) Before SheetJS parses any sheet, `readSheets` refuses a workbook
   in which two `<sheet>` entries resolve to one worksheet part, as `WORKBOOK_NOT_XLSX`
   (`workbook-parts.ts`), with tests through the reader, both route requests and the
   command. **Superseded 2026-11-08 (answer 12, round 2):** ~~refuses a workbook in which two
   `<sheet>` entries resolve to one worksheet part~~ by `workbook-parts.ts`' copy of SheetJS's
   rules alone; see Build 9.
9. (Round 2, answer 12, gate 2's F2, F3, N1 and N2.) Before SheetJS parses any sheet,
   `readSheets` refuses whatever `workbookEntries` refuses, then lists the sheets with
   SheetJS's `bookSheets` and refuses, as `WORKBOOK_NOT_XLSX`, unless `workbook-parts.ts`
   resolves every one of them to a part that exists, no two to the same, in the same count.
   `placesOf` and `widthOf` walk the indices an array defines. Tests: gate 2's seven spellings
   and the files `workbookEntries` refuses, through the reader and the command; 105 sheets
   admitted beside 106 refused.

## Done when

1. The owner's answers are recorded under the Decision heading with their options, and
   `status` moves to `ready` in that commit.
2. Each case in the Reproduction that was measured, run on the branch, stays under the
   bound the answer sets, and each names the bound it hits: case 1 (one far cell,
   `A1048576`) is refused as `rows`; case 3 through the route (ten such sheets) is
   refused as `rows` at its first sheet; case 4 at 4 000 rows (a cell at `XFD` in each
   row) is refused as `slots`, at the 123rd row (123 times 16 384 passes 2,000,000);
   case 5 (a part listed under many sheets) is refused as `WORKBOOK_NOT_XLSX` before it
   is parsed, and the running total across distinct sheets is refused as `slots` (106
   sheets of `A1` and `A19000`). **Superseded 2026-11-08 (answer 8):** ~~case 5 with its
   far cell under the per-sheet row bound is refused as `slots` by the running total
   across its entries, which no per-sheet check refuses~~. The readings
   are in the Log beside the base figures, the base re-run at `08f78f69`. The cases
   that were never run are named in the Log with why they were skipped.
3. Each size refusal is `WORKBOOK_TOO_LARGE` with `details.bound` `rows` or `slots`, in
   `readSheets` itself, through `describeWorkbook` (never `WORKBOOK_NOT_XLSX`) and
   through the import command (exit 2, the message on stderr); the shared-part refusal is
   `WORKBOOK_NOT_XLSX` by the same three (round 2: and so is a workbook that gives a sheet
   no part of its own, or whatever `workbookEntries` refuses, in the command as in the route). **Superseded 2026-11-08 (answer 8):** ~~each
   refusal is `WORKBOOK_TOO_LARGE` ... never `WORKBOOK_NOT_XLSX`~~ for the shared part
   only. A test in `api/test/`
   asserts the code and the bound for each axis and for each caller.
4. The control (4 000 rows at column `B`) and the full `api/test/xlsx.test.ts` suite
   hold: no value a reader sees changes for a sheet inside the bound.

## Review

**Gate: FAIL** — 2026-11-08 · `08f78f69..e2e6a6cb` · Opus 5.5, depth full

| Done when                                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Owner's answers under Decision with options; `status` to `ready` in that commit                                                                        | **verified** by reading: the branch's commit recording the answers holds 1–5 with their options and moves `status: needs-decision` to `ready` (answers (a) and (b) of 2026-11-07 are the lander's to add, per the dispatch)                                                                                                                                                                                                                                                                                                                                                |
| 2. Each measured case stays under the bound and names it; readings in the Log beside a base re-run at `08f78f69`; unrun cases named                       | **verified** — `api/test/xlsx.test.ts` › "case 1: a cell below the last row…" (`rows`), › "case 4: a far column in every row is refused as slots, at the first row past the cap" (122 read, 123 `slots`), › "case 5: one far sheet listed many times is refused as slots by the total…" (105 read, 106 `slots`); case 3 re-run here as ten entries of a value at `A1048576`: `WORKBOOK_TOO_LARGE {"bound":"rows"}`, 0 sheets built, +10.0 MB; the Log's table carries both columns, the base read on a tree whose source is `08f78f69`'s and the three skipped cases named |
| 3. `WORKBOOK_TOO_LARGE` with `rows`/`slots` in `readSheets`, through `describeWorkbook`, through the command (exit 2, stderr); a test per axis per caller | **proven** — `api/test/xlsx.test.ts` › "case 1…", "case 4…"; `api/test/workbook-describe.test.ts` › "Describe: the %s bound is WORKBOOK_TOO_LARGE, not WORKBOOK_NOT_XLSX…" and "Confirm: the %s bound is WORKBOOK_TOO_LARGE, and nothing is written" (`rows`, `slots`); `api/test/workbook-import.test.ts` › "a cell below the last row the import reads is refused as the route refuses it…" and "a far column in each row, past the slot cap…" (`ran.code` 2, `ran.err` holds the message)                                                                               |
| 4. Control at column B and the full `xlsx.test.ts` hold; no value a reader sees changes inside the bound                                                  | **proven** — `api/test/xlsx.test.ts` › "case 4's control: 4 000 rows at column B read unchanged"; the file's diff only adds; `npm test -- tools/ledger/api` 1354 of 1354; base and head `readSheets` identical on 4 of 4 workbooks (no `.xlsx` fixture exists under `tools/ledger`, so generated ones stood in)                                                                                                                                                                                                                                                            |

- **high** · F1 · no `Done when` line depends on it · **`rowsOf` builds rows that `placesOf` never charged.** `placesOf` charges up to the last row holding a value; `rowsOf` still loops over the whole `!data` and pops the empty tail afterwards. `readSheets` parses with `sheetStubs: true`, so a stub (`<c r="A1048576" s="0"/>`, formatting with no value) sets `!data`'s length. One sheet holding `A1` = `Alex` plus that stub is read, unrefused: +77.8 MB through `readSheets`. Through `describeWorkbook` it reaches the model, +59.8 MB. Forty `<sheet>` entries over that part (a 5,952-byte file) are read, unrefused, at +633.9 MB (peak 718.4 MB, 7.3 s), above the 512 MB container. Every route bound admits it by reading: 40 sheets, 40 rows, 40 cells, 40 slots. The defect is in shipped text promising a bound in the unsafe direction: `rowsOf`'s doc says "Called only on a sheet `placesOf` has charged, which is what bounds the grid". The Log's departure (2) says the stub tail is rows "that `rowsOf` drops". It does drop them, but only after it has built them. The test "a stub below the last row that holds a value is no row" asserts only the output. Remedy, measured: stop `rowsOf` at the last row holding a value. The 40-entry file then reads +10.3 MB, 4.0 s, and `xlsx.test.ts` passes 29 of 29.
- **high** · F2 · no `Done when` line depends on it; owner approval (b) rests on it · **The cap's stated worst case does not hold, and the running total does not bound the parse.** `workbook-bounds.ts` says 2,000,000 slots is "about 22 MB", and the Log says "the cap's worst case measured is about 90 MB". Both price a slot as an empty place. A part of 1,400 rows by 100 numeric cells (3.84 MB inflated, under the 4 MiB bound), listed 14 times, makes 1,979,600 slots. It is read, unrefused, at +384.7 MB (1,960,000 cells). SheetJS's parse alone is +223.8 MB, one object per entry, and it all happens before `placesOf` charges anything. The comment "the total runs across the sheets because a workbook may list one worksheet part many times" therefore promises closure of the multiplier that the parse escapes. The route refuses this file as `cells` only after it is built. The command admits it (by reading, not run). Open decision, directions not run: **(1, recommended)** refuse `<sheet>` entries that share a worksheet part, before the parse; **(2)** the early `<sheet>` count the owner declined, which still leaves 40 parses of a 4 MiB part; **(3)** count value cells in `placesOf` against `MAX_WORKBOOK_CELLS`, which closes the grid side and not the parse.
- **med** · F3 · no `Done when` line depends on it · `nfr:performance`: in a row whose only cell is a stub at `XFD`, `widthOf` walks all 16,384 places of the row's sparse array. Since `placesOf` also calls it, the walk now happens twice per row, where the base walked once (by reading). 5,000 such rows (a 30,866-byte file) take 6.4 s at +15.4 MB, unrefused. Stub rows cost no slots, so nothing bounds the count except the file's size, and repeated entries multiply it. Direction, not run: walk only the defined indices.
- **med** · F4 · no `Done when` line depends on it · Decision 5 says "the command refuses what the route refuses", but the command gets only the reader's two bounds. It has no 40-sheet bound, no workbook-wide `rows` bound and no `cells` bound. F2's file is refused by the route as `cells` and admitted by the command, by reading. The `workbook-import.test.ts` comment "the command keeps the route's bounds" says the same. Open decision: reword the record to "the reader's bounds" (recommended, since the Build asks only for the slot test), or apply `boundRowsAndCells` and the sheet count in the command.
- **low** · F5 · `workbook-bounds.ts` documents `MAX_WORKBOOK_ROWS` as "Rows over every sheet, as `xlsx.ts` reads them", but `xlsx.ts` enforces it per sheet. Only `describeWorkbook` sums the rows over every sheet. This is false in the unsafe direction for the command, though nothing relies on it today.
- **dropped** · the `rows` refusal's semantics: the route's workbook-wide check after the build is unchanged. The new per-sheet check refuses only workbooks that the workbook-wide sum already refuses. The `slots` check refuses only shapes with wide, sparse rows (123 cells at `XFD`), which is the intended change. No real-sized workbook moves.
- **dropped** · `describeWorkbook`'s catch: `BAD_REQUEST`, `INTERNAL`, `WORKBOOK_NO_SHEETS`, `TypeError`, `RangeError` and a real reader on a `workbook.xml` that is not XML all still give `WORKBOOK_NOT_XLSX`. Only `WORKBOOK_TOO_LARGE` gets through.
- **dropped** · `workbook-bounds.ts` imports nothing, so there is no cycle. Its one value is re-exported by `workbook-describe.ts`, so every importer reads the same 20,000.
- **dropped** · the Describe and Confirm `rows` tests pass with the `placesOf` call removed, because the route's own check refuses the file as `rows` after the build. With the rethrow removed they fail as `WORKBOOK_NOT_XLSX`, so they still carry the rethrow. Not a defect.
- **dropped** · a row whose widest cell is a stub: `placesOf` and `rowsOf` share `widthOf`, so that place is neither charged nor built (stub `XFD` rows build 1 cell, +15.4 MB).
- **findings** · the hunt returned 10; 5 carried, 5 dropped. Merges were not measured: lg-88 gives them no place, and this branch does not touch them.
- Positive control: with `placesOf`'s call removed, 8 of 14 lg-96 tests fail, including cases 1, 4 and 5, the running total, both command tests and both `slots` route tests. With the rethrow removed, 4 of 4 route tests fail.
- CI at `e2e6a6cb`: every check green, including `e2e`, `docker` and `test (windows-latest, informational)`.
- NFR: security — F1 and F2 (memory exhaustion by a crafted upload) · performance — F3 · reliability — F1, F2 · maintainability — F5.

### Gate 2

**Gate: FAIL** — 2026-11-08 · `e2e6a6cb..c2e36eb7` · Opus 5.5, depth full (scoped to the round)

| Done when                                                                                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Owner's answers under Decision with their options; `status` to `ready`                                                                                                                    | **verified** by reading: answers 6–10 are recorded with their options, answer 5 is struck through and superseded, and `status: ready`. The 2026-11-08 choice of `WORKBOOK_NOT_XLSX` with no `details.bound` is the lander's to add, per the dispatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2. Each measured case is refused under the bound it names; readings in the Log beside the base; unrun cases named                                                                            | **verified** — `api/test/xlsx.test.ts` › "case 1: a cell below the last row the import reads is refused as rows, whatever the file's size", › "case 4: a far column in every row is refused as slots, at the first row past the cap", › "case 5: one part listed under many sheets is refused before it is parsed, whatever the far cell" (`WORKBOOK_NOT_XLSX`), › "the slots run across distinct parts too: 106 sheets of A1 and A19000 are refused as slots". Case 3 was re-run here through `describeWorkbook`: ten parts of their own, each `A1` and `A1048576`, give `WORKBOOK_TOO_LARGE {"bound":"rows"}`, +10.3 MB, 67 ms. The "before it is parsed" clause has no assertion; it is verified by measurement: case 5's spelling at 14 entries over a dense part is refused in 2–3 ms at +0.4 MB, against +375 MB read. The Reproduction's case 5 spelling is refused. Other spellings of it are not (F2) |
| 3. Size refusals are `WORKBOOK_TOO_LARGE` with `rows`/`slots` by the reader, the route and the command; the shared part is `WORKBOOK_NOT_XLSX` by the same three; a test per axis per caller | **proven** — gate 1's `rows`/`slots` tests still pass at this head; `api/test/xlsx.test.ts` › "case 5: …"; `api/test/workbook-describe.test.ts` › "a part listed under two sheets is WORKBOOK_NOT_XLSX before it is parsed, by Describe and by Confirm" (415, model never asked); `api/test/workbook-import.test.ts` › "a part listed under two sheets is refused before it is parsed" (exit 2, the message on stderr). Turning `refuseSharedParts` off fails all three, and the three spelling tests                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4. Control at column B and the full `xlsx.test.ts` hold; no value a reader sees changes inside the bound                                                                                     | **proven** — `api/test/xlsx.test.ts` › "case 4's control: 4 000 rows at column B read unchanged"; `npm test -- tools/ledger/api` 1362 of 1362; `readSheets` at base, at gate 1's head and at this head gives identical output on 8 of 8 workbooks (lg7, dense 1 400×100, the stub and stub-wide files, a mixed sheet of sparse rows, error cells, formulas with no value, empty strings and stub tails)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Gate 1's findings:

- **F1 (high): fixed.** `rowsOf` now builds `placesOf`'s `widths`, and nothing else. `stub1` reads +9.4 MB, down from +77.8. Forty distinct parts each ending in a stub at `A1048576` read +9.9 MB. The shared `stub1x40` is refused in 3 ms. When `placesOf` pads `widths` to `!data`'s length, 5 tests fail, "the stub tail is never built, not only absent from the rows (gate 1's F1)" among them.
- **F2 (high): fixed in part. Still high.** The plain spelling is refused before the parse: `densex14` in 3 ms, +0.4 MB. Seven other spellings are read by SheetJS as two sheets over one part, and `sharedSheetPart` returns `undefined` for each:
  - `worksheets/sheet&#49;.xml`;
  - `&#x77;orksheets/sheet1.xml`;
  - `worksheets/sheet_x0031_.xml` (SheetJS's `unescapexml` decodes all three);
  - a `<sheet>` whose `name` holds a `>`. SheetJS's `tagregex1` allows one inside quotes; the copy's `<[^<>]*>` splits the tag, so the copy falls back to positional reads;
  - `r:id=""` with `strRelID` (SheetJS falls back on a falsy id; the copy only on a missing one);
  - sheets with no id at all, beside a relationship `Id="undefined"` (SheetJS looks up `hash[undefined]`);
  - a decoy `<sheet` followed by a tab, with an id that does not resolve. SheetJS's `parsexmltag` splits a tag only on space, LF and CR, so it ignores the decoy; the copy counts it and falls back to positional reads.

  `densex14`'s part listed 14 times, the later entries spelled `sheet_x0031_`, is read unrefused through `readSheets`: 1,960,000 cells, +375.1 MB, peak 457.4 MB, 6.2 s. Through `describeWorkbook` it is +347.7 MB and refused as `cells` only after the build. The workbook-wide text promises the unsafe direction. `workbook-bounds.ts` says "A part that several sheets name is refused before this runs". Answer 10 kept the cap on "+129 MB the worst built". The command clause is the builder's stated limit, now measured. A file `workbookEntries` refuses (a workbook part `XL/Workbook.xml`, or one renamed through its content type) skips the check. `readSheets`, which is all the command runs, reads it as two sheets over one part. The route refuses it earlier, at `workbookEntries`. **Open decision**, directions not run: **(1, recommended)** fail closed. Read the sheet list with SheetJS's own `bookSheets: true`, which skips the sheets, and refuse unless every sheet it lists resolves, by the copy, to a distinct part that exists, in the same count. `refuseSharedParts` also refuses whatever `workbookEntries` refuses, which changes the command for such files. **(2)** Add each missing SheetJS rule to the copy. A later difference reopens it.

- **F3 (med, no `Done when` line depends on it): fixed in part.** `widthOf` now skips a row's holes. `stubwide` takes 2.76 s, down from 6.4 s, and widths are identical on 8 of 8 workbooks. `placesOf`'s own loop is the same mechanism on the row axis: `(sheet["!data"] ?? []).entries()` still visits every hole of a stub tail. 400 parts of their own, each `A1` plus a stub at `A1048576` (a 153,262-byte file), take 19.6 s through `readSheets`. Through `describeWorkbook` they take 19.8 s, synchronously, and are refused as `sheets` only after. SheetJS's parse of 40 such sheets is 28 ms, against `readSheets`' 1,986 ms. About 990 sheets (`MAX_WORKBOOK_ENTRIES`) would come to about 48 s by extrapolation; this was not run. Direction, not run: walk `!data` with `forEach` in `placesOf`, as `widthOf` now does.
- **F4 (med): fixed.** Answer 5 is superseded by answer 9. The `workbook-import.test.ts` comment now says "the reader's bounds" and names the route bounds the command lacks. Build 6 and Done when 3 are reworded to match.
- **F5 (low): fixed.** `workbook-bounds.ts` now says `MAX_WORKBOOK_ROWS` bounds each sheet in the reader, and that only the route sums the rows.

New in the round:

- **low** · N1 · the opposite drift, in the safe direction. `sharedSheetPart` accepts `<Relationship` followed by a tab, which SheetJS ignores. The copy then reports a shared part where SheetJS reads by position: one sheet from `sheet1.xml`, and none from the absent `sheet2.xml`. The file is refused, though SheetJS would not read the part twice. No workbook Excel saves has that tab.
- **low** · N2 · `nfr:maintainability`: "the slots run across distinct parts too" asserts that 106 sheets are refused, but not that 105 are admitted, which the old case 5 asserted. The boundary its comment computes is unpinned.
- **dropped** · the dispatch's `./`, `../`, URL-encoded, leading-`/`-with-other-case and positional shapes. SheetJS reads each as one sheet from the part, and the copy agrees. Duplicate `r:id`s, two content-type overrides, the fallback workbook name, a backslash and a namespaced `<x:sheet>` are refused, matching SheetJS. Not defects.
- **dropped** · the regexes in `workbook-parts.ts` are linear by reading, and `textOf` caps each inflate at the bound. Not defects.
- **dropped** · XLSB through the command: `workbookEntries` refuses it, so it skips the check, and `bookType` refuses it only after SheetJS parses it. This is by reading, not run. It falls under F2's command clause, so it is not a new finding.
- **findings** · the hunt returned 7: 4 carried (F2 in part, F3 in part, N1, N2) and 3 dropped.
- Positive controls: with `refuseSharedParts` off, 6 of 125 tests in the three files fail. With `widths` padded to `!data`'s length, 5 of 125 fail. The shape probe's control (the plain shared spelling) is refused.
- CI at `c2e36eb7`: all ten checks are SUCCESS, including `e2e`, `docker`, `test (windows-latest, informational)` and `CodeQL`.
- NFR: security — F2 (memory from a crafted upload), F3 (CPU) · performance — F3 · reliability — F2 · maintainability — N2, and `workbook-parts.ts` as a copy that a SheetJS upgrade must re-read.

## Log

- 2026-11-01: filed from lg-88's gate (PR #733, PASS, the far cell raised as an open
  decision). The owner chose to file a ticket, over folding it into lg-88 or logging it
  only. Filed on `83eac952`, `origin/main` at filing.
- 2026-11-01: the builder re-ran the gate's `far-cell.mts` and `far-sheets.mts` on
  `83eac952` (the gate's scripts, from the gate's scratch directory). Commands and
  output:
  - `node --expose-gc --import tsx far-cell.mts <tree> <tree>/tools/ledger/api/src/xlsx.ts A1048576`
    gave `peakRssDeltaMb` 56.2, 55.3 and 54.3 over three runs (`fileBytes` 15 905,
    `rows` 1 048 576).
  - `far-sheets.mts <tree> 1` gave `WORKBOOK_TOO_LARGE`, `peakRssDeltaMb` 35.8.
  - `far-sheets.mts <tree> 10` gave `WORKBOOK_TOO_LARGE`, `peakRssDeltaMb` 530.7,
    `peakRssMb` 696.3, `fileBytes` 24 904. The gate's report said +408 MB on the same
    sha; the gate's output file is absent, so the report is its only record.
- 2026-11-01: a column-axis case was not in the gate's brief and was found by the
  builder, measured as case 4 above. `rowsOf` makes each row as wide as its own last
  cell that holds a value (corrected in rounds 1 and 2 from "the width of the widest stored column"), so
  a sheet whose rows each hold a far cell is wide in every row, and the row bound does
  not see it. It is measured at 4 000 rows and
  not beyond, and the 20 000-row figure is an extrapolation.
- 2026-11-01: the brief's "roughly 2 GB" for 40 sheets was an extrapolation from the
  gate's 408 MB, and was not measured. The ticket states it as an extrapolation, a
  range of 1.6 to 2.1 GB from both readings.
- 2026-11-01: read the `describeWorkbook` order on `83eac952`. `readSheets` runs
  before the sheet-count, rows and cells bounds, and its `try` turns any error into
  `WORKBOOK_NOT_XLSX`. That is why Build step 2 and the first option's cost name the
  rethrow.
- 2026-11-01: gate 1 (FAIL at `c9b1afdd`) round applied by a fixer, no ship authority.
  - F1 (high): the Reproduction, run as it described, did not give its figures. The
    fixture was built in the measuring process, which raised the peak before the call
    (case 1 read +20.7 to +21.2 MB, case 4 at 1 000 rows +31.8 MB). The section now
    says the fixture is written by one process and read by another, and its table holds
    gate 1's method-B readings (`measure2.mts`, `run-clean.sh`, `clean.jsonl`), cited as
    the gate's. The fixer re-ran three cases by that procedure on `c9b1afdd`: case 1
    +60.6, case 4 at 1 000 rows +182.7, control +4.9 MB. The figures in the earlier Log
    entries above (+54.3 to +56.2, +35.8, +530.7) are the filer's in-process readings and
    are superseded by the table.
  - F2 (med): option 1's costs now say the bound is per sheet, multiplied by up to 40
    sheets, and name a running total across sheets as the other way to size it.
    Corrected in round 2: the multiplier is the file's sheet count, not 40.
  - F3 (low): the two causal claims about the ten-sheet gap are dropped, and the 40-sheet
    extrapolation is restated from the readings that stand (about 1.9 to 2.1 GB, replacing
    1.6 to 2.1 GB, still extrapolated). The Log entry above that says the +408 reading was
    "on the same sha" and the one giving 1.6 GB are superseded the same way. The 20 000-row
    figure moves from about 3.4 GB to about 3.6 GB on the new case 4 readings.
  - F4 (low): "its finding F5" corrected in the Why and in the first Log entry. lg-88's
    gate carried the far cell as a `dropped` bullet and an open decision.
  - F5 (low): option 1 now states that rows times widest column overstates the cost,
    which is the sum of each row's width.
  - F6 (low): left as written, on purpose: `Done when` 2 reads two ways until the answer
    rewrites it, and the Build already says it may.
  - Also, at the orchestrator's instruction: the Why's and the first measurement Log
    entry's "widest stored column" per row was false. `rowsOf` computes `width` per row from
    its own stored cells, so each row ends at its own last stored cell. Both are corrected
    in place; case 4 is unaffected, since every row there holds `XFD`.
- 2026-11-01: gate 2 (FAIL at `96aaafef`, one high) round applied by a fixer, no ship
  authority.
  - F2, remaining clause (high): the multiplier is the file's sheet count, not 40.
    `describeWorkbook` builds every sheet and checks `MAX_WORKBOOK_SHEETS` after, so only
    `MAX_WORKBOOK_ENTRIES` bounds it (corrected at the landing, gate 3, P1: the 4 MiB
    inflated bound does, not the parts). Corrected in option 1's second cost (with gate
    2's
    1, 40 and 100-sheet readings), the table's 40-sheet row and the paragraph after it,
    option 3's "lower `MAX_WORKBOOK_SHEETS`" (which changes no cost on its own), the
    closing comparison of the options, and round 1's F2 Log bullet. "The sheet count it
    is multiplied by" is dropped as an alternative; the running total, or a count check
    ahead of the build, is named as what bounds a workbook. Not run: 20 000 far sheets.
  - F1, remaining clause (low): the Reproduction now says what the second process has
    loaded before its baseline moves the delta, with gate 2's two orderings beside gate
    1's, and the "never exceeds" sentence is softened. Build 4 names the condition.
  - N1 (low): "0.2 s" dropped from the PR #733 column; that thread gives +49.3 and no
    time for it.
  - N2 (low): the F5 cost now says a row ends at its last cell that holds a value, or at a
    merge-covered place, and that stubs do not widen it. The Why and the first measurement
    Log entry say only "its own last cell that holds a value" (corrected at the landing,
    gate 3, P2: this bullet said the Why said all of it).
- 2026-11-01 — Owner's answer, O1 (gate 3's open decision: the duplicate-`<sheet>`-entry
  mechanism, a defect on `main` that needs no far cell). Options: (a) fold it into lg-96
  as the multiplier's reproduction, case 5, and let option 1's running total or early
  count close it (gate 3's recommendation); (b) file a sibling ticket and keep lg-96 to
  the two address axes. The owner chose (a). Case 5 and its paragraph are in the
  Reproduction.
- 2026-11-01 — Owner's answer, gate 3's P1, P2 and P3 (below the floor, no `high`).
  Options: P1 and P2 at the landing with P3 recorded (the orchestrator's recommendation);
  all three at the landing; record all three. The owner chose all three at the landing,
  with no re-gate.
- 2026-11-01 — Fixed at landing by owner choice: gate 3, P1 — "only
  `MAX_WORKBOOK_ENTRIES` (1 000 parts) limits it, about 990 sheets (not run)". Replaced
  with the gate's text in option 1's second cost; the Log's "a file near 990 sheets" is
  "20 000 far sheets"; option 4's "40 far sheets" gains the gate's parenthesis; and "a
  sheet count" is said to count the `<sheet>` entries, not the zip's parts. Proof: no
  line outside this entry mentions "990".
- 2026-11-01 — Fixed at landing by owner choice: gate 3, P2 — "the Log's N2 bullet says
  the Why now says ... the Why, and the first measurement Log entry, say only 'its own
  last cell that holds a value'". The N2 bullet now says what the Why says and where the
  merge clause and the stubs are.
- 2026-11-01 — Fixed at landing by owner choice: gate 3, P3 — "'Small: one function and a
  test per axis', Build 1 and `Done when` 2 ... describe option 1 as the per-sheet bound
  alone". The three now carry the running total across sheets or the early `<sheet>`
  count, and a case that fails without it (case 5 with its far cell under the per-sheet
  bound, not run).
- 2026-11-01 — Gate 1's, gate 2's and gate 3's full reports are on the pull request
  thread, #735; status unchanged (`needs-decision`).
- 2026-11-07 — Owner's answers, recorded under the Decision heading before any source
  change: option 1; the sum of each row's width as a running total across sheets, one
  workbook-wide cap of 2,000,000 slots, `details.bound` `slots` with the one prose edit
  to `contract/src/errors.ts` approved, and the import command on the same bounds. The
  Build and `Done when` 1 to 3 are reworded to them; the intake's stale point (lg-88
  has merged, base re-run at `08f78f69`) is recorded beside the answers.
- 2026-11-07 — Built (builder, no ship authority), branch `lg-96-bound-a-sheets-extent`,
  base `08f78f69`. What changed: `api/src/xlsx.ts` charges each sheet in `placesOf`
  before `rowsOf` builds it, with one running total across the workbook's sheets;
  `MAX_WORKBOOK_ROWS` and the new `MAX_WORKBOOK_SLOTS` (2 000 000) live in
  `api/src/workbook-bounds.ts` (`workbook-describe.ts` re-exports the rows one, so its
  importers are unchanged); `describeWorkbook` rethrows `WORKBOOK_TOO_LARGE` from its
  `readSheets` `try`; the one approved prose edit is in `contract/src/errors.ts`. The
  import command needs no change of its own: it calls the same `readSheets`, and its
  catch prints the refusal's message and exits 2.
  - **Where this departs from the ticket's words, for the gate to check.** (1) A row
    counts for at least one place: `placesOf` adds `max(width, 1)` for each row up to
    the last that holds a value, a gap row counting one. The owner's answer was the sum
    of each row's width; on that alone a far cell costs 1 slot a sheet, and case 5 with
    its far cell on the row axis (`A1` and `A19000`, listed 20 000 times) would pass the
    cap while building 400 million empty rows. Counted this way a real workbook is
    11 196 plus its 1 719 rows, about 12.9 thousand against 2 million. If the owner
    wants the plain sum, the alternative is a workbook-wide row total refused as
    `rows`; it is a one-line change in `placesOf`, and case 5's test would then move to
    the column axis (123 entries, `A1` and `XFD1`). (2) The row refusal is "a cell that
    holds a value in a row past 20 000", not `!data.length`: SheetJS's `!data` can end in
    stub rows that `rowsOf` dropped **after building them (gate 1's F1; corrected in round 1,
    where `rowsOf` builds none of them)**, and the test "a stub below the last row that holds a
    value is no row" pins it. (3) The rows bound named in the refusal is per sheet and the
    route's own workbook-wide rows check after the read stays as it was.
  - **The control in case 5 is gone by design.** The Reproduction's one-entry control
    (`A1` and `A100000`) is now refused as `rows` on the branch, as it has a cell past row
    20 000; the control is the one-entry file at `A19000`, which the test
    "case 5" reads.
  - **Readings**, one script (`measure.mts`, scratch only) on both trees, the fixture
    written by one process and read by another, `readSheets` and `describeWorkbook`
    imported before `gc()` and the baseline, one process at a time, the machine shared. Base is
    this branch's tree before its source change (`b3fd4660`, whose source is `08f78f69`'s);
    branch is `8e622a7a`, the source of `52ee7fc9`. Figures are the growth of `maxRSS`
    over the baseline, in MB.

    | Case                                                          | Base `08f78f69`                              | Branch                                          |
    | ------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
    | 1. one far cell, `readSheets`                                 | +66.9, +64.9, +67.0; 117–148 ms              | `rows`, +9.3, +10.9, +9.0; 62–70 ms             |
    | 2. one far sheet, through the route                           | +65.9, +56.2 (`rows`, after the build)       | `rows`, +9.2, +6.6                              |
    | 3. ten far sheets, through the route                          | +484.2, +495.4; peak 600.4, 612.6; 1.1–1.8 s | `rows` at the first sheet, +7.6, +9.3; 66–67 ms |
    | 4. 1 000 rows at `XFD`                                        | +189.8; 1.5 s                                | `slots`, +10.1                                  |
    | 4. 4 000 rows at `XFD`                                        | +730.6, +729.1; 7.3–7.8 s                    | `slots`, +13.3, +13.0; 147 ms                   |
    | 4. control, 4 000 rows at `B`                                 | +3.4, +2.1; 65 ms                            | read, 4 000 rows, +2.2, +2.3                    |
    | 5. 40 entries, far cell `A100000`                             | +173.5, +174.2; 40 sheets read               | `rows` at the first entry, +1.0, 0.0            |
    | 5. control, one entry, `A100000`                              | +3.9; 1 sheet read                           | `rows` (past row 20 000), 0.0                   |
    | 5 variant: 150 entries, far cell `A19000` (not in the ticket) | +131.7; 150 sheets read                      | `slots` at the 106th entry, +89.8               |
    | 5 variant: 105 entries, `A19000` (the most the cap admits)    | not run                                      | read, 105 sheets, +90.1                         |
    | 4. 122 rows at `XFD` (the most the cap admits)                | not run                                      | read, +32.0                                     |

    The base figures agree with the ticket's table (case 1 +62 to +63, case 3 +498 to
    +533, case 4 at 4 000 rows +719 to +729, case 5 +198), within the script-to-script
    spread the Reproduction warns of; case 5 reads about 25 MB lower than gate 3's
    (taken before lg-88 merged); the reason is not measured.
    **What the cap admits** is the bound on the memory: 122 rows at `XFD` is +32 MB, and
    105 entries of 19 000 gap rows is +90 MB. A gap row costs about 45 MB a million
    places, and a width place about 16 MB a million (2 million of them, +32 MB), against
    the 11 MB a million that the owner's "about 22 MB" took from case 4's readings. The
    cap's worst case measured is about 90 MB, under the 512 MB container by a wide margin.
    **Superseded in round 1 (gate 1's F2): the worst built after F1 and F2 is +129 MB, and
    the 90 MB was a shared part, now refused.** (Round 2: "now refused" held for the plain
    spellings only; see the round 2 entry.)

  - **Skipped, and why**: 40 far sheets (the 1.9 to 2.1 GB extrapolation), a 20 000-row
    far-column sheet (3.6 GB), and 20 000 far entries (100 GB) were never run, as the
    dispatch said; five far sheets in case 3 was not re-run (it was not asked and case 3's
    ten are the figure). The base was run on `08f78f69` only for the cases the ticket had
    measured.
  - **Red/green** by two mutations, each committed and restored from a sha (`e528e146` and
    the restore `8e622a7a`): with `placesOf` not called, 8 of the 117 tests in
    `xlsx.test.ts`, `workbook-describe.test.ts` and `workbook-import.test.ts` fail (cases 1,
    4 and 5, the running total, the two command tests, and the `slots` route tests); with
    the charge on and the `WORKBOOK_TOO_LARGE` rethrow in `describeWorkbook` removed, the 4
    route tests (Describe and Confirm, `rows` and `slots`) fail as `WORKBOOK_NOT_XLSX`.
  - **Tests**: `xlsx.test.ts` gains 8 (case 1; the last admitted row; a stub row; case 4 at
    122 and 123 rows; the control; the total across two sheets; case 5, 105 entries read
    and 106 refused; a wide row costs its own width), `workbook-describe.test.ts` 4
    (Describe and Confirm, `rows` and `slots`, through the real reader) and
    `workbook-import.test.ts` 2 (the command, `rows` and `slots`; no books directory is
    created). Build 5's "unbounded" test does not apply and is replaced by those two.
    A sheet-written fixture whose `!ref` spans XFD costs the writer far more than the read
    (a 3 000-row version with the wide cell at `XFD1` took 32 s to write), so the "wide
    row" test uses `ZZ1`.
  - **Fold-in, not done**: none found.
  - **Not proven here**: the Windows leg and CI; they are the draft pull request's.
  - **Suites**: `npm test -- tools/ledger/api` at `8e622a7a`: 53 files, 1 354 of 1 354
    tests pass, so `xlsx.test.ts` as a whole holds (`Done when` 4); `npm run check` exit 0.
- 2026-11-08 — Round 1, after gate 1 (FAIL at `e2e6a6cb`, F1 to F5), builder, no ship
  authority. Answers 6 to 10 are recorded under the Decision heading, in this commit.
  Head `2a53dc5e` for the code; this entry is the commit after it.
  - **F1 (high), fixed.** `rowsOf` looped over the whole `!data` and popped the empty tail
    afterwards, so a stub at `A1048576` built a million rows that `placesOf` had not
    charged. `placesOf` now returns the width of each row up to the last that holds a
    value and `rowsOf(sheet, widths, date1904)` builds exactly those and reads no other
    row. Gate 1's `stub1x40` (40 entries over one stub part, 5 952 bytes): `+633.9 MB`
    (peak 718.4 MB, 7.3 s) at `e2e6a6cb`; with F1 alone, in my tree before F2 was written,
    **+9.8 MB**, 1.96 s, 40 sheets read; at `2a53dc5e` the same file is refused by F2 (below).
    The distinct-part form, which F2 does not refuse (`stubd40`: 40 sheets of their own,
    each `A1` and a stub at `A1048576`, 22 263 bytes), at `2a53dc5e`: read, 40 sheets,
    **+10.3 MB**, 2.3 s. `stub1`: +9.2 MB (gate: +77.8). Test: `xlsx.test.ts` ›
    "the stub tail is never built, not only absent from the rows (gate 1's F1)" watches
    the `!data` array, and after `placesOf` the build reads index `0` and no other of
    1 000; with `placesOf` padding `widths` to the array's length (a mutation, restored from
    the sha) it fails, and so do the three F8 tests and "a stub below the last row", which read
    the output.
  - **F2 (high), fixed as the owner answered (8).** `sharedSheetPart`
    (`api/src/workbook-parts.ts`) resolves each `<sheet>` entry to the part SheetJS reads
    it from, by SheetJS's own rules copied (the workbook part by content type, the
    relationship by `r:id`, the target tried as `xl/<target>`, the target, and beside the
    relationships, names matched without case, a whole workbook read by position when a
    sheet has no relationship) and `readSheets` refuses two entries on one part as
    `WORKBOOK_NOT_XLSX`, before `XLSX.read`. Gate 1's `densex14` (14 entries over a
    1 400 by 100 part, 3.84 MB inflated): `+384.7 MB` (peak 469.2 MB, 7.4 s) at `e2e6a6cb`,
    refused at `2a53dc5e` in 2 ms (`+0.0 MB`); `stub1x40` and `far1x10` the same.
    **The inflate bound is a whole-file total** (verified, not assumed): see answer 8.
  - **Why `WORKBOOK_NOT_XLSX`, the choice made inside the owner's stop.** The stop was
    for a code or a `details.bound` name that does not fit. No new code or name was made.
    `WORKBOOK_TOO_LARGE` with `sheets` would misdescribe it (two sheets on one part is not
    "over 40 sheets"), and with `entries` too (the zip's parts). `WORKBOOK_NOT_XLSX` is
    what `workbook-zip.ts` already says of every shape that is "none a workbook a
    household saves" (zip64, a local header that disagrees with the directory, an end
    record only SheetJS would read): Excel writes a part per sheet. It has no
    `details.bound`. The route wraps whatever `readSheets` throws as `WORKBOOK_NOT_XLSX`
    in any case, so a shared part is the same code on screen from either reader. **If the
    owner wants a `WORKBOOK_TOO_LARGE` or a new bound, it is a one-line change in
    `refuseSharedParts` (`xlsx.ts`).** The route (415) and the command (exit 2, the message
    on stderr) were tested.
  - **WITHDRAWN — do not cite this paragraph** (gate 2's F2, round 2). **A cost the brief
    did not name: the resolution is a copy of SheetJS's.** What is
    refused has to be what SheetJS reads twice, and it picks the part by rules of its own,
    not the format's (`workbook-parts.ts`' header lists them). The test reads each spelling
    it refuses through SheetJS itself (an absolute target, another case, an `xl/` prefix:
    each parsed as two sheets over one part). Where the copy and SheetJS differ, a shared
    part gets through and nothing is worse than before the round (the cells and inflate
    bounds). A SheetJS upgrade should re-read it. **Left open**: a workbook that
    `workbookEntries` refuses is not checked for a shared part, and the command, which
    never ran the inflate bound, is then read as it was.
    _Retraction (builder, round 2):_ "nothing is worse than before the round (the cells and
    inflate bounds)" is false of the memory: seven spellings SheetJS reads as one part twice
    were not refused, and `densex14`'s part listed 14 times (later entries `sheet_x0031_`)
    read 1,960,000 cells, +375.1 MB, peak 457.4 MB, 6.2 s through `readSheets` (gate 2),
    which no cells bound counts before the parse. "Left open" was the command and the files
    `workbookEntries` refuses; round 2 closes both. I stated a bound I had measured only on
    the spellings I had thought of.
  - **WITHDRAWN — do not cite this paragraph** (gate 2's F3: fixed in part, round 2).
    **F3 (med), fixed.** `widthOf` visits the cells a row defines (`forEach` skips the holes
    of a sparse row), and `placesOf` hands its widths to `rowsOf`, so a row is walked once.
    Gate 1's `stubwide` (5 000 rows whose one cell is a stub at `XFD`, 30 866 bytes): 6.4 s
    at `e2e6a6cb`, **2.57 s** at `2a53dc5e` (+10.0 MB), the rest SheetJS's own parse.
    Not pinned by a test: a clock measures the machine, and a count of the cells a
    `forEach` visits cannot be told from a count through a `Proxy`.
    _Retraction (builder, round 2):_ `widthOf` was fixed and `placesOf`'s own loop, the same
    mechanism on the row axis, was not (400 distinct stub-tail sheets took 19.6 s), and
    `forEach` calls back only for the defined indices but still scans the length, as this
    paragraph did not allow: 37.8 ms a walk of a million-long `!data` against `entries()`'s
    42.6 (see round 2). The "cannot be told" claim is wrong too: a `Proxy` over a sparse array
    counts the indices asked about, which `entries()` and `forEach` ask for every one of.
  - **F4 (med), reworded.** Answer 9. The Decision's answer 5, Build 6, Done when 3 and the
    comment in `workbook-import.test.ts` now say "the reader's bounds". No code.
  - **F5 (low), reworded.** `workbook-bounds.ts` says `MAX_WORKBOOK_ROWS` bounds each sheet
    in the reader and that the route also sums it, which the command does not.
  - **The cap, measured after F1 and F2 (answer 10).** One process builds, another reads,
    `--max-old-space-size=900`, one case at a time, growth of the peak over the baseline:
    122 rows with a cell at `XFD` (1 998 848 places, 22 311 bytes) **+39.6, +39.6 MB**;
    105 sheets of `A1` and `A19000` (1 995 000 places, 119 881 bytes) **+109.3, +109.9 MB**
    (peak 194 MB); one sheet of 1 400 rows by 100 numbers (140 000 cells, 3.84 MB, `dense1`
    +56.5 MB alone) beside 97 sheets of `A1` and `A19000`, the worst built (1 983 000
    places, 3.94 MB, under the 4 MiB inflate bound) **+127.1, +129.0 MB** (peak 217 MB).
    The 512 MB container holds it, and the figures replace "about 22 MB" and "+90 MB". It
    is the worst I built, not a proof of a worst.
  - **Tests**: `xlsx.test.ts` 35 of 35 (case 5 as a refusal; three spellings of one part;
    12 sheets of their own read; 106 distinct sheets refused as `slots`; the stub tail),
    `workbook-describe.test.ts` and `workbook-import.test.ts` one each for a shared part.
    Mutations, restored from the sha: with `refuseSharedParts` off and the widths padded,
    11 of 125 tests in the three files fail.
- 2026-11-08 — Round 2, after gate 2 (FAIL at `c2e36eb7`, F2, F3, N1, N2), builder, no ship
  authority. Answers 11 and 12 are recorded under the Decision heading in `3f45c1a0`, before
  any source. Code `48ec0f7d`, mutations `f3cc50fe` and the restore `99cc3a57` (tree equal to
  `48ec0f7d`); this entry is the commit after. Measured one case at a time, two processes
  (one builds, one reads), `--max-old-space-size=900`, nothing near +1 GB.
  - **F2 (high), fixed as the owner answered (12).** **WITHDRAWN — do not cite "fixed"
    (gate 3's F2, at the landing); the retraction is at the end of this bullet.**
    `readSheets` runs `refuseUnlessEachSheetIsItsOwn`
    before `XLSX.read`: `workbookEntries` first (whatever it refuses, the command meets as the
    route does, as `WORKBOOK_NOT_XLSX`/`WORKBOOK_TOO_LARGE` with its own message), then SheetJS's
    own sheet list (`bookSheets: true`), then `sheetPartsOf` (`workbook-parts.ts`), and it refuses
    as `WORKBOOK_NOT_XLSX` unless the copy finds the same number of sheets, every one in a part
    that exists, no two in one. **`bookSheets` parses no sheet**: it returns the names and no
    `Sheets` (pinned by a test, `listed.Sheets` undefined); it does inflate the zip's entries,
    so `densex14`'s plain part (3.85 MB inflated) costs +4.7 MB and 45 ms through `readSheets`
    where the parse costs +375 MB. `bookSheets` runs the workbook part's XML parse only.
    Gate 2's `mult.sh` at `99cc3a57`: `densex14` plain (14 listings, one spelling) refused,
    +4.7 MB, 45 ms; the `sheet_x0031_` file through `readSheets` **refused, +5.4 MB, 45 ms**
    (gate 2 at `c2e36eb7`: read, 1,960,000 cells, +375.1 MB, peak 457.4 MB, 6.2 s); through
    `describeWorkbook` **refused, +8.1 MB, 85 ms** (gate 2: +347.7 MB, refused as `cells` after
    the build). Gate 2's `shapes.mts` (adapted to `sheetPartsOf`, `build/shapes-r2.mts`) at
    `99cc3a57`: **21 of 21 shapes refused by `readSheets` as `WORKBOOK_NOT_XLSX`**, including
    its seven (`numeric_ref`, `hex_ref`, `x_code`, `gt_in_name`, `empty_rid_strrelid`,
    `id_undefined`, `tab_sheet_decoy`) and the two files `workbookEntries` refuses
    (`upper_workbook`, `gt_in_override`), which the command now refuses as the route does.
    _Retraction (lander, on gate 3's F2, FAIL at `3b8e95d4`; the claim was the round 2
    builder's):_ F2 is not fixed; it is fixed in part and still high. The 21 shapes above
    are refused, but the check is fail-closed only on the sheet count. Whether parts are
    distinct is judged by a copy of SheetJS's rules, and gate 3 found two ways past it, each
    read through `readSheets`. A zip entry whose local-header name differs from its
    central-directory name (`workbookEntries` and `compressedOf` never compare the two) sends
    SheetJS's CFB to another entry, so 14 targets read one 1,400 by 100 part 14 times:
    1,960,000 cells, +367.5 MB, peak 448.9 MB, 6.1 s (the honest control, local equal to
    central, reads 140,013 cells at +63.1 MB). A part that each sheet's `.rels` names, such
    as comments, is parsed once per sheet: 14 sheets over one 50,000-comment part, +352.5 MB,
    peak 435.4 MB (14 distinct parts of the same total, +54.6 MB). Owner's answer 14 lands the
    branch with this open and files it as lg-104.
  - **WITHDRAWN — do not cite the clause "the check no longer rests on it, the count and the
    existence do" in this paragraph (gate 3's F2, at the landing).** The count and the
    existence are fail-closed; the distinctness of the parts is still judged by the copy (see
    the retraction above). **The copy was also made exact where a difference lets two sheets look distinct to it and
    the same to SheetJS** (this is not option 2, which patches seven rules and stops there; the
    check no longer rests on it, the count and the existence do): the tag split is SheetJS's
    `tagregex1` and `parsexmltag` ported, so the `>` in a name, the tab after a tag name, the
    empty `r:id` beside `strRelID` and the absent id (`hash["undefined"]`) read as SheetJS reads
    them; the zip is searched as `safegetzipfile` does and a part's identity is its entry; text is
    read a byte to a character (`cc2str`), so two bytes SheetJS tells apart are not one character
    here; a target `unescapexml` would change (`&`, `_x0031_`) is "cannot tell", which is refused,
    because a part literally named `sheet&#49;.xml` beside `sheet1.xml` would otherwise look
    distinct to the copy and be the same part to SheetJS (a test builds it, and SheetJS reads
    `P1` into both sheets); a relationship with no `Target` (SheetJS throws in `parse_rels`), an
    `Id` of `__proto__`, and a sheet id that is a property of every object are refused likewise.
    **What this does not prove**: that the copy equals SheetJS for every file. A difference in a
    rule I did not read (the zip's entry-name decoding for a non-ASCII name; `resolve_path`;
    `get_sheet_type`) could still let two sheets look distinct to the copy and read the same
    part. The check only ever fails closed on what it can see, so such a file is a smaller risk
    than round 1's, not a closed one. A SheetJS upgrade re-reads `workbook-parts.ts`' header.
  - **A behaviour change the owner accepted (12), with its edges.** The command refuses a
    sheet with no part of its own (a `<sheet>` whose relationship points at a part not in the zip
    was skipped by SheetJS before) and whatever `workbookEntries` refuses. A file that is not a
    zip, or a zip with no `[Content_Types].xml` or `xl/workbook.xml` (an `.ods`), is now
    `WORKBOOK_NOT_XLSX` with that code's message ("Only an .xlsx workbook or a comma-separated
    CSV can be imported here...") in the command, where it was `BAD_REQUEST` with SheetJS's reason
    (`ods, not xlsx`); two `xlsx.test.ts` tests that asserted those messages now assert the code.
    The command's CSV wording is the route's, which is not quite right for a command that
    reads no CSV; I did not reword the contract's message.
  - **F3 (med), pushed back on, then fixed another way.** The direction, `forEach` in
    `placesOf`, did not fix it. One stub-tail sheet's `!data` (length 1,048,576, 2 defined
    rows), 10 walks each, `build/walk.mts`: `entries()` **42.59 ms** a walk, `forEach`
    **37.83 ms**, `Object.keys` **0.01 ms**, `for-in` 0.00 ms. `stubd.sh` with `forEach`:
    40 sheets 1,415 ms (gate: 1,986), **400 sheets 15,281 ms** (gate: 19,588), route 15,501 ms.
    `placesOf` and `widthOf` now walk `Object.keys` (`definedIndices`), integer keys in order.
    `stubd.sh` at `99cc3a57`: **40 sheets 36 ms, 400 sheets 184 ms, route 275 ms**
    (`WORKBOOK_TOO_LARGE`, `sheets`); gate 1's `stubwide` 78 ms (2.57 s at `2a53dc5e`), `stub1`
    21 ms, `dense1` 505 ms, +59.2 MB (unchanged), `far1x10` and `stub1x40` refused in 15 ms. Pinned
    by a test: a `Proxy` over a sparse array of 1,048,576 rows, and over a row of 16,384 cells,
    counts the indices asked about (`has` and `get`) and the test needs fewer than 10;
    `entries()` and `forEach` ask for every one. With the walk mutated to `Array.from(array.keys())`
    that test fails.
  - **N1 (low), moot, shown.** Gate 2's `tab_relationship` shape: SheetJS ignores both tagged
    relationships, reads by position (`sheet1.xml` once, `sheet2.xml` absent: 1 read), and the
    workbook is refused all the same. The copy no longer accepts the tab (`sheetPartsOf` answers
    `undefined` for it: the second sheet has no part), and would refuse it for the missing part
    even if it did. A test pins both (`readsOnePartTwice` 1, refused).
  - **N2 (low), fixed.** "the slots run across distinct parts too" reads 105 sheets of `A1` and
    `A19000` whole and refuses 106 as `slots`.
  - **The cap, again (answer 10), at `99cc3a57`**, round 1's files, two runs each, growth of the
    peak over the baseline: 122 rows with a cell at `XFD` **+39.5, +40.2 MB**; 105 sheets
    of `A1` and `A19000` **+109.6, +112.5 MB**; the worst built, one 1,400 by 100 sheet beside
    97 gap sheets **+130.0, +132.8 MB** (peak 221.6 MB); `dense1` +61.7 MB. They run +1 to +3 MB
    over round 1's because `bookSheets` inflates the entries once before the parse. Under the
    512 MB container. They are the worst I built for a workbook whose sheets are each a part of
    its own, not a proof of a worst (the first round said the same, and was wrong about what
    got through).
  - **Tests**: `xlsx.test.ts` 50 of 50, `workbook-describe.test.ts` and `workbook-import.test.ts`
    141 of 141 with it (`npx vitest run` on the three). New: the seven spellings (each read as
    two sheets over one part by SheetJS itself, then refused), the decoy part
    `sheet&#49;.xml`, the two files `workbookEntries` refuses, N1, a sheet with no part, sheets
    read by position from parts of their own (admitted), the `bookSheets` contract, the walk,
    105 beside 106; and a command test for a file `workbookEntries` refuses. Mutations, restored
    from `48ec0f7d`: with the sheet-list check cut to the distinct-parts test alone and the walk
    over the whole length, 7 of 50 fail in `xlsx.test.ts` (the numeric and hex entities, the
    `_x0031_` code, the decoy part, N1, the missing part, and the walk). The other four
    spellings (`>` in a name, empty `r:id`, absent id, tab decoy) still pass under that
    mutation, because the ported tag reading now sees them as the shared part they are; the
    count and existence check is what the other seven exercise.
  - **Fold-in, not done**: the command's CSV wording above, which is a contract message and the
    owner's; nothing else found.
  - **Not proven here**: CI and the Windows leg (the draft's); a SheetJS upgrade.
- 2026-11-08 — Landing (lander, Sonnet 5.5, owner answers 13 and 14 recorded under the Decision
  heading). Gate 3 (FAIL at `3b8e95d4`) left gate 2's F2 open at high; the owner chose to land and
  file the rest as lg-104. The three gates' full reports are on the pull request thread, #758.
- 2026-11-08 — Fixed at landing by owner choice: gate 3, F2 (the shipped text only, no code and no
  assertion changed) — "The shipped text promises the unsafe direction". Both comments reworded and
  answer 10's basis corrected in place. Proof, run after the commit that carries this entry:
  `git diff 3b8e95d4 HEAD -- tools/ledger/api/src/xlsx.ts | grep -c '^-.*never a way in'` → 1;
  `git diff 3b8e95d4 HEAD -- tools/ledger/api/src/workbook-bounds.ts | grep -c '^-.*what gets here is a workbook'` → 1.
