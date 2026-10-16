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
 * A write that lands in the wrong books need not show through any read: a
 * map entry for a bank category the other household has no rows in is listed
 * by no read route. So after the writes every table of each household's file
 * is read directly (gate 1, F1): none may hold the other household's marks,
 * and each table holds as many rows in one file as in the other, since both
 * households make the same writes. And the two households' ids differ — away
 * writes one more category and one more row before everything else, home
 * after — so an id one of them names is not also valid in the other's books.
 *
 * The first test takes every route the server answers from the server itself
 * (`printRoutes`), whatever its method and whether or not the contract's
 * `ROUTES` names it, and fails when one is in neither table, so a route added
 * later cannot be left out of the sweep (gate 1, F2).
 */

import { Buffer } from "node:buffer";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ClassificationRecord,
  PeriodLine,
  ReadReceiptResponse,
  Receipt,
  RecurringItem,
  Rule,
  RowsResponse,
  SalaryEntryResponse,
  SpendingCategory,
} from "@ledger/contract";
import type { ReceiptReader } from "@ledger/receipts";
import type { Directory } from "../src/directory.ts";
import { createLogger } from "../src/logger.ts";
import { filePhotoStore } from "../src/receipt-photos.ts";
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

/**
 * A row only so that the two households' row ids differ: away pastes it before
 * its others, home after them.
 */
function spareRow(household: Household, date: string): PasteRow {
  const { word } = household;
  return { date, category: `${word} Divers`, description: `Réserve /${word}`, amountCents: -1_111 };
}

/**
 * The rows a household pastes, oldest first, in two pastes: the second holds
 * the last two of the list below, and home's spare row after them.
 */
function statementRows(household: Household): PasteRow[] {
  const { word } = household;
  const transfer = `Virement /${word} Caisse`;
  const rows: PasteRow[] = [
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
  return household === AWAY
    ? [spareRow(household, "2026-06-20"), ...rows]
    : [...rows, spareRow(household, "2026-09-25")];
}

/** The first paste, or the second. */
function paste(household: Household, which: 1 | 2): string {
  const rows = withBalances(statementRows(household), 1_000_000);
  // Away's spare row is the first of its first paste, home's the last of its second.
  const split = household === AWAY ? 7 : 6;
  return renderPaste(which === 1 ? rows.slice(0, split) : rows.slice(split));
}

/** One more category, so that the two households' category ids differ too. */
async function spareCategory(app: App, household: Household): Promise<void> {
  await post(
    app,
    household,
    ROUTES.spendingCategories,
    { name: `${household.word} réserve` },
    "spare",
  );
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

/** Where the sweep's receipt photos are kept: files, so whose directory each is in can be read. */
const PHOTOS = mkdtempSync(path.join(tmpdir(), "ledger-isolation-"));

afterAll(() => {
  rmSync(PHOTOS, { recursive: true, force: true });
});

async function start(): Promise<App> {
  return await createApp({
    photos: filePhotoStore(PHOTOS),
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
    receiptReader: echoReader,
  });
}

/**
 * A photo carrying its household's word after a JPEG's first bytes, and a fake
 * reader (lg-8) that proposes whatever word the photo it was handed carries: a
 * read handed the other household's photo shows that household's word.
 */
function photoOf(household: Household): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(household.word)]);
}

