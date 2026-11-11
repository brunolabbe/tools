// @vitest-environment jsdom

/**
 * Every write's invalidations (lg-98): each of the 34 `POST` calls in
 * `web/src/api/*.ts` at a100f429, sent through `useWrite`, with one screen
 * mounted per route reading it through the cache. After the write, each route
 * the write changes shows a new answer without a reload; each route it patches
 * holds the write's answer and is marked stale, unread; every other route is
 * left as it was.
 *
 * The expected lists are written out here, apart from `writes.ts`, so a change
 * to a write's list is a change to this table too. The ticket's Log maps each
 * write to its row here and to the screen tests that show the same thing on a
 * real screen.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ROUTES } from "@ledger/contract";
import * as households from "../src/api/households.ts";
import * as inbox from "../src/api/inbox.ts";
import * as mortgageSplits from "../src/api/mortgage-splits.ts";
import * as mortgage from "../src/api/mortgage.ts";
import * as periods from "../src/api/periods.ts";
import * as receipts from "../src/api/receipts.ts";
import * as rules from "../src/api/rules.ts";
import * as salaries from "../src/api/salaries.ts";
import * as spending from "../src/api/spending.ts";
import * as statements from "../src/api/statements.ts";
import * as workbook from "../src/api/workbook.ts";
import { WRITES, useWrite } from "../src/writes.ts";
import type { WriteName } from "../src/writes.ts";
import { LIVE } from "./mortgage-fixtures.ts";
import { clientWrapper, renderWithClient, testQueryClient } from "./render-with-client.tsx";

vi.mock("../src/api/households.ts");
vi.mock("../src/api/inbox.ts");
vi.mock("../src/api/mortgage-splits.ts");
vi.mock("../src/api/mortgage.ts");
vi.mock("../src/api/periods.ts");
vi.mock("../src/api/receipts.ts");
vi.mock("../src/api/rules.ts");
vi.mock("../src/api/salaries.ts");
vi.mock("../src/api/spending.ts");
vi.mock("../src/api/statements.ts");
vi.mock("../src/api/workbook.ts");

// --- The table: what each write changes, written out apart from writes.ts ---

const STATS = [
  ROUTES.statsMortgagePayments,
  ROUTES.statsSalaries,
  ROUTES.statsContributions,
  ROUTES.statsMortgageOwn,
  ROUTES.statsBuffer,
  ROUTES.statsSpending,
  ROUTES.statsFixedItems,
  ROUTES.statsSettlements,
];
const BOOKS = [
  ROUTES.buckets,
  ROUTES.inbox,
  ROUTES.autoFiled,
  ROUTES.rows,
  ROUTES.periods,
  ROUTES.periodOpen,
  ROUTES.periodLines,
  ROUTES.mortgage,
  ROUTES.spendingCategoryMap,
  ...STATS,
];
// The rows: an unfiled row is given the category of the rule that would file it. Grounded
// in `rule-rows.test.tsx`, whose fake answers differently after the rule (gate 1's F2).
const RULES = [ROUTES.rules, ROUTES.inbox, ROUTES.rows];
const SPENDING = [
  ROUTES.spendingCategories,
  ROUTES.spendingCategoryMap,
  ROUTES.rows,
  ROUTES.inbox,
  ROUTES.autoFiled,
  ROUTES.periodLines,
  ROUTES.statsSpending,
];
const DIRECTORY = [ROUTES.me, ROUTES.household, ROUTES.adminHouseholds, ROUTES.people];
const EVERYTHING = Object.values(ROUTES);

interface Expected {
  /** The routes the write marks stale. */
  changes: readonly string[];
  /** Of those, the ones it puts its answer into instead of reading again. */
  patched?: readonly string[];
  /** The arguments it is sent with, where the patch reads them. */
  args?: readonly unknown[];
  /** What the fake API answers, where the patch reads it. */
  answer?: unknown;
}

const INBOX_PATCH = [ROUTES.inbox, ROUTES.autoFiled];

