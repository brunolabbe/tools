/**
 * The history's series (lg-9), through the API: a synthetic account with a
 * mortgage payment that changes at a renewal, a buffer drawn on, salaries and a
 * ratio, a closed period and an open one. Every description and amount is
 * invented. The unit tests of the arithmetic are `books/test/stats.test.ts`;
 * these hold the gathering, the range and the names.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  BucketsResponse,
  BufferStatsResponse,
  ClosedPeriod,
  ContributionsResponse,
  ErrorResponse,
  FixedItemsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
  RuleDraft,
  SalariesStatsResponse,
  SalaryEntryResponse,
  SettlementsStatsResponse,
  SpendingCategoriesResponse,
  SpendingStatsResponse,
} from "@ledger/contract";
import type { App } from "../src/server.ts";
import { addRule, pasteStatement, startApp } from "./helpers/classification.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const ALEX_MORTGAGE = "Virement entre folios /Caisse du Mont";
const SAM_BUFFER = "Virement - AccèsD Internet /Caisse du Lac";
const PAYMENT = "Hypothèque /Prêteur Exemple";
const GROCERIES = "Achat /Marché Exemple";
const RENOVATION = "Achat /Entrepreneur Exemple";
const SHOP = "Achat /Dépanneur Exemple";

/** Oldest first. The renewal is the third payment; the shop's category is mapped to nothing. */
const ROWS: PasteRow[] = [
  { date: "2026-01-05", description: ALEX_MORTGAGE, amountCents: 50000 },
  { date: "2026-01-10", description: SAM_BUFFER, amountCents: 200000 },
  { date: "2026-01-15", category: "Hypothèque", description: PAYMENT, amountCents: -70000 },
  { date: "2026-02-03", category: "Épicerie", description: GROCERIES, amountCents: -12345 },
  { date: "2026-02-15", category: "Hypothèque", description: PAYMENT, amountCents: -70000 },
  { date: "2026-02-20", category: "Maison", description: RENOVATION, amountCents: -80000 },
  { date: "2026-03-05", category: "Divers", description: SHOP, amountCents: -2000 },
  { date: "2026-03-15", category: "Hypothèque", description: PAYMENT, amountCents: -82001 },
];

function rule(pattern: string, personId: string | null, bucket: RuleDraft["bucket"]): RuleDraft {
  return {
    descriptionPattern: pattern,
    category: null,
    amountCents: null,
    personId,
    bucket,
    spendingCategoryId: null,
  };
}

