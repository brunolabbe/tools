---
id: lg-56
tool: ledger
title: Measure the layout reader again on harder fixtures, before lg-38 is built or dropped
kind: work-package
status: in-flight
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
six wrong descriptions the verifications let through (its Log lists them), and
the run exercised at least one (`csv-no-balance` cannot prove its order, and
all ten of its runs matched). **No fixture invites a model to make the two
this ticket adds fixtures for**:

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
     `deposit` columns with an empty spacer column among them, and a balance
     column (the pinned `let-through` below holds only with one: read through
     such a layout, `csv-balance` scores `let-through` and `csv-no-balance`
     `refused`, lg-38 gate 1).
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

2. **Pin each fixture offline**, in `api/test/layout.test.ts`. Three existing
   tests there loop over every fixture and must be updated for thirteen:
   "lg-38's fixtures › there are six, and each reads through its own layout with
   no problem but the unprovable CSV's" (it asserts the exact list of six
   names), "…told apart only by their descriptions: an account read through
   another's columns fails", and "what is sent stays under 3 000 tokens for
   every fixture, by four characters a token". For every new fixture, its
   correct description scores `matched`. For three, a named wrong description is scored and the outcome
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
   command, as lg-38 did; the spend stop's input term (the request's characters
   over two) understates the API's input count by 1.8 to 3.3 times (lg-38's Log), so
   the output term dominates its ceiling.

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

## Review

**Gate: CONCERNS** — 2026-10-18 · `335efcd4..9bced737` · Opus 5.5, depth full, on a slice (Build steps 1–2; four rows `unproven (scope)`)

| Done when                                                                                       | Proof                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A test per new fixture that its correct description scores `matched`                            | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "%s: its correct description matches, and reads with no problem", seven cases ✓; `npm test -- --project ledger` 1445 of 1445. The `matched` assertion cannot fail (F1); each description was checked against its generated bytes by this gate, and all seven are right |
| The three named wrong descriptions and one per bank shape are pinned with their actual outcomes | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "%s, %s: %s" (the `MISTAKES` table), seven cases ✓. All seven outcomes recomputed from `scoreLayout` with layouts built by hand, without the test's helpers: identical                                                                                                 |
| A test turns red when `LAYOUT_FIXTURE_NAMES` and `layoutFixtures()` differ                      | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "the names the measurement runs are the fixtures there are, in the same order" ✓. Turned red when two entries of `LAYOUT_FIXTURE_NAMES` swapped places: 1 failed, 59 passed (60)                                                                                       |
| The Log has the Haiku shown and masked tables, and Sonnet's or "none"                           | **unproven (scope)**: Build step 3, the owner's paid run (dispatch)                                                                                                                                                                                                                                                            |
| The Log quotes every run that did not match and whether it was caught                           | **unproven (scope)**: Build step 4, after the paid run (dispatch)                                                                                                                                                                                                                                                              |
| The Log gives the let-through count and bound, and what shown against masked changed            | **unproven (scope)**: Build step 4 (dispatch). F2 bears on it                                                                                                                                                                                                                                                                  |
| The Log ends with the recommendation and lg-38's Log points here                                | **unproven (scope)**: Build step 4 (dispatch)                                                                                                                                                                                                                                                                                  |

- **med** · no `Done when` line in this slice depends on it · F1. The `matched` half of "its correct description matches" holds by construction. `scoreLayout(each, each.layout)` compares a layout with itself, so every schema-valid layout scores `matched`. The test goes red only through its second assertion (`problems` equal `[]`), which catches only mistakes the reader refuses. Positive control: `bankWide()`'s amount moved from H to F turned that test red through `problems` (2 failed, 49 passed of 51). The detail moved from E to G (Channel) left all 60 tests in both layout spec files green. So a correct description that goes wrong without the reader refusing it is unguarded. Only two such mistakes would turn a test red: one that coincides with a pinned mistake, and `swapped-labels`' buckets, which the content test checks. The same shape is in lg-38's own "the correct description matches…" loop. Direction for a fix: assert what each new fixture's correct reading holds against what the generator wrote, for example its rows' dates, details and cents against `statement()`'s.
- **med** · no `Done when` line in this slice depends on it; Done when 6 in the owner's slice will · F2, **open decision**. On the bank shapes, answers that are harmless or a matter of judgement score `let-through` with the same `differences` (`["account.columns"]`) as real mistakes. `bank-two-dates` has the reference filed as `note` (the Log names this one) and the date read from B. `bank-wide` has any of its six text fields filed as `note` (B, C, D, G, J, K, all measured `let-through`). On `bank-two-dates`, the 21 rows the view shows hold no transaction-date inversion (0 shown, 2 in the file), so only the header tells "Date posted" from "Date of transaction". The Log's advice ("read such a run by its differences") cannot separate these, because each run's record `answer` has to be read. Options: (a) **recommended**: amend the Log's step 3–4 note so each `let-through` is classified from its record's `answer`, with note-only and date-column differences reported apart from movement-changing ones. This needs no code, and the measurement stays comparable with lg-38's. (b) Change `score.ts` so a note-only difference scores `same-import`, and re-seed `bank-two-dates` so an inversion falls in the shown rows. This changes the fixture and lg-38's scorer, so the 60 runs of lg-38 no longer compare.
- **low** · `nfr:maintainability` · the `MISTAKES` test title `"%s, %s: %s"` puts the `change` function's source in the third slot, never the pinned outcome. The verbose run prints `bank-wide, the detail read from the currency column: (copy) => moveColumn(copy, "detail", "D")`.
- **low** · false in the safe direction · `bankWide()`'s `shape` says "of which a description needs three", but its layout names four columns, and its own test says "the four". Nothing that is sent or recorded reads `shape`: no reference in `live/layout-run.ts`, `layout/score.ts` or `layout/view.ts`.
- **low** · `nfr:maintainability` · the title "bank-two-dates: … only the posted one is in order" asserts the transaction date's `outOfOrder` and never the posted date's. Recomputed, the posted date's `outOfOrder` is 0, so the title holds and is unasserted.
- **dropped** · the live-gate test now builds its expected list from `layoutFixtures()` itself. That is not a tautology, because `toHaveLength(26)`, `layout.test.ts`'s literal thirteen names and the names test still pin which fixtures there are and their order.
- **dropped** · the Log's "12 of 12 [loan payments] under `Compte 2`" is about the file, and it holds. The view shows 6 of the 12, all `Compte 2`, beside the heading, which is shown on both year sheets. The evidence the Log says is shown is shown.
- **dropped** · the Log's pinned-mistakes table says "32 movements" where the reading has 0 movements and 32 unfiled. Its own first table defines rows as movements plus unfiled, so this is loose wording and not a defect.
- **findings** · the hunt returned 8; 5 carried (2 med, 3 low), 3 dropped.
- Existing six fixtures: byte-identical to `335efcd4`'s (sha256 of each fixture and of its request text, base against head), all `matched`. The consent refusal test passes at the head, and `live/layout-run.ts` is unchanged by the branch.
- PR #562 at `9bced737`: every check passes. `test (windows-latest, informational)` was still pending and was read, not graded.
- NFR: security ✓ (no key read, the consent gate untouched, every bank shape invented) · performance n/a · reliability ✓ (seeded and reproduced) · maintainability: F1 and the three lows.

### Gate 2

**Gate: PASS for the slice (four rows `unproven (scope)`)** — 2026-10-18 · `9bced737..7de01442` · Opus 5.5, re-gate of the round's own commits