const echoReader: ReceiptReader = {
  model: "fake",
  async read(photo) {
    const merchant = Buffer.from(photo.bytes.subarray(4)).toString("utf8");
    return [
      {
        merchant,
        date: "2026-07-20",
        subtotal: 12_345,
        gst: null,
        qst: null,
        total: 12_345,
        items: [],
      },
    ];
  },
};

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
  receiptId?: number;
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
  // lg-22: a second address for the household's other person, in the directory.
  {
    route: "householdMembers",
    async run(app, h) {
      const domain = h.caller.slice(h.caller.indexOf("@"));
      await post(
        app,
        h,
        ROUTES.householdMembers.replace(":id", h.id),
        { address: `${h.other}.second${domain}`, person: h.other },
        this.route,
      );
    },
  },
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
      await post(app, h, ROUTES.statements, { text: paste(h, 1) }, this.route);
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
      await post(app, h, ROUTES.statements, { text: paste(h, 2) }, "statements");
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
  {
    route: "receipts",
    async run(app, h, written) {
      const receipt = await post<Receipt>(app, h, ROUTES.receipts, photoOf(h), this.route);
      written.receiptId = receipt.id;
    },
  },
  {
    route: "receiptRead",
    async run(app, h, written) {
      const url = ROUTES.receiptRead.replace(":id", String(written.receiptId));
      const read = await post<ReadReceiptResponse>(app, h, url, undefined, this.route);
      // The photo read is the household's own.
      expect(read.proposals[0]?.proposal.merchant).toBe(h.word);
    },
  },
  {
    route: "receiptFile",
    async run(app, h, written) {
      const proposal = {
        merchant: `${h.word} Marché`,
        date: "2026-09-12",
        subtotal: h.lineCents,
        gst: null,
        qst: null,
        total: h.lineCents,
        // An item carrying the household's word, so its table is swept too (lg-10).
        items: [
          {
            text: `${h.word} article`,
            price: h.lineCents,
            taxable: false,
            deposit: null,
            spendingCategoryId: null,
            share: "shared",
          },
        ],
      };
      const url = ROUTES.receiptFile.replace(":id", String(written.receiptId));
      await post(
        app,
        h,
        url,
        {
          part: 1,
          proposal,
          destination: {
            to: "line",
            date: "2026-09-12",
            amountCents: h.lineCents,
            spendingCategoryId: written.categoryId ?? null,
            note: `${h.word} reçu`,
            chargedTo: null,
          },
        },
        this.route,
      );
      // A second receipt, on the row it documents.
      const second = await post<Receipt>(app, h, ROUTES.receipts, photoOf(h), "receipts");
      const [boutique] = await rowIdOf(app, h, `Inconnu /${h.word} Boutique`);
      await post(
        app,
        h,
        ROUTES.receiptFile.replace(":id", String(second.id)),
        { part: 1, proposal, destination: { to: "row", rowId: boutique } },
        this.route,
      );
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
const READS: {
  route: RouteName;
  method: Method;
  url: string | ((household: Household) => string);
}[] = [
  { route: "me", method: "GET", url: ROUTES.me },
  // lg-22: the household's members and history, its own and no other's.
  { route: "household", method: "GET", url: (h) => ROUTES.household.replace(":id", h.id) },
  { route: "rules", method: "GET", url: ROUTES.rules },
  { route: "inbox", method: "GET", url: ROUTES.inbox },
  { route: "autoFiled", method: "GET", url: ROUTES.autoFiled },
  { route: "people", method: "GET", url: ROUTES.people },
  { route: "buckets", method: "GET", url: `${ROUTES.buckets}?asOf=2026-09-30` },
  { route: "salaries", method: "GET", url: ROUTES.salaries },
  { route: "ratios", method: "GET", url: `${ROUTES.ratios}?asOf=2026-09-30` },
  { route: "periods", method: "GET", url: ROUTES.periods },
  { route: "periodOpen", method: "GET", url: `${ROUTES.periodOpen}?end=2026-09-30` },
  // Closed periods' lines as well as the open one's (lg-19), so no span is
  // given: every stored line shows, and the household's own marks are in them.
  { route: "periodLines", method: "GET", url: ROUTES.periodLines },
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
  // Which receipt is named does not matter to the rows offered; both households
  // have a first one.
  {
    route: "receiptMatches",
    method: "GET",
    url: `${ROUTES.receiptMatches.replace(":id", "1")}?amountCents=12345&date=2026-07-20`,
  },
];

/**
 * Every (method, path) the server answers, read from Fastify's own route tree,
 * sorted. `printRoutes` draws a tree, each line one node's segment and its
 * methods, four columns deeper per level, so a node's path is its ancestors'
 * segments and its own. The `HEAD` Fastify adds beside each `GET` is left out,
 * and it is told from a `HEAD` an author registered by its own `onSend` hook,
 * which `includeMeta` prints on the lines under the route's. Any other `HEAD`,
 * or any other method, is kept, so that it fails the comparison (lg-21's gate 2,
 * N1: telling them apart by the `GET` beside them let an author's `HEAD` through).
 * Should Fastify rename that hook, every `HEAD` is kept and the comparison fails,
 * rather than one passing unseen.
 */
function answeredRoutes(app: App): string[] {
  const pairs = new Set<string>();
  const fastifysOwn = new Set<string>();
  const segments: string[] = [];
  let methods: string[] = [];
  for (const line of app.server
    .printRoutes({ commonPrefix: false, includeMeta: true })
    .split("\n")) {
    if (line.includes("(onSend)") && line.includes("headRouteOnSendHandler()")) {
      if (methods.length === 1 && methods[0] === "HEAD")
        fastifysOwn.add(`HEAD ${segments.join("")}`);
      continue;
    }
    const match = /^([│├└─ ]*)(\S+) \(([A-Z, ]+)\)$/u.exec(line);
    if (match === null) continue;
    const [, indent = "", segment = "", listed = ""] = match;
    const depth = indent.length / 4 - 1;
    segments.length = depth;
    segments.push(segment);
    methods = listed.split(", ");
    for (const method of methods) pairs.add(`${method} ${segments.join("")}`);
  }
  return [...pairs].filter((pair) => !fastifysOwn.has(pair)).toSorted();
}

/**
 * What each household's file holds that it should not: a table holding the
 * other household's marks, or a table whose row count differs between the two
 * files. Read straight from the files, not through any route.
 */
function storedLeaks(app: App): string[] {
  const found: string[] = [];
  const tables = (household: Household) => {
    const db = app.books.of(household.id);
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    return new Map(
      names.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()] as const),
    );
  };
  const held = new Map([HOME, AWAY].map((household) => [household.id, tables(household)] as const));
  for (const [own, other] of [
    [HOME, AWAY],
    [AWAY, HOME],
  ] as const) {
    for (const [table, rows] of held.get(own.id) ?? []) {
      const text = JSON.stringify(rows);
      const shown = marks(other).filter((mark) => text.includes(mark));
      if (shown.length > 0)
        found.push(`${own.id}'s ${table} holds ${other.id}'s ${shown.join(", ")}`);
    }
  }
  for (const [table, rows] of held.get(HOME.id) ?? []) {
    const away = held.get(AWAY.id)?.get(table)?.length ?? 0;
    if (rows.length !== away)
      found.push(`${table} holds ${rows.length} rows at home, ${away} away`);
  }
  return found;
}

