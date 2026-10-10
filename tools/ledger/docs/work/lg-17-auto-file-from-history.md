---
id: lg-17
tool: ledger
title: File a row without a tap when its description has been answered the same way three times
kind: work-package
status: done
milestone: P2
depends_on: [lg-16]
difficulty: hard
awaiting: Done when 7 — after the push to `main` that runs `security.yml`'s dismissal step, the `js/missing-rate-limiting` alert on `GET /api/inbox/auto-filed` in `tools/ledger/api/src/routes/inbox.ts` reads dismissed, "Suppressed via SARIF"
---

# lg-17 — File a row without a tap when its description has been answered the same way three times

## Why

Most rows no rule takes are the same merchants and bills, answered the same way
every month. The owner chose on 2026-10-06 to let history file them, within
limits that keep §3's reason for asking: a transfer that is not its usual amount
is a mistake to catch, as the workbook's misfiled mortgage transfer was
([00-ANALYSIS.md §3](../00-ANALYSIS.md), amendment). This is the first thing in
the tool that files a row with nobody tapping, so it is a ticket of its own,
after lg-16 has shown its history answers working.

## Build

1. **When history files a row.** Only a row the rules leave as `no-rule` (no
   pattern matches). A `differs` or `ambiguous` row always stays in the inbox,
   and a rule that matches always beats history.
   - The **latest three** person-given answers for its description (lg-16's
     `fromHistory`, same folding) name the same person and bucket.
   - **Its amount fits:**
     - a credit, or a row whose Desjardins category folds to `virements`: its
       amount equals, to the cent, the amount of one of those three rows;
     - any other debit: it is within ±20 % of the latest of those three rows'
       amounts, with the same sign. Compare in integer cents,
       `5 × |a − b| ≤ |b|`, never in floating point.
   - Anything else goes to the inbox, with lg-16's history answer offered.
2. **`books`, pure: `autoFile(row, answers)`**, returning the answer and the ids
   of the three classifications it rests on, or why not.
3. **Only a person's answers count.** An automatic filing is never an answer for
   a later one, so history cannot reinforce itself. Confirming an automatic
   filing from the review list stores a `manual` classification, which is.
4. **Storage, and its trap.** `classifications.source` is
   `CHECK (source IN ('rule', 'accepted', 'manual'))`, with
   `CHECK ((source = 'manual') = (rule_id IS NULL))` and `classified_by NOT
NULL`. SQLite cannot change a `CHECK` without rebuilding the table, and
   these rows are append-only history. Choose between a table rebuild in a
   migration that copies every row and proves the count, and a sibling record
   that the latest-classification read takes into account; write down which,
   and why, in the Log. Either way the record says it was automatic, names the
   three classifications it rests on, and names no person as having made it.
5. **Undo is reclassifying**, as lg-4 already does: a person's answer appended
   after an automatic one wins.
6. `web`: a list of rows filed automatically and not yet confirmed or changed,
   reachable from the inbox, each showing the three answers it rests on, with
   one tap to confirm and the usual controls to change it. The inbox count does
   not include them.
7. **Amend [00-ANALYSIS.md §3](../00-ANALYSIS.md)'s amendment** if the build
   finds the limits above unworkable — never quietly loosen them in code.
