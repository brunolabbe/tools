---
id: lg-68
tool: ledger
title: A workbook's free-text cells drop a number or a date instead of keeping it
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-68 — A workbook's free-text cells drop a number or a date instead of keeping it

## Why

The household's own `npm run import:ledger` (lg-7, lg-37) reads a year sheet's
`D` column, the movement's free-text detail, and stores it as the row's
`description`. When that cell holds a number, the stored description is `""`.
The command exits 0, and its report is identical, line for line, to the run
where the cell holds text, so nothing tells the household the detail is gone.
A detail typed `007` in Excel is saved as the number 7 and is lost the same
way, and so is a formula whose cached result is a number. The same loss
reaches the other free-text cells the import reads, which this ticket now
covers: a movement's note and a period line's note, a detail holding a date,
and the person column.

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
3. _Round 1, the owner's answers of 2026-10-24 (the Log):_ that reader,
   `freeTextOf`, reads a date as its ISO day (`2022-01-05`), and it also reads
   a movement's note, a period line's note and the person column. A number or
   a date in the person column is then a name nobody holds, refused naming the
   cell, where `main` filed the row joint. A period line's item stays on
   `textOf`: its label is joined from every column left of the amounts, so a
   number there would join it (`Épicerie 3`).

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

Round 1. The tests are in `books/test/workbook.test.ts` or
`api/test/workbook-import.test.ts`, under _a free-text cell that holds a number
or a date (lg-68, round 1)_, and each fails on the reader before round 1 except
6, which pins a case round 0 already fixed:

5. books, _a detail holding a date is read as its ISO day_: a date detail reads
   `2022-01-05`, with no problem reported.
6. books, _a detail holding a formula is read as its cached number_: `=1+1`,
   cached as 2, reads `2`.
7. books, _a movement's note holding a number or a date is read as its text_:
   notes 42 and a date read `42` and `2022-01-05`, beside a text note and none.
8. books, _a period line's note holding a number or a date is read as its
   text_: a period line's notes 42 and a date read `42` and `2022-05-03`, its
   items unchanged.
9. books, _a number or a date in the person column is refused, naming the
   cell_: `2022!E2 names "42"` and `2022!E3 names "2022-01-05"` are reported,
   and only the third row is read as a movement.
10. api, _a date detail, and a number or a date in either note, are stored as
    their text_: through the `.xlsx` path with `--write`, a date detail is
    stored as `2022-01-05`, a movement's notes as `42` and `2022-01-12`, and a
    period line's note as `2022-05-03`.
11. api, _a number in the person column refuses the import, naming the cell_:
    exit 1, the report names the cell (`2022!E10 names "42"`), and nothing is
    written.

## Review

**Gate: PASS** — 2026-10-24 · `972ab6a0..64c6a9f0` · Sonnet 5.5, depth standard

