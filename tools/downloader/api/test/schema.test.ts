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
import { JobStore } from "../src/db/job-store.ts";
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

/** A database at migration 5, holding the rows migration 6 has to carry. */
function atMigration5(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  for (let version = 0; version < 5; version++) {
    db.exec(MIGRATIONS[version] as string);
  }
  db.pragma("user_version = 5");
  const insert = db.prepare(
    `INSERT INTO jobs (id, source_url, status, progress_json, options_json, created_at, updated_at, result_json)
     VALUES (?, 'https://site.example/w', ?, ?, '{}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:05:00.000Z', ?)`,
  );
  // oxlint-disable-next-line consistent-function-scoping -- used only here
  const progress = (stage: string): string =>
    JSON.stringify({
      stage,
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      segmentsDone: null,
      segmentsTotal: null,
      speedBps: null,
      etaSec: null,
      processedSec: null,
    });
  insert.run("was-muxing", "muxing", progress("muxing"), null);
  insert.run(
    "was-completed",
    "completed",
    progress("completed"),
    JSON.stringify({
      filename: "v.mp4",
      sizeBytes: 10,
      container: "mp4",
      durationSec: 1,
      downloadUrl: "/api/files/old",
      expiresAt: "2026-09-01T06:00:00.000Z",
    }),
  );
  db.prepare(
    `INSERT INTO file_tokens (token, job_id, path, filename, size_bytes, expires_at, created_at)
     VALUES ('old', 'was-completed', '/data/out/was-completed/v.mp4', 'v.mp4', 10, '2026-09-01T06:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run();
  return db;
}

describe("migration 6 (dl-53): links in, stored files and `muxing` out", () => {
  test("a row caught in `muxing` is failed, and every row reads back through the schema", () => {
    const db = atMigration5();
    migrate(db);
    const store = new JobStore(db);

    // Before this migration a `muxing` row would not parse, and `unfinished()`
    // reads it at boot: the service would not start.
    const failed = store.get("was-muxing");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("INTERNAL");
    expect(failed.finishedAt).toBe("2026-09-01T00:05:00.000Z");

    // A result written with a link keeps parsing, without the link.
    const completed = store.get("was-completed");
    expect(completed.result).toEqual({
      filename: "v.mp4",
      sizeBytes: 10,
      container: "mp4",
      durationSec: 1,
    });
    expect(completed.link).toBeNull();
  });

  test("the stored-file tables go, and the link table and column arrive", () => {
    const db = atMigration5();
    expect(tableExists(db, "file_tokens")).toBe(true);
    expect(tableExists(db, "thumbnail_files")).toBe(true);
    migrate(db);

    expect(tableExists(db, "file_tokens")).toBe(false);
    expect(tableExists(db, "thumbnail_files")).toBe(false);
    expect(columns(db, "job_links")).toEqual([
      "token",
      "job_id",
      "expires_at",
      "used_at",
      "created_at",
    ]);
    expect(columns(db, "jobs")).toContain("link_json");
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
  });
});
