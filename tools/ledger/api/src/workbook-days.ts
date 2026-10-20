/**
 * Whether a stretch of the workbook's rows and a stretch of the bank's are the
 * same movements of the account (lg-40, lg-59). Used both ways round: by a paste
 * meeting rows the workbook imported (`statements.ts`, `matchStretch`), and by
 * the workbook import meeting rows a paste stored (`workbook-import.ts`,
 * `alignDays`). The two cut the workbook's rows differently, as below.
 *
 * The workbook was kept by hand, so it differs from the bank in three ways that
 * are not disagreements about money: its wording is its own, it dates a row a
 * day off now and then, and it lists a day's movements in its own order. So the
 * two are compared **day by day**, a day being a stretch of consecutive
 * workbook rows and the bank's rows at the same positions its counterpart: as
 * many rows, in the bank's order.
 *
 * - A day and its counterpart **hold the same amounts**, counted with their
 *   repeats, and **end on the same balance**. Since each day ends where the
 *   bank's does, every day opens where the bank's does too, so the balances
 *   line up at every boundary between days; within a day only the order may
 *   differ, and each side has already proven its own running balance.
 * - **Within a day, only the workbook's opening and closing balances are
 *   real.** The balances it shows between them follow its own order, not the
 *   bank's, so nothing is ever compared with them.
 * - **Wording is never compared**: not the description, not the category.
 *
 * **A paste reads a day as a block of up to three calendar dates** (lg-59,
 * `matchStretch`). Its days are any cutting of the stretch into blocks of
 * consecutive workbook rows, each block's dates no more than
 * `WIDEST_BLOCK_DAYS` (2) days apart, that matches block by block. A cut falls
 * where the workbook's date changes, and also between two rows it dates alike
 * where the bank's date changes between the pasted rows in their places and
 * the balances agree there (`dayEnds`, lg-59 gate 1): two of the bank's days
 * the workbook dates alike where they meet are still two days. No other cut
 * falls inside a run of one date. Each of the bank's rows must be
 * dated within a day of the block's dates: from the day before its earliest to
 * the day after its latest. So a day the workbook both re-dated and reordered
 * matches: the bank's 21st of −5.00, −10.00, +10.00, which the workbook lists
 * as −10.00 on the 21st, −5.00 on the 20th and +10.00 on the 21st, is one block
 * from the 20th to the 21st holding the bank's three rows. Cut on the
 * workbook's dates alone, it was three runs, none of them the bank's
 * counterpart; the true reading was refused and a false one could be the only
 * reading left, storing rows twice (lg-59). A reading a block makes possible
 * counts like any other: a paste that two numbers of already-stored rows both
 * fit, through whichever cuttings, is refused as ambiguous. Rows dated more than two days apart are never one block, and a
 * bank row two days from every date of its block does not match it.
 *
 * **A reading is stored only when no rival reading fits with dates up to
 * `RIVAL_DAYS_OFF` (3) days off** (lg-61, `RIVAL_TOLERANCE`). Where the
 * workbook dated a row two or three days off the bank's, the true reading is
 * outside the tolerance above, and a false one, with rows that cancel, can be
 * the only reading left: a row stored twice, or a new bank row never stored.
 * So once one reading is found, the paste is read again with each bank row
 * allowed three days from its block's dates, and any other reading found there
 * refuses the paste as ambiguous. Nothing is ever stored on the wider reading,
 * so it can only refuse a paste, never store one differently.
 *
 * **A paste may start or end partway through one of those blocks**
 * (`matchPart`): its rows there are some of the block's, as the bank lists them
 * from a position the paste's place gives. They must be among the block's
 * amounts, and the bank's block must be able to reach the balance they open
 * from: from the block's opening when they are its first rows, to its closing
 * when they are its last, and when they are neither, through some of the
 * block's other amounts, as many as the bank listed before them. Comparing them
 * with the workbook's rows in the same positions instead would compare a
 * different part of the day whenever the order differs, which refused a correct
 * paste and could leave a false reading the only one (lg-40 gate 1, F1 and F2).
 * A part that starts and ends inside a block of more than
 * `LONGEST_SEARCHED_DAY` rows is refused: that search is not made.
 *
 * **The workbook import cuts its rows into runs of one date** (`dayRuns`,
 * `alignDays`), each bank row allowed any date, and a day where its own
 * listing puts the edge. Where the pastes start partway through a day, the
 * workbook's rows after the edge must hold the pasted rows' amounts and end on
 * their balance, as a whole day would. It adds the workbook's rows before the
 * edge, so those must be the rest of the day, which only the workbook's own
 * listing can say; admitting a part as a paste does would let it add the wrong
 * ones. A run of one row is lg-7's own comparison: amount and balance, one for
 * one. The import does not read blocks: a day it both re-dated and reordered is
 * still cut on its dates there, so `alignDays` does not match it.
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

/**
 * The most calendar days apart the dates of one block a paste reads may be
 * (lg-59): a day of the bank's, with a row the workbook dated a day before it and
 * one it dated a day after.
 */
