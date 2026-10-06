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

## Review

**Gate: CONCERNS** — 2026-10-06 · `056aab7..7b3010d` · Sonnet 5.5, depth medium

| Done when                                                                                                                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The whole-page reproduction parses to the same rows as the fixture alone, and fails on `origin/main`                                                                                                                                                  | `tools/ledger/books/test/statement.test.ts` › "parseStatement on a month with no rows and the page's footer › reads the whole page to the same rows as its three months alone" — `toEqual` on the two `.rows` arrays; an earlier test in the file asserts the fixture alone reads 12 rows, so two empty arrays cannot satisfy it, and "reads the footer on its own, and an empty month on its own" asserts 12 rows for each half. **proven.** Red against `056aab7`'s `statement.ts` (below); my own second-method run is in the premise checks.                |
| 2. A wrong footer count is `STATEMENT_MONTH_COUNT_MISMATCH` naming its line and both counts; a footer that is not last, a footer showing more months than it has, and `Aucune transaction` outside an empty month are each `STATEMENT_UNRECOGNIZED_LINE` | "a footer that counts another number of months fails, naming both counts" (asserts `code`, `retryable: false`, and `details` `line`/`shownMonths`/`pastedMonths`); "a footer that is not the last line fails at the footer" (code and line); "a footer showing more months than there are fails" (code only, but goes red when the guard is removed); "no rows, outside any month, fails at that line" and "no rows, in a month that has some, fails at that line" (code and line). **proven**, with one path of the last clause unasserted: see the med below. |
| 3. The new code answers 422                                                                                                                                                                                                                              | `tools/ledger/api/test/http-errors.test.ts` › "the ledger's statement error codes › STATEMENT_MONTH_COUNT_MISMATCH answers 422 and carries its details" (`status` 422, `retryable: false`, `details` carried). **proven.** Both it and the `LEDGER_ERROR_CODES` "does not answer 500" sibling go red with the `http-errors.ts` line removed (2 failed, 19 passed of 21).                                                                                                                                                                                        |
| 4. `npm run check` and the ledger suite pass                                                                                                                                                                                                             | **verified.** `npm run check` exit 0 at the head (oxlint, `oxfmt --check`, `tsc --build`; the lint warnings are in downloader, planner and `scripts/`, none in ledger). `npm test -- --project ledger`: 28 of 28 files, 403 of 403 tests. At the base the same project is 392 of 392 once one artifact is set aside (below), so the branch adds 11: 9 in `statement.test.ts`, 2 in `http-errors.test.ts`. PR #377 at `7b3010d`: `check`, `docker`, `test (ubuntu-latest)`, `codeql`, `pr-title` pass.                                                           |

Reading the 392: the base run showed 392 passed and 1 failed of 393. The one failure is
`STATEMENT_MONTH_COUNT_MISMATCH has a status line and does not answer 500` — base's
`http-errors.ts` run against the `contract/dist` I had built at the head, which already
holds the new code. That is my harness, not the base. No test file in the diff has a
deletion or a reworded assertion: the test diff is additions only, plus one name in
`STATEMENT_CODES`.

**Premise checks**

- **(a) Reproduces on main, fixed on the branch — confirmed.** A scratch harness imports
  each `statement.ts` with `@ledger/contract` pointed at the built `dist`. The whole-page
  text is `Octobre 2026` / `Aucune transaction` / blank, then `three-months.txt`, then
  `4 mois sur 12`.
  - `056aab7`: `STATEMENT_UNRECOGNIZED_LINE`, line 2, `not a row, a header or a total`.
  - Line 2 removed: `STATEMENT_TOTAL_MISMATCH`, line 1, `has no Total line`.
  - Empty month removed, footer kept: `STATEMENT_UNRECOGNIZED_LINE`, line 82,
    `a row outside any month`.
  - Fixture alone: 12 rows. All four match the ticket's account of them.
  - `7b3010d`: 12 rows. The second method is a `JSON.stringify` comparison of the branch's
    whole-page rows against the fixture parsed by **main's** parser: `true`, 12 rows.
  - Positive control: the same harness produced all four failures on main, so it can
    produce the failure it was looking for.
  - The branch's own 9 new tests against main's `statement.ts` (the 62-test file, scratch
    copy): 6 red, 3 green. The 3 green are "a footer showing more months than there are
    fails", "no rows, in a month that has some, fails at that line" and "no rows, outside
    any month, fails at that line": refusals main already makes through another path. The
    Log's "6 of the 9" holds, and so does its account of the other 3.
