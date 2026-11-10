/**
 * Every write the screens send, and what each one makes stale (lg-98).
 *
 * The cache keeps an answer for `STALE_MS` (`query.ts`), so a write has to say
 * which answers it changed or the person who made it would not see it. Each
 * write below names the routes whose answers it can change; once it succeeds,
 * every query under those routes is marked stale, and the ones a screen is
 * showing are read again at once. The rest are read when a screen next opens.
 *
 * A route is in a write's list when the API recomputes that route's answer from
 * what the write stores. The books' figures are recomputed from every row,
 * filing, line, close and ratio on each read, so a write to any of those makes
 * all of `BOOKS` stale; a write that only names things (a rule, a spending
 * category, a person) makes stale only what shows the name. A workbook import can
 * store anything, so it makes everything stale.
 *
 * **A write whose answer is the new state patches the cache with it** instead of
 * reading again: an answer in the inbox leaves the list at once, and classifying
 * ten rows in a row costs ten requests, not thirty, against the edge's budget
 * (lg-97). A patched route is still marked stale, without being read now, so
 * the next screen to open it reads what the API says.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ROUTES } from "@ledger/contract";
import type {
  AdminHousehold,
  AutoFiledRow,
  ClassifyRequest,
  InboxRow,
  MortgageResponse,
  SpendingCategoryOverrideResponse,
} from "@ledger/contract";
import {
  addHouseholdMember,
  adminAddMember,
  adminChangeAddress,
  adminRemoveMember,
  adminRenameHousehold,
  adminRenamePerson,
  adminRetirePerson,
  createHousehold,
  renameHousehold,
} from "./api/households.ts";
import { classifyRow } from "./api/inbox.ts";
import { fileMortgageSplit } from "./api/mortgage-splits.ts";
import { saveMortgage } from "./api/mortgage.ts";
import {
  addLine,
  addRecurring,
  changeRecurring,
  closePeriod,
  correctLine,
  retireLine,
} from "./api/periods.ts";
import { fileReceipt, readReceipt, uploadReceipt } from "./api/receipts.ts";
import { createRule, editRule, retireRule } from "./api/rules.ts";
import { confirmRatio, enterSalaries } from "./api/salaries.ts";
import {
  addSpendingCategory,
  renameSpendingCategory,
  retireSpendingCategory,
  setRowSpendingCategory,
  setSpendingMapEntry,
} from "./api/spending.ts";
import { importStatement } from "./api/statements.ts";
import { confirmWorkbook, describeWorkbook } from "./api/workbook.ts";
import { adminHouseholdsQuery, autoFiledQuery, inboxQuery, mortgageQuery } from "./queries.ts";

/** The history's series, all computed from the books. */
const STATS = [
  ROUTES.statsMortgagePayments,
  ROUTES.statsSalaries,
  ROUTES.statsContributions,
  ROUTES.statsMortgageOwn,
  ROUTES.statsBuffer,
  ROUTES.statsSpending,
  ROUTES.statsFixedItems,
  ROUTES.statsSettlements,
] as const;

/** Every answer the API computes from the rows, their filings, the lines, the closes and the ratio. */
export const BOOKS = [
  ROUTES.buckets,
  ROUTES.inbox,
  ROUTES.autoFiled,
  ROUTES.rows,
  ROUTES.periods,
  ROUTES.periodOpen,
  ROUTES.periodLines,
  ROUTES.mortgage,
  // Its rows per bank category count the stored rows.
  ROUTES.spendingCategoryMap,
  ...STATS,
] as const;

/** A rule changes no filing (it applies to the next paste), only what the inbox suggests. */
export const RULES = [ROUTES.rules, ROUTES.inbox] as const;

/**
 * Where a spending category, or a row's, is shown: the list, the map, every row
 * and line that carries one, and the one series that charts them.
 */
export const SPENDING = [
  ROUTES.spendingCategories,
  ROUTES.spendingCategoryMap,
  ROUTES.rows,
  ROUTES.inbox,
  ROUTES.autoFiled,
  ROUTES.periodLines,
  ROUTES.statsSpending,
] as const;

