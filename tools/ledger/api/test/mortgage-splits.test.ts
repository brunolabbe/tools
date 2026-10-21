/**
 * How the mortgage splits, from a date (lg-63): filed by shares, equally or at
 * the ratio, read back, superseded for its day, and refused when the parts do
 * not sum, name the wrong people, or take effect after today. Every description
 * and amount is invented.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  BucketsResponse,
  ErrorResponse,
  MortgageOwnResponse,
  MortgageSplit,
  MortgageSplitsResponse,
  RuleDraft,
  SalaryEntryResponse,
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

// The app's clock reads 2026-10-03.
const ALEX_IN = "Virement entre folios /Caisse du Mont";
const SAM_IN = "Virement - AccèsD Internet /Caisse du Lac";
const PAYMENT = "Hypothèque /Prêteur Exemple";

function rule(pattern: string, personId: string | null): RuleDraft {
  return {
    descriptionPattern: pattern,
    category: null,
    amountCents: null,
    personId,
    bucket: "mortgage",
    spendingCategoryId: null,
  };
}

/** 2 000.00 in from each, then three payments of 700.01 on the 15th of January to March. */
const ROWS: PasteRow[] = [
  { date: "2026-01-05", description: ALEX_IN, amountCents: 200_000 },
  { date: "2026-01-06", description: SAM_IN, amountCents: 200_000 },
  { date: "2026-01-15", category: "Hypothèque", description: PAYMENT, amountCents: -70_001 },
  { date: "2026-02-15", category: "Hypothèque", description: PAYMENT, amountCents: -70_001 },
  { date: "2026-03-15", category: "Hypothèque", description: PAYMENT, amountCents: -70_001 },
];

