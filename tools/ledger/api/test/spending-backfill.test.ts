/**
 * The service categories migration 12 seeds, and the one-off backfill from text
 * (lg-53). Every description, amount and person is invented; the texts are the
 * workbook's and the bank's generic words.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { normalizeDescription } from "@ledger/books";
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

/**
 * Books holding, as the workbook import left them, rows filed by hand and lines
 * with its words; at `version` when a test needs them as an earlier release left them.
 */
function books(db: Database.Database, version?: number): Database.Database {
  migrate(db, version);
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
    "INSERT INTO period_lines (person_id, date, amount_cents, category, note, charged_to, source, entered_at, entered_by) VALUES (?, ?, ?, ?, ?, ?, 'workbook', ?, 'alex')",
  );
  line.run("alex", "2026-02-03", 9_999, "Hydro Québec", null, null, AT);
  line.run("sam", "2026-02-04", 1_799, "Netflix", null, null, AT);
  // Charged to alex: the field that moves money, so a correction must carry it.
  line.run("sam", "2026-02-05", 5_000, "Voyage", "France", "alex", AT);
  line.run("alex", "2026-02-06", 4_000, null, null, null, AT);
  line.run("alex", "2026-02-07", 2_500, "Épicerie Nouvelle-Écosse", null, null, AT);
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

    expect(db.pragma("user_version", { simple: true })).toBe(15);
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

  test("a retired category of one of the names does not stop the seed", () => {
    const db = new Database(":memory:");
    migrate(db, 11);
    const first = Number(
      db
        .prepare(
          "INSERT INTO spending_categories (name, created_at, created_by) VALUES ('Insurance', ?, 'alex')",
        )
        .run(AT).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO spending_categories (root_id, name, supersedes, retired, created_at, created_by) VALUES (?, 'Insurance', ?, 1, ?, 'alex')",
    ).run(first, first, AT);

    migrate(db);

    expect(names(db)).toEqual(SEEDED);
    expect(spendingCategories(db).filter((category) => category.name === "Insurance")).toHaveLength(
      2,
    );
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
    // A corrected line keeps what was spent; its source becomes a correction's, as on the Period screen.
    const voyage = currentLines(db).find((line) => line.category === "Voyage");
    expect(voyage).toMatchObject({
      personId: "sam",
      date: "2026-02-05",
      amountCents: 5_000,
      note: "France",
      chargedTo: "alex",
    });
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

  test("leaves a category a rule or the map gave, and a line's own", () => {
    const db = books(new Database(":memory:"));
    const idOf = (name: string): number =>
      spendingCategories(db).find((category) => category.name === name)?.id ?? 0;
    // A paste's row the map covers by its Desjardins category, and one a rule filed with a category.
    db.prepare(
      "INSERT INTO spending_category_map (desjardins_key, desjardins_category, spending_category_id, entered_at, entered_by) VALUES (?, 'Taxes municipales', ?, ?, 'sam')",
    ).run(normalizeDescription("Taxes municipales"), idOf("Other"), AT);
    const rule = Number(
      db
        .prepare(
          "INSERT INTO rules (description_pattern, category, amount_cents, person_id, bucket, created_at, created_by, spending_category_id) VALUES ('Taxes', '', NULL, NULL, 'current-expenses', ?, 'sam', ?)",
        )
        .run(AT, idOf("Household")).lastInsertRowid,
    );
    const row = db.prepare(
      "INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id) VALUES (?, '2026-09-01', ?, 'Taxes', -1_000, 0, 1)",
    );
    const mapped = Number(row.run(100, "Taxes municipales").lastInsertRowid);
    const ruled = Number(row.run(101, "").lastInsertRowid);
    const file = db.prepare(
      "INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by) VALUES (?, 'current-expenses', NULL, ?, ?, ?, 'sam')",
    );
    file.run(mapped, null, "manual", AT);
    file.run(ruled, rule, "rule", AT);
    db.prepare(
      "INSERT INTO period_lines (person_id, date, amount_cents, category, spending_category_id, source, entered_at, entered_by) VALUES ('sam', '2026-09-02', 700, 'Voyage', ?, 'workbook', ?, 'sam')",
    ).run(idOf("Other"), AT);

    spendingBackfillForTest(db, NOW);

    const byRow = new Map(listRows(db, { limit: 100 }).rows.map((one) => [one.id, one]));
    expect(byRow.get(mapped)?.spendingCategory).toEqual({ id: idOf("Other"), source: "map" });
    expect(byRow.get(ruled)?.spendingCategory).toEqual({ id: idOf("Household"), source: "rule" });
    expect(currentLines(db).find((line) => line.date === "2026-09-02")?.spendingCategoryId).toBe(
      idOf("Other"),
    );
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
    // As the release before lg-53 left them: the --write migrates, the dry run must not.
    books(new Database(householdBooksPath(dataDir, "home")), 11).close();
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

  /** The books and their write-ahead log, if any: a write can sit in either. */
  function hash(): string {
    const file = householdBooksPath(dataDir, "home");
    const digest = createHash("sha256").update(readFileSync(file));
    if (existsSync(`${file}-wal`)) digest.update(readFileSync(`${file}-wal`));
    return digest.digest("hex");
  }

  function version(): unknown {
    const db = new Database(householdBooksPath(dataDir, "home"), { readonly: true });
    try {
      return db.pragma("user_version", { simple: true });
    } finally {
      db.close();
    }
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
    const before = hash();
    const dry = run("--household", "home", "--as", "alex");

    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain("Dry run: nothing is written.");
    expect(dry.out).toContain('2 bank rows "Taxes" -> Property taxes');
    // Not a byte of the books changed, the schema version included.
    expect(hash()).toBe(before);
    expect(version()).toBe(11);

    const wrote = run("--household", "home", "--as", "alex", "--write");

    expect(wrote.code, wrote.err).toBe(0);
    expect(wrote.out.replace("Dry run: nothing is written.\n", "")).toBe(
      dry.out.replace("Dry run: nothing is written.\n", ""),
    );
    expect(overrides()).toEqual({ n: 4 });
    expect(version()).toBe(15);
    const migrated = new Database(householdBooksPath(dataDir, "home"), { readonly: true });
    try {
      expect(names(migrated)).toEqual(SEEDED);
    } finally {
      migrated.close();
    }

    const written = hash();
    const again = run("--household", "home", "--as", "alex", "--write");
    expect(again.out).toContain("Filled: 0");
    expect(hash()).toBe(written);
  });

  test("refuses someone who is not a member of the household", () => {
    const ran = run("--household", "home", "--as", "sam", "--write");

    expect(ran.code).toBe(2);
    expect(ran.err).toContain('--as names "sam"');
    expect(overrides()).toEqual({ n: 0 });
  });
});
