/**
 * Migration 2: the rules and the classifications (lg-4). What the database
 * itself refuses, and what its two views say is in force.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrate } from "../src/db/schema.ts";

function open(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

const AT = "2026-10-03T12:00:00.000Z";

function addRule(
  db: Database.Database,
  fields: { supersedes?: number | null; retired?: 0 | 1; bucket?: string } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO rules (description_pattern, category, amount_cents, person_id, bucket, supersedes, retired, created_at, created_by)
       VALUES ('Virement*', NULL, NULL, 'alex', ?, ?, ?, ?, 'alex')`,
    )
    .run(fields.bucket ?? "mortgage", fields.supersedes ?? null, fields.retired ?? 0, AT);
  return Number(result.lastInsertRowid);
}

/** A stored row to classify, and the import it needs. */
function addRow(db: Database.Database): number {
  db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, 'alex')").run(AT);
  const result = db
    .prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (0, '2026-10-01', 'Virements', 'Virement', 100, 100, 1)`,
    )
    .run();
  return Number(result.lastInsertRowid);
}

function classify(
  db: Database.Database,
  rowId: number,
  fields: { bucket?: string; ruleId?: number | null; source?: string; by?: string } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      fields.bucket ?? "mortgage",
      fields.ruleId ?? null,
      fields.source ?? "manual",
      AT,
      fields.by ?? "alex",
    );
  return Number(result.lastInsertRowid);
}

describe("the rules and classifications tables", () => {
  test("a fresh database holds no rule: nothing is seeded from the repository", () => {
    const db = open();

    expect(db.prepare("SELECT count(*) AS n FROM rules").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM classifications").get()).toEqual({ n: 0 });
    db.close();
  });

  test("a bucket is one of the two", () => {
    const db = open();
    const row = addRow(db);

    expect(() => addRule(db, { bucket: "savings" })).toThrow(/CHECK/u);
    expect(() => classify(db, row, { bucket: "savings" })).toThrow(/CHECK/u);
    db.close();
  });

  test("a version is superseded at most once, so two edits of one rule cannot both land", () => {
    const db = open();
    const original = addRule(db);

    addRule(db, { supersedes: original });

    expect(() => addRule(db, { supersedes: original })).toThrow(/UNIQUE/u);
    db.close();
  });

  test("a classification names a stored row and a rule that exists", () => {
    const db = open();
    const row = addRow(db);

    expect(() => classify(db, 99)).toThrow(/FOREIGN KEY/u);
    expect(() => classify(db, row, { ruleId: 99, source: "rule" })).toThrow(/FOREIGN KEY/u);
    db.close();
  });

  test("only a person's own answer has no rule, and every other source has one", () => {
    const db = open();
    const row = addRow(db);
    const rule = addRule(db);

    expect(() => classify(db, row, { source: "manual", ruleId: rule })).toThrow(/CHECK/u);
    expect(() => classify(db, row, { source: "rule", ruleId: null })).toThrow(/CHECK/u);
    expect(() => classify(db, row, { source: "accepted", ruleId: null })).toThrow(/CHECK/u);
    expect(() => classify(db, row, { source: "rule", ruleId: rule })).not.toThrow();
    db.close();
  });
});

describe("the views of what is in force", () => {
  test("current_rules is every version nothing has replaced, and no retirement", () => {
    const db = open();
    const original = addRule(db);
    const edited = addRule(db, { supersedes: original });
    const untouched = addRule(db);
    const retiring = addRule(db);
    addRule(db, { supersedes: retiring, retired: 1 });

    const inForce = db.prepare("SELECT id FROM current_rules ORDER BY id").all();

    expect(inForce).toEqual([{ id: edited }, { id: untouched }]);
    // Nothing was removed to get there: all five versions are still stored.
    expect(db.prepare("SELECT count(*) AS n FROM rules").get()).toEqual({ n: 5 });
    db.close();
  });

  test("current_classifications is the latest record for each row, and the earlier stay", () => {
    const db = open();
    const row = addRow(db);
    const first = classify(db, row, { bucket: "mortgage", by: "alex" });
    const second = classify(db, row, { bucket: "current-expenses", by: "sam" });

    const standing = db
      .prepare("SELECT id, bucket, classified_by FROM current_classifications")
      .all();

    expect(standing).toEqual([{ id: second, bucket: "current-expenses", classified_by: "sam" }]);
    expect(db.prepare("SELECT id, bucket FROM classifications ORDER BY id").all()).toEqual([
      { id: first, bucket: "mortgage" },
      { id: second, bucket: "current-expenses" },
    ]);
    db.close();
  });
});

describe("the books are only ever appended to", () => {
  test("no source file in the api issues an UPDATE or a DELETE", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(path.join(here, "../src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => [file, readFileSync(path.join(here, "../src", file), "utf8")] as const);

    expect(sources.length).toBeGreaterThan(10);
    const offenders = sources
      .filter(([, text]) => /\b(UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/iu.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
