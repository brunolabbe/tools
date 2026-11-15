/**
 * Each write's stale routes, derived from the API (lg-108).
 *
 * `web/src/writes.ts` lists, for each of the 34 writes the screens send, the
 * routes whose answers it can change. Here each write is sent through the very
 * `web/src/api` function `WRITES` names for it, against the in-process API, on
 * a fresh app seeded so that the write changes something. Every `GET` route the
 * API registers is read before the write and again after it; the routes whose
 * answers differ are the write's derived set. A derived route the write's list
 * does not mark fails its case. A marked route the write left unchanged is
 * allowed (it costs a request, not a stale screen), and is printed at the end.
 *
 * What this proves is bounded by each write's seed: a route the seed gives the
 * write no way to change reads as unchanged, whatever the list says.
 *
 * The web's functions send relative URLs, answered by `helpers/inject-fetch.ts`
 * through `app.server.inject`; `vi.stubGlobal` puts that `fetch` in place for
 * the case and `vi.unstubAllGlobals` takes it away, which also keeps this file
 * in the ledger's isolated half (`vitest.isolation.ts`'s `NEEDS_ISOLATION`).
 * No request is written here: every write, the seeds' included, goes through
 * the web's own functions.
 */

import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  InboxResponse,
  MeResponse,
  OpenPeriodResponse,
  PeriodLineDraft,
  ReceiptProposal,
  RecurringItemDraft,
  WorkbookLayout,
} from "@ledger/contract";
import type { LayoutAsk, ReceiptReader } from "@ledger/receipts";
import { WRITES } from "../../web/src/writes.ts";
import type { WriteName } from "../../web/src/writes.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { ALEX, SAM, accessConfig, memberDirectory } from "./helpers/access.ts";
import {
  GROCERIES,
  HISTORY,
  MORTGAGE_RULE,
  TRANSFER_RULE,
  paste,
} from "./helpers/classification.ts";
import {
  changedRoutes,
  getRoutes,
  injectFetch,
  readAll,
  readJson,
  readsFor,
} from "./helpers/inject-fetch.ts";
import type { Injected, ReadValues } from "./helpers/inject-fetch.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import { xlsxOf } from "./helpers/xlsx-file.ts";
import { migratedBooks } from "./helpers/template.ts";
import { layoutFixtures } from "./layout/fixtures.ts";

/**
 * The clock every answer is computed on: pinned, so an answer that carries the
 * time (`health`'s uptime, a `generatedAt`) reads the same before and after.
 */
const NOW = new Date("2026-10-03T09:30:00Z");

/** What the fake reader reads off every photo: the groceries row's charge, and it adds up. */
const READ: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-09-20",
  subtotal: 12_000,
  gst: 115,
  qst: 230,
  total: 12_345,
  items: [],
};

const reader: ReceiptReader = {
  model: "fake-haiku",
  read: async () => [READ],
};

/** lg-7's workbook as a file, and its correct description, which the fake describer answers. */
let workbook: { file: string; layout: WorkbookLayout };

const describer: LayoutAsk = async () => ({
  text: JSON.stringify(workbook.layout),
  stopReason: "end_turn",
  inputTokens: 1,
  outputTokens: 1,
});

beforeAll(async () => {
  const lg7 = (await layoutFixtures()).find((fixture) => fixture.name === "lg7");
  if (lg7 === undefined) throw new Error("no lg7 fixture");
  workbook = { file: (await xlsxOf(lg7.sheets)).toString("base64"), layout: lg7.layout };
});

/**
 * One app per write: a case reads about thirty routes twice, and a shared app
 * would spend the read limit within a few writes. The caller is alex, a member of
 * the household and an admin, so every directory write and read is theirs to make.
 */
async function boot(): Promise<App> {
  return await createApp({
    booksTemplate: migratedBooks(),
    directory: memberDirectory(),
    config: {
      dataDir: ":memory:",
      access: accessConfig({ devIdentity: ALEX, admins: new Set([ALEX]) }),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      rateLimitWorkbookDescribesPerMinute: 0,
      receiptReader: { apiKey: undefined, model: "claude-haiku-5-5", escalationModel: null },
    },
    logger: createLogger({ level: "silent" }),
    now: () => NOW,
    receiptReader: reader,
    escalationReader: null,
    layoutAsk: describer,
  });
}

