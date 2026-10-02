---
id: lg-1
tool: ledger
title: Parse an AccèsD paste, and prove it with its own running balance
kind: work-package
status: done
milestone: P2
depends_on: []
difficulty: standard
---

# lg-1 — Parse an AccèsD paste, and prove it with its own running balance

**Packages:** a new `tools/ledger/books`, scoped `@ledger/books` — pure: no
database, no network, no clock.

## Why

Pasting the account's transaction log is how every number enters the tool
([00-ANALYSIS.md §2](../00-ANALYSIS.md)). The format has traps that a parser
written from a guess gets quietly wrong: the year appears only in month
headers, rows on the same day are listed newest first, and the minus sign is
U+2212. It also carries three independent proofs of its own completeness, and
the parser uses all of them.

## Build

1. Create `books` per the `add-tool` skill's step 2–3 (package, tsconfig, root
   references, vitest project). It depends on `@ledger/contract` and
   `@webtools/core` only.
2. `parseStatement(text: string): ParsedStatement`, where each row is
   `{ date, category, description, amountCents, balanceCents, seq }`. `seq` is
   the row's position in the account's history (oldest = lowest), taken from
   the listed order and **never** from sorting by date.
3. Handle, per §2:
   - month headers `<Mois> <yyyy>`, and the column header line;
   - the six-line row: date line, category, description, blank line, amount and
     balance, then the echo line;
   - amounts with U+2212 or `-`, an explicit `+`, a `,` decimal separator, and
     any whitespace (space, U+00A0, U+202F) as the thousands separator;
   - a `Total` line per month.
4. Three checks, each failing with a typed error naming the row:
   - **the chain:** balance = previous balance + amount;
   - **month totals:** the sum of a month's rows equals its `Total` line;
   - **echo lines:** the echo line repeats the row's date, description and
     amount.
5. Anything the parser does not recognise is an error that names the line. It is
   never skipped. The error codes go in `contract/src/errors.ts`, with their
   statuses in `api/src/http-errors.ts` in the same change.
6. Month abbreviations: the sample verified `JUL`, `AOÛ` and `SEP`. Map the
   other nine from the French month names, and match without regard to accents,
   so that `FEV` and `FÉV` both parse.

**Fixtures are synthetic.** Invent caisses, lenders and amounts, keep the shape.
Real bank data never enters the repository; see the tool's `CLAUDE.md`.

## Done when

1. A synthetic three-month paste with a four-row same-day group parses to the
   right rows in the right `seq` order. Tests prove it.
2. One altered balance, one altered month total and one altered echo line each
   fail, with an error naming the row.
3. Amounts parse with U+2212, `-`, `+`, and each of the three whitespace
   thousands separators.
4. An unrecognised line fails with its line number; nothing is silently dropped.
5. `npm run check` and `npm test -- --project ledger` pass.

## Review

### Gate 1

**Gate: PASS** — 2026-10-01 · `b7fb3fb...466771e` (base `b7fb3fb`; `origin/main` still at `b7fb3fb` after fetch) · code-review at medium · coordinates re-resolved at `952c813`

Re-issued unchanged beside gates 2 and 3, every coordinate re-resolved at `952c813`. Three citations whose text the gate-2 round deleted or corrected are now prose naming `466771e`, the sha this section gated: the F2 bullet (the describe-scope parse, removed), the F3 bullet (the months.ts docblock, corrected) and the F4 bullet (the 422 assertion over every ledger code, rewritten).

