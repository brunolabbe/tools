/**
 * The `people` table and migration 3 (lg-5). A person's id is the configured
 * name, so the person ids lg-4 already stored on rules and classifications still
 * name someone; and the configuration fills the table at boot, never the
 * repository.
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { PeopleResponse } from "@ledger/contract";
import { migrate } from "../src/db/schema.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { ALEX, SAM, accessConfig } from "./helpers/access.ts";
import {
  TRANSFER_RULE,
  addRule,
  pasteStatement,
  rowId,
  startApp,
  GROCERIES,
} from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

function people(target: App): string[] {
  return (
    target.context.db.prepare("SELECT id FROM people ORDER BY id").all() as { id: string }[]
  ).map((row) => row.id);
}

describe("the people table", () => {
  test("a fresh database with no configuration has no people: nothing is seeded", () => {
    const db = new Database(":memory:");
    migrate(db);

    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 0 });
    db.close();
  });

  test("boot adds each configured person once, and GET /api/people reads the table", async () => {
    app = await createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        access: accessConfig({
          devIdentity: SAM,
          people: new Map([
            ["sam@example.test", "sam"],
            ["sam.work@example.test", "sam"],
            ["alex@example.test", "alex"],
          ]),
        }),
      },
    });

    expect(people(app)).toEqual(["alex", "sam"]);
    // The route answers from the table: a person only the table holds is listed.
    app.context.db.prepare("INSERT INTO people (id, added_at) VALUES ('casey', 'x')").run();
    const response = await app.server.inject({ method: "GET", url: ROUTES.people });
    expect(response.json<PeopleResponse>()).toEqual({ people: ["alex", "casey", "sam"] });
  });

  test("the person ids lg-4 stores on rules and classifications all name someone", async () => {
    app = await startApp(SAM);
    await addRule(app, TRANSFER_RULE);
    await pasteStatement(app);
    await app.server.inject({
      method: "POST",
      url: ROUTES.classifications,
      payload: {
        rowId: rowId(app, GROCERIES, -12345),
        personId: "alex",
        bucket: "current-expenses",
      },
    });

    const named = app.context.db
      .prepare(
        `SELECT person_id FROM rules WHERE person_id IS NOT NULL
         UNION SELECT person_id FROM classifications WHERE person_id IS NOT NULL
         UNION SELECT classified_by FROM classifications
         UNION SELECT created_by FROM rules`,
      )
      .all() as { person_id: string }[];

    expect(named.map((row) => row.person_id).toSorted()).toEqual(["alex", "sam"]);
    expect(named.every((row) => people(app as App).includes(row.person_id))).toBe(true);
  });

  test("a person the configuration stops naming stays, so their rows still name someone", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-people-"));
    const databasePath = path.join(dir, "ledger.db");
    try {
      app = await createApp({
        config: { databasePath, logLevel: "silent", access: accessConfig({ devIdentity: ALEX }) },
      });
      await app.shutdown();

      app = await createApp({
        config: {
          databasePath,
          logLevel: "silent",
          access: accessConfig({ devIdentity: ALEX, people: new Map([[ALEX, "alex"]]) }),
        },
      });

      expect(people(app)).toEqual(["alex", "sam"]);
    } finally {
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function openWithPeople(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', 'x'), ('sam', 'x')").run();
  return db;
}

function salary(
  db: Database.Database,
  fields: { person?: string; supersedes?: number | null; amount?: number } = {},
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO salaries (person_id, year, amount_cents, supersedes, entered_at, entered_by)
         VALUES (?, 2026, ?, ?, 'x', 'alex')`,
      )
      .run(fields.person ?? "alex", fields.amount ?? 100, fields.supersedes ?? null)
      .lastInsertRowid,
  );
}

describe("migration 3: salaries and ratios", () => {
  test("a salary names a person the household holds, and is not negative", () => {
    const db = openWithPeople();

    expect(() => salary(db, { person: "casey" })).toThrow(/FOREIGN KEY/u);
    expect(() => salary(db, { amount: -1 })).toThrow(/CHECK/u);
    db.close();
  });

  test("a person's year has one first record, and each record is corrected at most once", () => {
    const db = openWithPeople();
    const first = salary(db);

    expect(() => salary(db)).toThrow(/UNIQUE/u);
    salary(db, { supersedes: first });
    expect(() => salary(db, { supersedes: first })).toThrow(/UNIQUE/u);
    // Both stay; only the correction stands.
    expect(db.prepare("SELECT count(*) AS n FROM salaries").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM current_salaries").get()).toEqual({ n: 1 });
    db.close();
  });

  test("a ratio's share is between none and all of it", () => {
    const db = openWithPeople();
    db.prepare(
      "INSERT INTO ratios (effective_from, entered_at, entered_by) VALUES ('2026-01-01', 'x', 'alex')",
    ).run();
    const share = db.prepare(
      "INSERT INTO ratio_shares (ratio_id, person_id, parts_per_million) VALUES (1, ?, ?)",
    );

    expect(() => share.run("alex", 1_000_001)).toThrow(/CHECK/u);
    expect(() => share.run("alex", -1)).toThrow(/CHECK/u);
    expect(() => share.run("casey", 1)).toThrow(/FOREIGN KEY/u);
    db.close();
  });
});

// Gate 1 of lg-5: a person id lg-4 stored, from a configuration that has since
// changed, must still name someone once the table exists.
describe("upgrading a database lg-4 wrote", () => {
  test("every person id its rules and classifications name is enrolled, configured or not", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-upgrade-"));
    const databasePath = path.join(dir, "ledger.db");
    try {
      // As lg-4's release left it: two migrations, a rule naming casey and a row
      // classified to dana, neither of whom the configuration below names.
      const old = new Database(databasePath);
      migrate(old, 2);
      old
        .prepare(
          "INSERT INTO statement_imports (imported_at, imported_by) VALUES ('2026-09-01T00:00:00.000Z', 'casey')",
        )
        .run();
      old
        .prepare(
          `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
           VALUES (0, '2026-09-02', 'Virements', 'Virement', 100, 100, 1)`,
        )
        .run();
      old
        .prepare(
          `INSERT INTO rules (description_pattern, category, amount_cents, person_id, bucket, created_at, created_by)
           VALUES ('Virement', NULL, NULL, 'casey', 'mortgage', '2026-09-01T00:00:00.000Z', 'casey')`,
        )
        .run();
      old
        .prepare(
          `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
           VALUES (1, 'mortgage', 'dana', NULL, 'manual', '2026-09-03T00:00:00.000Z', 'casey')`,
        )
        .run();
      old.close();

      app = await createApp({
        config: { databasePath, logLevel: "silent", access: accessConfig({ devIdentity: ALEX }) },
      });

      expect(people(app)).toEqual(["alex", "casey", "dana", "sam"]);
      // Added when the id was first recorded, not when the upgrade ran.
      expect(app.context.db.prepare("SELECT added_at FROM people WHERE id = 'dana'").get()).toEqual(
        { added_at: "2026-09-03T00:00:00.000Z" },
      );
      const response = await app.server.inject({ method: "GET", url: ROUTES.people });
      expect(response.json<PeopleResponse>().people).toEqual(["alex", "casey", "dana", "sam"]);
    } finally {
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
