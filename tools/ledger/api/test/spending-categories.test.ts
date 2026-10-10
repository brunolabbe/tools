/**
 * Spending categories (lg-15), through the API: the list, the map from Desjardins'
 * own categories, a rule's, a row's own override, and the period lines that pick
 * from the same list. Every description and amount is invented.
 *
 * "Category" on a row and a rule is Desjardins' text; the new thing is a
 * spending category, and the names below keep the two apart.
 */

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ErrorResponse,
  InboxRow,
  OpenPeriodResponse,
  PeriodLine,
  PeriodLineDraft,
  Rule,
  RuleDraft,
  RowsResponse,
  SpendingCategoriesResponse,
  SpendingCategory,
  SpendingCategoryMapEntry,
  SpendingCategoryMapResponse,
  SpendingCategoryOverrideResponse,
  StoredRow,
} from "@ledger/contract";
import { migrate } from "../src/db/schema.ts";
import { currentLines } from "../src/periods.ts";
import type { App } from "../src/server.ts";
import {
  GROCERIES,
  MORTGAGE,
  MORTGAGE_RULE,
  TRANSFER,
  addRule,
  pasteStatement,
  readInbox,
  rowId,
  startApp,
} from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(): Promise<App> {
  app = await startApp();
  return app;
}

async function post<T>(target: App, url: string, payload: object): Promise<T> {
  const response = await target.server.inject({ method: "POST", url, payload });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function refused(target: App, url: string, payload: object): Promise<ErrorResponse["error"]> {
  const response = await target.server.inject({ method: "POST", url, payload });
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  return response.json<ErrorResponse>().error;
}

async function get<T>(target: App, url: string): Promise<T> {
  const response = await target.server.inject({ method: "GET", url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function categories(target: App): Promise<SpendingCategory[]> {
  return (await get<SpendingCategoriesResponse>(target, ROUTES.spendingCategories)).categories;
}

/** The id of a seeded category by its name. */
async function idOf(target: App, name: string): Promise<number> {
  const found = (await categories(target)).find((category) => category.name === name);
  if (found === undefined) throw new Error(`no spending category ${name}`);
  return found.id;
}

async function rows(target: App, query = ""): Promise<RowsResponse> {
  return await get<RowsResponse>(target, `${ROUTES.rows}${query}`);
}

async function rowOf(target: App, description: string, amountCents: number): Promise<StoredRow> {
  const id = rowId(target, description, amountCents);
  const found = (await rows(target, "?limit=500")).rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`row ${description} not listed`);
  return found;
}

async function setMap(
  target: App,
  desjardinsCategory: string,
  spendingCategoryId: number | null,
): Promise<SpendingCategoryMapEntry> {
  return await post<SpendingCategoryMapEntry>(target, ROUTES.spendingCategoryMap, {
    desjardinsCategory,
    spendingCategoryId,
  });
}

async function override(
  target: App,
  id: number,
  spendingCategoryId: number | null,
): Promise<SpendingCategoryOverrideResponse> {
  return await post<SpendingCategoryOverrideResponse>(target, ROUTES.spendingCategoryOverrides, {
    rowId: id,
    spendingCategoryId,
  });
}

/** The groceries row of the shared history: Desjardins' `Épicerie`, no rule of its own. */
const GROCERIES_AMOUNT = -12345;

function ruleFor(spendingCategoryId: number | null, fields: Partial<RuleDraft> = {}): RuleDraft {
  return {
    descriptionPattern: GROCERIES,
    category: null,
    amountCents: null,
    personId: null,
    bucket: "current-expenses",
    spendingCategoryId,
    ...fields,
  };
}

describe("the list", () => {
  test("is seeded with six generic words, and nothing else is", async () => {
    const target = await start();

    expect((await categories(target)).map((category) => category.name)).toEqual([
      "Groceries",
      "Alcohol",
      "Household",
      "Pharmacy",
      "Restaurant",
      "Other",
    ]);
    // Rules are never seeded (the tool's CLAUDE.md); neither is the map.
    expect(target.context.db.prepare("SELECT count(*) AS n FROM rules").get()).toEqual({ n: 0 });
    expect(target.context.db.prepare("SELECT count(*) AS n FROM spending_category_map").get()).toEqual(
      { n: 0 },
    );
  });

  test("a new category joins it, recording who and when, and a duplicate name is refused", async () => {
    const target = await start();

    const created = await post<SpendingCategory>(target, ROUTES.spendingCategories, {
      name: "  Pets ",
    });

    expect(created).toMatchObject({
      name: "Pets",
      retired: false,
      createdBy: "alex",
      createdAt: "2026-10-03T09:30:00.000Z",
    });
    const error = await refused(target, ROUTES.spendingCategories, { name: "PETS" });
    expect(error.code).toBe("BAD_REQUEST");
  });

  test("renaming files a new version under the same id, and the old version stays", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");

    const renamed = await post<SpendingCategory>(
      target,
      ROUTES.spendingCategory.replace(":id", String(groceries)),
      { name: "Food" },
    );

    expect(renamed).toMatchObject({ id: groceries, name: "Food" });
    expect((await categories(target)).map((category) => category.name)).toContain("Food");
    expect(
      target.context.db
        .prepare("SELECT name FROM spending_categories WHERE id = ? OR root_id = ? ORDER BY id")
        .all(groceries, groceries),
    ).toEqual([{ name: "Groceries" }, { name: "Food" }]);
    // The name another category has is taken.
    const error = await refused(
      target,
      ROUTES.spendingCategory.replace(":id", String(groceries)),
      { name: "pharmacy" },
    );
    expect(error.code).toBe("BAD_REQUEST");
  });

  test("a retired category is kept and can no longer be picked", async () => {
    const target = await start();
    const other = await idOf(target, "Other");

    const retired = await post<SpendingCategory>(
      target,
      ROUTES.spendingCategoryRetire.replace(":id", String(other)),
      {},
    );

    expect(retired).toMatchObject({ id: other, retired: true });
    expect((await categories(target)).find((category) => category.id === other)?.retired).toBe(true);
    const error = await refused(target, ROUTES.spendingCategoryMap, {
      desjardinsCategory: "Divers",
      spendingCategoryId: other,
    });
    expect(error.code).toBe("SPENDING_CATEGORY_NOT_FOUND");
    expect(
      (await refused(target, ROUTES.spendingCategory.replace(":id", "999"), { name: "Nope" })).code,
    ).toBe("SPENDING_CATEGORY_NOT_FOUND");
  });
});

describe("the map", () => {
  test("lists one line per Desjardins category seen in stored rows, with its spending category or none", async () => {
    const target = await start();
    await pasteStatement(target);
    const groceries = await idOf(target, "Groceries");
    await setMap(target, "Épicerie", groceries);

    const { entries } = await get<SpendingCategoryMapResponse>(target, ROUTES.spendingCategoryMap);

    expect(entries).toEqual([
      { desjardinsCategory: "Épicerie", spendingCategoryId: groceries, rows: 1 },
      { desjardinsCategory: "Loyer/Prêt hypothécaire", spendingCategoryId: null, rows: 1 },
      { desjardinsCategory: "Virements", spendingCategoryId: null, rows: 2 },
    ]);
  });

  test("a row whose Desjardins category is mapped gets that spending category", async () => {
    const target = await start();
    await pasteStatement(target);
    const groceries = await idOf(target, "Groceries");

    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toBeNull();
    await setMap(target, "Épicerie", groceries);

    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toEqual({
      id: groceries,
      source: "map",
    });
    // The inbox shows the same thing for the same row.
    const inbox = await readInbox(target);
    expect(inbox.find((row) => row.description === GROCERIES)?.spendingCategory).toEqual({
      id: groceries,
      source: "map",
    });
  });

  test("the text is folded the way a rule folds a category", async () => {
    const target = await start();
    await pasteStatement(target);
    const groceries = await idOf(target, "Groceries");

    await setMap(target, "  EPICERIE ", groceries);

    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory?.id).toBe(groceries);
  });

  test("changing an entry changes rows already stored, and the earlier version is still stored", async () => {
    const target = await start();
    await pasteStatement(target);
    const groceries = await idOf(target, "Groceries");
    const household = await idOf(target, "Household");
    await setMap(target, "Épicerie", groceries);

    await setMap(target, "Épicerie", household);

    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toEqual({
      id: household,
      source: "map",
    });
    expect(
      target.context.db
        .prepare("SELECT spending_category_id AS id FROM spending_category_map ORDER BY rowid")
        .all(),
    ).toEqual([{ id: groceries }, { id: household }]);
    expect(
      target.context.db.prepare("SELECT count(*) AS n FROM current_spending_category_map").get(),
    ).toEqual({ n: 1 });
  });

  test("clearing an entry leaves its rows uncategorised again", async () => {
    const target = await start();
    await pasteStatement(target);
    await setMap(target, "Épicerie", await idOf(target, "Groceries"));

    await setMap(target, "Épicerie", null);

    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toBeNull();
  });

  test("an entry for a category no row has is kept and answered with no rows", async () => {
    const target = await start();

    const entry = await setMap(target, "Jamais vue", await idOf(target, "Other"));

    expect(entry).toMatchObject({ desjardinsCategory: "Jamais vue", rows: 0 });
    expect((await get<SpendingCategoryMapResponse>(target, ROUTES.spendingCategoryMap)).entries).toEqual(
      [],
    );
  });
});

describe("a rule's spending category, and a row's own", () => {
  test("a row classified by a rule naming one gets the rule's, over the map's", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");
    const pharmacy = await idOf(target, "Pharmacy");
    await setMap(target, "Épicerie", groceries);
    const rule = await addRule(target, ruleFor(pharmacy));

    await pasteStatement(target);

    const row = await rowOf(target, GROCERIES, GROCERIES_AMOUNT);
    expect(row.classification).toMatchObject({ source: "rule" });
    expect(row.spendingCategory).toEqual({ id: pharmacy, source: "rule" });
    expect(rule.spendingCategoryId).toBe(pharmacy);
  });

  test("a row with its own override gets that, over its rule's and the map's", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");
    const pharmacy = await idOf(target, "Pharmacy");
    const household = await idOf(target, "Household");
    await setMap(target, "Épicerie", groceries);
    await addRule(target, ruleFor(pharmacy));
    await pasteStatement(target);
    const id = rowId(target, GROCERIES, GROCERIES_AMOUNT);

    const answered = await override(target, id, household);

    expect(answered).toEqual({ rowId: id, spendingCategory: { id: household, source: "override" } });
    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toEqual({
      id: household,
      source: "override",
    });
  });

  test("withdrawing the override leaves the row to its rule, and the earlier records stay", async () => {
    const target = await start();
    const pharmacy = await idOf(target, "Pharmacy");
    const household = await idOf(target, "Household");
    await addRule(target, ruleFor(pharmacy));
    await pasteStatement(target);
    const id = rowId(target, GROCERIES, GROCERIES_AMOUNT);
    await override(target, id, household);

    const withdrawn = await override(target, id, null);

    expect(withdrawn.spendingCategory).toEqual({ id: pharmacy, source: "rule" });
    expect(
      target.context.db
        .prepare(
          "SELECT spending_category_id AS id, set_by AS by FROM spending_category_overrides ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { id: household, by: "alex" },
      { id: null, by: "alex" },
    ]);
  });

  test("an override for a row or a category that is not there is refused", async () => {
    const target = await start();
    await pasteStatement(target);
    const id = rowId(target, GROCERIES, GROCERIES_AMOUNT);

    expect((await refused(target, ROUTES.spendingCategoryOverrides, { rowId: 9999, spendingCategoryId: null })).code).toBe(
      "ROW_NOT_FOUND",
    );
    expect(
      (await refused(target, ROUTES.spendingCategoryOverrides, { rowId: id, spendingCategoryId: 9999 }))
        .code,
    ).toBe("SPENDING_CATEGORY_NOT_FOUND");
  });

  test("a rule naming a category that is not in the list is refused", async () => {
    const target = await start();

    const error = await refused(target, ROUTES.rules, ruleFor(9999));

    expect(error.code).toBe("SPENDING_CATEGORY_NOT_FOUND");
  });

  test("editing a rule's category files a version, and a row keeps the version it was filed by", async () => {
    const target = await start();
    const pharmacy = await idOf(target, "Pharmacy");
    const household = await idOf(target, "Household");
    const first = await addRule(target, ruleFor(pharmacy));
    await pasteStatement(target);

    const second = await post<Rule>(
      target,
      ROUTES.rule.replace(":id", String(first.id)),
      ruleFor(household),
    );

    expect(second.spendingCategoryId).toBe(household);
    expect(second.id).not.toBe(first.id);
    expect((await get<{ rules: Rule[] }>(target, ROUTES.rules)).rules.map((r) => r.spendingCategoryId)).toEqual(
      [household],
    );
    // The row was filed by the first version, which read pharmacy then.
    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toEqual({
      id: pharmacy,
      source: "rule",
    });
  });

  test("a retirement keeps the category, and a retired category stays on what picked it", async () => {
    const target = await start();
    const pharmacy = await idOf(target, "Pharmacy");
    const rule = await addRule(target, ruleFor(pharmacy));
    await pasteStatement(target);

    await post(target, ROUTES.ruleRetire.replace(":id", String(rule.id)), {});
    await post(target, ROUTES.spendingCategoryRetire.replace(":id", String(pharmacy)), {});

    expect(
      target.context.db
        .prepare("SELECT retired, spending_category_id AS id FROM rules ORDER BY rowid")
        .all(),
    ).toEqual([
      { retired: 0, id: pharmacy },
      { retired: 1, id: pharmacy },
    ]);
    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).spendingCategory).toEqual({
      id: pharmacy,
      source: "rule",
    });
  });

  test("a rule already naming a retired category can be saved again, and cannot be given a new retired one", async () => {
    const target = await start();
    const pharmacy = await idOf(target, "Pharmacy");
    const other = await idOf(target, "Other");
    const rule = await addRule(target, ruleFor(pharmacy));
    await post(target, ROUTES.spendingCategoryRetire.replace(":id", String(pharmacy)), {});
    await post(target, ROUTES.spendingCategoryRetire.replace(":id", String(other)), {});
    const url = ROUTES.rule.replace(":id", String(rule.id));

    expect((await refused(target, url, ruleFor(other))).code).toBe("SPENDING_CATEGORY_NOT_FOUND");
    const saved = await post<Rule>(target, url, ruleFor(pharmacy, { amountCents: -12345 }));

    expect(saved.spendingCategoryId).toBe(pharmacy);
  });

  test("two rules level at the top differing only in their spending category ask, as one answer", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");
    const pharmacy = await idOf(target, "Pharmacy");
    await addRule(target, ruleFor(groceries));
    await addRule(target, ruleFor(pharmacy));

    await pasteStatement(target);

    const row = (await readInbox(target)).find((r: InboxRow) => r.description === GROCERIES);
    expect(row).toMatchObject({ reason: "ambiguous", suggestion: null, spendingCategory: null });
    expect(row?.matching).toHaveLength(2);
    expect((await rowOf(target, GROCERIES, GROCERIES_AMOUNT)).classification).toBeNull();
  });
});