| Done when                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Three-month paste with a four-row same-day group parses to the right rows in the right `seq` order | `tools/ledger/books/test/statement.test.ts:113 "-500, 197045"` ✓ (the four same-day rows, by seq) · `tools/ledger/books/test/statement.test.ts:68 "toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])"` ✓. The true order differs from all ten sorts tried (amount, absolute amount, description, category, balance, each both ways) and from the unreversed listing                                                                                                                                                                                            |
| 2. Altered balance, month total and echo each fail naming the row                                     | balance `tools/ledger/books/test/statement.test.ts:152 "expectedBalanceCents: 197045"` ✓ · total `tools/ledger/books/test/statement.test.ts:181 "sumCents: -114449"` ✓ (names the Total line and month) · echo `tools/ledger/books/test/statement.test.ts:214 "echoLine: lineOf(text,"` ✓                                                                                                                                                                                                                                                                    |
| 3. Amounts parse with U+2212, `-`, `+`, and each of the three whitespace separators                   | `tools/ledger/books/test/amount.test.ts:6 "U+2212 minus"` ✓ · `tools/ledger/books/test/amount.test.ts:7 "hyphen minus"` ✓ · `tools/ledger/books/test/amount.test.ts:8 "explicit plus"` ✓ · `tools/ledger/books/test/amount.test.ts:10 "a plain space as the thousands separator"` ✓ · `tools/ledger/books/test/amount.test.ts:11 "a no-break space (U+00A0) as the thousands"` ✓ · `tools/ledger/books/test/amount.test.ts:12 "a narrow no-break space (U+202F) as the"` ✓ — the test strings hold the real U+00A0 and U+202F bytes (checked with `grep -P`) |
| 4. An unrecognised line fails with its line number; nothing silently dropped                          | `tools/ledger/books/test/statement.test.ts:293 "toMatchObject({ line })"` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5. `npm run check` and `npm test -- --project ledger` pass                                            | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 100 of 100 in 8 files at `466771e`, against 25 at the base: +75, all in three new files, no existing test file touched                                                                                                                                                                                                                                                                                                                                                                 |

- **low** · The `## Log` first entry, bullet _The tests can fail_, says removing the `ROW_START` guard "fails nothing: it is an equivalent mutant". At `466771e`, deleting that guard line fails 1 of 51 in `statement.test.ts`, on `tools/ledger/books/test/statement.test.ts:296 "not a row, a header or a total"` — the very assertion the same bullet goes on to cite.
- **low** · `nfr:maintainability` — `statement.test.ts` line 61 at `466771e` (`const { rows } = parseStatement(THREE_MONTHS)`, since removed) parses the fixture in `describe` scope, so any regression that makes the fixture throw (measured: `listed.toReversed()` → `listed`) fails the file at collection with `Tests no tests`. The suite still goes red, but the ordering assertions never run and the report names the chain, not the ordering. Moving the parse into each test (or a helper called per test) turns that into assertion failures.
- **low** · `months.ts` line 5 at `466771e` (since corrected) and the Log (_The month abbreviation must agree_) call the nine unverified abbreviations the first three letters of the French name. `JUN` is not (`JUIN` → `JUI`), and neither is the verified `JUL` (`JUILLET` → `JUI`). The code is a reasonable guess and a wrong one fails loudly, naming its line; the comment misstates the rule the next reader will extend.
- **low** · `http-errors.test.ts` line 12 at `466771e` (`expect(status).toBe(422)`, since rewritten) runs over every member of `LEDGER_ERROR_CODES`, so it asserts that every ledger code, present and future, is a 422. True of the four today; the first ledger code with another status fails it. lg-3 as built at `8aeb30a` puts its two codes in core and `git merge-tree` against it is clean, so nothing breaks yet.
- **dropped** · `parseAmountCents` takes any `\s` as a thousands separator: tab, U+2007, U+2009, U+3000, U+2028 and U+FEFF all parse, each to the correct value. The brief asks for any whitespace, and no probe returned a wrong amount, so not a defect.
- **dropped** · error `details` carry the row description, which is bank text, and `toErrorResponse` passes `details` to the HTTP body. No route raises these yet, so whether they reach a log is lg-2 to decide, not this diff.
- **dropped** · dates are not checked to fall newest-first. The brief does not ask for it, and the chain, echo and month-header checks already refuse every reordering that moves money.
- **findings** · code-review at medium (run by hand, no finder subagent) returned 7; 4 carried, 3 dropped.
- NFR: security ✓ (pure, no I/O, synthetic fixture) · performance ✓ (one linear pass) · reliability ✓ (every refusal typed and line-numbered; mutations of chain, total, echo, missing-Total and refusal each fail on an assertion) · maintainability — above.