/** Who belongs, under which address and name, in which household. */
export const DIRECTORY = [
  ROUTES.me,
  ROUTES.household,
  ROUTES.adminHouseholds,
  ROUTES.people,
] as const;

/** Every route there is, for a write that can store anything. */
export const EVERYTHING: readonly string[] = Object.values(ROUTES);

interface Entry<A extends unknown[], R> {
  /**
   * The `api/` function, looked up when the write is sent rather than when this
   * module loads: a test that mocks part of an `api/` module has no export for
   * the rest, and reading one at load would fail every screen's import.
   */
  write: () => (...args: A) => Promise<R>;
  /** The routes whose answers the write can change. */
  changes: readonly string[];
  /** Puts the write's answer into the cache, for the routes named, instead of reading them again. */
  patch?: { routes: readonly string[]; apply: (client: QueryClient, answer: R, args: A) => void };
}

function entry<A extends unknown[], R>(
  write: () => (...args: A) => Promise<R>,
  changes: readonly string[],
  patch?: Entry<A, R>["patch"],
): Entry<A, R> {
  return patch === undefined ? { write, changes } : { write, changes, patch };
}

/** The row answered, out of the inbox and the review of what was filed automatically. */
function answered(client: QueryClient, _answer: unknown, [request]: [ClassifyRequest]): void {
  const leave = <T extends { id: number }>(rows: T[] | undefined): T[] | undefined =>
    rows?.filter((row) => row.id !== request.rowId);
  client.setQueryData<InboxRow[]>(inboxQuery.queryKey, leave);
  client.setQueryData<AutoFiledRow[]>(autoFiledQuery.queryKey, leave);
}

/** The row's spending category as the API now says it, wherever the inbox shows the row. */
function respent(client: QueryClient, answer: SpendingCategoryOverrideResponse): void {
  const set = <T extends { id: number; spendingCategory: unknown }>(
    rows: T[] | undefined,
  ): T[] | undefined =>
    rows?.map((row) =>
      row.id === answer.rowId ? { ...row, spendingCategory: answer.spendingCategory } : row,
    );
  client.setQueryData<InboxRow[]>(inboxQuery.queryKey, set);
  client.setQueryData<AutoFiledRow[]>(autoFiledQuery.queryKey, set);
}

/**
 * Each write, what it changes, and what it patches. `docs/work/lg-98-*.md`'s Log
 * lists these 34 with the test that proves each one.
 */