describe("a row with no spending category", () => {
  test("is classified like any other and does not enter the inbox", async () => {
    const target = await start();
    await addRule(target, ruleFor(null));
    await addRule(target, MORTGAGE_RULE);

    await pasteStatement(target);

    const inbox = (await readInbox(target)).map((row) => row.description);
    expect(inbox).not.toContain(GROCERIES);
    expect(inbox).not.toContain(MORTGAGE);
    const row = await rowOf(target, GROCERIES, GROCERIES_AMOUNT);
    expect(row.classification).toMatchObject({ bucket: "current-expenses", source: "rule" });
    // The API answers it as null, rather than leaving it out.
    expect(row).toHaveProperty("spendingCategory", null);
  });

  test("is not held in the inbox for want of a category, nor let out of it by having one", async () => {
    const target = await start();
    await setMap(target, "Épicerie", await idOf(target, "Groceries"));

    await pasteStatement(target);

    const inbox = await readInbox(target);
    expect(inbox).toHaveLength(4);
    // Reasons are about rules, whatever the category says.
    expect(new Set(inbox.map((row) => row.reason))).toEqual(new Set(["no-rule"]));
    expect(inbox.filter((row) => row.spendingCategory !== null)).toHaveLength(1);
  });

  test("is listed by the filter, and only the uncategorised are", async () => {
    const target = await start();
    await setMap(target, "Épicerie", await idOf(target, "Groceries"));
    await pasteStatement(target);

    const none = await rows(target, "?spendingCategory=none");

    expect(none.total).toBe(3);
    expect(none.rows.map((row) => row.description).toSorted()).toEqual(
      [MORTGAGE, TRANSFER, TRANSFER].toSorted(),
    );
    expect(none.rows.every((row) => row.spendingCategory === null)).toBe(true);
    // The page is capped, and the total says how many there are.
    const capped = await rows(target, "?spendingCategory=none&limit=2");
    expect(capped.rows).toHaveLength(2);
    expect(capped.total).toBe(3);
  });

  test("a query it does not know is refused", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "GET",
      url: `${ROUTES.rows}?spendingCategory=groceries`,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("a period line's spending category", () => {
  function line(spendingCategoryId: number | null, more: Partial<PeriodLineDraft> = {}) {
    return {
      personId: "alex",
      date: "2026-09-10",
      amountCents: 4500,
      category: null,
      spendingCategoryId,
      note: null,
      chargedTo: null,
      ...more,
    } satisfies PeriodLineDraft;
  }

  test("a new line takes one from the list, and the open period lists it", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");

    const stored = await post<PeriodLine>(target, ROUTES.periodLines, line(groceries));

    expect(stored.spendingCategoryId).toBe(groceries);
    const open = await get<OpenPeriodResponse>(target, `${ROUTES.periodOpen}?end=2026-09-30`);
    expect(open.lines).toEqual([expect.objectContaining({ spendingCategoryId: groceries })]);
  });

  test("a correction is a new version that can pick another, and the earlier one stays", async () => {
    const target = await start();
    const groceries = await idOf(target, "Groceries");
    const household = await idOf(target, "Household");
    const first = await post<PeriodLine>(target, ROUTES.periodLines, line(groceries));

    const corrected = await post<PeriodLine>(
      target,
      ROUTES.periodLine.replace(":id", String(first.id)),
      line(household),
    );

    expect(corrected).toMatchObject({ spendingCategoryId: household, supersedes: first.id });
    expect(
      target.context.db
        .prepare("SELECT spending_category_id AS id FROM period_lines ORDER BY rowid")
        .all(),
    ).toEqual([{ id: groceries }, { id: household }]);
  });

  test("a category that is not in the list, or is retired, is refused", async () => {
    const target = await start();
    const other = await idOf(target, "Other");
    await post(target, ROUTES.spendingCategoryRetire.replace(":id", String(other)), {});

    expect((await refused(target, ROUTES.periodLines, line(9999))).code).toBe(
      "SPENDING_CATEGORY_NOT_FOUND",
    );
    expect((await refused(target, ROUTES.periodLines, line(other))).code).toBe(
      "SPENDING_CATEGORY_NOT_FOUND",
    );
    expect(target.context.db.prepare("SELECT count(*) AS n FROM period_lines").get()).toEqual({
      n: 0,
    });
  });

  test("a line stored before the migration keeps its text and has no spending category", () => {
    const db = new Database(":memory:");
    migrate(db, 5);
    db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', 'x')").run();
    db.prepare(
      `INSERT INTO period_lines (person_id, date, amount_cents, category, note, source, entered_at, entered_by)
       VALUES ('alex', '2026-09-10', 4500, 'épicerie', 'before', 'workbook', 'x', 'alex')`,
    ).run();

    migrate(db);

    const [stored] = currentLines(db);
    expect(stored).toMatchObject({
      category: "épicerie",
      note: "before",
      source: "workbook",
      spendingCategoryId: null,
    });
    db.close();
  });
});

describe("migration 6, on a database the earlier release left", () => {
  test("keeps the rules and the period lines in force visible, and the new column readable through the views", () => {
    const db = new Database(":memory:");
    migrate(db, 5);
    db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', 'x')").run();
    db.prepare(
      `INSERT INTO rules (description_pattern, category, amount_cents, person_id, bucket, created_at, created_by)
       VALUES ('Taxes*', NULL, NULL, NULL, 'current-expenses', 'x', 'alex')`,
    ).run();

    migrate(db);

    // A view written as SELECT * would have gone on listing the old columns.
    expect(db.prepare("SELECT spending_category_id AS id FROM current_rules").all()).toEqual([
      { id: null },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM current_period_lines").get()).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT count(*) AS n FROM pragma_table_info('current_period_lines')").get(),
    ).toEqual(db.prepare("SELECT count(*) AS n FROM pragma_table_info('period_lines')").get());
    db.close();
  });

  test("a category's later versions all name it by its first, and a version cannot stand alone", () => {
    const db = new Database(":memory:");
    migrate(db);

    // A later version with no predecessor, or a first with one, is refused.
    expect(() =>
      db
        .prepare(
          "INSERT INTO spending_categories (root_id, name, supersedes, created_at, created_by) VALUES (1, 'x', NULL, 'x', 'x')",
        )
        .run(),
    ).toThrow(/CHECK/u);
    expect(() =>
      db
        .prepare(
          "INSERT INTO spending_categories (root_id, name, supersedes, created_at, created_by) VALUES (NULL, 'x', 1, 'x', 'x')",
        )
        .run(),
    ).toThrow(/CHECK/u);
    // A version is superseded at most once.
    db.prepare(
      "INSERT INTO spending_categories (root_id, name, supersedes, created_at, created_by) VALUES (1, 'x', 1, 'x', 'x')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO spending_categories (root_id, name, supersedes, created_at, created_by) VALUES (1, 'y', 1, 'x', 'x')",
        )
        .run(),
    ).toThrow(/UNIQUE/u);
    db.close();
  });
});
