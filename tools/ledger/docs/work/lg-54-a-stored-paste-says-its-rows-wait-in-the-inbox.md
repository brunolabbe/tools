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