/**
 * A receipt photo kept outside its household's directory (lg-8): each
 * household's directory holds exactly the photos its own receipts name. A photo
 * saved under the other household's directory and loaded from there shows
 * through no read, since every photo's name is new.
 */
function photoLeaks(app: App): string[] {
  const found: string[] = [];
  for (const household of [HOME, AWAY]) {
    const named = (
      app.books.of(household.id).prepare("SELECT photo FROM receipts ORDER BY photo").all() as {
        photo: string;
      }[]
    ).map((row) => row.photo);
    const directory = path.join(PHOTOS, "receipts", household.id);
    const kept = existsSync(directory) ? readdirSync(directory).toSorted() : [];
    if (named.length === 0) found.push(`${household.id} has no receipts to compare`);
    if (JSON.stringify(kept) !== JSON.stringify(named)) {
      found.push(
        `${household.id}'s photos are ${kept.join(", ")}, its receipts name ${named.join(", ")}`,
      );
    }
  }
  return found;
}

describe("the isolation sweep", () => {
  test("covers every route the app answers, so a route added later cannot be left out", async () => {
    const app = await start();
    try {
      const answered = answeredRoutes(app);
      const swept = [
        ...WRITES.map((write) => `POST ${ROUTES[write.route]}`),
        ...READS.map((read) => `${read.method} ${ROUTES[read.route]}`),
        // Reads no books, and is answered with no identity at all.
        `GET ${ROUTES.health}`,
        // The directory, for an admin, which reads no books either; these
        // callers are no admins. authority.test.ts sweeps them (lg-22).
        `GET ${ROUTES.adminHouseholds}`,
        `POST ${ROUTES.adminHouseholds}`,
        `POST ${ROUTES.adminMembers}`,
        `POST ${ROUTES.adminMemberRemove}`,
      ];

      expect(swept.toSorted()).toEqual(answered);
      // The listing was read: a format it no longer parses fails here, not by
      // finding nothing to compare.
      expect(answered.length).toBeGreaterThan(40);
    } finally {
      await app.shutdown();
    }
  });

  test("each household reads its own records through every read route, and nothing of the other's", async () => {
    const app = await start();
    try {
      // Home first, then away, as two people would, but with away's ids
      // shifted by a spare category and row, and home's spare made last so
      // that both files end up with the same number of rows.
      for (const household of [HOME, AWAY]) {
        const written: Written = {};
        if (household === AWAY) await spareCategory(app, household);
        for (const write of WRITES) await write.run(app, household, written);
        if (household === HOME) await spareCategory(app, household);
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
          const url = typeof read.url === "string" ? read.url : read.url(own);
          const response = await call(app, own, read.method, url);
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
      expect(storedLeaks(app)).toEqual([]);
      expect(photoLeaks(app)).toEqual([]);
    } finally {
      await app.shutdown();
    }
  });
});
