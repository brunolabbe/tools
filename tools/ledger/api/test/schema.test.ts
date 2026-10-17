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

    expect(db.pragma("user_version", { simple: true })).toBe(10);
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

    expect(db.pragma("user_version", { simple: true })).toBe(10);
    expect(db.prepare("SELECT count(*) AS n FROM statement_imports").get()).toEqual({ n: 1 });
    db.close();
  });

  test("migration 5 marks every stored batch a paste, notes no row, and refuses an unknown source", () => {
    const db = new Database(":memory:");
    migrate(db, 4);
    db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)").run(
      "2026-10-02T00:00:00.000Z",
      "alex",
    );
    db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (0, '2026-10-01', 'Virements', 'Virement', 100, 100, 1)`,
    ).run();

    migrate(db);
    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(10);
    expect(db.prepare("SELECT source FROM statement_imports").all()).toEqual([{ source: "paste" }]);
    expect(db.prepare("SELECT note FROM statement_rows").all()).toEqual([{ note: null }]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, ?)",
        )
        .run("2026-10-03T00:00:00.000Z", "alex", "scan"),
    ).toThrow(/CHECK/u);
    db.close();
  });
});

// lg-8's gate 2, N3: the request's own check answers a second receipt on a row
// with a 409; the index is what holds against a second writer on the same file.
describe("migration 8's receipt filings", () => {
  test("refuse a second filing on a row a receipt already documents", () => {
    const db = open();
    db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', '2026-10-01')").run();
    db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)").run(
      "2026-10-02T00:00:00.000Z",
      "alex",
    );
    db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (0, '2026-10-01', 'Épicerie', 'Achat', -2650, 100, 1)`,
    ).run();
    const receipt = db.prepare(
      `INSERT INTO receipts (photo, media_type, bytes, uploaded_at, uploaded_by)
       VALUES (?, 'image/jpeg', 64, '2026-10-02T00:00:00.000Z', 'alex')`,
    );
    receipt.run("a.jpg");
    receipt.run("b.jpg");
    const filing = db.prepare(
      `INSERT INTO receipt_filings (receipt_id, part, row_id, filed_at, filed_by)
       VALUES (?, 1, 1, '2026-10-02T00:00:00.000Z', 'alex')`,
    );

    filing.run(1);

    expect(() => filing.run(2)).toThrow(/UNIQUE/u);
    expect(db.prepare("SELECT count(*) AS n FROM receipt_filings").get()).toEqual({ n: 1 });
    db.close();
  });
});

describe("migration 9's receipt items (lg-10)", () => {
  test("keeps a filing stored before it, with no charge and no items, and refuses an item's unknown share", () => {
    const db = new Database(":memory:");
    migrate(db, 8);
    db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', '2026-10-01')").run();
    db.prepare(
      `INSERT INTO period_lines (person_id, date, amount_cents, source, entered_at, entered_by)
       VALUES ('alex', '2026-10-04', 2650, 'receipt', '2026-10-05T00:00:00.000Z', 'alex')`,
    ).run();
    db.prepare(
      `INSERT INTO receipts (photo, media_type, bytes, uploaded_at, uploaded_by)
       VALUES ('a.jpg', 'image/jpeg', 64, '2026-10-02T00:00:00.000Z', 'alex')`,
    ).run();
    db.prepare(
      `INSERT INTO receipt_filings (receipt_id, part, period_line_id, filed_at, filed_by)
       VALUES (1, 1, 1, '2026-10-05T00:00:00.000Z', 'alex')`,
    ).run();

    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(10);
    expect(db.prepare("SELECT period_line_id, charge_line_id FROM receipt_filings").all()).toEqual([
      { period_line_id: 1, charge_line_id: null },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM receipt_items").get()).toEqual({ n: 0 });
    const item = db.prepare(
      `INSERT INTO receipt_items (filing_id, position, text, price_cents, taxable, share)
       VALUES (1, ?, 'PAIN', 349, 0, ?)`,
    );
    expect(() => item.run(1, "shared")).not.toThrow();
    expect(() => item.run(2, "half")).toThrow(/CHECK/u);
    expect(() => item.run(1, "theirs")).toThrow(/UNIQUE/u);
    db.close();
  });
});
