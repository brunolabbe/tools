---
id: lg-58
tool: ledger
title: A paste reports the dates it names a day off from the workbook's
kind: work-package
status: done
milestone: null
depends_on: [lg-40]
difficulty: hard
---

# lg-58 — A paste reports the dates it names a day off from the workbook's

## Why

lg-40 (PR #548, merged) lets a pasted row match a workbook row dated otherwise,
and its Build item 2 says that date is "reported rather than refused". It is
not reported. Since lg-59 (PR #564) a paste reads the workbook's rows a block
at a time (`api/src/workbook-days.ts`): a block's dates are up to two days
apart and each pasted row is dated within a day of them, so the workbook row a
pasted row is read as can be dated up to three days from it, not only a day.
lg-61 (PR #586) added a second, wider pass that only refuses.
`ImportStatementReport` in `contract/src/api.ts` has four fields, `rowsAdded`,
`rowsAlreadyPresent`, `tailBalanceCents` and `rowsInInbox` (lg-54, PR #574),
and nothing that names a date. The paste is accepted, the stored row keeps the
workbook's date, the pasted row is dropped, and the stored-paste screen
(`web/src/statements/StatementPaste.tsx`) says nothing about it. The household
never sees that the bank and the workbook disagree on that date, so the
workbook's date stands unchallenged.

(Corrected by lg-58's builder on 2026-10-21. It had said lg-40 was unmerged,
that the match was a day apart at most, and that the report had three fields.)

lg-40's builder recorded the choice in its Log: the report has no field to
carry the date, adding one is a contract change and a screen change, and the
owner chose on 2026-10-18 to file it as a new lg- ticket rather than add it in
lg-40's branch or leave it unreported.

## Build

1. Add an optional `datesDiffering` list to `ImportStatementReport` in
   `contract/src/api.ts`. It is absent, or empty, when no pasted row matched a
   workbook row a day off. Each entry names a day-off row. What an entry holds
   (the bank's date, the workbook's date, the amount, or some of these) is the
   builder's to choose, with the reason in the Log.
2. Fill it in the paste path in `api/src/statements.ts`, where lg-40 accepts a
   day-off match. The list is returned in the paste's response.
3. The stored row keeps the workbook's date, and the pasted row is dropped, as
   lg-40 builds them. A stored row is never edited (`tools/ledger/CLAUDE.md`).
4. On the stored-paste step in `web/src/statements/StatementPaste.tsx`, when the
   list is non-empty, show a line that names the dates in question, and says the
   workbook's date was kept. The wording is an open point below.
5. The `details` and logs rules in `tools/ledger/CLAUDE.md` still apply. The list
   is a response, not error `details`, and no log line may carry its dates. The
   builder confirms in the Log that it did not add one.

## Open points

These are not settled by this ticket. The builder records in the Log what it
did about each, or stops and reports if one needs the owner.

- **The wording of the screen line**, including whether it names both dates or
  only the workbook's.
- **Whether lg-54 carries the same report.** lg-54
  (`tools/ledger/docs/work/lg-54-a-stored-paste-says-its-rows-wait-in-the-inbox.md`)
  also changes the `stored` step in `StatementPaste.tsx`, and its Build item 3
  allows a count to grow `ImportStatementReport`. Whether the two land one
  report, or two, and in which order, is not decided here.

## Done when

- An `api` test in `api/test/statements.test.ts` pastes one synthetic row a day
  off from a workbook row, and gets the paste accepted with the workbook's date
  kept on the stored row and `datesDiffering` naming that row's date.
- An `api` test pastes synthetic rows that all match the workbook on date, and
  gets a report that names no date in `datesDiffering`.
- An `api` test pastes a day-off row and shows the workbook's stored rows are the
  same before and after the paste.
- An `api` test pastes a day-off row and shows no log line carries a date from
  `datesDiffering`, using the existing logging test or an extension of it.
- A web test stores a paste with one row a day off and finds the stored step
  naming that row's date.
- A web test stores a paste with no row a day off and finds no date named on the
  stored step as differing.
- `npm run check` and `npm test -- --project ledger` pass.

## Review

**Gate: PASS** — 2026-10-21 · `2d1b22bb..add2fb9f` · Sonnet 5.5, depth full

| Done when                                                                               | Proof                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A day-off row is accepted, the workbook's date kept, `datesDiffering` names it       | `api/test/statements.test.ts` › "a paste that meets a workbook row dated otherwise says so (lg-58)" › "a pasted row a day off a workbook row is accepted, the workbook's date kept and the row named" ✓ (`toEqual` with the entry, and the stored row's date) |
| 2. Rows that all match on date name no date                                             | same describe › "rows that all match the workbook on date name no date" ✓ (`toEqual` the counts, `not.toHaveProperty("datesDiffering")`; the counts fail on empty output)                                                                                     |
| 3. The workbook's stored rows are the same before and after                             | same describe › "the workbook's stored rows are the same before and after a paste with a row a day off" ✓ (prefix `toEqual` before, and the length is the workbook's plus the one new row)                                                                    |
| 4. No log line carries a date from `datesDiffering`                                     | same describe › "no log line carries a date the report names as differing" ✓ (the log is shown non-empty by `STATEMENT_CHAIN_BROKEN`). I also ran the rival-pass refusal through a debug logger: 0 dates in the log, see the full report                      |
| 5. A web test stores a paste with one row a day off and finds the stored step naming it | `web/test/statement-paste.test.tsx` › "a stored paste with a row the workbook dates a day off names both dates, and the workbook's kept (lg-58)" ✓                                                                                                            |
| 6. A web test with no row a day off finds no date named as differing                    | same file › "a stored paste the workbook agrees with on every date names no date as differing (lg-58)" ✓ (the heading is found, so it does not pass on an empty screen)                                                                                       |
| 7. `npm run check` and `npm test -- --project ledger` pass                              | `npm run check` exit 0 at the head, run by me. The ledger project is proven by CI: `test (ubuntu-latest)` pass on `add2fb9f`. I ran 3 spec files locally, 143 of 143                                                                                          |

CI on `add2fb9f`, one read at the end: 9 of 9 pass (`CodeQL`, `changes`, `check` ×2, `codeql`, `dependency-review`, `docker`, `test (ubuntu-latest)`, `test (windows-latest, informational)`). Nothing pending.

- **low** · no `Done when` line depends on it · `nfr:maintainability` · **open decision, two remedies.** `pairAmounts` in `api/src/workbook-days.ts` pairs the rows left over greedily, in pasted order, so the workbook date a report names is not always the nearest one, and the "fewest days apart" that the headers of `workbook-days.ts` and `matchStretch`, and the doc of `readings` in `statements.ts`, state does not hold within a block. Text false in the safe direction: the number of rows named is always the minimum, and each pair is a real one. Reproduction: a workbook of two +3.00 rows listed 12 Feb then 10 Feb, from 1 000.00, and a paste of +3.00 on the 11th, +3.00 on the 13th, then a new −2.50 on the 14th, gives `datesDiffering` 11th↔12th and 13th↔10th (4 days apart in all); 11th↔10th and 13th↔12th names the same two rows 2 days apart. The brute-force oracle found it in 5 of 11,542 accepted pastes (seeds 1001–20000) and 0 of 600 in seeds 1–1000. (A) make the leftover pairing optimal; (B) narrow the three texts to "a nearby date". **Recommend B**: the rule treats every amount-equal pairing alike, and this hot path took two performance commits to get where it is.
- **low** · no `Done when` line depends on it · `nfr:maintainability` · the plural branch of the screen line ("N rows already stored are dated differently…") has no test on the branch; the web tests cover one row and none. I rendered 2 and 12 rows: the line is right, and the list ("Dates that differ") has 2 and 12 items.
- **low** · no live call site · `nfr:reliability` · `DAY_NUMBERS` in `workbook-days.ts` is a module-level map with no eviction. Its comment bounds it by "a few thousand" stored dates, but the pasted rows' dates enter it too (`matchBlock` parses every part row before the date check can refuse it). Bounded by paste size times the write rate limit, so not a live problem.
- **dropped** · "the report can name the rival pass's pairing": refuted. A planted version (A) is caught by the oracle (7 of 3,637 accepted in seeds 1–6000, seeds 179, 423 and 900 among them inside 1–1000); the branch gives 0 such cases in 20,000 seeds.
- **dropped** · "acceptance changed by reordering `matchPart`'s checks": refuted. 9,000 of 9,000 seeded pastes give the same outcome, error text and stored rows on base and head.
- **dropped** · "the `<p>` line has no accessible name": a paragraph needs none; the list is found by role and name and counts its items.
- **dropped** · "Done when 3's test never asserts `datesDiffering`": its fixture is Done when 1's with another date, and the length companion fails if the row were stored instead.
- **dropped** · "a 3-row paste into a 300-row workbook re-dated by alternating days takes 25 to 43 s at the head": the base takes over 60 s on the same input. Not this branch's, and not in its range.
- **findings** · the hunt returned 8; 3 carried, 5 dropped.
- NFR: security ✓ (no new input, no log line added) · performance ✓ (re-timed in the full report: head faster than base in every shape run) · reliability — above · maintainability — above.
- Nine existing api tests gained `datesDiffering`: each diffed against its own comment, and each matches. Sibling PR #594 (lg-63): `git merge-tree` against its head merges cleanly.
- Not measured: histories holding rows a previous paste stored (the generators build workbook-only histories); days over `LONGEST_SEARCHED_DAY`; the builder's 16-case grid in full (4 of its cases re-timed, plus 24 re-dated shapes and 3 tiny-paste shapes).

## Log

- 2026-10-18: filed by the orchestrator's maintenance dispatch, from lg-40's
  Build item 2 and the owner's choice on 2026-10-18 to file a new lg- ticket
  rather than add the field in lg-40's branch or leave it unreported (lg-40's
  Log, round 1). Reproduction on `origin/main`, `git show
origin/main:tools/ledger/contract/src/api.ts | grep -n -A5
'ImportStatementReport'`, which lists the interface with the three fields and
  no date field. lg-40's branch has the same interface.

- 2026-10-21 — builder (Opus 5.5), built on `main` at `2d1b22bb` (lg-61
  merged). `packages/ui` was linked into this worktree's farm by hand, since
  the farm lacked it.

  **What an entry is (Build 1).** lg-61's Log was right that nothing returned
  a pairing: `matchPart` answered a boolean and `matchStretch` kept only which
  cuts it could reach. A "row a day off" is not a unit the search computes
  either. A block takes dates up to `WIDEST_BLOCK_DAYS` apart, and a pasted row
  may be a day outside them, so the workbook row a pasted row is read as can
  be three days from it (the test "a paste wholly inside the history may start
  three days from the workbook row it starts on" now reports a 3-day pair).
  The unit used is the pairing the match rests on.
  - `matchPart`, `matchBlock` and `matchStretch` now return it: for each
    pasted row, the position of the stored row it is, or `null` where they
    returned `false`.
  - Within a block the rule weighs only amounts, so any pairing amount for
    amount satisfies it. `pairAmounts` picks one: as many rows as possible
    with a row of the same amount and date, then each row left with the
    nearest-dated free row of its amount.
  - Where several cuttings match, `matchStretch` keeps the one naming the
    fewest rows, then the fewest days apart in all, then the first found.
    `readings` does the same across the starts a paste wholly inside the
    history fits from.
  - An entry is a pasted row whose paired stored row has another date:
    `{ bankDate, workbookDate, amountCents }` (`DateDiffering` in
    `contract/src/api.ts`). The bank's date is how the household finds the
    row on its statement. The workbook's is the one kept. The amount is the
    one both sides agree on. The bank's wording is left out: date and amount
    find the row, and the list stays short.
  - `datesDiffering` is absent when empty. That keeps every existing report
    equal to what it was, and the Build allows either.
  - Which pastes are accepted does not change: `matchPart` still makes every
    check it made, in another order, and the pairing only adds an output. The
    probe below measures it.

  **From the stored pass only (lg-61's handover).** `store` takes
  `datesDiffering` from the `STORED_TOLERANCE` readings. The
  `RIVAL_TOLERANCE` pass's map is read for its keys and nothing else. The two
  can differ. A random search, `rival-probe.mts` (in this session's scratch
  directory, `.../scratchpad/lg-58/build/`), pastes the tail of a synthetic
  bank stretch, with or without a new row, against a workbook of the same 3
  to 6 movements with rows re-dated and swapped. It compares this code with a
  copy that reports from the rival pass. At `dde1d69c` the copy disagreed in
  15 of 8,000 cases at seed 11 and 0 of 8,000 at seed 23. At `40cb260a`,
  before the days-apart tie-break, it was 30 of 8,000 at seed 11. One case is
  now the test "the dates
  named are the stored pass's, never the rival pass's, which reads rows three
  days off": the rival pass names two rows, one of them 3 days off, and the
  stored pass names three.

  **The screen (open point 1, delegated).** Under the stored line:
  "One row already stored is dated differently by the bank and by the
  workbook. The workbook's date was kept." For two or more rows the line
  starts "N rows already stored are". Then a list labelled "Dates that
  differ", one item per row, `-12.34 $: the bank says 2026-03-06, the
workbook 2026-03-05`. It names both dates: the bank's alone would not say
  what was kept, and the workbook's alone would not find the row on the
  statement. It offers no action, because there is none. A stored row is
  never edited.

  **Open point 2 (lg-54).** Moot. lg-54 merged (#574) with `rowsInInbox`, and
  this adds a fifth field to the same report. The two lines sit one above the
  other on the stored step.

  **Build 5, logs.** No log line was added: `git diff 2d1b22bb --
tools/ledger/api/src tools/ledger/web/src tools/ledger/contract/src | grep
-cE "^\+.*(log\.|logger|console)"` → 0. The test "no log line carries a date
  the report names as differing" captures every log line at debug, posts a
  day-off paste and then a refused one (so the log is shown carrying this
  route's lines, `STATEMENT_CHAIN_BROKEN`). It finds neither reported date in
  the log, and the bank's in the response.

  **What the brief had wrong.**
  - Why: lg-40 unmerged, a match "a day apart", three fields. Corrected above,
    in this commit.
  - Build 2: "in `api/src/statements.ts`, where lg-40 accepts a day-off match"
    has had no counterpart since lg-59. Acceptance is block matching in
    `api/src/workbook-days.ts`, so the pairing is made there and the list is
    filled in `statements.ts`.
  - "A day off": a reported pair can be up to three days apart.
  - Open point 2 is moot, as above.

  **Tests**, appended at the end of each file:
  - `api/test/statements.test.ts`, "a paste that meets a workbook row dated
    otherwise says so (lg-58)", four tests: Done when 1, 2, 3 and 4 in that
    order.
  - `api/test/workbook-days.test.ts`, "the pairing a paste reports its
    differing dates from (lg-58)", nine tests: the pairing's own rules, and
    one test per tie-break.
  - `web/test/statement-paste.test.tsx`: Done when 5 and 6.
  - Nine existing api tests accepted a re-dated row with `toEqual` on the
    report. They now carry the dates each reports, checked one by one against
    each test's own comment. R5's, for one, is the pairing its comment calls
    the truth: the bank's +0.31 of the 21st is the workbook's of the 22nd,
    and its −7.77 of the 22nd is the workbook's of the 23rd. The boolean
    assertions on `matchPart`, `matchBlock` and `matchStretch` became
    `not.toBeNull()` and `toBeNull()`.

  **Mutants**, each restored from `9c834fb9` (`mutants2.sh`), on the two api
  spec files:
  - M1, a cutting kept on the first found: 1 of 125 fails.
  - M1b, no days-apart tie-break between cuttings: 1 of 125.
  - M2, a start kept on the first found: 1 of 125.
  - M2b, no days-apart tie-break between starts: survived 125 of 125, and the
    random probe found no separating case in 8,000. Killed by a hand-built
    test, 1 of 47 in `workbook-days.test.ts`.
  - M3, no same-date phase in `pairAmounts`: 1 of 125.
  - M4, reported from the rival pass: 1 of 125.
  - M5, never reported: 12 of 125.
  - M6, the in-place pairing at the wrong offset: 3 of 125.

  **Time.** The first build (`40cb260a`) made `pairAmounts` scan the block once
  per row, with two `Date.parse` calls per candidate, before the balance
  checks that refuse most blocks. On lg-59 gate 1's case shapes (`time.mts`,
  a workbook of same-amount rows on consecutive days, dated alike), 200
  alternating rows inside the history at 200 a date went from 1,092 ms to
  629,893 ms. `9c834fb9` answers a part the workbook lists in place at once,
  buckets the rest by amount and date, and runs it after the balance checks.
  On 16 cases (200 and 1,000 rows, 40 and 200 a date, constant and
  alternating amounts, onto the tail and inside), base `2d1b22bb` and head
  interleaved case by case, at a load average of 6.8 to 6.1 on 12 cores:

  | rows  | a date | amounts     | where  | base ms | head ms | head/base |
  | ----- | ------ | ----------- | ------ | ------- | ------- | --------- |
  | 200   | 40     | constant    | tail   | 1,235   | 487     | 0.39      |
  | 200   | 40     | constant    | inside | 1,018   | 541     | 0.53      |
  | 200   | 40     | alternating | tail   | 593     | 377     | 0.64      |
  | 200   | 40     | alternating | inside | 1,707   | 1,064   | 0.62      |
  | 200   | 200    | constant    | tail   | 1,937   | 992     | 0.51      |
  | 200   | 200    | constant    | inside | 1,894   | 1,067   | 0.56      |
  | 200   | 200    | alternating | tail   | 1,234   | 585     | 0.47      |
  | 200   | 200    | alternating | inside | 1,268   | 622     | 0.49      |
  | 1,000 | 40     | constant    | tail   | 3,299   | 1,700   | 0.52      |
  | 1,000 | 40     | constant    | inside | 3,291   | 1,922   | 0.58      |
  | 1,000 | 40     | alternating | tail   | 2,575   | 1,104   | 0.43      |
  | 1,000 | 40     | alternating | inside | 7,358   | 4,013   | 0.55      |
  | 1,000 | 200    | constant    | tail   | 18,425  | 9,233   | 0.50      |
  | 1,000 | 200    | constant    | inside | 19,523  | 10,655  | 0.55      |
  | 1,000 | 200    | alternating | tail   | 13,726  | 6,177   | 0.45      |
  | 1,000 | 200    | alternating | inside | 37,870  | 25,148  | 0.66      |

  The head is `dde1d69c`. Totals: 116,953 ms on base and 65,687 ms on the
  head (×0.56), and all 16 outcomes are the same on both. At `9c834fb9`,
  without the cache, the totals were 127,418 and 145,076 ms (×1.14), and
  1,000 alternating rows inside at 40 a date took ×1.9. That cost was
  `Date.parse`: a stretch that starts partway through a day leaves rows dated
  across a day boundary in every block. `dde1d69c` caches `dayNumber`. That
  also speeds up lg-59's own `block.map(dayNumber)` on every edge, which is
  why the head is now faster than base. The case shapes pair every row alike,
  so they time the search and the pairing, not long reports.

  **Acceptance unchanged.** `base-probe.mts` runs the random search above
  against `2d1b22bb`'s two files, with the head's `datesDiffering` set aside.
  At `dde1d69c`, 0 of 8,000 cases differ at seed 11 (3,690 accepted) and 0 of 8,000 at seed 23 (3,905 accepted). At `40cb260a` it was 0 of 8,000 at seed 11 too.

  **Checks**, at `61f61d61`. That commit moves `take` and `apart` to module
  scope, which oxlint's `consistent-function-scoping` required, and changes no
  behaviour, so the time and probe figures above, read at `dde1d69c`, were
  not taken again. `npm run check` exits 0. `npm test -- tools/ledger/api`:
  984 of 984 in 40 files. `npm test -- tools/ledger/web`: 236 of 236 in 18
  files. `npx vitest run` on `workbook-days.test.ts` and `statements.test.ts`:
  126 of 126. The full `--project ledger` was not run: CI runs it on the
  draft.

  **Fold-in:** none. The other open ledger tickets are lg-38 and lg-56
  (measurements) and lg-63 (another builder's, in flight). Nothing this
  change touched made one of them free.

- 2026-10-21 — owner answers to gate 1, given 2026-10-21, recorded by the
  lander. **F1's open decision** (A: make the leftover pairing in
  `pairAmounts` optimal; B: narrow the three texts to "a nearby date"): the
  owner chose B, the gate's recommendation. **F2** (the plural branch of the
  screen line has no test): the owner chose to have the lander add the test.
  **F3**: left recorded and unfixed. **The gate's observation** that lg-59's
  block search takes 25–43 s on a 3-row paste into a 300-row workbook re-dated
  by alternating days, over 60 s on base: the owner chose to file it as its own
  ticket, lg-65, in a separate docs PR, filed by another agent and not here.

- 2026-10-21 — Fixed at landing by owner choice: gate 1, F1 — "the 'fewest days
  apart' that the headers of `workbook-days.ts` and `matchStretch`, and the doc
  of `readings` in `statements.ts`, state does not hold within a block"; remedy
  B, the three texts narrowed to say a nearby date, comments only.
  `grep -c "each beside the nearest workbook date that cutting allows"
tools/ledger/api/src/workbook-days.ts` → 0 (1 before), and the ticket above
  `## Log` holds none of the old phrases (`awk '/^## Log/{exit} {print}'
<ticket> | grep -c "nearest workbook date that cutting allows"` → 0). The
  `matchStretch` and `readings` docs now read "by the pairing `pairAmounts`
  finds", and the header reads "beside a nearby workbook date". No code
  changed.

- 2026-10-21 — Fixed at landing by owner choice: gate 1, F2 — "the plural
  branch of the screen line ("N rows already stored are dated differently…")
  has no test on the branch; the web tests cover one row and none". One test
  appended to `tools/ledger/web/test/statement-paste.test.tsx`: two rows dated
  differently, asserting the line "2 rows already stored are dated differently
  by the bank and by the workbook." and 2 items in the list named "Dates that
  differ". `npx vitest run tools/ledger/web/test/statement-paste.test.tsx` →
  18 of 18 pass. With the branch in `StatementPaste.tsx` planted singular-only
  (the line always "One row already stored is"), the same command → 1 failed
  | 17 passed, the new test, Expected "2 rows already stored are dated
  differently by the bank and by the workbook.", Received "…One row already
  stored is dated differently…". The plant was reverted by hand before the
  commit (`git status` showed only the three intended files).