### Gate 2

**Gate: PASS** — 2026-10-01 · `466771e..7d24bf8` only (one fixer commit, fast-forward; base `b7fb3fb`, `origin/main` still at `b7fb3fb`) · code-review at medium, run by hand · coordinates re-resolved at `952c813`

Re-issued unchanged beside gate 3, every coordinate re-resolved at `952c813`; no line this section cites moved. The first low bullet describes `7d24bf8`, which gate 3 found fixed; its citation stays because it names the CLAUDE.md rule, which is unchanged, not the test that now enforces it.

| Gate 1 finding                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 · Log said the `ROW_START` guard is an equivalent mutant | **fixed** — a correction entry appended to the Log; re-run at `7d24bf8`, deleting the guard fails 1 of 51 on `tools/ledger/books/test/statement.test.ts:296 "not a row, a header or a total"`                                                                                                                                                                                                                                                                  |
| F2 · fixture parsed in describe scope                       | **fixed** as remedied — `tools/ledger/books/test/statement.test.ts:63 "const parseRows = () => parseStatement(THREE_MONTHS).rows"`, called in each of the five tests. With `listed.toReversed()` → `listed`: 7 failed, 44 passed (51), every one reported by name; five fail on the chain AppError thrown inside the body, two on AssertionError. The remedy promised per-test failures, not assertion failures, and the fixer report of the same counts holds |
| F3 · abbreviation rule misstated                            | **fixed** — `tools/ledger/books/src/months.ts:6 "rule is three letters but not simply the first three"`                                                                                                                                                                                                                                                                                                                                                        |
| F4 · 422 asserted of every ledger code                      | **fixed** — `tools/ledger/api/test/http-errors.test.ts:18 "test.each(STATEMENT_CODES)"`; a typo in the list fails typecheck, since `AppError` takes an `ErrorCode`                                                                                                                                                                                                                                                                                             |

- **low** · The F4 fix drops a guard the old test gave for free. Reading `LEDGER_ERROR_CODES` meant a new ledger code with no status line answered 500 and failed; naming four codes means nothing now enforces `tools/ledger/CLAUDE.md:69 "with the ticket that first throws it"`. Measured: an unmapped `GATE_PROBE_UNMAPPED` added to the contract leaves the ledger project at 100 of 100 at `7d24bf8`, and fails the gate-1 version of the test with `expected 500 to be 422`. One more case over `LEDGER_ERROR_CODES` asserting a mapped, non-500 status restores it without asserting 422.
- **low** · Two misstatements in the new Log entry, _Corrections after gate 1_ (two findings, one mechanism: the entry reports more than was measured). It says the `months.ts` docblock said the first three letters; at `466771e` it said only three letters. And it accounts for 5 failing and 44 passing of 51 under the ordering mutation; the other two failures (_an altered balance_, _a missing row_, on AssertionError) go unmentioned.
- **dropped** · the corrected `months.ts` docblock has one line about 110 characters wide; `npm run check` passes and oxfmt does not reflow comments, so style only.
- **findings** · code-review at medium over `466771e..7d24bf8` returned 3; 2 carried, 1 dropped. Gates at `7d24bf8`: `npm run check` exit 0; `npm test -- --project ledger` 100 of 100. Not re-swept: everything outside this diff, settled by gate 1.
- NFR: security n/a (test and comment changes) · performance n/a · reliability ✓ · maintainability — above.

### Gate 3

**Gate: PASS** — 2026-10-02 · `7d24bf8..952c813` only (one fixer commit, fast-forward; base `b7fb3fb`, `origin/main` still at `b7fb3fb`) · code-review at medium, run by hand · citations into branch-introduced files resolve at `952c813`

