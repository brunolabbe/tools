---
id: lg-1
tool: ledger
title: Parse an AccèsD paste, and prove it with its own running balance
kind: work-package
status: ready
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