export const WIDEST_BLOCK_DAYS = 2;

/**
 * How far from the dates of its block a paste reads a pasted row as dated: the
 * block's span, `widestBlockDays`, and how many days before its earliest date or
 * after its latest a row of the bank's may be, `daysOff`.
 */
export interface DateTolerance {
  readonly widestBlockDays: number;
  readonly daysOff: number;
}

/** The tolerance a paste is stored on (lg-59): a block two days wide, a row a day off it. */
export const STORED_TOLERANCE: DateTolerance = { widestBlockDays: WIDEST_BLOCK_DAYS, daysOff: 1 };

/**
 * The days off the wider tolerance allows (lg-61): a workbook row dated as far as
 * this from the bank's still makes a rival reading.
 */
export const RIVAL_DAYS_OFF = 3;

/**
 * The tolerance a stored reading must have no rival under (lg-61). A workbook row
 * dated two or three days off makes the true reading unreadable on
 * `STORED_TOLERANCE`, and then a false one could be the only reading left, so the
 * paste is read again on this one and any other reading found refuses it. No
 * paste is ever stored on it.
 */
export const RIVAL_TOLERANCE: DateTolerance = {
  widestBlockDays: WIDEST_BLOCK_DAYS,
  daysOff: RIVAL_DAYS_OFF,
};

/** The calendar day before a `yyyy-mm-dd` date. */
export function dayBefore(date: string): string {
  return daysAfter(date, -1);
}

