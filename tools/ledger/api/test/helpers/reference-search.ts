/**
 * `matchStretch` as `main` had it at `8a6dcf9a`, before lg-65, kept verbatim with
 * everything it calls, as the oracle lg-65's faster search is checked against: the
 * same pairing for the same input, or `null` for both (`lg-65-search.test.ts`).
 *
 * Only the `export` keywords and the imports changed, and the two constants it
 * reads are copied in with their values at `8a6dcf9a`: the spec replaces the
 * module with a wrapper (`vi.mock`), and a value import of it from here would
 * load the module from inside its own mock. A deliberate change to the rule (a
 * wider block, a longer searched day) is a change to this copy too. Nothing in
 * `src` imports it.
 */

import { dayAfter } from "@ledger/books";
import type { DateTolerance, DateWindow, DayEntry, StretchRow } from "../../src/workbook-days.ts";

/** `LONGEST_SEARCHED_DAY` at `8a6dcf9a`. */
const LONGEST_SEARCHED_DAY = 20;

/** `STORED_TOLERANCE` at `8a6dcf9a`. */
const STORED_TOLERANCE: DateTolerance = { widestBlockDays: 2, daysOff: 1 };

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
function daysApart(one: string, other: string): number {
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
function matchPart(
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
function matchBlock(
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
  // The best cutting reaching each cut. A block ending on a cut begins on an
  // earlier one, so a cut's best is settled before any block begins on it.
  const reached: (Reach | undefined)[] = cuts.map((_, index) =>
    index === 0 ? { differing: 0, apart: 0, from: -1, inside: start, pairs: [] } : undefined,
  );
  for (const [from, opens] of cuts.entries()) {
    const origin = reached[from];
    if (origin === undefined) continue;
    for (let to = from + 1; to < cuts.length; to++) {
      const closes = cuts[to] as number;
      const first = rows[opens] as StretchRow;
      const inside = Math.max(opens, start);
      const outside = Math.min(closes, end);
      let pairs: readonly number[] | null;
      if (!first.fromWorkbook) {
        // A row a paste stored is a block of its own, compared field for field.
        if (to !== from + 1) break;
        pairs = inside >= outside ? [] : same(inside - start) ? [opens] : null;
      } else {
        const block = rows.slice(opens, closes);
        // A longer block holds this one's rows too, so it cannot fit either.
        if (block.some((row) => !row.fromWorkbook)) break;
        const days = block.map((row) => dayNumber(row.date));
        if (Math.max(...days) - Math.min(...days) > tolerance.widestBlockDays) break;
        pairs =
          inside >= outside
            ? []
            : (matchBlock(
                block,
                inside - opens,
                pasted.slice(inside - start, outside - start),
                tolerance,
              )?.map((index) => opens + index) ?? null);
      }
      if (pairs === null) continue;
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
