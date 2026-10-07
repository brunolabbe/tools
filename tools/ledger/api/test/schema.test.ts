import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrate } from "../src/db/schema.ts";

function open(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("the schema's migrations", () => {
  test("migration 1 stores the statement rows and the imports they came from", () => {
    const db = open();

    expect(db.pragma("user_version", { simple: true })).toBe(5);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["statement_imports", "statement_rows"]));
    db.close();
  });

  test("a row's position is unique and its identity is not: the same four fields can recur", () => {
    const db = open();
    db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)").run(
      "2026-10-02T00:00:00.000Z",
      "alex",
    );
    const insert = db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    );
    insert.run(0, "2026-10-01", "Virements", "Virement", 100, 100);

    // A transfer, its reversal and the transfer again on one day: the same date,
    // description, amount and balance twice (00-ANALYSIS.md §2).
    expect(() => insert.run(1, "2026-10-01", "Virements", "Virement", 100, 100)).not.toThrow();
    // The same position under another row is what the database refuses.
    expect(() => insert.run(0, "2026-10-02", "Virements", "Virement", 100, 200)).toThrow(/UNIQUE/u);
    db.close();
  });

  test("a position may be negative, so older rows can later be numbered below the oldest", () => {
    const db = open();
    db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)").run(
      "2026-10-02T00:00:00.000Z",
      "alex",
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
           VALUES (-1, '2026-10-01', 'Virements', 'Virement', 100, 100, 1)`,
        )
        .run(),
    ).not.toThrow();
    db.close();
  });

  test("a row must name an import that exists", () => {
    const db = open();

    expect(() =>
      db
        .prepare(
          `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
           VALUES (0, '2026-10-01', 'Virements', 'Virement', 100, 100, 99)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/u);
    db.close();
  });

  test("migrating a migrated database again changes nothing", () => {
    const db = open();
    db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)").run(
      "2026-10-02T00:00:00.000Z",
      "alex",
    );

    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(5);
    expect(db.prepare("SELECT count(*) AS n FROM statement_imports").get()).toEqual({ n: 1 });
    db.close();
  });
});
