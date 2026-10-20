/**
 * What a household says about its mortgage (lg-55): live, ended on a day, or
 * none. The records are appended and the latest stands; the close is the later
 * of the end date and the last joint payment out of the bucket; what is left in
 * the bucket after it is each person's own money, which the model already says
 * (`docs/00-ANALYSIS.md` §4). Every description and amount is invented.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, MortgageResponse, RuleDraft } from "@ledger/contract";
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
const ALEX_OUT = "Retrait remboursé /Caisse du Mont";
const SAM_OUT = "Retrait remboursé /Caisse du Lac";

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

async function start(rows: PasteRow[] = []): Promise<App> {
  app = await startApp();
  await addRule(app, rule(ALEX_IN, "alex"));
  await addRule(app, rule(SAM_IN, "sam"));
  await addRule(app, rule(PAYMENT, null));
  await addRule(app, rule(ALEX_OUT, "alex"));
  await addRule(app, rule(SAM_OUT, "sam"));
  if (rows.length > 0) await pasteStatement(app, renderPaste(withBalances(rows, 500_000)));
  return app;
}

async function say(target: App, payload: object): Promise<MortgageResponse> {
  const response = await target.server.inject({ method: "POST", url: ROUTES.mortgage, payload });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<MortgageResponse>();
}

async function read(target: App): Promise<MortgageResponse> {
  const response = await target.server.inject({ method: "GET", url: ROUTES.mortgage });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<MortgageResponse>();
}

/** Two deposits of 1 000.00, then two payments of 700.00: 650.00 each stays in the bucket. */
const PAID_DOWN: PasteRow[] = [
  { date: "2026-01-05", description: ALEX_IN, amountCents: 100_000 },
  { date: "2026-01-06", description: SAM_IN, amountCents: 100_000 },
  { date: "2026-01-15", category: "Hypothèque", description: PAYMENT, amountCents: -70_000 },
  { date: "2026-02-15", category: "Hypothèque", description: PAYMENT, amountCents: -70_000 },
];

describe("the record", () => {
  test("no record reads as live, and nothing is closed", async () => {
    const target = await start(PAID_DOWN);

    expect(await read(target)).toMatchObject({
      asOf: "2026-10-03",
      record: null,
      state: "live",
      endedOn: null,
      lastPaymentOn: "2026-02-15",
      closedOn: null,
    });
  });

  test("each state is filed and read back", async () => {
    const target = await start(PAID_DOWN);

    const ended = await say(target, { state: "ended", endedOn: "2026-03-31" });
    expect(ended).toMatchObject({ state: "ended", endedOn: "2026-03-31" });
    expect(ended.record).toMatchObject({
      state: "ended",
      endedOn: "2026-03-31",
      supersedes: null,
      enteredBy: "alex",
    });
    expect(await read(target)).toEqual(ended);

    const none = await say(target, { state: "none" });
    expect(none).toMatchObject({ state: "none", endedOn: null, closedOn: null });
    expect(await read(target)).toEqual(none);

    const live = await say(target, { state: "live" });
    expect(live).toMatchObject({ state: "live", endedOn: null, closedOn: null });
    // The correction is a record of its own; the one before it is not erased.
    expect(live.record).toMatchObject({ state: "live", endedOn: null });
    expect(await read(target)).toEqual(live);
  });

  test("a later record supersedes an earlier one, and only one stands", async () => {
    const target = await start();

    const first = await say(target, { state: "ended", endedOn: "2026-03-31" });
    const second = await say(target, { state: "ended", endedOn: "2026-04-30" });
    const third = await say(target, { state: "none" });

    expect(second.record?.supersedes).toBe(first.record?.id);
    expect(third.record?.supersedes).toBe(second.record?.id);
    const books = target.books.of("home");
    const stored = books.prepare("SELECT id, supersedes FROM mortgage_records ORDER BY id").all();
    expect(stored).toHaveLength(3);
    expect(books.prepare("SELECT id FROM current_mortgage_record").all()).toEqual([
      { id: third.record?.id },
    ]);
    expect((await read(target)).state).toBe("none");
  });

  test("saying what already stands files nothing", async () => {
    const target = await start();

    await say(target, { state: "live" });
    await say(target, { state: "ended", endedOn: "2026-03-31" });
    await say(target, { state: "ended", endedOn: "2026-03-31" });

    const books = target.books.of("home");
    expect(books.prepare("SELECT count(*) AS n FROM mortgage_records").get()).toEqual({ n: 1 });
  });

  test("an end date after today is refused, and today is not after it", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.mortgage,
      payload: { state: "ended", endedOn: "2026-10-04" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    expect((await read(target)).record).toBeNull();

    expect(await say(target, { state: "ended", endedOn: "2026-10-03" })).toMatchObject({
      state: "ended",
      endedOn: "2026-10-03",
    });
  });

  test.each([
    ["an end with no day", { state: "ended" }],
    ["a day on a mortgage that is none", { state: "none", endedOn: "2026-03-31" }],
    ["a day on a mortgage that is live", { state: "live", endedOn: "2026-03-31" }],
    ["a day that is not one", { state: "ended", endedOn: "2026-02-30" }],
    ["an unknown state", { state: "paid" }],
    ["nothing", {}],
  ])("refuses %s", async (_name, payload) => {
    const target = await start();

    const response = await target.server.inject({ method: "POST", url: ROUTES.mortgage, payload });

    expect(response.statusCode).toBe(400);
    expect((await read(target)).record).toBeNull();
  });
});