async function send(target: App, method: "GET" | "POST", url: string, payload?: object) {
  return await target.server.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

/** alex and sam, their rows filed, and a ratio of 60 / 40 % from 2026-01-01. */
async function start(): Promise<App> {
  const target = await startApp();
  app = target;
  await addRule(target, rule(ALEX_IN, "alex"));
  await addRule(target, rule(SAM_IN, "sam"));
  await addRule(target, rule(PAYMENT, null));
  await pasteStatement(target, renderPaste(withBalances(ROWS, 500_000)));
  const entered = (
    await send(target, "POST", ROUTES.salaries, {
      year: 2026,
      salaries: [
        { personId: "alex", amountCents: 6_000_000 },
        { personId: "sam", amountCents: 4_000_000 },
      ],
    })
  ).json<SalaryEntryResponse>();
  const ratio = await send(target, "POST", ROUTES.ratios, {
    effectiveFrom: "2026-01-01",
    salaryIds: entered.salaries.map((salary) => salary.id),
  });
  expect(ratio.statusCode, ratio.body).toBe(200);
  return target;
}

async function file(target: App, payload: object): Promise<MortgageSplit> {
  const response = await send(target, "POST", ROUTES.mortgageSplits, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<MortgageSplit>();
}

async function refused(target: App, payload: object): Promise<[number, string]> {
  const response = await send(target, "POST", ROUTES.mortgageSplits, payload);
  return [response.statusCode, response.json<ErrorResponse>().error.code];
}

async function own(target: App): Promise<number[]> {
  const response = await send(target, "GET", `${ROUTES.buckets}?asOf=2026-03-31`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<BucketsResponse>().mortgage.own.map((one) => one.ownCents);
}

function count(target: App, table: string): unknown {
  return target.books.of("home").prepare(`SELECT count(*) AS n FROM ${table}`).get();
}

function shares(alex: number, sam: number) {
  return [
    { personId: "alex", partsPerMillion: alex },
    { personId: "sam", partsPerMillion: sam },
  ];
}

describe("filing a split", () => {
  test("each mode is filed and read back, and the buckets split each payment by the one on its date", async () => {
    const target = await start();

    // No record: −2 100.03 in halves, the odd cent to alex.
    expect(await own(target)).toEqual([200_000 - 105_002, 200_000 - 105_001]);

    // At the ratio from the first day: 60 / 40 % of −210 003, the cent to alex.
    const ratio = await file(target, { effectiveFrom: "2026-01-01", mode: "ratio" });
    expect(ratio).toMatchObject({ mode: "ratio", shares: [], supersedes: null, enteredBy: "alex" });
    expect(await own(target)).toEqual([200_000 - 126_002, 200_000 - 84_001]);

    // By shares from February: January's payment stays at the ratio (−42 001 and
    // −28 000); February's and March's −140 002 go 25 / 75 %, the cent to alex.
    const byShares = await file(target, {
      effectiveFrom: "2026-02-01",
      mode: "shares",
      shares: shares(250_000, 750_000),
    });
    expect(byShares.shares).toEqual(shares(250_000, 750_000));
    expect(await own(target)).toEqual([200_000 - 42_001 - 35_001, 200_000 - 28_000 - 105_001]);

    // Equally from March: February's −70 001 by shares, the cent to sam; March's in halves.
    const equal = await file(target, { effectiveFrom: "2026-03-01", mode: "equal" });
    expect(await own(target)).toEqual([
      200_000 - 42_001 - 17_500 - 35_001,
      200_000 - 28_000 - 52_501 - 35_000,
    ]);

    const listed = await send(target, "GET", ROUTES.mortgageSplits);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<MortgageSplitsResponse>()).toEqual({
      asOf: "2026-10-03",
      splits: [ratio, byShares, equal],
      inEffect: equal,
    });
    const before = await send(target, "GET", `${ROUTES.mortgageSplits}?asOf=2026-02-14`);
    expect(before.json<MortgageSplitsResponse>().inEffect).toEqual(byShares);
  });

  test("the series marks each change and names the split standing at the range's end", async () => {
    const target = await start();
    await file(target, {
      effectiveFrom: "2026-02-01",
      mode: "shares",
      shares: shares(250_000, 750_000),
    });

    const response = await send(target, "GET", ROUTES.statsMortgageOwn);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<MortgageOwnResponse>();
    expect(body.points.map((point) => [point.date, point.split.mode, point.splitChanged])).toEqual([
      ["2026-01-05", "equal", false],
      ["2026-01-06", "equal", false],
      ["2026-01-15", "equal", false],
      ["2026-02-15", "shares", true],
      ["2026-03-15", "shares", false],
    ]);
    expect(body.split).toEqual({
      mode: "shares",
      effectiveFrom: "2026-02-01",
      noRatio: false,
      parts: shares(250_000, 750_000),
    });
    const january = await send(target, "GET", `${ROUTES.statsMortgageOwn}?to=2026-01-31`);
    expect(january.json<MortgageOwnResponse>().split).toMatchObject({
      mode: "equal",
      effectiveFrom: null,
    });
  });

  test("a split filed for a day that has one supersedes it, and the same one again files nothing", async () => {
    const target = await start();

    const first = await file(target, { effectiveFrom: "2026-03-01", mode: "equal" });
    const second = await file(target, {
      effectiveFrom: "2026-03-01",
      mode: "shares",
      shares: shares(400_000, 600_000),
    });
    const again = await file(target, {
      effectiveFrom: "2026-03-01",
      mode: "shares",
      shares: shares(400_000, 600_000),
    });

    expect(second.supersedes).toBe(first.id);
    expect(again).toEqual(second);
    expect(count(target, "mortgage_splits")).toEqual({ n: 2 });
    expect(count(target, "mortgage_split_shares")).toEqual({ n: 2 });
    expect(target.books.of("home").prepare("SELECT id FROM current_mortgage_splits").all()).toEqual(
      [{ id: second.id }],
    );
    expect(
      (await send(target, "GET", ROUTES.mortgageSplits)).json<MortgageSplitsResponse>().splits,
    ).toEqual([second]);
  });
});

describe("a split refused", () => {
  test("shares that do not sum to 1 000 000, or name a person twice, are a bad request", async () => {
    const target = await start();

    for (const parts of [
      shares(500_000, 499_999),
      shares(500_000, 500_001),
      [
        { personId: "alex", partsPerMillion: 500_000 },
        { personId: "alex", partsPerMillion: 500_000 },
      ],
    ]) {
      expect(
        await refused(target, { effectiveFrom: "2026-02-01", mode: "shares", shares: parts }),
      ).toEqual([400, "BAD_REQUEST"]);
    }
    expect(count(target, "mortgage_splits")).toEqual({ n: 0 });
  });

  test("shares that leave out a person the books hold on the day, or name another, are refused", async () => {
    const target = await start();

    expect(
      await refused(target, {
        effectiveFrom: "2026-02-01",
        mode: "shares",
        shares: [{ personId: "alex", partsPerMillion: 1_000_000 }],
      }),
    ).toEqual([409, "MORTGAGE_SHARES_WRONG_PEOPLE"]);
    expect(
      await refused(target, {
        effectiveFrom: "2026-02-01",
        mode: "shares",
        shares: [...shares(400_000, 500_000), { personId: "casey", partsPerMillion: 100_000 }],
      }),
    ).toEqual([409, "MORTGAGE_SHARES_WRONG_PEOPLE"]);
    expect(count(target, "mortgage_splits")).toEqual({ n: 0 });
  });

  test("a split from a day after today is refused, and today is not after it", async () => {
    const target = await start();

    expect(await refused(target, { effectiveFrom: "2026-10-04", mode: "equal" })).toEqual([
      400,
      "BAD_REQUEST",
    ]);
    expect(await refused(target, { effectiveFrom: "2026-10-04", mode: "ratio" })).toEqual([
      400,
      "BAD_REQUEST",
    ]);
    expect(count(target, "mortgage_splits")).toEqual({ n: 0 });
    await file(target, { effectiveFrom: "2026-10-03", mode: "ratio" });
  });

  test("a mode that is not one of the three, or shares given to another mode, are a bad request", async () => {
    const target = await start();

    expect(await refused(target, { effectiveFrom: "2026-02-01", mode: "half" })).toEqual([
      400,
      "BAD_REQUEST",
    ]);
    expect(
      await refused(target, {
        effectiveFrom: "2026-02-01",
        mode: "equal",
        shares: shares(500_000, 500_000),
      }),
    ).toEqual([400, "BAD_REQUEST"]);
  });
});
