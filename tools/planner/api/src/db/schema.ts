/**
 * SQLite schema and migrations.
 *
 * A plan is persisted because planning is not a single request: someone
 * describes a trip over an evening, closes the tab, and comes back to it — and
 * then keeps changing the plan for weeks. Losing either to a redeploy is the
 * failure this exists to prevent.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. Deliberately the smallest thing that works.
 *
 * Migration 1 is the conversation, and it is **history**: this tool stopped
 * being a chat on 2026-08-14. Its tables are still here because dropping them
 * belongs with the intake that replaces them, which is pl-7's migration and not
 * this one. Nothing reads them.
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
  // 2 — the plan document: what was planned, from what, and every draft of it.
  //
  // Migration 1's tables are left alone. They are superseded — there is no
  // conversation any more — but dropping them is pl-7's migration, which
  // replaces them with the intake in one step. A drop here would be a second
  // migration doing half of that one's job.
  //
  // **Rows where something is addressed, JSON where a value is read whole.**
  // Days and items get columns because they are what a revision is *edited* by:
  // pinning is an UPDATE of one row, and §6's slicing names days. The brief, a
  // candidate and the gap list are only ever read and written entire, are
  // validated by a schema in `@planner/contract` on the way out, and have no
  // field SQL would ever filter on — so they are JSON, and adding a field to
  // one of them is not a migration.
  `
  CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    -- The brief this plan was drafted from, as it was at the time. A snapshot
    -- and not a link: the intake stays editable afterwards, so the live brief
    -- drifts, and "why is there no lodging in here?" is answerable only
    -- against the one the fan-out actually read. pl-7 owns the live intake and
    -- may add a reference beside this; it does not replace it.
    brief_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  -- The plans list is "mine, most recently touched first", and nothing else.
  CREATE INDEX plans_updated_at ON plans (updated_at DESC);

  -- Candidates hang off the plan rather than off a revision: one the composer
  -- did not place is what the next revision draws on when the user says they
  -- cannot afford the second hotel, and one that two revisions both place must
  -- not be stored twice. pl-5 owns the run that produces them and may add the
  -- run it came from.
  CREATE TABLE plan_candidates (
    id             TEXT PRIMARY KEY,
    plan_id        TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    -- Lifted out of the JSON because "which agents ran, and why" is the first
    -- question anyone debugging a bad plan asks, and it should not cost a scan
    -- and a parse of every candidate to answer.
    specialist     TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    created_at     TEXT NOT NULL
  ) STRICT;

  CREATE INDEX plan_candidates_plan ON plan_candidates (plan_id, specialist);

  CREATE TABLE plan_revisions (
    id                 TEXT PRIMARY KEY,
    plan_id            TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    revision           INTEGER NOT NULL,
    parent_revision_id TEXT REFERENCES plan_revisions (id),
    reason             TEXT NOT NULL,
    -- What this draft could not cover. On the revision and not the plan: a
    -- re-plan that finally reaches the lodging specialist closes the gap, and
    -- that closing is what the diff between two revisions should show.
    gaps_json          TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    -- Two drafts numbered 3 is the corruption that makes a diff meaningless,
    -- and it is the one a concurrent re-plan would produce.
    UNIQUE (plan_id, revision)
  ) STRICT;

  -- The common read is the latest draft of one plan.
  CREATE INDEX plan_revisions_plan ON plan_revisions (plan_id, revision DESC);

  CREATE TABLE plan_days (
    id          TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES plan_revisions (id) ON DELETE CASCADE,
    day_index   INTEGER NOT NULL,
    -- Nullable because a brief may have no calendar: "ten nights, whenever is
    -- best" is a real trip, and a NOT NULL here would force the tool to invent
    -- a departure date and then plan against it as though it were chosen.
    date        TEXT,
    UNIQUE (revision_id, day_index)
  ) STRICT;

  CREATE TABLE plan_items (
    id           TEXT PRIMARY KEY,
    day_id       TEXT NOT NULL REFERENCES plan_days (id) ON DELETE CASCADE,
    -- No ON DELETE: a candidate that a revision placed must not be deletable
    -- out from under it. RESTRICT is the default, and it is the one we want.
    candidate_id TEXT NOT NULL REFERENCES plan_candidates (id),
    position     INTEGER NOT NULL,
    starts_at    TEXT,
    -- STRICT has no boolean type; 0 or 1, and the CHECK is what keeps it so.
    pinned       INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    note         TEXT,
    UNIQUE (day_id, position)
  ) STRICT;

  CREATE INDEX plan_items_day ON plan_items (day_id, position);

  -- §6's "revisions append; they never overwrite" is the claim the whole
  -- revision feature rests on, so it is enforced here rather than trusted to
  -- every future writer. A caller that means to change a draft makes a new one.
  CREATE TRIGGER plan_revisions_append_only
  BEFORE UPDATE ON plan_revisions
  BEGIN
    SELECT RAISE(ABORT, 'plan revisions are append-only');
  END;

  CREATE TRIGGER plan_days_append_only
  BEFORE UPDATE ON plan_days
  BEGIN
    SELECT RAISE(ABORT, 'a revision''s days are append-only');
  END;

  -- The one exception, and it is named column by column rather than left as a
  -- gap: "pinned" is a statement about what the *next* re-plan may touch, not
  -- an edit to this draft, so it moves in place. Everything else about a placed
  -- item is frozen with the revision that placed it.
  CREATE TRIGGER plan_items_only_pinned_is_mutable
  BEFORE UPDATE OF day_id, candidate_id, position, starts_at, note ON plan_items
  BEGIN
    SELECT RAISE(ABORT, 'only pinned may change on a placed item');
  END;
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
