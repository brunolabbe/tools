---
id: lg-37
tool: ledger
title: The workbook import refuses the real workbook, whose layout lg-7 guessed wrong
kind: fix
status: done
milestone: null
depends_on: [lg-7]
awaiting: the owner's dry run of npm run import:ledger on the merged code against the corrected workbook, reading no problems (Done when 6)
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

## Review

**Gate: FAIL** — 2026-10-17 · `20566d03..68499e63` · Sonnet 5.5, depth medium

No `high`. FAIL is the rule's, for two unproven rows: one clause of Done when 5 (a one-assertion fix) and Done when 6 (a real-data line; open decision A below). The base is the branch's merge-base; `origin/main` has since moved to `4dbe22b8` (#527) and touches none of the files under review.

| Done when                                                                                                          | Proof                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. A period sheet with its summary above the lines is read: lines from row 8 only, total checked, payer and amount | `books/test/workbook.test.ts` › "a period's summary above its lines is read: its total checked, its deposit's version told" (asserts line rows `[8, 9]`, the total's `checks` sentence, each settlement's payer, recipient and cents) and › "a summary total the lines do not make is refused" ✓ |
| 2. A v1 deposit through an `Équivalence` row is v1, a v2 one is v2                                                 | same first test: `$ (A)` reads `v1`, `$ (B)` reads `v2`; reverting `arithmeticOf` and swapping `/`/`*` precedence each turn it red ✓                                                                                                                                                             |
| 3. A year sheet's summary above its movements is not a problem; the same figure below a movement still is          | › "a year's summary above its movements is not money; the same figure below one is" (exact `problems` list plus the imported row, so it cannot pass on an empty reading) ✓ — a corner outside the line is F1                                                                                     |
| 4. Accueil salaries from the labelled row, not a calculator; a second `Salaires` row refused, so is a missing one  | › "Accueil's salaries are the labelled row, never the figures under its calculators' headings" and › "a second Salaires row, or none, is refused" (exact messages for both) ✓                                                                                                                    |
| 5. Overlapping periods refused, closed or open; touching ones accepted                                             | › "periods that overlap are refused; one may start the day the last ends" proves overlap closed and open, and touching **closed**. **unproven** for the clause "touching, open period": see F2                                                                                                   |
| 6. Run against the owner's corrected workbook, the reader reports no problems                                      | **unproven** — real data never enters the repo, so no test can hold it, and the Log's out-of-repo run (0 problems, 19 checks) is a claim the gate cannot reproduce. Open decision A below                                                                                                        |

- **med** · Done when 5 depends on it · **F2 — an open period starting on the day the newest closed one ends is accepted, and nothing asserts it.** Mutating the open-period check in `orderPeriods` from `<` to `<=` leaves the books spec at 18 of 18; the touching case in the test uses two closed sheets. Current behaviour is right (probe: open `$ (B)` starting `2022-08-31` after `$ (A)` ending `2022-08-31` reads clean); the ticket says the real sheets share that boundary day, so the open sheet is the likeliest to hit it. Fix: a third reading in the same test, with an open period starting on the closed one's end, asserting no `overlap` message.
- **med** · no `Done when` line depends on it · **F1 — a year sheet's "summary" skip can swallow a real movement, silently, and the `D` half of it is unneeded and untested.** `isSummary` skips an undated row with an amount when `C` _or_ `D` merely **starts with** `solde` or `total`, above the first dated row. `D` is the free-text detail. A newest-year row whose date is typed as text and whose detail starts "Solde…" or "Total…" is dropped with no problem: probe grid `2026` = [`"2026-10-17"` as text, `Hypothèque`, `Solde de tout compte`, `Sam`, 800, 300], header, one dated row → `problems: []`, movements `[row 3]` only. Control, same row with detail `Versement` → `2026!B1: an amount with no date.` In an earlier year the next `Solde reporté` check catches it (300.00 unexplained); in the newest year nothing in the reader does (whether the importer's placement against stored pastes would is unmeasured). The Log says the real 2025–2026 block (`D` label, `F` figure) "was never a problem because the reader reads amounts only from `G`", so the `D` clause serves no row of the real file; dropping it leaves the books spec at 18 of 18 (no test needs it). **Open decision B, two remedies:** (a) recommended: read `C` only. Run on the found inputs: the `Solde de tout compte` and `Totalité du prêt` details become `an amount with no date`, the spec stays 18 of 18, and a bucket cell `Total reçu` is still skipped (it is not a movement shape either way). (b) keep both columns and reconcile each summary figure with the rows it restates, which the Log declines to do and which needs the real file's formulas, so it is unmeasured. Premises: a date typed as text and a detail starting `Solde`/`Total` have not been seen in the real file; both are the condition.
- **low** · **F3** · `SAME_SHEET_CELL` in `arithmeticOf` · no live call site. Enumerated against 21 formulas: absolute, mixed and relative refs, `LOG10(`, `ATAN2(`, `BIN2DEC(`, `1E3`, sheet-qualified refs and a name like `TAUX2` are all right. Two false matches: a cross-sheet range's second endpoint (`SUM(Accueil!B2:C2)-D3` reads this sheet's `C2`) and a cell-like token inside a quoted sheet name (`'$ (A2)'!B2`). The first changes a verdict: with `C2 = D5/2` on the sheet the formula is read as **v1** where its own text is neither (control, `C2` without a formula: refused as neither). Misses are harmless (lower case never occurs in a saved file; whole-column and 3-D refs are refusals, not misreads). Its two guards, the lookbehind and the lookahead, are unasserted: removing either leaves the spec at 18 of 18. Direction, not a remedy: add a `:` to the lookbehind and one reading per guard.
- **low** · **F4** · `nfr:maintainability` · the total-mismatch problem still names row 8 (`'$ (A)'!C8: alex's lines add up to 120.00, but the sheet's total says 125.00.`), the first line, though the `Total` now sits in rows 2 to 4; the new test pins that cell. Loud and wrong only in where it points, so it is false in the safe direction.
- **low** · **F5** · Build step 1's "a summary row below the lines still ends them" is asserted by nothing: never setting `ended` (either site) leaves the spec at 18 of 18, and the api fixtures end on the `Montant à déposer` row, so nothing can fail on it. No `Done when` line names it.
- **dropped** · rows 2–7 producing spurious totals or settlements on lg-7's layout: in the fixtures I read (books `period()` and the api helper) the only text in rows 2–7 is row 6's `Du`/`au` and row 7's `Item`/`Note`, none starting with `total` or `montant`. A stray `Total` label there is overwritten by the sheet's own `Total` below (last wins), and stray `Montant à déposer` text is refused loudly, never read silently. No live call site.
- **dropped** · a summary both above and below the lines: the later row wins, and a mismatch is reported (probe). Not a defect.
- **dropped** · Accueil: a column the nearest name row does not cover keeps an older head, so a number there could be mis-attributed. Every case I built was refused loudly (`a second salary for …`, or `0 salaries`); a swapped second name row reads correctly (sam 40000, alex 60000); a `Salaires nets` row and figures on the row below the label are refused. A name-row reset is not needed.
- **dropped** · the overlap rule against the "same day" and "not the newest" checks: nested, same-end, open-inside and three-in-a-row cases all report once per real overlap, with no double report beyond "end on the same day"; adjacency in end order cannot miss an overlap (argued in the full report).
- **dropped** · the regex as a ReDoS risk: bounded quantifiers, 17.6 ms worst of four hostile 100–200k-character inputs.
- **findings** · the hunt returned 10; 5 carried (F1, F2, three low), 5 dropped.
- Invariants walked: no cross-tool import; no `AppError` raised or needed (problems are collected); no shell, URL, header or progress code touched; no real data in the diff (invented names and figures; structural labels only); new tests sit at the end of an existing registered suite; no workspace or Dockerfile change. Style rules hold (`npm run check` exit 0).
- NFR: security n/a (cell text only; regex linear) · performance n/a · reliability F1, F2 · maintainability the three lows above.

