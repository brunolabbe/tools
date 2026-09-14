import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/db/schema.ts";

function tables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name).filter((name) => !name.startsWith("sqlite_"));
}

function columns(db: Database.Database, table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return rows.map((row) => row.name);
}

function userVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }));
}

/** What migration 9 added to `plan_runs` (pl-49), in the order it added them. */
const USAGE_COLUMNS = [
  "model",
  "model_calls",
  "input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "output_tokens",
  "fallback_calls",
];

/**
 * Migration 9, undone — so a test can wind a current database back past it.
 * Plain `DROP COLUMN`s: nothing references these from a trigger or an index.
 */
const UNDO_MIGRATION_9 = USAGE_COLUMNS.map(
  (column) => `ALTER TABLE plan_runs DROP COLUMN ${column};`,
).join("\n");

describe("migrations", () => {
  test("a fresh database arrives at the current schema", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(tables(db)).toEqual([
      "answers",
      "grounding_cache",
      "intakes",
      "plan_candidates",
      "plan_days",
      "plan_items",
      "plan_revisions",
      "plan_runs",
      "plans",
    ]);
    expect(userVersion(db)).toBe(9);
    db.close();
  });

  test("a database that already ran migration 1 is carried forward", () => {
    const db = new Database(":memory:");
    // What the published image left behind: the chat this tool stopped being.
    // Migration 3 was appended rather than folded into 1 for exactly this
    // database — an edited migration 1 would never be applied here.
    db.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE INDEX conversations_updated_at ON conversations (updated_at DESC);
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE INDEX messages_conversation ON messages (conversation_id, created_at);
      PRAGMA user_version = 1;
    `);
    db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?)").run("old", null, "then", "then");

    migrate(db);

    expect(tables(db)).toContain("intakes");
    expect(tables(db)).not.toContain("conversations");
    expect(userVersion(db)).toBe(9);
    db.close();
  });

  test("migrations 5 through 9 apply to a database at user_version = 4", () => {
    // The case that actually happens for pl-25, pl-27 and pl-29: a deployment
    // already carrying the run tables gets the grounding cache, the measured
    // transition and the discovery coverage column added under it, with
    // everything in the database left where it was.
    //
    // Wound back rather than hand-written, unlike `atVersionOne` in
    // `schema.test.ts`. Migration 4 is `ALTER TABLE` on top of three earlier
    // ones, so a hand-written version-4 database would be a fourth copy of the
    // whole schema, and the first thing to rot. What matters here is that all
    // three are *appended* — that a database which has already applied 1
    // through 4 receives them and nothing else.
    //
    // Undoing 6 is three statements rather than one because the append-only
    // trigger names its frozen columns: SQLite refuses to drop a column a
    // trigger mentions, so the trigger goes back to its migration-2 form first.
    // Undoing 7 and 8 is a plain `DROP COLUMN` each, because nothing
    // references `coverage_json` or `reading_json` from a trigger.
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`
      DROP TABLE grounding_cache;
      DROP TRIGGER plan_items_only_pinned_is_mutable;
      ALTER TABLE plan_items DROP COLUMN travel_json;
      CREATE TRIGGER plan_items_only_pinned_is_mutable
      BEFORE UPDATE OF day_id, candidate_id, position, starts_at, note ON plan_items
      BEGIN
        SELECT RAISE(ABORT, 'only pinned may change on a placed item');
      END;
      ALTER TABLE plan_revisions DROP COLUMN coverage_json;
      ALTER TABLE plan_revisions DROP COLUMN reading_json;
      ${UNDO_MIGRATION_9}
      PRAGMA user_version = 4;
    `);
    db.prepare(
      "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("kept", "A road trip", 1, "then", "then");

    migrate(db);

    expect(userVersion(db)).toBe(9);
    expect(tables(db)).toContain("grounding_cache");
    expect(columns(db, "plan_items")).toContain("travel_json");
    expect(columns(db, "plan_revisions")).toContain("coverage_json");
    expect(columns(db, "plan_revisions")).toContain("reading_json");
    expect(columns(db, "plan_runs")).toEqual(expect.arrayContaining(USAGE_COLUMNS));
    expect(db.prepare("SELECT COUNT(*) AS n FROM intakes").get()).toEqual({ n: 1 });
    db.close();
  });

  test("a fresh database's runs carry a column for each token kind (pl-49)", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(userVersion(db)).toBe(9);
    expect(columns(db, "plan_runs")).toEqual(expect.arrayContaining(USAGE_COLUMNS));
    db.close();
  });

  test("migration 9 applies to a database at user_version = 8, and a run already there reads as unrecorded", () => {
    // The case that actually happens for pl-49: a deployment already carrying
    // runs gets the usage columns added under them. A run that finished before
    // this migration spent something nobody recorded, so every column is NULL
    // rather than a zero that would read as free.
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`
      ${UNDO_MIGRATION_9}
      PRAGMA user_version = 8;
    `);
    expect(columns(db, "plan_runs")).not.toContain("input_tokens");
    db.prepare(
      "INSERT INTO plans (id, title, brief_json, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("p", "A trip", "{}", "then", "then");
    db.prepare(
      "INSERT INTO plan_runs (id, plan_id, status, started_at, finished_at) VALUES (?,?,?,?,?)",
    ).run("r", "p", "done", "then", "then");

    migrate(db);

    expect(userVersion(db)).toBe(9);
    expect(columns(db, "plan_runs")).toEqual(expect.arrayContaining(USAGE_COLUMNS));
    const row = db
      .prepare(`SELECT ${USAGE_COLUMNS.join(", ")} FROM plan_runs WHERE id = ?`)
      .get("r") as Record<string, unknown>;
    expect(Object.values(row)).toEqual(USAGE_COLUMNS.map(() => null));
    db.close();
  });

  test("a placed item's measurement is frozen with the revision that packed it", () => {
    // The trigger recreated by migration 6. `travel_json` is evidence the days
    // follow from, so it belongs on the frozen side of "only pinned may change"
    // — and a column left off that list would be mutable by omission.
    const db = new Database(":memory:");
    migrate(db);
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'plan_items_only_pinned_is_mutable'")
      .get() as { sql: string };

    expect(trigger.sql).toContain("travel_json");
    db.close();
  });

  test("running twice changes nothing", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(
      "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("kept", "A road trip", 1, "then", "then");

    migrate(db);

    expect(userVersion(db)).toBe(9);
    expect(db.prepare("SELECT COUNT(*) AS n FROM intakes").get()).toEqual({ n: 1 });
    db.close();
  });

  test("a fresh database's revisions carry a coverage column", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(columns(db, "plan_revisions")).toContain("coverage_json");
    expect(columns(db, "plan_revisions")).toContain("reading_json");
    db.close();
  });

  test("migrations 7 and 8 backfill existing revisions with empty lists", () => {
    // The case that actually happens for pl-29: a deployment already carrying
    // plan revisions from before this ticket gets the column added under it,
    // and every row that predates the discovery pass has to read back as
    // "nothing was ever queried" rather than as a NULL a reader has to guess
    // about.
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`
      ALTER TABLE plan_revisions DROP COLUMN coverage_json;
      ALTER TABLE plan_revisions DROP COLUMN reading_json;
      ${UNDO_MIGRATION_9}
      PRAGMA user_version = 6;
    `);
    db.prepare(
      "INSERT INTO plans (id, title, brief_json, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("p", "A trip", "{}", "then", "then");
    db.prepare(
      `INSERT INTO plan_revisions
         (id, plan_id, revision, parent_revision_id, reason, gaps_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("r", "p", 1, null, "The first draft.", "[]", "then");

    migrate(db);

    expect(userVersion(db)).toBe(9);
    const row = db
      .prepare("SELECT coverage_json, reading_json FROM plan_revisions WHERE id = ?")
      .get("r") as { coverage_json: string; reading_json: string };
    expect(row.coverage_json).toBe("[]");
    // pl-33's migration 8, on the same rule: a revision written before the
    // column existed reads back as "nothing checked", not as a NULL a reader
    // has to have an opinion about.
    expect(row.reading_json).toBe("[]");
    db.close();
  });
});
