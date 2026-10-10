---
id: lg-17
tool: ledger
title: File a row without a tap when its description has been answered the same way three times
kind: work-package
status: ready
milestone: P2
depends_on: [lg-16]
difficulty: hard
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
  owner decided five things on 2026-10-10. Where an option is not named below,
  the fixer's dispatch did not carry it.
  1. _When history files a row._ Chosen: on a paste only, never on a third
     answer (an answer given after the paste files no row already waiting).
     Built that way; the builder recommended it.
  2. _How the review list is reached._ Chosen: a "Review N filed automatically"
     button at the top of the inbox, opening a separate screen. Built that way;
     the builder recommended it.
  3. _The paste report._ Chosen: unchanged. Built that way; the builder
     recommended it.
  4. _An automatically filed row's spending category._ Chosen: its override,
     then the map, never a rule its answers cited. Over: the latest answer's
     cited rule first. The builder built this and pinned it in a test without
     raising it as a decision; the orchestrator put it to the owner.
  5. _Gate finding F1 (CodeQL `js/missing-rate-limiting` on
     `GET /api/inbox/auto-filed`)._ Chosen: the alert is excused under
     `docs/adr/005`, as gate 1 recommended. The route is limited (`{ onRequest:
read }`); `api/test/route-limits.test.ts` fails 1 of its 41 tests
     without it, "autoFiled refuses the second request in a minute, as
     RATE_LIMITED", reproduced on this head before the comment was written.
     The five-field comment is on the route in `api/src/routes/inbox.ts`.

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
    SQL: no paste can put an automatic row at the tail of a stretch the
    workbook also holds, and the app never rewrites a record.
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
