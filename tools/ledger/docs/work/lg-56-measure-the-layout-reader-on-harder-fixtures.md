---
id: lg-56
tool: ledger
title: Measure the layout reader again on harder fixtures, before lg-38 is built or dropped
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-56 — Measure the layout reader again on harder fixtures

## Why

lg-38 measured whether a model can describe an unknown workbook's layout well
enough to import it. The owner's paid run of 2026-10-18 (lg-38's Log) read
**60 runs over 6 synthetic fixtures, with 0 let through**: Haiku 5.5 passed
29 of 30 and Sonnet 5.5 30 of 30, one Haiku answer was refused by the
verifications, and Haiku cost about 14 times less per import. That bounds the
let-through rate at about 5% (rule of three, 95%), and the bound is an
estimate on six workbooks, not on the households P6 brings in.

It also leaves out the cases that matter most. lg-38's offline scoring found
which wrong descriptions the verifications let through, and **no fixture
invites a model to make any of them**:

- **Swapped bucket labels.** Every carry-over still matches, because the
  carry-over rows swap with the movements, so the books take it.
- **Amount, withdrawal or deposit columns pointing at empty columns.** With a
  carry-over label the carry-over check refuses it. With none, which is every
  CSV, nothing does: `csv-balance` read through such a layout reads 0 rows,
  skips 40 and reports 0 problems (lg-38 gate 1, low).

Nor did the run try `--figures masked`, and it covered two bank-CSV shapes.

The owner's answer of 2026-10-18 to "build or drop" was **measure more first**,
over the recommendation to build. This ticket is that measurement. It hands
lg-38's Done when 4 back to the owner with the harder numbers attached, and
decides nothing itself.

**It follows lg-38's merged harness (#542) and answers lg-38's Done when 4.**
It has no `depends_on`: lg-38 stays `in-flight` until the owner decides build or
drop, which waits on this ticket, so a `depends_on: [lg-38]` would withhold it
from `npm run status -- --ready` for good.

## Context: the owner's preferences if lg-38 is built

These are the owner's answers of 2026-10-18 to questions that only matter if the
build goes ahead. **They are context for choosing what to measure, not Build.**
Nothing here implements them.

- Model: **Haiku 5.5** (over Sonnet 5.5, and over Haiku with a Sonnet retry on
  refusal).
- Figures in what is sent: **shown** (over masked).
- The swapped-label guard: **confirm on screen** (over a sign check, and over
  both).

So Haiku 5.5 is the model this run must be able to speak for, shown is the
mode it must be measured in, and the swapped-label fixture is the one the
on-screen confirmation exists for.

## Build

Steps 1 and 2 are the builder's. **Step 3 is the owner's paid run**, as in lg-38:
builders have no Anthropic key, the measurement needs the firewall opened, and
the builder stops after step 2. Change no reader, schema or contract.

1. **Seven fixtures** in `tools/ledger/api/test/layout/fixtures.ts`, each from
   the seeded generator with every name, shop and amount invented, each with
   its correct description written by hand. Add their names to
   `LAYOUT_FIXTURE_NAMES` and to `layoutFixtures()` after the existing six, so
   the existing six keep their order.
   - `swapped-labels`: a workbook with a bucket column and carry-over rows,
     whose bucket labels do not themselves say which bucket is which. The
     evidence is in what is shown (a fixed monthly withdrawal of the same
     amount; a heading), and a swapped mapping is plausible. Say in the Log
     where the evidence is, so a reader can judge the fixture fair.
   - `empty-columns-carry`: a workbook with a carry-over label and an empty
     column beside the real `amount` column, so that an off-by-one answer is
     easy to give.
   - `empty-columns-csv`: a bank CSV with no carry-over label, `withdrawal` and
     `deposit` columns with an empty spacer column among them.
   - `bank-preamble`: a bank CSV with title, account and period lines above
     the header row, with a balance column.
   - `bank-two-dates`: a bank CSV with a posted date and a transaction date
     that differ on some rows, and a reference column, with a balance column.
   - `bank-footer`: a bank CSV with a signed amount, a balance column, and
     closing-balance and total lines after the last movement.
   - A seventh: `bank-wide`, a bank CSV of at least ten columns, most of them
     fields no description needs (branch, currency, category code), with the
     amount and balance among them.

   The bank shapes are **invented**: each stands for a kind of export, not for
   any named bank's, and no real bank data enters the repository, as in
   lg-38. They must stay within what `layout/csv.ts` reads (comma-separated,
   plain numbers, `yyyy-mm-dd` dates), and within what the schema can express;
   a shape the schema cannot express is left out and named in the Log, because
   the contract is not this ticket's to change.

2. **Pin each fixture offline**, in `api/test/layout.test.ts`, appended after the
   existing tests. For every new fixture, its correct description scores
   `matched`. For three, a named wrong description is scored and the outcome
   pinned, so the harness can tell the failure when a model makes it:
   - `swapped-labels` with the two buckets' labels swapped: `let-through`.
   - `empty-columns-carry` with the amount column pointing at the empty one:
     `refused`.
   - `empty-columns-csv` with the withdrawal and deposit columns pointing at
     empty ones: `let-through` (the gap lg-38 gate 1 named).

   For each bank shape, pin one wrong description of the builder's choosing and
   whatever outcome it actually scores, saying which in the Log. Add a test that
   `LAYOUT_FIXTURE_NAMES` and the names `layoutFixtures()` returns are the same
   list, so a name in one and not the other turns it red (lg-38 gate 2, low).

