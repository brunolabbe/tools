/**
 * Periods, their lines and recurring items, and closing one (lg-6), through the
 * API: a ratio confirmed from salaries, lines entered, a period closed, and the
 * deposit it asked for brought in by a later paste. Every description, amount
 * and salary is invented.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ClosedPeriod,
  ErrorResponse,
  OpenPeriodResponse,
  PeriodLine,
  PeriodLineDraft,
  PeriodsResponse,
  RecurringItem,
  RecurringItemDraft,
  SalaryEntryResponse,
} from "@ledger/contract";
import type { App } from "../src/server.ts";
import { SAM } from "./helpers/access.ts";
import { addRule, pasteStatement, startApp } from "./helpers/classification.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const ALEX_BUFFER = "Virement - AccèsD Internet /Caisse du Mont";

async function start(...args: Parameters<typeof startApp>): Promise<App> {
  app = await startApp(...args);
  return app;
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

/** Confirms the ratio two salaries give, from `effectiveFrom`. alex's share is `alex / (alex + sam)`. */
async function ratio(target: App, effectiveFrom: string, alex: number, sam: number): Promise<void> {
  const entered = await post<SalaryEntryResponse>(target, ROUTES.salaries, {
    year: Number(effectiveFrom.slice(0, 4)),
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

function draft(
  personId: string,
  date: string,
  amountCents: number,
  more: Partial<PeriodLineDraft> = {},
): PeriodLineDraft {
  return { personId, date, amountCents, category: null, note: null, chargedTo: null, ...more };
}

async function addLine(target: App, line: PeriodLineDraft): Promise<PeriodLine> {
  return await post<PeriodLine>(target, ROUTES.periodLines, line);
}

async function close(target: App, startDate: string | null, end: string): Promise<ClosedPeriod> {
  return await post<ClosedPeriod>(target, ROUTES.periodClose, { start: startDate, end });
}

async function periods(target: App): Promise<ClosedPeriod[]> {
  return (await get<PeriodsResponse>(target, ROUTES.periods)).periods;
}

async function open(target: App, query = ""): Promise<OpenPeriodResponse> {
  return await get<OpenPeriodResponse>(target, `${ROUTES.periodOpen}${query}`);
}

/**
 * The account's history so far, oldest first. Each paste re-sends all of it,
 * which the store reads as rows already present plus the new ones.
 */
function account(): { paste: (row: PasteRow) => Promise<void> } {
  const rows: PasteRow[] = [
    { date: "2026-01-02", description: "Dépôt /Caisse du Lac", amountCents: 100 },
  ];
  return {
    paste: async (row) => {
      rows.push(row);
      if (app === undefined) throw new Error("no app");
      await pasteStatement(app, renderPaste(withBalances(rows, 500_000)));
    },
  };
}

async function withBufferRule(target: App): Promise<void> {
  await addRule(target, {
    descriptionPattern: ALEX_BUFFER,
    category: null,
    amountCents: null,
    personId: "alex",
    bucket: "current-expenses",
  });
}

describe("closing a period", () => {
  test("records the settlement, and a later paste bringing the deposit in matches it", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    await addLine(target, draft("sam", "2026-09-10", 10_000, { category: "Épicerie" }));

    const closed = await close(target, null, "2026-09-30");

    expect(closed.settlement).toMatchObject({
      formula: "v3",
      payerId: "alex",
      recipientId: "sam",
      depositCents: 15_000,
      netCents: 6_000,
      shares: [
        { personId: "alex", partsPerMillion: 600_000 },
        { personId: "sam", partsPerMillion: 400_000 },
      ],
    });
    expect(closed).toMatchObject({ start: null, end: "2026-09-30", closedBy: "alex" });
    expect(closed.deposit).toEqual({ status: "expected", rowId: null });

    await account().paste({ date: "2026-10-02", description: ALEX_BUFFER, amountCents: 15_000 });

    const [after] = await periods(target);
    expect(after?.deposit.status).toBe("matched");
    expect(after?.deposit.rowId).toEqual(expect.any(Number));
    // The deposit is a contribution like any other: the open period now stands
    // exactly at the ratio.
    expect((await open(target)).settlement).toMatchObject({ payerId: null, depositCents: 0 });
  });

  test("a deposit two cents off, or filed to someone else, is not the one expected", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");

    await account().paste({ date: "2026-10-02", description: ALEX_BUFFER, amountCents: 15_002 });

    expect((await periods(target))[0]?.deposit.status).toBe("expected");
  });

  test("a settlement that asked too little is caught up by the next close", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    const history = account();
    await addLine(target, draft("sam", "2026-02-10", 10_000));
    await close(target, null, "2026-03-31");
    // 60 deposited where 150 was asked: what formula v2 would have asked.
    await history.paste({ date: "2026-04-03", description: ALEX_BUFFER, amountCents: 6_000 });
    await addLine(target, draft("sam", "2026-05-03", 5_000));

    const second = await close(target, "2026-04-01", "2026-06-30");

    // 75 for this period, and the 90 left short.
    expect(second.settlement).toMatchObject({ payerId: "alex", depositCents: 16_500 });

    await history.paste({ date: "2026-07-02", description: ALEX_BUFFER, amountCents: 16_500 });

    const [latest, earlier] = await periods(target);
    expect(latest?.deposit.status).toBe("matched");
    // Never made, and asked for again by the second close.
    expect(earlier?.deposit.status).toBe("folded");
    expect((await open(target)).settlement).toMatchObject({ payerId: null, depositCents: 0 });
  });

  test("what was owed before a ratio change carries over as money", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");
    // Even salaries from October: the next close divides by a half.
    await ratio(target, "2026-10-01", 5_000_000, 5_000_000);

    const { settlement } = await open(target);

    // The closed period keeps the ratio it recorded: 60 owed, not 50.
    expect(settlement).toMatchObject({ payerId: "alex", netCents: 6_000, depositCents: 12_000 });
    expect(settlement?.shares[0]?.partsPerMillion).toBe(500_000);
  });

  test("the same period closed twice settles once", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");

    const again = await target.server.inject({
      method: "POST",
      url: ROUTES.periodClose,
      payload: { start: null, end: "2026-10-02" },
    });

    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorResponse>().error.code).toBe("PERIOD_NOT_OPEN");
    expect(await periods(target)).toHaveLength(1);
  });

  test("with no ratio in effect on its last day, nothing is recorded", async () => {
    const target = await start();
    await ratio(target, "2026-10-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));

    const refused = await target.server.inject({
      method: "POST",
      url: ROUTES.periodClose,
      payload: { start: null, end: "2026-09-30" },
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json<ErrorResponse>().error.code).toBe("RATIO_NOT_IN_EFFECT");
    expect(await periods(target)).toEqual([]);
    expect((await open(target, "?end=2026-09-30")).settlement).toBeNull();
  });

  test("a period cannot end after today, or before it starts", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);

    const later = await target.server.inject({
      method: "POST",
      url: ROUTES.periodClose,
      payload: { start: null, end: "2026-10-04" },
    });
    const backwards = await target.server.inject({
      method: "POST",
      url: ROUTES.periodClose,
      payload: { start: "2026-09-01", end: "2026-08-31" },
    });

    expect([later.statusCode, backwards.statusCode]).toEqual([400, 400]);
    expect(await periods(target)).toEqual([]);
  });

  test("the first period's start is the closer's: what is dated before it is left out", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-06-30", 99_999));
    await addLine(target, draft("sam", "2026-07-02", 10_000));

    const view = await open(target, "?start=2026-07-01&end=2026-09-30");
    expect(view).toMatchObject({ start: "2026-07-01", first: true });
    expect(view.lines.map((line) => line.amountCents)).toEqual([10_000]);

    const closed = await close(target, "2026-07-01", "2026-09-30");
    expect(closed.settlement.depositCents).toBe(15_000);
    // After that, the open period starts where this one ended, whatever is asked.
    expect(await open(target, "?start=2020-01-01")).toMatchObject({
      start: "2026-10-01",
      first: false,
    });
  });
});