| Done when                                                                    | Proof                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A numeric detail reads as the number's text (42, 7, -3.5, 0.3)            | `books/test/workbook.test.ts` › "a detail cell that holds a number (lg-68)" › "is read as the number's text, never as an empty detail" ✓ — asserts the five details and an empty `problems`. Red on the base reader.                                  |
| 2. Through `.xlsx` with `--write`, the number 42 is stored as `42`           | `api/test/workbook-import.test.ts` › "a detail cell that holds a number (lg-68)" › "is stored as the number's text, not as an empty description" ✓ — exit 0, stored `[{ description: "42" }]`. Red on the base reader.                                |
| 3. A re-import onto books holding the defect's `""` is refused, tables equal | same describe › "a re-import onto books that already hold the import is refused, whatever the detail" ✓ — exit 1, the `alreadyHeld` sentence, `Refused:` line, `dump` equal, `""` kept. Green on the base too: it pins an existing refusal.           |
| 4. `npm test -- --project ledger` passes, no existing test changed           | **verified** — 1687 of 1687 in 81 files, `npm run check` exit 0; the test diff only adds (its four deleted lines are field types in `api/test/helpers/workbook.ts`, widened to `string \| number \| Date`).                                           |
| 5. A date detail reads as its ISO day                                        | `books/test/workbook.test.ts` › "a free-text cell that holds a number or a date (lg-68, round 1)" › "a detail holding a date is read as its ISO day" ✓. Red on the round-0 reader.                                                                    |
| 6. A formula detail reads as its cached number                               | same describe › "a detail holding a formula is read as its cached number" ✓ — `["2"]`. Green on the round-0 reader (pins); red on the base.                                                                                                           |
| 7. A movement's note holding a number or a date reads as text                | same describe › "a movement's note holding a number or a date is read as its text" ✓ — `[null, "marché", "2022-01-05", "42"]`. Red on the round-0 reader.                                                                                             |
| 8. A period line's note holding a number or a date reads as text, items kept | same describe › "a period line's note holding a number or a date is read as its text" ✓ — labels and notes asserted together. Red on the round-0 reader.                                                                                              |
| 9. A number or a date in the person column is refused, naming the cell       | same describe › "a number or a date in the person column is refused, naming the cell" ✓ — both `names` sentences and movement row 4 only. Red on the round-0 reader and with only the person line reverted (positive control).                        |
| 10. A date detail and either note are stored as text through `.xlsx`         | `api/test/workbook-import.test.ts` › "a free-text cell that holds a number or a date (lg-68, round 1)" › "a date detail, and a number or a date in either note, are stored as their text" ✓ — three tables' rows asserted. Red on the round-0 `dist`. |
| 11. A number in the person column refuses the import, naming the cell        | same describe › "a number in the person column refuses the import, naming the cell" ✓ — exit 1, `2022!E10 names "42"`, `Refused: nothing was written.`; I measured that no books file exists afterwards. Red with only the person line reverted.      |

CI at `64c6a9f0`: every check pass, the Windows leg (informational) and `test (ubuntu-latest)` included.

