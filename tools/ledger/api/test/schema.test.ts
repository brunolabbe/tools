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

    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["statement_imports", "statement_rows"]));
    db.close();
  });

  test("a row's identity is unique, so re-storing a row is refused by the database too", () => {
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

    // The same identity under another category and another position.
    expect(() => insert.run(1, "2026-10-01", "Divers", "Virement", 100, 100)).toThrow(/UNIQUE/u);
    // The same position under another identity.
    expect(() => insert.run(0, "2026-10-02", "Virements", "Virement", 100, 200)).toThrow(/UNIQUE/u);
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

    expect(db.pragma("user_version", { simple: true })).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM statement_imports").get()).toEqual({ n: 1 });
    db.close();
  });
});
