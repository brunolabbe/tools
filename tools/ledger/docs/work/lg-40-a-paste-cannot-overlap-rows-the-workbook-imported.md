---
id: lg-40
tool: ledger
title: A paste cannot overlap rows the workbook imported, and the refusal asks for a longer paste that cannot help
kind: fix
status: ready
milestone: null
depends_on: [lg-2, lg-7]
difficulty: hard
---

# lg-40 — A paste cannot overlap rows the workbook imported

## Why

lg-2 places a paste against the stored rows by position, field for field
(`sameRow` in `api/src/statements.ts`: date, category, description, amount,
balance). lg-7 assumed the pastes would already be stored when the workbook
was imported, and placed the workbook _below_ them. But the import also
accepts empty books (`place` in `api/src/workbook-import.ts`, `head ===
undefined`), and that is how the owner ran it on 2026-10-18: the whole history
is workbook rows, and the first paste has to meet them.

It cannot. Workbook rows differ from the bank's in three ways, and the owner's
first paste ran into all three. The paste reached back three weeks into the
workbook's last stretch:

- **Wording.** The workbook's description is its own `Labels` detail
  (`Paiement`, `Dépôt`, `Taxes`), and its category is empty. The bank's are the
  bank's.
- **A date a day off.** One row the bank dates the 25th, the workbook dates the
  26th. §8 of `00-ANALYSIS.md` already records one such row.
- **A different order within a day.** On a day with three movements, the
  workbook lists them in the reverse of the bank's order. The day ends on the
  same balance, but the two rows before the last carry different running
  balances.

No pasted row matches a stored one, so `fail` falls through to `gap`, and the
refusal reads: _"A row is missing between the two, so paste a longer stretch
that overlaps what is stored."_ Nothing is missing, and no longer paste can
succeed. The only paste that works starts on the first row after the
workbook's newest row, so it reads as a `k = 0` continuation.

Reproduction, synthetic (not the owner's figures). Workbook rows imported into
empty books, oldest first:

| date       | description | amount  | balance  |
| ---------- | ----------- | ------- | -------- |
| 2026-03-01 | Dépôt       | +100.00 | 1 100.00 |
| 2026-03-01 | Dépôt       | +50.00  | 1 150.00 |
| 2026-03-01 | Taxes       | −200.00 | 950.00   |
| 2026-03-10 | Paiement    | −300.00 | 650.00   |

Then a paste in the bank's words. 1 March holds the same three movements in
another order (−200, +100, +50: balances 800, 900, 950), 10 March's payment is
dated the 9th, and one new row follows (2026-03-12, −20.00, 630.00). Today this
is refused with `STATEMENT_CHAIN_BROKEN` and "paste a longer stretch". It
should add the one new row.

## Build

1. Recognise which stored rows came from the workbook:
   `statement_imports.source = 'workbook'`, joined through `import_id`.
2. In `readings` (`api/src/statements.ts`), where the overlapping stored rows
   are workbook rows, compare them the way lg-7 compares a workbook with a
   paste: **never by description or category**, and with a date one day off
   reported rather than refused. Within one day's run of rows, allow the order
   to differ: the run must hold the same amounts and end on the same balance.
   Work out the exact rule against the cases in Done when, and record it in
   the Log and in the file's header comment. The ambiguity refusal must keep
   working: a reading this tolerance makes possible counts like any other.
3. The overlapping rows are not stored again, and **a stored row is never
   edited**. The workbook's wording stays on its rows. Only the rows past the
   tail are inserted.
4. When nothing fits and the tail is a workbook row, the refusal says so. It
   names the newest workbook row and the first pasted row that would continue
   from it (if the paste holds one), and never says "paste a longer stretch".
   Keep the code (`STATEMENT_CHAIN_BROKEN`), and keep `details` free of
   anything the logs would carry (the ledger `CLAUDE.md`'s rule on `details`).
5. Check whether lg-7's own placement (`readings` in
   `api/src/workbook-import.ts`) has the same reordered-day blind spot when
   pastes come first. If it does, fix it with the same rule here, or file it
   separately and say which in the Log.

## Done when

1. A test in `api/test/statements.test.ts` imports the synthetic workbook rows
   above, pastes the synthetic paste, and gets `rowsAdded: 1`, with the four
   workbook rows unchanged.
2. A test proves each tolerance alone: wording only, a one-day date only, a
   reordered day only. Each is accepted.
3. A test proves a date two days off is still refused, and so is a reordered
   day whose amounts differ by one row.
4. A test proves an overlap with _pasted_ rows still compares every field, as
   before.
5. A test proves a paste whose tail is a workbook row and which fits nowhere is
   refused with a message that names the workbook and does not contain "paste a
   longer stretch".
6. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18 — filed from the owner's first paste after the workbook import.
  Measured on a scratch copy of their local books: the same paste starting on
  the first row after the workbook's newest row was accepted (3 rows added), and
  one starting a row earlier was refused with the gap message.
- 2026-10-18 — **Build item 5, the owner's answer.** Asked by the orchestrator
  on 2026-10-18, before the build: "if lg-7's own placement (`readings` in
  `workbook-import.ts`) has the same reordered-day blind spot, what should the
  builder do?" Options: (a) fix it here, (b) file it as a new lg- ticket, (c)
  the builder's call as written. **The owner chose (a), fix it here**: reproduce
  first, and if it exists fix it with the same rule as item 2, with a test in
  the workbook-import suite.