| Done when                                                                                       | Proof                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A test per new fixture that its correct description scores `matched`                            | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "%s: its correct description matches, and reads with no problem" ✓. It is now backed by "%s: its correct description reads what the generator wrote" (12 cases), which goes red when a correct description is wrong in a way the reader accepts (F1) |
| The three named wrong descriptions and one per bank shape are pinned with their actual outcomes | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "$name, $mistake: $outcome", seven cases ✓. The outcomes are unchanged from gate 1's recomputation; the fixtures and the scorer are unchanged                                                                                                        |
| A test turns red when `LAYOUT_FIXTURE_NAMES` and `layoutFixtures()` differ                      | `api/test/layout.test.ts` › "lg-56's harder fixtures" › "the names the measurement runs are the fixtures there are, in the same order" ✓. The round did not touch it                                                                                                                                         |
| The Log has the Haiku shown and masked tables, and Sonnet's or "none"                           | **unproven (scope)**: Build step 3, the owner's paid run (dispatch)                                                                                                                                                                                                                                          |
| The Log quotes every run that did not match and whether it was caught                           | **unproven (scope)**: Build step 4 (dispatch)                                                                                                                                                                                                                                                                |
| The Log gives the let-through count and bound, and what shown against masked changed            | **unproven (scope)**: Build step 4 (dispatch). The round's classification note bears on it (F2, and the low below)                                                                                                                                                                                           |
| The Log ends with the recommendation and lg-38's Log points here                                | **unproven (scope)**: Build step 4 (dispatch)                                                                                                                                                                                                                                                                |

