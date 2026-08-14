/**
 * SQLite schema and migrations.
 *
 * Jobs are persisted so a restart does not lose history — a 40-minute download
 * that vanishes because the process was redeployed is the failure mode this
 * exists to prevent.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. That is deliberately the smallest thing that works: adding
 * a migration framework to hold four `CREATE TABLE`s would be more machinery
 * than schema.
 */

import type { Database } from "better-sqlite3";

/**
 * Each entry is one irreversible step. Never edit a shipped migration — append
 * a new one, or an existing database and a fresh one end up different shapes.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — jobs, plus the capability tokens that address their output files.
  `
  CREATE TABLE jobs (
    id            TEXT PRIMARY KEY,
    source_url    TEXT NOT NULL,
    variant_id    TEXT,
    variant_json  TEXT,
    status        TEXT NOT NULL,
    progress_json TEXT NOT NULL,
    result_json   TEXT,
    error_json    TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    options_json  TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    finished_at   TEXT
  ) STRICT;

  CREATE INDEX jobs_created_at ON jobs (created_at DESC);
  CREATE INDEX jobs_status ON jobs (status);

  CREATE TABLE file_tokens (
    token      TEXT PRIMARY KEY,
    job_id     TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX file_tokens_job ON file_tokens (job_id);
  CREATE INDEX file_tokens_expires_at ON file_tokens (expires_at);
  `,

  // 2 — records that the sweep has already deleted a token's file.
  //
  // The row deliberately outlives the file. Deleting it at the same moment
  // would turn an expired link into a 404 ("never existed") when the honest
  // answer is 410 ("this is gone"), and that distinction is the whole
  // difference between a user thinking they mistyped a link and a user
  // understanding that downloads do not last forever.
  `ALTER TABLE file_tokens ADD COLUMN swept_at TEXT;`,
];

export function migrate(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Without this, a concurrent writer fails instantly with SQLITE_BUSY rather
  // than waiting. Two requests finishing a job at once is entirely normal.
  db.pragma("busy_timeout = 5000");

  const current = Number((db.pragma("user_version", { simple: true }) as number) ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    const statement = MIGRATIONS[version];
    if (statement === undefined) continue;
    db.exec("BEGIN");
    try {
      db.exec(statement);
      // Interpolated because PRAGMA does not accept a bound parameter. The
      // value is a loop index, never input.
      db.pragma(`user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