describe("the open period", () => {
  test("holds each month of a recurring item it spans, across a new year", async () => {
    const target = await start();
    await ratio(target, "2025-01-01", 6_000_000, 4_000_000);
    const item: RecurringItemDraft = {
      personId: "alex",
      monthlyCents: 8_000,
      startDate: "2025-06-10",
      endDate: null,
      label: "Internet",
    };
    await post<RecurringItem>(target, ROUTES.recurring, item);
    await close(target, null, "2025-10-31");

    const view = await open(target, "?end=2026-02-28");

    expect(view.start).toBe("2025-11-01");
    expect(view.lines.map((line) => [line.date, line.amountCents, line.category])).toEqual([
      ["2025-11-10", 8_000, "Internet"],
      ["2025-12-10", 8_000, "Internet"],
      ["2026-01-10", 8_000, "Internet"],
      ["2026-02-10", 8_000, "Internet"],
    ]);
  });

  test("an ended recurring item stops, and the months before keep their lines", async () => {
    const target = await start();
    const item = await post<RecurringItem>(target, ROUTES.recurring, {
      personId: "sam",
      monthlyCents: 2_000,
      startDate: "2026-01-05",
      endDate: null,
      label: "Assurance",
    });

    const ended = await post<RecurringItem>(
      target,
      ROUTES.recurringItem.replace(":id", String(item.id)),
      {
        ...item,
        id: undefined,
        supersedes: undefined,
        enteredAt: undefined,
        enteredBy: undefined,
        endDate: "2026-03-31",
      },
    );

    expect(ended).toMatchObject({ supersedes: item.id, endDate: "2026-03-31" });
    expect((await get<{ items: RecurringItem[] }>(target, ROUTES.recurring)).items).toEqual([
      ended,
    ]);
    const view = await open(target, "?end=2026-09-30");
    expect(view.lines.map((line) => line.date)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
    const versions = target.context.db.prepare("SELECT count(*) AS n FROM recurring_items").get();
    expect(versions).toEqual({ n: 2 });
  });

  test("a recurring item that does not stand cannot be changed", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.recurringItem.replace(":id", "7"),
      payload: {
        personId: "sam",
        monthlyCents: 1,
        startDate: "2026-01-01",
        endDate: null,
        label: "x",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("RECURRING_ITEM_NOT_FOUND");
  });
});

describe("lines", () => {
  test("a correction and a removal each append, and the earlier lines stay", async () => {
    const target = await start();
    const first = await addLine(
      target,
      draft("alex", "2026-09-03", 4_500, { category: "Épicerie" }),
    );

    const corrected = await post<PeriodLine>(
      target,
      ROUTES.periodLine.replace(":id", String(first.id)),
      draft("alex", "2026-09-03", 5_400, { category: "Épicerie" }),
    );
    expect(corrected).toMatchObject({
      supersedes: first.id,
      amountCents: 5_400,
      enteredBy: "alex",
    });
    expect((await open(target)).lines.map((line) => line.amountCents)).toEqual([5_400]);

    await post(target, ROUTES.periodLineRetire.replace(":id", String(corrected.id)), {});

    expect((await open(target)).lines).toEqual([]);
    expect(target.context.db.prepare("SELECT count(*) AS n FROM period_lines").get()).toEqual({
      n: 3,
    });
    const again = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLineRetire.replace(":id", String(first.id)),
      payload: {},
    });
    expect(again.json<ErrorResponse>().error.code).toBe("PERIOD_LINE_NOT_FOUND");
  });

  test("a charge is to the other person, and is settled in full", async () => {
    const target = await start(SAM);
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);

    const own = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLines,
      payload: draft("sam", "2026-09-03", 3_000, { chargedTo: "sam" }),
    });
    expect(own.statusCode).toBe(400);

    const charge = await addLine(
      target,
      draft("sam", "2026-09-03", 3_000, { chargedTo: "alex", note: "alex's book" }),
    );
    expect(charge).toMatchObject({ chargedTo: "alex", enteredBy: "sam" });
    expect((await open(target)).settlement).toMatchObject({
      payerId: "alex",
      netCents: 3_000,
      depositCents: 7_500,
    });
  });

  test("a person who is not one of the household, or an amount of nothing, is refused", async () => {
    const target = await start();

    const stranger = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLines,
      payload: draft("casey", "2026-09-03", 3_000),
    });
    const zero = await target.server.inject({
      method: "POST",
      url: ROUTES.periodLines,
      payload: draft("alex", "2026-09-03", 0),
    });

    expect([stranger.statusCode, zero.statusCode]).toEqual([400, 400]);
    expect(zero.json<ErrorResponse>().error.message).toBe(
      "The line is not valid: check amountCents.",
    );
    expect(target.context.db.prepare("SELECT count(*) AS n FROM period_lines").get()).toEqual({
      n: 0,
    });
  });
});