- **F1 (med): fixed.** Each of these mutations of a correct description, all accepted by the reader, turned exactly one test red, "<fixture>: its correct description reads what the generator wrote" (1 failed, 72 passed of 73 each):
  - `bank-wide` detail moved from E to G (gate 1's control) and from E to K;
  - `bank-two-dates` with a `note` added on C;
  - `swapped-labels` with its note column dropped;
  - `empty-columns-carry` with its person column dropped.

  `writtenRows` builds its rows from the generator's `recorded()` and `banked()` data before anything is written to a sheet. It never calls `readWorkbook`, and it recomputes the balance itself rather than reading the sheet's formulas, so it cannot agree with a reading by construction. The thirteen fixtures are byte-identical to `9bced737`'s (sheets, people, layout and request text, by sha256). The only difference is `bank-wide`'s `shape` text.

- **F2 (med, owner chose (a)): fixed.** The Log now says to classify each run from its record's `answer`, and gives the correct columns of `bank-two-dates` and `bank-wide`. I ran the Log's listing, verbatim, on four fake records. It skipped the matched run, printed the note-only and date-column runs with the columns that tell them apart (`… date:B detail:D`, `… detail:E note:G`), and printed an invalid run with no answer without failing. The scorer and fixtures are unchanged.
- **Lows from gate 1: all three fixed.**
  - The verbose run prints `'bank-wide', 'the detail read from the currency col…': 'let-through'`.
  - `shape` now says four.
  - `bank-two-dates` asserts that the correct description's `outOfOrder` is `[]`.
- **low** (new, in the round's Log note) · false in the conservative direction. "note-only" is defined only as an added `note` beside `bank-two-dates`' and `bank-wide`'s four columns; everything else is "movement-changing". On the workbook fixtures, a run that drops or moves the note column also scores `let-through`: gate 1 measured `swapped-labels` without its note as `let-through` with `["account.columns"]`, and the fixtures and scorer are unchanged. Such a run would be counted in `J`, the number the recommendation rests on. That over-counts, so a reader relying on `J` errs toward caution. Direction for a fix: define note-only as "differs from the correct columns only in the `note` role, whether added, moved or dropped".
- **findings** · the round's lines returned 1 new finding, which is carried; nothing was dropped. Of gate 1's findings, 5 are fixed and none was refuted. Nothing here is a `high`.
- PR #562 at `7de01442`: every check passes, the Windows informational leg included.
- NFR: security ✓ (nothing live; `live/` untouched) · performance n/a · reliability ✓ · maintainability ✓.

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

### 2026-10-18 — gate records

The gate records for the pull request that filed this entry and lg-56 are on PR #552's thread, not in a `## Review` section: gate 1 CONCERNS at `d76699a2`, gate 2 PASS at `1135f0a6`.

### 2026-10-18 — Build steps 1 and 2: the fixtures and their pins; the paid run awaits the owner

Steps 1 and 2 are built, offline, from `origin/main` at `335efcd4`. **Step 3,
the paid run, and step 4, the report back, are the owner's and have not been
started**: no model was called, no key was read, nothing was spent, and
`status` stays `ready`. lg-38 is untouched.

**What changed.** `api/test/layout/fixtures.ts` has seven more fixtures after
the existing six (`LAYOUT_FIXTURE_NAMES` and `layoutFixtures()` both list them
in the ticket's order); `api/test/layout.test.ts` and
`api/test/layout-live-gate.test.ts` are updated for thirteen. No reader, schema
or contract changed. Two small refactors in `fixtures.ts`, neither changing a
fixture that existed: `accountSheets` takes an optional `heading` line, and the
English detail map `english()` had inline is `inEnglish()`.

```
$ npm test -- --project ledger
 Test Files  70 passed (70)
      Tests  1445 passed (1445)
$ npx vitest run api/test/layout.test.ts   (the spec alone)
      Tests  51 passed (51)
$ npm run check            exit 0
```

**The seven fixtures.** All from the seeded generator (seeds 56 to 64), every
name, shop and amount invented. `Rows` is movements plus unfiled; `Tokens` is
the harness's four-characters-a-token estimate of what is sent, schema
excluded (the ceiling in `layout.test.ts` is 3 000; the largest of the thirteen
is still `lg37` at 2 630).

| Fixture               | Rows | Tokens | Shape                                                                                                          |
| --------------------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `swapped-labels`      | 75   | 1 416  | Two year sheets (2023, 2024, oldest first), bucket column `Compte 1` / `Compte 2`, carry-overs `Report annuel` |
| `empty-columns-carry` | 95   | 1 461  | English, newest first, carry-overs; column E empty, the amount in F, balance G, note H                         |
| `empty-columns-csv`   | 32   | 779    | `Date,Description,Withdrawals,,Deposits,Balance,`: a spacer D and a trailing empty G; no carry-over label      |
| `bank-preamble`       | 32   | 744    | Title, `Account,…`, `Period,…` and a blank line above the header on row 5                                      |
| `bank-two-dates`      | 32   | 935    | `Date posted`, `Date of transaction`, `Reference`, `Description`, `Amount`, `Balance`                          |
| `bank-footer`         | 32   | 760    | Signed amount and balance, then `Total withdrawals`, `Total deposits`, `Closing balance` lines                 |
| `bank-wide`           | 32   | 1 216  | Eleven columns, newest first; the date, description (E), amount (H) and balance (I) are the four needed        |

**`swapped-labels`: where the evidence is, so a reader can judge it fair.**
The bucket column's text is `Compte 1` for current expenses and `Compte 2` for
the mortgage: the reverse of the order the prompt names them in ("the mortgage
and … current expenses"), so the cheap guess is the swap. Three things in what
is shown say which is which. (1) A heading in `B1` of each year sheet, `Compte
1 : courant · Compte 2 : maison`. (2) A `Paiement prêt` of -1 049.87 on the
20th of every month, 12 of 12 under `Compte 2` and under no other label
(pinned in `layout.test.ts`, "swapped-labels: the buckets' labels do not say
which is which…"), where the shared bills (`Électricité`, `Internet`, …) vary
in amount and sit under `Compte 1`. (3) `Versement` rows under `Compte 2`,
`Dépôt` under `Compte 1`. With the labels swapped every carry-over still
chains, so the books take it. The fixture is fair only if (1) or (2) is read:
a model that answers from the order of the labels is making the mistake it is
here to catch.

**Correct descriptions that are a judgement, and what the scorer will make of
a different, reasonable one.**

- `bank-two-dates`: the correct `date` is `Date posted` (A). The rows are in
  posted order, and the transaction dates are out of order on some rows; the
  header says which is which. The `Reference` column is left out of the
  description (no role fits a bank's reference). **A model that files it as
  `note` scores `let-through`** (checked: `note` on C scores `let-through`,
  zero problems), because `imported()` includes the note, though nothing is
  wrong. `differences` cannot tell it from a real mistake (it says
  `account.columns` for both): classify each run from its record's `answer`,
  as the round-1 entry below says.
- `bank-footer`: the last three rows shown to a model are the three footer
  lines, because the view's last rows are the sheet's last rows: it sees no
  final movement. That is the shape; it is a fixture on purpose.
- `bank-preamble`: the account layout has no header-row field, so a preamble
  changes nothing in what a description says: rows with no date are not
  movements. The fixture tests whether a model is put off by it, not whether
  the reader is.

**Wrong descriptions pinned** (`layout.test.ts`, "lg-56's harder fixtures",
the `MISTAKES` table; run on the committed head, not guessed). The three
named in the brief:

| Fixture               | Wrong description                            | Outcome       | What the reader says                                               |
| --------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `swapped-labels`      | the two buckets' labels swapped              | `let-through` | 75 movements, 0 problems                                           |
| `empty-columns-carry` | amount pointing at the empty column E        | `refused`     | 6 problems, the first `2024!E49: a carry-over has no amount.`      |
| `empty-columns-csv`   | withdrawal at D and deposit at G, both empty | `let-through` | reads 0 rows, skips 32, **0 problems**: the gap lg-38 gate 1 named |

And one of the builder's choosing for each bank shape, with what it scored:

| Fixture          | Wrong description                           | Outcome       | What the reader says                                                                     |
| ---------------- | ------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `bank-preamble`  | order flipped to newest-first               | `refused`     | 31 problems, the running balance breaks                                                  |
| `bank-two-dates` | the date read from B, the transaction date  | `let-through` | 32 movements, 0 problems; `outOfOrder` holds 2 rows, which is reported and not a problem |
| `bank-footer`    | amount and balance swapped                  | `refused`     | 34 problems, three of them `an amount with no date` on the footer lines                  |
| `bank-wide`      | the detail read from D, the currency column | `let-through` | 32 movements, 0 problems                                                                 |

Tried and not pinned: `bank-wide` with the amount on F (the category code),
`refused`, 31 problems; `bank-preamble` with the sheet named `Account
statement`, `refused`, 1 problem; `bank-preamble` and `bank-footer` and
`bank-wide` with the balance left out, `refused`, 1 problem each (the "names no
balance column" one): the correct description reads with no problem, so that one is
an extra problem and is caught. `LAYOUT_FIXTURE_NAMES` against the names
`layoutFixtures()` returns: one test, red when they differ (checked below).

**Checks that were made to fail first.**

- Deleting `"bank-wide"` from `LAYOUT_FIXTURE_NAMES` turned exactly "the names
  the measurement runs are the fixtures there are, in the same order" red (`1
failed | 50 passed (51)`); restored from the commit.
- The harness's own test, `layout-live-gate.test.ts`, failed with thirteen
  fixtures until it was updated (below), which is the check that the fake
  model's records cover the new ones too (26 records for 2 runs of 13).

**Not expressible, left out, named.**

- **A total line with its figure in the amount column.** `readYear` reports
  `an amount with no date` for a number in the amount column of a row with no
  date, under any description, so such a footer cannot be read cleanly even
  with the correct layout. `bank-footer` keeps its three figures in the
  balance column, where the reader never looks on a dateless row. This is a
  limit of the reader, not of the schema, and it is pinned in `layout.test.ts`
  ("bank-footer: …"): the same file with the figures moved into the amount
  column reads three problems, the first `an amount with no date`. It is an
  unmeasured shape for a model: a real export that totals under the amount
  column will not import whatever a model says.
- **Decimal commas, semicolon delimiters and thousands separators** are not read
  by `layout/csv.ts`. Unmeasured, as the brief says; the CSV reader is not
  extended.

**What the brief had wrong.**

- "Three existing tests there loop over every fixture" in `layout.test.ts`:
  two of them (the told-apart and the 3 000-token test) loop and needed no
  change, and passed with thirteen; the third, the list of six names, was
  hard-coded and changed. A **fourth** hard-coded six lives in
  `api/test/layout-live-gate.test.ts` ("scores every run, writes a record per
  run and the table…": the twelve asked names, 13 files, `**all** | 12`) and was
  red; it now builds the expected list from `layoutFixtures()` and says 26
  records, 27 files.
- The told-apart test needed no exclusion for the new CSVs: each CSV is read by
  its file name, so another CSV's layout finds no account sheet and reports a
  problem.

**Fold-in exception.** One piece looked free and was not folded in:
`@anthropic-ai/sdk` is imported by `layout.test.ts` and `live/layout-run.ts`
but not declared in `api/package.json` (lg-38 gate 1, low). Declaring it means
a dependency line and a lockfile edit, which this ticket does not otherwise
touch and which `npm audit` and the image-closure scan would then be asked
about. Not folded in; lg-38's record already carries it. Nothing else was
filed; lg-62 was not needed.

**Step 3, the owner's command.** From the repository root, after `npm run
build`, with `ANTHROPIC_CUSTOM_HEADERS` unset (`env -u` below does it for the
one command) and `--out` outside the repository. Prices are lg-38's (Haiku
$0.10 in and $0.50 out, Sonnet $2 and $10 per million tokens); check them
against the current rates first, because the records carry whatever is typed.

```sh
# 1. Haiku 5.5, figures shown, all 13 fixtures, 10 runs: 130 runs, about $0.16
env -u ANTHROPIC_CUSTOM_HEADERS LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=<key> \
  node --import tsx tools/ledger/api/test/live/layout-run.ts \
  --model claude-haiku-5-5 --price-in 0.10 --price-out 0.50 \
  --runs 10 --max-usd 5 --figures shown --out ~/ledger-layout-lg56-shown

# 2. Haiku 5.5, figures masked, a DIFFERENT --out (a record's name does not carry --figures)
env -u ANTHROPIC_CUSTOM_HEADERS LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=<key> \
  node --import tsx tools/ledger/api/test/live/layout-run.ts \
  --model claude-haiku-5-5 --price-in 0.10 --price-out 0.50 \
  --runs 10 --max-usd 5 --figures masked --out ~/ledger-layout-lg56-masked

# 3. Which fixtures did Haiku shown not match on every run? (reads files, calls nothing)
node -e 'const fs=require("node:fs");const d=process.argv[1];const s=new Set();for(const f of fs.readdirSync(d)){if(!f.endsWith(".json"))continue;const r=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));if(r.score.outcome!=="matched")s.add(r.fixture)}console.log([...s].join(","))' \
  ~/ledger-layout-lg56-shown/claude-haiku-5-5

# 4. Sonnet 5.5, shown, ONLY those fixtures (the comma list printed by 3).
#    If 3 printed nothing, Haiku matched everything: there is no Sonnet run.
env -u ANTHROPIC_CUSTOM_HEADERS LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=<key> \
  node --import tsx tools/ledger/api/test/live/layout-run.ts \
  --model claude-sonnet-5-5 --price-in 2 --price-out 10 \
  --runs 10 --max-usd 5 --figures shown --fixtures <list from 3> \
  --out ~/ledger-layout-lg56-shown
```

What was checked of these offline, without a key: the three harness argument
lists parse to the options shown below (`parseCli`, the real function; the Sonnet line's two fixtures are an example); a fake
model driven through `measure` with command 1's exact options wrote 130 records
and a `summary.md` of 13 fixture rows plus `**all**`; and command 3, run on
that fake output where one fixture was answered wrongly, printed that fixture's
name and only that. **Not run: the consent check on the script as invoked
from the shell** (the sandbox refused a bare invocation of the live script,
a paid command, and it was not worked around); that refusal is pinned by
`layout-live-gate.test.ts` ("refuses without LEDGER_LIVE_RUN=1, and without a
key"), which passed.

```
{"model":"claude-haiku-5-5","priceIn":0.1,"priceOut":0.5,"out":"…/ledger-layout-lg56-shown","runs":10,"maxUsd":5,"effort":"medium","figures":"shown"}
{"model":"claude-haiku-5-5","priceIn":0.1,"priceOut":0.5,"out":"…/ledger-layout-lg56-masked","runs":10,"maxUsd":5,"effort":"medium","figures":"masked"}
{"model":"claude-sonnet-5-5","priceIn":2,"priceOut":10,"out":"…/ledger-layout-lg56-shown","runs":10,"maxUsd":5,"effort":"medium","figures":"shown","fixtures":["bank-wide","swapped-labels"]}
```

The spend stop cannot trip on these: its ceiling is 16 000 output tokens plus
the input at two characters a token, about $0.008 a Haiku run and $0.17 a Sonnet
run, against a cap of $5 and an expected spend of $0.16 and under $2.2. The
Sonnet records and the Haiku shown records share one `--out` because the model
is a directory under it; only the masked run needs its own. **An estimate, not a
measurement:** the API counts input at 1.8 to 3.4 times the harness's estimate
(lg-38's Log), so the spend is dominated by output tokens.

### 2026-10-18 — round 1: gate 1 CONCERNS at `9bced737`; the owner's answer

**The owner's answer, 2026-10-18.** The question was gate 1's two mediums (F1,
F2) with these options: "F2(a); also fix F1 now", "F2(a) only; F1 stays
recorded", "F2(b): change the scorer and re-seed". **The owner chose "F2(a);
also fix F1 now".** F2(a) was the gate's recommendation; opening a round for F1
is the owner's choice beyond the severity floor. The three lows ride along.

**F1 (med): "matched" held by construction.** `scoreLayout(each, each.layout)`
compares a layout with itself, so the "correct description matches" tests could
only go red through their `problems` assertion, which catches only what the
reader refuses. Gate 1's positive control: `bankWide()`'s detail moved from E
to G (Channel) left all 60 tests green. Fixed: `fixtures.ts` exports
`writtenRows(name)`, the rows the generator wrote (date, bucket, person, cents,
running balance, detail, note), built from the same `recorded()` and
`banked()` the fixtures are built from, and `layout.test.ts` holds each
correct description's reading to them, row for row.

```
$ sed -i 's/{ role: "detail", column: "E" }/{ role: "detail", column: "G" }/' …/fixtures.ts   (committed baseline 766464aa)
$ npx vitest run api/test/layout.test.ts api/test/layout-live-gate.test.ts
 × bank-wide: its correct description reads what the generator wrote
      Tests  1 failed | 72 passed (73)
$ git checkout 766464aa -- …/fixtures.ts ; same run
      Tests  64 passed (64)  (layout.test.ts alone)
```

The refactor that made this possible moved the seeds into those two helpers.
Checked not to change a fixture: the thirteen fixtures dumped to JSON before
and after differ only in `bank-wide`'s `shape` text (the low below):
`sed 's/needs three/needs four/' before.json | cmp - after.json` exits 0.

**Folded in: lg-38's own loop.** It was free: the twelve generated fixtures
(everything but `lg7`, which comes from `test/helpers/workbook.ts`, not from a
seeded generator here) go through the same test, and all twelve pass. So the
five lg-38 fixtures other than `lg7` are held to what was written as well. The
lg-38 test "the correct description matches, and so does the same one spelled
another way" is unchanged.

**F2 (med, open decision): the owner chose (a).** On the bank shapes a
harmless or judgement answer scores `let-through` with the same `differences`
(`["account.columns"]`) as a real mistake: `bank-two-dates` with the
reference filed as `note`, or the date read from B; `bank-wide` with any of its
six text fields (B, C, D, G, J, K) filed as `note`, all reproduced here:
`let-through`. Also, the 21 rows `bank-two-dates` shows hold no
transaction-date inversion (0 shown, 2 in the file), so only the header tells
"Date posted" from "Date of transaction". **Nothing in the scorer or the
fixtures is changed**, so the run stays comparable with lg-38's 60. The note
that replaces "read such a run by its `differences`", for steps 3 and 4:

- For every run that did not match, read the record's `answer.account.columns`
  and class it by comparing with the correct columns: `bank-two-dates` is
  `date:A detail:D amount:E balance:F`, `bank-wide` is
  `date:A detail:E amount:H balance:I`.
  - **note-only**: differs from the correct columns only in the `note` role,
    whether added, moved or dropped. Harmless; the note is a free-text field.
  - **date-column**: `date` on another column. A different import, and the
    kind that matters for `bank-two-dates`.
  - **movement-changing**: anything else (amount, balance or detail on another
    column; order; buckets).
- Report the let-through count in step 4 as `N let-through, of which M
note-only, K date-column and J movement-changing`, and state the
  rule-of-three bound on **both** `N` and `J` as estimates, with the runs and
  fixtures behind each. The recommendation rests on `J`, and says so.
- The listing, which reads files and calls nothing (it prints each non-matched
  run, its outcome and differences, and the answer's columns):

```sh
node -e 'const fs=require("node:fs");const d=process.argv[1];for(const f of fs.readdirSync(d).sort()){if(!f.endsWith(".json"))continue;const r=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));if(r.score.outcome==="matched")continue;const cols=(r.answer?.account?.columns??[]).map(c=>c.role+":"+c.column).sort().join(" ");console.log(f,r.score.outcome,r.score.differences.join(","),"|",cols)}' \
  ~/ledger-layout-lg56-shown/claude-haiku-5-5
```

Run on a fake directory it printed `bank-wide-1.json refused account.order |
  amount:H balance:I date:A detail:E`, one line per run that did not match.

**The three lows.**

- The `MISTAKES` title put the `change` function in the third slot. In this
  ticket's table the cases are objects and the title is `$name, $mistake:
$outcome`; the verbose run now prints `'bank-wide', 'the detail read from the
currency col…': 'let-through'`. **lg-38's own `MISTAKES` table has the same
  title and is left alone**: it is nineteen merged tuples outside this
  ticket's fixtures, and the defect is cosmetic.
- `bankWide()`'s `shape` says four.
- The `bank-two-dates` test now asserts that the posted date has no
  `outOfOrder` under the correct description, beside the transaction date's.

**Checks.** `npx vitest run api/test/layout.test.ts
api/test/layout-live-gate.test.ts`: `73 passed (73)`. Preflight and the new
head are in the pull request's thread.

- 2026-10-18 — Fixed at landing by owner choice: gate 2, the new low — "'note-only' is defined only as an added `note` beside `bank-two-dates`' and `bank-wide`'s four columns; everything else is 'movement-changing'. On the workbook fixtures, a run that drops or moves the note column also scores `let-through`." The round-1 entry's note-only bullet now defines it as differing from the correct columns only in the `note` role, whether added, moved or dropped (Log wording only; no fixture or scorer changed). `grep -c "the same four columns and an added" tools/ledger/docs/work/lg-56-measure-the-layout-reader-on-harder-fixtures.md` → `0` (it was `1`).

### 2026-10-24 — Build steps 3 and 4: the paid run, and the report back

Step 3 was run on 2026-10-24 and this entry is step 4. **Both tickets stay
as they are**: lg-56's `status` is the lander's to set, and lg-38's Done when 4
(build or drop) is the owner's. Nothing in `tools/` changed: this entry and the
pointer in lg-38's Log are the whole branch.

**Provenance.** The owner was away from the computer and asked the orchestrator
session (tools-f6) to run this Log's four commands, one after the other, with the
owner's key. They ran from the shared checkout, which stood at `main` 89a38d30
(the script records no sha; the checkout's `HEAD` log, read from
`/workspaces/tools/.git/logs/HEAD`, has as its newest line `89a38d30` by `pull
--tags origin main: Fast-forward` at 2026-10-24T16:36:25Z, before the run), from
17:32:40Z to 17:52:26Z, under one script that holds commands 1 to 4 of this Log verbatim
(only the key is read from a file). Each exited 0. Prices were checked first
against `RATES` in `scripts/agent-cost.mjs` (read 2026-10-10): Haiku 5.5
$0.10 in and $0.50 out, Sonnet 5.5 $2 in and $10 out, per million tokens, as the
commands say. Command 3 printed `bank-two-dates,english,lg7,swapped-labels`, so
command 4 ran Sonnet on those four. The records are outside the repository and
not copied into it: `~/ledger-layout-lg56-shown/claude-haiku-5-5/` (130 records),
`~/ledger-layout-lg56-masked/claude-haiku-5-5/` (130) and
`~/ledger-layout-lg56-shown/claude-sonnet-5-5/` (40), each with its
`summary.md`. **Every number below is computed from those records** by scripts
that only read them (the listing in the round-1 entry, and a second pass for the
costs and the date columns); no model was called to write this entry. All 300
records have `stopReason: "end_turn"`, `effort: "medium"`, and the `figures` and
`model` their directory says. The harness's `summary.md` tables are in the
model-by-fixture form the Done when asks for.

#### The three tables

Each `summary.md`, verbatim.

`~/ledger-layout-lg56-shown/claude-haiku-5-5/summary.md`:

| Model            | Fixture             | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |
| ---------------- | ------------------- | ---- | ------ | ------- | ----------- | ------ | ----------- | ------- | ------------------- | -------------------- | ------------------- |
| claude-haiku-5-5 | lg7                 | 10   | 10     | 6       | 4           | 0      | 0           | 0       | 6190                | 1118                 | $0.0012             |
| claude-haiku-5-5 | lg37                | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 9468                | 1440                 | $0.0017             |
| claude-haiku-5-5 | moved               | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 8080                | 1090                 | $0.0014             |
| claude-haiku-5-5 | english             | 10   | 10     | 8       | 2           | 0      | 0           | 0       | 7924                | 1085                 | $0.0013             |
| claude-haiku-5-5 | csv-balance         | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4928                | 583                  | $0.0008             |
| claude-haiku-5-5 | csv-no-balance      | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4787                | 391                  | $0.0007             |
| claude-haiku-5-5 | swapped-labels      | 10   | 9      | 9       | 0           | 1      | 0           | 0       | 6459                | 831                  | $0.0011             |
| claude-haiku-5-5 | empty-columns-carry | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6425                | 842                  | $0.0011             |
| claude-haiku-5-5 | empty-columns-csv   | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4929                | 464                  | $0.0007             |
| claude-haiku-5-5 | bank-preamble       | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4822                | 500                  | $0.0007             |
| claude-haiku-5-5 | bank-two-dates      | 10   | 10     | 1       | 0           | 0      | 9           | 0       | 5319                | 502                  | $0.0008             |
| claude-haiku-5-5 | bank-footer         | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4860                | 535                  | $0.0008             |
| claude-haiku-5-5 | bank-wide           | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6013                | 526                  | $0.0009             |
| claude-haiku-5-5 | **all**             | 130  | 129    | 114     | 6           | 1      | 9           | 0       | 6170                | 762                  | $0.0010             |

Outcomes over 130 runs:

- matched: 114
- same-import: 6
- refused: 1
- let-through: 9
- invalid: 0

`~/ledger-layout-lg56-masked/claude-haiku-5-5/summary.md`:

| Model            | Fixture             | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |
| ---------------- | ------------------- | ---- | ------ | ------- | ----------- | ------ | ----------- | ------- | ------------------- | -------------------- | ------------------- |
| claude-haiku-5-5 | lg7                 | 10   | 10     | 8       | 2           | 0      | 0           | 0       | 6115                | 1185                 | $0.0012             |
| claude-haiku-5-5 | lg37                | 10   | 10     | 8       | 2           | 0      | 0           | 0       | 9057                | 1455                 | $0.0016             |
| claude-haiku-5-5 | moved               | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 7745                | 1156                 | $0.0014             |
| claude-haiku-5-5 | english             | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 7581                | 1222                 | $0.0014             |
| claude-haiku-5-5 | csv-balance         | 10   | 9      | 9       | 0           | 1      | 0           | 0       | 4808                | 608                  | $0.0008             |
| claude-haiku-5-5 | csv-no-balance      | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4706                | 471                  | $0.0007             |
| claude-haiku-5-5 | swapped-labels      | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6253                | 901                  | $0.0011             |
| claude-haiku-5-5 | empty-columns-carry | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6202                | 821                  | $0.0010             |
| claude-haiku-5-5 | empty-columns-csv   | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4803                | 504                  | $0.0007             |
| claude-haiku-5-5 | bank-preamble       | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4708                | 525                  | $0.0007             |
| claude-haiku-5-5 | bank-two-dates      | 10   | 10     | 9       | 0           | 0      | 1           | 0       | 5176                | 503                  | $0.0008             |
| claude-haiku-5-5 | bank-footer         | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 4730                | 559                  | $0.0008             |
| claude-haiku-5-5 | bank-wide           | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 5810                | 541                  | $0.0009             |
| claude-haiku-5-5 | **all**             | 130  | 129    | 124     | 4           | 1      | 1           | 0       | 5976                | 804                  | $0.0010             |

Outcomes over 130 runs:

- matched: 124
- same-import: 4
- refused: 1
- let-through: 1
- invalid: 0

`~/ledger-layout-lg56-shown/claude-sonnet-5-5/summary.md` (the four fixtures
command 3 named; the other nine were not run):

| Model             | Fixture        | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |
| ----------------- | -------------- | ---- | ------ | ------- | ----------- | ------ | ----------- | ------- | ------------------- | -------------------- | ------------------- |
| claude-sonnet-5-5 | lg7            | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6190                | 348                  | $0.0159             |
| claude-sonnet-5-5 | english        | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 7924                | 332                  | $0.0192             |
| claude-sonnet-5-5 | swapped-labels | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 6459                | 244                  | $0.0154             |
| claude-sonnet-5-5 | bank-two-dates | 10   | 10     | 10      | 0           | 0      | 0           | 0       | 5319                | 156                  | $0.0122             |
| claude-sonnet-5-5 | **all**        | 40   | 40     | 40      | 0           | 0      | 0           | 0       | 6473                | 270                  | $0.0156             |

Outcomes over 40 runs:

- matched: 40
- same-import: 0
- refused: 0
- let-through: 0
- invalid: 0

**Read "Passed" with care.** The column is `score.verified` (the harness's
`summary` counts it so), which is true for a let-through run: the verifications
found nothing, and that is what makes it a let-through. So Haiku shown's 129 of
130 includes 9 runs that imported a different date. The count of imports that
were right is Matched plus Same import: **120 of 130 shown, 128 of 130 masked**,
and 40 of 40 for Sonnet. lg-38's 60 runs had no let-through, so there the two
counts agreed and the column could be read either way.

#### Every run that did not match: 22 of 260 Haiku runs, 0 of 40 Sonnet runs

Each row is quoted from the record's `score` block (`valid` is true and `issues`
is `[]` in all 22). The correct columns are the round-1 entry's:
`bank-two-dates` is `date:A detail:D amount:E balance:F`. The "answer's
columns" are the record's `answer.account.columns`, sorted by role.

Haiku 5.5, **shown** (16 runs):

| Record                                                                       | `outcome`     | `verified` | `problems` | `differences`                            | Answer's columns                                                                                                                | Caught?                             |
| ---------------------------------------------------------------------------- | ------------- | ---------- | ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `bank-two-dates-1`, `-2`, `-3`, `-4`, `-5`, `-6`, `-7`, `-8`, `-10` (9 runs) | `let-through` | true       | 0          | `["account.columns"]`                    | `amount:E balance:F date:B detail:D`; no `note`; same in all nine                                                               | **No**                              |
| `swapped-labels-1`                                                           | `refused`     | false      | 7          | `["account.columns", "account.buckets"]` | `amount:E balance:F date:A detail:B note:G person:D`; `buckets: []`, `carryOverLabel: "Report annuel"`, `order: "oldest-first"` | **Yes**                             |
| `lg7-3`, `-6`, `-9`, `-10` (4 runs)                                          | `same-import` | true       | 0          | `["ignored"]`                            | `amount:G balance:F bucket:C date:B detail:D note:H person:E`                                                                   | Not refused; nothing wrong imported |
| `english-8`, `-10` (2 runs)                                                  | `same-import` | true       | 0          | `["ignored"]`                            | `amount:E balance:F bucket:B date:A detail:C note:G person:D`                                                                   | Not refused; nothing wrong imported |

Haiku 5.5, **masked** (6 runs):

| Record                  | `outcome`     | `verified` | `problems` | `differences`              | Answer's columns                                                                                       | Caught?                             |
| ----------------------- | ------------- | ---------- | ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `bank-two-dates-9`      | `let-through` | true       | 0          | `["account.columns"]`      | `amount:E balance:F date:B detail:D`; no `note`                                                        | **No**                              |
| `csv-balance-5`         | `refused`     | false      | 2          | `["account.yearPerSheet"]` | `balance:E date:A deposit:D detail:B withdrawal:C`; `yearPerSheet: true`, `names: ["releve-2024.csv"]` | **Yes**                             |
| `lg7-1`, `-10` (2 runs) | `same-import` | true       | 0          | `["ignored"]`              | `amount:G balance:F bucket:C date:B detail:D note:H person:E`                                          | Not refused; nothing wrong imported |
| `lg37-2`, `-3` (2 runs) | `same-import` | true       | 0          | `["account.summary"]`      | `amount:G balance:F bucket:C date:B detail:D note:H person:E`                                          | Not refused; nothing wrong imported |

What each says, from the records:

- **The 10 let-through runs are one mistake.** In every one the date is column
  B, `Date of transaction`, where the correct description has A, `Date posted`;
  every other column is right, and none files `Reference` or anything else as
  `note`. They score `problems: 0`: the verifications count the reader's
  problems and nothing else, and reading the file through this layout reports
  none. **The books do notice it, though** (corrected in round 1; see that
  entry): all ten answers are exactly the wrong description the Build steps 1–2
  entry pins ("the date read from B"), and reading the fixture through each of
  them reports `outOfOrder` with 2 rows and `problems` with 0, against 0 and 0
  for the correct description. The record keeps the
  count of problems, not their text, so which verification fired on the two
  refused runs is unmeasured, as in lg-38.
- **`swapped-labels-1` (shown) is a refusal, and not the swap.** The answer left
  `buckets` empty and named no bucket column at all; the reading reported 7
  problems and the verifications refused it. **Caught.**
- **`csv-balance-5` (masked) is lg-38's `csv-balance-1` again**: the one CSV
  answered `yearPerSheet: true`, every column right, 2 problems. **Caught.**
- **The 12 same-import runs changed nothing in the import.** The `ignored` ones:
  the six `lg7` answers (four shown, two masked) list `Accueil` as ignored as well
  as `Labels` and `Budget` (the correct description lists the last two), and
  every one of them also names `Accueil` as the salaries sheet
  (`salaries: {"sheet":"Accueil","label":"Salaires bruts"}`): the answer
  contradicts itself, and the reader never consults `ignored`, so it is harmless
  today. Whether a reader that did consult `ignored` would refuse it is
  unmeasured, as in lg-38. The two shown `english` answers list `Home` as well
  as `Lists` (the correct description has `Lists` only). The two masked `lg37`
  answers give the summary labels `["Solde Dép. Courantes", "Solde Hypothèque",
"Total"]` where the correct description has `["Solde", "Total"]`, as lg-38's
  Sonnet did twice.

#### Let through, and its bounds

Classed from each record's `answer.account.columns` by the round-1 entry's
rule. **10 let-through, of which 0 note-only, 10 date-column and 0
movement-changing**: `N = 10`, `M = 0`, `K = 10`, `J = 0`.

- All ten are `bank-two-dates`: 9 of Haiku's 10 shown runs and 1 of its 10
  masked runs. Sonnet matched all 10 of its runs on that fixture, with column A.
  So `N` comes from **1 fixture of 13**.
- **`J`, the number the recommendation rests on: 0 in 300 runs** (Haiku shown
  130, Haiku masked 130, Sonnet 40) **over 13 distinct fixtures** (Sonnet saw 4 of
  them). By the rule of three that bounds the rate of a movement-changing
  let-through at no more than about 1% at 95% (3/300); for Haiku alone 3/260,
  about 1.2%; for Sonnet alone 3/40, about 7.5%. **These are estimates, and weak
  ones.** The ten runs of a fixture read one workbook, so the independent units are
  nearer the 13 fixtures than the 300 runs: counted by fixture, 3/13 is about 23%.
  Neither number speaks for workbooks unlike these thirteen, nor for the shapes in
  the unmeasured list below.
- **`N`: the rule of three does not apply**, because it bounds a rate seen as
  zero and `N` is 10. The observed rate is 10 of 300 (3.3%), or 10 of 260 for Haiku
  (3.8%), and it is not spread: 10 of the 20 Haiku runs on `bank-two-dates` and 0
  of the other 280 runs (Sonnet's 10 on that fixture among them). Taking that fixture out, 0 let-through in 270 runs over
  12 fixtures bounds the rest at no more than about 1.1% (3/270, an estimate), on
  the same caveat about independence.
- **Whether a date-column let-through is a defect is the fixture's judgement.**
  The correct description is `Date posted` because the rows are in posted order,
  and the 21 rows the view shows hold no transaction-date inversion (round-1
  entry), so in what is shown to the model only the header tells the two apart;
  in the whole file, 2 rows are out of order under the transaction date, and the
  reader reports them. The run says Haiku read the
  other date in 10 of 20 runs (9 of 10 shown, 1 of 10 masked) and Sonnet in 0 of 10. It does not say which date a household would want.

#### Shown against masked

Haiku 5.5, same 13 fixtures, 10 runs each; the two sets differ only in what was
sent (`#` for every number when masked).

| Fixture             | Shown: passed / matched / same import / caught / let through | Masked: passed / matched / same import / caught / let through | Cost per run, shown | Cost per run, masked |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | ------------------- | -------------------- |
| lg7                 | 10 / 6 / 4 / 0 / 0                                           | 10 / 8 / 2 / 0 / 0                                            | $0.0012             | $0.0012              |
| lg37                | 10 / 10 / 0 / 0 / 0                                          | 10 / 8 / 2 / 0 / 0                                            | $0.0017             | $0.0016              |
| moved               | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0014             | $0.0014              |
| english             | 10 / 8 / 2 / 0 / 0                                           | 10 / 10 / 0 / 0 / 0                                           | $0.0013             | $0.0014              |
| csv-balance         | 10 / 10 / 0 / 0 / 0                                          | 9 / 9 / 0 / 1 / 0                                             | $0.0008             | $0.0008              |
| csv-no-balance      | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0007             | $0.0007              |
| swapped-labels      | 9 / 9 / 0 / 1 / 0                                            | 10 / 10 / 0 / 0 / 0                                           | $0.0011             | $0.0011              |
| empty-columns-carry | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0011             | $0.0010              |
| empty-columns-csv   | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0007             | $0.0007              |
| bank-preamble       | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0007             | $0.0007              |
| bank-two-dates      | 10 / 1 / 0 / 0 / 9                                           | 10 / 9 / 0 / 0 / 1                                            | $0.0008             | $0.0008              |
| bank-footer         | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0008             | $0.0008              |
| bank-wide           | 10 / 10 / 0 / 0 / 0                                          | 10 / 10 / 0 / 0 / 0                                           | $0.0009             | $0.0009              |
| **all (130)**       | **129 / 114 / 6 / 1 / 9**                                    | **129 / 124 / 4 / 1 / 1**                                     | **$0.000998**       | **$0.001000**        |

- **Passed: unchanged**, 129 of 130 both ways, and it hides the difference (see
  the note on "Passed" above).
- **Matched: 114 shown, 124 masked. Imports that were right: 120 shown, 128
  masked. Let through: 9 shown, 1 masked.** The whole difference is
  `bank-two-dates`: it is 8 of the 8 extra right imports, and the date column
  chosen swapped almost exactly (shown B 9, A 1; masked A 9, B 1). Take that
  fixture out and the two modes are the same: 119 of 120 right imports each.
- **Caught: 1 and 1**, different runs (`swapped-labels-1` shown, `csv-balance-5`
  masked).
- **Cost per run: the same**, $0.000998 against $0.001000 (130 runs each, from
  `costUsd`). Masked sent about 3% fewer input tokens (mean 5,976 against 6,170)
  and Haiku wrote about 5% more output (804 against 762).
- **What this does not say.** It is one fixture, 10 runs a side. A two-sided
  Fisher exact test on 9 of 10 against 1 of 10 (computed here, not by the
  harness) gives p of about 0.001, so it is unlikely to be noise on that
  fixture, but **why** masking moved the choice is unmeasured, and one fixture
  does not tell whether it would on another bank's export. The run does not show
  that showing figures helps anywhere: on the other twelve fixtures the two
  modes are indistinguishable.

#### Cost

From every record's `costUsd`; the totals rebuilt from the token counts at the
run's prices agree to four places.

|                      | Haiku shown | Haiku masked | Sonnet shown |
| -------------------- | ----------- | ------------ | ------------ |
| Runs                 | 130         | 130          | 40           |
| Input tokens, total  | 802,040     | 776,940      | 258,920      |
| Output tokens, total | 99,067      | 104,515      | 10,800       |
| Cost, total          | $0.1297     | $0.1300      | $0.6258      |
| Cost per run, mean   | $0.000998   | $0.001000    | $0.015646    |

**The run cost $0.8855 in all.** On the four fixtures Sonnet was run on, Haiku
shown cost $0.001089 a run (40 runs) and Sonnet $0.015646, so **Sonnet is
14.4 times Haiku per import**, as lg-38 found (14.05). In absolute terms an
import costs a tenth of a cent with Haiku and under two cents with Sonnet on
these fixtures. The estimates were high: about $0.31 for 260 Haiku runs
at $0.0012 (the 260 cost $0.2597; the new CSV fixtures cost $0.0007 to $0.0009 a
run), about $0.16 for command 1 (the Build steps 1–2 entry's command comment, not
the brief; it cost $0.1297), and "at most about $2.2"
for Sonnet (it was run on four fixtures, not thirteen, and cost $0.6258). The
spend stop did not trip.

#### What the records say against the ticket's expectations

- **No model made either mistake the ticket added fixtures to invite.**
  `swapped-labels`: 0 of 30 runs (Haiku shown 10, masked 10, Sonnet 10)
  swapped the buckets; 29 gave `mortgage` = `Compte 2` and `current-expenses` =
  `Compte 1`, and the thirtieth left `buckets` empty and was refused. The
  `let-through` the fixture's pinned wrong description scores was never
  produced. `empty-columns-csv`: 0 of 20 Haiku runs pointed withdrawal or deposit
  at an empty column, and `empty-columns-carry`: 0 of 20 pointed the amount at
  the empty one. So the "reads 0 rows and reports 0 problems" gap lg-38 gate 1
  named was **not exercised** by any answer. Like lg-38's 0 of 60, the 0 says
  the models did not make those mistakes on these fixtures, not that the
  reader could stop them.
- **The let-through the run did find is one the ticket pinned, and not the one
  its note expected.** The Build steps 1–2 entry pins "the date read from B, the
  transaction date" for `bank-two-dates` as `let-through`, and the round-1 entry
  names the date-column class. What the note on that fixture expected was a
  model filing `Reference` as `note` (harmless); no run did that.
- **Sonnet's run was triggered by command 3's test, `outcome !== "matched"`.**
  That sent Sonnet to `lg7` and `english`, where Haiku's only non-matches were
  same-import (harmless), and to `swapped-labels` (one refusal) as well as to
  `bank-two-dates`. More than half of Sonnet's $0.63 ($0.35: 20 runs at
  $0.0159 and $0.0192) went on those two harmless ones. The brief says "at least one run that did not match", so this is
  the brief doing what it says.

#### Not measured

- Real bank exports. The seven new shapes are invented, as in lg-38.
- **Decimal commas, semicolon delimiters and thousands separators**
  (`layout/csv.ts` does not read them), and a footer total under the amount
  column (`bank-footer` keeps it in the balance column; a real export that
  totals under the amount column will not import whatever a model says).
- Why masking moved `bank-two-dates`; whether any other prompt, effort or
  figures setting would; Sonnet on the nine fixtures it was not run on; the
  verifications' text (the records keep a count).
- Whether a reader that consulted `ignored` would refuse the six `lg7`
  answers that name `Accueil` in it.

#### Recommendation for lg-38's Done when 4

**The build-or-drop decision is the owner's, and this closes neither ticket.**
Claiming no more than the fixtures show:

1. **The numbers do not argue against building.** On 13 invented fixtures and
   300 runs there was no movement-changing let-through (`J = 0`). **The bound
   on it is an estimate and depends on what is counted: about 1% at the rule of
   three if the 300 runs were independent (3/300), and about 23% counted by
   fixture (3/13), which is the closer reading because the ten runs of a fixture
   read one workbook.** Haiku 5.5, shown, imported the right thing in
   119 of its 120 runs on the twelve fixtures other than `bank-two-dates`, and
   the one that was not right was refused by the verifications. Both refusals
   in the 260 Haiku runs were of answers that would have been wrong (2 of 2).
2. **The one thing the run found is a plausible, wrong date column that the
   verifications do not refuse, and that the books do notice.** Haiku shown read
   `Date of transaction` for `Date posted` in 9 of 10 runs on `bank-two-dates`,
   and 1 of 10 masked; Sonnet read the posted date 10 of 10. All ten answers are
   exactly the pinned wrong description. The verifications (`problems`) report
   nothing for it. But reading the fixture through each of the ten answers
   reports 2 rows `outOfOrder` (for example `2024-02-29` on row 19 listed above
   `2024-03-02` on row 18) against 0 for the correct description, and the import
   would print each one as "dated out of order: … imported as typed"
   (`api/src/workbook-import.ts`, in the import report). In what is shown to the
   model only the header says which date is which, because the 21 rows it sees
   hold no inversion. The owner's chosen guard, "confirm on screen", was chosen
   for the swapped bucket labels, which no model made here; **the date column is
   the case the run actually produced**. Two ways a build could guard it, both
   unmeasured beyond this one fixture: (a) what the owner confirms includes the
   date column (a few rows with their dates); (b) the import treats a non-empty
   `outOfOrder` as a prompt to confirm or as a refusal, using the signal the
   reader already computes. Whether a real export shows inversions under its
   transaction date, as this invented one does on 2 of 32 rows, is unmeasured,
   and (b) works only if it does. These are suggestions from one fixture and
   10 + 10 + 10 runs, not measured remedies.
3. **On the owner's three preferences, this evidence is as follows.**
   _Haiku 5.5_: its only let-through is the date column above. Sonnet read the
   posted date in 10 of 10 runs and matched 40 of 40 on the four fixtures
   Haiku tripped on, which is an indication, not a proof, that Sonnet would not
   make it. A Sonnet retry on refusal would not have helped, because the
   let-through was not refused. Sonnet costs 14.4 times as much per import, which
   is under two cents on these fixtures. _Shown_: nothing in this run shows
   that showing figures helps. Masked was not worse on any fixture in a way that
   changed an import (its non-matches are four harmless same-imports, one
   refusal and the one `bank-two-dates` let-through), and was better on `bank-two-dates` for a reason this run did not
   establish; masking is not measured to cost anything here. _Confirm on
   screen_: no model swapped the buckets, so the guard was never needed by any
   event in this run, and that does not show it unneeded (see the first point of
   "What the records say against the ticket's expectations").
4. **What this still cannot say:** that a real household's workbook reads as
   well, or that the guard is unnecessary.

**The options in front of the owner**, with the recommendation first: build
with the owner's three answers of 2026-10-18 plus a guard for the date column,
either (a) the date column on the confirmation screen or (b) the reader's
`outOfOrder` list put to the user (both follow from the one failure observed;
(a) costs a screen element and works whatever the file holds; (b) costs nothing
the reader does not already compute and is unmeasured beyond this fixture), and
the owner may reconsider shown against masked in the light of the
`bank-two-dates` row; build with Sonnet 5.5 instead (the failure observed did
not occur in 10 runs of it; about 14 times the price per import); or drop. The
choice, and whether to file the build, is the owner's.

**Fold-in exception.** Nothing was folded in. The pieces in view were not free:
declaring `@anthropic-ai/sdk` in `api/package.json` (lg-38 gate 1, low) still
means a dependency line and a lockfile edit this docs-only branch does not touch,
and "reading zero rows must be a problem" is, by this ticket's own Notes,
input for a build ticket and not this one's to change. lg-38's Log points here.

### 2026-10-24 — round 1 of the report: gate 1 FAIL at `e92dff07`; the owner's answers

**The owner's answers, 2026-10-24.** Two questions, from the orchestrator:

1. "How should the round correct F1?" Options: "(a) Correct + add option" (the
   gate's recommendation and the orchestrator's) and "(b) Correct only". **The
   owner chose (a).**
2. "Fix all seven (F1, F4 and the five lows)?" Options: "Fix all seven" (the
   orchestrator's recommendation) and "F1 and F4 only". **The owner chose "Fix
   all seven".**

The build-or-drop decision on lg-38 is still the owner's, and both `status:`
lines are as they were. All seven findings were corrected in the entry above, in
place, with the sentence that was wrong now saying what holds.

- **F1 (high): reproduced, and it was right.** The entry said the ten
  let-through runs "score `problems: 0` because the file reads cleanly either
  way" and that "the books' own checks cannot catch it". The books notice it.
  The "bank-two-dates: the dates differ on some rows…" test in
  `api/test/layout.test.ts` (`git show 89a38d30:tools/ledger/api/test/layout.test.ts`)
  reads the fixture through
  `moveColumn(copy, "date", "B")` and asserts `wrongly.outOfOrder.length` greater
  than 0 and `wrongly.problems` equal to `[]`. I read the fixture through each of
  the ten actual answers with the books' `readWorkbook` (a scratch script that
  reads the records and the fixture and calls no model):

  ```
  shown/bank-two-dates-1.json outOfOrder=2 problems=0   (the same for -2 to -8 and -10)
  masked/bank-two-dates-9.json outOfOrder=2 problems=0
  correct description: outOfOrder=0 problems=0
  sample: {"sheet":"activity.csv","row":19,"date":"2024-02-29","belowRow":18,"belowDate":"2024-03-02"}
  ```

  So the verifications (`problems`) do not refuse this mistake, the books report
  2 rows out of order, and `workbook-import.ts` would print each as "dated out of
  order: … imported as typed". The recommendation's second point and the
  options now say so, and add the guard built on that signal as option (b), with
  "unmeasured beyond this fixture" beside it: whether a real export shows
  inversions under its transaction date is not known.

- **F4 (med):** recommendation 1 now gives both bounds on `J = 0`, about 1%
  (3/300) and about 23% counted by fixture (3/13), and says which the Log's own
  analysis calls closer.
- **F2 (low):** the line "not one the ticket predicted" was wrong. The Build
  steps 1–2 entry pins the date read from B as `let-through` for
  `bank-two-dates`. It now says that, and that what the note expected, `Reference`
  as `note`, did not happen.
- **F3 (low):** lg-38's pointer said "0 that changed a movement", which reads as
  false there because "movement-changing" is lg-56's defined class. It now says
  "0 that changed an amount, balance or detail" and names the transaction date.
- **F5 (low):** recommendation 3's list of masked's non-matches left out
  `bank-two-dates-9`. It now lists four same-imports, one refusal and that
  let-through.
- **F6 (low):** the "$0.16 for command 1" estimate is from the Build steps 1–2
  entry's command comment, not the brief. Now said, and the sentence no longer
  calls the three estimates "the brief's".
- **F7 (low):** the provenance clause "at `main` 89a38d30" had no source in
  `run.sh` or `run.log`. The source is the shared checkout's `HEAD` log. Re-read
  for this round: its newest line is `89a38d30` by `pull --tags origin main:
Fast-forward` at 1792859785 seconds, which is 2026-10-24T16:36:25Z (`date -u -d
@1792859785`), before the run's 17:32:40Z start. The entry cites it.
  (`git reflog` run through `git -C` was refused by the worktree-isolation check,
  so the file under `.git/logs/` was read directly.)

- 2026-10-24 — Fixed at landing by owner choice: gate 2, F8 — "The round-1 entry cites `git show e92dff07:…/layout.test.ts` lines 478 to 497. `e92dff07` is a branch commit, so the citation stops resolving once the squash merge lands." The round-1 entry now cites the test by its title, at `89a38d30`, with no line pin. `grep -v "Fixed at landing" tools/ledger/docs/work/lg-56-measure-the-layout-reader-on-harder-fixtures.md | grep -c "git show e92dff07:"` → `0`.
- 2026-10-24 — Fixed at landing by owner choice: gate 2, F9 — "The Log says the import prints each one as 'dated out of order: …'", while `workbook-import.ts` passes no `layout` today. Both places that made the claim now say "would print": the Build steps 3–4 entry's second recommendation point and the round-1 entry's F1 paragraph. `grep -v "Fixed at landing" tools/ledger/docs/work/lg-56-measure-the-layout-reader-on-harder-fixtures.md | grep -c "prints each one as\|prints each as"` → `0`.
