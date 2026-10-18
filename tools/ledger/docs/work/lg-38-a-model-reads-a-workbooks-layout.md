---
id: lg-38
tool: ledger
title: Measure whether a model can describe an unknown workbook's layout well enough to import it
kind: work-package
status: in-flight
milestone: P6
depends_on: []
difficulty: hard
---

# lg-38 — Measure whether a model can describe an unknown workbook's layout well enough to import it

## Why

The importer (lg-7) reads one workbook, laid out the way `00-ANALYSIS.md` §8
describes it. Where §8 was silent, it guessed, and its first run against the
real file refused because of the guesses (lg-37, PR #528, merged as
aba691b2). Hand-coding a reader is affordable for one household's file.
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

## Review

**Gate: CONCERNS** — 2026-10-18 · `029641b4..782eb382` (read from the merge-base with main, `45856244`, which the branch merged) · Sonnet 5.5, depth full

Scope came from the dispatch, not the brief: the owner's answer of 2026-10-18, "build only". The paid run (Build 4) and its report were not done, and nothing here called a model, set `LEDGER_LIVE_RUN` or spent anything. The pull request's CI at this head is green: `check` (twice), `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review`, `test (ubuntu-latest)` and the informational `test (windows-latest, informational)` all succeeded.

| Done when                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `npm test -- --project ledger` proves the refactored reader imports lg-7's and lg-37's fixtures exactly as before, each driven by its description | **proven** — `api/test/layout.test.ts` › "lg-7's and lg-37's workbooks read the same through their own descriptions as through the household's" asserts `own` equals `household` for both fixtures, and `HOUSEHOLD_LAYOUT` given explicitly equals the default. That test compares two readings by the new reader, so what ties "as before" to the base reader is the unchanged suites (`books/test/workbook.test.ts`: the 23 original tests, only the import lines edited and 5 appended; `api/test/workbook-import.test.ts`, untouched) and the differential below. Ledger project at the head: 65 files, 1,293 tests pass (base: 62, 1,247). Mutation control: dropping `Total` from the household summary labels turns this test and the lg-37 summary test red. |
| 2. The schema rejects a description that names a role twice or names no amount column                                                                | **proven** — `contract/test/layout.test.ts` › "refuses a role named twice" (exact message) and › "refuses a description with no amount column" (exact message, and the withdrawal-without-deposit message). Each goes red when its rule is disabled in a scratch mutation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3. The Log has the measurement table and says for each layout failure whether the verifications caught it                                            | **unproven (scope)** — scoped out by the owner's answer of 2026-10-18; lands as the owner's run with the Log's command. The harness that produces the table is offline-tested (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4. The Log ends with the recommendation and the build is filed or the ticket dropped                                                                 | **unproven (scope)** — same answer; follows the run and is the owner's decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**The harness, checked offline.** Run bare, and with a fake key but no `LEDGER_LIVE_RUN`, the script refuses, exits 1 and creates no directory. The ledger vitest project does not collect it (`vitest list` shows the two new `api` specs and the `contract` one, not `layout-run.ts`). It has no default price (`--price-in` is required; 0 is refused). Its spend stop, driven with a stub: a cap below the first run's ceiling sends 0 calls; a run that overspends is followed by a refusal; 12 worst-case-sized runs against a $1.00 cap stopped at $0.9922. Disabling the stop, or the consent check, turns `api/test/layout-live-gate.test.ts` red (one test each). Nothing logs a key, a header or a URL (`logLevel` is off). The six fixtures are generated from a seeded generator with invented names and shops; I found no real data, and cannot rule out that an invented amount resembles a real one.

