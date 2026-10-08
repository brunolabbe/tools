---
id: lg-7
tool: ledger
title: Import the workbook's history since 2022, verified before it is written
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-07 · `9dcf0f6f..77a5d4529acae6161b8a48e8f4e7b9288dc0c570` (branch `lg-7-workbook-import`, PR #396 draft) · Sonnet 5.5, depth full

No finding is a `high`. Four are `med` (F1 to F4); F1 is tied to Done when 1 in its letter and F4 to a clause of Done when 4, so both are fixed in a round. Done when 6 is `unproven (gate)`, and the three owner decisions are carried below as CONCERNS without a regrade.

**How this was run.** Detached at the head, farm, build. `exceljs` is not in the shared checkout, so I ran `npm install --ignore-scripts --prefix <scratch>/deps exceljs@4.4.0` (the lockfile's version) with the same `overrides` block (`uuid ^11.1.1`) in the scratch `package.json`, and symlinked only `node_modules/exceljs` into the worktree. Its transitive tree is whatever npm resolved there, not the lockfile's; CI's `test (ubuntu-latest)` ran the same suites on the real install and passed. `npm run build` exit 0, `npm run check` exit 0, `npx vitest run tools/ledger` 575 of 575 in 36 files (17 of them in the two new spec files, 10 + 7; the only existing test file changed is `schema.test.ts`, two `user_version` literals 4 to 5). `packages/core` image-closure and spawn-safety: 25 of 25. `node scripts/check-lockfile-sync.mjs` exit 0. Positive controls: a commit in dry-run mode turns a test red (below), the carry-over comparison disabled turns Done when 2's test red, and the control run of the dry-run harness with a second connection open leaves the books bytes unchanged while the leftover-WAL run changes them, so the harness can tell the two apart.

| Done when                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dry run reports every repair and writes nothing; a test asserts the database is unchanged | `api/test/workbook-import.test.ts` › "a dry run reports every repair and skip, and writes nothing" ✓ (asserts the `repaired:` and `skipped:` lines, the counts, then the file's sha256 and every table's rows unchanged) and › "a dry run into books that do not exist yet does not create them" ✓. Mutation: `importWorkbook` committing when `write` is false turns the first test red, on its `toContain("nothing was written")`, not on the hash (the commit lands in the in-memory copy). **Proven as the test builds it; false in the letter for books with a leftover `-wal`, a read-only file or a zero-byte file: F1.**                                                                                                                                                                                                                                                                                       |
| 2. A carry-over that disagrees with the previous year fails the import, nonzero exit         | `api/test/workbook-import.test.ts` › "a carry-over that disagrees with the year before fails the import, with a nonzero exit" ✓ (asserts exit 1, the named cell `2023!G8` and the sentence, zero `statement_rows`, zero `periods`). Mutation: the `carry.amountCents !== closing` branch in `books/src/workbook.ts` made `false`, books rebuilt, `dist` grepped: that test fails, 1 of 10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3. `--write` reproduces the mortgage gap (`own_A − own_B`) and buffer balance exactly        | `api/test/workbook-import.test.ts` › "--write reproduces the workbook's mortgage gap and buffer balance exactly" ✓ (hand-worked constants 94_999 / 25_000 / lead 69_999 / balance 119_999 / buffer 40_500, read back through `bucketsAsOf`). **Verified on a second workbook**: five years 2022 to 2026, odd-cent joint payments (−700.01, −700.03), a rebate of 25.01, two typo'd years (one in 2025), a placeholder, a v1 and a v2 period in 2025, an unrounded cached deposit (366.666…), an open period, and two corrections (one bucket move, one person to joint). Plain-integer oracle over the same table, sharing no code with `@ledger/books`: alex 1 249.95, sam 412.30, gap 837.65, balance 1 662.25, buffer 616.21; with the corrections 999.95 / −37.70 / 1 037.65 / 962.25 / 1 316.21. The books read back equal the oracle in both runs; period settlements 380.00 v1, 100.00 v2, 366.67 v1, 12.00 v2. |
| 4. A correction moves its row and leaves a note on it                                        | `api/test/workbook-import.test.ts` › "a correction moves its row and leaves a note on it" ✓ (asserts the note text, both classification records in order, the moved buffer and mortgage figures). Proven for a row the import adds; **the note is lost for a row a paste already holds: F4.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. Imported settlements keep their historical amounts and formula version                    | `api/test/workbook-import.test.ts` › "imported period settlements keep their historical amounts and formula version" ✓ (asserts start, end, `v1`/`v2`, payer, recipient, `depositCents` 38_000 and 10_000, status `matched`). The catch-up line it asserts, `sam deposits 130.00 $`, I re-derived by hand: alex 610 + 380 deposited against sam 430 + 100, sam must reach 0.4 / 0.6 of 990 = 660, so 130.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6. Gates green                                                                               | **unproven (gate)** — on `77a5d45`, `check` ✓, `test (ubuntu-latest)` ✓, `test (windows-latest, informational)` ✓, `docker` ✓ ×3, `e2e (direct)` ✓, `e2e` ✓, `codeql` ✓, `CodeQL` ✓, `dependency-review` ✓, but `e2e (sniffer)` (downloader.yml, run 37703447294, started 23:38:56Z) was still `in_progress` at 23:55Z. It is not a ledger leg; it ran because the root `package.json` and lockfile changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **med** · Done when 1 depends on it, in its letter · **F1 — the dry run does write to the books file in three conditions, and the shipped text says it cannot.** `openBooks` in `api/src/import-command.ts` opens the real file read-write (its inline comment says "Not `readonly`") and closes it; its own docblock above says "opened read-only, so nothing can write to it", the file header says it "never opens that file for writing", the README says "writes nothing", and the ticket Log says "so it never writes to the file". Reproduction (a copy of a live WAL database taken while its connection was open: `ledger.db` plus `ledger.db-wal`, no `-shm`, rows only in the WAL, i.e. what an unclean API stop leaves), then `runImportCommand([workbook, "--as", "alex"])` with no `--write`: before `ledger.db` `da63a52bdf62` 4096 bytes, `-wal` 197 792 bytes; after `ledger.db` `cc175ec0bd6f` 118 784 bytes, `-wal` absent (SQLite recovered and checkpointed on `file.close()`). Same through a symlink. Read-only file, no WAL: after the run an empty `-wal` and a 32 768-byte `-shm` sit beside it. A zero-byte existing file: 0 bytes before, 4096 after. Control: with a second connection open (the API running) the main file and `-wal` are byte-identical. Logical content is identical in every case (`dump` equal, the rows the WAL held are seen by the dry run), so no data is lost; the test avoids the condition by running `wal_checkpoint(TRUNCATE)` first and hashing only the main file. A mutation that makes the dry run open the real file directly (rollback still applies) leaves that test green; only "does not create them" goes red. **Open decision, two remedies:** (a) recommended, `openBooks` reads the file and its `-wal` bytes into a private `mkdtemp` directory (or `readFileSync` + `Database(buffer)` with the WAL applied) and never opens the original; assert sha256 of the main file, the `-wal`, and the absence of new sidecars against a crash image. (b) keep the code and soften the three sentences to "nothing is imported". The condition needs an unclean stop of the API (`server.ts` closes the database on SIGTERM, so a clean stop checkpoints).
- **med** · no Done when line depends on it · **F2 — a second reading of the stored rows is dropped by policy before the "fits two ways" refusal, so one ambiguity imports silently.** `place` in `api/src/workbook-import.ts` filters `readings()` to those where the workbook does not run past the newest stored row, and refuses only when more than one survives. Brief item 4: "where one reading of the data is ambiguous the import refuses rather than guessing". Reproduction: the committed fixture plus a 2024 tail `+10.00`, `−10.00`, `+10.00` (Dép. Courantes, Sam; balances 1 614.99, 1 604.99, 1 614.99), and **two** stored rows `+10.00`, `−10.00` classified like the tail, opening from 1 604.99. Readings: stored = the tail's first two rows (the workbook is one row ahead of the paste) or stored = from the tail's last row on. `--write` prints `imported 19`, `already stored 1`, exit 0, and stores `W1(+10), W2(−10)` below the paste's own `+10, −10`: four rows, balances 1 614.99 / 1 604.99 / 1 614.99 / 1 604.99, a duplicated pair that nothing can later edit. The builder's test ("fits the stored rows two ways") only covers three stored rows, where both readings survive the filter. Same with one stored row. Remedy: count every consistent reading, the excluded "runs past" ones included, and refuse when there is more than one; keep the "runs past" refusal for the case where it is the only one.
- **med** · no Done when line depends on it · **F3 — the figures the import verifies are cut at the date of the workbook's last row, not at its stretch of rows.** `workbookFigures` takes `asOf` as the last movement's date and `ledgerFigures` reads `date <= asOf`. Two consequences, one mechanism. (i) A refusal the brief says should not happen ("a date that differs is reported, not refused"): the committed fixture, and the pasted newest row dated 2024-02-03 where the workbook has 2024-02-02. Output: `dated differently: 2024 row 2, 2024-02-02 … the paste says 2024-02-03`, then `buffer balance 405.00 $ 705.00 $ DIFFERS`, `FAILED The books would show 705.00 $ for the buffer balance, and the workbook 405.00 $.`, exit 1; the same shape with the day-off row in the middle (the builder's test) passes. The analysis found one such date in 25 overlapping rows. (ii) A blind spot: on the five-year workbook, a 2026 mortgage payment mistyped to 2026-02-20 but positioned before a 2026-02-05 row. `Figures as of 2026-02-05`, mortgage balance 2 362.28 workbook and books, exit 0, `Written.`; the true total is 1 662.25 (the books do hold it afterwards), so that row is outside every compared figure and only the combined running balance covers it. Remedy: compare over the rows with `seq <= lastSeq` and take `asOf` as the latest date among them.
- **med** · Done when 4's clause "leaves a note on it" depends on it for rows a paste already holds · **F4 — a correction aimed at a row already stored is applied to the figures and its note is dropped, with exit 0.** `writeAll` writes `note` only on rows it adds; overlap rows are never touched. Reproduction: the fixture, the three-row paste classified as the corrected filing (2024-01-05 Versement to alex's buffer), `--corrections` with `{sheet: "2024", row: 4, bucket: "current-expenses", note: "Meant for the buffer."}`, `--write`: `corrected 1`, `Written.`, exit 0; `SELECT count(*) FROM statement_rows WHERE note LIKE '%Meant for the buffer%'` is 0. **Open decision, two remedies:** (a) recommended, refuse a correction that names a row the pastes already hold, with a problem naming the cell ("file that row in the app"); (b) carry the note elsewhere, which needs a column or table and so a migration. (a) costs one branch in `place`'s overlap loop.
- **low** · **F5** · `--write` on a database at `user_version` 4 with a failing verification prints `Refused: nothing was written.` and leaves it at `user_version` 5 (`openBooks` migrates the real file before the import's transaction opens); into books that do not exist it leaves a migrated 118 784-byte file. The README says it "writes nothing, when any verification fails". Content-neutral (the API's boot does the same migration); fix by migrating inside the transaction or by softening the sentence.
- **low** · **F6** · `readYear` treats any non-numeric amount cell as a placeholder: a formula with no cached value, or text such as `9,99 $`, on a dated row is `skipped … no amount`. Mid-sheet the running-balance chain refuses it (`2025!F3 … 123.45 unexplained`); on the newest rows of the last sheet nothing follows to break, so three amounts of the 2026 sheet left uncached import 23 rows, `skipped 4`, exit 0, figures equal. Reported by row but not distinguished from a placeholder; I reasoned, and did not run, that placement against stored pastes would catch a dropped newest row. Suggest listing "skipped, but the balance cell holds a figure" as a problem.
- **low** · **F7** · Diagnostics that point the wrong way (one bullet, one theme). A stored row missing from the workbook ends in `leaves 2604.99 $ where it leaves 2604.99 $: 0.00 $ is unexplained`; a sub-cent amount (250.005) is reported at the next year's carry-over cell, not its own; an unreadable `.xlsx` loses exceljs's reason (a sheet name with `/` gives only "The file could not be read as an .xlsx workbook."); a books file in a read-only directory fails with "Something went wrong on our end. (Out of memory)" and writes nothing.
- **low** · `nfr:maintainability` · **F8** · Test gaps (one bullet). No test dry-runs a database at `user_version` 4, the state the first real run meets (I measured: the file stays 4); no test of migration 5 on a populated v4 database (measured: existing imports read `source = 'paste'`, `note` null, the CHECK fires, re-applying `migrate` is a no-op); `api/src/xlsx.ts` has no spec of its own and its rich-text, shared-formula and boolean branches are exercised by nothing; the dry-run hash test covers the main file only.
- **low** · **F9** · A date whose year disagrees is moved to the sheet's year even when its position contradicts that: `2023-12-30` on the 2024 sheet, between January rows, becomes `2024-12-30`, reported as a repair, verification passes (the analysis's "the row order proves the sheet's own year" is not checked). Brief-faithful; a non-decreasing-date check after repair would catch it.
- **low** · `nfr:security` · **F10** · No bound on inflation: a 74 769-byte `.xlsx` whose shared strings inflate to 60 MB is refused (exit 2) in 0.7 s with +189 MB RSS; larger not measured. The file is the owner's own, on their machine: no live call site.
- **med** · _not re-graded, with the owner_ · the three open decisions (a nonzero opening balance refused, the Accueil ratio applied to every historical period, books that already hold periods refused). The build does what the brief says and no test on the branch contradicts it; the synthetic fixture exercises none of the three, so no Done when line turns on them. Recorded as `CONCERNS`-level, as instructed.
- **dropped** · "the stray `// overrides` key breaks a strict reader of `package.json`": `npm ls --package-lock-only`, `check-lockfile-sync`, image-closure, spawn-safety, `npm run check` and CI's `check`, `docker` ×3 and `dependency-review` all pass with it; the repo already carries `// …` keys in `scripts`.
- **dropped** · "exceljs brings an advisory": `npm audit --package-lock-only --json` lists 13 vulnerabilities (4 critical, 7 high, 2 moderate) at the head and the same 13, same advisories, at the base lockfile; none names exceljs or uuid.
- **dropped** · "the ledger image installs without the override": the Dockerfile copies the root `package.json` and `package-lock.json` before `npm ci`; `npm ls uuid exceljs --package-lock-only` shows `exceljs@4.4.0 overridden` over `uuid@11.1.1`; the three `docker` jobs on the head pass. Running the import inside the built image is **unmeasured**.
- **dropped** · "a sheet name with path characters reaches the filesystem": names are only printed; exceljs itself refuses `/ \ : * ? [ ]` in a name (measured), and an ANSI escape in one is refused by its XML parser.
- **dropped** · "migration 5 breaks or is not idempotent on populated data": measured on a v4 database with a pasted batch and classifications; see F8.
- **dropped** · "a dry run creates or writes through a missing path, a dangling symlink or a symlink to the books": a missing path and a dangling symlink create nothing; a symlink is followed and behaves as F1.
- **dropped** · "Done when 3 only agrees with itself, since expected and books both go through `mortgageAsOf`": refuted for the figures by the second workbook against an independent oracle (row 3), and the running-balance and carry-over checks read the workbook's own cells.
- **unmeasured** · running the import inside the built image (CI's `docker` jobs build it and probe `/api/health` only); the owner's real workbook (not available, as expected); `npm ci` itself (not run here, per the dispatch; the `docker` jobs and `e2e (direct)` ran it with the override on the head); inflation beyond 60 MB; the dry-run copy on Windows.
- **findings** · the hunt returned 17; 10 carried (F1 to F10), 7 dropped. The three owner decisions are listed above and are not counted.
- **invariants** · checked: no cross-tool import; `AppError` with `BAD_REQUEST`/`INTERNAL` from core; no shell (`spawn-safety` ✓, no `child_process` in the new files); no `console`; tests live in existing registered packages; `exceljs` is third-party, so the Dockerfile needs no new line and image-closure passes; contract edit (`PERIOD_LINE_SOURCES` gains `workbook`) was anticipated by `period_lines.source`'s own schema comment and the contract's lg-6 comment; no `UPDATE`/`DELETE` added (`classification-schema.test.ts` ✓). Skipped as not touched: SSRF, redaction of headers and URLs, progress, routes (the import is a command, not a route).
- **NFR** · security: see F10; the corrections file and workbook are read by path only, nothing is logged but the printed report. performance: n/a at fixture size (placement is O(rows × stored)); the real workbook's size is unmeasured. reliability: F1, F2, F3, F5. maintainability: F8.

### Gate 2

**Gate: CONCERNS** — 2026-10-08 · `77a5d452..46c69118fbdae7ac462fc65d5941241549742031` (round 1; PR #396 draft) · Sonnet 5.5, depth full, scoped to the round

No finding is a `high`. Two new `med`, both in lines this round wrote, neither tied to a `Done when` line; everything else new is `low`. Gate 1's F1 to F4 are fixed.

**How this was run.** Detached at the new head, farm, `npm run build` exit 0 (`applyRatios` is in `books/dist`). The `exceljs` symlink into `node_modules` points at the scratch install from gate 1 (4.4.0, `uuid` 11.1.1); no `npm install` or `npm ci` was run. `npm run check` exit 0. `npx vitest run tools/ledger`: 592 of 592 in 37 files (gate 1 head: 575 of 575 in 36; the round adds 17 tests and `xlsx.test.ts`). `packages/core` image-closure and spawn-safety 25 of 25, `check-lockfile-sync` exit 0; `package.json`, `package-lock.json`, `tools/ledger/api/package.json` and the Dockerfile are untouched by the round. CI on `46c69118`, read with `gh pr checks 396` at 00:58Z: all 14 checks pass, `test (ubuntu-latest)`, `test (windows-latest, informational)` (it ran the new crash-image copy test), `docker` ×3, `e2e` ×3 (`e2e (sniffer)`, still running at gate 1, passed on this head), `check` ×2, `codeql`, `CodeQL`, `dependency-review`.

| Done when                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 to 5                                                                                                                                                                        | Unchanged in meaning; every existing test still passes, and the edits to existing test files are additions (`schema.test.ts` gains a test; `workbook-import.test.ts` gains tests and its helper `pasteTail` a `newest` option). Done when 1's gap is closed: `api/test/workbook-import.test.ts` › "a dry run never opens the books: a crash image's file and log stay as they were, and nothing appears beside them" hashes the file and the `-wal` and lists the directory. Mutation: the copy leaving the `-wal` behind turns it red (1 of 19). I ran it again with my own crash image: before and after, `ledger.db` `da63a52bdf62` 4096 bytes and a 197 792-byte `-wal` (same hash both times), no `-shm`, directory listing equal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6. Gates green                                                                                                                                                                | **proven (gate)** — all 14 checks pass on `46c69118` (above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7. A closed period given its own ratio records it, and its settlement and the catch-up use it; a malformed ratio, or one naming no closed period, is refused naming its entry | `api/test/workbook-import.test.ts` › "a period given its own ratio records it, and its settlement and the catch-up use it" ✓ (asserts the stored shares per period, the three `ratios` records with their effective dates and which cite a salary, and `sam deposits 230.00 $ (net 138.00 $)`), and › "a ratio that is malformed, or names no closed period, is refused naming its entry" ✓ (exit 2 on `ratio 1's shares add up to 90 %`, exit 1 naming `ratio 1, for "$ (Nulle part)"` and `ratio 2 … names the open period`); `books/test/workbook.test.ts` › "a ratio in the corrections file is refused whole when it is malformed" and › "a ratio is given to the closed period it names, and refused for any other". Mutation: the period's own ratio ignored when writing (`takeEffect(from, null)`) turns the first test red (1 of 19). **Verified by hand, independent of the code**, on the committed fixture, with sam owing the sum over periods of what the period's fair split leaves less what the deposit reaches at that period's ratio: 50/50 on the v1 period alone, books say `263.33 $ (net 158.00 $)`, hand 100 + 40 + 18 = 158; 50/50 then 55/45, `313.33 $ (net 188.00 $)`, hand 100 + 70 + 18 = 188; 50/50 on both, `363.33 $ (net 218.00 $)`, hand 100 + 100 + 18 = 218; 33.3333 / 66.6667 on the v1 period, `net 291.33 $`, hand 233.33 + 40 + 18; the builder's 230.00 / 138.00 re-derived the same way (100 + 20 + 18). |

**Gate 1's findings.**

| Finding                               | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 dry run writes to the books        | **Fixed** for what it described. Crash image (file plus `-wal`, no `-shm`): bytes and directory unchanged after a dry run; `--write` on it imports and checkpoints on its own close, as a write should. Zero-byte file stays 0 bytes. A symlink to a crash image, a missing path and a dangling symlink: nothing written, nothing created (a missing path creates no directory). New problems the fix opened: G2-1 and G2-3.                                                                                                                                          |
| F2 ambiguity imports silently         | **Fixed.** The tail `+10 −10 +10` against one stored row and against two now ends `placed against the stored rows 2 ways (with 3 or 1 of its rows already stored)`, exit 1; with `--write` the books still hold only the two pasted rows.                                                                                                                                                                                                                                                                                                                             |
| F3 figures cut at the last row's date | **Fixed.** (i) A paste dating its newest row 2024-02-03 against the workbook's 2024-02-02: `dated differently …`, `buffer balance 405.00 $ 405.00 $`, exit 0. (ii) A typed date ahead of the rows after it is now refused by the order check, at a cell (see G2-4), not a blind spot.                                                                                                                                                                                                                                                                                 |
| F4 correction's note lost             | **Fixed.** Refused, exit 1: `The correction for 2024 row 4 names a row a paste already holds, … File that row in the app`; zero notes written.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F5 refused `--write` migrates         | **Fixed.** A version-4 file with a failing carry-over: exit 1, `user_version` still 4 (read back after the run), file hash equal; missing books: no file, no directory. The nested path works: with migration 5 forced to fail on its second statement, inside `BEGIN IMMEDIATE` it throws, leaves `user_version` 4 and the first statement undone, and the outer transaction still rolls back; outside a transaction (the API's boot path, `migrate` = `configure` + `applyMigrations`) it behaves as before; a nested success followed by `COMMIT` keeps version 5. |
| F6 non-numeric amounts skipped        | **Fixed differently; accepted.** My three reproductions (formula with no saved value on the newest row, three of them on the last sheet, text `9,99 $`) are each refused at their own cell, exit 1. The builder's objection to my rule holds on the fixture: a placeholder whose `F` is a formula and whose `G` is empty imports as a skip, and my rule would have refused it. The new rule has a false positive of its own: G2-2.                                                                                                                                    |
| F7 diagnostics                        | **Three of four fixed, verified**: a missing stored row reads `so a row is in one and not the other`; a sub-cent amount (250.005) is refused at its own cell `2024!G5`; an unreadable file carries exceljs's reason (`… .xlsx workbook (Worksheet name $ (Sept/Mars) cannot include …)`). The fourth, a books file in a read-only directory, is the one the builder left; a dry run no longer reaches it, but see G2-1 for the read-only file.                                                                                                                        |
| F8 test gaps                          | **Fixed.** A dry run on a version-4 file, migration 5 on a populated database, and `api/test/xlsx.test.ts` (rich text, shared formula, boolean, error, hyperlink, merged cell, unreadable file) exist and pass. One branch is still uncovered, the falsy saved value: G2-2.                                                                                                                                                                                                                                                                                           |
| F9 repaired date contradicting order  | **Fixed, and broader than asked**: see G2-4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F10 inflation                         | **Left recorded; accepted.** Re-measured: 74 769 bytes inflating to 60 MB, exit 2 in 0.64 s, +187 MB RSS. No live call site.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**New findings, in lines this round touched.**

- **med** · no Done when line depends on it · **G2-1 — a dry run, and a `--write`, on a read-only books file now fail with a misleading message; gate 1's version of the same dry run worked.** `copyBooks` in `api/src/import-command.ts` copies with `copyFileSync`, which keeps the source's mode, and the copy is then opened read-write. Reproduction: books migrated, two people enrolled, checkpointed, `chmod 0444`; `runImportCommand([workbook, "--as", "alex"])` with no `--write`: exit 2, stderr `Something went wrong on our end. (attempt to write a readonly database)`. Same for a crash image with a read-only `-wal`. Gate 1's reproduction of the same file (exit 0, with stray sidecars) is why this counts as a regression of the F1 fix. No test builds a read-only books file. Remedy: set the copy's mode (`chmodSync(copy, 0o600)`, and the log's) after copying, or write the bytes rather than copy the file; that also makes a rehearsal on a read-only snapshot of the books work.
- **med** · no Done when line depends on it · **G2-2 — exceljs drops a formula's saved `0` and `FALSE`, so F6's new rule refuses an amount cell that does hold a saved value, with a remedy that cannot work.** exceljs's `cell.value` for a formula copies only truthy fields (`_copyModel`), so `<c><f>0*1</f><v>0</v></c>` reads as `{formula}` with no result; `api/src/xlsx.ts` then hands the books `value: null`. Reproduction: the five-year fixture with the placeholder's `G4` (2022) set to formula `0*1` saved as 0: `FAILED 2022!G4: the amount is a formula with no saved value; open the workbook in Excel and save it.`, exit 1 (it was a skip before the round); re-saving in Excel cannot change it. A formula saved as an empty string reads the same. The same quirk already turns the committed fixture's first-year `Solde reporté` `G12` set to a formula saved as 0 into `2022!G12: a carry-over has no amount.` (measured); a running balance of exactly 0 would read as `a movement has no running balance` (not run). The branch's tests build the cell grid by hand (`value: null, formula: …`), so none passes through exceljs's reader. `cell.model.result` keeps 0 and `false` (measured: `0`, `false`; the empty string is lost in the parse, `undefined`). Remedy: read `cell.model.result` in `valueOf`'s formula branch, and say "has no readable value" rather than "no saved value" for the case exceljs cannot tell apart. Whether the owner's `G` column or carry-overs hold formulas is unmeasured.
- **low** · `nfr:reliability` · **G2-3 — the copy is not a consistent snapshot while the API writes.** `copyBooks` reads the file and then the log, with no check between; the code comment says a torn copy "can only make the rehearsal differ from the real import". With a stand-in writer (a tight loop, 20 inserts of about 1 KB per transaction, a `wal_checkpoint(TRUNCATE)` every 5 transactions) and the same two copies in the same order, 145 of 215 copies failed `PRAGMA integrity_check`; with a checkpoint every transaction, 0 of 389. For `--write` that comment holds: with the rehearsal blinded (it always saw empty books) the `--write` tests still passed, because the real import runs every verification again inside its transaction. A dry run prints whatever the copy shows, and I did not run the importer against a corrupt copy. At a household's write rate the window is microseconds: no live call site. Suggest comparing size and mtime of the file and log before and after, and copying again on a change.
- **low** · open decision · **G2-4 — F9's order check refuses any out-of-order row, not only a year-repaired one, and the corrections file cannot date a row.** The Log discloses it. Reproduction: the five-year workbook with one 2024 row typed two days late (`2024-01-21` for `2024-01-19`) and, separately, one typed two days early: both exit 1, `2024!B4: dated 2024-01-20, but the row below it, row 5, is dated 2024-01-21; newest first, no row is older than the one below it`; in the first the message names the correct row's cell, not the mistyped one's. A same-day pair imports. The analysis found a date a day off in 25 overlapping rows, so an inversion in the real file is plausible; the owner can only fix it by editing the workbook, once, in the one pass the report gives. After F3's fix (figures over the stretch by position) the order check no longer protects any verification for rows whose year was not repaired. **Two remedies:** (a) as built; (b) recommended, refuse only an inversion at a year-repaired row (gate 1's F9, the case where the repair itself creates the contradiction) and print the rest as `dated out of order:` lines the report carries. Not ruled by the owner.
- **low** · **G2-5** · An override equal to Accueil's (60/40 on the first period) is stored once, from the first day, citing no salary, and Accueil's later periods reuse that record: the report shows a single `(the corrections file)` line and `ratio_shares.salary_id` is null for the ratio that is in force after the last close. Content is right; the provenance link to the salaries is lost.

**Per-period ratio, attacked** (committed fixture and the five-year workbook, `--write` unless noted): an override on the first period only (`ratio from 2022-01-05 … (the corrections file)`, then Accueil's from 2022-09-01); two consecutive different overrides (three records, effective 2022-01-05, 2022-09-01 and 2023-04-01); two consecutive equal overrides (one record for both periods); 100/0 (imports; the catch-up stays finite, `alex deposits 605.00 $`); 33.3333 / 66.6667 (333 333 and 666 667 parts per million); overrides on both 2025 periods of the five-year workbook (effective 2023-04-01 and 2025-06-01, Accueil's again from 2026-01-01); a dry run with an override (report only). Refused: an unknown person (`ratio 1, for "$ (Avril-Août)", names "Bob", who is not one of the household`, exit 1), the same person under two spellings (`names alex and alex`, exit 1), shares summing to 99.9999 (exit 2, `ratio 1's shares add up to 99.9999 %, not 100 %`), a sheet named twice (exit 2), three names (exit 2), a negative share (exit 2). The unique index on a first ratio's date is never reached: effective dates are strictly increasing because each is the day after a distinct close.

- **dropped** · "moving migrations inside the transaction changes the API's boot path": `migrate` is `configure` then `applyMigrations`, `nested` is false at boot, and the sequence (BEGIN, statement, `user_version`, COMMIT) is as before; measured above.
- **dropped** · "a ratio override can collide with an existing ratio or leave the books with two current ratios for a day": measured above; the 100/0 and consecutive cases stay consistent.
- **dropped** · "a torn copy makes `--write` unsafe": refuted, see G2-3.
- **dropped** · "the round's CI is red or unfinished": all 14 pass on `46c69118`.
- **dropped** · "dependency or image changes in the round": none; the diff touches no `package.json`, lockfile or Dockerfile.
- **findings** · the hunt returned 10; 5 carried (G2-1 to G2-5), 5 dropped.
- **unmeasured** · the owner's real workbook (not available); running the import inside the built image; whether `G` or a carry-over is a formula in the real file (G2-2); the importer on a genuinely corrupt copy (G2-3); the dry-run copy under a live API on Windows (the Windows unit leg ran the crash-image test with no API running).
- **NFR** · security: the copy is made in a `mkdtemp` directory (mode 0700) and removed in `finally`; no shell, no new dependency. performance: n/a. reliability: G2-1, G2-3. maintainability: the nested `SAVEPOINT` path is covered only through the import tests, not by a test of `applyMigrations` failing (I exercised it by hand).

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
