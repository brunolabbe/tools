---
id: lg-54
tool: ledger
title: A stored paste says how many of its rows wait in the inbox, and takes the person there
kind: fix
status: done
milestone: null
depends_on: [lg-2, lg-4]
difficulty: standard
---

# lg-54 — A stored paste says how many of its rows wait in the inbox

## Why

Storing a paste and filing its rows are two steps (lg-2, then lg-4), and the
screen between them says nothing of the second. On 2026-10-18 the owner pasted
their first statement into books with no rules yet, and asked what would become
of the transfers, since nothing on the screen said they would be assigned to
anyone. The answer is that every row a rule or history does not file waits in
the inbox, uncounted by either bucket, until a person answers it with a person
and a bucket. `Joint` is one of those answers and never a default. The owner
could not have learned that from the paste screen.

Two things hide it:

- **"Statement stored"** (`web/src/statements/StatementPaste.tsx`, the `stored`
  step) reports rows added, rows already present and the balance, and no more.
  `ImportStatementReport` in `contract/src/api.ts` carries nothing about filing.
- **The inbox tab's count** (`waiting` in `web/src/App.tsx`) is asked again only
  on a change of tab. A person who stores a paste and stays on the screen
  sees the old number, or none in a household whose inbox was empty.

## Build

1. After a store, the screen says how many of the rows just added wait in the
   inbox, with a button that opens the inbox tab. When every row added was
   filed, say so instead. When no rows were added, say nothing about filing.
2. Say it in the words the owner was missing: a row in the inbox counts in
   neither bucket until it is answered with a person and a bucket, and nothing
   is filed to `Joint` by default.
3. Where the number comes from is the builder's choice, with the reason written
   in the Log. Either the report grows a count (a contract change: say so in
   the PR), or the web asks `fetchInbox` once the store answers. The inbox
   includes rows from earlier pastes, so a count taken from it describes the
   inbox, not this paste. Word the line to match whichever it is.
4. The shell's tab count updates when a paste is stored, not only on the next
   change of tab: for example, `StatementPaste` takes an `onStored` callback
   that `App` uses to ask again.
5. The stored step keeps the "Paste another" button.

## Done when

- A web test stores a paste whose rows no rule files and finds the stored step
  naming that number of rows waiting, and a button that opens the inbox.
- A web test stores a paste whose rows were all filed and finds no rows named
  as waiting.
- A web test finds the inbox tab's count changed after a store without a change
  of tab.
- `npm run check` and `npm test -- --project ledger` pass.

## Review

**Gate: PASS** — 2026-10-19 · `96da35c8..5b83df4a` · Opus 5.5, depth standard

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A web test stores a paste no rule files, finds that number waiting and a button that opens the inbox | `web/test/statement-paste.test.tsx` › "rows no rule filed are named as waiting in the inbox, with a button that opens it (lg-54)" asserts "2 of the 2 rows added wait in the inbox", both Build 2 clauses and the `onOpenInbox` call; `web/test/app.test.tsx` › "the inbox tab's count changes when a paste is stored, with no change of tab (lg-54)" clicks "Open the inbox" and finds the Inbox heading. The API side of "no rule files": `api/test/classifications.test.ts` › "with no rule every added row waits, and with two rules the other two do" ✓ |
| A web test stores a paste whose rows were all filed and finds none named waiting                     | `web/test/statement-paste.test.tsx` › "a paste whose rows were all filed names none as waiting (lg-54)": no "in the inbox" text, no "Open the inbox" button, with "Every row added was filed" present as the companion that fails on empty output ✓                                                                                                                                                                                                                                                                                                          |
| A web test finds the inbox tab's count changed after a store without a change of tab                 | `web/test/app.test.tsx` › "the inbox tab's count changes when a paste is stored, with no change of tab (lg-54)" asserts "Inbox (1)" after the store, where the tab read "Inbox" before ✓                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check` and `npm test -- --project ledger` pass                                              | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 71 of 71 files, 1539 of 1539 tests, exit 0, at `5b83df4a`. PR #574's `check`, `test (ubuntu-latest)`, `docker`, `codeql` and `CodeQL` pass on `5b83df4a`; the informational Windows leg was still pending, read not graded                                                                                                                                                                                                                                                             |

The count is right in all six named cases: (a) no rules, (b) rules filing some rows, (c) history only, plus history and a rule in one paste, (d) repeated rows, and the whole paste again, (e) an inbox already holding earlier rows the new rules match, and (f) the lg-59 re-dated, reordered workbook day. A probe spec checked each against the database's own count of this paste's unclassified rows, 12 of 12 equal, never negative, never counting another paste's row. Positive control: a plant that leaves history-filed rows uncounted as filed turns `api/test/auto-file.test.ts` › "of two rows added, the one filed from history is not counted and the one that waits is" red, 1 of 168 across the four API spec files. The plant was restored and the tree is clean. The contract change is authorised by Build 3, and the PR body names it under **Contract change**. `importStatement` is the only producer, behind `POST /api/statements`. Every consumer and fake typechecks with the field, and `tools/ledger/e2e` has no specs.

