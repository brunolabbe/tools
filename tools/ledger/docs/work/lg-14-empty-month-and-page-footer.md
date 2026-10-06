---
id: lg-14
tool: ledger
title: A whole-page paste is refused for its empty month and its footer
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-14 — a whole-page paste is refused for its empty month and its footer

## Why

On 2026-10-06 the owner selected the whole AccèsD transactions page, at the
start of a month, and pasted it. The paste was refused, and two of its lines
were ones the parser had never seen, because the lg-1 sample was selected from
the first month header to the last `Total`:

- a month with no rows yet, which AccèsD shows as its header and then
  `Aucune transaction`, with no `Total`;
- the page's footer, `3 mois sur 12`: the months shown, out of the twelve it
  keeps.

Reproduced with synthetic rows. Put `Octobre 2026`, `Aucune transaction` and a
blank line above the lg-1 fixture, and `4 mois sur 12` below it. That fails on
`origin/main` at line 2: `not a row, a header or a total`. Remove only line 2
and it fails on line 1, because the October header has no `Total`. Then it fails
on the footer, `a row outside any month`, because a line starting with a number
is taken for the start of a row. Remove all three lines and the paste reads to
the 12 rows it holds. The owner's real paste behaves the same way. It was run
outside the repository and is not recorded here (`tools/ledger/CLAUDE.md`).
Without those lines its 17 rows, both totals and the chain all prove.

The analysis (§2) says every new shape needs a sample before parsing is written
for it, and this paste is that sample.

## Build

Decided by the owner on 2026-10-06: fix now, strictly, and use the footer's
count as a proof.

1. `books/src/statement.ts`: `Aucune transaction` (case, accents and spacing
   folded) closes the month it sits under, the way a `Total` does. That holds
   only in a month that has no rows yet. Anywhere else it is
   `STATEMENT_UNRECOGNIZED_LINE`, and a row after it is a row outside any
   month.
2. The same file: `N mois sur M` is accepted only as the last non-blank line,
   is checked before the row-start test (both start with a number), and
   requires the month before it to be closed. `N > M` is unrecognised. If `N`
   is not the number of month headers pasted, empty months included, the paste
   is refused with a new code.
3. `contract/src/errors.ts`: `STATEMENT_MONTH_COUNT_MISMATCH`, with its default
   message, and `422` in `api/src/http-errors.ts` in the same change. Neither
   `TOTAL_MISMATCH` (a month's rows) nor `UNRECOGNIZED_LINE` (the line is
   recognised) describes it. `details` carries `line`, `shownMonths` and
   `pastedMonths`.
4. `docs/00-ANALYSIS.md` §2: both shapes.

## Done when

1. The whole-page reproduction above parses to the same rows as the fixture
   alone, and fails on `origin/main`.
2. A footer whose count is wrong is refused as
   `STATEMENT_MONTH_COUNT_MISMATCH`, naming its line and both counts. A footer
   that is not last, or that shows more months than it has, and
   `Aucune transaction` outside an empty month are each
   `STATEMENT_UNRECOGNIZED_LINE`.
3. The new code answers 422.
4. `npm run check` and the ledger suite pass.

## Log

- 2026-10-06 — Built in the session the owner reported it in.
  - **The id is lg-14.** `next-id.mjs lg` named lg-13 as held by PR #368
    (lg-6's follow-up).
  - The new tests are a block at the end of `books/test/statement.test.ts`.
    Against `origin/main`'s `statement.ts`, 6 of the 9 fail. The other 3 are
    refusals `main` already made, by another path, and they stay to keep the
    new paths strict.
  - **A cost of the count check:** a selection that starts at a later month
    header and still takes the footer is refused, although every month in it
    proves. The message says to paste from the first header. A selection that
    stops before the footer is unaffected.
  - The owner's real paste, run outside the repository against the fixed
    parser, read 17 rows. With its footer edited to `2 mois sur 12`, it was
    refused as `STATEMENT_MONTH_COUNT_MISMATCH`.
  - Not covered: an empty month between two that have rows. The fixture's
    months are consecutive, so one cannot be added without inventing an
    out-of-order month. The parser does not check month order, so nothing
    position-dependent stands in the way.