describe("the day a period is closed", () => {
  test("the open period after it is empty until tomorrow, and still says what is owed", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    // Closed on today's date, by the API's clock: the next period starts tomorrow.
    await close(target, null, "2026-10-03");

    const view = await open(target);

    expect(view).toMatchObject({ start: "2026-10-04", end: "2026-10-03", lines: [] });
    // The deposit is not in yet, and the books say so.
    expect(view.settlement).toMatchObject({ payerId: "alex", depositCents: 15_000 });
    const empty = await target.server.inject({
      method: "POST",
      url: ROUTES.periodClose,
      payload: { start: "2026-10-04", end: "2026-10-03" },
    });
    expect(empty.statusCode).toBe(400);
  });
});

// Gate 1, med 2, through the API.
describe("a deposit of exactly what was asked", () => {
  test("settles the next close at nothing, though the figure did not divide evenly", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    await addLine(target, draft("sam", "2026-09-10", 10_001));
    const asked = await close(target, null, "2026-09-30");
    expect(asked.settlement.depositCents).toBe(15_002);

    await account().paste({ date: "2026-09-30", description: ALEX_BUFFER, amountCents: 15_002 });

    expect((await open(target)).settlement).toMatchObject({
      payerId: null,
      depositCents: 0,
      netCents: 0,
    });
    const next = await close(target, "2026-10-01", "2026-10-03");
    expect(next.settlement).toMatchObject({ payerId: null, depositCents: 0 });
    expect(next.deposit.status).toBe("none");
  });
});

