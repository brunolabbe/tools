---
id: lg-84
tool: ledger
title: Replace exceljs, whose dependency chain carries advisories no release of it will fix
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-84 — Replace exceljs

## Why

`exceljs` is the only thing in the ledger that opens a spreadsheet:
`tools/ledger/api/src/xlsx.ts` reads a workbook's cached cell values and formula
text for `@ledger/books` (lg-7). Its last release is 4.4.0, from 2023, and its
dependency chain (`archiver`, `zip-stream`, `readdir-glob`,
`unzipper → fstream → rimraf`) pins glob 7 with minimatch 3 and minimatch 5. Those carry
GHSA-g3hv-75wg-m249, which is fixed only in minimatch 11, a major that glob 7
cannot load. Of the 9 moderate entries `npm audit` reported on 2026-10-31, six
are exceljs and its chain (`exceljs`, `archiver`, `archiver-utils`,
`zip-stream`, `readdir-glob`, `rimraf`), and `glob` and `minimatch` are shared
with `@fastify/static`. **repo-134** records the full account and why no code here
runs the bug. The package also needs a root `overrides` entry to force uuid 11
over its pinned uuid 8 (`package.json`'s `// overrides`).

The owner chose on 2026-10-31 to replace it rather than record the advisories and
wait. No exceljs release is likely to clear the chain, so the replacement is the
only way out.

## What the replacement must keep

`xlsx.ts`'s behaviour, which `test/xlsx.test.ts`, `test/statements.test.ts`,
`test/workbook-describe.test.ts` and `test/layout/` pin:

- every sheet, in workbook order, by name, as rows of cells, with empty rows and
  cells kept as gaps;
- a cell's **cached** value, never an evaluated one, as number, text or date (a
  date being a UTC calendar day). Rich text is joined, an error cell reads as its
  error text, and a cached `0` or `FALSE` is a value, not an absence (exceljs drops
  falsy results from `cell.value`, which is why `xlsx.ts` reads `cell.model`);
- a formula cell's formula text beside its value, shared formulas included,
  because a period's settlement formula is told apart by it;
- a merged range read only at its first cell;
- an unreadable file raises `BAD_REQUEST` naming the reader's reason.

`workbook-zip.ts` (lg-66) runs before the reader and stays. It already checks
the zip's central directory and bounds the inflated size with `node:zlib`, so a
replacement need not repeat that.

**The tests write workbooks with exceljs too** (`test/helpers/workbook.ts`,
`test/helpers/xlsx-file.ts`, `test/xlsx.test.ts`). Keeping exceljs as a
devDependency for them leaves the lockfile, and therefore `npm audit`, exactly
where it is. So the writer has to go as well.

## Decision — answered 2026-11-01 by the owner

**What reads the workbook: SheetJS 0.20.3, vendored.** The options were:

1. a reader of our own on `node:zlib` and an XML parser;
2. `read-excel-file` 9.3.14, **ruled out by reading its source**: it never reads
   a cell's `<f>`, its merge handling is commented out (`parseSheet.js:359`), and
   it returns error cells as empty;
3. SheetJS, which was chosen.

lg-7 refused SheetJS because its registry copy (`xlsx` 0.18.5) is stale and
carries GHSA-4r6h-8v6p-xvw6 (high) and GHSA-5pgg-2g8v-p4x9. The fixed builds
ship only from `cdn.sheetjs.com`. This choice reverses that refusal. Measured
2026-11-01:

