/**
 * A household of more than two people (lg-23), through the API: the directory
 * takes a third name, the buckets, the open period and a close answer for
 * three, a close between more than two records its deposits and transfers, and
 * a ratio between different people waits for a close. Every name, address,
 * salary and amount is invented.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  BucketsResponse,
  ClosedPeriod,
  ErrorResponse,
  OpenPeriodResponse,
  PeriodLineDraft,
  RatiosResponse,
  RuleDraft,
  SalaryEntryResponse,
} from "@ledger/contract";
import type { Directory } from "../src/directory.ts";
import { createApp } from "../src/server.ts";
import { migratedBooks } from "./helpers/template.ts";
import type { App } from "../src/server.ts";
import {
  ALEX,
  HOUSEHOLD,
  SAM,
  accessConfig,
  homeBooks,
  memberDirectory,
} from "./helpers/access.ts";
import { addRule, pasteStatement } from "./helpers/classification.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const CASEY = "casey@example.test";
const NOW = new Date("2027-02-15T12:00:00Z");
const CHANGE = { by: "operator", at: new Date("2027-01-02T00:00:00Z") };

const SAM_MORTGAGE = "Virement entre folios /Caisse du Lac";
const ALEX_MORTGAGE = "Virement entre folios /Caisse du Mont";
const PAYMENT = "Hypothèque /Prêteur Exemple";

/** Oldest first: each of the two puts into the mortgage, and one payment, of an odd amount, goes out. */
const ROWS: PasteRow[] = [
  { date: "2026-11-02", description: SAM_MORTGAGE, amountCents: 40_000 },
  { date: "2026-11-05", description: ALEX_MORTGAGE, amountCents: 50_000 },
  {
    date: "2026-11-12",
    category: "Loyer/Prêt hypothécaire",
    description: PAYMENT,
    amountCents: -70_001,
  },
];

function rule(
  descriptionPattern: string,
  personId: string | null,
  bucket: RuleDraft["bucket"],
): RuleDraft {
  return {
    descriptionPattern,
    category: null,
    amountCents: null,
    personId,
    bucket,
    spendingCategoryId: null,
  };
}

/** The household's books as alex and sam keep them, alex the caller. */
async function start(): Promise<{ target: App; directory: Directory }> {
  const directory = memberDirectory();
  const target = await createApp({
    booksTemplate: migratedBooks(),
    directory,
    config: {
      dataDir: ":memory:",
      logLevel: "silent",
      access: accessConfig({ devIdentity: ALEX }),
    },
    now: () => NOW,
  });
  app = target;
  await addRule(target, rule(SAM_MORTGAGE, "sam", "mortgage"));
  await addRule(target, rule(ALEX_MORTGAGE, "alex", "mortgage"));
  await addRule(target, rule(PAYMENT, null, "mortgage"));
  await pasteStatement(target, renderPaste(withBalances(ROWS, 150_000)));
  return { target, directory };
}