- **low** · no `Done when` line depends on it · `nfr:reliability` — a date-typed cell that is not a calendar day reaches the description as an invented date. A time-only detail (`14:30`, serial 0.604) is stored `1899-12-30`, where `main` stored `""`; serials 1 to 59 on a date format read one day early (`7` → `1900-01-06`, `59` → `1900-02-27`, from exceljs's own date conversion, which `api/src/xlsx.ts` passes through). No fixture holds either, and TZ and the 1904 system are clean (below), so it needs a household that types a time into a free-text cell. **Open decision** (answer 3 named dates, not times): (a) leave it; (b) `readSheets` yields no date for a time-only cell, so the cell is a reported problem or stays empty; (c) read it as `HH:MM`, which needs a new cell kind. Recommendation: (a) until the lg-37 dry run shows a time in a real workbook, then (b). Direction, not run.
- **low** · no `Done when` line depends on it · `nfr:reliability` — `String(Number(n.toPrecision(15)))` is exact for Excel-authored cells, and can change what the file holds when another producer wrote it: `4111111111111111` stores `4111111111111110` (an exact double, 16 digits), `9007199254740993` stores `9007199254740990`; `1e21` stores `1e+21` and `1e-7` stores `1e-7` (exponent form below 1e-6 and from 1e21); `-0` stores `0`; a percent or currency format loses its sign (`50%` stores `0.5`). Build 2 accepts the 15 digits and the missing format; the 16-digit loss and the exponent form are not named there. No live call site: an Excel entry already zeroes past 15 digits (not measured here, no Excel).
- **low** · no `Done when` line depends on it · `nfr:maintainability` — a period line's item stays silent for a lone number: `A8 = 42` stores `category null`, exit 0, and `B8 = 3` beside a text `A8` is dropped. Owner answer 2 left the item alone for the joined-label reason, which holds only when text is also present; the lone-number case is the same cell and the answer covers it. Recorded, not a defect of the build. It is the only remaining call site of `textOf` where a number or a date is dropped without a message (the other seven are a label match, a bucket (refused as `""`) or a name that has to match).
- **low** · no `Done when` line depends on it · `nfr:maintainability` — the ticket's `title:` and Why still name only the detail cell, while Build 3 and `Done when` 5 to 11 carry the notes, the date and the person column. Safe direction: the PR is retitled at landing (answer 6); the lander may reword the ticket's title the same way. `status` stays `ready` until the lander moves it.
- **dropped** · the follow-on running-balance and carry-over failures after a refused person cell: the same two lines follow any unmapped name on `main`, and the cell-naming sentence is the first of the report. Not a defect of this diff.
- **dropped** · a number in the bucket column is refused as `"" is not a bucket`, naming the cell: loud, unchanged, outside the diff.
- **dropped** · the corrections file's `people` map: `{ "42": "sam" }` and `{ "2022-01-05": "sam" }` and `{ "0.3": "sam" }` all import with no problem (measured), so the refusal's remedy works.
- **dropped** · timezone and the date systems: the ISO day is identical under `America/Montreal`, `UTC` and `Pacific/Kiritimati`, at 00:00:01, 12:00, 23:59:59.999, across both DST edges and at the year boundary, in the 1900 and 1904 systems. Not a defect.
- **findings** · the hunt returned 8; 4 carried (the first bullet merges the time-only and the early-1900 mechanisms), 4 dropped.
- NFR: security n/a (no URL, header or subprocess; the refusal echoes the user's own cell to their terminal as the text path does) · performance n/a (constant work per cell) · reliability ✓ except the first two bullets · maintainability — above.

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
  fixture tells the two scopes apart. Through the `.xlsx` path with that same
  global `textOf`, it changes what the import reads elsewhere: a number 3 in
  `B8` beside a period line's item `Épicerie` is stored as the category
  `Épicerie 3`; a number in the person column is refused as a name not in the
  household (`2022!E10 names "42"`) where `main` files the row joint; a number
  note is stored; a number as a bucket is refused naming `"42"` rather than
  `""`. The carry-over scan, a period's names row and Accueil's rows would also
  see numbers as words, harmlessly in the fixture. The detail is the cell this
  ticket is about, so the fix is kept to it.
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
- **After the fix**, `npm test -- --project ledger`: 1680 of 1680 passed in 81
  files, the three tests above among them; `npm run check` exited 0.
- **Fold-in:** none. The other cells above are not specified anywhere, and lg-66
  is a build, not a small piece.

**2026-10-24 — round 1: the owner's three answers (lg-68's builder).** The
builder's report put three open decisions; the owner answered each on
2026-10-24, and each answer took the builder's recommendation.

- **A. Other cells that drop a number while the import exits 0** (the person
  column, the movement's note, a period line's item and its note). Options:
  "Round on lg-68 now", "File a ticket for them", "Leave them". Chosen: **"Round
  on lg-68 now"**, as put to the owner: read the movement's note and the period
  line's note through the detail's reader; refuse a number in the person
  column, naming the cell; leave the period item alone, because reading it
  would join numbers into labels (`Épicerie 3`).
- **B. A date in a detail cell.** Options: "Its ISO day", "A reported
  problem", "Leave it empty". Chosen: **"Its ISO day"**: stored as
  `2022-01-05`.
- **C. Books already written with the defect.** Options, as the report put
  them: the owner confirms no `--write` has run on real books and nothing more
  is needed, or, if one has, a correction ticket is filed. Answered **"No,
  never written"**:
  `import:ledger --write` has never run on the household's real books, so
  nothing more is needed. That stands beside the measurement above: a
  re-import onto written books is refused whole by `alreadyHeld` (exit 1,
  nothing written), so it could not have repaired them, and does not need to.

What round 1 built and measured:

- **One reader.** `detailOf` is renamed `freeTextOf`, since it now reads more
  than the detail: a number as its 15 significant digits, a date as its ISO
  day (the `date` the `.xlsx` reader already gives, `yyyy-mm-dd` from the
  cell's UTC day), anything else through `textOf`. **The two notes read a date
  the same way as the detail**, the same reader and rule: a note is free text
  stored verbatim as the detail is, and nothing measured says otherwise
  (`kinds.mts`, below, and 1687 of 1687 tests).
- **The person column reads through it too, so a date there is refused
  with a number.** The owner's answer named a number; on `main` a date in that
  column files the row joint the same way (`kinds.mts` before round 1: exit 0,
  `"person_id":null`), and reading it through the same reader refuses it with
  the same message. This is the one point the builder settled beyond the
  answer, and it is in the report.
- **Failing first**, commit `67296d34`: against the round-0 reader (`books`
  rebuilt, `freeTextOf` absent from `dist`), 6 of the 7 new tests failed
  (`expected [ 'Versement', '' ] to deeply equal [ 'Versement', '2022-01-05' ]`,
  `expected [ null, 'marché', null, null ] …`,
  `expected [ [ 'Épicerie', null ], …(1) ] …`, an empty problem list for the
  person column, and both api tests); the formula
  test passed, as round 0 already read a formula's cached number.
- **`kinds.mts`** (render, exceljs, `readSheets`, `readWorkbook`, `--write`),
  before round 1 and after, on each cell it changes:

  | cell                          | before                   | after                                 |
  | ----------------------------- | ------------------------ | ------------------------------------- |
  | detail `D`, a date            | exit 0, `description ""` | exit 0, `description "2022-01-05"`    |
  | note `H`, 42                  | exit 0, `note null`      | exit 0, `note "42"`                   |
  | note `H`, a date              | exit 0, `note null`      | exit 0, `note "2022-01-05"`           |
  | person `E`, 42                | exit 0, `person_id null` | exit 1, `2022!E10 names "42"`         |
  | person `E`, a date            | exit 0, `person_id null` | exit 1, `2022!E10 names "2022-01-05"` |
  | period line note `E8`, 42     | exit 0, `note null`      | exit 0, `note "42"`                   |
  | period line note `E8`, a date | exit 0, `note null`      | exit 0, `note "2022-05-03"`           |
  | period line item `A8`, 42     | exit 0, `category null`  | unchanged                             |

  Every other case (the control, a number, `007` and a formula as the detail,
  a boolean detail, a number as the bucket, a number beside the item in `B8`)
  printed the same before and after.

- **After round 1**, with `books` rebuilt: `npm test -- --project ledger`, 1687
  of 1687 passed in 81 files.

**2026-10-24 — gate 1 and the owner's answers at landing (lg-68's lander).**
Gate 1 returned PASS at `64c6a9f0` with four lows and one open decision. The
owner answered on 2026-10-24:

- **Time-only and early-1900 date cells** (gate 1's first low, its open
  decision). Options: "Leave it for now" (the gate's recommendation),
  "Time-only reads empty" and "Read it as HH:MM". The owner chose **"Leave it
  for now"**, which took the recommendation. No code changes; a fix is filed
  if the lg-37 dry run shows a time typed in a free-text cell.
- **The other three lows.** Options: "Title/Why at landing" or "Record all
  three". The owner chose **"Title/Why at landing"**; the dispatch did not
  say which option was recommended, so whether it took the recommendation is
  unrecorded. The title and Why low is fixed at landing, below. The
  number-rendering low and the period-item low stay in the gate's record as
  written.
- **The pull request title**, already decided, retitled #626 to:

  > fix(ledger): keep a number or date in a workbook's free-text cells instead
  > of dropping it (lg-68)

- 2026-10-24 — Fixed at landing by owner choice: gate 1, the fourth low —
  "the ticket's `title:` and Why still name only the detail cell, while Build 3
  and Done when 5 to 11 carry the notes, the date and the person column". The
  `title:` and the H1 now name the free-text cells, and the Why gains one
  sentence naming the notes, a date detail and the person column. No Done when
  line, code or test changed.
  `awk '/^## Log/{exit} {print}' tools/ledger/docs/work/lg-68-a-detail-cell-holding-a-number-is-stored-empty.md | grep -c "other free-text cells the import reads"`
  → 1, and the same scoped count of "stored as an empty description by the
  workbook import" → 0.
