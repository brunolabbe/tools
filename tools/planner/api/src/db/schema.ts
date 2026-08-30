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
 * being a chat on 2026-08-14. Migration 3 is where its tables finally go, in
 * the same step that adds the intake replacing them.
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
  // 3 — the tool stopped being a chat (2026-08-14). Intakes and their answers
  // replace conversations and their turns, and migration 1's tables go here.
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
  // 4 — the run: the job that turns a brief into a revision (pl-16).
  //
  // Migration 2 wrote the plan and its drafts but nothing that produced them,
  // and said so: `plan_candidates`' own comment left the run it came from to
  // this ticket. That column is added here rather than folded into migration 2,
  // which has shipped.
  `
  CREATE TABLE plan_runs (
    id               TEXT PRIMARY KEY,
    -- The plan is written *before* the fan-out, so the run always has somewhere
    -- to report to. That is why this is NOT NULL and why a plan with no
    -- revisions is a reachable state — see \`latestRevision\`.
    plan_id          TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    -- A \`RunStatus\`. Not a CHECK constraint: the legal values and the legal
    -- moves between them are \`RUN_TRANSITIONS\` in @planner/contract, and a
    -- second half-copy of that here would be the one that goes stale.
    status           TEXT NOT NULL,
    -- How many specialists this run pays for. NULL while queued: the roster is
    -- decided as the fan-out starts, and "not decided yet" is not zero.
    roster_size      INTEGER,
    specialists_done INTEGER NOT NULL DEFAULT 0,
    -- The AppError payload, whole. Only ever read entire and rendered, never
    -- filtered on — the same argument that makes the brief and the gaps JSON.
    error_json       TEXT,
    started_at       TEXT NOT NULL,
    -- Set when the run reaches a terminal state, and only then.
    finished_at      TEXT
  ) STRICT;

  -- "What happened to this plan, most recent first" is the only read.
  CREATE INDEX plan_runs_plan ON plan_runs (plan_id, started_at DESC);

  -- Which run proposed a candidate. Nullable because nothing enforces that a
  -- candidate came from a run — a re-plan may reuse one an earlier run minted,
  -- and rows written before this migration have no run at all.
  ALTER TABLE plan_candidates ADD COLUMN run_id TEXT REFERENCES plan_runs (id);
  `,
  // 5 — the grounding cache (pl-25).
  //
  // A table and not a service, decided in `01-ARCHITECTURE.md` and not
  // re-litigated here: it must survive a restart, because a distance is good
  // for months and re-measuring the same road every boot is the entire cost
  // this exists to avoid; and it must be answerable, because the first question
  // about a plan citing something surprising is "what did we read, and when".
  //
  // **Answerable by query, not readable by browsing**, and the difference is
  // `key` — see its own note below. Everything a `SELECT` returns about a row
  // is honest; the column that identifies the row is the one that will not read
  // back by eye.
  `
  CREATE TABLE grounding_cache (
    -- The seam's method: \`locate\` or \`travel\` today. Deliberately not a CHECK
    -- constraint — the methods are \`GroundingProvider\`'s in @planner/agent, and
    -- a second half-copy of that list here is the copy that would go stale, the
    -- same argument \`plan_runs.status\` already makes about \`RUN_TRANSITIONS\`.
    kind         TEXT NOT NULL,
    -- The normalised question. What the normalisation drops is written down on
    -- \`locateKey\` and \`travelKey\` and it drops as little as it can: case,
    -- surrounding and repeated whitespace, and control characters. Anything
    -- more and two different questions start sharing an answer, which is a
    -- cache that lies rather than one that misses.
    --
    -- **It embeds a NUL between its parts, and that costs legibility.** The
    -- separator has to be something a place name cannot contain — the names
    -- come from a model, and a space would let \`quebec\`+\`city rimouski\` forge
    -- \`quebec city\`+\`rimouski\`. Storage, comparison and lookup are all exact:
    -- two keys differing only after the NUL are two rows and each is found by
    -- its own key. But SQLite's \`length()\`, \`substr\` and \`LIKE\`, and most
    -- database browsers, stop at the first NUL — so \`alma<NUL>quebec\` displays
    -- as \`alma\`, and so does \`alma<NUL>saguenay\`. Query this column by
    -- equality with a key the code built; do not read it off a screen and do
    -- not trust \`LIKE\` against it.
    key          TEXT NOT NULL,
    -- The answer, whole: coordinates for \`locate\`, a distance and a duration
    -- for \`travel\`. JSON on migration 2's rule — read entire, never filtered
    -- on, and validated against a schema on the way back out.
    payload_json TEXT NOT NULL,
    -- The \`Source\` behind it. Beside the answer rather than inside it, because
    -- a cached fact with no provenance is one \`provenanceSchema\` refuses and
    -- the plan view renders as unverified.
    source_json  TEXT NOT NULL,
    -- When the fact was read, as the backend's own \`Source\` reported it —
    -- never when this row was written, and never \`now()\` on the way out. A hit
    -- is the same fact read at the same moment it was read the first time, and
    -- \`Source.fetchedAt\` is what decides whether it may still be shown.
    fetched_at   TEXT NOT NULL,
    -- Computed on write from the kind's TTL, so a later change to that TTL
    -- neither resurrects nor kills what is already in here — and so the table
    -- answers "what is still good" without the reader knowing any TTL at all.
    expires_at   TEXT NOT NULL,
    PRIMARY KEY (kind, key)
  ) STRICT;

  -- Eviction is \`DELETE FROM grounding_cache WHERE expires_at <= ?\`, on boot
  -- and after a run. The index is for that sweep, not for a read: a lookup goes
  -- through the primary key.
  CREATE INDEX grounding_cache_expires_at ON grounding_cache (expires_at);
  `,
  // 6 — what the days were packed against (pl-27).
  //
  // Grounding measures the transition between one item and the next, and the
  // composer packs under it. That measurement is **evidence** rather than a
  // derivation — it came from outside, at a moment, from a source — so unlike
  // `UncheckedConstraint` it is stored: its cache row will expire, and a plan
  // has to keep being able to say what it was packed against and when that was
  // read. See the header on `contract/src/travel.ts`.
  //
  // JSON by migration 2's rule: a `MeasuredTravel` is read whole, validated by
  // a schema on the way out, and has no field SQL would ever filter on. NULL
  // means nothing measured it, which covers no backend, no answer, and no
  // previous item on the day.
  `
  ALTER TABLE plan_items ADD COLUMN travel_json TEXT;

  -- The append-only trigger names the frozen columns one by one rather than
  -- leaving a gap, so a new column is not covered until it is listed. Recreated
  -- rather than left alone: a measurement is frozen with the revision that
  -- packed under it, and "only pinned may change" has to keep meaning that.
  DROP TRIGGER plan_items_only_pinned_is_mutable;

  CREATE TRIGGER plan_items_only_pinned_is_mutable
  BEFORE UPDATE OF day_id, candidate_id, position, starts_at, note, travel_json ON plan_items
  BEGIN
    SELECT RAISE(ABORT, 'only pinned may change on a placed item');
  END;
  `,
  // 7 — what a corridor discovery pass could not find much on (pl-29).
  //
  // Discovery runs *before* the fan-out and proposes what the specialists that
  // read map data get to judge — see `00-ANALYSIS.md` §5's amendment. A
  // corridor with little on it is a fact a live backend answered once, at
  // compose time, and like `travel_json` in migration 6 it is evidence rather
  // than a derivation: nothing re-asks the backend on a later read, so the
  // answer has to survive the read some other way. Unlike `travel_json` it is
  // plan-wide rather than per-item, so it rides on the revision itself, beside
  // `gaps_json` — same reasoning (JSON, read whole, validated on the way out,
  // no field SQL would ever filter on), different column because a gap names a
  // specialist and this does not.
  `
  ALTER TABLE plan_revisions ADD COLUMN coverage_json TEXT NOT NULL DEFAULT '[]';
  `,

  // 8. Editorial context about the route rather than about a place on it —
  // pl-33's `PlanRevision.reading`.
  //
  // Its own column beside `coverage_json` for the same reason that one is
  // beside `gaps_json`: JSON on migration 2's rule, read whole and validated
  // on the way out, with no field SQL would filter on — but a different kind
  // of thing. `coverage_json` is what could *not* be checked; this is what was
  // found and is worth reading. Folding them together would need a discriminant
  // on every read to tell them apart again.
  //
  // `DEFAULT '[]'` so every revision written before this migration reads back
  // as "nothing checked", which is what they are — the same shape migration 7
  // used, and the reason neither needed a backfill.
  `
  ALTER TABLE plan_revisions ADD COLUMN reading_json TEXT NOT NULL DEFAULT '[]';
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
