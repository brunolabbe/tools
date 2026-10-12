/**
 * The isolation sweep (lg-21): two households, each with books of its own,
 * write through every write route, and then each reads through every read
 * route and finds its own records and nothing of the other's.
 *
 * Both households have a person called alex, so nothing here leans on names
 * being different. What tells them apart is what each one wrote: home writes
 * "Maison" and sam, away writes "Chalet" and kim, and each writes amounts the
 * other never does.
 *
 * The tables below walk `ROUTES` the way `route-limits.test.ts` does: the first
 * test fails when a route the app answers is in neither table, so a route
 * added later cannot be left out of the sweep.
 */

import { describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ClassificationRecord,
  PeriodLine,
  RecurringItem,
  Rule,
  RowsResponse,
  SalaryEntryResponse,
  SpendingCategory,
} from "@ledger/contract";
import type { Directory } from "../src/directory.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import {
  HOUSEHOLD,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-09-30T12:00:00Z");
const CHANGE = { by: "operator", at: NOW };

type RouteName = keyof typeof ROUTES;
type Method = "GET" | "POST";

/** A household, what it writes, and how its writes and reads are told apart from the other's. */
interface Household {
  id: string;
  /** The address its alex signs in with. */
  caller: string;
  /** Its second person, whose name the other household never uses. */
  other: string;
  /** The word every text it writes carries. */
  word: string;
  /** Cents, distinct per household, so a figure that crosses over is seen. */
  mortgageCents: number;
  transferCents: number;
  salaryCents: number;
  lineCents: number;
  monthlyCents: number;
}

const HOME: Household = {
  id: HOUSEHOLD,
  caller: "alex@example.test",
  other: "sam",
  word: "Maison",
  mortgageCents: 71_113,
  transferCents: 41_117,
  salaryCents: 6_111_300,
  lineCents: 3_119,
  monthlyCents: 4_113,
};

const AWAY: Household = {
  id: "away",
  caller: "alex@away.test",
  other: "kim",
  word: "Chalet",
  mortgageCents: 72_227,
  transferCents: 42_229,
  salaryCents: 5_222_700,
  lineCents: 2_227,
  monthlyCents: 3_227,
};

/** What a body must not hold when it was read by the other household: its marks. */
function marks(household: Household): string[] {
  return [
    household.word,
    household.other,
    household.caller,
    `"${household.id}"`,
    String(household.mortgageCents),
    String(household.transferCents),
    String(household.salaryCents),
    String(household.lineCents),
    String(household.monthlyCents),
  ];
}

/** The rows a household pastes, oldest first: the last two arrive in a second paste. */
function statementRows(household: Household): PasteRow[] {
  const { word } = household;
  const transfer = `Virement /${word} Caisse`;
  return [
    {
      date: "2026-07-02",
      category: `${word} Virements`,
      description: transfer,
      amountCents: household.transferCents,
    },
    {
      date: "2026-07-12",
      category: "Loyer/Prêt hypothécaire",
      description: `Hypothèque /${word} Prêteur`,
      amountCents: -household.mortgageCents,
    },
    {
      date: "2026-07-20",
      category: `${word} Épicerie`,
      description: `Achat /${word} Marché`,
      amountCents: -12_345,
    },
    {
      date: "2026-08-02",
      category: `${word} Virements`,
      description: transfer,
      amountCents: household.transferCents,
    },
    {
      date: "2026-08-12",
      category: "Loyer/Prêt hypothécaire",
      description: `Hypothèque /${word} Prêteur`,
      amountCents: -household.mortgageCents,
    },
    {
      date: "2026-09-02",
      category: `${word} Virements`,
      description: transfer,
      amountCents: household.transferCents,
    },
    // The second paste: history files this one by itself (lg-17), and the
    // next one waits in the inbox.
    {
      date: "2026-09-16",
      category: `${word} Virements`,
      description: transfer,
      amountCents: household.transferCents,
    },
    {
      date: "2026-09-20",
      category: `${word} Divers`,
      description: `Inconnu /${word} Boutique`,
      amountCents: -6_789,
    },
  ];
}

function paste(household: Household, from: number, to?: number): string {
  return renderPaste(withBalances(statementRows(household), 1_000_000).slice(from, to));
}