const EXPECTED: Record<WriteName, Expected> = {
  // households.ts (9)
  addHouseholdMember: { changes: [...DIRECTORY, ...BOOKS] },
  renameHousehold: { changes: DIRECTORY },
  adminRenameHousehold: { changes: DIRECTORY },
  createHousehold: {
    changes: [ROUTES.adminHouseholds],
    patched: [ROUTES.adminHouseholds],
    answer: { id: "zzz", name: "New", members: [], people: [] },
  },
  adminAddMember: { changes: [...DIRECTORY, ...BOOKS] },
  adminRemoveMember: { changes: [...DIRECTORY, ...BOOKS] },
  adminChangeAddress: { changes: DIRECTORY },
  adminRetirePerson: { changes: [...DIRECTORY, ...BOOKS] },
  adminRenamePerson: { changes: DIRECTORY },
  // inbox.ts (1)
  classifyRow: { changes: BOOKS, patched: INBOX_PATCH, args: [{ rowId: 1, ruleId: 7 }] },
  // mortgage-splits.ts (1), mortgage.ts (1)
  fileMortgageSplit: { changes: [ROUTES.mortgageSplits, ...BOOKS] },
  saveMortgage: { changes: BOOKS, patched: [ROUTES.mortgage], answer: LIVE },
  // periods.ts (6)
  // A close applies the retirements waiting for it. Grounded in `periods.test.tsx` › "a
  // person retired at the close is no longer offered on the Period tab once it is closed"
  // (gate 1's F1).
  closePeriod: { changes: [ROUTES.people, ROUTES.adminHouseholds, ...BOOKS] },
  addLine: { changes: BOOKS },
  correctLine: { changes: BOOKS },
  retireLine: { changes: BOOKS },
  addRecurring: { changes: [ROUTES.recurring, ...BOOKS] },
  changeRecurring: { changes: [ROUTES.recurring, ...BOOKS] },
  // receipts.ts (3)
  uploadReceipt: { changes: [] },
  readReceipt: { changes: [] },
  fileReceipt: { changes: BOOKS },
  // rules.ts (3)
  createRule: { changes: RULES },
  editRule: { changes: RULES },
  retireRule: { changes: RULES },
  // salaries.ts (2)
  enterSalaries: { changes: [ROUTES.salaries, ROUTES.ratios, ...BOOKS] },
  confirmRatio: { changes: [ROUTES.salaries, ROUTES.ratios, ...BOOKS] },
  // spending.ts (5)
  addSpendingCategory: { changes: SPENDING },
  renameSpendingCategory: { changes: SPENDING },
  retireSpendingCategory: { changes: SPENDING },
  setSpendingMapEntry: { changes: SPENDING },
  setRowSpendingCategory: {
    changes: SPENDING,
    patched: INBOX_PATCH,
    args: [1, 3],
    answer: { rowId: 1, spendingCategory: { id: 3, source: "override" } },
  },
  // statements.ts (1)
  importStatement: { changes: BOOKS },
  // workbook.ts (2)
  describeWorkbook: { changes: [] },
  confirmWorkbook: { changes: EVERYTHING },
};

const MODULES: Record<string, Record<string, unknown>> = {
  households,
  inbox,
  "mortgage-splits": mortgageSplits,
  mortgage,
  periods,
  receipts,
  rules,
  salaries,
  spending,
  statements,
  workbook,
};

// --- The screens: one per route, each reading it through the cache ---

/** What a route's screen shows: a row it can patch, and which read of the route this is. */
interface Answer {
  id: number;
  spendingCategory: unknown;
  read: number;
}

const ROUTE_LIST = [...new Set(Object.values(ROUTES))];
let reads = new Map<string, number>();

function RouteScreen({ route }: { route: string }): React.ReactElement {
  const answer = useQuery({
    queryKey: [route],
    queryFn: (): Answer[] => {
      const read = (reads.get(route) ?? 0) + 1;
      reads.set(route, read);
      return [{ id: 1, spendingCategory: null, read }];
    },
  });
  const first = Array.isArray(answer.data) ? (answer.data[0] as Answer | undefined) : undefined;
  return <p>{`${route}: read ${String(first?.read ?? "patched")}`}</p>;
}

function Screens(): React.ReactElement {
  return (
    <>
      {ROUTE_LIST.map((route) => (
        <RouteScreen key={route} route={route} />
      ))}
    </>
  );
}