| Gate 2 finding                                             | Verdict                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 · nothing enforced a status line for a new ledger code  | **fixed** — `tools/ledger/api/test/http-errors.test.ts:30 "status).not.toBe(500)"`, over every `LEDGER_ERROR_CODES` member. Re-run at `952c813`: an unmapped `GATE_PROBE_UNMAPPED` added to the contract fails it with `expected 500 not to be 500`, 1 failed and 8 passed of 9; probe reverted and the contract `dist` rebuilt clean |
| N2 · the corrections entry in the Log misstated two things | **fixed** — the entry now quotes the earlier Log bullet, not the docblock, as saying the first three letters, and accounts for all 7 of 51 failures under the ordering mutation                                                                                                                                                       |

- **checked, holds** · the corrections entry now says the two AssertionError failures arise because the chain error is raised on a different row. Re-run at `952c813` with `listed.toReversed()` → `listed`: 7 failed and 44 passed of 51; the two report `expected { line: 9, seq: 1, …(7) } to match object { line: 21, seq: 8, …(5) }` and `… to match object { date: '2026-08-26', …(1) }`, after their code assertions passed. The Log states what this run shows.
- **dropped** · the new case refuses any ledger code mapped to 500 on purpose. None is planned, and such a code would edit this test in its own change, so not a defect.
- **findings** · code-review at medium over `7d24bf8..952c813` returned 1; 0 carried, 1 dropped. Gates at `952c813`: `npm run check` exit 0; `npm test -- --project ledger` 104 of 104 (the four new cases are this round). Not re-swept: everything outside this diff.
- NFR: security n/a · performance n/a · reliability ✓ · maintainability ✓.

## Log

- 2026-10-01 — Built `@ledger/books` (`parseStatement`, `parseAmountCents`) and
  the four codes `STATEMENT_UNRECOGNIZED_LINE`, `STATEMENT_CHAIN_BROKEN`,
  `STATEMENT_TOTAL_MISMATCH`, `STATEMENT_ECHO_MISMATCH`, all `422` in
  `api/src/http-errors.ts`. Every error carries `details.line`, the 1-based line
  of the pasted text it names; a chain break also carries `unexplainedCents`,
  which lg-2's "how much went missing" needs.
  - **The suite passes:** `npm test -- --project ledger` → `Test Files 8 passed
(8)`, `Tests 100 passed (100)`; `npx oxlint tools/ledger` prints nothing.
  - **The tests can fail.** Each mutation below was applied to
    `books/src/statement.ts` alone, with `npx vitest run tools/ledger/books`:
    chain check `previous.balanceCents + row.amountCents` → `previous.balanceCents`
    and the order `listed.toReversed()` → `listed` each fail the whole
    `statement.test.ts` at collection (the three-month fixture no longer
    proves); the total comparison → `false` fails 2 of 71; the echo comparison
    → `false` fails 4 of 71. Removing the `ROW_START` guard fails nothing: it
    is an equivalent mutant, because the date-line match refuses the same line,
    and the guard exists only so a stray line is reported as "not a row, a
    header or a total" instead of "the paste ends before this row is complete"
    (a test asserts the message).
  - **`seq` is 0-based within the paste, not within the account.** The parser
    cannot know the history, so lg-2 offsets it when chaining onto stored rows.
    The brief's "position in the account's history" read literally is lg-2's
    to compute; lg-2's Build step 1 now says so.
