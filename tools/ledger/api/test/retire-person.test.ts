/**
 * Retiring a person from the books at the next close (lg-35): an admin records
 * it in the directory once no address stands under the person, the next close
 * copies it into the books from the day after it, and from then on the ratio,
 * the screens' people and the mortgage's joint rows leave them out — while the
 * history keeps them. A return brings them back the same way. Who may call the
 * route at all is `authority.test.ts`; its limiter is `route-limits.test.ts`.
 * Every name, address, salary and amount is invented.
 */

import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  AdminHouseholdsResponse,
  AdminPerson,
  BucketsResponse,
  ClosedPeriod,
  ContributionsResponse,
  ErrorResponse,
  MortgageOwnResponse,
  PeopleResponse,
  RuleDraft,
  SalaryEntryResponse,
  SettlementsStatsResponse,
} from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import type { Directory } from "../src/directory.ts";
import type { App } from "../src/server.ts";
import { ADMIN, ALEX, HOUSEHOLD, SAM, homeBooks, memberDirectory } from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";
import { send, startHouseholds } from "./helpers/households.ts";
import type { Harness } from "./helpers/households.ts";

const CASEY = "casey@example.test";
const RETIRE = ROUTES.adminPersonRetire.replace(":id", HOUSEHOLD);
const REMOVE = ROUTES.adminMemberRemove.replace(":id", HOUSEHOLD);

const ALEX_MORTGAGE = "Virement entre folios /Caisse du Mont";
const SAM_MORTGAGE = "Virement entre folios /Caisse du Lac";
const CASEY_MORTGAGE = "Virement entre folios /Caisse du Val";
const PAYMENT = "Hypothèque /Prêteur Exemple";

/** Each of the three puts 300.00 in, and a payment goes out before casey leaves and one after. */
const ROWS: PasteRow[] = [
  { date: "2026-03-02", description: ALEX_MORTGAGE, amountCents: 30_000 },
  { date: "2026-03-02", description: SAM_MORTGAGE, amountCents: 30_000 },
  { date: "2026-03-02", description: CASEY_MORTGAGE, amountCents: 30_000 },
  {
    date: "2026-03-15",
    category: "Loyer/Prêt hypothécaire",
    description: PAYMENT,
    amountCents: -30_001,
  },
  {
    date: "2026-04-15",
    category: "Loyer/Prêt hypothécaire",
    description: PAYMENT,
    amountCents: -20_001,
  },
];

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.shutdown();
  harness = undefined;
});

function rule(descriptionPattern: string, personId: string | null): RuleDraft {
  return {
    descriptionPattern,
    category: null,
    amountCents: null,
    personId,
    bucket: "mortgage",
    spendingCategoryId: null,
  };
}

async function ok<T>(
  app: App,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await send(app, ALEX, method, url, payload);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<T>();
}

/** home holds alex, sam and casey, with the mortgage's rows filed; the admin is in no household. */
async function start(): Promise<Harness> {
  harness = await startHouseholds(
    memberDirectory([
      [ALEX, "alex"],
      [SAM, "sam"],
      [CASEY, "casey"],
    ]),
  );
  const { app } = harness;
  await ok(app, "POST", ROUTES.rules, { ...rule(ALEX_MORTGAGE, "alex") });
  await ok(app, "POST", ROUTES.rules, { ...rule(SAM_MORTGAGE, "sam") });
  await ok(app, "POST", ROUTES.rules, { ...rule(CASEY_MORTGAGE, "casey") });
  await ok(app, "POST", ROUTES.rules, { ...rule(PAYMENT, null) });
  await ok(app, "POST", ROUTES.statements, { text: renderPaste(withBalances(ROWS, 100_000)) });
  return harness;
}

/** Enters a year's salaries for `salaries`' people and confirms the ratio from `effectiveFrom`. */
async function confirm(app: App, effectiveFrom: string, salaries: Record<string, number>) {
  const entered = await ok<SalaryEntryResponse>(app, "POST", ROUTES.salaries, {
    year: Number(effectiveFrom.slice(0, 4)),
    salaries: Object.entries(salaries).map(([personId, amountCents]) => ({
      personId,
      amountCents,
    })),
  });
  const named = new Set(Object.keys(salaries));
  return await send(app, ALEX, "POST", ROUTES.ratios, {
    effectiveFrom,
    salaryIds: entered.salaries
      .filter((salary) => named.has(salary.personId))
      .map((salary) => salary.id),
  });
}

async function close(app: App, from: string | null, end: string) {
  return await send(app, ALEX, "POST", ROUTES.periodClose, { start: from, end });
}