**Open decision A (Done when 6).** Options: (a) recommended, treat the line as `awaiting`: the owner's dry run of `npm run import:ledger` on the merged code against the corrected workbook, reading "no problems"; and say in the Log that any fix round touching `books/src/workbook.ts` voids the earlier out-of-repo run, so it is repeated on the final head. (b) leave it `unproven` and have the owner paste the run's report into the Log before the merge. The ticket already says `status: done`; the gate does not move it.

**CI** at `68499e63`: `test (ubuntu-latest)`, both `check`, `docker`, `CodeQL`, `codeql` and `dependency-review` pass; `test (windows-latest, informational)` was pending when read. No `Done when` line rests on any of them.

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
- 2026-10-17, after gate 1 (FAIL, no `high`): every finding was fixed in one
  round, and each fix was proven by a mutation that turns its test red.
  - F1: `isSummary` reads `C` only. A detail in `D` that starts with
    "Solde…" on a row with an unreadable date is now an amount with no date,
    as it should be (remedy (a); decision B had a recommended, reversible
    option, so it was taken).
  - F2: the overlap test adds an open period starting on the day the newest
    closed one ends, and asserts no overlap.
  - F3: the same-sheet reference skips a range's far end (`:`). A test pins
    the `!` and `:` guards.
  - F4: a total mismatch names the `Total` row's cell, not row 8.
  - F5: a test proves a summary row below the lines ends them.
  - Decision A was taken as (a): Done when 6 is `awaiting`. The dry run was
    repeated outside the repository on the fixed head, and every verification
    held. It is repeated by the owner on the merged code.