describe("the close and what is left", () => {
  test("the close is the end date when the last payment came before it", async () => {
    const target = await start(PAID_DOWN);

    const ended = await say(target, { state: "ended", endedOn: "2026-03-31" });

    expect(ended).toMatchObject({ lastPaymentOn: "2026-02-15", closedOn: "2026-03-31" });
  });

  test("a payment dated after the record moves the close with it", async () => {
    const target = await start(PAID_DOWN);
    await say(target, { state: "ended", endedOn: "2026-02-20" });
    expect((await read(target)).closedOn).toBe("2026-02-20");

    const later: PasteRow = {
      date: "2026-03-15",
      category: "Hypothèque",
      description: PAYMENT,
      amountCents: -70_000,
    };
    await pasteStatement(target, renderPaste(withBalances([...PAID_DOWN, later], 500_000)));

    expect(await read(target)).toMatchObject({
      endedOn: "2026-02-20",
      lastPaymentOn: "2026-03-15",
      closedOn: "2026-03-15",
    });
  });

  test("what is left after the final payment is each person's own", async () => {
    const target = await start(PAID_DOWN);

    const ended = await say(target, { state: "ended", endedOn: "2026-03-31" });

    expect(ended.left).toBe(true);
    expect(ended.balanceCents).toBe(60_000);
    expect(ended.own).toEqual([
      { personId: "alex", ownCents: 30_000 },
      { personId: "sam", ownCents: 30_000 },
    ]);
  });

  test("a row filed to a person that takes their part out brings it down to zero", async () => {
    const target = await start([
      ...PAID_DOWN,
      { date: "2026-03-20", description: ALEX_OUT, amountCents: -30_000 },
      { date: "2026-03-21", description: SAM_OUT, amountCents: -30_000 },
    ]);

    const ended = await say(target, { state: "ended", endedOn: "2026-03-31" });

    expect(ended).toMatchObject({ left: false, balanceCents: 0 });
    expect(ended.own.every((person) => person.ownCents === 0)).toBe(true);
  });

  test("a household with no payment at all closes on its end date", async () => {
    const target = await start();

    expect(await say(target, { state: "ended", endedOn: "2026-03-31" })).toMatchObject({
      lastPaymentOn: null,
      closedOn: "2026-03-31",
      left: false,
    });
  });
});
