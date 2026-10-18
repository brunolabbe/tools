/**
 * Whether a stretch of the workbook's rows and a stretch of the bank's are the
 * same movements of the account (lg-40). One rule, used both ways round: by a
 * paste meeting rows the workbook imported (`statements.ts`), and by the
 * workbook import meeting rows a paste stored (`workbook-import.ts`).
 *
 * The workbook was kept by hand, so it differs from the bank in three ways that
 * are not disagreements about money: its wording is its own, it dates a row a
 * day off now and then, and it lists a day's movements in its own order. So the
 * two are compared **day by day**, cut on the workbook's dates:
 *
 * - The workbook's rows are cut into **runs**, each a stretch of consecutive
 *   rows carrying the same date. The bank's rows at the same positions are that
 *   run's counterpart: as many rows, in the bank's order.
 * - A run and its counterpart **hold the same amounts**, counted with their
 *   repeats, and **end on the same balance**. Since each run ends where the
 *   bank's does, every run opens where the bank's does too, so the balances
 *   line up at every boundary between days; within a day only the order may
 *   differ, and each side has already proven its own running balance.
 * - **A date is never compared beyond a window.** A paste allows each of the
 *   bank's rows to sit on the run's date or a day either side of it; the
 *   workbook import, which reports every differing date and refuses none, allows
 *   any.
 * - **Wording is never compared**: not the description, not the category.
 *
 * A run of one row is lg-7's own comparison: amount and balance, one for one.
 * A day the workbook spread over two dates is two runs, so a day it both
 * re-dated and reordered does not match.
 */

import { dayAfter } from "@ledger/books";

/** What the rule reads of a row, on either side. */
export interface DayEntry {
  readonly date: string;
  readonly amountCents: number;
  readonly balanceCents: number;
}

/** How far apart the two sides may date a row. */
export type DateWindow = "a day either side" | "any";

/** The calendar day before a `yyyy-mm-dd` date. */
export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function withinWindow(workbook: string, bank: string, window: DateWindow): boolean {
  return (
    window === "any" ||
    workbook === bank ||
    dayAfter(workbook) === bank ||
    dayAfter(bank) === workbook
  );
}

/**
 * One of the workbook's days against the bank's rows in its place: which of
 * the bank's rows each workbook row is (an index into `bank`), or `null` when
 * they are not the same movements. `workbook` is one run, every row on one date.
 */
export function matchDay(
  workbook: readonly DayEntry[],
  bank: readonly DayEntry[],
  window: DateWindow,
): number[] | null {
  const last = workbook.at(-1);
  if (last === undefined || workbook.length !== bank.length) return null;
  if (bank.at(-1)?.balanceCents !== last.balanceCents) return null;
  if (!bank.every((row) => withinWindow(last.date, row.date, window))) return null;
  const used = new Set<number>();
  const pairing: number[] = [];
  for (const row of workbook) {
    const at = bank.findIndex(
      (candidate, index) => !used.has(index) && candidate.amountCents === row.amountCents,
    );
    if (at === -1) return null;
    used.add(at);
    pairing.push(at);
  }
  return pairing;
}

/** The workbook's rows cut into runs of one date, as `[start, end)` positions. */
export function dayRuns(rows: readonly { readonly date: string }[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  for (let index = 1; index <= rows.length; index++) {
    if (index === rows.length || rows[index]?.date !== rows[start]?.date) {
      runs.push([start, index]);
      start = index;
    }
  }
  return runs;
}

/**
 * A stretch of the workbook's rows against the bank's in their place, day by
 * day: for each workbook row, the position of its bank row, or `null` when the
 * two stretches are not the same movements.
 */
export function alignDays(
  workbook: readonly DayEntry[],
  bank: readonly DayEntry[],
  window: DateWindow,
): number[] | null {
  if (workbook.length !== bank.length) return null;
  const pairing: number[] = [];
  for (const [start, end] of dayRuns(workbook)) {
    const day = matchDay(workbook.slice(start, end), bank.slice(start, end), window);
    if (day === null) return null;
    pairing.push(...day.map((offset) => start + offset));
  }
  return pairing;
}