/** Two households, each with alex and one other, in one directory. */
function twoHouseholds(): Directory {
  const directory = memberDirectory([
    [HOME.caller, "alex"],
    [`${HOME.other}@example.test`, HOME.other],
  ]);
  directory.addHousehold({ id: AWAY.id, name: "The other household", ...CHANGE });
  directory.addMember({ household: AWAY.id, address: AWAY.caller, person: "alex", ...CHANGE });
  directory.addMember({
    household: AWAY.id,
    address: `${AWAY.other}@away.test`,
    person: AWAY.other,
    ...CHANGE,
  });
  return directory;
}

async function start(): Promise<App> {
  return await createApp({
    directory: twoHouseholds(),
    config: {
      dataDir: ":memory:",
      access: accessConfig(),
      // The sweep makes more requests a minute than a person does.
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
    },
    logger: createLogger({ level: "silent" }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
  });
}

async function call(
  app: App,
  household: Household,
  method: Method,
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: string }> {
  const response = await app.server.inject({
    method,
    url,
    headers: {
      "cf-access-jwt-assertion": signToken({
        key: KEY,
        nowSec: Math.floor(NOW.getTime() / 1000),
        claims: { email: household.caller },
      }),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return { status: response.statusCode, body: response.body };
}

/** What a household's writes left, for the writes after them. */
interface Written {
  categoryId?: number;
  ruleId?: number;
  salaryIds?: number[];
  recurringId?: number;
  lineId?: number;
}

interface Write {
  route: RouteName;
  run(app: App, household: Household, written: Written): Promise<void>;
}

async function post<T>(
  app: App,
  household: Household,
  url: string,
  payload: unknown,
  route: string,
): Promise<T> {
  const response = await call(app, household, "POST", url, payload);
  expect(response.status, `${household.id} POST ${route}: ${response.body}`).toBe(200);
  return JSON.parse(response.body) as T;
}

async function rowIdOf(app: App, household: Household, description: string): Promise<number[]> {
  const response = await call(app, household, "GET", ROUTES.rows);
  const rows = (JSON.parse(response.body) as RowsResponse).rows;
  return rows.filter((row) => row.description === description).map((row) => row.id);
}

/** Every write route, in an order each one's prerequisites are met in. */
const WRITES: Write[] = [
  {
    route: "spendingCategories",
    async run(app, h, written) {
      const category = await post<SpendingCategory>(
        app,
        h,
        ROUTES.spendingCategories,
        { name: `${h.word} épicerie` },
        this.route,
      );
      written.categoryId = category.id;
    },
  },
  {
    route: "spendingCategoryRetire",
    async run(app, h) {
      const doomed = await post<SpendingCategory>(
        app,
        h,
        ROUTES.spendingCategories,
        { name: `${h.word} retirée` },
        "spendingCategories",
      );
      await post(
        app,
        h,
        ROUTES.spendingCategoryRetire.replace(":id", String(doomed.id)),
        {},
        this.route,
      );
    },
  },
  {
    route: "spendingCategory",
    async run(app, h, written) {
      const url = ROUTES.spendingCategory.replace(":id", String(written.categoryId));
      await post(app, h, url, { name: `${h.word} épicerie fine` }, this.route);
    },
  },
  {
    route: "rules",
    async run(app, h, written) {
      const rule = await post<Rule>(
        app,
        h,
        ROUTES.rules,
        {
          descriptionPattern: `Hypothèque /${h.word}*`,
          category: null,
          amountCents: null,
          personId: null,
          bucket: "mortgage",
          spendingCategoryId: written.categoryId ?? null,
        },
        this.route,
      );
      written.ruleId = rule.id;
    },
  },
  {
    route: "rule",
    async run(app, h, written) {
      const url = ROUTES.rule.replace(":id", String(written.ruleId));
      const edited = await post<Rule>(
        app,
        h,
        url,
        {
          descriptionPattern: `Hypothèque /${h.word} Prêteur`,
          category: null,
          amountCents: null,
          personId: null,
          bucket: "mortgage",
          spendingCategoryId: written.categoryId ?? null,
        },
        this.route,
      );
      written.ruleId = edited.id;
    },
  },
  {
    route: "ruleRetire",
    async run(app, h) {
      const doomed = await post<Rule>(
        app,
        h,
        ROUTES.rules,
        {
          descriptionPattern: `${h.word} retiré*`,
          category: null,
          amountCents: null,
          personId: h.other,
          bucket: "current-expenses",
          spendingCategoryId: null,
        },
        "rules",
      );
      await post(app, h, ROUTES.ruleRetire.replace(":id", String(doomed.id)), {}, this.route);
    },
  },
  {
    route: "statements",
    async run(app, h) {
      await post(app, h, ROUTES.statements, { text: paste(h, 0, 6) }, this.route);
    },
  },
  {
    route: "classifications",
    async run(app, h) {
      for (const rowId of await rowIdOf(app, h, `Virement /${h.word} Caisse`)) {
        await post<ClassificationRecord>(
          app,
          h,
          ROUTES.classifications,
          { rowId, personId: h.other, bucket: "mortgage" },
          this.route,
        );
      }
      const [grocery] = await rowIdOf(app, h, `Achat /${h.word} Marché`);
      await post(
        app,
        h,
        ROUTES.classifications,
        { rowId: grocery, personId: h.other, bucket: "current-expenses" },
        this.route,
      );
      // The second paste, now that history has three answers to file from.
      await post(app, h, ROUTES.statements, { text: paste(h, 6) }, "statements");
    },
  },
  {
    route: "spendingCategoryMap",
    async run(app, h, written) {
      await post(
        app,
        h,
        ROUTES.spendingCategoryMap,
        { desjardinsCategory: `${h.word} Épicerie`, spendingCategoryId: written.categoryId },
        this.route,
      );
    },
  },
  {
    route: "spendingCategoryOverrides",
    async run(app, h, written) {
      const [grocery] = await rowIdOf(app, h, `Achat /${h.word} Marché`);
      await post(
        app,
        h,
        ROUTES.spendingCategoryOverrides,
        { rowId: grocery, spendingCategoryId: written.categoryId },
        this.route,
      );
    },
  },
  {
    route: "salaries",
    async run(app, h, written) {
      const entered = await post<SalaryEntryResponse>(
        app,
        h,
        ROUTES.salaries,
        {
          year: 2026,
          salaries: [
            { personId: "alex", amountCents: 6_000_000 },
            { personId: h.other, amountCents: h.salaryCents },
          ],
        },
        this.route,
      );
      written.salaryIds = entered.salaries.map((salary) => salary.id);
    },
  },
  {
    route: "ratios",
    async run(app, h, written) {
      await post(
        app,
        h,
        ROUTES.ratios,
        { effectiveFrom: "2026-01-01", salaryIds: written.salaryIds },
        this.route,
      );
    },
  },
  {
    route: "recurring",
    async run(app, h, written) {
      const item = await post<RecurringItem>(
        app,
        h,
        ROUTES.recurring,
        {
          personId: h.other,
          monthlyCents: h.monthlyCents,
          startDate: "2026-07-05",
          endDate: null,
          label: `${h.word} assurance`,
        },
        this.route,
      );
      written.recurringId = item.id;
    },
  },
  {
    route: "recurringItem",
    async run(app, h, written) {
      await post(
        app,
        h,
        ROUTES.recurringItem.replace(":id", String(written.recurringId)),
        {
          personId: h.other,
          monthlyCents: h.monthlyCents,
          startDate: "2026-07-05",
          endDate: null,
          label: `${h.word} assurance auto`,
        },
        this.route,
      );
    },
  },
  {
    route: "periodLines",
    async run(app, h, written) {
      const line = await post<PeriodLine>(
        app,
        h,
        ROUTES.periodLines,
        lineDraft(h, "2026-08-10", written),
        this.route,
      );
      written.lineId = line.id;
    },
  },
  {
    route: "periodLine",
    async run(app, h, written) {
      const url = ROUTES.periodLine.replace(":id", String(written.lineId));
      await post(
        app,
        h,
        url,
        { ...lineDraft(h, "2026-08-11", written), note: `${h.word} corrigée` },
        this.route,
      );
    },
  },
  {
    route: "periodLineRetire",
    async run(app, h, written) {
      const doomed = await post<PeriodLine>(
        app,
        h,
        ROUTES.periodLines,
        lineDraft(h, "2026-08-20", written),
        "periodLines",
      );
      await post(app, h, ROUTES.periodLineRetire.replace(":id", String(doomed.id)), {}, this.route);
    },
  },
  {
    route: "periodClose",
    async run(app, h, written) {
      await post(app, h, ROUTES.periodClose, { start: null, end: "2026-08-31" }, this.route);
      // A line in the period still open, for its read.
      await post(app, h, ROUTES.periodLines, lineDraft(h, "2026-09-10", written), "periodLines");
    },
  },
];

function lineDraft(h: Household, date: string, written: Written) {
  return {
    personId: h.other,
    date,
    amountCents: h.lineCents,
    category: `${h.word} pharmacie`,
    spendingCategoryId: written.categoryId ?? null,
    note: `${h.word} note`,
    chargedTo: null,
  };
}

/** Every read route, with whatever query makes it show the household's records. */
const READS: { route: RouteName; method: Method; url: string }[] = [
  { route: "me", method: "GET", url: ROUTES.me },
  { route: "rules", method: "GET", url: ROUTES.rules },
  { route: "inbox", method: "GET", url: ROUTES.inbox },
  { route: "autoFiled", method: "GET", url: ROUTES.autoFiled },
  { route: "people", method: "GET", url: ROUTES.people },
  { route: "buckets", method: "GET", url: `${ROUTES.buckets}?asOf=2026-09-30` },
  { route: "salaries", method: "GET", url: ROUTES.salaries },
  { route: "ratios", method: "GET", url: `${ROUTES.ratios}?asOf=2026-09-30` },
  { route: "periods", method: "GET", url: ROUTES.periods },
  { route: "periodOpen", method: "GET", url: `${ROUTES.periodOpen}?end=2026-09-30` },
  { route: "recurring", method: "GET", url: ROUTES.recurring },
  { route: "spendingCategories", method: "GET", url: ROUTES.spendingCategories },
  { route: "spendingCategoryMap", method: "GET", url: ROUTES.spendingCategoryMap },
  { route: "rows", method: "GET", url: ROUTES.rows },
  { route: "statsMortgagePayments", method: "GET", url: ROUTES.statsMortgagePayments },
  { route: "statsSalaries", method: "GET", url: ROUTES.statsSalaries },
  { route: "statsContributions", method: "GET", url: ROUTES.statsContributions },
  { route: "statsMortgageOwn", method: "GET", url: ROUTES.statsMortgageOwn },
  { route: "statsBuffer", method: "GET", url: `${ROUTES.statsBuffer}?minDropCents=1` },
  { route: "statsSpending", method: "GET", url: ROUTES.statsSpending },
  { route: "statsFixedItems", method: "GET", url: ROUTES.statsFixedItems },
  { route: "statsSettlements", method: "GET", url: ROUTES.statsSettlements },
];

describe("the isolation sweep", () => {
  test("covers every route the app answers, so a route added later cannot be left out", async () => {
    const app = await start();
    try {
      const answered: string[] = [];
      for (const [name, path] of Object.entries(ROUTES)) {
        for (const method of ["GET", "POST"] as const) {
          if (app.server.hasRoute({ method, url: path })) answered.push(`${method} ${name}`);
        }
      }
      const swept = [
        ...WRITES.map((write) => `POST ${write.route}`),
        ...READS.map((read) => `${read.method} ${read.route}`),
        // Reads no books, and is answered with no identity at all.
        "GET health",
      ];

      expect(swept.toSorted()).toEqual(answered.toSorted());
      expect(answered.length).toBeGreaterThan(40);
    } finally {
      await app.shutdown();
    }
  });

  test("each household reads its own records through every read route, and nothing of the other's", async () => {
    const app = await start();
    try {
      for (const household of [HOME, AWAY]) {
        const written: Written = {};
        for (const write of WRITES) await write.run(app, household, written);
      }

      // Every read is made before anything is asserted, so a failure lists
      // every route that leaks rather than the first.
      const leaks: string[] = [];
      const silent: string[] = [];
      for (const [own, other] of [
        [HOME, AWAY],
        [AWAY, HOME],
      ] as const) {
        for (const read of READS) {
          const response = await call(app, own, read.method, read.url);
          const where = `${own.id} ${read.method} ${read.route}`;
          expect(response.status, `${where}: ${response.body}`).toBe(200);
          const shown = marks(other).filter((mark) => response.body.includes(mark));
          if (shown.length > 0) leaks.push(`${where} shows ${other.id}'s ${shown.join(", ")}`);
          // Its own: the read shows something, so its silence about the other
          // household is not an empty answer's.
          if (!marks(own).some((mark) => response.body.includes(mark))) silent.push(where);
        }
      }

      expect(leaks).toEqual([]);
      expect(silent).toEqual([]);
    } finally {
      await app.shutdown();
    }
  });
});
