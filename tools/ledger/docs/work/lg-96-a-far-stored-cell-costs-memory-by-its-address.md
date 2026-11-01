---
id: lg-96
tool: ledger
title: A stored cell far down or across a sheet costs memory by its address
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-96 — A stored cell far down or across a sheet costs memory by its address

## Why

`readSheets` (`tools/ledger/api/src/xlsx.ts`) builds every sheet's grid before
anything bounds it. `rowsOf` makes one row for every row up to the last stored
one, and gives each row as many places as its widest stored column. So a sheet
holding one cell at `A1048576` pays for 1 048 576 rows, and a sheet whose rows
each hold a cell in column `XFD` pays for its row count times 16 384 places.
Neither cost is bounded where it is built. The rows and cells bounds in
`workbook-describe.ts` count only after the grid exists, and the 40-sheet bound
counts only after every sheet has been read. None of `workbook-zip.ts`'s bounds
(bytes, inflated size, entries) sees the cost, because the cost follows the
address, not the file's size.

Found by lg-88's gate (PR #733, its finding F5 on the row axis, recorded there
as an open decision and not fixed in lg-88). It is not lg-88's to fix.
[lg-88](./lg-88-a-merged-range-costs-memory-by-its-area.md) is the sibling: the
same function, the same missing bound, a cost by area instead of by address. lg-88's
decision (option 3) removes merged places but keeps `last = data.length`, so the
row axis stays on `main` after lg-88 lands. The column axis is not in lg-88's
brief at all.

`readSheets` has two callers. The describe route reads it before its bounds.
The owner's `import` command (`api/src/import-command.ts`) reads it with no bound
at all, so a fix in describe alone would leave the command as it is.

## Reproduction

Measured on `83eac952`, the base this ticket was filed on (`origin/main` on
2026-11-01). Each case runs in its own process, after a `gc`, and the figure is
the growth of the process's peak resident memory across the call
(`process.resourceUsage().maxRSS` before and after). The machine is WSL2 on
Linux, so a reading varies by run and by machine: the gate's readings for the
same sha are beside each case.

Fixtures are synthetic. Build each workbook with the test helper
`tools/ledger/api/test/helpers/xlsx-file.ts` (`SheetWriter`, `workbookOf`), and
read it with `readSheets` from `tools/ledger/api/src/xlsx.ts`. The repo holds no
script for this: write one in a scratch directory as an `.mts` file that imports
the worktree's modules by absolute path, and run it from the worktree root as
`node --expose-gc --import tsx <script>`. The script does three things per case:
build the workbook, take the memory reading around the call, print one line.

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

