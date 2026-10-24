---
id: lg-38
tool: ledger
title: Measure whether a model can describe an unknown workbook's layout well enough to import it
kind: work-package
status: done
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

### Gate 2

**Gate: PASS for the slice (two rows `unproven (scope)`)** — 2026-10-18 · `782eb382..a8e98b8b` (the round's two commits, read first-parent with merges excluded; the two merges from main were not reviewed beyond running the round's tests beside them) · Sonnet 5.5, depth full for the round

Scope is unchanged: the owner's answer of 2026-10-18, "build only", and for the round the owner's choice to fix the med plus the three `parseCli` parts. No model call, no `LEDGER_LIVE_RUN`, no spend. Nothing I found is a `high`, and no third gate is needed. Whether the ticket lands `ready` or `in-flight` with the two scope rows open is the author's call; the Log says `ready`.

**Verdicts on gate 1's findings**

- **med** · `ANTHROPIC_CUSTOM_HEADERS` · **fixed.** `assertLiveRunConsent` refuses any non-blank value, after the `LEDGER_LIVE_RUN` and key checks and before `parseCli` and before the only `new Anthropic` (`main` calls them in that order). Checked: 5 spellings of a set value refused (a header, a key-bearing header, two lines, no colon, padded), 5 blank spellings allowed (empty, spaces, newline, tab-and-space, no-break space), and a client built with the harness's options under each of those values carries no header for any blank one, so allowing blank is safe: the SDK reads the variable with `trim() || undefined`, as the harness does. The message is fixed text and never contains the value (a secret-looking value was not echoed; making the message echo it turns the test red). The test is `api/test/layout-live-gate.test.ts` › "refuses ANTHROPIC_CUSTOM_HEADERS beside the key, and never repeats its value"; disabling the refusal turns it red. Not re-run: the Log's end-to-end refusal with consent set, because it needs `LEDGER_LIVE_RUN=1`.
- **low** · `parseCli`, three parts:
  - `--out=/tmp/a=b` · **fixed.** Gives `out="/tmp/a=b"`; reverting the parse turns › "keeps everything after the first = as the value" red.
  - a `--fixtures` name that is no fixture · **fixed.** Refused, naming it, with the valid names: `--fixtures names lg-37, which is no fixture (lg7, lg37, moved, english, csv-balance, csv-no-balance).` Disabling it turns › "refuses a --fixtures name that is no fixture, naming it" red.
  - `--out` inside the repository · **fixed in part.** Refused for the tree the harness file is in, in every spelling I tried that stays on that tree's paths (relative, `.`, trailing and doubled slashes, `..` escapes that come back in, an unexpanded `~` from the tree root, `--out=` form); disabling the guard turns › "refuses an --out inside the repository, however it is spelled" red. Clauses that remain: the first new finding below, and a run from a worktree not refusing an `--out` in the shared checkout, which the Log states and which the Log's "from the repository root" instruction covers.
- The other ten gate-1 lows were not touched by the round and stay recorded, not regraded.

**Findings in the round's lines**

- **low** · `--out` guard · the guard tests `inside.startsWith("..")` on the relative path, so a directory inside the tree whose name starts with two dots (`<tree>/..hidden`, `<tree>/..x/y`) reads as outside and is accepted. Also not refused: an `--out` reached through a symlink into the tree, and a `--model` containing `../` (the records go to `out/model`). The test title and the Log say "however it is spelled", which is false for those spellings; the direction is unsafe but what would land is synthetic answers and scores, never the key, and no caller spells a path this way, so low. Remedy tried on a scratch mutation: comparing `inside !== ".."` and `!inside.startsWith(".." + path.sep)` refuses `..hidden` and `..x/y` while `..` (the parent) and a sibling sharing the name's prefix stay accepted, and the 9 tests still pass.
- **low** · `LAYOUT_FIXTURE_NAMES` in `api/test/layout/fixtures.ts` is a hand-kept copy of the names `layoutFixtures()` returns, and nothing pins the two together: adding a name that is no fixture leaves `layout-live-gate.test.ts` and `layout.test.ts` green (38 tests), and `--fixtures` would again accept and silently ignore it. No live call site until a fixture is added or removed.
- **findings** · the hunt in the round's lines returned 2; 2 carried (0 med, 2 low), 0 dropped.

**Round-level checks.** `api/test/layout-live-gate.test.ts` against the previous head's harness files: `4 failed | 5 passed (9)`; on the new head `9 passed (9)`, as the Log says. Ledger project at the new head, beside the merged lg-53 source: 66 files, 1,309 tests pass. `npm run check` exit 0. The Log's owner command parses as written once the placeholders are filled (`--out ~/ledger-layout-lg38` resolves outside the tree, `--runs 5 --max-usd 5` accepted, the same for the Sonnet line) and now says `ANTHROPIC_CUSTOM_HEADERS` must be unset; the Log does not say how to unset it, the harness's own message says "Unset it" and refuses before anything is spent. The paths earlier findings rest on that the merges touched (`tools/ledger/api/package.json`, `tools/ledger/books/src/index.ts`) were re-read: the dependency lists are unchanged, so the undeclared `@anthropic-ai/sdk` low still stands.

| Done when | At `a8e98b8b`                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | **proven** as at gate 1; `api/test/layout.test.ts`, `books/test/workbook.test.ts` and `api/test/workbook-import.test.ts` pass in the 66-file run, and the round touched none of the reader. |
| 2         | **proven** as at gate 1; `contract/test/layout.test.ts` passes in the same run.                                                                                                             |
| 3         | **unproven (scope)** — the owner's answer of 2026-10-18; the owner's run with the Log's command.                                                                                            |
| 4         | **unproven (scope)** — same.                                                                                                                                                                |