type WriteFn<K extends WriteName> = ReturnType<(typeof WRITES)[K]["write"]>;
type ArgsOf<K extends WriteName> = Parameters<WriteFn<K>>;
type AnswerOf<K extends WriteName> = Awaited<ReturnType<WriteFn<K>>>;

/** The web's function for `name`, as `WRITES` names it. */
function writeOf<K extends WriteName>(name: K): (...args: ArgsOf<K>) => Promise<AnswerOf<K>> {
  return WRITES[name].write() as unknown as (...args: ArgsOf<K>) => Promise<AnswerOf<K>>;
}

/** What a case's seed has to go on, and what it leaves for the reads. */
interface Context {
  app: App;
  injected: Injected;
  /** The caller's household, from `GET /api/me`. */
  household: string;
  /** Set by a seed that uploads a receipt, so `receiptMatches` is read for it. */
  receipt?: ReadValues["receipt"];
}

/** One write sent as part of a seed, through the web's function, answered 2xx. */
async function seed<K extends WriteName>(
  context: Context,
  name: K,
  ...args: ArgsOf<K>
): Promise<AnswerOf<K>> {
  return await context.injected.answered(`seed ${name}`, () => writeOf(name)(...args));
}

/** A JPEG's first bytes, then filler that names nothing. */
function photo(): Blob {
  const bytes = new Uint8Array(64).fill(0x2a);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return new Blob([bytes], { type: "image/jpeg" });
}

function line(spendingCategoryId: number | null, amountCents = 2_500): PeriodLineDraft {
  return {
    personId: "alex",
    date: "2026-10-01",
    amountCents,
    category: null,
    spendingCategoryId,
    note: "Marché Exemple",
    chargedTo: null,
  };
}

function recurring(monthlyCents = 5_000): RecurringItemDraft {
  return {
    personId: "sam",
    monthlyCents,
    startDate: "2026-01-01",
    endDate: null,
    label: "Téléphone",
  };
}

function salaries(year: number, alex: number, sam: number) {
  return {
    year,
    salaries: [
      { personId: "alex", amountCents: alex },
      { personId: "sam", amountCents: sam },
    ],
  };
}

/**
 * The books most writes run on: a ratio, a spending category the bank's
 * `Épicerie` maps to, a rule, a paste (one row filed by the rule, three in the
 * inbox), a line and a recurring item in the open period, a live mortgage, and
 * one receipt uploaded and not yet read, which documents the groceries row.
 */
async function books(context: Context) {
  const entered = await seed(context, "enterSalaries", salaries(2026, 6_000_000, 4_000_000));
  await seed(context, "confirmRatio", {
    effectiveFrom: "2026-01-01",
    salaryIds: entered.salaries.map((salary) => salary.id),
  });
  const category = await seed(context, "addSpendingCategory", "Épicerie maison");
  await seed(context, "setSpendingMapEntry", "Épicerie", category.id);
  const rule = await seed(context, "createRule", {
    ...TRANSFER_RULE,
    spendingCategoryId: category.id,
  });
  await seed(context, "importStatement", paste());
  const added = await seed(context, "addLine", line(category.id));
  const item = await seed(context, "addRecurring", recurring());
  await seed(context, "saveMortgage", { state: "live" });
  const receipt = await seed(context, "uploadReceipt", photo());
  context.receipt = { id: receipt.id, amountCents: READ.total ?? 0, date: READ.date ?? "" };
  const inbox = await readJson<InboxResponse>(context.app, {
    route: ROUTES.inbox,
    url: ROUTES.inbox,
  });
  const groceries = inbox.rows.find((row) => row.description === GROCERIES);
  if (groceries === undefined) throw new Error("the groceries row is not in the inbox");
  return { category, rule, line: added, item, receipt, groceries };
}

/**
 * Each write's seed and the arguments it is sent with: what the screen would
 * send, built from the ids the seed made. Not a list of routes.
 */
