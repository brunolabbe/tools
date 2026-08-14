/**
 * SQLite schema and migrations.
 *
 * Conversations are persisted because a planning session is not a single
 * request: someone describes a trip over an evening, closes the tab, and comes
 * back to it. Losing that to a redeploy is the failure this exists to prevent.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. Deliberately the smallest thing that works.
 *
 * Only the conversation is modelled here. The trip itself — itinerary, dates,
 * bookings — lands once its shape is designed; a table guessed at now would be
 * a migration to undo rather than a head start.
 */

import type { Database } from "better-sqlite3";

/**
 * Each entry is one irreversible step. Never edit a shipped migration — append
 * a new one, or an existing database and a fresh one end up different shapes.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — conversations and their turns.
  `
  CREATE TABLE conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX conversations_updated_at ON conversations (updated_at DESC);

  CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL
  ) STRICT;

  -- Every read of a transcript is "this conversation, in order", so the index
  -- covers both halves rather than leaving the sort to a scan.
  CREATE INDEX messages_conversation ON messages (conversation_id, created_at);
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