CI on the pull request at this head: `check` (twice), `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review` and `test (ubuntu-latest)` passed; `test (windows-latest, informational)` was still pending when I read it, which the lander reads before the push.

- NFR: security — the med is closed, the guard gaps above are low; reliability and maintainability — the unpinned name list; performance n/a.

### Gate 3

**Gate: FAIL** — 2026-10-24 · `4081e30d..571ad077` · Opus 5.5, depth narrow

A filing pull request: it closes lg-38 on the owner's build decision and files lg-66 (`needs-decision`). No `Done when` line was built. The checks came from the dispatch, not the brief: lg-66's Why against lg-56's records, every input lg-66 carries over, its three open decisions, its `Done when` lines, lg-38's entry and status, and lg-66's frontmatter. No source changed in the range (`git diff --stat 4081e30d 571ad077 -- tools/ledger/api tools/ledger/books tools/ledger/contract tools/ledger/receipts` prints nothing). No model was called. PR #623's CI at `571ad077`: `check` (twice), `changes`, `codeql`, `CodeQL` and `dependency-review` pass, and the `test` matrix is skipped (all-`.md`).

| Check (from the dispatch)                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lg-38 Done when 1: the reader imports lg-7's and lg-37's fixtures as before                 | **proven** — `api/test/layout.test.ts` › "lg-7's and lg-37's workbooks read the same through their own descriptions as through the household's". It passes at the head.                                                                                                                                                                                                                                                                                                                                              |
| lg-38 Done when 2: the schema rejects a role named twice or no amount column                | **proven** — `contract/test/layout.test.ts` › "refuses a role named twice" and › "refuses a description with no amount column". Both pass at the head, with the test above (3 run, 68 skipped of 71).                                                                                                                                                                                                                                                                                                                |
| lg-38 Done when 3: the measurement table, and whether each failure was caught               | **verified** by reading — lg-38's Log holds its own two `summary.md` tables and the per-failure account, and points to lg-56's.                                                                                                                                                                                                                                                                                                                                                                                      |
| lg-38 Done when 4: the recommendation, then the build filed or dropped by the owner         | **verified** by reading — the recommendation is in lg-38's Log (the 2026-10-18 entry and the pointer to lg-56's), and the new entry records the owner's choice of option 1 with the question word for word and the four options in order. lg-66 is the filed build. `status: done` fits `docs/01-TICKETS.md`, since every line is proven or verified and nothing is `awaiting`. F9 is a low on the entry.                                                                                                            |
| lg-66's Why: every number                                                                   | **verified** — 18 of 18 stated figures recomputed from the 300 records by `why-check.mjs`, and the 10 let-through answers re-read through `readWorkbook` (each `outOfOrder=2 problems=0`; correct description 0 and 0). Positive control: the bound changed from 23% to 13% in a scratch copy is flagged (`MISSING`, exit 1). F6 is a low.                                                                                                                                                                           |
| lg-66's carried-over inputs                                                                 | **verified** for each code-level claim at the base: the `empty-columns-csv` test asserts `[0, 32]` and `problems` equal to `[]`; `importWorkbook` calls `readWorkbook` with no `layout`; `api/test/workbook-import.test.ts` has no test of the `unfiled` guard; the reader never reads `layout.ignored`; 6 of 20 Haiku `lg7` answers list `Accueil` as ignored and as the salaries sheet; every CSV fixture reads 0 movements and all its rows as `unfiled` under its correct description. lg-7's quote is F7 (low). |
| lg-66's three open decisions: each cost true and complete, Build follows the recommendation | **not met** — F1 and F2 (high), F4 and F5 (med).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| lg-66's `Done when` lines: enumerable and gradeable                                         | **not met** — Done when 8 cannot be met as written (F3). Lines 1 to 7 and 9 to 12 are enumerable and gradeable.                                                                                                                                                                                                                                                                                                                                                                                                      |
| lg-66's frontmatter, and `npm run status -- --show lg-66`                                   | **verified** — every field is in the format's lists, `status: needs-decision` sits beside `## Decision — open`, and status prints "waiting on a decision — not startable until someone answers it". `difficulty` was not re-rated.                                                                                                                                                                                                                                                                                   |