const CASES: { [K in WriteName]: (context: Context) => Promise<ArgsOf<K>> } = {
  addHouseholdMember: async (context) => {
    await books(context);
    return [context.household, { address: "casey@example.test", person: "Casey" }];
  },
  renameHousehold: async (context) => {
    await books(context);
    return [context.household, { name: "Le foyer" }];
  },
  adminRenameHousehold: async (context) => {
    await books(context);
    return [context.household, { name: "Le foyer" }];
  },
  createHousehold: async (context) => {
    await books(context);
    return [{ address: "kim@away.test", person: "Kim" }];
  },
  adminAddMember: async (context) => {
    await books(context);
    return [context.household, { address: "casey@example.test", person: "Casey" }];
  },
  adminRemoveMember: async (context) => {
    await books(context);
    return [context.household, SAM];
  },
  adminChangeAddress: async (context) => {
    await books(context);
    return [context.household, { from: SAM, to: "sam@elsewhere.test" }];
  },
  // A person is retired only once no address stands under them.
  adminRetirePerson: async (context) => {
    await books(context);
    await seed(context, "adminRemoveMember", context.household, SAM);
    return [context.household, { person: "sam", action: "retire" }];
  },
  adminRenamePerson: async (context) => {
    await books(context);
    return [context.household, { person: "sam", name: "Samantha" }];
  },
  classifyRow: async (context) => {
    const { groceries } = await books(context);
    return [{ rowId: groceries.id, personId: null, bucket: "current-expenses" }];
  },
  fileMortgageSplit: async (context) => {
    await books(context);
    return [{ effectiveFrom: "2026-09-01", mode: "equal" }];
  },
  saveMortgage: async (context) => {
    await books(context);
    return [{ state: "ended", endedOn: "2026-09-30" }];
  },
  // A close applies the retirements waiting for it, so one waits: sam's.
  closePeriod: async (context) => {
    await books(context);
    await seed(context, "adminRemoveMember", context.household, SAM);
    await seed(context, "adminRetirePerson", context.household, {
      person: "sam",
      action: "retire",
    });
    return [{ start: null, end: "2026-09-30" }];
  },
  addLine: async (context) => {
    const { category } = await books(context);
    return [line(category.id, 4_000)];
  },
  correctLine: async (context) => {
    const { category, line: added } = await books(context);
    return [added.id, line(category.id, 3_000)];
  },
  retireLine: async (context) => {
    const { line: added } = await books(context);
    return [added.id];
  },
  addRecurring: async (context) => {
    await books(context);
    return [{ ...recurring(2_000), personId: "alex", label: "Internet" }];
  },
  changeRecurring: async (context) => {
    const { item } = await books(context);
    return [item.id, recurring(6_000)];
  },
  uploadReceipt: async (context) => {
    await books(context);
    return [photo()];
  },
  readReceipt: async (context) => {
    const { receipt } = await books(context);
    return [receipt.id];
  },
  fileReceipt: async (context) => {
    const { receipt } = await books(context);
    return [
      receipt.id,
      {
        part: 1,
        proposal: READ,
        destination: {
          to: "line",
          date: READ.date ?? "",
          amountCents: READ.total ?? 0,
          spendingCategoryId: null,
          note: "Marché Exemple",
          chargedTo: null,
          paidBy: null,
        },
      },
    ];
  },
  createRule: async (context) => {
    const { category } = await books(context);
    return [{ ...MORTGAGE_RULE, spendingCategoryId: category.id }];
  },
  editRule: async (context) => {
    const { category, rule } = await books(context);
    return [rule.id, { ...TRANSFER_RULE, amountCents: null, spendingCategoryId: category.id }];
  },
  retireRule: async (context) => {
    const { rule } = await books(context);
    return [rule.id];
  },
  enterSalaries: async (context) => {
    await books(context);
    return [salaries(2025, 5_000_000, 5_000_000)];
  },
  confirmRatio: async (context) => {
    await books(context);
    const entered = await seed(context, "enterSalaries", salaries(2026, 5_000_000, 5_000_000));
    return [
      { effectiveFrom: "2026-07-01", salaryIds: entered.salaries.map((salary) => salary.id) },
    ];
  },
  addSpendingCategory: async (context) => {
    await books(context);
    return ["Restaurants"];
  },
  renameSpendingCategory: async (context) => {
    const { category } = await books(context);
    return [category.id, "Courses"];
  },
  retireSpendingCategory: async (context) => {
    const { category } = await books(context);
    return [category.id];
  },
  setSpendingMapEntry: async (context) => {
    await books(context);
    return ["Épicerie", null];
  },
  setRowSpendingCategory: async (context) => {
    const { groceries } = await books(context);
    const other = await seed(context, "addSpendingCategory", "Marché");
    return [groceries.id, other.id];
  },
  importStatement: async (context) => {
    await books(context);
    const more = {
      date: "2026-10-02",
      category: "Épicerie",
      description: GROCERIES,
      amountCents: -5_000,
    };
    return [renderPaste(withBalances([...HISTORY, more], 150_000))];
  },
  describeWorkbook: async (context) => {
    await books(context);
    return [workbook.file];
  },
  // An import is the books' first record, so it goes into books that hold nothing.
  confirmWorkbook: async () => [workbook.file, workbook.layout],
};

