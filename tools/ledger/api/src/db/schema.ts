/**
 * SQLite schema and migrations.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. Deliberately the smallest thing that works — the same
 * shape as the planner's.
 *
 * **The books arrive one ticket at a time.** The accounts, buckets, split and
 * receipts are designed in `docs/00-ANALYSIS.md` before a table exists for any
 * of them, because a table guessed at now is a migration to undo later, and here
 * "later" means a database holding years of a household's history. Migration 1 is
 * the first thing stored: the pasted statement rows (lg-2).
 *
 * **Nothing here is ever updated in place** (`docs/00-ANALYSIS.md` §9). A
 * correction is a later row that supersedes the earlier one, so every table is
 * written with `INSERT` and nothing in this tool issues an `UPDATE` or a
 * `DELETE` against one.
 */

import type { Database } from "better-sqlite3";

/**
 * Each entry is one irreversible step. Never edit a shipped migration — append
 * a new one, or an existing database and a fresh one end up different shapes.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — the pasted statement (lg-2).
  `
  CREATE TABLE statement_imports (
    id INTEGER PRIMARY KEY,
    -- ISO instant the paste was stored, from the app's clock.
    imported_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    imported_by TEXT NOT NULL
  );

  CREATE TABLE statement_rows (
    id INTEGER PRIMARY KEY,
    -- Position in the account's whole history, oldest = 0. A paste numbers its
    -- own rows from 0 and the store offsets them by what is already here; once
    -- written it is never renumbered, which is why older history cannot be
    -- added in front.
    seq INTEGER NOT NULL UNIQUE CHECK (seq >= 0),
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL,
    import_id INTEGER NOT NULL REFERENCES statement_imports (id),
    -- A row's identity: pastes overlap, and re-storing a row is a no-op.
    UNIQUE (date, description, amount_cents, balance_cents)
  );
  `,
];

export function migrate(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Without this, a concurrent writer fails instantly with SQLITE_BUSY rather
  // than waiting.
  db.pragma("busy_timeout = 5000");

  const current = Number((db.pragma("user_version", { simple: true }) as number) ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const statement = MIGRATIONS[version];
    if (statement === undefined) continue;
    db.exec("BEGIN");
    try {
      db.exec(statement);
      // Interpolated because PRAGMA does not accept a bound parameter. The
      // value is a loop counter, never user input.
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      db.exec("COMMIT");
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