8. **What lg-16 built, for this ticket to start from.**
   - `fromHistory(row, answers)` returns `{ bucket, personId, times }`, where
     `times` is the run of latest answers that agree, counting back from the
     latest and stopping at the first that differs. "The latest three name the
     same person and bucket" is therefore `times >= 3`. It does not return the
     amounts or the ids of the answers `autoFile` needs; `HistoryAnswer` holds
     the classification `id` (larger is later) and no amount, so extend it with
     `amountCents` and have `autoFile` reuse its folding (`normalizeDescription`)
     rather than a second copy.
   - The API reads answers in `answersByDescription`
     (`api/src/classifications.ts`): the **standing** classification of each row
     (`current_classifications`) whose `source IN ('manual', 'accepted')`. A new
     `source`, or a sibling record, stays out of history only if that list is
     left alone; do not widen it, and make the storage choice in item 4 keep the
     standing-classification read honest for it.
   - **`InboxRow.history` already shows the answer.** Beside a rule's suggestion
     that says something else it has its own one-tap "Use this answer", storing
     `manual`; where the suggestion says the same, the history is a note under the
     rule's "Accept" (storing `accepted` with the rule id), and there is no second
     control. An automatic filing is not offered there, since the row is no longer
     in the inbox.
   - **What lg-15 added, for the same files.** Migration 6 is lg-15's, so yours
     is 7. A row's spending category is computed on read from its standing
     classification's rule (`rule_id`), its override and the map, and a
     classification with no `rule_id` simply has no rule's category, so an
     automatic filing needs nothing from it. `InboxRow` gained
     `spendingCategory`; `inbox()` builds it from the rule `classify` returned.
     **`listRows` in `api/src/rows.ts` is a second direct reader of
     `current_classifications`** (`GET /api/rows`, and the answer to a row's
     spending-category override), beside `answersByDescription`. Under the
     sibling-record option it would answer an automatically filed row as
     `classification: null` unless it reads what the standing-classification
     read reads, so give it the same treatment and a test; migration 7 is free
     for the table either way. `sameAnswer` in `books/src/classify.ts` now also compares a
     rule's `spendingCategoryId`; it is about rules and `fromHistory` does not
     call it, and neither `HistoryAnswer` nor `answersByDescription` was
     touched.

## Done when

1. A debit with three matching answers, 15 % above the latest one's amount, is
   filed automatically; at 25 % it goes to the inbox. `books` tests at both
   sides of the 20 % line, in cents, prove it.
2. A transfer with three matching answers at a different amount goes to the
   inbox; at an amount equal to one of them, it is filed.
3. Two automatic filings and one answer do not make three: the next row goes to
   the inbox. Three answers where one disagrees do not file either.
4. A row a rule matches with a different amount (`differs`) goes to the inbox
   whatever its history says.
5. The automatic filing is stored with its three classifications, a person's
   later answer wins over it, and every classification stored before the
   migration is still there. An API test proves each.
6. A web test covers confirming and changing an automatic filing.
7. Gates green.

## Review

**Gate: CONCERNS** — 2026-10-10 · `2d821a4b4ecdcdc3b1da9faecd8e2abf5ca8976f..7dcaa89c8453b2ff7c9f1d62115929df1b2c2b31` · Sonnet 5.5, depth full

