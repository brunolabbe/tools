/**
 * What the append-only scans look for in the API's source: a statement that
 * changes a stored record in place (lg-4, lg-20).
 *
 * An `UPDATE … SET` and a `DELETE FROM`, as the scans always did, and two things
 * they once missed (lg-20's gate, F2, fixed in lg-22): a table named in quotes,
 * brackets or backticks, or behind its schema (`main.memberships`), and SQLite's
 * `REPLACE`, which deletes the row it conflicts with and inserts another without
 * firing a `DELETE` trigger, since `recursive_triggers` is off.
 */

/** A table or schema name, bare or quoted any of the three ways SQLite reads one. */
const NAME = String.raw`(?:[\w$]+|"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\])`;
/** A table, optionally behind its schema. */
const TABLE = String.raw`${NAME}(?:\s*\.\s*${NAME})?`;

export const WRITES_IN_PLACE = new RegExp(
  [
    String.raw`\bUPDATE\s+(?:OR\s+\w+\s+)?${TABLE}\s+SET\b`,
    String.raw`\bDELETE\s+FROM\b`,
    String.raw`\bOR\s+REPLACE\b`,
    String.raw`\bREPLACE\s+INTO\b`,
  ].join("|"),
  "iu",
);