- 2026-10-18 — built (builder, branch `lg-40-paste-overlaps-workbook-rows`,
  base `960f4b26`).

  **The rule**, in `api/src/workbook-days.ts` and used by both files. The
  workbook's rows are cut into runs, each a stretch of consecutive rows on one
  date (cut on the workbook's dates); the other side's rows at the same
  positions are the run's counterpart. A run and its counterpart must (1) hold
  the same amounts, counted with repeats, (2) end on the same balance, and (3)
  for a paste, have every bank row dated the run's date or a day either side;
  the workbook import keeps lg-7's "any date, reported" instead. Wording is
  never compared. Since every run ends where the other side's does and holds
  the same amounts, it also opens where it does, so the balances agree at every
  day boundary and only the order within a day may differ. In `statements.ts`,
  a stored row is a workbook row when its `statement_imports` row has
  `source = 'workbook'`; a row a paste stored is compared field for field, in
  order, as before. The same comparison serves the `k`-row overlap and the
  paste-inside-the-history reading, whose start candidates now include every
  workbook row dated within a day of the paste's oldest row. A day the workbook
  both re-dated and reordered is two runs and does not match.

  **Item 5 reproduced on the base**, then fixed. Pasted rows `−20, +10, +5` on
  2024-03-01 and the workbook listing the same day `+10, +5, −20`, with
  `workbook-import.ts` as at `960f4b26` and only the new test added:
  `npx vitest run tools/ledger/api/test/workbook-import.test.ts -t "lg-40"` →
  1 failed | 1 passed, the import refusing with `2024 row 2, 2024-03-01 "Achat"
-20.00 $ (balance 1599.99 $) moves the same day and amount as the oldest
stored row, but leaves 1599.99 $ where it leaves 1584.99 $: -15.00 $ is
unexplained.` Fixed in `readings` and `place`, not in `run()`. `place` now
  pairs each movement with its own stored row within a day, not the row in its
  position, so "dated differently" names the right row, and `lastSeq` is the
  position the overlap reaches.

  **The ticket's reproduction on the base**: `npx vitest run
tools/ledger/api/test/statements.test.ts` with the source at `960f4b26` and
  the new tests added → 8 failed | 42 passed (50), the first with "A row is
  missing between the two, so paste a longer stretch that overlaps what is
  stored." After the fix, 50 of 50.

  **Mutations**, each from commit `1ef52779` and restored from it, both spec
  files (81 tests): no date window for a paste → 2 fail (two days off, and the
  refusal naming the workbook); amounts not compared → 3 fail; end balance not
  compared → 7 fail; pasted rows compared day by day as well → 3 fail (two lg-2
  tests and "rows a paste stored above the workbook's"); the workbook refusal
  replaced by the gap message → 1 fails; no workbook start candidates for a
  paste inside the history → 1 fails; lg-7's pairing back to positional → 1
  fails.

  **What the brief had wrong, or left open.**
  - "A date one day off reported rather than refused": the paste's answer,
    `ImportStatementReport`, has no field to report it on, and adding one is a
    contract change and a screen change. Built as accepted and not reported:
    the stored row keeps the workbook's date and the paste's is dropped. Left to
    the orchestrator as an open decision.
  - The tolerance had to reach the paste-inside-the-history reading too, or a
    paste lying wholly inside the workbook's rows would be refused; done here,
    with its own test.
  - `fail`'s two "the paste departs from a stored row" refusals find stored
    rows by date, description, amount and balance, which a workbook row could
    match only by accident, and would then name its empty category as the
    difference. They now consider rows a paste stored only, and a paste whose
    shared rows sit just above the workbook's gets the workbook refusal.
  - The refusal cannot promise that no longer paste helps: a paste starting
    partway through a reordered day compares only the part of the day it holds.
    So it says what was compared and names the pasted row that opens from the
    workbook's last balance (`continuesAt` in `details`, or `null`), and never
    asks for a longer stretch.
  - `run()`'s report line "one for one, by amount and balance" now reads day by
    day; left as it is, since `run()` is the seam with lg-38 (#542).

  Fold-in: none. lg-54 is the only other ready ticket on the paste, and its work
  is the screen and possibly the report's contract, not free here.