// Gate 1, med 3, the owner's choice (b): a line entered after its period closed
// is listed in the open period as late, so what the next close counts is shown.
/**
 * A clock that moves a second each time it is read, still on 2026-10-03: what
 * is entered after a close is entered later than it, as it is in use.
 */
function ticking(): () => Date {
  let at = Date.parse("2026-10-03T09:30:00.000Z");
  return () => new Date((at += 1_000));
}

describe("a line entered after its period closed", () => {
  test("dated the day of the close, it is listed in the open period as late", async () => {
    const target = await start("alex@example.test", ticking());
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-10-03");

    await addLine(target, draft("sam", "2026-10-03", 4_000, { category: "Épicerie" }));

    const view = await open(target);
    expect(view.lines.map((line) => [line.date, line.amountCents, line.late])).toEqual([
      ["2026-10-03", 4_000, true],
    ]);
    expect(view.settlement?.depositCents).toBe(21_000);
  });

  test("dated well inside the closed period, it is listed too, and counted once", async () => {
    const target = await start("alex@example.test", ticking());
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");

    await addLine(target, draft("sam", "2026-09-15", 5_000));
    await addLine(target, draft("alex", "2026-10-02", 1_000));

    const view = await open(target);
    expect(view.lines.map((line) => [line.date, line.personId, line.late])).toEqual([
      ["2026-09-15", "sam", true],
      ["2026-10-02", "alex", false],
    ]);
    // 150 + 75 for sam's two, less alex's 10: counted once each.
    expect(view.settlement?.depositCents).toBe(21_500);
  });

  test("a line on time, corrected after the close, is not listed as late", async () => {
    const target = await start("alex@example.test", ticking());
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    const first = await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");

    await post(
      target,
      ROUTES.periodLine.replace(":id", String(first.id)),
      draft("sam", "2026-09-10", 12_000),
    );

    expect((await open(target)).lines).toEqual([]);
  });

  test("a recurring item added after a close lists its months in that period as late", async () => {
    const target = await start("alex@example.test", ticking());
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    const onTime = await post<RecurringItem>(target, ROUTES.recurring, {
      personId: "alex",
      monthlyCents: 2_000,
      startDate: "2026-08-05",
      endDate: null,
      label: "Assurance",
    });
    await close(target, null, "2026-09-30");

    await post(target, ROUTES.recurring, {
      personId: "sam",
      monthlyCents: 8_000,
      startDate: "2026-09-10",
      endDate: null,
      label: "Internet",
    });
    // Ending the item that was on time files a new version: its months stay on time.
    await post(target, ROUTES.recurringItem.replace(":id", String(onTime.id)), {
      personId: "alex",
      monthlyCents: 2_000,
      startDate: "2026-08-05",
      endDate: "2026-10-31",
      label: "Assurance",
    });

    const view = await open(target, "?end=2026-10-31");
    expect(view.lines.map((line) => [line.date, line.category, line.late])).toEqual([
      ["2026-09-10", "Internet", true],
      ["2026-10-05", "Assurance", false],
      ["2026-10-10", "Internet", false],
    ]);
  });
});