- 2026-10-01 — What the brief had wrong or left open, and what was chosen:
  - **No vitest project was needed.** The `ledger` project's glob
    `tools/ledger/*/test/**/*.test.{ts,tsx}` already covers `books`; only the
    root `tsconfig.json` and `tsconfig.tests.json` reference lines were added,
    plus the two hand-written `package-lock.json` entries (no `npm install` in a
    worktree).
  - **`books` declares `@ledger/contract` only.** The brief says it may depend
    on `@webtools/core` too, but nothing under `src` imports it, and a package
    declares exactly what it imports. `ParsedStatement` and `StatementRow` are
    defined in `books`, not the contract: no route carries them until lg-2, and
    the contract is not edited speculatively.
  - **The Dockerfile is untouched.** `api` does not import `books` yet, so
    `packages/core/test/image-closure.test.ts` does not require it. Whichever
    ticket first imports `@ledger/books` into `api` gets a manifest line and a
    `dist` pair, and that test will name them.
  - **An empty paste parses to no rows** rather than an error; lg-2 decides what
    an empty paste means to a user. A month with no `Total` line is
    `STATEMENT_TOTAL_MISMATCH` with `totalCents: null`, not a fifth code.
  - **The month abbreviation must agree with the month name and the header.**
    `12 OCT12 Septembre` under `Septembre 2026` is refused, not trusted. The
    nine unverified abbreviations are the first three letters of the French
    name (`JUN`, `JAN`, `FEV`, `MAR`, `AVR`, `MAI`, `OCT`, `NOV`, `DEC`); a real
    paste that spells one differently fails loudly, naming its line.
  - **Column header position is not assumed.** The `Date Description Montant
Solde lien` line is accepted anywhere, and `lien` is optional, because the
    analysis shows it once under the first month and the paste may repeat it.
  - **Could have been folded in, was not:** wiring `parseStatement` into an API
    route is lg-2's whole scope and needs a decision about empty pastes and
    error presentation in `web`, so it stays there.
- 2026-10-01 — Corrections after gate 1 (four lows, all repaired; the entries above are left as written):
  - **The `ROW_START` guard is not an equivalent mutant.** The first entry says removing it "fails nothing"; it fails one test, the one that asserts the message. `sed -i` deleting the guard line, then `npx vitest run tools/ledger/books/test/statement.test.ts`, gives `Tests 1 failed | 50 passed (51)`, an `AssertionError` that `Line 27 of the paste was not recognis…` does not contain `not a row, a header or a total`. What is true is narrower: the date-line match refuses the same line either way, so the guard changes only the message, and the message is asserted.
  - **The fixture is parsed inside each test**, not in `describe` scope, so a fixture that stops parsing fails its tests one by one instead of the whole file at collection. With `listed.toReversed()` → `listed` in `statement.ts`: before, `Test Files 1 failed`, `Tests no tests`; after, `Tests 7 failed | 44 passed (51)`, 7 of 51: five fixture tests fail inside their own bodies with the chain's `AppError` (the parse throws before any `expect` runs, so not on an assertion), and two tests in `parseStatement refuses a paste that does not prove itself` (`an altered balance fails the chain, naming the row`, `a missing row fails the chain, and says how much money went unexplained`) fail on an `AssertionError` because the chain error they expect is raised on a different row. The other 44 still run.
  - **The abbreviation rule is three letters, not the first three.** `JUL` for `JUILLET` is verified and `JUN` for `JUIN` is the same guess; neither is a prefix. The Log bullet "The month abbreviation must agree" above says "the first three letters"; the `months.ts` docblock said only "three letters", and is reworded to say the rule is not a prefix. A wrong guess still fails loudly, naming its line.
  - **`http-errors.test.ts` names the four `STATEMENT_*` codes** instead of reading `LEDGER_ERROR_CODES`, so it no longer claims every present and future ledger code answers 422. A second case over `LEDGER_ERROR_CODES` asserts a status that is not 500, which keeps the rule in `tools/ledger/CLAUDE.md` that a code arrives with its status line: with a probe code `GATE_PROBE_UNMAPPED` added to the contract and left out of `http-errors.ts`, it fails with `expected 500 not to be 500` (`Tests 1 failed | 8 passed (9)`); the probe was reverted and the contract `dist` rebuilt with no occurrence left.
