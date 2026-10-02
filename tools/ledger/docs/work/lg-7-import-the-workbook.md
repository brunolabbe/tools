---
id: lg-7
tool: ledger
title: Import the workbook's history since 2022, verified before it is written
kind: work-package
status: ready
milestone: P3
depends_on: [lg-5, lg-6]
difficulty: hard
---

# lg-7 — Import the workbook's history since 2022, verified before it is written

## Why

The owner chose to import all of the history. The workbook is internally
consistent, but it carries a known set of typing errors and two historical
settlement formulas ([00-ANALYSIS.md §8](../00-ANALYSIS.md)). The import has to
prove it reproduces the workbook's own figures before it writes a row.

## Build

1. **A command, not a route.** `npm run import:ledger -- <workbook.xlsx>
[--corrections <file.json>]`, in `api`, writing to the configured database.
   It is a one-off, and it has no reason to exist on the network.
2. **Reading `.xlsx`:**
   - use cached cell values, never evaluated formulas;
   - prefer `exceljs`;
   - **do not use the `xlsx` package from npm.** Its registry copy is stale and
     carries known advisories, and SheetJS publishes fixes only off-registry.
   - `books` receives plain cell grids and stays pure.
3. **Year sheets** (`2022` … `2026`), per the layout in §8 of the analysis:
   - the year comes from the sheet name, and a date whose year disagrees is
     repaired and reported;
   - rows with no amount are skipped;
   - an empty person means joint;
   - notes land on the row;
   - `Solde reporté` rows are verified against the previous year's closing
     balance and are not imported as movements.
4. **Rows go in as statement rows** with their classification already attached,
   marked as imported rather than pasted. Where a pasted row covers the same
   day, the two must agree.
   - **Decided in lg-2, 2026-10-02 (a note of what the stored rows are, not new
     work).** A statement row has **no unique identity**: date, description,
     amount and balance can repeat (a transfer, its reversal and the transfer
     again), so the table has no unique index over them and a paste is matched
     to stored rows **by position**, never by those four fields alone. "The two
     must agree" is therefore a comparison of the rows in the same place
     (`api/src/statements.ts`), and where one reading of the data is ambiguous
     the import refuses rather than guessing, as a paste does.
   - **Decided in lg-2, 2026-10-02.** A row's `seq` is a **position**, not a
     count: it may be negative, and a new row takes the highest stored position
     plus one. Older rows, which is what the workbook's 2022 onward are once
     pastes are stored, can therefore be numbered below the oldest stored row
     with no table rebuild. lg-2 still **refuses an older paste**
     (`STATEMENT_BEFORE_HISTORY`); only this import numbers rows below the
     oldest, and doing so is this ticket's to build.
5. **Period sheets** become closed periods, each with its lines and its recorded
   settlement **as it actually happened**. Their formula version is `v1` or
   `v2`, told apart by the formula text in the `Montant à déposer` cell. The open
   period comes in open.
6. **The `Accueil` salaries** become the first salary records, and the first
   ratio.
7. **Corrections file:** owner decisions such as "this row belongs in the other
   bucket". It is JSON, it lives **outside the repository**, and each correction
   lands with a note on its row.
8. **The report**, printed before anything is written:
   - counts of rows imported, repaired, skipped and corrected;
   - each person's own money in the mortgage bucket, and the cumulative
     catch-up, each beside the figure the
     workbook shows;
   - a nonzero exit when a verification fails.
     `--write` performs the import; without it, the command is a dry run.

**Fixture:** a synthetic workbook built by the test, never a copy of the real
one. It needs a typo'd year, a placeholder row, a joint row, a carry-over, a v1
period and a v2 period.

## Done when

1. The dry run on the synthetic workbook reports every repair and writes
   nothing. A test asserts the database is unchanged.
2. A carry-over that disagrees with the previous year fails the import, with a
   nonzero exit.
3. `--write` reproduces the synthetic workbook's mortgage gap (`own_A − own_B`)
   and buffer balance
   exactly.
4. A correction moves its row and leaves a note on it.
5. Imported period settlements keep their historical amounts and their formula
   version.
6. Gates green.

## Log