Stacked on lg-15 (PR #406, not merged): only the range above is reviewed. The owner's settled decisions were checked against the code and not re-opened: 1 (history files only on a paste) by "an answer given after the paste files no row already waiting"; 2 (a "Review N filed automatically" button, shown only when there are some, opening a separate screen) by `web/test/inbox.test.tsx` › "an inbox with nothing filed automatically offers no review" and "rows filed automatically are reached from the inbox, not counted in it, with the answers they rest on"; 3 (the paste report is unchanged) by a run below; 4 (spending category from override, then map) by a test and two mutants below. Decision 5 is lg-15's and was not re-reviewed. No `high`: I found nothing that loses data or files a row wrongly. The two `med`s are a code-scanning excuse the new route is missing and four readers no test looks at.

| Done when                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 15 % above is filed, 25 % goes to the inbox; `books` tests at both sides of the line, in cents                                | `books/test/history.test.ts` › "autoFile (lg-17) › a debit 15 % above the latest answer's amount is filed, on the three answers it rests on", "› a debit 25 % above it goes to the inbox", "› the 20 % line is inclusive and drawn in whole cents, on both sides of the latest" (assertions at 2469 / 2470 cents and -120 / -121); `api/test/auto-file.test.ts` › "history files a row on paste (lg-17) › a debit 15 % above the latest answer is filed automatically, and one 25 % above waits" ✓                                                                                                                                                                                                                                                                                                                                       |
| 2. A transfer at a different amount goes to the inbox; at one of the three amounts it is filed                                   | `books/test/history.test.ts` › "autoFile (lg-17) › a transfer at a different amount goes to the inbox, and at one of the three amounts is filed", "› `Virements` is folded as a category is, and every credit is a transfer"; `api/test/auto-file.test.ts` › "history files a row on paste (lg-17) › a transfer at an amount none of the three had waits, and at one of theirs is filed" ✓                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3. Two automatic filings and one answer do not make three; three answers where one disagrees do not file                         | `api/test/auto-file.test.ts` › "history files a row on paste (lg-17) › two automatic filings and one answer do not make three: the next row waits" (no standing record; inbox history `times: 1`), "› three answers where one disagrees do not file either"; `books/test/history.test.ts` › "autoFile (lg-17) › three answers where one disagrees do not file, whichever one it is" ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4. A `differs` row goes to the inbox whatever its history says                                                                   | `api/test/auto-file.test.ts` › "history files a row on paste (lg-17) › a row a rule matches with a different amount waits, whatever its history says" (asserts `reason: "differs"` and the history answer offered, `times: 3`); its `ambiguous` twin "› rules level at the top with different answers leave the row waiting, whatever its history says" ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5. Stored with its three classifications; a person's later answer wins; every classification before the migration is still there | `api/test/auto-file.test.ts` › "an automatic filing is stored, reviewed and superseded (lg-17) › names the three answers it rests on and no person, and the database refuses one that does not"; "› a person's later answer wins over it, leaves the review list, and is an answer itself"; "migration 7 rebuilds the classifications (lg-17) › keeps every classification stored before it, with its id, and what stands" (four records of three sources, two on one row, compared column for column) ✓ — and I repeated the third on a populated database, below                                                                                                                                                                                                                                                                       |
| 6. A web test covers confirming and changing an automatic filing                                                                 | `web/test/inbox.test.tsx` › "confirming an automatic filing stores the same person and bucket, and the row leaves the list", "changing an automatic filing stores the person and bucket chosen instead" (and "a refused confirmation says what the server said and keeps the row for review") ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7. Gates green                                                                                                                   | **unproven (gate)** — at this head `npm run check` exit 0 and `npm test -- --project ledger` 703 passed (703) over 41 files, both mine; PR #408 on this head: `check` ×2, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker`, `codeql` (the workflow), `dependency-review` and `changes` pass. The code-scanning check **`CodeQL` fails**: 1 new high alert on the new route, no excusal in the Log (F1). PR #406 (lg-15, whose routes carry the excuse) shows the same check red, which fits adr/005 as amended by repo-16 (the comment is the register; the dismissal step that clears the check runs on pushes to `main` only); the row becomes **awaiting** once F1 is fixed and the Log records the owner's excusal under adr/005, with that push as the event and the alert's state on `main` as the reading |

### Findings

- **med** · Done when 7 depends on it · **F1 — the new route has no adr/005 register comment, and the code-scanning check is red on it.** `gh pr checks 408` → `CodeQL fail`; the check's page (`WebFetch` of its `detailsUrl`, run `…/runs/114273949827`) reads "1 new alert including 1 high severity security vulnerability": "Missing rate limiting — This route handler performs a database access, but is not rate-limited", in `tools/ledger/api/src/routes/inbox.ts`, the `GET /api/inbox/auto-filed` handler. The route is limited: it takes `{ onRequest: read }`. Measured on this head — remove that hook from `app.get(ROUTES.autoFiled …)` and run `npx vitest run tools/ledger/api/test/route-limits.test.ts` → `× autoFiled refuses the second request in a minute, as RATE_LIMITED`, `Tests 1 failed | 40 passed (41)`. So it is the false positive the five existing `// codeql[js/missing-rate-limiting]` comments excuse (`routes/rules.ts`, `salaries.ts`, `spending-categories.ts` twice, `periods.ts`), and adr/005 rule 4 treats an alert without such a comment as one nobody examined. **Remedy, no decision in it:** add the five-field comment on the line above `app.get(ROUTES.autoFiled …)`, naming that guard test and "1 of its 41 tests". The Log should then record the owner's excusal if they give it, which is the owner's to give.
- **med** · no `Done when` line depends on it · **F2 — the describe block "every reader of the standing classification answers an automatic filing (lg-17)" covers 7 of the 11 readers.** The eleven runtime readers of the standing classification at this head (`grep` of `current_classifications` and of `NOT EXISTS (… classifications …)` under `tools/ledger`; the two by-id re-reads, `append`'s and `autoFiled`'s ground lookup, are not standing readers): `buckets.ts` `filedRows` and `unclassifiedAsOf`; `classifications.ts` `answersByDescription`, `inbox`, `inboxCount`, `autoFiled`; `rows.ts` `listRows` — **7, each asserted by a test**; `periods.ts` `bufferRows` (the deposits a closed period matches), `workbook-import.ts` `storedRows`, and `ledgerFigures`' figures query and its unclassified count — **4, none asserted**. Plant: `periods.ts` `bufferRows` given `AND current_classifications.source <> 'auto'` → `npx vitest run --project ledger` **703 passed (703)**; each of the three `workbook-import.ts` readers given the same filter → **703 passed (703)** three times. For contrast, `buckets.ts` `filedRows` given it → `1 failed | 702 passed`, "the buckets count it where it was filed". All eleven answer an automatic row correctly today (below), so this is a missing assertion, not a defect — but the periods reader is the one that moves money (an unmatched deposit stays `expected`), and the block's title and the Log's argument for the rebuild both rest on it. Probes, scratch scripts that take the tree: `lg-17-readers-probe.mts` (a closed period expects 15000 from alex; a paste brings a row history files as alex, `auto`: deposit becomes `{"status":"matched","rowId":4}`; under the plant it stays `{"status":"expected","rowId":null}`) and `lg-17-import-probe.mts` (the branch's own "workbook against the rows already pasted" shape, the third pasted row's record rewritten from `manual` to `auto` with the same bucket and person: exit code, output, buffer 40500 and unclassified count identical to the `manual` run, and identical again when the stored filing disagrees with the workbook, where both name the same row; each of the three plants makes the two runs differ). **Remedy:** one test for the deposit match and one for the import against an `auto` row, beside the three that exist.
- **low** · **F3 — the Log's "ten read sites in six files" is five files** (`rows`, `periods`, `buckets`, `classifications`, `workbook-import`); the ten sites and the argument built on them are right. The head adds an eleventh, `autoFiled`.
- **low** · **F4 — four comments say "fails 1 of its 40 tests"** (`routes/rules.ts`, `salaries.ts`, `spending-categories.ts`, `periods.ts`); `route-limits.test.ts` now has 41 (the branch added the `autoFiled` row). Each is dated as measured "on lg-15", so they are dated measurements and not wrong; the new comment in F1 should say 41 and the others can stay.
- **low** · **F5 — two mutants of `amountFits` survive the books suite, and one is dead code.** `books/src/history.ts`: removing `Math.sign(row.amountCents) === Math.sign(before) &&` → `npx vitest run tools/ledger/books/test/history.test.ts` **18 passed (18)**; over every `a`, `b` in [-400, 400] (641,601 pairs) `5 × |a − b| ≤ |b|` with and without the clause never differ, since opposite signs put `|a − b|` at or above `|b|`. So "with the same sign" in the brief is implied by the 20 % line, the clause is dead, and "a debit against a latest answer that was a credit has the wrong sign" cannot fail on it. The float form `|a − b| / |b| ≤ 0.2` also passes 18 of 18, and is equivalent: 12,000,000 comparisons at the exact line and one cent past it, latest 1 to 3,000,000 cents, no input differs (correctly rounded division). The test title "drawn in whole cents" claims more than any test can see; the Log says as much. No live call site.
- **low** · **F6 — nothing on the branch fires migration 7's proof or its refusal.** The Log measured the proof on a prototype. On the real migration, with the head's `schema.ts` mutated in place (restored after each; `lg-17-run-bad-copy.sh`): a copy that leaves out the newest record, and a copy that refiles every record as `mortgage`, are each refused with `CHECK constraint failed: copied = kept AND differing = 0` and leave the file at `user_version` 6 with 41 classifications, no `classifications_v7`, no `rests_on_1`; with the proof's `CHECK` removed the second copy is accepted (the control). Three damaged v6 copies (a classification naming a row that does not exist; one naming a rule that does not exist; a value the old `CHECK` forbids, inserted with `ignore_check_constraints`) are refused at boot with `FOREIGN KEY constraint failed` / `CHECK constraint failed` and stay at version 6, table intact. No live path makes such a database, so this is a missing test, not a defect.
- **dropped** · Workbook-imported rows are stored `manual` (lg-7) and so count as answers for history. That is lg-7's design meeting this one's; whether a year of imported filings should be able to file the first paste's rows is the owner's to say, and nothing in the brief or the settled decisions rules it out.
- **dropped** · A double tap on "Confirm" appends two `manual` records for one row and might be thought to count twice. It does not: `answersByDescription` reads the standing record per row, so one row is one answer. Reasoned from the query, not run.
- **dropped** · `classifyAdded` now reads every standing person answer on each paste, including one that adds no rows. Measured: 10 ms with 3,600 records and 381 ms with 120,000 (`classifyAdded(…, lastRowId)` on a migrated database). A monthly action; not a defect.
- **findings** · the hunt returned 9; 6 carried (F1 to F6), 3 dropped.

### Positive controls

- **A reader no test covers, ignoring `auto`** (`periods.ts` `bufferRows`, `source <> 'auto'`): the ledger project stays at **703 passed (703)**, which is F2; the deposit probe sees it. The three `workbook-import.ts` readers the same way, each **703 passed (703)**.
- **`answersByDescription` counting `auto`** (`IN ('manual', 'accepted', 'auto')`): **2 failed | 701 passed (703)** — `api/test/auto-file.test.ts` › "history files a row on paste (lg-17) › a debit 15 % above the latest answer is filed automatically, and one 25 % above waits" (the first filing becomes the reference the 25 % row is measured against and it is filed too) and "› two automatic filings and one answer do not make three: the next row waits".
- Other plants, all caught: any `no-rule` reason reaching history → 2 failed (`differs` and `ambiguous` tests); `inbox()` keeping `auto` rows → 2 failed; the review list reading superseded records → 2 failed; `listRows` dropping `auto` → 1 failed; `listRows` reading an `auto` row as an unfiled one, and the review list taking the first ground's rule category → 1 failed each (the spending-category test); the rate limit off the new route → 1 failed of 41. Books mutants: `<` for `≤`, the reference taken from the second answer, the oldest three, person-only and bucket-only agreement, two answers enough, credits not transfers, `Virements` not folded, a transfer within 20 % of any answer → each fails 1 to 9 of 18; the two survivors are F5.
- Both plants for the dispatch restored, as was every other mutation: `git status --porcelain` empty and the detached HEAD unchanged.

### What I ran on real inputs, checked a second way

- **Migration on a populated database.** Built at the base's schema with the base's own code (`git worktree add --detach … 2d821a4b`, the farm, `npm run build`; removed afterwards): 43 rows from three pastes, 6 rule rows (one edited into a new version, one retired), 41 classifications (18 `rule`, 22 `manual`, 1 `accepted`; 3 rows with more than one record; 10 joint), 2 map lines, 2 overrides, a rule naming a spending category, two salaries and a ratio, 5 period lines and 2 closed periods. Opened with the head's code: `user_version` 6 to 7; **41 of 41** classifications, same ids, same eight columns (0 mismatches), the three new columns null; the other 13 tables deep-equal; `PRAGMA foreign_key_check` empty and `integrity_check` ok; the index and the view read as migration 2 wrote them; the three `rests_on` references read `REFERENCES "classifications" (id)` after the rename; the API's buckets, periods, rows, inbox and rules responses deep-equal the base's, and `GET /api/inbox/auto-filed` is empty. On the 120,000-record scale the migration takes 328 to 356 ms.
- **A paste on that migrated database, against an oracle** written separately (SQL for the three latest answers, `BigInt` for `5 × |a − b| ≤ |b|`): 12 new rows, **12 of 12** agree; three filed (ids 47, 51, 52) resting on pre-migration classification ids; the inbox, the stored-rows list (`source: "auto"`), the review list, `buckets.unclassified` and a SQL count of unclassified rows all agree (12).
- **A person's later answer.** Confirming row 47 and changing row 51: the review list went `[52, 51, 47]` to `[52]`, each standing record is `manual` with the answering person, the `auto` records stay under them; the next pharmacy row at exactly 20 % below row 47's amount was filed resting on the _confirming_ record, so it counts as an answer; the changed row became the latest answer for its description, so the next such row went to the inbox, and the still-automatic row 52 was not counted.
- **The 20 % line:** 240,052 comparisons (latest 1 to 60,000 cents on both signs, plus a 10⁹-cent sample), each side of the line, against closed-form bounds `ceil(4|b|/5)` and `floor(6|b|/5)` that never compute `5 × |a − b|`: 0 wrong. The line is measured against the latest answer only (older two at 1/20 and 90× the amount: filed); answers handed in any order give the same result; four answers with the oldest disagreeing file on the latest three; two answers do not file.
- **Transfers:** a credit in any category and a debit whose category folds to `virements` (`Virements`, `VIREMENTS`, `virements`; not `Virement`) file only at an amount one of the three had; a debit in another category drifts by a fifth.
- **The paste report** is the same three fields with and without a row history filed: `{"rowsAdded":1,"rowsAlreadyPresent":3,"tailBalanceCents":459500}` for a paste whose row was filed `auto`.
- **Decision 4** (spending category): `listRows` and `autoFiled` read an `auto` row with no rule, so override, then the map; a test with three `accepted` answers citing a rule that names Pharmacy and a retired rule shows Groceries from the map, unchanged by a rule added later; the two spending-category mutants under "Other plants" each fail it.

### Invariants and NFRs

Skipped as not touched: SSRF, credential redaction, shell and process trees, progress, the image closure (no new workspace import). Checked: no cross-tool import; no new error code; the contract additions (`ROUTES.autoFiled`, `AutoFiledRow`, `source: "auto"`, `ClassificationRecord.source` narrowed to exclude it) follow the brief's items 4 and 6; the new tests sit in an existing registered package and ran; no `any`, no `console`, `npm run check` clean.

- NFR: security ✓ — the new route is behind the identity hook and rate limited per person (guard test measured), static migration SQL, nothing logged; F1 is the register, not a hole · performance ✓ — measured above · reliability ✓ — migration atomic and refusing, filing inside the paste's transaction · maintainability — F2, F3, F4, F5, F6.

## Log

- 2026-10-06 — Filed from a conversation with the owner, who chose: three
  person-given answers, transfers at an exact amount, other rows within ±20 %,
  marked automatic and reviewable, a separate ticket after lg-16. The filer's
  reading, not put to the owner: "transfers" is every credit plus every row in
  Desjardins' `Virements`, which errs towards asking; history applies only to
  `no-rule` rows; the ±20 % is measured against the latest of the three.
- 2026-10-10 — **Storage: the table rebuild, not a sibling record** (item 4),
  decided before migration 7 was written, by two measurements.
  - _What a sibling record would have to change._ Item 8 names two direct
    readers of the standing classification; there are ten read sites in five
    files (the build added an eleventh, `autoFiled`), and every one would have to union a second table and order the two
    by something they do not share (a sibling's ids are not the
    classifications' ids, so "the latest appended stands" stops being one
    comparison). `grep -rnE "FROM classifications|JOIN current_classifications|FROM current_classifications" tools/ledger/api/src`,
    less the schema: `rows.ts:54`, `periods.ts:414`, `buckets.ts:30`,
    `buckets.ts:49`, `classifications.ts:144`, `:177`, `:226`,
    `workbook-import.ts:109`, `:462`, `:482` (and the append's own re-read at
    `classifications.ts:91`). `buckets.ts` and `periods.ts` are not in item 8's
    list, and a sibling record would have left an automatically filed row out
    of both buckets and out of the deposits a period matches. Under the rebuild
    none of the ten changes: `current_classifications` stands on the new
    record, the inbox and the "unclassified" counts drop it because a record
    exists, and `answersByDescription`'s `source IN ('manual', 'accepted')`
    leaves it out of history unwidened.
  - _What the rebuild costs._ A prototype of migration 7 (new table, copy,
    proof, drop the view and the old table, rename, index and view again) on a
    database migrated to 6, `npx tsx <scratch>/lg17-measure.mts`:
    `{"n":3000,"parent":"classifications_v7","ms":8}` and
    `{"n":100000,"parent":"classifications_v7","ms":247}`, every row and every
    standing classification still there, `foreign_key_check` empty. The copy
    proof refuses a copy missing one row:
    `broken copy refused: CHECK constraint failed: copied = kept AND differing = 0`,
    and the same SQL runs inside a savepoint, the way the workbook import
    migrates (`savepoint: {"n":10}`).
  - _The trap the measurement found._ The new table's three "rests on" columns
    first referenced `classifications`, the old table's name, and dropping the
    old table then checked every row it held against the new table's three
    unindexed columns: `{"n":3000,"parent":"classifications","ms":1190}`, and
    100 000 rows ran past two minutes and were killed. Referencing the new
    table's own name costs nothing, and `ALTER TABLE … RENAME` rewrites it to
    `REFERENCES "classifications" (id)`, measured on the renamed table's SQL.
- 2026-10-10 — Built, on lg-15's branch. `autoFile` in `books/src/history.ts`
  shares `fromHistory`'s folding through one `latestFirst`; `HistoryAnswer`
  gained `amountCents`, and `answersByDescription` gained the column and kept
  its `source IN ('manual', 'accepted')`. Migration 7 is the rebuild above:
  `source` gains `auto`, `classified_by` is `NULL` exactly on `auto`, and
  `rests_on_1..3` are set, distinct, exactly on `auto`. `classifyAdded` files
  on history only where `classify` says `no-rule`. `GET /api/inbox/auto-filed`
  is the review list; confirming or changing is the ordinary
  `POST /api/classifications`, storing `manual`. The inbox shows a "Review N
  filed automatically" button, only when there are some, and its count leaves
  them out because a record exists for them.
  - Every `Done when` has a test: `books/test/history.test.ts` (`autoFile
(lg-17)`) and `api/test/auto-file.test.ts` for 1 to 5, `web/test/inbox.test.tsx`
    for 6. Each API test was made to fail first by breaking what it guards:
    counting `auto` in `answersByDescription` failed "two automatic filings and
    one answer do not make three"; letting `differs` and `ambiguous` reach
    `autoFile` failed both "whatever its history says" tests; leaving `auto`
    rows in `inbox()`'s query failed "the inbox leaves it out"; dropping `auto`
    from `listRows`'s join, or reading an `auto` row's spending category as an
    unfiled row's, failed "the stored rows answer it as filed automatically";
    `<` for `≤` failed the 20 % line test.
  - _What the brief had wrong, or left out._ `classifyAdded` returned before
    reading a row when no rule existed, which would have kept history from ever
    filing in a household with no rules; it now always reads. Done when 3's "two
    automatic filings and one answer" cannot be reached by tapping — once three
    rows of a description carry a person's answer they always will — so its API
    test seeds the two `auto` records as a paste stores them. `inboxCount` in
    `classifications.ts` has no caller in `api/src`; the new test reads it, and
    it was left in place. No float failure exists at the 20 % line for these
    forms: `(a−b)/b ≤ 0.2`, `a/b ≤ 1.2`, `a/b − 1 ≤ 0.2` and `a−b ≤ b × 0.2`
    all judged `a = b + b/5` inside the line, as the integer rule does, for every
    `b` a multiple of 5 cents up to 2 000 000 cents (one `node -e` loop; only
    that side of the line was measured), so the integer rule stays as the brief asks and no test claims
    otherwise.
  - _Fold-in._ Nothing already specified became free. A paste report saying
    how many rows history filed would be new, owner-visible behaviour, so it is
    in the build report's open decisions rather than here.
  - Item 7: the limits were workable as written; §3's amendment is unchanged.
- 2026-10-10 — **Gate 1, round 1: the owner's decisions and the fixes.** The
  owner decided six things on 2026-10-10, each put as the options below, and
  every chosen option was the recommended one.
  1. _When history files a row._ Options: (a) _only on a paste_, chosen, the
     builder recommended it; (b) _also on the third answer_, where a person's
     third matching answer files rows of that description already waiting,
     which adds a hidden write to every tap. Built as (a): an answer given
     after the paste files no row already waiting.
  2. _How the review list is reached._ Options: (a) _a button atop the inbox_,
     chosen, the builder recommended it; (b) _a section below the inbox_,
     always shown, which costs phone screen space; (c) _a second count on the
     Inbox tab_, easily confused with the inbox count. Built as (a): a
     "Review N filed automatically" button at the top of the inbox, opening a
     separate screen.
  3. _What a paste reports._ Options: (a) _unchanged_, chosen, the builder
     recommended it; (b) _add a count_, which is one contract field and a line
     on the paste screen. Built as (a).
  4. _An automatically filed row's spending category._ Options: (a) _its
     override, then the map_, chosen; the builder built it and pinned it in a
     test without raising it as a decision, and the orchestrator recommended
     it; (b) _the latest answer's cited rule first_, then the map, which is one
     more join. Built as (a), never a rule its answers cited.
  5. _Gate 1 F1 (CodeQL `js/missing-rate-limiting` on
     `GET /api/inbox/auto-filed`)._ Options: (a) _excuse under `docs/adr/005`_,
     chosen, the gate recommended it; (b) _change the route_ so the pattern
     does not match, for which no shape was found and five sibling routes take
     the excusal. The route is limited (`{ onRequest:
read }`); `api/test/route-limits.test.ts` fails 1 of its 41 tests
     without it, "autoFiled refuses the second request in a minute, as
     RATE_LIMITED", reproduced on this head before the comment was written.
     The five-field comment is on the route in `api/src/routes/inbox.ts`.
  6. _Gate 2's F6 remainder (nothing asserts that migration 7's copy proof
     fires)._ Options: (a) _export the migrations and test a doctored
     migration 7_; (b) _a source-reading test_; (c) _leave it, with the two
     mutation runs as the evidence_, chosen, the gate recommended it.

  Gate 2's G2-1 was not a decision of that kind: it was **fixed at landing by
  owner choice on 2026-10-10, with no re-gate.** The test comment and the Log
  line claimed that no paste can put an automatic row at the tail of a stretch
  the workbook also holds, true of this fixture's newest row only. Both now say
  the `UPDATE` to `auto` is a convenience of this fixture; the long-stretch case
  was not built.

  Findings fixed in this round:
  - _F1:_ the register comment, above.
  - _F2:_ four readers of the standing classification had no test. Added
    beside the three that exist, in `api/test/auto-file.test.ts`: "a closed
    period's expected deposit is matched by a row history filed" (`periods.ts`
    `bufferRows`) and two workbook-import tests that run the import over a
    stored tail whose newest row is an `auto` record, one where the workbook
    files it the same way (`storedRows`, the figures query) and one where it
    files it another way, so the import must refuse naming the row and must
    not say the row is waiting (`storedRows`, the unclassified count). Each of
    the four readers, given `source <> 'auto'`, fails at least one of them.
    The import tests rewrite the third stored record to history's own shape in
    SQL. The rewrite is a convenience of this fixture, not a necessity: it
    saves building a longer stretch of rows the workbook also holds, and the
    app itself never rewrites a record.
  - _F3:_ "six files" above is five; the build added an eleventh reader.
  - _F6:_ three damaged release 6 databases (a record naming a row that does
    not exist; one naming a rule that does not exist; a value release 6's own
    check forbids) are refused at boot and stay at `user_version` 6 with every
    classification intact and no `classifications_v7` or `rests_on` object.
    Only the refusal at boot is covered: migration 7's own proof (`copied = kept
AND differing = 0`) cannot be made to fail from a test without changing
    `schema.ts`, since a copy that differs needs the migration itself to be
    wrong, and the prototype measurement above remains its only firing.
  - _Recorded, not fixed (F4, F5):_ the four older register comments' "1 of its
    40" are dated measurements and only the new comment says 41; `amountFits`
    has a dead `Math.sign` clause.
