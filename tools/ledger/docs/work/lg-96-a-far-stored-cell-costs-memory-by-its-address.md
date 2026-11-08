---
id: lg-96
tool: ledger
title: A stored cell far down or across a sheet costs memory by its address
kind: fix
status: ready
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
    F1 and F2 (Log, round 1: +129 MB the worst built).

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
   command.

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
   `WORKBOOK_NOT_XLSX` by the same three. **Superseded 2026-11-08 (answer 8):** ~~each
   refusal is `WORKBOOK_TOO_LARGE` ... never `WORKBOOK_NOT_XLSX`~~ for the shared part
   only. A test in `api/test/`
   asserts the code and the bound for each axis and for each caller.
4. The control (4 000 rows at column `B`) and the full `api/test/xlsx.test.ts` suite
   hold: no value a reader sees changes for a sheet inside the bound.

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
    the 90 MB was a shared part, now refused.**

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
  - **A cost the brief did not name: the resolution is a copy of SheetJS's.** What is
    refused has to be what SheetJS reads twice, and it picks the part by rules of its own,
    not the format's (`workbook-parts.ts`' header lists them). The test reads each spelling
    it refuses through SheetJS itself (an absolute target, another case, an `xl/` prefix:
    each parsed as two sheets over one part). Where the copy and SheetJS differ, a shared
    part gets through and nothing is worse than before the round (the cells and inflate
    bounds). A SheetJS upgrade should re-read it. **Left open**: a workbook that
    `workbookEntries` refuses is not checked for a shared part, and the command, which
    never ran the inflate bound, is then read as it was.
  - **F3 (med), fixed.** `widthOf` visits the cells a row defines (`forEach` skips the holes
    of a sparse row), and `placesOf` hands its widths to `rowsOf`, so a row is walked once.
    Gate 1's `stubwide` (5 000 rows whose one cell is a stub at `XFD`, 30 866 bytes): 6.4 s
    at `e2e6a6cb`, **2.57 s** at `2a53dc5e` (+10.0 MB), the rest SheetJS's own parse.
    Not pinned by a test: a clock measures the machine, and a count of the cells a
    `forEach` visits cannot be told from a count through a `Proxy`.
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
