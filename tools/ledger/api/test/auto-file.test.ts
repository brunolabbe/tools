/**
 * History files a row with nobody tapping (lg-17), through the API: when it does
 * and when it asks, how the filing is stored and superseded, the migration that
 * made room for it, and what every reader of the standing classification says
 * about an automatically filed row. Every description and amount is invented.
 */

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  AutoFiledResponse,
  AutoFiledRow,
  BucketsResponse,
  InboxRow,
  RowsResponse,
  RuleDraft,
  SpendingCategoriesResponse,
  StoredRow,
} from "@ledger/contract";
import { inboxCount } from "../src/classifications.ts";
import { applyMigrations, migrate } from "../src/db/schema.ts";
import type { App } from "../src/server.ts";
import { SAM } from "./helpers/access.ts";
import {
  addRule,
  classifications,
  pasteStatement,
  readInbox,
  startApp,
} from "./helpers/classification.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(...args: Parameters<typeof startApp>): Promise<App> {
  app = await startApp(...args);
  return app;
}

const MARKET = "Achat /Marché Exemple";
const SAVINGS = "Virement entre folios /Caisse du Lac";

function market(day: number, amountCents: number): PasteRow {
  return {
    date: `2026-09-${String(day).padStart(2, "0")}`,
    category: "Épicerie",
    description: MARKET,
    amountCents,
  };
}

function savings(day: number, amountCents: number): PasteRow {
  return {
    date: `2026-09-${String(day).padStart(2, "0")}`,
    category: "Virements",
    description: SAVINGS,
    amountCents,
  };
}

/**
 * Pastes `rows[from, to)` of one stretch of the account, oldest first. Later
 * slices continue exactly where the earlier ones ended, as a later paste does.
 */
async function pasteSlice(target: App, rows: PasteRow[], from: number, to: number): Promise<void> {
  await pasteStatement(target, renderPaste(withBalances(rows, 500000).slice(from, to)));
}

/** The stored row at an index of the stretch: rows are stored in order, ids from 1. */
function idAt(index: number): number {
  return index + 1;
}

async function answer(
  target: App,
  rowId: number,
  body: { personId: string | null; bucket: string } | { ruleId: number },
): Promise<number> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.classifications,
    payload: { rowId, ...body },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ id: number }>().id;
}