async function mounted(): Promise<QueryClient> {
  const client = testQueryClient();
  renderWithClient(<Screens />, { client });
  await waitFor(() => expect(reads.size).toBe(ROUTE_LIST.length));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  reads = new Map();
});

afterEach(cleanup);

// --- The 34 ---

test("this table names every write writes.ts sends (lg-98)", () => {
  // `writes-source.test.ts` holds writes.ts to the 34 POST calls in web/src/api.
  expect(Object.keys(EXPECTED).toSorted()).toEqual(Object.keys(WRITES).toSorted());
});

describe("after each write, what it changes is read again and shown, and nothing else is (lg-98)", () => {
  test.each(Object.keys(EXPECTED) as WriteName[])("%s", async (name) => {
    const expected = EXPECTED[name];
    const fake = Object.values(MODULES).find((module) => name in module)?.[name];
    if (typeof fake !== "function") throw new Error(`no api function for ${name}`);
    vi.mocked(fake as () => Promise<unknown>).mockResolvedValue(expected.answer ?? {});

    const client = await mounted();
    const { result } = renderHook(() => useWrite(name), { wrapper: clientWrapper(client) });
    const write = result.current as unknown as (...args: readonly unknown[]) => Promise<unknown>;
    await act(async () => {
      await write(...(expected.args ?? []));
    });

    expect(fake).toHaveBeenCalledTimes(1);
    const patched = new Set(expected.patched ?? []);
    const changed = new Set(expected.changes);
    for (const route of ROUTE_LIST) {
      const state = client.getQueryState([route]);
      if (changed.has(route) && !patched.has(route)) {
        // Read again, and the screen shows the new answer.
        expect([route, reads.get(route)]).toEqual([route, 2]);
        expect(await screen.findByText(`${route}: read 2`)).toBeTruthy();
      } else if (patched.has(route)) {
        // The write's answer is in the cache, unread, and marked for the next screen to read.
        expect([route, reads.get(route), state?.isInvalidated]).toEqual([route, 1, true]);
      } else {
        expect([route, reads.get(route), state?.isInvalidated]).toEqual([route, 1, false]);
      }
    }
  });
});

test("a refused write marks nothing stale (lg-98)", async () => {
  vi.mocked(rules.createRule).mockRejectedValue(new Error("refused"));
  const client = await mounted();
  const { result } = renderHook(() => useWrite("createRule"), { wrapper: clientWrapper(client) });

  await act(async () => {
    await expect(result.current({} as never)).rejects.toThrow("refused");
  });

  expect([...reads.values()].every((read) => read === 1)).toBe(true);
  expect(client.getQueryState([ROUTES.rules])?.isInvalidated).toBe(false);
});

test("the patches put the answer where the inbox and the admin list show it (lg-98)", async () => {
  const client = await mounted();
  client.setQueryData(
    [ROUTES.inbox],
    [
      { id: 1, spendingCategory: null },
      { id: 2, spendingCategory: null },
    ],
  );
  client.setQueryData([ROUTES.autoFiled], [{ id: 1, spendingCategory: null }]);
  client.setQueryData([ROUTES.adminHouseholds], [{ id: "b" }, { id: "d" }]);
  vi.mocked(spending.setRowSpendingCategory).mockResolvedValue({
    rowId: 2,
    spendingCategory: { id: 3, source: "override" },
  } as never);
  vi.mocked(households.createHousehold).mockResolvedValue({ id: "c" } as never);
  const wrapper = clientWrapper(client);
  const respend = renderHook(() => useWrite("setRowSpendingCategory"), { wrapper }).result;
  const answer = renderHook(() => useWrite("classifyRow"), { wrapper }).result;
  const create = renderHook(() => useWrite("createHousehold"), { wrapper }).result;

  await act(async () => {
    await respend.current(2, 3);
    await answer.current({ rowId: 1, ruleId: 7 });
    await create.current({ address: "c@example.test" } as never);
  });

  expect(client.getQueryData([ROUTES.inbox])).toEqual([
    { id: 2, spendingCategory: { id: 3, source: "override" } },
  ]);
  expect(client.getQueryData([ROUTES.autoFiled])).toEqual([]);
  expect(client.getQueryData([ROUTES.adminHouseholds])).toEqual([
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ]);
});