- **(b) The count counts empty months — confirmed.** On the branch, `Octobre 2026` /
  `Aucune transaction` / `1 mois sur 12` parses to 0 rows. With `2 mois sur 12` it is
  `STATEMENT_MONTH_COUNT_MISMATCH` (`shownMonths: 2`, `pastedMonths: 1`). A mutant that
  stops counting an empty month turns 2 of the 9 new tests red (the whole page, and the
  footer-on-its-own test). The Log's cost note holds as well: the
  fixture plus `2 mois sur 12` is refused although every month in it proves. An empty month
  in the middle of a paste also reads: 12 rows, count 4 right and count 3 refused.
- **(c) The new code follows `tools/ledger/CLAUDE.md` — confirmed.** It sits in
  `LEDGER_ERROR_CODES` with its `DEFAULT_ERROR_MESSAGES` entry (`Record<ErrorCode, string>`
  forces that one) and its `422` in `STATUS_BY_CODE`, in one commit. Over HTTP, through
  `createApp` and `POST /api/statements` (scratch test): the whole page answers 200, and
  the same text with `5 mois sur 12` answers 422 with `STATEMENT_MONTH_COUNT_MISMATCH`.
  The consumers I enumerated: `grep -rn STATEMENT_` over `tools/ledger` finds `api/src/statements.ts`
  (raises its own three store codes and does not switch on the parser's), `web/src` (none:
  `StatementPaste.tsx` shows `AppError.from(error).message` and never reads a code, and
  parses with the same `@ledger/books`), and the contract's `ERROR_CODES` feeding the
  response `z.enum`. Nothing switches on statement codes, so nothing misses this one.
  A zero-row parse (a page of only empty months) is refused by the API as `BAD_REQUEST`
  and by the UI as "no statement rows": read in `importStatement` and `StatementPaste.tsx`,
  not run, and unchanged by this diff.
- **(d) Only synthetic text — confirmed.** I scanned every added line of the diff for
  amounts, numbers of four digits or more, `@`, `http`, `Caisse` and `Desjardins`. The hits
  are the fixture's own synthetic `Total` amount (`1 200,00 $`, referenced by two tests and
  unchanged) and prose. The fixture is untouched (`git diff --stat` over `test/fixtures`
  is empty), and the commit message carries no row.

**Findings**

- **med** · no `Done when` line depends on it, on the reading that clause 2 says "outside an
  empty month" and a second `Aucune transaction` sits inside one. Build step 1 says
  "anywhere else", which is the other reading, and the recommendation is to add the
  assertion either way: it is one test. · A second `Aucune transaction` under a month that
  the first already closed is correctly refused but nothing asserts it. Reproduction: at
  `7b3010d`, `parseStatement("Octobre 2026\nAucune transaction\nAucune transaction\n")` is
  `STATEMENT_UNRECOGNIZED_LINE` at paste line 3. With `|| month.totalSeen` removed from the
  `Aucune transaction` branch in `books/src/statement.ts`, it parses to 0 rows and the
  62-test `statement.test.ts` stays 62 of 62 green (mutation run in a scratch copy: 9
  mutants in all, the unmutated control 62 of 62). The test that names "outside any month" reaches the
  `month === null` path and the trailing-after-a-month-with-rows path only, and the second
  of those still fails on the `rows > 0` guard, which is why it does not notice. The `why`
  text for this path, `a month with no rows, outside any month`, reads wrongly for a
  second `Aucune transaction` inside an empty month. Fix: a test for the text above, `code`
  and `line: 3`. Block of its own at the end of the new `describe`. **Fixed:** the branch now checks `month.totalSeen` on its own, with the why `a month with no rows, said twice`, and the new test "no rows, said twice under one month, fails at the second" asserts the code, `line: 3` and the text. Removing the check turns it red (1 of 65).
- **low** · `nfr:reliability` — the `requireTotal(month)` call inside the footer branch is
  not asserted. Removing it leaves 62 of 62 green, because the call after the loop raises
  the same `STATEMENT_TOTAL_MISMATCH` whenever the count is right. It only decides which
  code wins when the last month is unclosed **and** the count is wrong, which Build step 2
  fixes as "closed first". A test: the fixture without its last `Total`, plus a wrong
  count; expect `STATEMENT_TOTAL_MISMATCH`, not `STATEMENT_MONTH_COUNT_MISMATCH`. **Fixed:** the existing footer-after-no-Total test now carries `4 mois sur 12`, so both checks fail and `STATEMENT_TOTAL_MISMATCH` must win. Removing the early `requireTotal` turns it red.