async function standing(app: App, person: string): Promise<AdminPerson | undefined> {
  const listing = (
    await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
  ).json<AdminHouseholdsResponse>();
  return listing.households
    .find((household) => household.id === HOUSEHOLD)
    ?.people.find((one) => one.person === person);
}

/** casey's address removed and casey retired, as the admin does it. */
async function retireCasey(app: App): Promise<AdminPerson> {
  const removed = await send(app, ADMIN, "POST", REMOVE, { address: CASEY });
  expect(removed.statusCode, removed.body).toBe(200);
  const retired = await send(app, ADMIN, "POST", RETIRE, { person: "casey", action: "retire" });
  expect(retired.statusCode, retired.body).toBe(200);
  return retired.json<AdminPerson>();
}

/** The ratio for all three from 2026-01-01, casey's 90.00 on a card in March, and casey retired. */
async function retiredDuringTheFirstPeriod(app: App): Promise<void> {
  expect(
    (await confirm(app, "2026-01-01", { alex: 4_000_000, sam: 4_000_000, casey: 2_000_000 }))
      .statusCode,
  ).toBe(200);
  await ok(app, "POST", ROUTES.periodLines, {
    personId: "casey",
    date: "2026-03-10",
    amountCents: 9_000,
    category: null,
    spendingCategoryId: null,
    note: null,
    chargedTo: null,
  });
  expect(await retireCasey(app)).toEqual({ person: "casey", name: "casey", standing: "retiring" });
}

function retirements(app: App): unknown[] {
  return homeBooks(app)
    .prepare("SELECT person_id, action, from_date, period_id FROM people_retirements ORDER BY id")
    .all();
}