async function send(target: App, method: "GET" | "POST", url: string, payload?: object) {
  return await target.server.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

async function ok<T>(
  target: App,
  method: "GET" | "POST",
  url: string,
  payload?: object,
): Promise<T> {
  const response = await send(target, method, url, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

/** Enters a year's salaries and confirms the ratio they give, from `effectiveFrom`; returns the answer. */
async function confirm(
  target: App,
  effectiveFrom: string,
  salaries: Record<string, number>,
): Promise<{ statusCode: number; body: string }> {
  const entered = await ok<SalaryEntryResponse>(target, "POST", ROUTES.salaries, {
    year: Number(effectiveFrom.slice(0, 4)),
    salaries: Object.entries(salaries).map(([personId, amountCents]) => ({
      personId,
      amountCents,
    })),
  });
  const named = new Set(Object.keys(salaries));
  return await send(target, "POST", ROUTES.ratios, {
    effectiveFrom,
    salaryIds: entered.salaries
      .filter((salary) => named.has(salary.personId))
      .map((salary) => salary.id),
  });
}

function line(personId: string, date: string, amountCents: number): PeriodLineDraft {
  return {
    personId,
    date,
    amountCents,
    category: null,
    spendingCategoryId: null,
    note: null,
    chargedTo: null,
  };
}

/** alex and sam, a ratio of 0.6, sam's 100.00 on a card, and the period to 2026-12-31 closed. */
async function twoPeopleClosed(target: App): Promise<ClosedPeriod> {
  expect(
    (await confirm(target, "2026-01-01", { alex: 6_000_000, sam: 4_000_000 })).statusCode,
  ).toBe(200);
  await ok(target, "POST", ROUTES.periodLines, line("sam", "2026-12-10", 10_000));
  return await ok<ClosedPeriod>(target, "POST", ROUTES.periodClose, {
    start: null,
    end: "2026-12-31",
  });
}

function storedPeriod(target: App, id: number): Record<string, unknown> {
  return homeBooks(target).prepare("SELECT * FROM periods WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
}

function listed(target: App, table: "settlement_deposits" | "settlement_transfers"): unknown[] {
  return homeBooks(target).prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

describe("lg-23's reproduction, run against the build", () => {
  // Done when 1: sam removed, casey added, no trigger dropped.
  test("with sam removed and casey added, the buckets, the open period and a close all answer 200", async () => {
    const { target, directory } = await start();
    const first = await twoPeopleClosed(target);

    // A household of two closes as it always did: the periods row holds the
    // settlement, and nothing is written beside it.
    expect(storedPeriod(target, first.id)).toMatchObject({
      payer_id: "alex",
      recipient_id: "sam",
      deposit_cents: 15_000,
      net_cents: 6_000,
      formula: "v3",
    });
    expect(listed(target, "settlement_deposits")).toEqual([]);
    expect(listed(target, "settlement_transfers")).toEqual([]);

    directory.removeMember({ address: SAM, ...CHANGE });
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });

    const buckets = await send(target, "GET", `${ROUTES.buckets}?asOf=2027-01-31`);
    expect(buckets.statusCode, buckets.body).toBe(200);
    const { mortgage } = buckets.json<BucketsResponse>();
    // 90 000 in, 70 001 out. lg-23 measured it split three ways, −23 334, −23 334
    // and −23 333, casey taking a share of a payment made before they were in.
    // Since lg-63 it is split between the people the ratio in effect on its date
    // names, alex and sam: −35 001 and −35 000.
    expect(mortgage.balanceCents).toBe(19_999);
    expect(mortgage.own).toEqual([
      { personId: "alex", ownCents: 14_999 },
      { personId: "casey", ownCents: 0 },
      { personId: "sam", ownCents: 5_000 },
    ]);
    expect(mortgage.lead).toEqual({ personId: "alex", byCents: 9_999 });

    // casey pays for something shared in January, at the ratio still in effect.
    await ok(target, "POST", ROUTES.periodLines, line("casey", "2027-01-10", 3_000));
    const open = await send(target, "GET", `${ROUTES.periodOpen}?end=2027-01-31`);
    expect(open.statusCode, open.body).toBe(200);
    const close = await send(target, "POST", ROUTES.periodClose, {
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(close.statusCode, close.body).toBe(200);

    // casey has no share in alex and sam's ratio, so a deposit into the buffer
    // could never reach casey: it settles directly. alex never paid December's
    // deposit, so alex owes sam December's 60.00 less sam's 0.4 of casey's
    // 30.00, and owes casey alex's 0.6 of it plus sam's part, which alex's debt
    // to sam already covers: 78.00 in all, 30.00 to casey and 48.00 to sam.
    const closed = close.json<ClosedPeriod>();
    expect(closed.settlement.deposits).toBeNull();
    expect(closed.settlement.transfers).toEqual([
      { fromId: "alex", toId: "casey", cents: 3_000 },
      { fromId: "alex", toId: "sam", cents: 4_800 },
    ]);
    expect(closed.deposit).toEqual({ status: "direct", deposits: [] });
    expect(storedPeriod(target, closed.id)).toMatchObject({
      payer_id: null,
      recipient_id: null,
      deposit_cents: null,
      net_cents: 0,
    });
    expect(listed(target, "settlement_transfers")).toEqual([
      expect.objectContaining({ from_id: "alex", to_id: "casey", cents: 3_000 }),
      expect.objectContaining({ from_id: "alex", to_id: "sam", cents: 4_800 }),
    ]);
    expect(listed(target, "settlement_deposits")).toEqual([]);
  });
});

describe("a close between three people", () => {
  test("records each deposit and transfer, reads them back, and matches each deposit to its own row", async () => {
    const { target, directory } = await start();
    await twoPeopleClosed(target);
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });
    // From the open period's first day, so it does not change people inside it.
    const confirmed = await confirm(target, "2027-01-01", {
      alex: 5_000_000,
      casey: 2_500_000,
      sam: 2_500_000,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // The open period: casey 60.00 and sam 20.00 shared, alex nothing.
    await ok(target, "POST", ROUTES.periodLines, line("casey", "2027-01-10", 6_000));
    await ok(target, "POST", ROUTES.periodLines, line("sam", "2027-01-12", 2_000));
    const closed = await ok<ClosedPeriod>(target, "POST", ROUTES.periodClose, {
      start: "2027-01-01",
      end: "2027-01-31",
    });

    // December's 60.00 that alex owes sam is still owed, and January at
    // 0.5/0.25/0.25 adds 40.00 for alex, 40.00 owed to casey and nothing for
    // sam: alex owes 100.00, casey is owed 40.00 and sam 60.00. sam is the
    // furthest ahead for their share (60.00 / 0.25 = 240.00 of top-up), so
    // alex deposits 100.00 + 0.5 × 240.00 and casey −40.00 + 0.25 × 240.00.
    expect(closed.settlement.shares.map((share) => share.personId)).toEqual([
      "alex",
      "casey",
      "sam",
    ]);
    const deposits = closed.settlement.deposits ?? [];
    expect(deposits).toEqual([
      { personId: "alex", depositCents: 22_000 },
      { personId: "casey", depositCents: 2_000 },
    ]);
    expect(closed.settlement.transfers).toEqual([
      { fromId: "alex", toId: "casey", cents: 4_000 },
      { fromId: "alex", toId: "sam", cents: 6_000 },
    ]);
    expect(closed.deposit).toEqual({
      status: "expected",
      deposits: deposits.map((deposit) => ({ ...deposit, status: "expected", rowId: null })),
    });
    expect(listed(target, "settlement_deposits")).toEqual(
      deposits.map((deposit) =>
        expect.objectContaining({
          person_id: deposit.personId,
          deposit_cents: deposit.depositCents,
        }),
      ),
    );
    // Read back as it was recorded, never recomputed.
    const [stored] = (await ok<{ periods: ClosedPeriod[] }>(target, "GET", ROUTES.periods)).periods;
    expect(stored?.settlement).toEqual(closed.settlement);
  });
});

describe("people change only at a close", () => {
  // Done when 5: a ratio with a different set of people cannot take effect
  // inside an open period.
  test("a ratio between different people from inside the open period is refused, and nothing is stored", async () => {
    const { target, directory } = await start();
    await twoPeopleClosed(target);
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });
    const before = await ok<RatiosResponse>(target, "GET", ROUTES.ratios);

    const inside = await confirm(target, "2027-01-15", {
      alex: 5_000_000,
      casey: 2_500_000,
      sam: 2_500_000,
    });

    expect(inside.statusCode).toBe(400);
    expect(JSON.parse(inside.body) as ErrorResponse).toMatchObject({
      error: { code: "BAD_REQUEST", message: expect.stringContaining("2027-01-01") },
    });
    expect(await ok<RatiosResponse>(target, "GET", ROUTES.ratios)).toEqual(before);
    // The open period still settles at alex and sam's ratio.
    const open = await ok<OpenPeriodResponse>(target, "GET", `${ROUTES.periodOpen}?end=2027-01-31`);
    expect(open.settlement?.shares.map((share) => share.personId)).toEqual(["alex", "sam"]);
  });

  test("the same people from inside it are taken, and then different people cannot start on its first day", async () => {
    const { target, directory } = await start();
    await twoPeopleClosed(target);
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });

    // A salary change, the same two people: a ratio change at the close, as ever.
    const same = await confirm(target, "2027-01-15", { alex: 5_000_000, sam: 5_000_000 });
    expect(same.statusCode, same.body).toBe(200);
    // casey from the open period's first day, while alex and sam's later ratio
    // still stands inside it: that would change people inside it, so it is refused.
    const startDay = await confirm(target, "2027-01-01", {
      alex: 5_000_000,
      casey: 2_500_000,
      sam: 2_500_000,
    });
    expect(startDay.statusCode).toBe(400);
  });

  test("different people from the open period's first day are taken, and settle the whole period", async () => {
    const { target, directory } = await start();
    await twoPeopleClosed(target);
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });

    const startDay = await confirm(target, "2027-01-01", { alex: 5_000_000, casey: 5_000_000 });

    expect(startDay.statusCode, startDay.body).toBe(200);
    const open = await ok<OpenPeriodResponse>(target, "GET", `${ROUTES.periodOpen}?end=2027-01-31`);
    expect(open.settlement?.shares.map((share) => share.personId)).toEqual(["alex", "casey"]);
  });

  test("before any close, a ratio between different people than the first is refused", async () => {
    const { target, directory } = await start();
    expect(
      (await confirm(target, "2026-01-01", { alex: 6_000_000, sam: 4_000_000 })).statusCode,
    ).toBe(200);
    directory.addMember({ household: HOUSEHOLD, address: CASEY, person: "casey", ...CHANGE });

    const later = await confirm(target, "2026-06-01", {
      alex: 5_000_000,
      casey: 2_500_000,
      sam: 2_500_000,
    });
    expect(later.statusCode).toBe(400);
    expect(JSON.parse(later.body) as ErrorResponse).toMatchObject({
      error: { message: expect.stringContaining("Close the first period") },
    });

    // Confirmed for the first ratio's own day, it replaces it: the first
    // period then has these three people throughout.
    const replacing = await send(target, "POST", ROUTES.ratios, {
      effectiveFrom: "2026-01-01",
      salaryIds: (
        await ok<{ salaries: { id: number; year: number }[] }>(target, "GET", ROUTES.salaries)
      ).salaries
        .filter((salary) => salary.year === 2026)
        .map((salary) => salary.id),
    });
    expect(replacing.statusCode, replacing.body).toBe(200);
  });
});