3. **The paid run** (the owner's; the builder gives the command). `--figures` is
   not in a record's file name, so **a second figures mode needs its own `--out`
   directory**, or its records overwrite the first's. Per the lg-38 Log's
   command, with `ANTHROPIC_CUSTOM_HEADERS` unset and `--out` outside the
   repository:
   - Haiku 5.5, `--figures shown`, all 13 fixtures, `--runs 10`.
   - Haiku 5.5, `--figures masked`, all 13 fixtures, `--runs 10`, into a
     different directory.
   - Sonnet 5.5, `--figures shown`, `--runs 10`, **only on the fixtures where
     the Haiku shown run had at least one run that did not match**. The reason
     is to tell a fixture no model can read from one Haiku reads badly, which
     is what the option the owner passed over (Haiku with a Sonnet retry on
     refusal) would turn on. If Haiku matched everything, there is no Sonnet
     run.

   An estimate of the spend, from lg-38's means and not a measurement: 260 Haiku
   runs at about $0.0012 is about $0.31; the Sonnet runs are at most 13
   fixtures x 10 runs at about $0.017, about $2.2. Use `--max-usd 5` per
   command, as lg-38 did; the fixtures are larger than lg-38's, so the harness's
   spend stop is the bound that holds.

4. **Report back in the Log**: each `summary.md` verbatim; every run that did
   not match, with its `score.outcome`, `score.differences` and
   `score.problems` quoted from the record, and whether the verifications
   caught it; the shown and masked tables side by side; cost per run and in
   total, from the records' `costUsd`; and the let-through count with its
   rule-of-three bound **stated as an estimate**, with the runs and the number
   of distinct fixtures behind it. Restate lg-38's recommendation in the light
   of the new numbers, claiming no more than the fixtures show. Add a pointer
   to the result in lg-38's Log; **the build-or-drop decision stays the
   owner's**.

## Done when

- `npm test -- --project ledger` passes with, in `api/test/layout.test.ts`, a
  test for each of the seven new fixtures that the correct description scores
  `matched`.
- The same run pins the three named wrong descriptions: `swapped-labels`
  `let-through`, `empty-columns-carry` `refused`, `empty-columns-csv`
  `let-through`; and one wrong description, with its actual outcome, for each of
  `bank-preamble`, `bank-two-dates`, `bank-footer` and `bank-wide`.
- A test turns red when `LAYOUT_FIXTURE_NAMES` and the names `layoutFixtures()`
  returns differ.
- The Log has the Haiku 5.5 shown table and the Haiku 5.5 masked table (model x
  fixture: runs, passed, matched, same import, caught, let through, invalid,
  tokens, cost; 13 fixtures, 10 runs each), and the Sonnet 5.5 table for the
  fixtures that qualify, or says there were none.
- The Log says, for every run that did not match, whether the verifications
  caught it, quoting its record.
- The Log gives the let-through count over all runs, with its bound named as an
  estimate, and says what shown against masked changed: passed, matched, let
  through and cost per run.
- The Log ends with the recommendation for lg-38's Done when 4, and lg-38's Log
  points here. Neither closes lg-38: the owner decides build or drop.

## Notes for the builder

- **The paid run is not yours.** Build the fixtures and the pins, push, and
  stop; the owner runs step 3 and its results go in this Log. No test calls a
  model.
- **Real bank data never enters the repository**, including what a fixture is
  modelled on. Invent the shape.
- **Do not fix the gap this ticket measures.** The reader accepts a layout that
  reads 0 rows without a problem; lg-38 gate 1 suggested "reading zero rows must
  be a problem" as input for a build ticket. Measuring with the gap in place is
  the point. Changing `books` here would change what the run measures.
- **Decimal commas, semicolon delimiters and thousands separators** are not
  read by `layout/csv.ts` (its header says so). They are out of this ticket's
  shapes; name them in the Log as unmeasured rather than extending the CSV
  reader.
- Builders have no Anthropic key, and the measurement needs the firewall
  opened.

## Log

### 2026-10-18 — filed; `depends_on` dropped by the owner's answer

Filed with `depends_on: [lg-38]`. That held it out of the ready list for good,
because lg-38 stays `in-flight` until the owner decides build or drop, and that
decision (lg-38's Done when 4) waits on this ticket:

```
$ npm run status -- --show lg-56
  blocked by  lg-38 (in-flight)
$ npm run status -- --ready --tool ledger
lg-56-...: withheld from --ready — waits on lg-38
```

**The question, and the owner's answer.** The filing builder put it to the
orchestrator, which asked the owner. Options: drop `depends_on` and say in the
prose that the ticket follows lg-38's merged harness (the builder's
recommendation); keep it and dispatch by hand, outside `--ready`; or move
lg-38 to `done` with an `awaiting` line. **On 2026-10-18 the owner chose the
first**, the recommended option. The Why now says so.
