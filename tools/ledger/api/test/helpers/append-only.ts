/**
 * What the append-only scans look for in the API's source: a statement that
 * changes a stored record in place (lg-4, lg-20).
 *
 * Any `UPDATE` followed by a `SET` before the statement ends, an upsert's
 * `DO UPDATE`, a `DELETE` and its `FROM` with only space or comments between
 * them, and SQLite's `REPLACE`, which
 * deletes the row it conflicts with and inserts another without firing a
 * `DELETE` trigger, since `recursive_triggers` is off (lg-20's gate, F2).
 *
 * It does not try to read the table between the keywords. A pattern shaped like
 * a table name missed every spelling it did not list — a table in single quotes,
 * an alias, `INDEXED BY`, a comment between `DELETE` and `FROM` (lg-22's gate 1,
 * F3) — and SQLite reads all of them. The cost is the other way round: a comment
 * that says "or replace", or an `update` and a `set` in one sentence with no
 * semicolon between them, is flagged too, and is reworded. A false alarm fails
 * the scan loudly; a miss would pass it silently.
 */

export const WRITES_IN_PLACE = new RegExp(
  [
    String.raw`\bUPDATE\b[^;]*?\bSET\b`,
    String.raw`\bDO\s+UPDATE\b`,
    // Whitespace or SQL comments between, and nothing else: a `delete` and a
    // `from` in one sentence of prose are too common to flag.
    String.raw`\bDELETE(?:\s|/\*[\s\S]*?\*/|--[^\n]*)+FROM\b`,
    String.raw`\bOR\s+REPLACE\b`,
    String.raw`\bREPLACE\s+INTO\b`,
  ].join("|"),
  "iu",
);
