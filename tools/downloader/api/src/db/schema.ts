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
 *
 * Exported so a test can apply a prefix by hand — "a database already at
 * migration N" — without duplicating the SQL.
 */
export const MIGRATIONS: readonly string[] = [
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

  // 3 — the preview image's proxied path, snapshotted onto the job.
  //
  // A path on this API, never the origin URL a page named. Nullable and with no
  // default, so every job written before dl-29 reads back as "no preview" — the
  // case the UI has to render anyway, since a probe that found no image is the
  // common one.
  `ALTER TABLE jobs ADD COLUMN thumbnail_path TEXT;`,

  // 4 — where a completed job's preview image was written on disk (dl-44).
  //
  // The in-memory store the token was minted against holds the bytes for ten
  // minutes; the file it depicts lives six hours. This row is how the same
  // token keeps resolving for the other five and fifty, and across a restart.
  //
  // No `expires_at` column, deliberately. The bytes sit inside `out/<job_id>/`,
  // so the retention sweep that deletes the file deletes them too — a second
  // expiry recorded here could only ever disagree with the first. The row is
  // cleaned up with the sweep, and cascades if the job itself is deleted.
  `
  CREATE TABLE thumbnail_files (
    token        TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    content_type TEXT NOT NULL,
    created_at   TEXT NOT NULL
  ) STRICT;

  CREATE INDEX thumbnail_files_job ON thumbnail_files (job_id);
  `,

  // 5 — durable outcomes for `POST /api/probe`, and the hostname a job was
  // created for (dl-57).
  //
  // Neither carries a path, a query string or an address. A signed URL keeps
  // its credential in the query string (the redaction rule in the root
  // `CLAUDE.md`), and a hostname is what every question this table answers
  // needs — which sites fail, at which resolver, how long a probe takes.
  // `jobs.host` is nullable because it is set at creation from here on; a row
  // written before dl-57 reads back as no host, the same "older build, older
  // shape" stance `thumbnail_path` already takes two migrations up.
  `
  CREATE TABLE probe_outcomes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host          TEXT NOT NULL,
    outcome       TEXT NOT NULL,
    resolver      TEXT,
    attempts_json TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL,
    cached        INTEGER NOT NULL DEFAULT 0,
    variants      INTEGER,
    drm           INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  ) STRICT;

  CREATE INDEX probe_outcomes_created_at ON probe_outcomes (created_at);

  ALTER TABLE jobs ADD COLUMN host TEXT;
  `,
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