- 0.20.3 is still the newest build (the CDN's `xlsx-latest` is 0.20.3). It
  dates from mid-2024 and has no dependencies.
- In a scratch project, `npm audit` reports 0 vulnerabilities for the CDN
  0.20.3, against both advisories above for the registry's 0.18.5.
- A probe read back a workbook written by exceljs, as `xlsx.test.ts` builds it
  today, with `XLSX.read(buf, { cellFormula: true, cellDates: true })`. Every
  requirement above held:
  - cached value with formula text, a saved `0`/`FALSE` included;
  - a shared formula expanded (`A3` → `f: "B2*2"`);
  - `#REF!` as `t: "e"` with `w: "#REF!"`;
  - rich text joined;
  - a merge listed in `!merges`, with only its first cell present;
  - a date as a `Date`;
  - sheets in workbook order (`SheetNames`).

The owner accepted that it is not actively released. A future fix means bumping
the vendored file by hand, because neither Dependabot nor `npm update` sees it.

**Where npm fetches it: a vendored tarball**, as SheetJS recommends, rather than
the CDN URL. Builds and CI never contact `cdn.sheetjs.com`.

**What writes the test workbooks: SheetJS too.** The probe wrote a formula with
its saved value, an error cell, a merge, a date and two sheets, and read them all
back. It cannot _write_ a shared formula, so that one case gets a small committed
`.xlsx` under `test/fixtures/` (keep the exceljs-written one from today's test).

## Build

1. Download `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` to
   `vendor/xlsx-0.20.3.tgz` at the repo root and commit it (2.4 MB). Check its
   hash against the CDN's integrity
   `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
2. In `tools/ledger/api/package.json`, replace `exceljs` with
   `"xlsx": "file:../../../vendor/xlsx-0.20.3.tgz"`. Remove `overrides.exceljs` and
   its `// overrides` comment from the root `package.json`. Update the lockfile
   the way `.claude/rules/dependency-updates.md` says, and confirm that `exceljs`,
   `archiver`, `unzipper` and `uuid` (the latter if nothing else wants it) leave it.
3. **Trap: the lockfile is shared.** Every tool's `Dockerfile` runs `npm ci`
   against it, and the downloader's and planner's images copy no `vendor/`. If
   `npm ci` there fails on the missing `file:` tarball, add `COPY vendor vendor`
   before `npm ci` in each Dockerfile. The ledger's needs it regardless. Every
   tool workflow's path filter includes `package-lock.json`, so all three
   container builds run on this pull request. Read them before calling it done.
4. Rewrite `tools/ledger/api/src/xlsx.ts` on `XLSX.read` with `cellFormula: true,
   cellDates: true`. Map a cell from `t`/`v`/`f`/`w`: an error cell reads its `w`,
   a boolean reads as `TRUE`/`FALSE` as today, and a date is a UTC calendar day.
   Rows come from `!ref`, and gaps stay `null` as today. Rewrite the header
   comment, which today explains why exceljs and not `xlsx`. Keep the
   `BAD_REQUEST` and its reason. `workbook-zip.ts` still runs first, and its
   comment about exceljs inflating every entry whole now applies to SheetJS. Check
   that it still holds, and reword it.
5. Port `test/helpers/workbook.ts`, `test/helpers/xlsx-file.ts` and
   `test/xlsx.test.ts` to SheetJS's writer, and keep every assertion.
6. Grep the ledger for `exceljs` and `ExcelJS` afterwards, in comments and docs
   included. lg-7, lg-38, lg-66 and lg-68 name it. Leave their history alone, and
   fix only what describes current code.
7. Dismiss any Dependabot alert for the glob/minimatch chain that this removes,
   or leave it to close itself, and note which in the Log.

## Done when

- `exceljs` is absent from `package-lock.json`.
- `npm audit` reports no advisory through the ledger. What repo-134 tracks for
  `@fastify/static` may remain.
- `npm test -- --project ledger` passes. The reader's tests keep their
  assertions, and only how they build a workbook changes.
- The downloader, planner and ledger container builds pass on the pull request.

## Log

- 2026-10-31: filed with repo-134. Candidates surveyed by registry metadata only.
  None of them was installed or tried.
- 2026-11-01: decisions answered (SheetJS 0.20.3 vendored, for reading and
  for writing test workbooks); moved to `ready`. `read-excel-file` was ruled out
  by its source and `write-excel-file` by its writer, which puts a formula's
  `<f>` with no `<v>`, so no saved result, error cell or shared formula. The
  probe and the audit comparison were run in a scratch directory; nothing was
  installed in the tree.
