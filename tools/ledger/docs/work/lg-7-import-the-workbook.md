---
id: lg-7
tool: ledger
title: Import the workbook's history since 2022, verified before it is written
kind: work-package
status: ready
milestone: P3
depends_on: [lg-5, lg-6, lg-13]
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
   - **A constraint on this ticket, following from lg-2's decision of
     2026-10-02, which the import must meet.** A statement row has **no unique identity**: date, description,
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
     workbook shows. lg-13 changed the catch-up: a historical deposit that
     `matchDeposits` matches to a period is weighed at that period's recorded
     ratio, so import each period with the ratio its settlement used and
     compute the catch-up through `openPeriod` in `api/src/periods.ts` (or
     `cumulativeSettlement` with `settles` filled from `matchDeposits`), never
     by date alone (lg-13's Log, "For lg-7's builder");
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

- 2026-10-07 — Built, on `origin/main` at `9dcf0f6`, by the builder (Opus 5.5).
  - **What exists.** `books/src/workbook.ts` reads plain cell grids, pure:
    year sheets, period sheets, `Accueil`, the corrections file
    (`readCorrections`), and the workbook's own figures (`workbookFigures`). It
    collects every problem rather than throwing on the first, naming each cell
    (`2023!G8`). `api/src/xlsx.ts` is the only file that opens a spreadsheet
    (`exceljs`, cached values, formula text kept beside them).
    `api/src/workbook-import.ts` places the rows against the stored ones, writes
    everything in one `BEGIN IMMEDIATE` transaction, reads the books back
    through `mortgageAsOf`, `bufferAsOf` and `openPeriod`, and commits only with
    `--write` and no problem left. `api/src/import-command.ts` is the command,
    `api/src/import-ledger.ts` its entry, `npm run import:ledger` in `api` and
    at the root. A dry run copies the database into memory and works on the
    copy, so it never writes to the file, and it does not create one that does
    not exist.
  - **One migration, number 5.** `statement_imports.source` (`'paste'` or
    `'workbook'`, default `'paste'`) and `statement_rows.note`. lg-15 and lg-17
    append after it, and `api/test/schema.test.ts` now expects `user_version` 5.
    The contract's `PERIOD_LINE_SOURCES` gains `workbook`.
  - **New dependency.** `exceljs@^4.4.0` in `@ledger/api`'s `dependencies`, 187
    lockfile entries. It pins `uuid@^8`, which carries GHSA-w5hq-g745-h8pq
    (moderate), and `dependency-review` fails at moderate. A root `overrides`
    scoped to exceljs takes `uuid@^11.1.1`, which keeps v4 and the CommonJS
    build. Command: `npm audit --package-lock-only --json` lists neither
    `exceljs` nor `uuid` after it, and listed both before it.
    `node scripts/check-lockfile-sync.mjs`: exit 0.
  - **Done when**, each by its test in `api/test/workbook-import.test.ts`.
    Each was made to fail by a mutation first, and restored (`books` rebuilt,
    `dist` grepped):
    1. "a dry run reports every repair and skip, and writes nothing" (the
       file's sha256 and every table's rows, before and after) and "a dry run
       into books that do not exist yet does not create them". Mutation: dry
       run opens the file and commits. 2 failed.
    2. "a carry-over that disagrees with the year before fails the import, with
       a nonzero exit". Mutation: the carry comparison disabled in
       `books/dist`. 1 failed.
    3. "--write reproduces the workbook's mortgage gap and buffer balance
       exactly": alex 949.99, sam 250.00, gap 699.99, buffer 405.00, worked by
       hand in `helpers/workbook.ts`. Mutation: joint rows filed to alex. 1
       failed. The import's own check refused it first.
    4. "a correction moves its row and leaves a note on it". Mutation: the
       correction's classification not appended. 1 failed.
    5. "imported period settlements keep their historical amounts and formula
       version" (v1 380.00 by alex, v2 100.00 by sam, both `matched`).
       Mutation: `/` read as v2. 2 failed, with
       `books/test/workbook.test.ts`'s formula case.
  - **Measured**: `npx vitest run --project ledger`: 575 passed of 575, 36
    files. The real command, built, run on the synthetic workbook with
    `--write`, exit 0. It printed the five figures equal and "books
    (cumulative, the catch-up folded in): sam deposits 130.00 $ (net 78.00 $),
    v3", beside the open sheet's own "sam deposits 18.00 $". v1 asked alex
    50.00 too much and v2 asked sam 66.67 too little, which is the analysis's
    §5 in miniature.
  - **What the brief had wrong, or left open, and what was built.**
    - _Who the import is recorded under._ Every table records a person
      (`imported_by`, `classified_by`, `closed_by`, `entered_by`), and a
      command has no Access identity. The command takes `--as <person>`,
      required and checked against the household.
    - _The catch-up "beside the figure the workbook shows"._ The workbook shows
      no catch-up. It settled period by period, and §5's catch-up was the
      analysis's own figure. The report sets the books' cumulative figure for
      the open period, through `openPeriod`, beside the open sheet's own
      `Montant à déposer`, and does not verify one against the other.
    - _Which workbook figures are verified._ §8 names no cell for them, so they
      are computed from the year sheets the workbook's way: each bucket's rows
      plus the first year's carry-in, corrections applied. They are set
      against the books read back from the database through the workbook's
      newest row. This catches stored rows filed otherwise, rows in the inbox,
      a carry-in the books cannot count, and the writes themselves.
    - _"Where a pasted row covers the same day, the two must agree."_ The
      workbook's description is its own vocabulary, not the bank's, so
      agreement is amount and running balance, by position. A date that
      differs is reported and not refused, because §8 found one a day off. The
      overlapping rows are checked and never imported again. A workbook that
      fits two ways is refused, as a paste is. So is one that runs past the
      newest stored row, because those rows are a paste's. Into empty books,
      everything is imported.
    - _A sheet's lines have no date._ A closed period's lines are dated on its
      last day, so each falls in its own period even across the 53-day
      overlap. The open period's lines are dated on the later of its sheet's
      start and the day after the last close.
    - _The historical settlement's direct figure._ `periods.net_cents` is
      required, and v1 and v2 had no separate figure for paying directly, so it
      records the amount asked.
    - _The classification's source._ Imported rows are classified `manual`, by
      the `--as` person: the workbook's filing was a person's own answer.
      `classifications.source` has a `CHECK` that a new value would need a
      table rebuild to change. A correction is a second `manual` record over
      the workbook's, so what the workbook said stays.
    - _Where §8 is silent on layout,_ this ticket's reading is in
      `books/src/workbook.ts`'s header. In the `Montant à déposer` row, the
      column with a positive figure is who deposits, and a negative figure in
      one column is what the other owes. A `/` in the formula is v1, a `*`
      without one is v2, and anything else is refused. A sheet with no end
      date is the open one. In `Accueil`, a person's name with a number to its
      right is a salary. Accueil's salaries are dated in the history's first
      year, and their ratio takes effect on its first day, because they are
      the only salaries the workbook has. Every imported period records that
      ratio. A layout the reader does not recognise is a refusal naming the
      cell, so the first dry run on the real file is where any of this is
      found wrong, before anything is written.
    - _Books that already hold periods, period lines, recurring items,
      salaries or ratios_ are refused. The workbook's are those tables' first
      record, and reconciling the two would be a guess.
    - _The first year's carry-in._ The books count nothing before their first
      row (lg-5's Log). A nonzero carry-in into 2022 makes the balance figures
      differ, and the import refuses, saying why. The synthetic workbook
      carries zero.
  - **Fold-in:** the comment on `STATEMENT_BEFORE_HISTORY` in
    `contract/src/errors.ts` said a later ticket "may" number rows below the
    oldest. This one does, and the comment now says so. Nothing else
    specified was made free.
  - **Not covered.** The owner's real workbook was not read. Every layout
    assumption above is unmeasured against it. No e2e spec, and no run inside
    the image.
