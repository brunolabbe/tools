/**
 * SQLite schema and migrations.
 *
 * An intake is persisted because describing a trip is not a single request:
 * someone answers over an evening, closes the tab, and comes back to it. Losing
 * that to a redeploy is the failure this exists to prevent.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. Deliberately the smallest thing that works.
 *
 * Only the intake is modelled here. The plan — revisions, days, items — lands
 * with Phase 2; a table guessed at now would be a migration to undo rather than
 * a head start.
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
  // 2 — the tool stopped being a chat (2026-08-14). Intakes and their answers
  // replace conversations and their turns.
  //
  // Appended rather than folded into migration 1, although no database of
  // consequence exists: the published image already carries migration 1, so
  // anything that has run it sits at `user_version = 1` and would never see an
  // edited version of a migration it has already applied.
  `
  DROP TABLE messages;
  DROP TABLE conversations;

  CREATE TABLE intakes (
    id           TEXT PRIMARY KEY,
    -- Derived from the answers, stored so the list route does not have to
    -- assemble every brief to render a row.
    title        TEXT,
    -- Which tree version these answers were last reconciled against. An intake
    -- whose version has moved is visible rather than silent.
    tree_version INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  ) STRICT;

  CREATE INDEX intakes_updated_at ON intakes (updated_at DESC);

  -- One row per answer rather than a blob per intake: discarding an abandoned
  -- branch is then a DELETE, and re-answering is idempotent by primary key
  -- rather than by care.
  CREATE TABLE answers (
    intake_id   TEXT NOT NULL REFERENCES intakes (id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    value       TEXT NOT NULL,     -- JSON, parsed against the contract schema
    answered_at TEXT NOT NULL,
    PRIMARY KEY (intake_id, question_id)
  ) STRICT;
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