// Gate 1, med 4: only a row filed to a person in the buffer is a contribution,
// or a settlement's deposit (Build 3, Build 5's "same bucket").
describe("what is not a deposit into the buffer", () => {
  test("the same amount into the mortgage bucket, and a joint payment out of the buffer", async () => {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addRule(target, {
      descriptionPattern: "Virement entre folios /Caisse du Mont",
      category: null,
      amountCents: null,
      personId: "alex",
      bucket: "mortgage",
    });
    await addRule(target, {
      descriptionPattern: "Taxes /Ville Exemple",
      category: null,
      amountCents: null,
      personId: null,
      bucket: "current-expenses",
    });
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");

    const history = account();
    await history.paste({
      date: "2026-10-01",
      description: "Virement entre folios /Caisse du Mont",
      amountCents: 15_000,
    });
    await history.paste({
      date: "2026-10-02",
      description: "Taxes /Ville Exemple",
      amountCents: -8_000,
    });

    const [closed] = await periods(target);
    expect(closed?.deposit).toEqual({ status: "expected", rowId: null });
    // Still the 150.00 asked: neither row moved the settlement.
    expect((await open(target)).settlement).toMatchObject({
      payerId: "alex",
      depositCents: 15_000,
    });
  });
});

// Gate 1, low 7: the open period lists nothing dated after its chosen last day.
describe("the open period's last day", () => {
  test("a line dated after it is not listed", async () => {
    const target = await start();
    await addLine(target, draft("sam", "2026-09-10", 1_000));
    await addLine(target, draft("sam", "2026-09-21", 2_000));

    const view = await open(target, "?end=2026-09-20");

    expect(view.lines.map((line) => line.date)).toEqual(["2026-09-10"]);
  });
});

