/**
 * The service categories migration 12 seeds, and the one-off backfill from text
 * (lg-53). Every description, amount and person is invented; the texts are the
 * workbook's and the bank's generic words.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { householdBooksPath } from "../src/books.ts";
import { migrate } from "../src/db/schema.ts";
import { Directory } from "../src/directory.ts";
import { currentLines } from "../src/periods.ts";
import { listRows } from "../src/rows.ts";
import { knownPeople } from "../src/people.ts";
import { backfillSpending } from "../src/spending-backfill.ts";
import type { BackfillResult } from "../src/spending-backfill.ts";
import { runSpendingBackfillCommand } from "../src/spending-backfill-command.ts";
import { spendingCategories } from "../src/spending-categories.ts";

const AT = "2026-10-18T12:00:00.000Z";
const NOW = new Date(AT);

const SEEDED = [
  "Groceries",
  "Alcohol",
  "Household",
  "Pharmacy",
  "Restaurant",
  "Other",
  "Property taxes",
  "Electricity",
  "Internet & phone",
  "Subscriptions",
  "Insurance",
  "Home maintenance",
  "Travel",
  "Transport",
  "Bank fees",
  "Cash",
];

function spendingBackfillForTest(db: Database.Database, now: Date): BackfillResult {
  return backfillSpending({
    db,
    personId: "alex",
    now: () => now,
    people: new Set(knownPeople(db)),
  });
}

function names(db: Database.Database): string[] {
  return spendingCategories(db)
    .filter((category) => !category.retired)
    .map((category) => category.name);
}

/** Books holding, as the workbook import left them, rows filed by hand and lines with its words. */
function books(db: Database.Database): Database.Database {
  migrate(db);
  db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', ?), ('sam', ?)").run(AT, AT);
  db.prepare(
    "INSERT INTO statement_imports (id, imported_at, imported_by) VALUES (1, ?, 'alex')",
  ).run(AT);
  const row = db.prepare(
    "INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id) VALUES (?, ?, '', ?, ?, 0, 1)",
  );
  const file = db.prepare(
    "INSERT INTO classifications (row_id, bucket, person_id, source, classified_at, classified_by) VALUES (?, 'current-expenses', ?, 'manual', ?, 'alex')",
  );
  const rows: [string, number, string | null][] = [
    ["Taxes", -120_000, null],
    ["Taxes", -95_000, null],
    ["Épicerie", -8_000, null],
    ["Paiement", -50_000, null],
    // A person's share paid in: not spending, so the chart does not count it and it stays empty.
    ["Taxes", 30_000, "alex"],
    // Money back on a shared expense is that expense's.
    ["Ristourne", 78, null],
  ];
  rows.forEach(([description, cents, personId], at) => {
    const id = Number(
      row.run(at, `2026-0${String(at + 1)}-01`, description, cents).lastInsertRowid,
    );
    file.run(id, personId, AT);
  });
  const line = db.prepare(
    "INSERT INTO period_lines (person_id, date, amount_cents, category, note, source, entered_at, entered_by) VALUES (?, ?, ?, ?, ?, 'workbook', ?, 'alex')",
  );
  line.run("alex", "2026-02-03", 9_999, "Hydro Québec", null, AT);
  line.run("sam", "2026-02-04", 1_799, "Netflix", null, AT);
  line.run("sam", "2026-02-05", 5_000, "Voyage", "France", AT);
  line.run("alex", "2026-02-06", 4_000, null, null, AT);
  line.run("alex", "2026-02-07", 2_500, "Épicerie Nouvelle-Écosse", null, AT);
  return db;
}

function categoryOf(db: Database.Database, description: string): (string | null)[] {
  const byId = new Map(spendingCategories(db).map((category) => [category.id, category.name]));
  return listRows(db, { limit: 100 })
    .rows.filter((row) => row.description === description)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .map((row) =>
      row.spendingCategory === null ? null : (byId.get(row.spendingCategory.id) ?? "?"),
    );
}

function lineCategories(db: Database.Database): Record<string, string | null> {
  const byId = new Map(spendingCategories(db).map((category) => [category.id, category.name]));
  return Object.fromEntries(
    currentLines(db).map((line) => [
      line.category ?? "(none)",
      line.spendingCategoryId === null ? null : (byId.get(line.spendingCategoryId) ?? "?"),
    ]),
  );
}

describe("migration 12 seeds the service categories (lg-53)", () => {
  test("a fresh database lists the first six, then the ten, in that order", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(12);
    expect(names(db)).toEqual(SEEDED);
  });

  test("a household that made one of the names keeps its own and gets no second", () => {
    const db = new Database(":memory:");
    migrate(db, 11);
    db.prepare(
      "INSERT INTO spending_categories (name, created_at, created_by) VALUES ('insurance', ?, 'alex')",
    ).run(AT);

    migrate(db);

    expect(names(db).filter((name) => name.toLowerCase() === "insurance")).toEqual(["insurance"]);
    expect(names(db)).toHaveLength(SEEDED.length);
  });
});