| Case                                      | This run, `83eac952`                                                       | Gate, `83eac952` (PR #733)               |
| ----------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| 1. one far cell, `readSheets`             | +54.3, +55.3, +56.2 MB; 0.4–0.9 s                                          | +49.3 MB; 0.2 s                          |
| 2. one far sheet, through the route       | +35.8 MB; process peak 218.2 MB; `WORKBOOK_TOO_LARGE`; 0.3 s               | not run                                  |
| 3. ten far sheets, through the route      | +530.7 MB; process peak 696.3 MB; `WORKBOOK_TOO_LARGE`; 1.5 s; 24 904 B    | +408 MB; process peak 592.5 MB; 24 904 B |
| 4. 1 000 / 2 000 / 4 000 rows at `XFD`    | +147.8 / +362.9 / +691.1 MB; 1.5 / 3.3 / 7.9 s; 71 / 128 / 242 KB          | not run                                  |
| 4. control, 4 000 rows at `B`             | +7.3 MB; 61 ms; 234 KB                                                     | not run                                  |
| 40 far sheets (the most the bound admits) | **not measured**: linear extrapolation from cases 1 and 3, +1.6 to +2.1 GB | not measured                             |
| 20 000 rows at `XFD` (the row bound)      | **not measured**: linear extrapolation from case 4, about +3.4 GB          | not measured                             |

Case 3's two readings differ by 120 MB on one sha. The code is the same; the
machine is not. The gate's ten-sheet reading has no output file behind it, so
the figure is its report alone, and this run is the second reading. Neither
figure is the bound: both are one run, and the ticket's remedy has to be sized
against the range, not the mean.

Why case 4 is not caught: at 4 000 rows, and at the 20 000-row bound, the
describe bounds count rows (20 000 at most) and non-null cells (200 000 at most).
Case 4 has 4 001 non-null cells and 4 000 rows, so both bounds admit it, and it
is not refused. This is counted from the source, not run through the route.
Case 4's file is 242 KB, far below the 4 MiB bound.

## Decision — open

The question: which bound stops a stored address from costing memory in
`readSheets`, and where it sits.

Options, recommended first:

**1. Bound a sheet's stored extent in `readSheets`, before `rowsOf` builds the
grid (recommended).** `readSheets` already has both numbers: the sheet's
`!data` length (the rows up to the last stored one) and the widest stored column,
found in one pass over `!data`. Refuse the sheet as `WORKBOOK_TOO_LARGE` when its
rows pass `MAX_WORKBOOK_ROWS` (the gate's example), and when rows times width pass
a new slot cap. This covers both measured axes, and both callers. Costs:

- A slot cap to choose. Case 4 prices a slot at about 11 MB per million, from one
  run. The cap has to sit above the largest real sheet, whose extent only the owner
  can read off a real workbook; the repo holds no real data, and the ticket does
  not guess one.
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
- Small: one function and a test per axis. It is the mechanism lg-88's option 2
  would use.

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
from 40. This cuts the row axis's per-row arrays and the sheet multiplier. It does
not cut the column axis, which is still built in every row, and it does not cut one
sheet's cost. The saving from a shared row is unmeasured. Lowering the sheet count
is a product limit, so it is the owner's.

**4. Accept the ceiling and document it.** No code change. By extrapolation, 40 far
sheets reach 1.6 to 2.1 GB and a 20 000-row far-column sheet about 3.4 GB, against a
512 MB container (`compose.ledger.prod.yaml`). The process is killed rather than
refused. Not recommended.

Options 1 and 2 close both axes. Option 1 changes no reader, and its costs are a
number and a name the owner picks. Option 2 changes the `Sheet` shape. Options 3 and 4
leave the column axis open.

## Build

Written from the recommended option, option 1. It is not to be dispatched until the
owner answers, and the answer may change it.

1. In `readSheets` (`api/src/xlsx.ts`), before `rowsOf`: refuse a sheet whose `!data`
   length passes `MAX_WORKBOOK_ROWS`, and one whose rows times its widest stored
   column pass the slot cap, each as `WORKBOOK_TOO_LARGE` with the `details.bound`
   the answer names. Do not build the grid to find the width.
2. In `describeWorkbook`, let the refusal through its `readSheets` `try`, so the code
   stays `WORKBOOK_TOO_LARGE`.
3. Tests in `api/test/xlsx.test.ts` and `api/test/workbook-describe.test.ts`: one per
   axis (case 1 and case 4), each asserting the code and `details.bound`, plus case 4's
   control at column `B` reading unchanged.
4. Re-run the Reproduction's four cases on the branch with the same script, and put
   each figure in the Log beside the base figures above.
5. If the owner keeps the import command unbounded, test that it is unbounded, so the
   choice is recorded in a test and not only here.

## Done when

1. The owner's answer is recorded under the Decision heading with its options, and
   `status` moves to `ready` in that commit.
2. Each measured case in the Reproduction, run on the branch, stays under the bound
   the answer sets: case 1, case 3 through the route, and case 4 at 4 000 rows. The
   readings are in the Log beside the base figures.
3. Each refusal the answer adds is `WORKBOOK_TOO_LARGE` with its `details.bound`, and
   no refusal reaches the route as `WORKBOOK_NOT_XLSX`. A test in `api/test/` asserts
   the code for each axis.
4. The control (4 000 rows at column `B`) and the full `api/test/xlsx.test.ts` suite
   hold: no value a reader sees changes for a sheet inside the bound.

## Log

- 2026-11-01: filed from lg-88's gate (PR #733, PASS, its finding F5 raised as an open
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
  builder, measured as case 4 above. `rowsOf` gives every row the width of the widest
  stored column, so the row bound does not see it. It is measured at 4 000 rows and
  not beyond, and the 20 000-row figure is an extrapolation.
- 2026-11-01: the brief's "roughly 2 GB" for 40 sheets was an extrapolation from the
  gate's 408 MB, and was not measured. The ticket states it as an extrapolation, a
  range of 1.6 to 2.1 GB from both readings.
- 2026-11-01: read the `describeWorkbook` order on `83eac952`. `readSheets` runs
  before the sheet-count, rows and cells bounds, and its `try` turns any error into
  `WORKBOOK_NOT_XLSX`. That is why Build step 2 and the first option's cost name the
  rethrow.