// Gate 2, med 5: a late line leaves the list once a close has counted it.
describe("a late line, after the next close", () => {
  test("is no longer listed: that close counted it", async () => {
    const target = await start("alex@example.test", ticking());
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");
    await addLine(target, draft("sam", "2026-09-15", 5_000));

    const before = await open(target);
    expect(before.lines.map((line) => [line.date, line.late])).toEqual([["2026-09-15", true]]);
    expect(before.settlement?.depositCents).toBe(22_500);

    const second = await close(target, "2026-10-01", "2026-10-03");
    expect(second.settlement.depositCents).toBe(22_500);

    expect((await open(target)).lines).toEqual([]);
    expect((await open(target, "?end=2026-10-20")).lines).toEqual([]);
  });
});

// lg-13: the deposit that settles a closed period is weighed at that period's
// ratio, so paying what was asked settles it when the ratio changes after it.
describe("a settlement's deposit, when the ratio changes after its period", () => {
  async function closedThenRatio(alex: number, sam: number): Promise<App> {
    const target = await start();
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    const closed = await close(target, null, "2026-09-30");
    expect(closed.settlement).toMatchObject({ payerId: "alex", depositCents: 15_000 });
    await ratio(target, "2026-10-01", alex, sam);
    return target;
  }

  test.each([
    [6_000_000, 4_000_000, 600_000],
    [5_000_000, 5_000_000, 500_000],
    [7_000_000, 3_000_000, 700_000],
  ])(
    "paid exactly and matched, the open period owes nothing (salaries %i and %i)",
    async (alex, sam, share) => {
      const target = await closedThenRatio(alex, sam);

      await account().paste({ date: "2026-10-02", description: ALEX_BUFFER, amountCents: 15_000 });

      expect((await periods(target))[0]?.deposit.status).toBe("matched");
      const { settlement } = await open(target);
      expect(settlement?.shares[0]?.partsPerMillion).toBe(share);
      expect(settlement).toMatchObject({ payerId: null, depositCents: 0, netCents: 0 });
    },
  );

  test("paid short, it is not matched and is weighed by its date", async () => {
    const target = await closedThenRatio(5_000_000, 5_000_000);

    await account().paste({ date: "2026-10-02", description: ALEX_BUFFER, amountCents: 9_000 });

    expect((await periods(target))[0]?.deposit.status).toBe("expected");
    expect((await open(target)).settlement).toMatchObject({
      payerId: "alex",
      depositCents: 3_000,
      netCents: 1_500,
    });
  });

  test("with two closed periods, it is weighed at the period it settles, not the latest closed", async () => {
    const target = await start(undefined, () => new Date("2026-11-03T09:30:00Z"));
    await ratio(target, "2026-01-01", 6_000_000, 4_000_000);
    await withBufferRule(target);
    await addLine(target, draft("sam", "2026-09-10", 10_000));
    await close(target, null, "2026-09-30");
    await ratio(target, "2026-10-01", 5_000_000, 5_000_000);
    await addLine(target, draft("sam", "2026-10-10", 5_000));
    await close(target, "2026-10-01", "2026-10-31");
    await ratio(target, "2026-11-01", 7_000_000, 3_000_000);

    // Period 1 asked 150.00 and is paid after period 2 closed. Weighed at
    // period 1's 0.6 it leaves 25.00 owed, divided by the new 0.3; weighed at
    // period 2's 0.5 it would leave 10.00, and 33.33 asked.
    await account().paste({ date: "2026-11-02", description: ALEX_BUFFER, amountCents: 15_000 });

    // Newest first: period 2's own ask is a different figure and is unpaid.
    const closed = await periods(target);
    expect(closed.map((period) => period.deposit.status)).toEqual(["expected", "matched"]);
    expect((await open(target)).settlement).toMatchObject({
      payerId: "alex",
      depositCents: 8_333,
      netCents: 2_500,
    });
  });
});