describe("the directory's retirements", () => {
  // Done when 1.
  function directory(): Directory {
    return memberDirectory([
      [ALEX, "alex"],
      [CASEY, "casey"],
    ]);
  }
  const at = { by: ADMIN, at: new Date("2026-10-13T12:00:00Z") };

  test("a retire is refused while an address stands under the person, and taken once it is removed", () => {
    const held = directory();
    try {
      expect(() =>
        held.retirePerson({ household: HOUSEHOLD, person: "casey", action: "retire", ...at }),
      ).toThrow(/Remove every address under casey first/u);
      expect(held.retirements(HOUSEHOLD)).toEqual([]);

      held.removeMember({ address: CASEY, household: HOUSEHOLD, ...at });

      expect(
        held.retirePerson({ household: HOUSEHOLD, person: "casey", action: "retire", ...at }),
      ).toEqual({ person: "casey", standing: "retiring" });
      expect(held.retirements(HOUSEHOLD)).toMatchObject([{ person: "casey", action: "retire" }]);
    } finally {
      held.close();
    }
  });

  test("the schema refuses the same, and an UPDATE, a DELETE and an INSERT OR REPLACE", () => {
    const db = new Database(":memory:");
    try {
      migrateDirectory(db);
      db.exec(`
        INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
        INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
          VALUES ('casey@example.test', 'home', 'casey', 'add', 'x', 'operator');
      `);
      const insert = db.prepare(
        "INSERT INTO retirements (household_id, person, action, recorded_at, recorded_by) VALUES ('home', ?, ?, 'x', 'raw')",
      );

      expect(() => insert.run("casey", "retire")).toThrow(/no address stands/u);
      db.exec(
        "INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by) VALUES ('casey@example.test', 'home', 'casey', 'remove', 'x', 'operator')",
      );
      expect(() => insert.run("casey", "return")).toThrow(/changes the person's state/u);
      expect(() => insert.run("nobody", "retire")).toThrow(/held/u);
      const id = Number(insert.run("casey", "retire").lastInsertRowid);
      expect(() => insert.run("casey", "retire")).toThrow(/changes the person's state/u);

      expect(() => db.exec("UPDATE retirements SET action = 'return'")).toThrow(/never edited/u);
      expect(() => db.exec("DELETE FROM retirements")).toThrow(/never deleted/u);
      expect(() =>
        db.exec(
          `INSERT OR REPLACE INTO retirements (id, household_id, person, action, recorded_at, recorded_by) VALUES (${String(id)}, 'home', 'casey', 'return', 'x', 'raw')`,
        ),
      ).toThrow(/never replaced/u);
      db.exec(
        `INSERT INTO retirements_applied (retirement_id, from_date, applied_at) VALUES (${String(id)}, '2026-04-01', 'x')`,
      );
      expect(() => db.exec("UPDATE retirements_applied SET from_date = 'y'")).toThrow(
        /never edited/u,
      );
      expect(() => db.exec("DELETE FROM retirements_applied")).toThrow(/never deleted/u);
      expect(() =>
        db.exec(
          `INSERT OR REPLACE INTO retirements_applied (retirement_id, from_date, applied_at) VALUES (${String(id)}, '2026-05-01', 'x')`,
        ),
      ).toThrow(/never replaced/u);
      expect(db.prepare("SELECT action FROM retirements").all()).toEqual([{ action: "retire" }]);
    } finally {
      db.close();
    }
  });
});

describe("the route", () => {
  test("refuses a person the household never held, and a request that changes nothing", async () => {
    const { app } = await start();

    const nobody = await send(app, ADMIN, "POST", RETIRE, { person: "robin", action: "retire" });
    expect(nobody.statusCode).toBe(404);
    expect(nobody.json<ErrorResponse>().error.code).toBe("PERSON_NOT_FOUND");
    const signedIn = await send(app, ADMIN, "POST", RETIRE, { person: "casey", action: "retire" });
    expect(signedIn.statusCode).toBe(400);
    const notRetired = await send(app, ADMIN, "POST", RETIRE, { person: "sam", action: "return" });
    expect(notRetired.statusCode).toBe(400);

    await retireCasey(app);
    const twice = await send(app, ADMIN, "POST", RETIRE, { person: "casey", action: "retire" });
    expect(twice.statusCode).toBe(400);
    // A return before any close undoes it: the close applies both, and casey stays in.
    const undone = await send(app, ADMIN, "POST", RETIRE, { person: "casey", action: "return" });
    expect(undone.json<AdminPerson>()).toEqual({ person: "casey", name: "casey", standing: "in" });
  });
});

describe("a person retired while a period is open", () => {
  // Done when 2.
  test("takes part in its settlement, and from the day after its close is no longer offered", async () => {
    const { app } = await start();
    await retiredDuringTheFirstPeriod(app);
    // Still offered until the close: the retirement waits for it.
    expect((await ok<PeopleResponse>(app, "GET", ROUTES.people)).people).toContain("casey");
    expect(retirements(app)).toEqual([]);

    const closed = await close(app, null, "2026-03-31");

    expect(closed.statusCode, closed.body).toBe(200);
    const settled = closed.json<ClosedPeriod>();
    expect(settled.settlement.shares.map((share) => share.personId)).toEqual([
      "alex",
      "casey",
      "sam",
    ]);
    // casey's 90.00 on a card is owed back to them: the settlement names them.
    expect(JSON.stringify(settled.settlement)).toContain('"casey"');
    expect(retirements(app)).toEqual([
      { person_id: "casey", action: "retire", from_date: "2026-04-01", period_id: settled.id },
    ]);
    expect(await ok<PeopleResponse>(app, "GET", ROUTES.people)).toEqual({
      people: ["alex", "sam"],
      retired: ["casey"],
      names: { alex: "alex", casey: "casey", sam: "sam" },
    });
    expect((await standing(app, "casey"))?.standing).toBe("retired");
  });
});

describe("after the close that retired them", () => {
  // Done when 3, and Build 4's refused close.
  test("a ratio from from_date naming them is refused, the period is not closed at the old one, and one without them is confirmed", async () => {
    const { app } = await start();
    await retiredDuringTheFirstPeriod(app);
    expect((await close(app, null, "2026-03-31")).statusCode).toBe(200);

    const withCasey = await confirm(app, "2026-04-01", {
      alex: 4_000_000,
      sam: 4_000_000,
      casey: 2_000_000,
    });
    expect(withCasey.statusCode).toBe(409);
    expect(JSON.parse(withCasey.body) as ErrorResponse).toMatchObject({
      error: { code: "PERSON_RETIRED" },
    });
    // The ratio from January still names casey, and is never changed for the household.
    const atTheOld = await close(app, "2026-04-01", "2026-04-30");
    expect(atTheOld.statusCode).toBe(409);
    expect(atTheOld.json<ErrorResponse>().error.code).toBe("PERSON_RETIRED");

    const without = await confirm(app, "2026-04-01", { alex: 5_000_000, sam: 5_000_000 });

    expect(without.statusCode, without.body).toBe(200);
    expect((await close(app, "2026-04-01", "2026-04-30")).statusCode).toBe(200);
  });

  // Done when 4.
  test("a joint mortgage row dated on or after from_date gives them no share; one before still does", async () => {
    const { app } = await start();
    await retiredDuringTheFirstPeriod(app);
    const before = await ok<BucketsResponse>(app, "GET", `${ROUTES.buckets}?asOf=2026-04-30`);
    // Before the close, both payments in thirds between all three.
    expect(before.mortgage.own.map((one) => one.ownCents)).toEqual([
      30_000 - 10_001 - 6_667,
      30_000 - 10_000 - 6_667,
      30_000 - 10_000 - 6_667,
    ]);

    expect((await close(app, null, "2026-03-31")).statusCode).toBe(200);

    const after = await ok<BucketsResponse>(app, "GET", `${ROUTES.buckets}?asOf=2026-04-30`);
    // March's 300.01 in thirds, its odd cent to alex; April's 200.01 in halves,
    // between alex and sam, its odd cent to alex too.
    expect(after.mortgage.own).toEqual([
      { personId: "alex", ownCents: 30_000 - 10_001 - 10_001 },
      { personId: "casey", ownCents: 30_000 - 10_000 },
      { personId: "sam", ownCents: 30_000 - 10_000 - 10_000 },
    ]);
    expect(after.mortgage.balanceCents).toBe(90_000 - 30_001 - 20_001);
    // The chart agrees with the home screen on the same day.
    const series = await ok<MortgageOwnResponse>(app, "GET", ROUTES.statsMortgageOwn);
    expect(series.points.at(-1)?.own).toEqual(after.mortgage.own);
  });
});

describe("a return recorded after the retirement", () => {
  // Done when 5.
  test("brings them back from the next close after it, and the stats list them in every period they were in", async () => {
    const { app } = await start();
    await retiredDuringTheFirstPeriod(app);
    expect((await close(app, null, "2026-03-31")).statusCode).toBe(200);
    expect((await confirm(app, "2026-04-01", { alex: 5_000_000, sam: 5_000_000 })).statusCode).toBe(
      200,
    );

    const back = await send(app, ADMIN, "POST", RETIRE, { person: "casey", action: "return" });

    expect(back.json<AdminPerson>().standing).toBe("returning");
    // Not back inside the open period: a ratio from it naming casey is still refused.
    expect((await ok<PeopleResponse>(app, "GET", ROUTES.people)).retired).toEqual(["casey"]);
    const second = await close(app, "2026-04-01", "2026-04-30");
    expect(second.statusCode, second.body).toBe(200);
    expect(retirements(app)).toMatchObject([
      { person_id: "casey", action: "retire", from_date: "2026-04-01" },
      { person_id: "casey", action: "return", from_date: "2026-05-01" },
    ]);
    expect((await ok<PeopleResponse>(app, "GET", ROUTES.people)).people).toEqual([
      "alex",
      "casey",
      "sam",
    ]);
    expect((await standing(app, "casey"))?.standing).toBe("in");
    expect(
      (await confirm(app, "2026-05-01", { alex: 4_000_000, sam: 4_000_000, casey: 2_000_000 }))
        .statusCode,
    ).toBe(200);
    expect((await close(app, "2026-05-01", "2026-05-31")).statusCode).toBe(200);

    const settlements = await ok<SettlementsStatsResponse>(app, "GET", ROUTES.statsSettlements);

    expect(
      settlements.periods.map((period) => [
        period.end,
        period.settlement.shares.map((share) => share.personId),
      ]),
    ).toEqual([
      ["2026-03-31", ["alex", "casey", "sam"]],
      ["2026-04-30", ["alex", "sam"]],
      ["2026-05-31", ["alex", "casey", "sam"]],
    ]);
    // The whole history's series name casey throughout, retired stretch included.
    const contributions = await ok<ContributionsResponse>(app, "GET", ROUTES.statsContributions);
    expect(contributions.people).toEqual(["alex", "casey", "sam"]);
    // Back from 2026-05-01: casey's April has no share of the April payment, and
    // the books say so to anyone reading them without the directory.
    expect(
      (await ok<BucketsResponse>(app, "GET", `${ROUTES.buckets}?asOf=2026-05-31`)).mortgage.own,
    ).toContainEqual({ personId: "casey", ownCents: 30_000 - 10_000 });
  });
});

describe("the directory's echo of a close", () => {
  test("is written for every request the books applied, so one a close failed to write is mended by the next", async () => {
    const { app, directory } = await start();
    await retiredDuringTheFirstPeriod(app);
    const echo = vi.spyOn(directory, "markApplied").mockImplementationOnce(() => {
      throw new Error("the directory is locked");
    });

    // The close stands though its echo failed: the books are the record.
    expect((await close(app, null, "2026-03-31")).statusCode).toBe(200);
    expect(retirements(app)).toHaveLength(1);
    expect((await ok<PeopleResponse>(app, "GET", ROUTES.people)).retired).toEqual(["casey"]);
    expect((await standing(app, "casey"))?.standing).toBe("retiring");

    expect((await confirm(app, "2026-04-01", { alex: 5_000_000, sam: 5_000_000 })).statusCode).toBe(
      200,
    );
    expect((await close(app, "2026-04-01", "2026-04-30")).statusCode).toBe(200);

    expect(echo).toHaveBeenCalledTimes(2);
    expect(retirements(app)).toHaveLength(1);
    expect((await standing(app, "casey"))?.standing).toBe("retired");
  });
});
