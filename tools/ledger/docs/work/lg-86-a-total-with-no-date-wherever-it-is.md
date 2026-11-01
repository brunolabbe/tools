---
id: lg-86
tool: ledger
title: A described layout reads a year sheet's totals as money with no date
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-86 — A described layout reads a year sheet's totals as money with no date

## Why

The import screen (lg-66) reads a workbook through a layout a model describes,
and `WorkbookLayout.account.summary` names **one** column for every year sheet.
The household's workbook keeps two shapes of summary: in 2022–2024 the label is
in `C` and its `SUMIF`/`SUM` total in `G`, the amount column; in 2025–2026 the
label is in `D` and the total in `F`, which no amount is read from. The model,
shown the newest sheets first, answered either `D` or no summary, and the dry run
refused nine cells — `2022!B2` … `2024!B4` — as "an amount with no date". The
owner expects those rows to be ignored.

Reproduced on 2026-11-01 at `main` `bac81e33`, reading the owner's workbook
through `HOUSEHOLD_LAYOUT` with only `summary` changed: `C`/`["Solde", "Total"]`
gives 0 such problems; `null` gives 9; `D` gives 9. The synthetic reproduction is
the first case of "a total with no date, wherever it is" in
`books/test/workbook.test.ts`.

The owner asked for the rule to hold wherever a summary sits, not only above the
movements. One to the right of the layout's columns already never reaches an
amount. One at the top, the bottom or between the movements does.

## Build

In `readYear` (`books/src/workbook.ts`), an undated row whose every amount figure
is a formula that adds rows up — a call to `SUM`, `SUMIF(S)`, `SUBTOTAL`,
`SUMPRODUCT` or `AGGREGATE`, outside quoted text — is a summary, wherever it is
and whatever the layout's `summary` says. A range alone is not enough: a lookup
such as `VLOOKUP(D5,A1:B20,2)` reads one value. A plain figure, or arithmetic such as
`=150*2`, with no date stays a problem: in the owner's workbook 8 dated movements
hold a formula amount and none of them adds anything up.

Every row read as a summary, by the layout's label or by its formula, goes to a
new `WorkbookReading.summaries` and is named in the import's report, so nothing
is skipped quietly. The CSV's report is left alone: a CSV has no formulas and
refuses summary rows, so it never has one.

## Done when

1. An undated total in a column the layout's `summary` does not name, above the
   movements, is not a problem and is named in `summaries`.
2. The same below the movements and between them.
3. An undated plain figure, or an undated formula that adds nothing up —
   arithmetic, a lookup over a range, `SUM(` only inside quotes — is still
   "an amount with no date".
4. The owner's workbook, read with `summary` `null` or in `D`, has no "amount with
   no date" problem.

## Log

**2026-11-01 — filed and fixed in one change.** Reported from the import screen;
the owner chose "anywhere, named in the report" over "only above the movements".

- Done when 1–3: the five cases of "a total with no date, wherever it is" in
  `books/test/workbook.test.ts`. With `isTotal` switched off, cases 1 and 2 fail;
  with quoted text left in, case 5 fails.
- Done when 4: measured by hand against the owner's file, which never enters the
  repository: 0 such problems under `null`, `D` and the household's `C`, and the
  same nine rows named in `summaries` under each.
- Changed with it: `api/test/layout.test.ts`'s "lg37, no summary rows" now
  scores `same-import`, not `refused` — lg37's summaries are formulas, so a
  layout missing them no longer changes the import. That table pins lg-38's
  measurements, and this one entry no longer matches them. The web fixture
  `lg37-describe.json` was regenerated; its only change is the report's new
  `summaries` lines.
- Gate 1 (Sonnet, PASS with three lows). Fixed on the branch: F2, `ADDS_UP`
  also matched any range (`INDEX`, `VLOOKUP`, `MAX`, `DSUM`) and `SUM(` inside
  quotes, so it now names summing calls only, with quoted text stripped. F3: the
  CSV report's `summaries` lines could never print one, so they are gone. F1, an
  undated movement whose amount really is a `SUM`, is read as a summary and
  named in the report; the newest row of the newest sheet is the one place no
  balance check catches it. The owner accepted it on 2026-11-01: none of
  the workbook's 428 movements has a `SUM` amount, and the row is named in the
  report. Requiring no person was declined, since 162 of those movements have
  none either.
- Not done: the description still names one summary column. A model that
  misplaces it no longer matters for a total that is a formula, and still matters
  for a summary typed as a figure.
