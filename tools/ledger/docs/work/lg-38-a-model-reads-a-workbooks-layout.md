---
id: lg-38
tool: ledger
title: Measure whether a model can describe an unknown workbook's layout well enough to import it
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-38 — Measure whether a model can describe an unknown workbook's layout well enough to import it

## Why

The importer (lg-7) reads one workbook, laid out the way `00-ANALYSIS.md` §8
describes it. Where §8 was silent, it guessed, and its first run against the
real file refused because of the guesses (lg-37, PR #528, unmerged as this
ticket is filed). Hand-coding a reader is affordable for one household's file.
It doesn't scale to the households P6 brings in, each arriving with a
spreadsheet or CSV of its own.

The owner decided on 2026-10-17 to try a model before building anything
general. **The model proposes a layout, never rows.** It returns a structured
description of the file: which sheet holds the account, which column is the
date, amount, bucket and person, where the summary and carry-over rows are,
and where the salaries and period sheets are. Deterministic code then reads
the cells through that description and runs the verifications the importer
already has: running balance row to row, carry-overs, period totals, and the
books matching the workbook. A wrong description fails a check instead of
being imported. This is the receipt reader's pattern (lg-8): the model
proposes, and the books refuse what doesn't add up.

This ticket is the **measurement**, not the feature. It answers whether a
model can do this, which model, and at what cost, and it hands the
build-or-drop decision back to the owner with numbers attached.

## Build

1. **A layout description as a contract type.** Write a zod schema in
   `@ledger/contract` that can express both lg-7's synthetic layout and the
   real one lg-37 records in §8. It covers year sheets (column roles, the
   summary block, carry-over rows), period sheets (name row, date row, summary
   rows above or below the lines, the first line), Accueil (name headings, the
   salaries row), and sheets to ignore. Refactor `books/src/workbook.ts` so
   that a description drives its reading, with today's layout as one
   description. The verifications don't change.
2. **What the model is shown.** Each sheet's name, its first rows, a sample of
   rows further down, and the formula text beside each computed cell. Never
   the whole account, and never a figure the description doesn't need.
   Measure the token count of what you send.
3. **Fixtures.** At least six synthetic workbooks, every name and amount
   invented: lg-7's layout; lg-37's real layout; two variants with columns
   moved or renamed, or English labels; a plain bank CSV with a balance
   column; and a CSV with no balance column. Each comes with the description
   that is correct for it, written by hand.
4. **The measurement.** Run Claude Haiku 5.5 and Claude Sonnet 5.5 with
   structured outputs against every fixture, several times each. Score each
   run by whether the import's verifications pass using that description, and
   whether it matches the correct description. Record tokens and cost per
   run. No test calls a real model: the measurement is a script run by hand
   with the owner's key, as pl-40's was, and its results go in this Log.
5. **Report back** with the success rate per model and fixture, the cost per
   import, which failures the verifications caught and which they would have
   let through, and a recommendation: build it (with which model), or drop
   it.

## Done when

- `npm test -- --project ledger` proves the refactored reader imports lg-7's
  and lg-37's fixtures exactly as before, each driven by its description.
- The schema rejects a description that names a role twice or names no
  amount column.
- The Log has the measurement table (model × fixture: runs, passed, matched,
  tokens, cost), and says for each layout failure whether the verifications
  caught it.
- The Log ends with the recommendation, and the build is either filed as the
  next ticket or this one is closed as dropped, by the owner's decision.

## Notes for the builder

- **Real bank data never enters the repository**, and that includes what the
  measurement sends. Run it on the synthetic fixtures only. Sending the
  owner's own workbook is the owner's call, made separately.
- A model is called only by the person's explicit action, as a receipt read
  is. The feature, if it is built, inherits that, plus a statement of what
  leaves the house.
- A CSV with no balance column cannot prove itself the way the workbook can.
  Say what it would need to be checked against (§8 already describes matching
  a statement paste), rather than letting it through unverified.
- Builders have no Anthropic key, and the measurement needs the firewall
  opened. Leave step 4 for the orchestrator to run with the owner.

## Log
