/**
 * Migration 5 (dl-57): `probe_outcomes` and `jobs.host`.
 *
 * Two starting points, both required by the ticket's Done-when: a fresh
 * database, which runs every migration in one pass, and a database already at
 * migration 4, which exercises `migrate()`'s "resume from `user_version`" path
 * rather than the "run everything" one a fresh database never distinguishes
 * from it.
 */

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrate, MIGRATIONS } from "../src/db/schema.ts";

function columns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((row) => row.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

describe("a fresh database", () => {
  test("gets probe_outcomes and jobs.host from one migrate() pass", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(tableExists(db, "probe_outcomes")).toBe(true);
    expect(columns(db, "probe_outcomes")).toEqual([
      "id",
      "host",
      "outcome",
      "resolver",
      "attempts_json",
      "duration_ms",
      "cached",
      "variants",
      "drm",
      "created_at",
    ]);
    expect(columns(db, "jobs")).toContain("host");
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
  });
});

describe("a database already at migration 4", () => {
  test("gets the same table and column from the remaining migrate() pass", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    for (let version = 0; version < 4; version++) {
      db.exec(MIGRATIONS[version] as string);
    }
    db.pragma("user_version = 4");

    expect(tableExists(db, "probe_outcomes")).toBe(false);
    expect(columns(db, "jobs")).not.toContain("host");

    migrate(db);

    expect(tableExists(db, "probe_outcomes")).toBe(true);
    expect(columns(db, "jobs")).toContain("host");
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
  });
});
