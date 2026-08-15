import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { migrate } from "../src/db/schema.ts";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function fresh(): Database.Database {
  db = new Database(":memory:");
  migrate(db);
  return db;
}

/**
 * A database at migration 1 and nothing more — the shape a deployment that has
 * been running since Phase 0 is actually in. Built by hand rather than by
 * replaying `MIGRATIONS[0]`, so an accidental edit to a shipped migration shows
 * up here as a mismatch instead of being applied to both sides.
 */
function atVersionOne(): Database.Database {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX conversations_updated_at ON conversations (updated_at DESC);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX messages_conversation ON messages (conversation_id, created_at);
    PRAGMA user_version = 1;
  `);
  return db;
}

function tableNames(database: Database.Database): string[] {
  return database
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
    .toSorted();
}

/** A plan with one revision, one day and one item on it. Ids are the plan's. */
function seedPlan(database: Database.Database): void {
  database.exec(`
    INSERT INTO plans (id, title, brief_json, created_at, updated_at)
      VALUES ('plan-1', 'Gaspésie', '{}', '2026-08-15T10:00:00.000Z', '2026-08-15T10:00:00.000Z');
    INSERT INTO plan_candidates (id, plan_id, specialist, candidate_json, created_at)
      VALUES ('cand-1', 'plan-1', 'lodging', '{}', '2026-08-15T10:01:00.000Z');
    INSERT INTO plan_revisions (id, plan_id, revision, parent_revision_id, reason, gaps_json, created_at)
      VALUES ('rev-1', 'plan-1', 1, NULL, 'First draft', '[]', '2026-08-15T10:05:00.000Z');
    INSERT INTO plan_days (id, revision_id, day_index, date)
      VALUES ('day-1', 'rev-1', 0, '2027-07-03');
    INSERT INTO plan_items (id, day_id, candidate_id, position, starts_at, pinned, note)
      VALUES ('item-1', 'day-1', 'cand-1', 0, NULL, 0, NULL);
  `);
}

describe("migrate", () => {
  test("applies to an existing database, retiring migration 1's tables", () => {
    // The case that actually happens: a deployment that has been running since
    // Phase 0 gets the plan tables added under it by migration 2, and its
    // conversation tables replaced by the intake in migration 3.
    const database = atVersionOne();
    migrate(database);

    expect(database.pragma("user_version", { simple: true })).toBe(3);
    expect(tableNames(database)).toEqual([
      "answers",
      "intakes",
      "plan_candidates",
      "plan_days",
      "plan_items",
      "plan_revisions",
      "plans",
    ]);
  });

  test("a fresh database ends in the same shape as a migrated one", () => {
    const migrated = atVersionOne();
    migrate(migrated);
    const before = tableNames(migrated);
    migrated.close();

    expect(tableNames(fresh())).toEqual(before);
  });

  test("is idempotent", () => {
    const database = fresh();
    migrate(database);
    migrate(database);
    expect(database.pragma("user_version", { simple: true })).toBe(3);
  });
});

describe("the plan tables", () => {
  test("a plan and its whole document insert and read back", () => {
    const database = fresh();
    seedPlan(database);

    const row = database
      .prepare<[], { title: string; pinned: number; date: string | null }>(
        `SELECT p.title, i.pinned, d.date
           FROM plans p
           JOIN plan_revisions r ON r.plan_id = p.id
           JOIN plan_days d ON d.revision_id = r.id
           JOIN plan_items i ON i.day_id = d.id`,
      )
      .get();

    expect(row).toEqual({ title: "Gaspésie", pinned: 0, date: "2027-07-03" });
  });

  test("two revisions of one plan cannot share a number", () => {
    // The corruption a concurrent re-plan would produce, and the one that makes
    // a diff meaningless.
    const database = fresh();
    seedPlan(database);

    expect(() =>
      database.exec(`
        INSERT INTO plan_revisions (id, plan_id, revision, parent_revision_id, reason, gaps_json, created_at)
          VALUES ('rev-2', 'plan-1', 1, 'rev-1', 'Also first', '[]', '2026-08-15T11:00:00.000Z');
      `),
    ).toThrow(/UNIQUE/);
  });

  test("a day cannot have two items in the same position", () => {
    const database = fresh();
    seedPlan(database);

    expect(() =>
      database.exec(`
        INSERT INTO plan_items (id, day_id, candidate_id, position, starts_at, pinned, note)
          VALUES ('item-2', 'day-1', 'cand-1', 0, NULL, 0, NULL);
      `),
    ).toThrow(/UNIQUE/);
  });

  test("pinned is a boolean, whatever STRICT thinks", () => {
    const database = fresh();
    seedPlan(database);

    expect(() =>
      database.exec(`
        INSERT INTO plan_items (id, day_id, candidate_id, position, starts_at, pinned, note)
          VALUES ('item-2', 'day-1', 'cand-1', 1, NULL, 2, NULL);
      `),
    ).toThrow(/CHECK/);
  });

  test("deleting a plan takes its revisions, days and items with it", () => {
    const database = fresh();
    seedPlan(database);
    database.exec("DELETE FROM plans WHERE id = 'plan-1'");

    for (const table of ["plan_revisions", "plan_days", "plan_items", "plan_candidates"]) {
      const { n } = database
        .prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`)
        .get() ?? { n: -1 };
      expect(n).toBe(0);
    }
  });

  test("a candidate a revision placed cannot be deleted out from under it", () => {
    const database = fresh();
    seedPlan(database);

    expect(() => database.exec("DELETE FROM plan_candidates WHERE id = 'cand-1'")).toThrow(
      /FOREIGN KEY/,
    );
  });
});

describe("append-only", () => {
  test("a revision cannot be rewritten", () => {
    // §6's claim, enforced by the database rather than trusted to every future
    // writer. A caller that means to change a draft makes a new one.
    const database = fresh();
    seedPlan(database);

    expect(() =>
      database.exec("UPDATE plan_revisions SET reason = 'edited' WHERE id = 'rev-1'"),
    ).toThrow(/append-only/);
  });

  test("a day cannot be re-dated", () => {
    const database = fresh();
    seedPlan(database);

    expect(() =>
      database.exec("UPDATE plan_days SET date = '2027-07-04' WHERE id = 'day-1'"),
    ).toThrow(/append-only/);
  });

  test("a placed item cannot be moved", () => {
    const database = fresh();
    seedPlan(database);

    expect(() => database.exec("UPDATE plan_items SET position = 3 WHERE id = 'item-1'")).toThrow(
      /only pinned may change/,
    );
    expect(() =>
      database.exec("UPDATE plan_items SET day_id = 'day-1' WHERE id = 'item-1'"),
    ).toThrow(/only pinned may change/);
  });

  test("but it can be pinned, and that is the only thing that may change", () => {
    // Pinning is a statement about what the *next* re-plan may touch, not an
    // edit to this draft — a revision per pin toggle would fill the history
    // with intent and no content.
    const database = fresh();
    seedPlan(database);

    database.exec("UPDATE plan_items SET pinned = 1 WHERE id = 'item-1'");
    const row = database
      .prepare<[], { pinned: number }>("SELECT pinned FROM plan_items WHERE id = 'item-1'")
      .get();

    expect(row?.pinned).toBe(1);
  });
});
