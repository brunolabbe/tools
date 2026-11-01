---
id: lg-88
tool: ledger
title: A merged range costs memory in proportion to its area, past every size bound
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-88 — A merged range costs memory in proportion to its area

## Why

`xlsx.ts` gives every cell a merge covers, other than its first, a `null` place in
its row, as `exceljs` did before lg-84. The cost is the merge's area, not the
file's size, so none of `workbook-zip.ts`'s bounds (bytes, entries, inflated
size) sees it, and the rows-and-cells bound in `workbook-describe.ts` runs only
after the grid is built. Found by lg-87's gate; owner chose on 2026-11-01 to file
it rather than fix it in lg-87.

## Reproduction

Measured by lg-87's gate on `14f6fe59` (`mergecost.mts` in that gate's scratch
directory): a 2 513-byte workbook holding one merge, read through `readSheets`.

| Merge       | Memory  | Time   |
| ----------- | ------- | ------ |
| `A1:XFD100` | +76 MB  | 0.23 s |
| `A1:XFD400` | +227 MB | 0.9 s  |

`bac81e33`, before lg-87, cost the same (+226 MB at `A1:XFD400`). Linear in area,
so `A1:XFD1000` is about +570 MB, over the 512 MB the ledger's container has
(`compose.ledger.prod.yaml`) and the 4 MiB inflated bound is sized against.

## Decision — answered 2026-11-01 by the owner

**Option 3: stop giving merged places at all.** Chosen from the three below. The
"unverified" in option 3 was checked before asking, on `main` at `686b213c`: every
reader indexes a sheet's cells as `rows[r]?.[c] ?? null` (`books/src/workbook.ts`,
`cellAt`; `api/src/layout-view.ts`, `rowLine`), a merged place is already `null`
like any gap, and `workbook-describe.ts`'s cell bound counts only non-null cells.
So dropping the places changes no value a reader sees: only a row's trailing
width, the row count past the last stored row, and a value stored inside a merge
(read under option 3, which Excel never writes).

**How to bound it** — the options it was chosen from:

