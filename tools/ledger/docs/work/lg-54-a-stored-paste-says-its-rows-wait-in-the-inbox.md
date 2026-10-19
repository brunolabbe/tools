---
id: lg-54
tool: ledger
title: A stored paste says how many of its rows wait in the inbox, and takes the person there
kind: fix
status: ready
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
