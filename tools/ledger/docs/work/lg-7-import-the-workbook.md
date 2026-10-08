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

## Decisions

Taken by the owner on 2026-10-07 and 2026-10-08, after the first build and
its gate 1. Each was asked with the options listed; the first three were the
builder's open decisions and the last two gate 1's (F1, F4).

1. **A nonzero opening balance in the first year.** The books count nothing
   before their first row, so a workbook whose first year carries money in
   cannot reproduce its own balances. Options: refuse, as built; import the
   carry-in as opening rows, split by the owner; report it as an accepted
   difference. **Chosen: refuse, as built.**
2. **The ratio of a historical period.** The workbook stores only today's
   salaries, on `Accueil`. Options: Accueil's ratio for every period, as built;
   a ratio per period in the corrections file, Accueil's when none is given;
   derive it back from each sheet's own figures. **Chosen: a ratio per period
   in the corrections file**, over the builder's recommendation. A closed
   period given one records it, and its settlement and the catch-up use it; a
   malformed ratio, or one that names no closed period, is refused naming its
   entry.
3. **Books that already hold periods, period lines, recurring items, salaries
   or ratios.** Options: refuse, as built; allow them and reconcile the two
   histories. **Chosen: refuse, as built.**
4. **What a dry run may touch** (gate 1, F1). Opening the books file, even to
   read it, let SQLite recover an unclean stop's write-ahead log into it and
   create a shared-memory file beside it. Options: never open the original, and
   work on a byte copy of the file and its log in a private directory; or keep
   the code and soften the sentences that say a dry run writes nothing.
   **Chosen: never open the original.**
5. **A correction naming a row a paste already holds** (gate 1, F4). Its note
   cannot be written, because a stored row is never written again. Options:
   refuse that correction, naming the cell, and file the row in the app; or
   store the note elsewhere, which needs a column or a table and so a second
   migration. **Chosen: refuse it.**
6. **A ratio naming the open period** (2026-10-08). The open period always
   takes Accueil's ratio, which is today's. Options: refuse it, as built; allow
   overriding it. **Chosen: refuse it, as built.**
7. **A row dated out of order** (2026-10-08, gate 2, G2-4). Round 1's order
   check refused any row listed above a row dated after it, though the
   corrections file cannot date a row. Options: refuse only an inversion at a
   row whose year the import repaired, naming that row's own cell, and print
   every other as a report line, the row imported as typed; or keep refusing
   all. **Chosen: refuse only at a year-repaired row.**

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
7. A closed period given its own ratio in the corrections file records it,
   and its settlement and the catch-up use it; a malformed ratio, or one that
   names no closed period, is refused naming its entry (Decision 2).

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