1. **Clip a merge's places to the stored cells' extent.** A merge then holds
   places only where the sheet holds something to its right or below. Changes what
   `xlsx.test.ts`'s `a merge past the last stored row holds its places to its own
   end` asserts.
2. **Refuse a workbook whose merges cover more than a cell cap**, before the grid
   is built, as `WORKBOOK_TOO_LARGE` with a new `details.bound`. Keeps the place
   semantics; needs a bound and a contract-adjacent detail value.
3. **Stop giving merged places at all.** Only the first part is a cell; the rest
   are absent. Simplest, and changes row widths for every merged layout, which the
   books' column positions may rely on — unverified.

## Measurement — answered 2026-11-01 by the owner

**Option (a): both runs, capped.** Asked at intake, because Done when 2 measures
`A1:XFD1000`, which before the fix is about +570 MB: over the production
container's 512 MB (`compose.ledger.prod.yaml`), on a shared machine. The options:

- **(a) both runs, capped (chosen).** Measure before and after the fix, each in a
  child node process with its heap capped at 512 MB (`--max-old-space-size=512`).
  The before run is expected to hit the cap, and that counts as the reading that
  proves the bug. The after run must stay under the +110 MB a request the 4 MiB
  bound was sized for.
- (b) after the fix only, citing lg-87's estimate for the before figure.
- (c) as written, uncapped.

lg-87's `mergecost.mts` is not in the repo, so the measuring script is written
here and its path is in the Log. A heap cap bounds the V8 old space only, not
off-heap `Buffer`s; what RSS then shows is said beside each number.

## Build

1. In `api/src/xlsx.ts`, `rowsOf`: delete the `covered` map and its loop over
   `sheet["!merges"]`. A row is its stored cells, gaps `null`, as for an unmerged
   sheet; `last` is `data.length` alone.
2. `api/test/xlsx.test.ts`: `a merge past the last stored row holds its places to
   its own end` becomes a test that the sheet ends at its last stored row; the
   150 000-row merge test expects one row; `a merged cell is read once, at its
   first part` still holds.
3. Measure Done when 2 the way lg-87's gate measured the reproduction, and record
   the number in the Log.

## Done when

1. The owner's choice is recorded here with its options, and `status` moves on.
2. A merge of `A1:XFD1000` read through the describe route stays under the memory
   the 4 MiB bound was sized for (+110 MB a request), measured.

## Log

- 2026-11-01: filed from lg-87's gate (its F5 bullet), on the owner's choice.
- 2026-11-01: owner answered the decision: option 3. Build written from it; status `ready`.
- 2026-11-01: owner answered the measurement question at intake: option (a), both runs capped at 512 MB. Recorded above.
- 2026-11-01: built (builder, Sonnet 5.5). `rowsOf` in `api/src/xlsx.ts` no longer
  builds the `covered` map: a row is its stored cells with gaps `null`, and the
  sheet ends at its last stored row. Tests in `api/test/xlsx.test.ts`: `a merged
  cell is read once, at its first part` now expects a row of one cell;
  `a merge past the last stored row holds its places to its own end` became `... does
  not extend the sheet (lg-88)`; the 150 000-row test expects one row of one
  cell; a new `a merge of A1:XFD1000 holds no places, whatever its area (lg-88)`
  at the end of the file. Against the base's `xlsx.ts` the first three fail
  (`Tests 3 failed | 16 passed (19)`); against the fix `npx vitest run
  tools/ledger/api/test/xlsx.test.ts` is 20 of 20, and `npm test -- --project
  ledger` is 2136 of 2136 in 99 files. No reader needed the places: nothing in
  `books` or `layout-view.ts` failed.
- 2026-11-01: **Done when 2, measured**, on `83eac952` (before) and the fix, per
  the owner's option (a): each run in its own child node process with
  `--max-old-space-size=512`, through `describeWorkbook` itself with a model that
  refuses (every bound, `readSheets` and the request run; nothing is sent), alone
  on the machine. Script: `/tmp/claude-1000/-workspaces-tools/f48a77cc-a23d-41ac-8a28-5638eb9e6e7e/scratchpad/lg-88/build/merge-memory.mts`
  (scratch, not in the repo: a test of memory measures the machine). Re-run from
  the worktree root, the base's `xlsx.ts` being
  `git show 83eac952:tools/ledger/api/src/xlsx.ts > tools/ledger/api/src/xlsx-before.ts`:
  `node --import tsx <script> <tree> <absolute path to xlsx.ts> <range> <cap MB>`.

  | Merge        | Source | Cap    | Peak RSS growth | Peak RSS (process) | Time    | Outcome                       |
  | ------------ | ------ | ------ | --------------- | ------------------ | ------- | ----------------------------- |
  | `A1:XFD100`  | before | 512 MB | +61.1 MB        | -                  | 0.30 s  | read                          |
  | `A1:XFD400`  | before | 512 MB | +213.8 MB       | -                  | 2.05 s  | read                          |
  | `A1:XFD1000` | before | 512 MB | +480.9 MB       | 606 MB             | 3.29 s  | read, under the cap           |
  | `A1:XFD1000` | before | 256 MB | -               | -                  | -       | `SIGABRT`, heap out of memory |
  | `A1:XFD1000` | after  | 512 MB | +0.2 MB         | 125.1 MB           | 0.018 s | read                          |

  **The before run did not hit the 512 MB cap.** The cap bounds V8's old-space
  heap only, not off-heap memory (Buffers, strings' backing stores) nor the
  runtime's own baseline (125 MB here); the process grew `+480.9 MB` of RSS and
  peaked at 606 MB with the heap under 512 MB. So the cap shows nothing at 512 MB
  and the reading that proves the bug is the RSS: +480.9 MB is
  4.4 times the +110 MB a request was sized for, and the process peaked at 606 MB
  against the container's 512 MB (`compose.ledger.prod.yaml`), which counts RSS.
  The same workbook under a 256 MB cap is killed by the cap (`SIGABRT`, "heap out
  of memory"), so most of the growth is heap, and the cap bites at 256 MB where it
  does not at 512 MB. After the fix the
  same request grows the process by 0.2 MB, far under +110 MB. `heapRetainedMb`
  after the call (a forced collection) was 0.5 MB after and -0.8 MB before:
  nothing is kept past the request either way.

- 2026-11-01: what the brief had wrong or lg-87 left unreproducible. (1) The
  reproduction's workbook is 2 513 bytes; the same merge written by
  `test/helpers/xlsx-file.ts`'s `workbookOf` is 15 889 to 15 890 bytes, because the
  helper writes more parts. The sizes are not comparable and the growth is the
  merge's, so the numbers agree with lg-87's within the machine (XFD100: +61 MB
  against +76 MB; XFD400: +214 MB against +227 MB). (2) The intake's
  expectation that the 512 MB cap would stop the before run at `A1:XFD1000` was
  wrong, above.
  (3) Fold-in: none. Nothing else was made free by this change.