describe("backfillSpending (lg-53)", () => {
  test("fills the money-out rows and the lines whose whole text names a category", () => {
    const db = books(new Database(":memory:"));

    const result = spendingBackfillForTest(db, NOW);

    expect(categoryOf(db, "Taxes")).toEqual(["Property taxes", "Property taxes", null]);
    expect(categoryOf(db, "Épicerie")).toEqual(["Groceries"]);
    expect(categoryOf(db, "Paiement")).toEqual([null]);
    expect(categoryOf(db, "Ristourne")).toEqual(["Bank fees"]);
    expect(lineCategories(db)).toEqual({
      "Hydro Québec": "Electricity",
      Netflix: "Subscriptions",
      Voyage: "Travel",
      "(none)": null,
      "Épicerie Nouvelle-Écosse": null,
    });
    // A corrected line keeps what it was; only its spending category is new.
    const voyage = currentLines(db).find((line) => line.category === "Voyage");
    expect(voyage).toMatchObject({ personId: "sam", amountCents: 5_000, note: "France" });
    expect(result.bareLines).toBe(1);
    expect(result.left).toEqual([
      { kind: "row", text: "Paiement", count: 1 },
      { kind: "line", text: "Épicerie Nouvelle-Écosse", count: 1 },
    ]);
    expect(result.report).toContain('2 bank rows "Taxes" -> Property taxes');
  });

  test("leaves a category someone gave, and a second run writes nothing", () => {
    const db = books(new Database(":memory:"));
    const travel = spendingCategories(db).find((category) => category.name === "Travel");
    const taxes = listRows(db, { limit: 100 }).rows.find((row) => row.amountCents === -120_000);
    db.prepare(
      "INSERT INTO spending_category_overrides (row_id, spending_category_id, set_at, set_by) VALUES (?, ?, ?, 'sam')",
    ).run(taxes?.id, travel?.id, AT);

    spendingBackfillForTest(db, NOW);
    const overrides = db.prepare("SELECT count(*) AS n FROM spending_category_overrides").get();
    const lines = db.prepare("SELECT count(*) AS n FROM period_lines").get();
    const again = spendingBackfillForTest(db, NOW);

    expect(categoryOf(db, "Taxes")).toEqual(["Travel", "Property taxes", null]);
    expect(again.filled).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM spending_category_overrides").get()).toEqual(
      overrides,
    );
    expect(db.prepare("SELECT count(*) AS n FROM period_lines").get()).toEqual(lines);
  });
});

describe("npm run backfill-spending:ledger (lg-53)", () => {
  let dir: string;
  let dataDir: string;
  let directoryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ledger-backfill-test-"));
    dataDir = path.join(dir, "data");
    directoryPath = path.join(dataDir, "directory.db");
    mkdirSync(path.dirname(householdBooksPath(dataDir, "home")), { recursive: true });
    const directory = Directory.open(directoryPath);
    directory.addHousehold({ id: "home", name: "Home", by: "operator", at: NOW });
    directory.addMember({
      household: "home",
      address: "alex@example.test",
      person: "alex",
      by: "operator",
      at: NOW,
    });
    directory.close();
    books(new Database(householdBooksPath(dataDir, "home"))).close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(...args: string[]): { code: number; out: string; err: string } {
    let out = "";
    let err = "";
    const code = runSpendingBackfillCommand(args, {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
      env: { DATABASE_PATH: dataDir, DIRECTORY_PATH: directoryPath },
      cwd: dir,
      now: () => NOW,
    });
    return { code, out, err };
  }

  function overrides(): unknown {
    const db = new Database(householdBooksPath(dataDir, "home"), { readonly: true });
    try {
      return db.prepare("SELECT count(*) AS n FROM spending_category_overrides").get();
    } finally {
      db.close();
    }
  }

  test("a dry run reports what --write then records", () => {
    const dry = run("--household", "home", "--as", "alex");

    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain("Dry run: nothing is written.");
    expect(dry.out).toContain('2 bank rows "Taxes" -> Property taxes');
    expect(overrides()).toEqual({ n: 0 });

    const wrote = run("--household", "home", "--as", "alex", "--write");

    expect(wrote.code, wrote.err).toBe(0);
    expect(wrote.out.replace("Dry run: nothing is written.\n", "")).toBe(
      dry.out.replace("Dry run: nothing is written.\n", ""),
    );
    expect(overrides()).toEqual({ n: 4 });
  });

  test("refuses someone who is not a member of the household", () => {
    const ran = run("--household", "home", "--as", "sam", "--write");

    expect(ran.code).toBe(2);
    expect(ran.err).toContain('--as names "sam"');
    expect(overrides()).toEqual({ n: 0 });
  });
});