- **med** · no in-scope `Done when` line depends on it; Done when 3's run does (scoped out) · `api/test/live/layout-run.ts` says "every option the SDK would read from the environment is given", but the SDK reads `ANTHROPIC_CUSTOM_HEADERS` whatever the constructor is given, and the harness neither clears nor refuses it. The receipt reader's config and the planner's both refuse to boot with it set (pl-39) because a header in it can replace the key or change what a request bills; this paid script is the one place that does not, and the Log's command does not unset it. Reproduction: a client built with the harness's exact options, run with `ANTHROPIC_CUSTOM_HEADERS="x-demo-header: from-the-shell"` in the environment, reports `client default headers: {"x-demo-header":"from-the-shell"}`. Premise: the variable is set on at least one developer machine (lg-8's gate record, cited in `api/src/config.ts` and `api/test/helpers/no-model-environment.ts`). Direction, not a tested remedy: refuse it in `assertLiveRunConsent` as `loadReceiptReaderConfig` does, and say so in the Log's command.
- **low** · the household's salaries label is narrower than the base's: `HOUSEHOLD_LAYOUT` says `Salaires`, the base matched any row starting `salaire`. An Accueil row labelled `Salaire`, `Salaire brut` or `salaire net` now reads 0 salaries and is refused (fails closed); `Salaires bruts`, the real row, reads. Disclosed in the Log. My differential (base reader against branch reader on 5 inputs, every field of the reading, 40,040 comparisons of which 40 unmutated) found 5 differences, all in `salaries`, all this.
- **low** · the reader never consults `ignored`, though the contract text sent to a model says those sheets are "read as none of the above". The reading is identical whether `ignored` is empty, every sheet, or the account sheets themselves; a sheet in `ignored` that a selector matches is read as the account. The branch pins this as `same-import`. False in the safe direction: the verifications still run.
- **low** · the schema refuses bucket labels that collide by case but accepts ones that collide by accent: `Hypothèque` for mortgage and `Hypotheque` for current-expenses is valid, and the reader (which keys on its accent-folding `folded`) files both rows under the later bucket with no problem. No live call site (no fixture or plausible model answer does this).
- **low** · the spend stop works, but its bound is not a ceiling on input: it prices `request.length / 2` tokens and leaves out the format schema the API adds (5,842 characters by the Log's own figure). At the Log's four-characters-a-token estimate the three smallest fixtures (lg7, csv-balance, csv-no-balance) send more than the ceiling's input term; the difference is under a thousand tokens a run against a ceiling dominated by 16,000 output tokens. SDK retries (`maxRetries: 2`) are not counted either (unmeasured). The Log's "the ceiling is one, not a guess" overstates by that much.
- **low** · a stop, or any error from the model call, ends `measure` without writing `summary.md`; the per-run JSON already paid for stays on disk, the table is lost, and a rerun starts at run 1, overwrites those files and spends again.
- **low** · `parseCli` in the same file: `--out` is accepted anywhere, including inside the repository, so "outside the repository" is an instruction and not a guard (what it would write is synthetic answers and scores, never the key); `--out=/tmp/a=b` becomes `/tmp/a` because `split("=", 2)` drops the rest; a `--fixtures` name that is no fixture is silently ignored.
- **low** · `@anthropic-ai/sdk` is imported by `api/test/layout.test.ts` and `api/test/live/layout-run.ts` but not declared in `tools/ledger/api/package.json`; it resolves through `@ledger/receipts` hoisting (planner's api declares it for its live run).
- **low** · `zodOutputFormat` in SDK 0.125.0 moves every `enum`, `const`, `pattern` and `minLength` into description text, so `role`, `by`, `order`, `bucket` and the column pattern are advisory in the format, while the structured-outputs page (read through WebFetch, a summary) lists `enum`, `const` and `pattern` as supported. A model answering `Montant` as a role is `invalid` in the table, with the cause in `issues`. The test "the layout's schema can be sent as a structured output's format" asserts only `type`, `additionalProperties` and a substring. Read the `Invalid` column with its `issues` before concluding anything about a model.
- **low** · the `unfiled` guard in `api/src/workbook-import.ts` is dead under the only caller and untested, as the Log says. Decision: acceptable. No unfiled row can reach the books by any route: `unfiled` is read only by that guard, `movements` (the sole input to placement and writing) excludes every row without a bucket or a balance, the household layout names both columns so its `unfiled` is empty (0 in all 40,040 comparisons), and a layout without them is refused by the guard if it ever reaches `run`. A test would need a `layout` option on `importWorkbook`, which does not exist.
- **low** · a verification gap missing from the Log's "Let through" list, and the one with the biggest effect: a layout whose amount columns point at empty columns skips every dated row as a no-amount placeholder. With a carry-over label the carry-over check refuses it (lg37, moved, english); with none, which is every CSV, nothing does: csv-balance read through such a layout reads 0 rows, skips 40 and reports 0 problems, and the scorer rightly calls it `let-through`. Input to the recommendation and to any build ticket (reading zero rows must be a problem).
- **low** · `measure` wraps `scoreLayout` in the `try` that labels a failure "the answer is not JSON", so a reader exception on a schema-valid layout would be recorded as an invalid answer. No live call site: 0 throws in 1,995 random schema-valid layouts over the six fixtures.
- **dropped** · column letters past Excel's last column (`XFE` to `ZZZ`) are accepted: they read empty cells and fail closed. A label that folds to nothing (`.`) as carry-over label is accepted and fails closed with "names no bucket"; no plausible caller. A role named twice "in another case" and lowercase column letters are refused by the enum and the pattern. `HOUSEHOLD_LAYOUT` is an unfrozen object whose arrays the fixtures' layouts share: speculative, every test clones first. Whether Haiku 5.5 accepts `effort` is unverifiable offline and stays unmeasured (lg-8 left it unverified too).
- **findings** · the hunt returned 17; 12 carried (1 med, 11 low), 5 dropped.
- NFR: security — the med above, and `--out` (low); no key or header is logged and the fixtures are synthetic. Performance n/a: the reader is linear in rows times named columns, and none of 1,995 random layouts took 500 ms. Reliability — the two harness lows above on the stop and the lost table. Maintainability — `ignored`, the undeclared dependency.

## Log

### 2026-10-18 — built, the paid run left for the owner

**Scope, by the owner's answer of 2026-10-18: build only.** Build steps 1
to 3 and the harness for step 4 are done. Nothing called a model and
nothing was spent. The paid run (step 4) and the report back (step 5) are
the owner's, so `status` stays `ready`. Every `Done when` line that needs
the run is still open.

**What is left, and the command for it.** The run needs four things: the
owner's Anthropic key, the firewall opened to `api.anthropic.com`, each
model's prices in USD per million tokens, and an output directory outside
the repository. `ANTHROPIC_CUSTOM_HEADERS` must be unset: the harness
refuses to run with it set (gate 1's med, fixed in round 1 below). Unset it
with `unset ANTHROPIC_CUSTOM_HEADERS` in the shell first, or put
`env -u ANTHROPIC_CUSTOM_HEADERS` in front of each command. Run it
once per model from the repository root, after `npm run build`:

```sh
LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=<key> node --import tsx \
  tools/ledger/api/test/live/layout-run.ts --model claude-haiku-5-5 \
  --price-in <haiku input $/Mtok> --price-out <haiku output $/Mtok> \
  --runs 5 --out ~/ledger-layout-lg38 --max-usd 5
LEDGER_LIVE_RUN=1 ANTHROPIC_API_KEY=<key> node --import tsx \
  tools/ledger/api/test/live/layout-run.ts --model claude-sonnet-5-5 \
  --price-in <sonnet input $/Mtok> --price-out <sonnet output $/Mtok> \
  --runs 5 --out ~/ledger-layout-lg38 --max-usd 5
```

Each run writes `<out>/<model>/<fixture>-<run>.json` and, at the end,
`<out>/<model>/summary.md`. That file is the measurement table for this
Log: model × fixture, with runs, passed, matched, same import, caught, let
through, invalid, mean tokens in and out, and mean cost. `--figures masked`
replaces every number in what is sent with `#`, and is a second run to make
only if the owner wants to know what showing figures costs. The prices have
no default on purpose. The spend stop refuses a run before it starts if that
run's ceiling would take the session past `--max-usd`. The ceiling is the
request at two characters a token plus 16 000 output tokens.

**Build 1: the schema and the reader.**

- `contract/src/layout.ts` holds `workbookLayoutSchema` and its parts. It is
  a new file, plus one export line in `contract/src/index.ts`, so lg-33's
  `api.ts` edits do not meet it.
- `books/src/workbook.ts` reads through `ReadOptions.layout`. The
  household's layout is `HOUSEHOLD_LAYOUT`, which is the default. The
  verifications are unchanged.
- "Exactly as before" was checked against the base reader. The base's
  `books/src` (029641b4) was exported to scratch and both readers were run on
  lg-7's and lg-37's fixtures: `lg7: default layout identical true; own
layout identical true` and the same for `lg37`. These are JSON-equal
  readings of 6 548 and 52 690 characters.
- The base's 23 tests in `books/test/workbook.test.ts` and every
  `api/test/workbook-import.test.ts` case pass unchanged.

**What the brief had wrong, or left open, and what was done:**

- **Summary position is not a field.** "Summary rows above or below the
  lines" is expressed by the labels. lg-37's reader already finds `Total` and
  `Montant à déposer` wherever they sit, and one description has to read both
  lg-7's sheets (below) and the household's (above). The description gives
  the names row, the dates row, the first line and the two labels.
- **The salaries label narrowed** from any `Salaire…` to the description's
  `Salaires…`, because the label is now the description's. §8's real row is
  `Salaires bruts`, and every fixture still reads.
- **A CSV has no buckets.** Its rows are read and proven, then returned as
  `unfiled`, never guessed into a bucket. `api`'s import refuses any unfiled
  row. That cannot happen through the command, which always reads the
  household's layout, so that line has no test.
- **A CSV with no balance column** reads as one problem. It names the
  missing balance column and says the rows need matching one for one against
  a statement paste of the same dates (§8) before import. That case's
  "passed" therefore means "the same problem as the correct description".
- **Withdrawal and deposit columns.** Bank exports often split money out and
  money in into two unsigned columns, so the schema takes either `amount` or
  the pair. `csv-balance` uses the pair.
- **Opening balance.** A layout with no carry-overs starts its balance where
  the first row says it stood before that row.
- **"The books matching the workbook" is not in the score.** It is `api`'s
  check after writing, and on empty books it follows from the same movements
  the reader produced. Whether it would catch a layout error the reader
  misses is unmeasured.

**Build 2: what the model is shown** (`api/test/layout/view.ts`). Per sheet
it shows the name and size, the first 12 rows, 6 rows sampled from the
middle and the last 3, with each formula beside its value. That is at most
21 rows a sheet. lg-37's 233 movements show at most 63. Figures are shown,
because a running balance is told from an amount only by how the figures
follow, and in a CSV nothing else tells them apart.

The sizes below are estimated at four characters a token. The API's own
count is recorded per run by the harness and is still unmeasured. The
answer's schema, sent as the structured-output format, adds 5 842
characters (about 1 461 tokens) to each request.

| Fixture        | Sheets | Rows | Sent, chars | ≈ tokens | Masked, chars | ≈ tokens |
| -------------- | ------ | ---- | ----------- | -------- | ------------- | -------- |
| lg7            | 9      | 73   | 5 363       | 1 341    | 5 198         | 1 300    |
| lg37           | 9      | 320  | 10 518      | 2 630    | 9 791         | 2 448    |
| moved          | 7      | 202  | 8 446       | 2 112    | 7 892         | 1 973    |
| english        | 7      | 185  | 8 161       | 2 041    | 7 590         | 1 898    |
| csv-balance    | 1      | 41   | 3 110       | 778      | 2 904         | 726      |
| csv-no-balance | 1      | 33   | 2 857       | 715      | 2 751         | 688      |

**Build 3: six fixtures** (`api/test/layout/fixtures.ts`). Rows come from a
seeded generator, and every name and amount is invented:

- `lg7`: lg-7's workbook, through `.xlsx`.
- `lg37`: summaries above, labels in `B`.
- `moved`: French, every column moved and renamed, oldest first, totals
  below.
- `english`: English, with amount and balance swapped.
- `csv-balance`: a bank CSV with withdrawal, deposit and balance columns.
- `csv-no-balance`: a bank CSV with one signed amount and no balance.

Each fixture's own description reads it with no problem, apart from the
no-balance CSV's one.

**Which wrong descriptions the verifications catch, measured offline.** The
20 cases are pinned in `api/test/layout.test.ts`, "scoring a proposed
layout". `let-through` means the description passes every verification and
imports something else.

- **Caught (refused)**:
  - amount and balance swapped (lg37, english);
  - the order flipped (lg37, moved, csv-balance);
  - person and detail swapped;
  - the summary rows missed;
  - no carry-overs;
  - the periods' first line one row low;
  - the periods' names row wrong;
  - the deposit label wrong;
  - withdrawal and deposit swapped;
  - amount and detail swapped in the no-balance CSV.
- **Let through**:
  - **the two buckets' labels swapped**: every carry-over still matches,
    because the carry-over rows swap with the movements;
  - detail and note swapped;
  - no person column (every row reads as joint);
  - the period sheets missed;
  - the salaries missed;
  - the no-balance CSV's order flipped.
- **Same import** (harmless): an incomplete `ignored` list.

So a model's description can pass the books and still be wrong in what it
leaves out or swaps symmetrically. The live run's `let-through` column
counts how often that happens, rather than arguing it.

**Fold-in.** The Why section's "lg-37, PR #528, unmerged" is corrected:
lg-37 merged as aba691b2. Nothing else was made free.

**Done when, as of this build:**

1. Proven. The refactored reader imports lg-7's and lg-37's fixtures as
   before, each through its own description: `api/test/layout.test.ts`,
   "lg-7's and lg-37's workbooks read the same through their own
   descriptions as through the household's", together with the unchanged
   reader and import suites. A mutation that drops `Total` from the
   household's summary labels turns it red, along with lg-37's summary test.
2. Proven. The schema rejects a description that names a role twice or names
   no amount column: `contract/test/layout.test.ts`, "refuses a role named
   twice" and "refuses a description with no amount column". Each test was
   turned red by a mutation that removes its rule.
3. Unproven (scope): the measurement table needs the owner's run. The table
   of layout failures above is offline.
4. Unproven (scope): the recommendation and the owner's build-or-drop
   decision follow the run.

### 2026-10-18 — round 1, after gate 1

Gate 1 (at `029641b4..782eb382`) returned CONCERNS, with one med, eleven
lows and no high.

**The question, and the owner's answer.** The orchestrator asked the owner
which findings this round should fix. The recommended option was the med
only. The full list of options is in the orchestrator's record of the
question, not here.

**On 2026-10-18 the owner chose the med plus the three harness CLI lows.**
That goes beyond the recommended option. The other ten lows stay recorded in
the gate's report and are not fixed here.

**Fixed.** Each fix comes with a test appended to
`api/test/layout-live-gate.test.ts`, under "the layout measurement's
harness, round 1". All four tests failed against 782eb382's harness and pass
on the fix: `4 failed | 5 passed (9)`, then `9 passed (9)`.

- **med: `ANTHROPIC_CUSTOM_HEADERS`.** The SDK applies this variable
  whatever the client is given, and a header in it can replace the key or
  change what a request bills.
  - `assertLiveRunConsent` now refuses it, as `loadReceiptReaderConfig`
    does (pl-39). A blank value counts as unset, and the value is never
    repeated.
  - `anthropicAsk`'s comment, which said every environment-read option was
    given, is corrected.
  - The test is "refuses ANTHROPIC_CUSTOM_HEADERS beside the key, and never
    repeats its value".
  - End to end: with consent, a dummy key and the gate's demo header, the
    harness exits 1 with "Refusing: ANTHROPIC_CUSTOM_HEADERS is set". It
    stops there, before any client exists.
- **low: `--out` inside the repository** is now refused, however it is
  spelled. The repository is the tree the harness file is in, so a run from
  a worktree does not refuse an `--out` that is inside the shared checkout.
  The test is "refuses an --out inside the repository, however it is
  spelled".
- **low: `--out=/tmp/a=b`** keeps everything after the first `=`. The test
  is "keeps everything after the first = as the value".
- **low: an unknown `--fixtures` name** is refused, and the message names
  it. The names come from `LAYOUT_FIXTURE_NAMES` in `api/test/layout/fixtures.ts`.
  The test is "refuses a --fixtures name that is no fixture, naming it".

The gate's `cli-probe.mts`, run on the fix, now gives:

- `--out=/tmp/a=b` → `out="/tmp/a=b"`;
- an `--out` inside the repository → refused;
- `lg7,lg-37` → refused, naming `lg-37`.

Still no model call and no spend.

### 2026-10-18 — fixed at landing

- 2026-10-18 — Fixed at landing by owner choice: gate 2, the `--out` guard
  low — "the guard tests `inside.startsWith("..")` on the relative path, so a
  directory inside the tree whose name starts with two dots (`<tree>/..hidden`,
  `<tree>/..x/y`) reads as outside and is accepted." The condition in
  `api/test/live/layout-run.ts` now refuses unless `inside` is `..`, or starts
  with `..` and a path separator, or is absolute, with the `inside === ""`
  refusal kept, as the gate's remedy states. No test added, by the owner's
  choice; the symlink and `--model` gaps in the same finding stay recorded.
  `npx vitest run tools/ledger/api/test/layout-live-gate.test.ts` →
  `Tests  9 passed (9)`. A probe of `parseCli` with `--out`, before and after:
  `<tree>/..hidden` and `<tree>/..x/y` went from `ACCEPTED` to `refused`;
  `<tree>/results` and the tree itself stayed `refused`; the parent
  `<tree>/..`, `<tree>-sibling/a` and `/tmp/ok` stayed `ACCEPTED`.
- 2026-10-18 — Fixed at landing by owner choice: gate 2, the note that the
  Log's owner command "does not say how to unset it". The paragraph above the
  command now gives both ways. `sed -n 108,110p
tools/ledger/docs/work/lg-38-a-model-reads-a-workbooks-layout.md` → the
  lines `refuses to run with it set (gate 1's med, fixed in round 1 below).
Unset it`, `with ` + `unset ANTHROPIC_CUSTOM_HEADERS` + ` in the shell
first, or put` and `env -u ANTHROPIC_CUSTOM_HEADERS` + ` in front of each
command. Run it`.
