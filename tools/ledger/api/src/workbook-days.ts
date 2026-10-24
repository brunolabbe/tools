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
 * **A stored paste says which of its rows the workbook dates otherwise**
 * (lg-58). The match answers a pairing, each pasted row with the workbook row it
 * is (`matchStretch`), and the paste names every pasted row paired with a row of
 * another date. Within a block only amounts are weighed, so a pairing amount for
 * amount is chosen that agrees on dates wherever it can (`pairAmounts`), and
 * among the cuttings that match, the one with the fewest rows dated otherwise,
 * then the fewest days apart. So a paste names as few rows as any matching
 * cutting would, each beside a nearby workbook date.
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
 *
 * A workbook row dated 4 or more days off is not weighed. A paste like R1 (the
 * true reading never fits, so a false split is the only one left) against such a
 * row is still stored with the wrong split, as it is on `main`.
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

// A search weighs the same few dates hundreds of thousands of times, and parsing
// one is most of what weighing a pair costs (lg-58). A ledger holds a few
// thousand dates in all, so the cache stays small.
const DAY_NUMBERS = new Map<string, number>();

/** A `yyyy-mm-dd` date as a count of days, for distances between dates. */
function dayNumber(date: string): number {
  let day = DAY_NUMBERS.get(date);
  if (day === undefined) {
    day = Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    DAY_NUMBERS.set(date, day);
  }
  return day;
}