async function get<T>(target: App, url: string): Promise<T> {
  const response = await target.server.inject({ method: "GET", url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function reviewList(target: App): Promise<AutoFiledRow[]> {
  return (await get<AutoFiledResponse>(target, ROUTES.autoFiled)).rows;
}

async function storedRow(target: App, id: number): Promise<StoredRow | undefined> {
  return (await get<RowsResponse>(target, `${ROUTES.rows}?limit=500`)).rows.find(
    (row) => row.id === id,
  );
}

function standing(target: App, rowId: number): Record<string, unknown> | undefined {
  return target.context.db
    .prepare("SELECT * FROM current_classifications WHERE row_id = ?")
    .get(rowId) as Record<string, unknown> | undefined;
}

function inInbox(rows: InboxRow[], id: number): InboxRow | undefined {
  return rows.find((row) => row.id === id);
}

const SAM_CURRENT = { personId: "sam", bucket: "current-expenses" } as const;

/**
 * Three market rows answered by a person, then two more pasted: 15 % and 25 %
 * above the latest answer's amount. Returns the three answers' ids, oldest first.
 */
async function threeAnsweredThenTwo(target: App): Promise<number[]> {
  const stretch = [
    market(1, -10000),
    market(2, -9000),
    market(3, -10000),
    market(10, -11500),
    market(11, -12500),
  ];
  await pasteSlice(target, stretch, 0, 3);
  const ids = [];
  for (const index of [0, 1, 2]) ids.push(await answer(target, idAt(index), SAM_CURRENT));
  await pasteSlice(target, stretch, 3, 5);
  return ids;
}

describe("history files a row on paste (lg-17)", () => {
  test("a debit 15 % above the latest answer is filed automatically, and one 25 % above waits", async () => {
    const target = await start();
    const [first, second, third] = await threeAnsweredThenTwo(target);

    expect(standing(target, idAt(3))).toMatchObject({
      source: "auto",
      person_id: "sam",
      bucket: "current-expenses",
      rule_id: null,
      classified_by: null,
      rests_on_1: third,
      rests_on_2: second,
      rests_on_3: first,
    });
    expect(standing(target, idAt(4))).toBeUndefined();
    const inbox = await readInbox(target);
    expect(inInbox(inbox, idAt(3))).toBeUndefined();
    expect(inInbox(inbox, idAt(4))).toMatchObject({
      reason: "no-rule",
      history: { personId: "sam", bucket: "current-expenses", times: 3 },
    });
  });

  test("a transfer at an amount none of the three had waits, and at one of theirs is filed", async () => {
    const target = await start();
    const stretch = [
      savings(1, 40000),
      savings(2, 45000),
      savings(3, 40000),
      savings(10, 40100),
      savings(11, 45000),
    ];
    await pasteSlice(target, stretch, 0, 3);
    for (const index of [0, 1, 2]) await answer(target, idAt(index), SAM_CURRENT);

    await pasteSlice(target, stretch, 3, 5);

    expect(standing(target, idAt(3))).toBeUndefined();
    expect(standing(target, idAt(4))).toMatchObject({ source: "auto", person_id: "sam" });
  });

  test("two automatic filings and one answer do not make three: the next row waits", async () => {
    const target = await start();
    // Not reachable by tapping: once three rows of a description have a
    // person's answer they always will. Seeded as a paste would have stored it,
    // resting on three answers to another description, to prove that an
    // automatic filing is never counted as an answer itself.
    const stretch = [
      market(1, -10000),
      market(2, -10000),
      market(3, -10000),
      savings(4, 40000),
      savings(5, 40000),
      savings(6, 40000),
      market(10, -10000),
    ];
    await pasteSlice(target, stretch, 0, 6);
    const grounds = [];
    for (const index of [3, 4, 5]) grounds.push(await answer(target, idAt(index), SAM_CURRENT));
    const seed = target.context.db.prepare(
      `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by, rests_on_1, rests_on_2, rests_on_3)
       VALUES (?, 'current-expenses', 'sam', NULL, 'auto', '2026-10-03T09:30:00.000Z', NULL, ?, ?, ?)`,
    );
    seed.run(idAt(0), ...grounds);
    seed.run(idAt(1), ...grounds);
    await answer(target, idAt(2), SAM_CURRENT);

    await pasteSlice(target, stretch, 6, 7);

    expect(standing(target, idAt(6))).toBeUndefined();
    expect(inInbox(await readInbox(target), idAt(6))?.history).toEqual({
      personId: "sam",
      bucket: "current-expenses",
      times: 1,
    });
  });

  test("three answers where one disagrees do not file either", async () => {
    const target = await start();
    const stretch = [market(1, -10000), market(2, -10000), market(3, -10000), market(10, -10000)];
    await pasteSlice(target, stretch, 0, 3);
    await answer(target, idAt(0), SAM_CURRENT);
    await answer(target, idAt(1), { personId: "alex", bucket: "current-expenses" });
    await answer(target, idAt(2), SAM_CURRENT);

    await pasteSlice(target, stretch, 3, 4);

    expect(standing(target, idAt(3))).toBeUndefined();
    expect(inInbox(await readInbox(target), idAt(3))?.history).toMatchObject({ times: 1 });
  });

  test("a row a rule matches with a different amount waits, whatever its history says", async () => {
    const target = await start();
    // The usual transfer is 400.00 $; three at 450.00 $ were each a question, and answered.
    await addRule(target, {
      descriptionPattern: SAVINGS,
      category: "Virements",
      amountCents: 40000,
      personId: "sam",
      bucket: "mortgage",
      spendingCategoryId: null,
    });
    const stretch = [savings(1, 45000), savings(2, 45000), savings(3, 45000), savings(10, 45000)];
    await pasteSlice(target, stretch, 0, 3);
    for (const index of [0, 1, 2]) await answer(target, idAt(index), SAM_CURRENT);

    await pasteSlice(target, stretch, 3, 4);

    // History alone would file it: three agreeing answers at this very amount.
    expect(standing(target, idAt(3))).toBeUndefined();
    expect(inInbox(await readInbox(target), idAt(3))).toMatchObject({
      reason: "differs",
      history: { personId: "sam", bucket: "current-expenses", times: 3 },
    });
  });

  test("rules level at the top with different answers leave the row waiting, whatever its history says", async () => {
    const target = await start();
    const level: RuleDraft = {
      descriptionPattern: MARKET,
      category: null,
      amountCents: null,
      personId: "alex",
      bucket: "current-expenses",
      spendingCategoryId: null,
    };
    const stretch = [market(1, -10000), market(2, -10000), market(3, -10000), market(10, -10000)];
    await pasteSlice(target, stretch, 0, 3);
    for (const index of [0, 1, 2]) await answer(target, idAt(index), SAM_CURRENT);
    await addRule(target, level);
    await addRule(target, { ...level, personId: "sam" });

    await pasteSlice(target, stretch, 3, 4);

    expect(standing(target, idAt(3))).toBeUndefined();
    expect(inInbox(await readInbox(target), idAt(3))).toMatchObject({ reason: "ambiguous" });
  });

  test("a rule that takes the row beats history, even where history says otherwise", async () => {
    const target = await start();
    const stretch = [market(1, -10000), market(2, -10000), market(3, -10000), market(10, -10000)];
    await pasteSlice(target, stretch, 0, 3);
    for (const index of [0, 1, 2]) await answer(target, idAt(index), SAM_CURRENT);
    const rule = await addRule(target, {
      descriptionPattern: MARKET,
      category: null,
      amountCents: null,
      personId: "alex",
      bucket: "mortgage",
      spendingCategoryId: null,
    });

    await pasteSlice(target, stretch, 3, 4);

    expect(standing(target, idAt(3))).toMatchObject({
      source: "rule",
      rule_id: rule.id,
      person_id: "alex",
    });
  });

  test("an answer given after the paste files no row already waiting", async () => {
    const target = await start();
    const stretch = [market(1, -10000), market(2, -10000), market(3, -10000), market(10, -10000)];
    await pasteSlice(target, stretch, 0, 4);

    for (const index of [0, 1, 2]) await answer(target, idAt(index), SAM_CURRENT);

    // The fourth row was pasted with nothing answered, and only a paste files.
    expect(standing(target, idAt(3))).toBeUndefined();
    expect(inInbox(await readInbox(target), idAt(3))?.history).toMatchObject({ times: 3 });
  });
});

describe("an automatic filing is stored, reviewed and superseded (lg-17)", () => {
  test("names the three answers it rests on and no person, and the database refuses one that does not", async () => {
    const target = await start();
    const [first, second, third] = await threeAnsweredThenTwo(target);
    const insert = target.context.db.prepare(
      `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by, rests_on_1, rests_on_2, rests_on_3)
       VALUES (?, 'mortgage', NULL, ?, ?, '2026-10-03T09:30:00.000Z', ?, ?, ?, ?)`,
    );
    const row = idAt(4);

    expect(classifications(target).at(-1)).toMatchObject({ row_id: idAt(3), source: "auto" });
    // A person named as its author, a rule, a missing or repeated ground: all refused.
    expect(() => insert.run(row, null, "auto", "alex", first, second, third)).toThrow(/CHECK/u);
    expect(() => insert.run(row, null, "auto", null, first, second, null)).toThrow(/CHECK/u);
    expect(() => insert.run(row, null, "auto", null, first, first, third)).toThrow(/CHECK/u);
    expect(() => insert.run(row, null, "auto", null, first, second, 999)).toThrow(/FOREIGN KEY/u);
    // And a person's answer rests on nothing.
    expect(() => insert.run(row, null, "manual", "alex", first, second, third)).toThrow(/CHECK/u);
    expect(() => insert.run(row, null, "auto", null, first, second, third)).not.toThrow();
  });

  test("is listed for review with the three answers it rests on, latest first", async () => {
    const target = await start(SAM);
    const [first, second, third] = await threeAnsweredThenTwo(target);

    const [listed, ...rest] = await reviewList(target);

    expect(rest).toEqual([]);
    expect(listed).toMatchObject({
      id: idAt(3),
      description: MARKET,
      amountCents: -11500,
      classification: { bucket: "current-expenses", personId: "sam" },
    });
    expect(listed?.restsOn).toEqual([
      expect.objectContaining({
        classificationId: third,
        rowId: idAt(2),
        date: "2026-09-03",
        amountCents: -10000,
        source: "manual",
        classifiedBy: "sam",
      }),
      expect.objectContaining({ classificationId: second, rowId: idAt(1), amountCents: -9000 }),
      expect.objectContaining({ classificationId: first, rowId: idAt(0), amountCents: -10000 }),
    ]);
  });

  test("a person's later answer wins over it, leaves the review list, and is an answer itself", async () => {
    const target = await start();
    await threeAnsweredThenTwo(target);
    const changed = { personId: "alex", bucket: "mortgage" } as const;

    await answer(target, idAt(3), changed);

    expect(standing(target, idAt(3))).toMatchObject({
      source: "manual",
      person_id: "alex",
      bucket: "mortgage",
    });
    expect(await reviewList(target)).toEqual([]);
    expect((await storedRow(target, idAt(3)))?.classification).toEqual({
      ...changed,
      source: "manual",
    });
    // The automatic record is still there, under the answer that superseded it.
    expect(classifications(target).filter((c) => c.row_id === idAt(3))).toMatchObject([
      { source: "auto" },
      { source: "manual" },
    ]);
    // And it counts: the latest answer now disagrees with the two before it.
    const [waiting] = await readInbox(target);
    expect(waiting).toMatchObject({ id: idAt(4), history: { ...changed, times: 1 } });
  });

  test("confirming it stores a person's answer, which history then counts", async () => {
    const target = await start(SAM);
    await threeAnsweredThenTwo(target);

    await answer(target, idAt(3), SAM_CURRENT);

    expect(standing(target, idAt(3))).toMatchObject({ source: "manual", classified_by: "sam" });
    expect(await reviewList(target)).toEqual([]);
    expect(inInbox(await readInbox(target), idAt(4))?.history).toMatchObject({ times: 4 });
  });
});

/** A database as release 6 left it, with records of every source, two on one row. */
function seededAtSix(): Database.Database {
  const db = new Database(":memory:");
  migrate(db, 6);
  const at = "2026-10-01T00:00:00.000Z";
  db.prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, 'alex')").run(at);
  db.prepare(
    `INSERT INTO rules (description_pattern, bucket, person_id, created_at, created_by)
     VALUES ('Achat*', 'mortgage', 'alex', ?, 'alex')`,
  ).run(at);
  const row = db.prepare(
    `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
     VALUES (?, '2026-10-01', 'Épicerie', 'Achat', -100, 0, 1)`,
  );
  for (const seq of [0, 1, 2]) row.run(seq);
  const classify = db.prepare(
    `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  classify.run(1, "mortgage", "alex", 1, "rule", at, "alex");
  classify.run(2, "current-expenses", null, 1, "accepted", at, "sam");
  classify.run(3, "mortgage", "sam", null, "manual", at, "alex");
  classify.run(1, "current-expenses", "sam", null, "manual", "2026-10-02T00:00:00.000Z", "sam");
  return db;
}

/** Every column the table had before migration 7. */
const COLUMNS = "id, row_id, bucket, person_id, rule_id, source, classified_at, classified_by";

describe("migration 7 rebuilds the classifications (lg-17)", () => {
  test("keeps every classification stored before it, with its id, and what stands", () => {
    const db = seededAtSix();
    const before = db.prepare(`SELECT ${COLUMNS} FROM classifications ORDER BY id`).all();
    const standingBefore = db.prepare("SELECT id FROM current_classifications ORDER BY id").all();

    migrate(db);

    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(before).toHaveLength(4);
    expect(db.prepare(`SELECT ${COLUMNS} FROM classifications ORDER BY id`).all()).toEqual(before);
    expect(
      db.prepare("SELECT rests_on_1, rests_on_2, rests_on_3 FROM classifications").all(),
    ).toEqual(
      Array.from({ length: 4 }, () => ({ rests_on_1: null, rests_on_2: null, rests_on_3: null })),
    );
    expect(db.prepare("SELECT id FROM current_classifications ORDER BY id").all()).toEqual(
      standingBefore,
    );
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  test("keeps the old table's rules, and the next record takes the next id", () => {
    const db = seededAtSix();
    migrate(db);
    const insert = db.prepare(
      `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
       VALUES (2, ?, NULL, ?, ?, '2026-10-03T00:00:00.000Z', 'alex')`,
    );

    expect(() => insert.run("savings", null, "manual")).toThrow(/CHECK/u);
    expect(() => insert.run("mortgage", 1, "manual")).toThrow(/CHECK/u);
    expect(() => insert.run("mortgage", null, "rule")).toThrow(/CHECK/u);
    expect(() => insert.run("mortgage", 99, "rule")).toThrow(/FOREIGN KEY/u);
    expect(Number(insert.run("mortgage", null, "manual").lastInsertRowid)).toBe(5);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'classifications' ORDER BY name")
        .all(),
    ).toEqual([{ name: "classifications" }, { name: "classifications_row" }]);
    db.close();
  });

  test("runs inside an open transaction, the way the workbook import migrates", () => {
    const db = seededAtSix();

    db.exec("BEGIN");
    applyMigrations(db);
    db.exec("ROLLBACK");

    // Rolled back with the transaction around it: still release 6, records intact.
    expect(db.pragma("user_version", { simple: true })).toBe(6);
    expect(db.prepare("SELECT count(*) AS n FROM classifications").get()).toEqual({ n: 4 });

    db.exec("BEGIN");
    applyMigrations(db);
    db.exec("COMMIT");

    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(db.prepare("SELECT count(*) AS n FROM classifications").get()).toEqual({ n: 4 });
    db.close();
  });
});

describe("every reader of the standing classification answers an automatic filing (lg-17)", () => {
  test("the inbox leaves it out, and neither its count nor the buckets' unclassified count it", async () => {
    const target = await start();
    await threeAnsweredThenTwo(target);

    const inbox = await readInbox(target);
    const buckets = await get<BucketsResponse>(target, `${ROUTES.buckets}?asOf=2026-09-30`);

    expect(inbox.map((row) => row.id)).toEqual([idAt(4)]);
    expect(inboxCount(target.context.db)).toBe(1);
    expect(buckets.unclassified).toBe(1);
  });

  test("the stored rows answer it as filed automatically, its spending category by override, then the map, never an answer's rule", async () => {
    const target = await start();
    const spending = (await get<SpendingCategoriesResponse>(target, ROUTES.spendingCategories))
      .categories;
    const idOf = (name: string): number => spending.find((c) => c.name === name)?.id ?? 0;
    const stretch = [market(1, -10000), market(2, -10000), market(3, -10000), market(10, -10000)];
    await pasteSlice(target, stretch, 0, 3);
    // The three answers accept a rule naming Pharmacy, which is then retired, so
    // no rule's pattern matches the fourth row and history is what files it.
    const rule = await addRule(target, {
      descriptionPattern: MARKET,
      category: null,
      amountCents: null,
      personId: "sam",
      bucket: "current-expenses",
      spendingCategoryId: idOf("Pharmacy"),
    });
    for (const index of [0, 1, 2]) await answer(target, idAt(index), { ruleId: rule.id });
    await target.server.inject({
      method: "POST",
      url: ROUTES.ruleRetire.replace(":id", String(rule.id)),
      payload: {},
    });
    await target.server.inject({
      method: "POST",
      url: ROUTES.spendingCategoryMap,
      payload: { desjardinsCategory: "Épicerie", spendingCategoryId: idOf("Groceries") },
    });

    await pasteSlice(target, stretch, 3, 4);

    const filed = await storedRow(target, idAt(3));
    expect(filed).toMatchObject({
      classification: { personId: "sam", bucket: "current-expenses", source: "auto" },
      spendingCategory: { id: idOf("Groceries"), source: "map" },
    });
    // An answer it rests on keeps the category of the rule version it cites.
    expect((await storedRow(target, idAt(0)))?.spendingCategory).toEqual({
      id: idOf("Pharmacy"),
      source: "rule",
    });
    // The review list says the same as the stored rows.
    expect((await reviewList(target))[0]?.spendingCategory).toEqual(filed?.spendingCategory);

    // A rule added since, which would take the row now, did not file it: the
    // filing cites no rule, so the row is not read as if it were waiting.
    await addRule(target, {
      descriptionPattern: MARKET,
      category: null,
      amountCents: null,
      personId: "sam",
      bucket: "current-expenses",
      spendingCategoryId: idOf("Restaurant"),
    });
    expect((await storedRow(target, idAt(3)))?.spendingCategory).toEqual({
      id: idOf("Groceries"),
      source: "map",
    });
    expect((await reviewList(target))[0]?.spendingCategory).toEqual(filed?.spendingCategory);

    await target.server.inject({
      method: "POST",
      url: ROUTES.spendingCategoryOverrides,
      payload: { rowId: idAt(3), spendingCategoryId: idOf("Household") },
    });

    const overridden = { id: idOf("Household"), source: "override" };
    expect((await storedRow(target, idAt(3)))?.spendingCategory).toEqual(overridden);
    expect((await reviewList(target))[0]?.spendingCategory).toEqual(overridden);
  });

  test("the buckets count it where it was filed", async () => {
    const target = await start();
    await threeAnsweredThenTwo(target);

    const buckets = await get<BucketsResponse>(target, `${ROUTES.buckets}?asOf=2026-09-30`);

    // Sam's three answered rows and the one history filed; the fifth waits.
    expect(buckets.buffer.balanceCents).toBe(-(10000 + 9000 + 10000 + 11500));
  });
});