- 2026-10-08 — Round 1, on `77a5d45` (gate 1: CONCERNS, no high), by the
  builder (Opus 5.5), with the owner's five answers now in **Decisions**.
  Migrations stay at one (number 5). Each new test was run against round 0's
  `api/src` and `books/src` (`git checkout 77a5d452 -- …`, books rebuilt) and
  failed there: 13 of 13, with the 19 earlier ones passing. Restored, and
  `grep -c applyRatios books/dist/workbook.js` printed 2. F7's test was run the
  same way against round 0's `workbook-import.ts`: it failed, printing
  `… leaves 2604.99 $ where it leaves 2604.99 $: 0.00 $ is unexplained.`
  - **Decision 2, a ratio per period, built.** The corrections file takes
    `"ratios": [{ "sheet": …, "shares": { name: percent, … } }]`, read by
    `readCorrections` to the part per million.
    - Each closed period records its own ratio, or Accueil's when it has none.
    - A change of ratio takes effect the day after the close before it, and
      Accueil's ratio takes effect again after the last close. The ratio in
      effect on any day is then the one its period was settled at.
    - Accueil's ratio records cite their salaries; a corrections ratio cites
      none.
    - Tests: "a period given its own ratio records it, and its settlement and
      the catch-up use it" (50/50 on the v2 period: 230.00 / 138.00 in place of
      130.00 / 78.00, and three ratio records). "a ratio that is malformed, or
      names no closed period, is refused naming its entry" (exit 2 and exit 1).
      `books/test/workbook.test.ts`: the malformed-ratio and ratio-placement
      cases.
    - The open period is refused a ratio of its own: it takes Accueil's, which
      is today's.
  - **F1 (Decision 4), fixed.** A dry run copies the file and its `-wal`, byte
    for byte, into a `mkdtemp` directory, works on the copy and deletes it. It
    never opens the original.
    - Test: "a dry run never opens the books: a crash image's file and log stay
      as they were, and nothing appears beside them". It hashes the file and
      the log, and lists the directory. The output shows the rows only the log
      held.
    - On round 0 it failed with `ENOENT … crash/ledger.db-wal`: the log had
      been recovered into the file and deleted, which is the gate's
      reproduction.
  - **F2, fixed.** Every consistent placement now counts, including one that
    runs past the stored rows. Two or more are refused as ambiguous, and
    "runs past" is refused only when it is the sole reading. Test: "a workbook
    that fits two ways is refused even when one way runs past the stored rows"
    (the gate's two-stored-row case).
  - **F3, fixed.** Both sides compare the rows up to the workbook's newest
    position, and `asOf` is the latest date among them. Test: "a stored newest
    row dated a day after the workbook's copy of it is reported, not refused".
    The gate's other case, a typed date that runs ahead of the rows after it,
    is now also refused by F9's order check.
  - **F4 (Decision 5), fixed.** A correction that names a row a paste holds is
    refused, naming the cell. Test: "a correction naming a row a paste already
    holds is refused, naming the row".
  - **F5, fixed, both ways.**
    - Migrations now run inside the import's transaction, as savepoints
      (`applyMigrations` in `db/schema.ts`; `migrate` is now `configure` plus
      that).
    - `--write` rehearses on the private copy first and opens the real file
      only when every verification held there.
    - Tests: "a refused --write leaves books at an older schema version as they
      were, and so does a dry run" (a version-4 file, its hash and the
      directory). "a refused --write into books that do not exist leaves no
      file".
  - **F6, fixed, not as the gate worded it.** An amount cell holding text, or
    a formula with no saved value, is now a problem at its own cell. A cell
    that is empty is still a placeholder.
    - The gate's suggestion was to refuse a skipped row whose balance cell
      holds a figure. That would refuse every placeholder in a workbook whose
      `F` is a formula (`=F_prev+G` carries a figure on an empty-amount row).
      This is reasoned, not measured: the real workbook was not available.
    - Test: "an amount that is text, a formula with no saved value, or finer
      than a cent is refused at its cell".
  - **F7, three of four fixed.**
    - A stored row the workbook lacks is now named as "a row is in one and not
      the other", not "0.00 $ is unexplained" (test: "a stored row the workbook
      lacks …").
    - An amount or balance finer than a cent is refused at its own cell (same
      test as F6).
    - An unreadable `.xlsx` carries exceljs's reason (`api/test/xlsx.test.ts`,
      "a file that is not a workbook is refused, with exceljs's reason").
    - **Left recorded:** a `--write` into a read-only directory still fails
      with SQLite's own message. The finding states no remedy. A dry run no
      longer touches that directory.
  - **F8, fixed.**
    - A dry run on a version-4 file is in F5's test.
    - Migration 5 on a populated version-4 database is
      `api/test/schema.test.ts` › "migration 5 marks every stored batch a
      paste, notes no row, and refuses an unknown source".
    - `api/test/xlsx.test.ts` covers rich text, shared formulas, booleans,
      errors, hyperlinks, merged cells and an unreadable file.
    - F1's test hashes the `-wal`.
  - **F9, fixed.** Newest first, a row dated before the row below it is now a
    problem at its cell, saying when a year was repaired there. Test: "a
    repaired year the row order contradicts is refused at its cell".
    - This also refuses an out-of-order row whose year was not repaired. The
      owner corrects the date in the workbook, because the corrections file
      changes no dates.
  - **F10, left recorded.** The finding states no bound to set. The file is
    the owner's own, read on their machine, so there is no live call site.
  - **Measured:**
    - `npx vitest run --project ledger`: 592 of 592, 37 files.
    - The built command with `--corrections` giving the v2 period 50/50,
      `--write`: exit 0. It printed three ratio lines (60/40 from 2022-01-05,
      50/50 from 2022-09-01, 60/40 from 2023-04-01) and "sam deposits 230.00 $
      (net 138.00 $), v3".
  - **Corrects round 0's entry:** "A dry run copies the database into memory
    and works on the copy, so it never writes to the file" was false in three
    conditions (F1). The copy is now made from the file's bytes, never by
    opening the file.

- 2026-10-08 — Round 2, on `46c6911` (gate 2: CONCERNS, no high), the landing
  round, by the builder (Opus 5.5). Decisions 6 and 7 are recorded above.
  Each new test was made to fail by a mutation (books rebuilt, `dist`
  grepped), then restored: 5 failed and 33 passed across
  `books/test/workbook.test.ts`, `api/test/xlsx.test.ts` and
  `api/test/workbook-import.test.ts`.
  - **G2-1, fixed.** The private copy, and its log, are set to mode 0600
    after copying, so a read-only books file dry-runs again. Test: "a
    read-only books file dry-runs, refuses --write, and keeps its mode" (dry
    run exit 0, `--write` nonzero, the file's mode and hash unchanged).
    Mutation: the copy's `chmodSync` removed.
  - **G2-2, fixed.** `api/src/xlsx.ts` reads a formula's saved result from
    `cell.model.result`, which keeps a saved 0 or FALSE that `cell.value`
    drops. The refusal now says "no readable value". Tests: "a formula saved as
    0 or FALSE keeps its value" (`xlsx.test.ts`) and "a formula saved as 0 is a
    placeholder's amount, or a carry-over of nothing, not an unreadable cell".
    Mutation: `cell.value` read in its place.
  - **G2-4 (Decision 7), built.** Only an inversion at a year-repaired row is
    refused, at that row's own cell. Any other is a `dated out of order:` report
    line, and the row is imported as typed. Tests: "a date typed a few days
    off, with no year repaired, is reported and imported as typed" (books) and
    "a date a few days off, with no year repaired, is reported and imported as
    typed" (the command, `--write`). The repaired case's test now expects the
    repaired row's cell, `2024!B3`. Mutation: every inversion refused.
  - **G2-3, left recorded.** The two-file copy is not a consistent snapshot
    while the API checkpoints. A torn copy can only mislead a dry run, because
    `--write` verifies again on the real file inside its transaction. The
    window is microseconds at a household's write rate.
  - **G2-5, left recorded.** An override equal to Accueil's ratio is stored as
    the corrections file's and cites no salary. The figures are right; only the
    link to the salaries is lost.
  - **Gate 1's F7 (a read-only directory) and F10 (inflation) stay recorded**,
    as round 1 said.
