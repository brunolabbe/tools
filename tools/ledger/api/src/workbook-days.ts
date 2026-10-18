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
 * - **Within a day, only the workbook's opening and closing balances are
 *   real.** The balances it shows between them follow its own order, not the
 *   bank's, so nothing is ever compared with them.
 * - **A date is never compared beyond a window.** A paste allows each of the
 *   bank's rows to sit on the run's date or a day either side of it; the
 *   workbook import, which reports every differing date and refuses none, allows
 *   any.
 * - **Wording is never compared**: not the description, not the category.
 *
 * **A paste may start or end partway through one of the workbook's days**
 * (`matchPart`): its rows there are some of that day's, as the bank lists them
 * from a position the paste's place gives. They must be among the day's amounts,
 * and the bank's day must be able to reach the balance they open from: from the
 * day's opening when they are its first rows, to its closing when they are its
 * last, and when they are neither, through some of the day's other amounts, as
 * many as the bank listed before them. Comparing them with the workbook's rows
 * in the same positions instead would compare a different part of the day
 * whenever the order differs, which refused a correct paste and could leave a
 * false reading the only one (gate 1, F1 and F2). A part that starts and ends
 * inside a day of more than `LONGEST_SEARCHED_DAY` rows is refused: that search
 * is not made.
 *
 * **The workbook import cuts a day where its own listing puts the edge**
 * (`alignDays`). Where the pastes start partway through a day, the workbook's
 * rows after the edge must hold the pasted rows' amounts and end on their
 * balance, as a whole day would. It adds the workbook's rows before the edge, so
 * those must be the rest of the day, which only the workbook's own listing can
 * say; admitting a part as a paste does would let it add the wrong ones.
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

/**
 * The most rows of one day a paste starting and ending inside it is weighed
 * against: past this, which of the day's rows came first is not searched, and the
 * reading is not admitted. The search grows with the number of ways to choose
 * among the day's rows, so a bound keeps one paste from taking the lock for long.
 */
export const LONGEST_SEARCHED_DAY = 20;

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

/** Whether `count` of `amounts` add up to `sum`. */
function someAddUpTo(amounts: readonly number[], count: number, sum: number): boolean {
  // The sums reachable with each number of the amounts taken.
  let reachable: Set<number>[] = [new Set([0])];
  for (const amount of amounts) {
    const next = reachable.map((sums) => new Set(sums));
    for (const [taken, sums] of reachable.entries()) {
      if (taken >= count) continue;
      const into = next[taken + 1] ?? new Set<number>();
      for (const total of sums) into.add(total + amount);
      next[taken + 1] = into;
    }
    reachable = next;
  }
  return reachable[count]?.has(sum) ?? false;
}

/**
 * Some of the bank's rows of one of the workbook's days, `part`, in the bank's
 * order, as the bank's rows `before` to `before + part.length` of that day.
 * `run` is the whole day as the workbook holds it.
 *
 * The part's amounts must be among the day's, every one of its rows dated within
 * the window, and the balance it opens from one the bank's day reaches after
 * `before` of the day's other amounts: the day's opening when `before` is 0, and
 * when the part runs to the day's end, simply the day's closing balance after its
 * last row. A part that is the whole day is `matchDay`'s comparison.
 */
export function matchPart(
  run: readonly DayEntry[],
  before: number,
  part: readonly DayEntry[],
  window: DateWindow,
): boolean {
  const first = run[0];
  const last = run.at(-1);
  const opens = part[0];
  const ends = part.at(-1);
  if (first === undefined || last === undefined || opens === undefined || ends === undefined) {
    return false;
  }
  const after = run.length - before - part.length;
  if (before < 0 || after < 0) return false;
  if (!part.every((row) => withinWindow(last.date, row.date, window))) return false;
  const rest = run.map((row) => row.amountCents);
  for (const row of part) {
    const at = rest.indexOf(row.amountCents);
    if (at === -1) return false;
    rest.splice(at, 1);
  }
  const dayOpening = first.balanceCents - first.amountCents;
  const partOpening = opens.balanceCents - opens.amountCents;
  if (before === 0) return partOpening === dayOpening;
  if (after === 0) return ends.balanceCents === last.balanceCents;
  if (run.length > LONGEST_SEARCHED_DAY) return false;
  return someAddUpTo(rest, before, partOpening - dayOpening);
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
 * day, a day at either end cut where the stretch is (`matchDay`): for each
 * workbook row, the position of its bank row, or `null` when the two stretches
 * are not the same movements.
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
