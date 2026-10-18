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
  - **note-only**: the same four columns and an added `note` on any other
    column. Harmless; the books keep one more text field.
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
