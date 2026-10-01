---
id: lg-2
tool: ledger
title: Store a pasted statement, chained onto what is already stored
kind: work-package
status: ready
milestone: P2
depends_on: [lg-1]
difficulty: standard
---

# lg-2 — Store a pasted statement, chained onto what is already stored

## Why

A paste is only as good as its fit to the history already stored. Pastes
overlap routinely, and a gap between two pastes is money nobody can explain
([00-ANALYSIS.md §2](../00-ANALYSIS.md)).

## Build

1. Migration 1 in `api/src/db/schema.ts`: a `statement_rows` table holding
   everything `ParsedStatement` carries, plus the import it came from and when.
   `seq` comes back 0-based within the paste (oldest = 0): the parser cannot
   know the history, so offset it by what is already stored (lg-1).
   A row's identity is (date, description, amount, balance), with a unique index
   on it.
2. `POST` on a new route in `contract/src/api.ts`: paste text in, and a report
   out. The report gives rows added, rows already present, and the new tail
   balance.
3. **Chaining:**
   - the paste's oldest new row must continue from the stored row just before
     it (balance − amount = that row's balance), or overlap it exactly;
   - a gap is refused with the unexplained amount in the error;
   - the very first paste into an empty database is accepted as the anchor.
4. **Overlapping rows must be identical.** A pasted row that shares an identity
   with a stored row but disagrees elsewhere, such as its category, is refused
   and named.
5. **Never overwrite.** A stored row is never edited in place (§9 of the
   analysis).
6. `web`: a paste screen with a textarea, a preview of the parsed rows, a
   confirm button, and the report or the named error. It must be usable on a
   phone.

## Done when

1. Pasting the same text twice adds rows once. The API test proves it.
2. A paste that overlaps the stored tail adds only the new rows.
3. A paste that leaves a gap is refused, and the error states the unexplained
   amount.
4. An overlapping row whose fields differ is refused, and the error names it.
5. The paste screen shows the preview and the report. A web test proves it.
6. Gates green.

## Log
