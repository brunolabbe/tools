import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/db/schema.ts";

function tables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name).filter((name) => !name.startsWith("sqlite_"));
}

function userVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }));
}

describe("migrations", () => {
  test("a fresh database arrives at the current schema", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(tables(db)).toEqual([
      "answers",
      "intakes",
      "plan_candidates",
      "plan_days",
      "plan_items",
      "plan_revisions",
      "plans",
    ]);
    expect(userVersion(db)).toBe(3);
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
    expect(userVersion(db)).toBe(3);
    db.close();
  });

  test("running twice changes nothing", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(
      "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("kept", "A road trip", 1, "then", "then");

    migrate(db);

    expect(userVersion(db)).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM intakes").get()).toEqual({ n: 1 });
    db.close();
  });
});
