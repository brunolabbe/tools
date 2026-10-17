---
id: lg-37
tool: ledger
title: The workbook import refuses the real workbook, whose layout lg-7 guessed wrong
kind: fix
status: done
milestone: null
depends_on: [lg-7]
---

# lg-37 — The workbook import refuses the real workbook, whose layout lg-7 guessed wrong

## Why

The first dry run of `npm run import:ledger` against the household's workbook
(2026-10-17) refused with fifteen problems. Two were the workbook's own and
the owner fixed them in it: one period sheet named nobody in row 1, and one
period started almost two months before the previous one ended. The other
thirteen were the reader's. `00-ANALYSIS.md` §8 does not say where a period's
`Total` and `Montant à déposer` rows are, how Accueil holds the salaries, or
that the older year sheets carry a summary block. Where §8 was silent, lg-7
chose a layout, and its fixtures were built to match that choice. Nothing ever
compared it with the real file.

Reproduction, as layouts (no figure from the real file is reproduced here):

- **Period sheets** keep `Total` (row 2), `Équivalence` (row 3) and
  `Montant à déposer` (row 4) _above_ the lines, which start at row 8. The
  reader looked for them only from row 8 down, so every closed period reported
  "closed, but no Montant à déposer was read from it".
- **v1 sheets** compute the deposit in two steps: `Équivalence` divides by the
  ratio, and `Montant à déposer` only subtracts (`=IF(D3<E3,E3-D3,0)`). Once
  the row was found, its own formula had neither `/` nor `*`, so it would have
  been refused as neither v1 nor v2.
- **Year sheets 2022–2024** open with `Solde Dép. Courantes`,
  `Solde Hypothèque` and `Total` in `C`, with their figures in `G` and no date.
  Each of these was reported as "an amount with no date". 2025 and 2026 keep
  the same block in `D`/`F`, which the reader never looked at.
- **Accueil** puts the two names over columns (row 2) and the salaries under
  them, in a row labelled `Salaires bruts (…)`. The reader wanted a name with
  its salary to the right, and found none.

## Build

In `books/src/workbook.ts`:

1. Read a period's `Total` and `Montant à déposer` rows from row 2, and read
   lines only from row 8. A summary row below the lines still ends them.
2. When the `Montant à déposer` formula neither divides nor multiplies, tell
   its version from the formulas of the same-sheet cells it reads.
3. Above a year sheet's first dated row, skip a row labelled `Solde …` or
   `Total` in `C` or `D`, rather than reporting it as an amount with no date.
4. Read Accueil's salaries from the row labelled `Salaires…`, each under the
   column the nearest name above it heads. Only that row is read, so the
   calculators further down are never taken for salaries.
5. Refuse periods that overlap (the owner asked for this on 2026-10-17, when
   one was found). A period may start on the day the previous one ends,
   because the real sheets share that boundary day.

Also move the fixtures to the real layout (Accueil in both suites), and
correct §8.

## Done when

- A period sheet with its summary above the lines is read: its lines from
  row 8 only, its total checked, its deposit's payer and amount correct.
- A v1 deposit computed through an `Équivalence` row is read as v1, and a v2
  one as v2.
- A year sheet's summary above its movements is not a problem, and the same
  figure below a movement still is.
- Accueil's salaries are read from the labelled row and not from a calculator.
  A second `Salaires` row is refused, and so is a missing one.
- Overlapping periods are refused, whether closed or open, and touching ones
  are accepted.
- Run against the owner's corrected workbook, the reader reports no problems.

## Log

- 2026-10-17: Built from the owner's dry run. The new tests live in their own
  `describe` at the end of `books/test/workbook.test.ts`. Run against lg-7's
  reader, all six fail. The last acceptance line was checked on the owner's
  machine and not in a test, because real data never enters the repository.
  The reader found no problem and 19 checks held, including each period's
  lines adding up to its total. It read the first two periods as v1 and the
  last three as v2, as §5 says.
- The new check that a period's lines add up to its total runs on the real
  sheets for the first time. It now reads a `Total` row it never reached
  before, and all ten held.
- The 2025–2026 year summary (`D` label, `F` figure) was never a problem,
  because the reader reads amounts only from `G`. Neither summary is verified
  against the rows, since they restate them. The existing carry-over checks
  already prove each year's close.