export const WRITES = {
  // households.ts — a person added, removed or retired counts in the books, or stops.
  addHouseholdMember: entry(() => addHouseholdMember, [...DIRECTORY, ...BOOKS]),
  renameHousehold: entry(() => renameHousehold, DIRECTORY),
  adminRenameHousehold: entry(() => adminRenameHousehold, DIRECTORY),
  // The answer is the new household's card, so the list takes it without a read (lg-71).
  createHousehold: entry(() => createHousehold, [ROUTES.adminHouseholds], {
    routes: [ROUTES.adminHouseholds],
    apply: (client, made: AdminHousehold) =>
      client.setQueryData<AdminHousehold[]>(adminHouseholdsQuery.queryKey, (households) =>
        households === undefined
          ? undefined
          : [...households, made].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ),
  }),
  adminAddMember: entry(() => adminAddMember, [...DIRECTORY, ...BOOKS]),
  adminRemoveMember: entry(() => adminRemoveMember, [...DIRECTORY, ...BOOKS]),
  adminChangeAddress: entry(() => adminChangeAddress, DIRECTORY),
  adminRetirePerson: entry(() => adminRetirePerson, [...DIRECTORY, ...BOOKS]),
  adminRenamePerson: entry(() => adminRenamePerson, DIRECTORY),
  // inbox.ts
  classifyRow: entry(() => classifyRow, BOOKS, {
    routes: [ROUTES.inbox, ROUTES.autoFiled],
    apply: answered,
  }),
  // mortgage-splits.ts and mortgage.ts
  fileMortgageSplit: entry(() => fileMortgageSplit, [ROUTES.mortgageSplits, ...BOOKS]),
  // The answer is the mortgage as now said, which the setting shows.
  saveMortgage: entry(() => saveMortgage, BOOKS, {
    routes: [ROUTES.mortgage],
    apply: (client, answer: MortgageResponse) =>
      client.setQueryData(mortgageQuery.queryKey, answer),
  }),
  // periods.ts
  closePeriod: entry(() => closePeriod, BOOKS),
  addLine: entry(() => addLine, BOOKS),
  correctLine: entry(() => correctLine, BOOKS),
  retireLine: entry(() => retireLine, BOOKS),
  addRecurring: entry(() => addRecurring, [ROUTES.recurring, ...BOOKS]),
  changeRecurring: entry(() => changeRecurring, [ROUTES.recurring, ...BOOKS]),
  // receipts.ts — a photo kept and a photo read store nothing any screen reads.
  uploadReceipt: entry(() => uploadReceipt, []),
  readReceipt: entry(() => readReceipt, []),
  fileReceipt: entry(() => fileReceipt, BOOKS),
  // rules.ts
  createRule: entry(() => createRule, RULES),
  editRule: entry(() => editRule, RULES),
  retireRule: entry(() => retireRule, RULES),
  // salaries.ts — a ratio settles the period and splits the mortgage.
  enterSalaries: entry(() => enterSalaries, [ROUTES.salaries, ROUTES.ratios, ...BOOKS]),
  confirmRatio: entry(() => confirmRatio, [ROUTES.salaries, ROUTES.ratios, ...BOOKS]),
  // spending.ts
  addSpendingCategory: entry(() => addSpendingCategory, SPENDING),
  renameSpendingCategory: entry(() => renameSpendingCategory, SPENDING),
  retireSpendingCategory: entry(() => retireSpendingCategory, SPENDING),
  setSpendingMapEntry: entry(() => setSpendingMapEntry, SPENDING),
  setRowSpendingCategory: entry(() => setRowSpendingCategory, SPENDING, {
    routes: [ROUTES.inbox, ROUTES.autoFiled],
    apply: respent,
  }),
  // statements.ts
  importStatement: entry(() => importStatement, BOOKS),
  // workbook.ts — a description stores nothing; an import can store anything.
  describeWorkbook: entry(() => describeWorkbook, []),
  confirmWorkbook: entry(() => confirmWorkbook, EVERYTHING),
} as const;

export type WriteName = keyof typeof WRITES;
type ArgsOf<K extends WriteName> = (typeof WRITES)[K] extends Entry<infer A, infer _R> ? A : never;
type AnswerOf<K extends WriteName> =
  (typeof WRITES)[K] extends Entry<infer _A, infer R> ? R : never;

/**
 * Marks every query under `routes` stale, and reads again those a screen shows,
 * but for `patched`, which are only marked. Resolves when those reads settle.
 */
export async function invalidate(
  client: QueryClient,
  routes: readonly string[],
  patched: readonly string[] = [],
): Promise<void> {
  await Promise.all(
    [...new Set(routes)].map((route) =>
      client.invalidateQueries({
        queryKey: [route],
        refetchType: patched.includes(route) ? "none" : "active",
      }),
    ),
  );
}

export interface WriteOptions {
  /**
   * `false` resolves as soon as the API has stored the write, while the screen's
   * reads run on. By default the write resolves once they have settled, so what
   * the screen does next sees the new answer.
   */
  wait?: boolean;
}

/** One write from `WRITES`, sent through a mutation that makes stale what it changed. */
export function useWrite<K extends WriteName>(
  name: K,
  options: WriteOptions = {},
): (...args: ArgsOf<K>) => Promise<AnswerOf<K>> {
  const client = useQueryClient();
  const wait = options.wait ?? true;
  const { mutateAsync } = useMutation<AnswerOf<K>, Error, ArgsOf<K>>({
    mutationFn: (args) => {
      const { write } = WRITES[name] as unknown as Entry<ArgsOf<K>, AnswerOf<K>>;
      return write()(...args);
    },
    onSuccess: (answer, args) => {
      const { changes, patch } = WRITES[name] as unknown as Entry<ArgsOf<K>, AnswerOf<K>>;
      patch?.apply(client, answer, args);
      const reads = invalidate(client, changes, patch?.routes);
      return wait ? reads : undefined;
    },
  });
  return useCallback((...args: ArgsOf<K>) => mutateAsync(args), [mutateAsync]);
}