- **low** · Build step 1 says `Aucune transaction` is folded for case, accents and spacing,
  and step 2 the footer too. Every occurrence in the new tests is spelled `Aucune transaction`
  or `N mois sur M`. Making the footer match case-sensitively (a mutant) leaves 62 of 62
  green. By direct run the folding works (`aucune<NBSP><NBSP>TRANSACTION` and
  `3<NBSP>mois<NBSP>sur<NBSP>12` parse), so this is an assertion gap, no defect. **Fixed:** a test reads `aucune  TRANSACTION` and `4 MOIS sur 12` (U+00A0 and U+202F) to 12 rows. Without `fold`, 9 of the new tests go red, this one included.
- **low** · comments that will mislead the next reader: `requireTotal`'s doc in
  `books/src/statement.ts` still says a month "must end in a `Total` line", and an empty
  month now ends without one; and the header comment of `contract/src/errors.ts` has
  grown into one run-on line far past the file's wrap width. **Fixed:** both comments rewritten.
- **low** · the Log says an empty month between two that have rows cannot be tested without
  an out-of-order month. It can: `Juin 2026` / `Aucune transaction` spliced before the
  `Août 2026` header reads 12 rows with `4 mois sur 12` and is refused with `3 mois sur 12`
  (both run), because the parser never checks month order. The behaviour is right; only
  the Log's reason for not testing it is not. **Fixed:** the test was added (`Juin 2026` spliced in: 12 rows at count 4, refused at 3), and the Log is corrected.
- **dropped** · a 100,000-digit footer yields `shownMonths: Infinity` (`null` in JSON). No
  live call site: a real footer is one or two digits, and it is refused as a mismatch.
- **dropped** · `Aucüne transaction` is accepted by the accent folding. That is Build step 1
  as written.
- **dropped** · the Log's two numbers about the owner's private paste (17 rows; its footer
  edited to `2 mois sur 12` and refused) against the no-real-bank-data rule. They are the
  result of a parse, with no description, amount, balance, date or caisse in them, and I
  read the rule as about the data. If the owner reads it more strictly the two numbers can
  go; that is a product decision, not a defect.
- **dropped** · `0 mois sur 12` as the whole paste parses to 0 rows. Empty text did on main;
  the API and the UI both refuse zero rows.
- **findings** · the hunt returned 9; 5 carried (1 med, 4 low), 4 dropped.
- **unverified** · the Log's account of the owner's real paste (17 rows read; refused with
  the footer edited) is not reproducible: the paste is outside the repository and I
  did not have it. The premise it supports, that AccèsD's footer counts an empty month, is
  therefore exercised only by the ticket's synthetic `4 mois sur 12`, built to fit. If it
  were wrong the check would refuse a good paste loudly, naming the line and both counts,
  never silently. The `test (windows-latest, informational)` leg was still pending when I
  read the checks; no `Done when` line depends on it. Owner-side note: the real paste does settle that premise. Its months were October (empty), September and August, and its footer said `3 mois sur 12`.
- Invariants walked: contract edit (the owner's decision is in the ticket, and the code
  arrives with its status in the same change), typed errors (`AppError`, ledger code, not
  core), no real bank data, new tests registered (appended to two existing files; no new
  file or workspace, so nothing for `tsconfig.tests.json` or a `Dockerfile`), style (no
  `any`, no `console`, `.ts` imports). Skipped: no shell, kill-tree, redaction, SSRF, and
  progress, which the diff cannot touch.
- NFR: security ✓ (the new `details` carry a line and two counts, no bank text; a refusal
  stores nothing, because parsing precedes the transaction) · performance ✓ (footer and
  empty-month tests are anchored literals; a 200,000-space line and a 100,000-digit line
  both refuse in under 30 ms) · reliability — the med and first two lows above ·
  maintainability — the comment low above.

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
  - The footer counts an empty month: the real paste's months were October
    (empty), September and August, and its footer said `3 mois sur 12`.
- 2026-10-06 — Gate 1 CONCERNS at `7b3010d`: one med and four lows, every
  one an assertion gap or a stale comment, and all fixed in the commit that
  records it. A second `Aucune transaction` now has a check and a message of its
  own. Each new test was shown to go red under the mutation it guards. The Log
  above once said an empty month between two others could not be tested. It
  can, because the parser never checks month order, and the test is added. Not
  re-gated: nothing was left to decide.
