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
