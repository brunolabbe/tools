---
id: lg-87
tool: ledger
title: The SheetJS reader drops value-less formulas, reads day 0, and its zip check promised more than it kept
kind: fix
status: done
milestone: null
depends_on: [lg-84]
difficulty: standard
---

# lg-87 — Fix what lg-84's gate found in the SheetJS reader

## Why

lg-84 (PR #710) replaced `exceljs` with SheetJS. Its gate returned FAIL after the
owner had merged it on green CI, with two highs, two meds and four lows, each
against the list in lg-84's "What the replacement must keep" or against
`workbook-zip.ts`'s own claims. The owner chose on 2026-11-01 to fix them now, in
this ticket, rather than revert lg-84 or only file them.

## Reproduction

On `main` at `bac81e33`, each through `readSheets` on a workbook written by the
test helpers with one cell's XML replaced:

- **F1 (high).** `<c r="B1"><f>A1*2</f></c>`, and the same with `<v></v>` or
  `t="n"`, the shapes Excel and `exceljs` write for a formula saved with no value,
  read as no cell at all, so the formula is lost. SheetJS reads the empty value
  as 0 and skips the cell as `0 == ""` unless `sheetStubs` is on. Under `exceljs`
  it was `{ value: null, formula: "A1*2" }`, and the books reported "the amount is
  a formula with no readable value"; on `bac81e33` the row is skipped silently.
- **F3 (med).** A date-formatted cell holding 0 or 0.5 reads as
  `{ kind: "date", date: "1900-01-00" }`, which the books accept.
- **F2 (high, read from `xlsx.mjs`, then measured).** SheetJS takes an entry's
  method and sizes from its local header or a zip64 record, and finds the end
  record searching back from four bytes before the end; `workbook-zip.ts`
  checked only the directory and searched from 22. Its pure-JavaScript inflate
  keeps a buffer of the local size, or grows one when that size is 0. A local
  header saying deflated where the directory says stored was therefore counted as
  its raw bytes and read by SheetJS as an inflate. The header paragraph lg-84
  wrote also named `XLSX.set_zlib`, which does not exist in 0.20.3; the hook is
  `XLSX.CFB.use_zlib`.
- **Lows.** F4: most new branches unasserted. F5: a merge over 150 000 rows threw
  a `RangeError` from a spread into `Math.max`. F6: `SSF.parse_date_code` goes
  through local time, off by a day in two Pacific zones (gate's measurement). F7:
  `xlsm` never occurs as a `bookType`, and `case "d"` was unreachable. F8: a
  trailing row of only an empty string or a code-less error was kept as a row.

## Decision — answered

- **Answered 2026-11-01 by the owner: how to handle the findings.** Fix now, as a
  ticket and a pull request, from: fix now; revert #710 and redo lg-84; file only.
- **Answered 2026-11-01 by the owner: F2's remedy.** Refuse a local header that
  disagrees with the directory, and search for the end record as SheetJS does,
  from: that; or re-write the zip from the validated entries before SheetJS
  reads it.
- **Answered 2026-11-01 by the owner: a date serial below 1.** No value, from: no
  value; or the number itself.

## Done when

1. Each of F1, F3 and F5 to F8 has a test in `xlsx.test.ts` that fails on
   `bac81e33`'s reader, and F2's refusals each have one in `workbook-zip.test.ts`.
2. `npm test -- --project ledger` and `npm run check` pass.

## Log

### 2026-11-01 — built (orchestrator session)

- **`xlsx.ts`.** `sheetStubs: true`, with a stub read as no value and a formula-less
  stub, an empty string or a code-less error not shaping a row (F1, F8). Days are
  computed in UTC from the serial, below 1 and Excel's serial 60 naming none,
  1904 system honoured (F3, F6). Merges and widths by loop, not spread (F5).
  `bookType` must be `xlsx`; `case "d"` gone (F7). The refusal now reads
  `(ods, not xlsx)` rather than `(a ods file)`.
- **`workbook-zip.ts`.** A local header must repeat the directory's method and
  sizes, or carry 0s under bit 3; must not say encrypted; and neither header may
  carry a zip64 record. An end-record signature in the last 21 bytes is refused.
  Measured before relying on it: Node's inflate of a stream cut at the
  directory's compressed size errors (`Z_BUF_ERROR`), so a stream running past it
  is refused; SheetJS's buffer grows only when the local size is 0.
- **Two existing tests changed their attack, not their point.** The "forty
  entries over one stored block, each declaring 0" cases in `workbook-zip.test.ts`
  and `workbook-describe.test.ts` are now refused at the local header before the
  count. The unit test declares truthfully and still pins the chunked count; the
  route test declares 0 in the local header too, under bit 3, which is the form
  that still reaches the count.
- **Tests.** The new F1 and F3 cases fail with `sheetStubs` and the below-1 rule
  removed (4 failed), and pass with them. Ledger suite: 97 files, 2070 passed.
- **Not covered.** A chartsheet, which the helpers cannot write; F6 across time
  zones beyond the test runner's own.