/** Each write's outcome, for the summary at the end. */
interface Outcome {
  derived: string[];
  /** Changed, and not marked: each fails the case. */
  unmarked: string[];
  /** Marked, and left unchanged by this seed. */
  markedUnchanged: string[];
}

const outcomes = new Map<WriteName, Outcome>();
let notRead: string[] = [];
let app: App | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.shutdown();
  app = undefined;
});

const NAMES = Object.keys(WRITES) as WriteName[];

test.each(NAMES)("%s marks every route its write changes (lg-108)", async (name) => {
  app = await boot();
  const injected = injectFetch(app);
  vi.stubGlobal("fetch", injected.fetch);
  const me = await readJson<MeResponse>(app, { route: ROUTES.me, url: ROUTES.me });
  const context: Context = { app, injected, household: me.person.household };
  const args = await CASES[name](context);
  const open = await readJson<OpenPeriodResponse>(app, {
    route: ROUTES.periodOpen,
    url: ROUTES.periodOpen,
  });
  const reads = readsFor(app, {
    household: context.household,
    periodStart: open.start,
    ...(context.receipt === undefined ? {} : { receipt: context.receipt }),
  });
  const read = new Set<string>(getRoutes(app));
  notRead = Object.keys(ROUTES).filter((key) => !read.has(key));

  const before = await readAll(app, reads);
  await injected.answered(name, () => writeOf(name)(...args));
  const after = await readAll(app, reads);

  const derived = changedRoutes(before, after);
  const entry = WRITES[name];
  const marked = new Set<string>([
    ...entry.changes,
    ...("patch" in entry ? entry.patch.routes : []),
  ]);
  const outcome: Outcome = {
    derived,
    unmarked: derived.filter((route) => !marked.has(route)),
    markedUnchanged: [...marked].filter((route) => !derived.includes(route)),
  };
  outcomes.set(name, outcome);

  expect(
    outcome.unmarked.map((route) => `${name} changed ${route}, which WRITES does not mark`),
  ).toEqual([]);
  if (marked.size === 0) expect(derived, `${name} marks nothing`).toEqual([]);
  else expect(derived.length, `${name}'s seed changes nothing it reads`).toBeGreaterThan(0);
});

afterAll(() => {
  const unmarked = [...outcomes.values()].reduce(
    (sum, outcome) => sum + outcome.unmarked.length,
    0,
  );
  const lines = [
    `lg-108: ${String(outcomes.size)} of ${String(NAMES.length)} writes compared; ${String(unmarked)} changed routes not marked.`,
    `Not read (no GET): ${notRead.join(", ")}.`,
    ...NAMES.map((name) => {
      const outcome = outcomes.get(name);
      if (outcome === undefined) return `${name}: not compared`;
      return `${name}: changed ${String(outcome.derived.length)} [${outcome.derived.join(" ")}]; marked and unchanged ${String(outcome.markedUnchanged.length)} [${outcome.markedUnchanged.join(" ")}]`;
    }),
  ];
  console.log(lines.join("\n"));
});