- **high** · F1 · Decision 3 (c)'s cost says "What the import then does is unmeasured." That is false, and one offline command measures it. Reading lg-7's fixture through each of the six actual answers with `salaries: null`, which is how a reader honouring `ignored` reads them (lg-66's own words), scores `let-through` in 6 of 6. The salaries read as none and nothing refuses it. The base suite already pins the same mistake on lg-37 ("the salaries missed": `let-through`). So (c) turns six correct imports into six wrong ones that nothing refuses. Text that calls this "unmeasured" makes (c) look safer than it is, in an option the owner is about to choose from. (The scorer's `verified` compares the reader's `problems`. `importWorkbook`'s own extra checks were not run on these six.)
- **high** · F2 · The sent schema is not pinned, and the recommended Decision 3 (a) changes it. The answer schema's `.describe()` texts go to the model as the structured output's format: 5,842 characters, including "read as none of the above". `layoutRequest` contains that phrase for 0 of 13 fixtures. So Build 1's promise that "a change to what is sent is a deliberate edit of a pin" is not kept by Done when 1, which pins only `layoutRequest`. Decision 3 (a) says it "keeps the behaviour that was measured", but its own remedy rewrites that very text, so it changes what Haiku is sent without moving any pin. Both claims fail in the unsafe direction. Direction for a fix: pin the format schema too (for example, the sha256 of `JSON.stringify(zodOutputFormat(workbookLayoutSchema).schema)`), and state in (a)'s costs that the measurement was taken with the old text.
- **med** · F3 · Done when 8 depends on it · Build 3.3's bounds cannot be enforced the way Done when 6 and 8 require. Done when 8 says the server refuses an upload "over each bound … before it parses the workbook". Of the five bounds, only bytes can be checked before parsing: sheets, rows and cells, a cell's text length and the request's size all need the parsed file. "The length of a cell's text sent" reads as a truncation, yet Done when 6 and 8 want a refusal for every bound. The request's size "counted in the API's tokens" has no stated way to be counted without a call to the API, and Done when 6 wants the fake called zero times.
- **med** · F4 · no `Done when` line depends on it · The behaviour of the recommended Decision 2 (a), "A CSV is refused with a plain message", has no Build step and no `Done when` line. Build 3.1's describe request takes "the file" with no type check.
- **med** · F5 · no `Done when` line depends on it · Decision 2 (a)'s costs leave out a fact the owner is choosing from. The one failure the owner's new guard (the date column on screen) answers was seen only on a CSV, `bank-two-dates`. Under workbooks only, the six workbook fixtures had 0 let-through in 120 Haiku runs (shown: 59 right and 1 refused; masked: 60 right). The guard would protect against nothing the measurement observed.
- **low** · F6 · "Sonnet 14.4 times that" reads as 14.4 times $0.000998. The ratio is against Haiku shown on the four fixtures ($0.001089). Against $0.000998 it is 15.7. This is false in the safe direction (it understates Sonnet's price), and nothing chosen rests on it.
- **low** · F7 · lg-66 quotes lg-7 as "a command and not a route" and "never a route". lg-7's Build says "A command, not a route" and "It is a one-off, and it has no reason to exist on the network". The quoted words are not lg-7's, the reason it gives (a one-off) is dropped, and "run by the owner" is not in lg-7. Nothing relies on the exact words.
- **low** · F8 · Decision 1 (b) says that under (b), Build 3 and 4 and Done when 5 to 9 are rewritten. Done when 11 ("through the web screen") assumes (a) as well, and is not listed.
- **low** · F9 · lg-38's entry gives option 2 a description ("puts the reader's existing `outOfOrder` list to the user … Unmeasured beyond the one fixture"), placed as the option's text. The dispatch's record of the question carries only the label. Whether the owner was shown that text is unverified.
- **dropped** · Done when 10's "(lg-56's Log, the fixture's three pieces of evidence)": the `Paiement prêt` rows are one of the three. This is a loose pointer, not a claim.
- **dropped** · "lg-56 gate 4, F9" against lg-56's landing line "gate 2, F9": F9 is in lg-56's `### Gate 4` section, so lg-66 is right.
- **dropped** · the `empty-columns-csv` test's title says "skips none" while it asserts 32 skipped. This predates the range, and lg-66 quotes both correctly. The builder of Done when 3 edits that test anyway.
- **dropped** · lg-66's frontmatter `title` differs from its H1. I found no rule against it in the format's field table. Not checked further at this depth.
- **findings** · the hunt returned 13; 9 carried (2 high, 3 med, 4 low), 4 dropped.
- NFR: security — F3 (upload bounds), otherwise n/a for a filing · performance n/a · reliability — F1, F2 · maintainability — F4, F8.

### Gate 4

**Gate: FAIL** — 2026-10-24 · `571ad077..b0788d12` · Opus 5.5, depth narrow

Round 1 of a filing pull request, one commit (`b0788d12`). No `Done when` line was built. The checks came from the dispatch: gate 3's nine findings, the figures, quotes and Done when lines the round added, and the two `status:` lines. No source changed in the range (`git diff --stat 571ad077 b0788d12 -- tools/ledger/api tools/ledger/books tools/ledger/contract tools/ledger/receipts` prints nothing). No model was called. PR #623's CI at `b0788d12`: `check` (twice), `changes`, `codeql`, `CodeQL` and `dependency-review` pass, and the `test` matrix is skipped (all-`.md`).

| Check (from the dispatch)                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 3's nine findings                                                | **verified** — F1 to F9 fixed, each verdict below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The round's new figures                                               | **verified** — `round.mjs` recomputed them from the 300 records: 18 of 18 phrases found. These are the 59/1/60 split (0 let-through in 120), the 9 of 10 and 1 of 10, $0.001089, $0.015646, 14.4, 15.7, $0.1297, "6 of 6", the lg-7 quotes and lg-38's four option texts. Positive control: "6 of 6" changed to "5 of 6" in a scratch copy is flagged (`MISSING`, exit 1). Gate 3's `why-check.mjs` finds 17 of 18. The one missing phrase is the old "Sonnet 14.4 times that", which F6 replaced. Every figure it computes is unchanged. |
| The 14-hash pin (Build 1, Done when 1)                                | **verified** — `JSON.stringify(zodOutputFormat(workbookLayoutSchema).schema)` exists and is 5,842 characters, with "read as none of the above" in it. `layoutRequest` contains that phrase for 0 of 13 fixtures. The `format` object is what `layout-run.ts` passes as `output_config.format`. N2 is a med on the line.                                                                                                                                                                                                                   |
| Build 3.3, Done when 6 and 8: four refusing bounds and one truncation | **not met** — each bound can now be enforced where the text says. But the reworded order leaves the workbook's inflation unbounded (N1, high).                                                                                                                                                                                                                                                                                                                                                                                            |
| Build 3.1's `PK` check and Done when 13                               | **verified** for gradeability. Done when 13 can be met with `csv-balance`. Opening with `PK` does not mean the file is an `.xlsx` (N3, med).                                                                                                                                                                                                                                                                                                                                                                                              |
| No unscoped quantifier in a `Done when` line                          | **verified**, except Done when 8's "No log line" (N7, low).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Both `status:` lines, and `npm run status -- --show`                  | **verified** — the diff touches no frontmatter line. `--show lg-66` prints `status needs-decision`, and `--show lg-38` prints `status done`.                                                                                                                                                                                                                                                                                                                                                                                              |
| The owner's-answers entry                                             | **verified** by reading against the dispatch's three answers. No `## Decision — open` question is answered.                                                                                                                                                                                                                                                                                                                                                                                                                               |

Gate 3's findings:

- **F1 (high): fixed.** Decision 3 (c) now states the 6 of 6 `let-through` that `probe.mts` prints on this head. The count is incomplete (N4).
- **F2 (high): fixed.** Build 1 and Done when 1 pin the format schema. Decision 3 (a) says it changes what is sent and that the 300 runs used the old text.
- **F3 (med): fixed.** It was fixed as the owner chose, and each bound is placed where it can be known. The new order is N1.
- **F4 (med): fixed.** Build 3.1 now has the `.xlsx`-only step, and Done when 13 is new. The check it names is N3.
- **F5 (med): fixed.** The workbook fixtures recompute as shown: 59 right and 1 refused. Masked: 60 right. The date failure is 9 of 10 shown and 1 of 10 masked, all on the CSV `bank-two-dates`.
- **F6 (low): fixed.** The Why now gives $0.001089, $0.015646, 14.4 and 15.7.
- **F7 (low): fixed.** Both quotes are in lg-7's ticket word for word.
- **F8 (low): fixed.** Done when 11 and 13 are listed. Done when 10 says "the confirmation", not "the screen".
- **F9 (low): fixed.** lg-38's entry quotes all four of the dispatch's texts word for word (4 of 4).

New, in the lines the round touched:

- **high** · N1 · Done when 8 depends on it · The bounds as reworded leave the parse of a hostile upload unbounded. Only bytes are checked before the parse. `readSheets` hands the upload to exceljs, which inflates every entry whole (`entry.async('nodebuffer')`). Sheets, rows and cells are counted only after that. Measured at this head through the base's `readSheets`: a real one-sheet workbook padded with whitespace is 210,368 bytes. It read in full in 1,823 ms, and RSS rose by 215 MB. Decision 1 (a) puts the risk to the owner as "a hostile `.xlsx` is parsed by the server, hence Done when 8". A build that meets the reworded Done when 8 still parses such a file. This is false in the unsafe direction, in an option the owner is about to choose. **Open decision, both remedies unrun:** (1, recommended) a sixth bound, on the workbook's inflated size, checked before exceljs inflates it, with a test using a file like the one above; (2) parse in a worker thread with `resourceLimits`, refusing the upload when the worker dies. Under either, Decision 1 (a)'s cost should say the parse is bounded by that and not by Done when 8 alone.
- **med** · N2 · Done when 1 depends on it · Done when 1 requires a test that fails when the schema's sha256 "differs from its value at the base". Build 2.4 edits a `.describe()` text under the recommended Decision 3 (a), so the hash must differ from the base. Read literally, the line cannot be met under the recommended option. Its last sentence ("a deliberate edit of the second pin") points the other way. Direction: pin "the value the Log gives", the base's or the deliberately edited one.
- **med** · N3 · no `Done when` line depends on it · Build 3.1 judges an `.xlsx` by its opening `PK`. Measured through `readSheets`: a CSV whose first header is `PK ID` passes that check and reaches the sheet reader. It is refused with exceljs's "Can't find end of central directory" reason, not the plain "only an `.xlsx`" message. A zip that is not a workbook passes too and reads as 0 sheets, with no error. Build 3.1 then "builds the request, makes **one** model call" on an empty view, and no bound stops it, since the sheets bound is an upper one. Direction: refuse a reading of 0 sheets before anything is sent, and add a non-workbook zip to Done when 13.
- **med** · N4 · no `Done when` line depends on it · Decision 3 counts the self-contradicting answers as 6. There are 8 in the 300: Haiku's shown `english-8` and `english-10` also list `Home` as ignored and as the salaries sheet. Read with `salaries: null`, both score `let-through` too (8 of 8). So (b) would refuse 8 correct imports and (c) would let 8 wrong ones through. The text understates both costs. The recommended option, (a), is unchanged.
- **low** · N5 · "multiplied by 2.3, the upper end of the 2.2 to 2.3 ratio". The measured upper end is 2.314 on `lg37` in lg-38's own table (9,468 / 4,091), and 2.314 to 2.317 in lg-56's 300 records. ×2.3 under-counts that request by about 0.7%. That is the unsafe direction, but the bound is stated as an estimate, and nothing chosen turns on 0.7%.
- **low** · N6 · The round's Log entry for F1 shows a summary of the probe's output inside a code block, as if printed ("shown/lg7-10, -3, -6, -9 and masked/lg7-1, -10: …"). The probe prints one line per file. The six files match.
- **low** · N7 · Done when 8's "No log line holds the file's content" names no scope. It can be graded only for the test uploads. Direction: scope it to the describe and confirm requests of Done when 5, 8 and 13.
- **dropped** · whether `zodOutputFormat(...).schema` is what is sent: `layout-run.ts` passes that `format` as `output_config.format`. Not a defect.
- **dropped** · Decision 1 (b) not listing Done when 10. That line says "the confirmation", which a terminal can show. Not a defect.
- **findings** · the hunt returned 9; 7 carried (1 high, 3 med, 3 low), 2 dropped.
- NFR: security — N1, N3 · performance — N1 · reliability — N2, N4 · maintainability — N6, N7.

### Gate 5

**Gate: CONCERNS** — 2026-10-24 · `b0788d12..fac223c7` · Opus 5.5, depth narrow

This is round 2 of a filing pull request, one commit (`fac223c7`), touching only lg-66's ticket. No `Done when` line was built. The checks came from the dispatch: gate 4's seven findings, N1's fix above all, the round's new assertions above `## Log`, and the two `status:` lines. No model was called. PR #623's CI at `fac223c7`: `check` (twice), `changes`, `codeql`, `CodeQL` and `dependency-review` pass. The `test` matrix is skipped (all-`.md`).

| Check (from the dispatch)                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1's fix: the sixth bound can be built with what the api already has                  | **verified** — `inflate.mts` on gate 4's padded workbook (210,368 bytes). A hand parse of the central directory reads the declared total, 209,730,504 bytes, in 0 ms with RSS +0. `node:zlib`'s `inflateRawSync` with `maxOutputLength` stops a lying entry at 8 MiB with a `RangeError` in 2 ms. A `createInflateRaw` counter stops 16,384 bytes over (one default chunk). jszip has the declared size only as the internal `_data.uncompressedSize`, and the api does not declare jszip. The base's `readSheets` given the lying zip inflates it whole (705 ms) and only then throws jszip's "uncompressed data size mismatch". So the brief is right that a stop is needed. |
| N1's fix: Done when 8's two inflate tests are gradeable without measuring the machine | **verified, with a gap** — both tests read a spy's count, not RSS. A crafted zip that understates its sizes takes a few lines to build. But neither test requires the sheet reader to be uncalled (P1, med).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Decision 1 (a)'s cost                                                                 | **verified** — its figures match gate 4's. `upload.mts … 40` gave 47,297 bytes, +93 MB, 405 ms here, against the text's +79 MB, 416 ms; that is the machine. "Bounded by the sixth bound" holds for a build that meets Build 3.3. Its "which Done when 8 tests" is weakened by P1.                                                                                                                                                                                                                                                                                                                                                                                             |
| N3's fix: Build 3.1's entry test and Done when 13                                     | **verified, with a gap** — an exceljs-written workbook holds both `[Content_Types].xml` and `xl/workbook.xml`. Re-run with `upload.mts`: the `PK ID` CSV and the one-entry zip still reach the reader at the base, and Done when 13 (ii) and (iii) now name them. The "two entries, no sheet" case reads 0 sheets only when `xl/workbook.xml` is a valid workbook (P3, low).                                                                                                                                                                                                                                                                                                   |
| The round's phrases, scoped above `## Log`                                            | **verified** — `check.mjs`: 23 of 23 expected phrases are present and 5 of 5 retired phrases are absent (exit 0). Positive control, two plants: with Done when 8 (ii) deleted, it flags 2 MISSING (exit 1). With the counted stop cut to "declared sizes only", it flags 1 MISSING (exit 1).                                                                                                                                                                                                                                                                                                                                                                                   |
| Both `status:` lines; no Decision answered                                            | **verified** — the round's diff has no frontmatter line. `status -- --show` prints `needs-decision` for lg-66 and `done` for lg-38. The headings above `## Log` are unchanged, and `## Decision — open` keeps its three questions. `oxfmt --check` passes on the file.                                                                                                                                                                                                                                                                                                                                                                                                         |

Gate 4's findings:

- **N1 (high): fixed.** Build 3.3 has the sixth bound in the right order: the declared total from the central directory first, then an inflate stopped by counting the bytes it produces. Done when 6 and 8 test it, and Decision 1 (a) now says the parse rests on it. Every mechanism the text needs was run and exists (rows above). Its tests have a gap, P1.
- **N2 (med): fixed.** Done when 1 now pins "the value the Log gives": the base's value, or the edited one under Build 2.4.
- **N3 (med): fixed.** The xlsx judgement now reads the zip's own entries, a 0-sheet read is refused before any call, and Done when 13 covers the cases gate 4 measured. P3 is a low on one of its fixtures.
- **N4 (med): fixed in part.** `ignored.mts` prints 8 lines, all `salaries-null outcome=let-through`: six `lg7` answers and Haiku's shown `english-8` and `english-10`. The records hold 260 Haiku answers (130 shown, 130 masked) and 10 shown `english`. The intro, (a), (b) and (c) say 8. What remains: (c)'s parenthetical still says `importWorkbook`'s checks "were not run on these six". It is graded low, since nothing chosen rests on that count.
- **N5 (low): fixed.** `round.mjs` prints `max ratio: 2.317`, with `lg37` at 2.314 to 2.317. lg-38's Log defines the ratio against "Build 2's estimate … with the 1,461 tokens for the answer's schema added", which is what Build 3.3 now multiplies by 2.32.
- **N6 (low): fixed.** Gate 3's `probe.mts` re-run prints the six lines the block shows, word for word. The `...` is disclosed.
- **N7 (low): fixed.** Done when 8's log clause is scoped to the describe and confirm requests of Done when 5, 8 and 13, and graded by reading every logger line.

New, in the lines the round touched:

- **med** · P1 · Done when 8 depends on it · Done when 8's tests (i) and (ii) assert a refusal and the inflate spy's count. They do not assert that the sheet reader is uncalled, as the byte-bound test beside them does. exceljs's `xlsx.load` runs its own `entry.async` on every entry and offers no hook into it. So the counted inflate is a pass the build adds, and the spy wraps that pass, not exceljs. Reproduced on a toy build that calls `readSheets` before its declared-size check (`order.mts … 200`): "refused (inflated size); inflate spy=0 bytes -> DW8 (i) as written PASSES; sheet reader calls=1 … rss +227 MiB, 1852 ms". Done when 8 (i) passes on the very order N1 exists to forbid, and Decision 1 (a)'s "which Done when 8 tests" leans on it. Graded med and not high because Build 3.3 itself requires the order ("checked before exceljs inflates anything"). Only the test is short. Direction: add "and the sheet reader is not called" to (i) and (ii). Under a streaming parse that is itself the reader, the spy must wrap the reader's own inflate instead.
- **low** · P2 (N4's remainder) · Decision 3 (c) says `importWorkbook`'s further checks "were not run on these six". The round's count is 8. This is false in the unsafe direction about a detail nothing chosen rests on.
- **low** · P3 · Done when 13 says "a zip with the workbook's two entries and no sheet reads as 0 sheets". Measured with `inflate.mts`: that holds only when `xl/workbook.xml` is a valid workbook with an empty `<sheets/>`. An empty `xl/workbook.xml` makes `readSheets` throw `BAD_REQUEST` ("Cannot read properties of undefined…"), and text in it gives a parse error. Both are typed refusals with the fake uncalled. So a test built on either fixture passes without reaching the 0-sheet refusal. Such a file also gets the parser's reason, not Build 3.1's plain message. Direction: name the fixture's `xl/workbook.xml` and assert the 0-sheet refusal's own code or message.
- **low** · P4 · Done when 8 (i) points at "the file `upload.mts` builds in gate 4's directory". That is a session scratch path no later builder will have, and the line's own description is enough to build the file. "At 40 and at 200 MiB of padding" also assumes an inflated bound under 40 MiB, which no line states. Direction: drop the path, and say the bound is under the smaller padding.
- **low** · P5 · `nfr:maintainability` · Build 3.3's "a counting wrapper in front of the inflate" can be read as wrapping exceljs's own inflate, which exceljs does not offer (P1). It does not say that the counted pass inflates every accepted file a second time. Two paths were measured to exist: a hand parse of the central directory, and `node:zlib` with `maxOutputLength` or a streaming counter. Both avoid importing jszip, a dependency the api does not declare. Direction: say so in a sentence.
- **dropped** · "The Log gives the 14 hashes" with no hashes in the Log. The words predate the round, and they name the build's Log entry. Not a defect.
- **findings** · the hunt returned 6; 5 carried (1 med, 4 low), 1 dropped.
- NFR: security — P1 · performance — P5 · reliability — P3 · maintainability — P2, P4, P5.

No finding here is a `high`. P1 is a `med` that Done when 8 depends on.

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

### 2026-10-18 — the owner's paid run (Build 4), the recommendation (Build 5), and the owner's answers

The owner ran the harness once per model. The records say how: effort
`medium`, figures `shown`, 5 runs per fixture, 6 fixtures, 2 models, so 60
runs in all. Each run's record and each model's `summary.md` are in
`~/ledger-layout-lg38/<model>/`, outside the repository and not copied into
it. They hold synthetic answers and scores only. This entry carries the
tables, not the files.

**Done when 3 is met by this entry. Done when 4 waits on lg-56**, which
measures again with harder fixtures before the owner decides; see "The
owner's answers" below. `status` stays `in-flight`.

#### The measurement tables

Each model's `summary.md`, verbatim.

`claude-haiku-5-5/summary.md`:

| Model            | Fixture        | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |
| ---------------- | -------------- | ---- | ------ | ------- | ----------- | ------ | ----------- | ------- | ------------------- | -------------------- | ------------------- |
| claude-haiku-5-5 | lg7            | 5    | 5      | 4       | 1           | 0      | 0           | 0       | 6190                | 1214                 | $0.0012             |
| claude-haiku-5-5 | lg37           | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 9468                | 1312                 | $0.0016             |
| claude-haiku-5-5 | moved          | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 8080                | 1248                 | $0.0014             |
| claude-haiku-5-5 | english        | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 7924                | 1216                 | $0.0014             |
| claude-haiku-5-5 | csv-balance    | 5    | 4      | 4       | 0           | 1      | 0           | 0       | 4928                | 563                  | $0.0008             |
| claude-haiku-5-5 | csv-no-balance | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 4787                | 382                  | $0.0007             |
| claude-haiku-5-5 | **all**        | 30   | 29     | 28      | 1           | 1      | 0           | 0       | 6896                | 989                  | $0.0012             |

Outcomes over 30 runs:

- matched: 28
- same-import: 1
- refused: 1
- let-through: 0
- invalid: 0

`claude-sonnet-5-5/summary.md`:

| Model             | Fixture        | Runs | Passed | Matched | Same import | Caught | Let through | Invalid | Input tokens (mean) | Output tokens (mean) | Cost per run (mean) |
| ----------------- | -------------- | ---- | ------ | ------- | ----------- | ------ | ----------- | ------- | ------------------- | -------------------- | ------------------- |
| claude-sonnet-5-5 | lg7            | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 6190                | 348                  | $0.0159             |
| claude-sonnet-5-5 | lg37           | 5    | 5      | 3       | 2           | 0      | 0           | 0       | 9468                | 374                  | $0.0227             |
| claude-sonnet-5-5 | moved          | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 8080                | 338                  | $0.0195             |
| claude-sonnet-5-5 | english        | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 7924                | 332                  | $0.0192             |
| claude-sonnet-5-5 | csv-balance    | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 4928                | 177                  | $0.0116             |
| claude-sonnet-5-5 | csv-no-balance | 5    | 5      | 5       | 0           | 0      | 0           | 0       | 4787                | 142                  | $0.0110             |
| claude-sonnet-5-5 | **all**        | 30   | 30     | 28      | 2           | 0      | 0           | 0       | 6896                | 285                  | $0.0166             |

Outcomes over 30 runs:

- matched: 28
- same-import: 2
- refused: 0
- let-through: 0
- invalid: 0

"Passed" is valid and verified: the answer parsed as a layout and reading
the fixture through it gave the same problems the correct description gives.
For `csv-no-balance` that is the one problem every description of it has,
that nothing proves it; all ten of its runs report `problems: 1`, and all ten
matched.

#### The four runs that did not match

I read these from the records. Each `score` block is quoted.

- **`claude-haiku-5-5/csv-balance-1.json`**: `outcome: "refused"`,
  `valid: true`, `verified: false`, `sameImport: false`, `matched: false`,
  `issues: []`, `problems: 2`, `differences: ["account.yearPerSheet"]`. The
  model answered `yearPerSheet: true` for the one CSV, `releve-2024.csv`;
  every column in its answer is the correct one. **Caught.** The reading
  reported 2 problems, so the import would have been refused and nothing
  would have reached the books. The record keeps the count of problems, not
  their text, so which verification fired is unmeasured.
- **`claude-haiku-5-5/lg7-5.json`**: `outcome: "same-import"`,
  `valid: true`, `verified: true`, `sameImport: true`, `matched: false`,
  `issues: []`, `problems: 0`, `differences: ["ignored"]`. The model listed
  `["Labels", "Budget", "Accueil"]` as ignored; the correct description lists
  `["Labels", "Budget"]`. **Not refused, and nothing wrong was imported**: the
  reading is the same as the correct description's, because the reader never
  consults `ignored` (gate 1's low). Had it consulted it, naming `Accueil`,
  which holds lg-7's salaries, would have been a wrong description; whether a
  check would have caught that is unmeasured.
- **`claude-sonnet-5-5/lg37-2.json`** and **`lg37-3.json`**:
  `outcome: "same-import"`, `valid: true`, `verified: true`,
  `sameImport: true`, `matched: false`, `issues: []`, `problems: 0`,
  `differences: ["account.summary"]` in both. Both answered the summary
  column `C` with the labels `["Solde Dép. Courantes", "Solde Hypothèque",
"Total"]`; the correct description says `["Solde", "Total"]`. **Not
  refused, and nothing wrong was imported**: the reading is identical.

So, of the layout failures, **1 was caught by the verifications, 3 were
harmless and not refused, and 0 were let through** (60 runs, 0 `let-through`
in either table). No answer was `invalid` (0 of 60), so the structured
output's advisory `enum` and `pattern` (gate 1's low) cost nothing here.

#### Cost

Computed from every record's `costUsd` at the prices the run used: Haiku
$0.10 in and $0.50 out, Sonnet $2 in and $10 out, per million tokens. The
totals rebuilt from the token counts agree with the sums of `costUsd`.

|                      | Haiku 5.5 | Sonnet 5.5 |
| -------------------- | --------- | ---------- |
| Runs                 | 30        | 30         |
| Input tokens, total  | 206,885   | 206,885    |
| Output tokens, total | 29,678    | 8,556      |
| Cost, total          | $0.0355   | $0.4993    |
| Cost per run, mean   | $0.001184 | $0.016644  |

The run cost $0.5349 in all. Sonnet is 14.05 times Haiku per run (total cost
over total cost, $0.49933 over $0.0355275). Both models were sent the same requests (the same input tokens, fixture by
fixture), so the input side is the same count and the price decides it.
Haiku wrote about 3.5 times as many output tokens (a mean of 989 against
285); it is still 14 times cheaper.

Build 2 left the API's own input count unmeasured. It reads 2.2 to 2.3 times
Build 2's estimate on every fixture, with the 1,461 tokens for the answer's
schema added to it:

| Fixture        | Estimated, with the schema | Counted by the API |
| -------------- | -------------------------- | ------------------ |
| lg7            | 2,802                      | 6,190              |
| lg37           | 4,091                      | 9,468              |
| moved          | 3,573                      | 8,080              |
| english        | 3,502                      | 7,924              |
| csv-balance    | 2,239                      | 4,928              |
| csv-no-balance | 2,176                      | 4,787              |

The cause is unmeasured. It also bears on the spend stop, whose input term is
the request's characters over two (`layout-run.ts`, gate 1's low): the API's
count is 1.8 to 3.4 times that term on every fixture. The ceiling is still
dominated by its 16,000 output tokens, so the under-count is small beside it,
but "the ceiling is one, not a guess" is not true of the input side.

#### What the run does not cover

- **60 runs, 6 synthetic fixtures, 0 let-through.** By the rule of three, 0 in
  60 puts the let-through rate at no more than about 5% at 95% confidence
  (3/60), and about 10% for one model alone (3/30). **That is an estimate,
  and a weak one.** The five runs of a fixture read one workbook, so they are
  not five independent households; the bound is on these six fixtures, not on
  workbooks in general.
- **The fixtures never exercise gate 1's let-through cases.** Swapped bucket
  labels: every carry-over still matches, so the books take it. Amount
  columns pointing at empty columns: with a carry-over label the carry-over
  check refuses it, and with none, which is every CSV, nothing does (gate 1's
  low: `csv-balance` read through such a layout reads 0 rows and reports 0
  problems). No model chose either, but no fixture invited it either, so the
  0 says the models did not make those mistakes where nothing tempted them.
- **`--figures masked` was not run.** Every run showed figures, so what
  showing them costs, or what hiding them loses, is unmeasured.
- Two bank-CSV shapes only, both synthetic. No real bank export was used,
  by the rule in Notes for the builder.
- One effort setting (`medium`) and one prompt. "The books matching the
  workbook" is not in the score (see Build, above).

#### Recommendation (Build 5)

On these six fixtures, **a model can describe the layout well enough**: 59 of
60 runs passed the verifications and the sixtieth was refused by them, 56 of
60 matched the hand-written description, 3 differed without changing the
import, and 0 were let through. **Haiku 5.5 is sufficient on these
fixtures**: it passed 29 of 30 against Sonnet's 30 of 30 and matched 28 of 30
against 28 of 30, its one failure was caught, and it costs about 14 times
less per import ($0.0012 against $0.0166). A difference of one run in 30 is
not a difference this run can see.

This does not claim the models are reliable on a workbook unlike these six,
nor on the two cases above that no fixture exercises, nor with figures
masked. It is a measurement that did not find a failure, not a proof that
none exists.

#### The owner's answers of 2026-10-18

The orchestrator put four questions to the owner. Decisions A and B were
first the lg-38 builder's recommendations, from its build report, which the
orchestrator relayed. Four answers:

1. **Build or drop (Done when 4).** Options: build (the orchestrator's
   recommendation), drop, or measure more first. **The owner chose "measure
   more first", over the orchestrator's recommendation.** lg-38 stays
   `in-flight`, and lg-56 runs a harder set of fixtures before the owner
   decides.
2. **If built, which model.** Options: Haiku 5.5 (the orchestrator's
   recommendation), Sonnet 5.5, or Haiku with a Sonnet retry on refusal. **The
   owner chose Haiku 5.5**, as recommended.
3. **If built, figures in what is sent (decision A).** Options: shown (the
   lg-38 builder's recommendation, relayed by the orchestrator) or masked.
   **The owner chose shown**, as recommended.
4. **If built, the swapped-label guard (decision B).** Options: confirm on
   screen (the lg-38 builder's recommendation, relayed by the orchestrator), a
   sign check, or both. **The owner chose confirm on screen**, as recommended.

Answers 2 to 4 are for the build if there is one; they decide nothing until
the owner answers 1. lg-56 carries them as context, not as Build.

**Done when, after this entry:**

1. Proven, as at the gates (unchanged by this entry).
2. Proven, as at the gates.
3. **Met.** The tables and the outcomes are above, and each layout failure
   says whether the verifications caught it.
4. **Open, waiting on lg-56.** The recommendation is above; the build is
   filed or the ticket dropped by the owner's decision after lg-56's run.

### 2026-10-18 — gate records

The gate records for the pull request that filed this entry and lg-56 are on PR #552's thread, not in a `## Review` section: gate 1 CONCERNS at `d76699a2`, gate 2 PASS at `1135f0a6`.

### 2026-10-24 — lg-56's measurement is in; Done when 4 is the owner's

lg-56's paid run (Haiku 5.5 shown and masked on 13 fixtures, 10 runs each; Sonnet
5.5 shown on four of them) is reported in [lg-56's Log](./lg-56-measure-the-layout-reader-on-harder-fixtures.md),
entry "2026-10-24 — Build steps 3 and 4". In short: 300 runs, 10 let through, all
on one fixture (`bank-two-dates`, the transaction date read where the posted date
belongs), 0 that changed an amount, balance or detail; no model made the swapped-label or the empty-column mistake; masked
and shown cost the same per run. That entry ends with the recommendation (corrected in its round 1, the entry
after it).
**Done when 4 stays open**: this ticket's `status` is unchanged, and building or
dropping it is the owner's decision.

### 2026-10-24 — the owner's build decision (Done when 4): build, filed as lg-66

**The question, as the orchestrator put it to the owner on 2026-10-24:**
"lg-38's last Done-when line is your decision: file the build as the next
ticket, or close lg-38 as dropped." The options, with the recommendation
first, each with the description the owner was shown (verbatim, as the
orchestrator gave them to the round that fixed this entry):

1. **Build: Haiku + date on confirm.** "The Log's recommendation. Keep your
   2026-10-18 answers (Haiku 5.5, figures shown, confirm on screen), and add the
   date column, with a few rows' dates, to the confirmation screen. This works
   whatever the file holds. I'd dispatch the build ticket's filing and lg-38's
   close as a separate docs PR, roughly $2 to write plus one narrow gate."
2. **Build: Haiku + outOfOrder.** "Same, but the guard puts the reader's
   existing outOfOrder list to the user, to confirm or to refuse. It costs
   nothing new to compute, but it is unmeasured beyond this one fixture, and
   works only if a real export shows inversions under its transaction date."
3. **Build on Sonnet 5.5.** "Sonnet made none of the observed errors in its 40
   runs, 10 of them on bank-two-dates. That is an indication, not a proof. It
   costs about 14 times Haiku per import, still under two cents on these
   fixtures."
4. **Drop lg-38.** "Close lg-38 as dropped: no model reads unknown workbooks.
   lg-56 still lands as the record of the measurement."

**The owner chose option 1.** It was lg-56's recommendation (its entry
"Recommendation for lg-38's Done when 4", as corrected in that ticket's round 1
and at landing) and the orchestrator's, so it overrode no one. The three
answers of 2026-10-18 above stand with it: Haiku 5.5 (over Sonnet 5.5 and over
Haiku with a Sonnet retry on refusal), figures shown (over masked), confirm
on screen (over a sign check, and over both).

**Done when 4 is met**: the recommendation is above, and the build is filed as
the next ticket, [lg-66](./lg-66-import-a-workbook-through-a-layout-a-model-describes.md).
`status` is `done`. What lg-38 left as input for a build is carried into lg-66's
Build and Notes: "reading zero rows must be a problem" (gate 1), the undeclared
`@anthropic-ai/sdk` (gate 1), the `unfiled` guard that has no test (gate 1),
the `ignored` list the reader never consults (gate 1), the bucket labels that
collide by accent (gate 1), the shapes the CSV reader does not read, and the
statement of what leaves the house (Notes for the builder). The harness lows
that concern only `api/test/live/layout-run.ts` (the spend stop's bound, the
summary lost on a stop) stay in the gate
records: lg-66 moves the model call out of that file and leaves its guards
alone.
