import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { AppError, appendRevision, latestRevision } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { insertRevision, selectPlan } from "../src/db/plans.ts";
import { insertRun, selectRun } from "../src/db/runs.ts";
import { migrate } from "../src/db/schema.ts";

const NOW = "2026-08-15T12:00:00.000Z";

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

/**
 * Migration 10, undone (pl-44). The index goes first; neither column is named
 * by a trigger, so each is a plain `DROP COLUMN`.
 */
const UNDO_MIGRATION_10 = `
  DROP INDEX plan_runs_one_live;
  ALTER TABLE plan_runs DROP COLUMN kind;
  ALTER TABLE plan_revisions DROP COLUMN operation_json;
`;

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
    expect(userVersion(db)).toBe(10);
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
    expect(userVersion(db)).toBe(10);
    db.close();
  });

  test("migrations 5 through 10 apply to a database at user_version = 4", () => {
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
      ${UNDO_MIGRATION_10}
      ${UNDO_MIGRATION_9}
      PRAGMA user_version = 4;
    `);
    db.prepare(
      "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("kept", "A road trip", 1, "then", "then");

    migrate(db);

    expect(userVersion(db)).toBe(10);
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

    expect(userVersion(db)).toBe(10);
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
      ${UNDO_MIGRATION_10}
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

    expect(userVersion(db)).toBe(10);
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

    expect(userVersion(db)).toBe(10);
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
      ${UNDO_MIGRATION_10}
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

    expect(userVersion(db)).toBe(10);
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

describe("migration 10 — operations, run kinds and one live run (pl-44)", () => {
  const brief = loadFixture("road-trip").brief;

  /** A database wound back to `user_version = 9`, holding one first draft and the run that drafted it. */
  function atVersionNine(): Database.Database {
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`
      ${UNDO_MIGRATION_10}
      PRAGMA user_version = 9;
    `);
    db.prepare(
      "INSERT INTO plans (id, title, brief_json, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("p", "A trip", JSON.stringify(brief), NOW, NOW);
    db.prepare(
      `INSERT INTO plan_revisions
         (id, plan_id, revision, parent_revision_id, reason, gaps_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "p", 1, null, "The first draft.", "[]", NOW);
    db.prepare(
      "INSERT INTO plan_runs (id, plan_id, status, started_at, finished_at) VALUES (?,?,?,?,?)",
    ).run("run", "p", "done", NOW, NOW);
    return db;
  }

  test("a revision and a run already there read back as a first draft and a draft, with the trigger silent", () => {
    const db = atVersionNine();
    expect(columns(db, "plan_revisions")).not.toContain("operation_json");

    // `plan_revisions_append_only` raises on any UPDATE and would roll the
    // migration back: that this does not throw is the trigger not firing.
    expect(() => migrate(db)).not.toThrow();

    expect(userVersion(db)).toBe(10);
    // Through the read paths, not the raw columns: `toRevision` and `toRun`
    // read the columns now, where pl-42 wrote literals.
    expect(selectPlan(db, "p")?.revisions.map((each) => each.operation)).toEqual([
      { kind: "first-draft" },
    ]);
    expect(selectRun(db, "run")?.kind).toBe("draft");
    db.close();
  });

  test("a revision 2 and a re-plan run written afterwards read back their own values, not the DEFAULT", () => {
    const db = atVersionNine();
    migrate(db);

    const plan = selectPlan(db, "p");
    if (plan === undefined) throw new Error("no plan");
    const operation = { kind: "restore", revision: 1 } as const;
    const second = latestRevision(
      appendRevision(plan, {
        id: "r2",
        reason: "Restored version 1.",
        operation,
        createdAt: NOW,
        days: [],
        gaps: [],
        coverage: [],
        reading: [],
      }),
    );
    if (second === null) throw new Error("no revision 2");
    insertRevision(db, second);
    insertRun(db, { id: "again", planId: "p", kind: "replan", status: "queued", now: NOW });

    expect(selectPlan(db, "p")?.revisions.map((each) => each.operation)).toEqual([
      { kind: "first-draft" },
      operation,
    ]);
    expect(selectRun(db, "again")?.kind).toBe("replan");
    db.close();
  });

  test("the literals are gone: a stored operation that does not parse is a fatal read", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(
      "INSERT INTO plans (id, title, brief_json, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("p", "A trip", JSON.stringify(brief), NOW, NOW);
    db.prepare(
      `INSERT INTO plan_revisions
         (id, plan_id, revision, parent_revision_id, reason, operation_json, gaps_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("r1", "p", 1, null, "The first draft.", '{"kind":"teleport"}', "[]", NOW);

    expect(() => selectPlan(db, "p")).toThrow(AppError);
    db.close();
  });

  test("a second live run for one plan is refused by the database, and a finished one is not counted", () => {
    const db = atVersionNine();
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO plan_runs (id, plan_id, status, started_at, finished_at) VALUES (?,?,?,?,?)",
    );

    // The existing run is finished, so one live run beside it is allowed…
    insert.run("live", "p", "fanning-out", NOW, null);
    // …and a second live one is not, whatever wrote it.
    expect(() => insert.run("second", "p", "queued", NOW, null)).toThrow(
      /UNIQUE constraint failed/,
    );
    db.close();
  });

  test("insertRun turns that refusal into PLAN_BUSY naming the live run, never INTERNAL", () => {
    const db = atVersionNine();
    migrate(db);
    insertRun(db, { id: "live", planId: "p", kind: "replan", status: "queued", now: NOW });

    try {
      insertRun(db, { id: "second", planId: "p", kind: "replan", status: "queued", now: NOW });
      expect.unreachable("a second live run was inserted");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PLAN_BUSY");
      expect((error as AppError).details).toEqual({ run: "live" });
    }
    db.close();
  });
});