/** The `yyyy-mm-dd` date `days` calendar days after `date`; before it when negative. */
export function daysAfter(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A `yyyy-mm-dd` date as a count of days, for distances between dates. */
function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
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

/**
 * Some of the bank's rows, `part`, as rows `before` to `before + part.length` of
 * one block of the workbook's rows a paste reads as one day (lg-59): the
 * block's dates no more than `tolerance.widestBlockDays` apart, each of `part`'s
 * within `tolerance.daysOff` of them (a day, on `STORED_TOLERANCE`), and the
 * amounts and balances as `matchPart` weighs them.
 *
 * This is the one place a pasted row meets the workbook's rows of its day: the
 * pairing a stored paste rests on is `matchPart`'s, called from here.
 */
export function matchBlock(
  block: readonly DayEntry[],
  before: number,
  part: readonly DayEntry[],
  tolerance: DateTolerance = STORED_TOLERANCE,
): boolean {
  if (block.length === 0) return false;
  const days = block.map((row) => dayNumber(row.date));
  const earliest = Math.min(...days);
  const latest = Math.max(...days);
  if (latest - earliest > tolerance.widestBlockDays) return false;
  const dated = part.every((row) => {
    const day = dayNumber(row.date);
    return day >= earliest - tolerance.daysOff && day <= latest + tolerance.daysOff;
  });
  return dated && matchPart(block, before, part, "any");
}

/**
 * Whether one of the bank's days ends between two pasted rows, `last` and
 * `next`, where the workbook lists `stored` last before them, dating it as it
 * dates the row after (lg-59, gate 1 F1). The bank's date changes there, and the
 * workbook's balance after `stored` is the bank's after `last`, as it is
 * wherever one day ends and the next begins on both sides. A cut is weighed
 * nowhere else inside a run of one date: where the balances differ no cutting
 * there could match, and where the bank's date does not change no bank day ends.
 * So such cuts are at most as many as the paste's days.
 */
function dayEnds(
  stored: DayEntry,
  last: DayEntry | undefined,
  next: DayEntry | undefined,
): boolean {
  if (last === undefined || next === undefined) return false;
  return last.date !== next.date && last.balanceCents === stored.balanceCents;
}

/** A stored row as a paste reads it: its date, amount and balance, and whose it is. */
export interface StretchRow extends DayEntry {
  readonly fromWorkbook: boolean;
}

/**
 * Whether stored rows are the pasted rows in their places, as a paste reads them
 * (lg-59). `rows` holds the stretch from position `start`, as many rows as
 * `pasted`, with the workbook's rows next to it on either side that a block
 * holding the stretch's end rows could take in. `same(offset)` compares a row a
 * paste stored, at `offset` in the stretch, with the pasted row in its place,
 * field for field.
 *
 * Some cutting of `rows` into blocks must match, each block a row a paste
 * stored or a stretch of the workbook's rows cut where its date changes, or
 * between two rows of one date where the bank's day ends (`dayEnds`)
 * (`matchBlock`). Blocks wholly outside the stretch are not compared: the rows
 * they hold are not the paste's. The cuttings are searched from the oldest row
 * up, as the set of cuts some matching cutting reaches, so no cutting is weighed
 * twice. `tolerance` is how far the blocks' dates may stray (`matchBlock`).
 */
export function matchStretch(
  rows: readonly StretchRow[],
  start: number,
  pasted: readonly DayEntry[],
  same: (offset: number) => boolean,
  tolerance: DateTolerance = STORED_TOLERANCE,
): boolean {
  const end = start + pasted.length;
  if (start < 0 || end > rows.length) return false;
  // Where a block may begin or end: wherever the workbook's date changes or a
  // row is a paste's, and between two rows the workbook dates alike where the
  // bank's day ends (`dayEnds`).
  const cuts = [0];
  for (let index = 1; index < rows.length; index++) {
    const left = rows[index - 1] as StretchRow;
    const right = rows[index] as StretchRow;
    if (
      !left.fromWorkbook ||
      !right.fromWorkbook ||
      left.date !== right.date ||
      dayEnds(left, pasted[index - 1 - start], pasted[index - start])
    ) {
      cuts.push(index);
    }
  }
  cuts.push(rows.length);
  const reached = cuts.map((_, index) => index === 0);
  for (const [from, opens] of cuts.entries()) {
    if (reached[from] !== true) continue;
    for (let to = from + 1; to < cuts.length; to++) {
      const closes = cuts[to] as number;
      const first = rows[opens] as StretchRow;
      const inside = Math.max(opens, start);
      const outside = Math.min(closes, end);
      let fits: boolean;
      if (!first.fromWorkbook) {
        // A row a paste stored is a block of its own, compared field for field.
        if (to !== from + 1) break;
        fits = inside >= outside || same(inside - start);
      } else {
        const block = rows.slice(opens, closes);
        // A longer block holds this one's rows too, so it cannot fit either.
        if (block.some((row) => !row.fromWorkbook)) break;
        const days = block.map((row) => dayNumber(row.date));
        if (Math.max(...days) - Math.min(...days) > tolerance.widestBlockDays) break;
        fits =
          inside >= outside ||
          matchBlock(
            block,
            inside - opens,
            pasted.slice(inside - start, outside - start),
            tolerance,
          );
      }
      if (fits) reached[to] = true;
    }
  }
  return reached.at(-1) === true;
}
