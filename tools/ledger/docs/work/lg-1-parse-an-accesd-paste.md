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