async function post<T>(target: App, url: string, payload: object): Promise<T> {
  const response = await target.server.inject({ method: "POST", url, payload });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function get<T>(target: App, url: string): Promise<T> {
  const response = await target.server.inject({ method: "GET", url });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

async function categoryId(target: App, name: string): Promise<number> {
  const { categories } = await get<SpendingCategoriesResponse>(target, ROUTES.spendingCategories);
  const found = categories.find((category) => category.name === name);
  if (found === undefined) throw new Error(`no spending category ${name}`);
  return found.id;
}

async function confirmRatio(
  target: App,
  year: number,
  effectiveFrom: string,
  alex: number,
  sam: number,
) {
  const entered = await post<SalaryEntryResponse>(target, ROUTES.salaries, {
    year,
    salaries: [
      { personId: "alex", amountCents: alex },
      { personId: "sam", amountCents: sam },
    ],
  });
  await post(target, ROUTES.ratios, {
    effectiveFrom,
    salaryIds: entered.salaries.map((salary) => salary.id),
  });
}

/** The account, the rules, two years of salaries, a closed period and an open one. */
async function start(): Promise<App> {
  app = await startApp();
  await addRule(app, rule(ALEX_MORTGAGE, "alex", "mortgage"));
  await addRule(app, rule(PAYMENT, null, "mortgage"));
  await addRule(app, rule(SAM_BUFFER, "sam", "current-expenses"));
  await addRule(app, rule(GROCERIES, null, "current-expenses"));
  await addRule(app, rule(RENOVATION, null, "current-expenses"));
  await addRule(app, rule(SHOP, null, "current-expenses"));
  await pasteStatement(app, renderPaste(withBalances(ROWS, 500000)));

  const groceries = await categoryId(app, "Groceries");
  await post(app, ROUTES.spendingCategoryMap, {
    desjardinsCategory: "Épicerie",
    spendingCategoryId: groceries,
  });

  await confirmRatio(app, 2025, "2025-01-01", 5_000_000, 4_000_000);
  await confirmRatio(app, 2026, "2026-03-01", 5_200_000, 4_400_000);

  await post(app, ROUTES.periodLines, {
    personId: "sam",
    date: "2026-01-20",
    amountCents: 10000,
    category: null,
    spendingCategoryId: groceries,
    note: null,
    chargedTo: null,
  });
  await post(app, ROUTES.periodLines, {
    personId: "alex",
    date: "2026-02-10",
    amountCents: 4000,
    category: "Café",
    spendingCategoryId: null,
    note: null,
    chargedTo: null,
  });
  await post(app, ROUTES.recurring, {
    personId: "alex",
    monthlyCents: 12000,
    startDate: "2026-01-05",
    endDate: null,
    label: "Internet",
  });
  await post(app, ROUTES.periodClose, { start: null, end: "2026-01-31" });
  return app;
}

describe("GET /api/stats/mortgage-payments", () => {
  test("lists the payments and marks the renewal", async () => {
    const target = await start();

    const { payments } = await get<MortgagePaymentsResponse>(target, ROUTES.statsMortgagePayments);

    expect(payments.map((payment) => [payment.date, payment.cents, payment.changed])).toEqual([
      ["2026-01-15", 70000, false],
      ["2026-02-15", 70000, false],
      ["2026-03-15", 82001, true],
    ]);
  });

  test("a range returns its payments and still knows what came before", async () => {
    const target = await start();

    const body = await get<MortgagePaymentsResponse>(
      target,
      `${ROUTES.statsMortgagePayments}?from=2026-03-01`,
    );

    expect(body.range).toEqual({ from: "2026-03-01", to: null });
    expect(body.payments).toEqual([
      { date: "2026-03-15", cents: 82001, previousCents: 70000, changed: true },
    ]);
  });

  test.each([
    ["not a day", "?from=yesterday"],
    ["from after to", "?from=2026-03-01&to=2026-02-01"],
    ["an unknown field", "?since=2026-01-01"],
  ])("refuses %s as BAD_REQUEST", async (_name, query) => {
    const target = await start();

    const response = await target.server.inject({
      method: "GET",
      url: `${ROUTES.statsMortgagePayments}${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/stats/salaries", () => {
  test("gives each year's salaries and the ratio in effect at its end", async () => {
    const target = await start();

    const { years } = await get<SalariesStatsResponse>(target, ROUTES.statsSalaries);

    expect(years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(years[1]?.salaries).toEqual([
      { personId: "alex", amountCents: 5_200_000 },
      { personId: "sam", amountCents: 4_400_000 },
    ]);
    expect(years[0]?.ratio?.effectiveFrom).toBe("2025-01-01");
    expect(years[1]?.ratio?.effectiveFrom).toBe("2026-03-01");
  });
});

describe("the buckets over time", () => {
  test("the last point of each series is what the home screen says today", async () => {
    const target = await start();
    const buckets = await get<BucketsResponse>(target, ROUTES.buckets);

    const own = await get<MortgageOwnResponse>(target, ROUTES.statsMortgageOwn);
    const contributions = await get<ContributionsResponse>(target, ROUTES.statsContributions);
    const buffer = await get<BufferStatsResponse>(target, ROUTES.statsBuffer);

    expect(own.points.at(-1)?.own).toEqual(buckets.mortgage.own);
    expect(own.points.at(-1)?.balanceCents).toBe(buckets.mortgage.balanceCents);
    const mortgage = contributions.series.find((one) => one.bucket === "mortgage");
    expect(mortgage?.points.at(-1)?.contributions).toEqual([
      { personId: "alex", contributedCents: 50000 },
      { personId: "sam", contributedCents: 0 },
    ]);
    const current = contributions.series.find((one) => one.bucket === "current-expenses");
    expect(current?.points.at(-1)?.contributions).toEqual(buckets.buffer.contributions);
    expect(buffer.points.at(-1)?.balanceCents).toBe(buckets.buffer.balanceCents);
  });

  test("the buffer lists the rows behind its large drops, and the size can be asked for", async () => {
    const target = await start();

    const usual = await get<BufferStatsResponse>(target, ROUTES.statsBuffer);
    const small = await get<BufferStatsResponse>(
      target,
      `${ROUTES.statsBuffer}?minDropCents=10000`,
    );

    expect(usual.minDropCents).toBe(50000);
    expect(usual.drops.map((drop) => [drop.description, drop.amountCents])).toEqual([
      [RENOVATION, -80000],
    ]);
    expect(usual.drops[0]?.balanceAfterCents).toBe(200000 - 12345 - 80000);
    expect(small.drops.map((drop) => drop.amountCents)).toEqual([-12345, -80000]);
  });

  test("a rejected drop size is BAD_REQUEST", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "GET",
      url: `${ROUTES.statsBuffer}?minDropCents=0`,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/stats/spending", () => {
  test("totals the closed period and the open one by category, with names", async () => {
    const target = await start();
    const groceries = await categoryId(target, "Groceries");

    const { periods, categories } = await get<SpendingStatsResponse>(target, ROUTES.statsSpending);

    expect(periods.map((period) => [period.start, period.end, period.open])).toEqual([
      [null, "2026-01-31", false],
      ["2026-02-01", "2026-10-03", true],
    ]);
    // January: sam's card line, categorised by the person.
    expect(periods[0]).toMatchObject({ cardCents: 10000, accountCents: 0, totalCents: 10000 });
    expect(periods[0]?.categories).toEqual([{ categoryId: groceries, cents: 10000 }]);
    // The open period: the groceries row (by the map) and the others on the account,
    // alex's coffee on a card with only its free text. The mortgage is not spending.
    expect(periods[1]).toMatchObject({
      cardCents: 4000,
      accountCents: 12345 + 80000 + 2000,
    });
    expect(periods[1]?.categories[0]).toEqual({ categoryId: groceries, cents: 12345 });
    // The whole list in its own order, not only what has an amount: a chart colours a
    // category by its place here, so a range that leaves one out cannot move the rest.
    expect(categories.map((category) => category.name)).toEqual([
      "Groceries",
      "Alcohol",
      "Household",
      "Pharmacy",
      "Restaurant",
      "Other",
    ]);
    expect(categories[0]).toEqual({ id: groceries, name: "Groceries", retired: false });
  });

  test("uncategorised keeps what each amount was called", async () => {
    const target = await start();

    const { periods } = await get<SpendingStatsResponse>(target, ROUTES.statsSpending);

    const uncategorised = periods[1]?.categories.at(-1);
    expect(uncategorised?.categoryId).toBeNull();
    expect(uncategorised?.detail).toEqual([
      { label: "Maison", cents: 80000 },
      { label: "Café", cents: 4000 },
      { label: "Divers", cents: 2000 },
    ]);
  });

  test("a range before the open period leaves the open period out", async () => {
    const target = await start();

    const { periods } = await get<SpendingStatsResponse>(
      target,
      `${ROUTES.statsSpending}?to=2026-01-31`,
    );

    expect(periods.map((period) => period.end)).toEqual(["2026-01-31"]);
  });
});

describe("GET /api/stats/fixed-items", () => {
  test("is month by month through today, and a month not yet reached is zero", async () => {
    const target = await start();

    const { months, series } = await get<FixedItemsResponse>(target, ROUTES.statsFixedItems);

    expect(months[0]).toBe("2026-01");
    expect(months.at(-1)).toBe("2026-10");
    expect(series).toHaveLength(1);
    expect(series[0]?.label).toBe("Internet");
    // The fifth of October is after the clock's 2026-10-03.
    expect(series[0]?.cents.slice(0, 9)).toEqual(Array<number>(9).fill(12000));
    expect(series[0]?.cents[9]).toBe(0);
  });
});

describe("GET /api/stats/settlements", () => {
  test("lists the closed periods with the formula each was settled by", async () => {
    const target = await start();
    const closed = await get<{ periods: ClosedPeriod[] }>(target, ROUTES.periods);

    const { periods } = await get<SettlementsStatsResponse>(target, ROUTES.statsSettlements);

    expect(periods).toEqual(closed.periods);
    expect(periods[0]?.settlement.formula).toBe("v3");
  });

  test("a range after the close leaves it out", async () => {
    const target = await start();

    const { periods } = await get<SettlementsStatsResponse>(
      target,
      `${ROUTES.statsSettlements}?from=2026-02-01`,
    );

    expect(periods).toEqual([]);
  });
});

test("nothing here writes: the books are the same after every series is read", async () => {
  const target = await start();
  const count = () =>
    target.context.db
      .prepare(
        "SELECT (SELECT count(*) FROM statement_rows) + (SELECT count(*) FROM classifications) + (SELECT count(*) FROM period_lines) + (SELECT count(*) FROM periods) AS n",
      )
      .get();
  const before = count();

  for (const url of Object.values(ROUTES).filter((route) => route.includes("/stats/"))) {
    expect((await target.server.inject({ method: "GET", url })).statusCode).toBe(200);
  }

  expect(count()).toEqual(before);
});
