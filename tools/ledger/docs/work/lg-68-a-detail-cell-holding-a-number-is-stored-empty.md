---
id: lg-68
tool: ledger
title: A detail cell holding a number is stored as an empty description by the workbook import
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-68 — A detail cell holding a number is stored as an empty description by the workbook import

## Why

The household's own `npm run import:ledger` (lg-7, lg-37) reads a year sheet's
`D` column, the movement's free-text detail, and stores it as the row's
`description`. When that cell holds a number, the stored description is `""`.
The command exits 0, and its report is identical, line for line, to the run
where the cell holds text, so nothing tells the household the detail is gone.
A detail typed `007` in Excel is saved as the number 7 and is lost the same
way, and so is a formula whose cached result is a number.

The cause is `textOf` in `books/src/workbook.ts`, which answers `null` for any
cell whose `value.kind` is not `"text"`; `readYear` turns that `null` into
`""`. `api/src/xlsx.ts` gives a number cell `kind: "number"`, so the value
never reaches the detail.

The reproduction: the synthetic history of `api/test/helpers/workbook.ts`,
imported with `--write`, once as written and once with 2022's first row's
detail cell written as the number 42. On `main` at `972ab6a0`:

```
--- detail cell as text: exit 0
report lines naming a problem or 2022-01-05: ["  imported        17","  already stored  0 (from pastes: checked, not imported)","  not imported: Labels, Budget","  ratio from 2022-01-05: alex 60.0000 %, sam 40.0000 % (Accueil's salaries)"]
statement_rows 2022-01-05: [{"date":"2022-01-05","description":"Versement","amount_cents":50000}]
--- detail cell as number: exit 0
report lines naming a problem or 2022-01-05: [the same four lines]
statement_rows 2022-01-05: [{"date":"2022-01-05","description":"","amount_cents":50000}]
```

lg-67's filing gate found it (PR #625, unmerged, its Decision 6). It has to
land before the owner's lg-37 dry run of the real workbook (lg-37's `awaiting`
line), and before lg-66's `.xlsx` build (PR #623, unmerged), which reads cells
through the same `textOf`.

## Build

1. In `books/src/workbook.ts`, read the detail cell through a reader of its own
   that gives a number cell its text, and leave `textOf` as it is. `textOf`
   also reads the cells matched against words (a bucket, a person's name, a
   carry-over or summary label, a period sheet's names row, its `Total` and
   `Montant à déposer` labels, Accueil's `Salaires` row), and a number's text
   there would be matched as one.
2. A number reads as Excel keeps what was typed: 15 significant digits, so
   `42` is `42`, `-3.5` is `-3.5`, and a float's noise (`0.1 + 0.2`) is `0.3`.
   `007` is saved as 7 and reads `7`: the cell as the books see it carries no
   number format.
3. Nothing else changes. A detail cell of another kind (a date) stays as it is
   on `main`; see the Log.

## Done when

1. `books/test/workbook.test.ts`, _a detail cell that holds a number (lg-68)_ ›
   _is read as the number's text, never as an empty detail_: details 42, 7,
   -3.5 and `0.1 + 0.2` read `42`, `7`, `-3.5` and `0.3`, beside a text detail
   that reads as before, with no problem reported. It fails on `main`.
2. `api/test/workbook-import.test.ts`, _a detail cell that holds a number
   (lg-68)_ › _is stored as the number's text, not as an empty description_: the
   synthetic workbook, 2022's first detail cell the number 42, imported with
   `--write` through the `.xlsx` path, exits 0 and stores `description` `42`.
   It fails on `main`.
3. `api/test/workbook-import.test.ts`, _a detail cell that holds a number
   (lg-68)_ › _a re-import onto books that already hold the import is refused,
   whatever the detail_: books that hold the defect's `""` are refused by a
   re-import of the workbook with the number in the cell, exit 1, and every
   table reads the same after as before.
4. `npm test -- --project ledger` passes with no existing test changed.

## Log

**2026-10-24 — filed and built (lg-68's builder).** The owner was asked how to
handle lg-67's filing gate's Decision 6, with three options: "File lg-68 and
build it now", "File lg-68 only" (the gate's recommendation) and "Fold into
lg-66". The owner chose **"File lg-68 and build it now"**: one step past the
gate's recommendation, overriding no one. lg-66's build (PR #623) and lg-67's
Decision 6 (PR #625) depend on this landing; neither ticket is edited here.

- **Reproduced on the branch's base**, `972ab6a0`, with the gate's own script
  (`xlsx-import-command.mts <tree> <outdir>`, writing only under `<outdir>` and
  calling no model): the output in the Why, `description: ""` for the number.
  After the fix the same script prints `description: "42"`, the report lines
  unchanged.
- **The failing tests came first**, in commit `4813f792`:
  `npx vitest run tools/ledger/books/test/workbook.test.ts -t lg-68` failed with
  `expected [ 'Versement', '', '', '', '' ] to deeply equal [ 'Versement', '0.3', '-3.5', …(2) ]`,
  and the import test with `expected [ { description: '' } ] to deeply equal [ { description: '42' } ]`.
- **Scope: the detail only, through `detailOf`.** `textOf` has 12 call sites,
  all in `books/src/workbook.ts` (the brief counted 13 across `books/src` and
  `api/src`: that is the 12 and the definition; `api/src` has none). Measured
  by making `textOf` itself read numbers, rebuilding `books`, and running
  `npm test -- --project ledger`: 1680 of 1680 passed, so no existing test or
  fixture tells the two scopes apart. Read against the household layout, the
  global change would also alter what the importer reads elsewhere: a number
  beside a period line's item in a label column would join its stored label
  (`Épicerie 3`), a carry-over scan and a period's names row would see numbers
  as words, and a number in the person column would be resolved as a name
  instead of being dropped. The detail is the one cell the household types
  freely and the books store verbatim, so the fix is kept to it.
- **What reaches the reader for each kind**, through the real `.xlsx` path
  (render, exceljs, `readSheets`, `readWorkbook`, `--write`), after the fix: a
  number detail `42`, `7` for `007`, a formula cached as 2 `2`, a boolean
  `TRUE` (`api/src/xlsx.ts` already gives it text), and a **date `""`**,
  silently, as on `main`. Elsewhere on `main`, unchanged here and exiting 0: a
  number in the movement's note (`H`) stores no note, a number as a period
  line's item stores no category, a number as its note stores no note, and a
  **number in the person column (`E`) files the row joint** (`person_id` null).
  A number as the bucket is refused, as before. None of these is in this
  ticket's Build; they are in the builder's report as an open decision.
- **Re-import is a refusal, not a conflict, a duplicate or silence.** Books
  that already hold an import are refused whole by `alreadyHeld` in
  `api/src/workbook-import.ts` before the rows are placed (exit 1, "The books
  already hold 2 closed periods…", "Refused: nothing was written."), with the
  detail as `""`, as `42`, or as before, both on `main` and after the fix; the
  stored `description` stays `""`. A paste never compares a description against
  a workbook row (`source <> 'workbook'` in `api/src/statements.ts`), so a paste
  does not see it either. So books written with the defect keep the empty
  description, and a stored row is never edited; whether any household's books
  were written with it is not measurable from here (lg-37's dry run of the real
  workbook is still owed).
- **Fold-in:** none. The other cells above are not specified anywhere, and lg-66
  is a build, not a small piece.