/** How many calendar days apart two `yyyy-mm-dd` dates are, either way round. */
export function daysApart(one: string, other: string): number {
  return one === other ? 0 : Math.abs(dayNumber(one) - dayNumber(other));
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

/**
 * Whether `count` of `amounts` add up to `sum`.
 *
 * A middle part's search calls this for every block that holds it, so it does
 * only what can still answer (lg-65): taking `count` of them is leaving the
 * others, so the smaller of the two is searched; a sum is carried only while
 * enough amounts are left to make up the count; and each amount extends the sums
 * in place, the largest counts first, instead of copying every set.
 */
function someAddUpTo(amounts: readonly number[], count: number, sum: number): boolean {
  if (count > amounts.length) return false;
  const total = amounts.reduce((all, amount) => all + amount, 0);
  const leaving = amounts.length - count < count;
  const taking = leaving ? amounts.length - count : count;
  const target = leaving ? total - sum : sum;
  // The sums reachable with each number of the amounts taken.
  const reachable: Set<number>[] = Array.from({ length: taking + 1 }, () => new Set<number>());
  (reachable[0] as Set<number>).add(0);
  for (const [index, amount] of amounts.entries()) {
    const left = amounts.length - index;
    for (let taken = Math.min(taking - 1, index); taken >= Math.max(0, taking - left); taken--) {
      const into = reachable[taken + 1] as Set<number>;
      for (const reached of reachable[taken] as Set<number>) into.add(reached + amount);
    }
  }
  return (reachable[taking] as Set<number>).has(target);
}

/** Some of a run's rows of one amount and one date, and how many are taken. */
interface FreeRows {
  readonly rows: number[];
  next: number;
}

/** The first of `free`'s rows not yet taken, now taken; none when all are. */
function take(free: FreeRows | undefined): number | undefined {
  if (free === undefined || free.next >= free.rows.length) return undefined;
  free.next += 1;
  return free.rows[free.next - 1];
}

/**
 * Which of `run`'s rows each of `part`'s is, amount for amount, or `null` when
 * `run` does not hold `part`'s amounts, counted with their repeats (lg-58).
 *
 * The amounts are all the rule weighs, so to it any pairing amount for amount is
 * as good as another. This one agrees on dates wherever it can: as many rows as
 * possible are paired with one of the same amount and the same date, and each
 * row left is paired with the nearest-dated row of its amount still free. So as
 * few rows are paired with another date as any pairing of the block allows, and
 * the bank's dates among them are the same whichever pairing it was.
 */
function pairAmounts(
  run: readonly DayEntry[],
  part: readonly DayEntry[],
  before: number,
): number[] | null {
  // Where the workbook lists the bank's rows as the bank does, amount and date,
  // the pairing is the rows in their places: every row is dated alike. This is
  // most of what a search weighs, so it is answered without building anything.
  if (
    part.every((row, offset) => {
      const kept = run[before + offset];
      return kept?.amountCents === row.amountCents && kept.date === row.date;
    })
  ) {
    return part.map((_, offset) => before + offset);
  }
  // The run's rows by amount, then by date, each list in the run's order with a
  // cursor at its first row not yet taken. A search weighs this many times over
  // on days of hundreds of rows, so nothing here scans the run once per row.
  const byAmount = new Map<number, Map<string, FreeRows>>();
  for (const [index, row] of run.entries()) {
    let dates = byAmount.get(row.amountCents);
    if (dates === undefined) {
      dates = new Map();
      byAmount.set(row.amountCents, dates);
    }
    const free = dates.get(row.date);
    if (free === undefined) dates.set(row.date, { rows: [index], next: 0 });
    else free.rows.push(index);
  }
  const pairing: number[] = Array.from({ length: part.length }, () => -1);
  const left: number[] = [];
  for (const [offset, row] of part.entries()) {
    const at = take(byAmount.get(row.amountCents)?.get(row.date));
    if (at === undefined) left.push(offset);
    else pairing[offset] = at;
  }
  for (const offset of left) {
    const row = part[offset] as DayEntry;
    let nearest: FreeRows | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const [date, free] of byAmount.get(row.amountCents) ?? []) {
      const apart = free.next < free.rows.length ? daysApart(date, row.date) : distance;
      if (apart < distance) {
        nearest = free;
        distance = apart;
      }
    }
    const at = take(nearest);
    if (at === undefined) return null;
    pairing[offset] = at;
  }
  return pairing;
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
 *
 * It answers which of `run`'s rows each of `part`'s is, an index into `run` for
 * each (`pairAmounts`), or `null` when the part does not fit (lg-58).
 */
export function matchPart(
  run: readonly DayEntry[],
  before: number,
  part: readonly DayEntry[],
  window: DateWindow,
): number[] | null {
  const first = run[0];
  const last = run.at(-1);
  const opens = part[0];
  const ends = part.at(-1);
  if (first === undefined || last === undefined || opens === undefined || ends === undefined) {
    return null;
  }
  const after = run.length - before - part.length;
  if (before < 0 || after < 0) return null;
  if (!part.every((row) => withinWindow(last.date, row.date, window))) return null;
  // The balances first: they refuse most of what a search weighs, and cost nothing.
  const dayOpening = first.balanceCents - first.amountCents;
  const partOpening = opens.balanceCents - opens.amountCents;
  if (before === 0 && partOpening !== dayOpening) return null;
  if (before > 0 && after === 0 && ends.balanceCents !== last.balanceCents) return null;
  const middle = before > 0 && after > 0;
  if (middle && run.length > LONGEST_SEARCHED_DAY) return null;
  const pairing = pairAmounts(run, part, before);
  if (pairing === null || !middle) return pairing;
  // Which row of an amount the part takes leaves the same amounts over.
  const paired = new Set(pairing);
  const rest = run.filter((_, index) => !paired.has(index)).map((row) => row.amountCents);
  return someAddUpTo(rest, before, partOpening - dayOpening) ? pairing : null;
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
 * This is the one place a pasted row meets the workbook's rows of its day, and
 * the pairing a stored paste rests on is decided here, in `matchPart`'s call: it
 * answers which of `block`'s rows each of `part`'s is, or `null` when the part
 * does not fit. `matchStretch` gathers those into the stretch's pairing, and a
 * paste reports the dates that pairing shows differing (lg-58). Only the stored
 * pass's pairing is ever reported: the rival pass (`RIVAL_TOLERANCE`) runs
 * through this same code, with its 3-day readings, and only refuses.
 */
export function matchBlock(
  block: readonly DayEntry[],
  before: number,
  part: readonly DayEntry[],
  tolerance: DateTolerance = STORED_TOLERANCE,
): number[] | null {
  if (block.length === 0) return null;
  const days = block.map((row) => dayNumber(row.date));
  const earliest = Math.min(...days);
  const latest = Math.max(...days);
  if (latest - earliest > tolerance.widestBlockDays) return null;
  const dated = part.every((row) => {
    const day = dayNumber(row.date);
    return day >= earliest - tolerance.daysOff && day <= latest + tolerance.daysOff;
  });
  return dated ? matchPart(block, before, part, "any") : null;
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

/** How the best cutting reaching a cut got there, for `matchStretch`. */
interface Reach {
  /** How many pasted rows the cutting pairs with a stored row of another date. */
  readonly differing: number;
  /** How many days apart those pairs are, summed. */
  readonly apart: number;
  /** The cut its last block begins on, or `-1` at the first cut. */
  readonly from: number;
  /** The last block's first pasted row, as a position in `rows`. */
  readonly inside: number;
  /** For each of the last block's pasted rows, the position in `rows` of its row. */
  readonly pairs: readonly number[];
}

/** A pairing of no rows: a block wholly outside the stretch. */
const NO_PAIRS: readonly number[] = [];

/** The first index in `positions`, ascending, holding `at` or more. */
function firstFrom(positions: readonly number[], at: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((positions[middle] as number) < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Every row's position in `rows`, by amount, then by date, each list ascending. */
function positionsByAmount(rows: readonly DayEntry[]): Map<number, Map<string, number[]>> {
  const byAmount = new Map<number, Map<string, number[]>>();
  for (const [position, row] of rows.entries()) {
    let dates = byAmount.get(row.amountCents);
    if (dates === undefined) {
      dates = new Map();
      byAmount.set(row.amountCents, dates);
    }
    const positions = dates.get(row.date);
    if (positions === undefined) dates.set(row.date, [position]);
    else positions.push(position);
  }
  return byAmount;
}

/**
 * `pairAmounts` for the block `rows[opens, closes)` and the part `pasted[from, to)`,
 * as positions in `rows`, read from `byAmount` instead of built from the block
 * (lg-65). A search weighs hundreds of blocks of hundreds of rows against a part of
 * a few, and building the block's lists cost more than all the rest of the weighing.
 *
 * The answer is `pairAmounts`'s, step for step: the rows in their places when every
 * one agrees on amount and date; otherwise each pasted row in turn takes the first
 * free row of its amount and date, and each left over, in turn, the first free row
 * of the nearest date of its amount, the first date the block lists winning a tie.
 */
function pairAt(
  byAmount: Map<number, Map<string, number[]>>,
  rows: readonly DayEntry[],
  opens: number,
  closes: number,
  pasted: readonly DayEntry[],
  from: number,
  to: number,
  before: number,
): number[] | null {
  let inPlace = true;
  for (let offset = 0; offset < to - from; offset++) {
    const kept = rows[opens + before + offset] as DayEntry;
    const row = pasted[from + offset] as DayEntry;
    if (kept.amountCents !== row.amountCents || kept.date !== row.date) {
      inPlace = false;
      break;
    }
  }
  if (inPlace) return Array.from({ length: to - from }, (_, offset) => opens + before + offset);
  // For each amount-and-date list, the index of its first row in the block not yet taken.
  const next = new Map<readonly number[], number>();
  const cursor = (positions: readonly number[]): number => {
    let at = next.get(positions);
    if (at === undefined) {
      at = firstFrom(positions, opens);
      next.set(positions, at);
    }
    return at;
  };
  const free = (positions: readonly number[]): boolean =>
    ((positions[cursor(positions)] ?? closes) as number) < closes;
  const takeFrom = (positions: readonly number[]): number => {
    const at = cursor(positions);
    next.set(positions, at + 1);
    return positions[at] as number;
  };
  const pairing: number[] = Array.from({ length: to - from }, () => -1);
  const left: number[] = [];
  for (let offset = 0; offset < to - from; offset++) {
    const row = pasted[from + offset] as DayEntry;
    const positions = byAmount.get(row.amountCents)?.get(row.date);
    if (positions !== undefined && free(positions)) pairing[offset] = takeFrom(positions);
    else left.push(offset);
  }
  for (const offset of left) {
    const row = pasted[from + offset] as DayEntry;
    // The dates of its amount in the order the block first lists them, as
    // `pairAmounts`'s map holds them.
    const dates: { date: string; positions: number[]; first: number }[] = [];
    for (const [date, positions] of byAmount.get(row.amountCents) ?? []) {
      const first = positions[firstFrom(positions, opens)];
      if (first !== undefined && first < closes) dates.push({ date, positions, first });
    }
    dates.sort((one, other) => one.first - other.first);
    let nearest: number[] | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const { date, positions } of dates) {
      if (!free(positions)) continue;
      const apart = daysApart(date, row.date);
      if (apart < distance) {
        nearest = positions;
        distance = apart;
      }
    }
    if (nearest === undefined) return null;
    pairing[offset] = takeFrom(nearest);
  }
  return pairing;
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
 *
 * It answers the pairing: for each pasted row, the position in `rows` of the
 * stored row it is, or `null` when no cutting matches (lg-58). Where several
 * cuttings match, the pairing is the one with the fewest pasted rows paired with
 * a stored row of another date, then the fewest days apart in all by the
 * pairing `pairAmounts` finds, then the first found: a paste reports as few
 * dates as a matching cutting allows, each beside a nearby date.
 *
 * **The search skips only blocks whose answer is known without weighing them**
 * (lg-65). Where the workbook's date changes at almost every row, almost every row
 * is a cut, and weighing every pair of cuts held the write lock for a minute on a
 * 300-row workbook. The answers are those of `main` before lg-65 for every input,
 * pairing included (`test/lg-65-search.test.ts` checks them against that search,
 * kept verbatim in `test/helpers/reference-search.ts`). What is skipped, and why it
 * changes nothing:
 *
 * - **Blocks wholly before the stretch.** They pair nothing, so every cut up to
 *   the stretch's first row is reached with no row dated otherwise, which no
 *   cutting improves on; those cuts are set, not searched.
 * - **Blocks that hold the whole stretch and more than `LONGEST_SEARCHED_DAY`
 *   rows.** `matchPart` refuses every one, and every longer block from the same
 *   cut is one, so the cut's search stops there.
 * - **Blocks whose balances cannot agree.** A block opening inside the stretch must
 *   open on its pasted row's opening balance, whatever its end; a block opening
 *   before the stretch and ending inside it must end on its pasted row's balance,
 *   whatever its start. These are `matchPart`'s first checks, made before the
 *   block is built.
 * - **Building each block.** Its dates' range and whether it holds a paste's row
 *   grow with it, so they are kept as the block grows, not recomputed; and its
 *   pairing is read from lists of the rows by amount and date (`pairAt`).
 */
export function matchStretch(
  rows: readonly StretchRow[],
  start: number,
  pasted: readonly DayEntry[],
  same: (offset: number) => boolean,
  tolerance: DateTolerance = STORED_TOLERANCE,
): number[] | null {
  const end = start + pasted.length;
  if (start < 0 || end > rows.length) return null;
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
  const days = rows.map((row) => dayNumber(row.date));
  const pastedDays = pasted.map((row) => dayNumber(row.date));
  let byAmount: Map<number, Map<string, number[]>> | undefined;
  // The first cut past the stretch's first row. Every cut before it ends blocks
  // wholly before the stretch, which pair nothing: each is reached from the one
  // before it by a block of one date, with no row dated otherwise.
  let past = 0;
  while (past < cuts.length && (cuts[past] as number) <= start) past += 1;
  const reached: (Reach | undefined)[] = cuts.map((_, index) =>
    index < past
      ? { differing: 0, apart: 0, from: index - 1, inside: start, pairs: NO_PAIRS }
      : undefined,
  );
  // The dates' range of the rows from each position to the cut past the stretch's
  // first row, and whether they are all the workbook's: a block from a cut before
  // the stretch reaches that far before it is weighed.
  const reachFirst = cuts[past] ?? rows.length;
  const lowestTo: number[] = Array.from({ length: reachFirst + 1 }, () => Infinity);
  const highestTo: number[] = Array.from({ length: reachFirst + 1 }, () => -Infinity);
  const workbookTo: boolean[] = Array.from({ length: reachFirst + 1 }, () => true);
  for (let position = reachFirst - 1; position >= 0; position--) {
    const day = days[position] as number;
    lowestTo[position] = Math.min(day, lowestTo[position + 1] as number);
    highestTo[position] = Math.max(day, highestTo[position + 1] as number);
    workbookTo[position] =
      (rows[position] as StretchRow).fromWorkbook && (workbookTo[position + 1] as boolean);
  }
  // The best cutting reaching each cut. A block ending on a cut begins on an
  // earlier one, so a cut's best is settled before any block begins on it.
  const weigh = (from: number, to: number, inside: number, pairs: readonly number[]): void => {
    const origin = reached[from] as Reach;
    let differing = origin.differing;
    let apart = origin.apart;
    for (const [offset, position] of pairs.entries()) {
      const kept = (rows[position] as StretchRow).date;
      const bank = (pasted[inside - start + offset] as DayEntry).date;
      if (kept !== bank) {
        differing += 1;
        apart += daysApart(kept, bank);
      }
    }
    const best = reached[to];
    if (
      best === undefined ||
      differing < best.differing ||
      (differing === best.differing && apart < best.apart)
    ) {
      reached[to] = { differing, apart, from, inside, pairs };
    }
  };
  for (const [from, opens] of cuts.entries()) {
    if (reached[from] === undefined || from === cuts.length - 1) continue;
    const first = rows[opens] as StretchRow;
    const inside = Math.max(opens, start);
    if (!first.fromWorkbook) {
      // A row a paste stored is a block of its own, compared field for field.
      const closes = cuts[from + 1] as number;
      if (from + 1 < past) continue;
      const outside = Math.min(closes, end);
      if (inside >= outside) weigh(from, from + 1, inside, NO_PAIRS);
      else if (same(inside - start)) weigh(from, from + 1, inside, [opens]);
      continue;
    }
    if (opens >= start && opens < end) {
      const row = pasted[opens - start] as DayEntry;
      if (row.balanceCents - row.amountCents !== first.balanceCents - first.amountCents) continue;
    }
    let to = Math.max(from + 1, past);
    let lowest = Infinity;
    let highest = -Infinity;
    let workbookOnly = true;
    let grown = opens;
    if (to > from + 1) {
      lowest = lowestTo[opens] as number;
      highest = highestTo[opens] as number;
      workbookOnly = workbookTo[opens] as boolean;
      grown = reachFirst;
    }
    for (; to < cuts.length; to++) {
      const closes = cuts[to] as number;
      for (; grown < closes; grown++) {
        const day = days[grown] as number;
        if (day < lowest) lowest = day;
        if (day > highest) highest = day;
        if (!(rows[grown] as StretchRow).fromWorkbook) workbookOnly = false;
      }
      // A longer block holds this one's rows too, so it cannot fit either.
      if (!workbookOnly || highest - lowest > tolerance.widestBlockDays) break;
      const outside = Math.min(closes, end);
      if (inside >= outside) {
        weigh(from, to, inside, NO_PAIRS);
        continue;
      }
      const before = inside - opens;
      const after = closes - outside;
      let pairs: readonly number[] | null;
      if (before > 0 && after > 0) {
        if (closes - opens > LONGEST_SEARCHED_DAY) break;
        pairs =
          matchBlock(
            rows.slice(opens, closes),
            before,
            pasted.slice(inside - start, outside - start),
            tolerance,
          )?.map((index) => opens + index) ?? null;
      } else if (
        before > 0 &&
        (pasted[outside - 1 - start] as DayEntry).balanceCents !==
          (rows[closes - 1] as StretchRow).balanceCents
      ) {
        pairs = null;
      } else if (
        pastedDays
          .slice(inside - start, outside - start)
          .some((day) => day < lowest - tolerance.daysOff || day > highest + tolerance.daysOff)
      ) {
        pairs = null;
      } else {
        byAmount ??= positionsByAmount(rows);
        pairs = pairAt(
          byAmount,
          rows,
          opens,
          closes,
          pasted,
          inside - start,
          outside - start,
          before,
        );
      }
      if (pairs !== null) weigh(from, to, inside, pairs);
    }
  }
  // Walked back from the last cut, each block's pairs put in their places.
  let at = reached.at(-1);
  if (at === undefined) return null;
  const pairing: number[] = Array.from({ length: pasted.length }, () => -1);
  while (at !== undefined && at.from !== -1) {
    for (const [offset, position] of at.pairs.entries()) {
      pairing[at.inside - start + offset] = position;
    }
    at = reached[at.from];
  }
  return pairing;
}