- **low** · `nfr:maintainability` · no `Done when` line depends on it · `Filing` in `web/src/statements/StatementPaste.tsx` renders (waiting, added) = (1,1) as "1 of the 1 rows added waits in the inbox." The neighbouring sentence pluralises correctly ("1 row added"), and no test stores a one-row paste with a row waiting. Direction, not run: word the case `rowsInInbox === rowsAdded` on its own ("The row added waits…" / "All 5 rows added wait…"), or pluralise "row" on `rowsAdded`.
- **low** · no live call site · in `confirm` in `StatementPaste.tsx`, `.then(onStored)` sits before `.catch`. A throwing `onStored` would put a paste that was stored back on the previewing step, with an error and the Confirm button. `App`'s callback is a `setState` updater and cannot throw.
- **low** · false text, safe direction · the comment on `App`'s inbox-count effect says "A failure leaves the number out". Measured: a failed re-fetch after a store keeps the earlier "Inbox (2)". The sentence is older than the branch, but the branch edits its block and adds the re-fetch after a store, which is a new way to reach a stale number. Nothing relies on the comment.
- **dropped** · "by what you answered before" in the all-filed sentence: history files from any member's answers, but "you" reads as the household. Product wording, not a defect.
- **dropped** · the 21 whole-report `toEqual` assertions in `api/test/statements.test.ts` and `api/test/workbook-days.test.ts` would also pass under `rowsInInbox: stored.rowsAdded`, because their fixtures have no rules and no history. They hold that the key is present, not what it counts. The count is held by the new tests in `classifications.test.ts` and `auto-file.test.ts`. Not a defect.
- **dropped** · a double fetch or a loop after a store: measured one `fetchInbox` per store (1 at load, 2 after the Paste tab, 3 after the store, still 3 at 300 ms). Not a defect.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- NFR: security n/a (no new input or route; the field is an integer the server computes) · performance ✓ (one more inbox request per store; the count reuses `classifyAdded`'s return) · reliability ✓ (the count is computed inside the paste's transaction; a failed re-fetch keeps the shell's state) · maintainability — above.

## Log

- 2026-10-18: filed from the owner's question while pasting the first statement
  into rule-less books.
- 2026-10-19 (builder, Claude Sonnet 5.5): built on branch `lg-54-paste-inbox-count`.
  - **Where the count comes from: the report grows a count (a contract change).**
    `ImportStatementReport` gains `rowsInInbox`, how many of the `rowsAdded` no
    rule and no history filed. The reason: Build 1 asks for the rows _just added_,
    and `fetchInbox` returns the whole inbox, earlier pastes' rows included, so a
    count taken from it would be a different and larger number whenever the
    inbox was not empty before (and would need a second request that can fail
    after the store has succeeded). The API already had the figure and threw it
    away: `classifyAdded` returns how many rows it filed, and `importStatement`
    now reports `rowsAdded - filed`. The field is required and flat, beside
    `rowsAdded`, so lg-58's optional `datesDiffering` can sit next to it without
    touching it. Cost: 21 whole-report assertions in `api/test/statements.test.ts`
    and `api/test/workbook-days.test.ts` (36 tests failed on the required field)
    take the new key; they are mechanical.
  - The screen line reads "N of the M rows added wait in the inbox. A row in the
    inbox counts in neither bucket until you answer it with a person and a
    bucket, and nothing is filed to Joint by default.", with an "Open the inbox"
    button; "Every row added was filed, by a rule or by what you answered before."
    when none waits; nothing about filing when no row was added. "Paste another"
    is kept.
  - `StatementPaste` takes `onStored` and `onOpenInbox`, both required so a
    caller cannot forget the wiring silently. `App` bumps a counter in `onStored`
    that is an added dependency of the inbox-count effect, so the tab's number is
    asked again at once.
  - Fold-in: none free. lg-58's screen line and field are its own.
  - Red/green, each mutation restored from the commit: with the inbox effect's
    dependency list back to `[tab]`, `npx vitest run tools/ledger/web/test/app.test.tsx`
    fails 1 of 18 (the new count test); with `rowsInInbox: stored.rowsAdded`
    in `api/src/statements.ts`, `classifications.test.ts` plus `auto-file.test.ts`
    fail 3 of 59 (the three new report tests). Both restored; the tree is the commit.
- 2026-10-19 — Fixed at landing by owner choice: gate 1, low (`nfr:maintainability`)
  — "`Filing` in `web/src/statements/StatementPaste.tsx` renders (waiting,
  added) = (1,1) as "1 of the 1 rows added waits in the inbox." The neighbouring
  sentence pluralises correctly ("1 row added"), and no test stores a one-row
  paste with a row waiting." The owner chose the first direction: the case
  `rowsInInbox === rowsAdded` is worded on its own, "The row added waits in the
  inbox." for one row and "All N rows added wait in the inbox." for N > 1; the
  other cases keep "N of the M rows added wait(s)". Two web tests appended at the
  end of `statement-paste.test.tsx`, (1,1) and (5,5).
  `npx vitest run tools/ledger/web/test/statement-paste.test.tsx` → on 5b83df4a
  with the two tests added, `Tests 2 failed | 13 passed (15)`, the (1,1) one with
  `Received: "...1 of the 1 rows added waits in the inbox..."`; after the fix,
  `Tests 15 passed (15)`. One existing assertion changed, the (2,2) one in "rows
  no rule filed are named as waiting in the inbox, with a button that opens it
  (lg-54)": "2 of the 2 rows added wait in the inbox" → "All 2 rows added wait in
  the inbox".
- 2026-10-19 — Fixed at landing by owner choice: gate 1, low (false text, safe
  direction) — "the comment on `App`'s inbox-count effect says "A failure leaves
  the number out". Measured: a failed re-fetch after a store keeps the earlier
  "Inbox (2)"." The comment in `tools/ledger/web/src/App.tsx` now reads "A
  failure keeps the number shown before: the inbox says what went wrong when
  opened." `grep -c "leaves the number out" tools/ledger/web/src/App.tsx` → 0;
  `grep -c "keeps the number shown before" tools/ledger/web/src/App.tsx` → 1.
