/**
 * lg-65: the block search answers as it did before it was made faster, checked
 * directly. `lg-65-search.test.ts` runs `importStatement` over a seeded
 * population and compares what `main`'s search and lg-65's answer; this file
 * calls `matchStretch` itself, with no database, on inputs drawn to aim at the
 * places lg-65's shortcuts differ from `main`'s search, and compares the two
 * answers (`helpers/reference-search.ts` is `main`'s search at `8a6dcf9a`).
 *
 * Why a second check. The seeded one barely reaches the tie-break in `pairAt`,
 * which picks the date a leftover row is paired with when two are equally near:
 * deleting its `dates.sort` leaves the seeded spec green at its 200 seeds and
 * changes nothing in seeds 1 to 20,000's stored rows (gate 1, F1). Here the
 * same deletion fails at the committed count.
 *
 * What a case is. One bank history of 8 to 46 rows (a long day: 20 to 30), in
 * one of five date shapes, and the workbook's copy of it, re-dated and with
 * neighbours swapped. The paste is a slice of the bank, opening on a day
 * boundary about a third of the time, and the rows the search is handed are
 * the copy around it. Both date tolerances are drawn.
 *
 * - `alt`: the workbook dates a row a day off, every other row.
 * - `altwide`: it dates rows 0, 1 and 2 days off in turn.
 * - `const`: runs of 14 to 26 rows a date, so blocks straddle
 *   `LONGEST_SEARCHED_DAY`.
 * - `walk`: dates that stay or step by one or two days.
 * - `long`: one day of 18 to 24 rows in the middle, which is the block the
 *   cut-off at `LONGEST_SEARCHED_DAY` refuses or keeps.
 * - Amounts come from a pool of one to four values (or all nine a fifth of the
 *   time), so the same amount sits on several dates and the tie-break is reached.
 *
 * The three gaps gate 1 found in the seeded population (F2), and how each is
 * drawn here. The test counts them and fails if any is not drawn, so the draws
 * cannot drift away from them:
 *
 * - **A paste that cannot fit (`miss`) in an alternating or long-day history.**
 *   In every shape, about 15 % of the pastes have one row's amount changed by
 *   100 cents or one row's date moved a day (`mode` in `draw`). Some of those
 *   still find a reading, so the test also counts the ones the search refuses.
 * - **An alternating history over 40 rows.** `n` is drawn from 8 to 46 for
 *   every shape but `long`, so `alt` and `altwide` histories pass 40 rows.
 * - **Rows a paste stored inside an alternating run.** A share of the copy's
 *   rows (none a half of the time, then 10 % or 30 %) are replaced with the
 *   bank's own row, marked `fromWorkbook: false`, in every shape.
 *
 * `LG65_DIRECT_CASES` is `first-last` (case numbers); the suite runs the first
 * `DEFAULT_CASES`, about a second here. `LG65_DIRECT_SUMMARY=<file>` writes
 * the counts as JSON. The Log's larger run is this file with
 * `LG65_DIRECT_CASES=1-150000`.
 */

import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  matchStretch,
  RIVAL_TOLERANCE,
  STORED_TOLERANCE,
  type DateTolerance,
  type DayEntry,
  type StretchRow,
} from "../src/workbook-days.ts";
import { matchStretch as reference } from "./helpers/reference-search.ts";

/**
 * 5,000 cases, down from 20,000 (lg-69). lg-65's mutation table has the first
 * failing case of each planted mutant: M4 at 19, M3 at 65, M1 at 280 and M2 at
 * 1774, M2 (the deleted tie-break sort) being the rarest, 21 cases in 20,000.
 * 5,000 reaches all four with more than twice the margin on the latest. The
 * larger run is still one variable away (`LG65_DIRECT_CASES=1-150000`).
 */
const DEFAULT_CASES = 5_000;

/** A small seeded generator (mulberry32 over a hashed seed): the same case every run. */
function rng(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let m = state;
    m = Math.imul(m ^ (m >>> 15), m | 1);
    m ^= m + Math.imul(m ^ (m >>> 7), m | 61);
    return ((m ^ (m >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** `array[index]`, which the compiler cannot prove is there. */
function at<T>(array: readonly T[], index: number): T {
  const item = array[index];
  if (item === undefined) throw new Error(`no item at ${index} of ${array.length}`);
  return item;
}

const POOL = [1000, -1000, 500, -500, 250, -250, 1500, -300, 750];
const KINDS = ["alt", "const", "walk", "long", "altwide"] as const;
type Kind = (typeof KINDS)[number];
const OPENING_BALANCE = 1_000_000;

const dateOf = (day: number): string =>
  new Date(Date.UTC(2026, 0, 10) + day * 86_400_000).toISOString().slice(0, 10);

interface Bank {
  day: number;
  amount: number;
}

interface Drawn {
  kind: Kind;
  rows: StretchRow[];
  start: number;
  pasted: DayEntry[];
  same: (offset: number) => boolean;
  tolerance: DateTolerance;
  /** The bank's history is longer than 40 rows (the seeded population stops there). */
  over40: boolean;
  /** One pasted row was changed so that the paste cannot fit. */
  altered: boolean;
  /** `rows` holds a row a paste stored. */
  hasStored: boolean;
  /** A date-cut block of 20 or of 21 rows holds the stretch strictly inside. */
  holds20: boolean;
  holds21: boolean;
}

function draw(caseNumber: number): Drawn {
  const r = rng(caseNumber);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const kind = at(KINDS, int(0, KINDS.length - 1));
  const poolSize = r() < 0.2 ? POOL.length : int(1, 4);
  const pool = Array.from({ length: poolSize }, () => at(POOL, int(0, POOL.length - 1)));
  const n = kind === "long" ? int(20, 30) : int(8, 46);
  const run = kind === "alt" ? int(3, 30) : kind === "const" ? int(14, 26) : int(8, 26);
  const bank: Bank[] = [];
  let walk = 0;
  const longAt = int(0, 3);
  const longLen = int(18, 24);
  for (let i = 0; i < n; i++) {
    let day: number;
    if (kind === "alt" || kind === "altwide" || kind === "const") day = Math.floor(i / run);
    else if (kind === "walk") {
      const step = r();
      walk += step < 0.45 ? 0 : step < 0.85 ? 1 : 2;
      day = walk;
    } else {
      day = i < longAt ? i : i < longAt + longLen ? longAt : longAt + 1 + (i - longAt - longLen);
    }
    const amount =
      kind === "alt" ? (i % 2 === 0 ? 1000 : -1000) : at(pool, int(0, pool.length - 1));
    bank.push({ day, amount });
  }

  // The workbook's copy: re-dated, then neighbours swapped.
  const copy: Bank[] = bank.map((row, i) => {
    let day = row.day;
    if (kind === "alt") day += i % 2;
    else if (kind === "altwide") day += i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
    else if (r() < 0.3) {
      const size = r();
      const off = size < 0.7 ? 1 : size < 0.9 ? 2 : 3;
      day += r() < 0.5 ? -off : off;
    }
    return { day, amount: row.amount };
  });
  const swapRate = at([0, 0.1, 0.3, 0.6], int(0, 3));
  for (let i = 0; i + 1 < copy.length; i++) {
    if (r() < swapRate) {
      const kept = at(copy, i);
      copy[i] = at(copy, i + 1);
      copy[i + 1] = kept;
    }
  }
  const balancesOf = (history: readonly Bank[]): number[] => {
    let balance = OPENING_BALANCE;
    return history.map((row) => (balance += row.amount));
  };
  const bankBalances = balancesOf(bank);
  const copyBalances = balancesOf(copy);

  // A paste: a slice of the bank, opening on a day boundary a third of the time.
  const count = int(1, Math.min(8, n));
  let from = int(0, n - count);
  if (r() < 0.35) {
    const boundaries = bank
      .map((_, i) => i)
      .filter((i) => i > 0 && at(bank, i).day !== at(bank, i - 1).day && i + count <= n);
    if (boundaries.length > 0) from = at(boundaries, int(0, boundaries.length - 1));
  }
  const pasted: DayEntry[] = [];
  for (let i = from; i < from + count; i++) {
    const row = at(bank, i);
    pasted.push({
      date: dateOf(row.day),
      amountCents: row.amount,
      balanceCents: at(bankBalances, i),
    });
  }
  let altered = false;
  const mode = r();
  if (mode < 0.15) {
    // An amount changed by 100 cents, or left as it was: a paste that cannot fit
    // in the first case, one that can in the second.
    const place = int(0, pasted.length - 1);
    const row = at(pasted, place);
    const change = r() < 0.5 ? 100 : 0;
    pasted[place] = { ...row, amountCents: row.amountCents + change };
    altered = change !== 0;
  } else if (mode < 0.22) {
    // The bank dates a row another day.
    const place = int(0, pasted.length - 1);
    const row = at(pasted, place);
    pasted[place] = {
      ...row,
      date: dateOf(at(bank, from + place).day + (r() < 0.5 ? 1 : -1)),
    };
    altered = true;
  }

  const stored: StretchRow[] = copy.map((row, i) => ({
    date: dateOf(row.day),
    amountCents: row.amount,
    balanceCents: at(copyBalances, i),
    fromWorkbook: true,
  }));
  // Rows a paste stored: the bank's own row at the same place.
  const storedRate = at([0, 0, 0.1, 0.3], int(0, 3));
  const storedAt: number[] = [];
  for (let i = 0; i < stored.length; i++) {
    if (r() < storedRate) {
      const row = at(bank, i);
      stored[i] = {
        date: dateOf(row.day),
        amountCents: row.amount,
        balanceCents: at(bankBalances, i),
        fromWorkbook: false,
      };
      storedAt.push(i);
    }
  }

  const margins = [0, 1, 2, 5, 12, 100];
  const lo = Math.max(0, from - at(margins, int(0, 5)));
  const hi = Math.min(n, from + count + at(margins, int(0, 5)));
  const rows = stored.slice(lo, hi);
  const start = from - lo;
  const same = (offset: number): boolean => {
    const kept = at(rows, start + offset);
    const row = at(pasted, offset);
    return (
      kept.date === row.date &&
      kept.amountCents === row.amountCents &&
      kept.balanceCents === row.balanceCents
    );
  };

  // Coverage: a date-cut block holding the stretch strictly inside, of 20 or 21 rows.
  const cuts = [0];
  for (let i = 1; i < rows.length; i++) {
    const row = at(rows, i);
    const before = at(rows, i - 1);
    if (row.date !== before.date || !row.fromWorkbook || !before.fromWorkbook) cuts.push(i);
  }
  cuts.push(rows.length);
  let holds20 = false;
  let holds21 = false;
  for (const a of cuts) {
    for (const b of cuts) {
      if (a < start && b > start + pasted.length) {
        if (b - a === 20) holds20 = true;
        if (b - a === 21) holds21 = true;
      }
    }
  }
  return {
    kind,
    rows,
    start,
    pasted,
    same,
    tolerance: r() < 0.7 ? STORED_TOLERANCE : RIVAL_TOLERANCE,
    over40: n > 40,
    altered,
    hasStored: storedAt.some((i) => i >= lo && i < hi),
    holds20,
    holds21,
  };
}

/** The cases to run: `LG65_DIRECT_CASES` as `first-last`, or the first `DEFAULT_CASES`. */
function cases(): [number, number] {
  const [first, last] = (process.env.LG65_DIRECT_CASES ?? `1-${DEFAULT_CASES}`)
    .split("-")
    .map(Number);
  return [first ?? 1, last ?? DEFAULT_CASES];
}

test("matchStretch answers every drawn case as main's search did (lg-65)", () => {
  const [first, last] = cases();
  const differing: string[] = [];
  const found = new Map<Kind, { calls: number; found: number }>();
  const tally = {
    altOrLongAltered: 0,
    altOrLongRefused: 0,
    altOver40: 0,
    altWithStored: 0,
    holds20: 0,
    holds21: 0,
    found20: 0,
    found21: 0,
    foundTotal: 0,
  };
  for (let number = first; number <= last; number++) {
    const drawn = draw(number);
    const answer = (search: typeof matchStretch): string => {
      try {
        return JSON.stringify(
          search(drawn.rows, drawn.start, drawn.pasted, drawn.same, drawn.tolerance),
        );
      } catch (error: unknown) {
        return `threw ${String(error)}`;
      }
    };
    const mine = answer(matchStretch);
    const theirs = answer(reference);
    if (mine !== theirs)
      differing.push(`case ${number} (${drawn.kind}): ${mine} against ${theirs}`);

    const reading = theirs !== "null";
    const stat = found.get(drawn.kind) ?? { calls: 0, found: 0 };
    stat.calls += 1;
    if (reading) stat.found += 1;
    found.set(drawn.kind, stat);
    const alternating = drawn.kind === "alt" || drawn.kind === "altwide";
    if (reading) tally.foundTotal += 1;
    if (drawn.altered && (alternating || drawn.kind === "long")) {
      tally.altOrLongAltered += 1;
      // The draw altered the paste; whether `main`'s search then refused it is
      // what the F2 gap needs, so count that beside the altered count.
      if (!reading) tally.altOrLongRefused += 1;
    }
    if (drawn.over40 && alternating) tally.altOver40 += 1;
    if (drawn.hasStored && alternating) tally.altWithStored += 1;
    if (drawn.holds20) {
      tally.holds20 += 1;
      if (reading) tally.found20 += 1;
    }
    if (drawn.holds21) {
      tally.holds21 += 1;
      if (reading) tally.found21 += 1;
    }
  }
  const total = last - first + 1;
  if (process.env.LG65_DIRECT_SUMMARY !== undefined) {
    writeFileSync(
      process.env.LG65_DIRECT_SUMMARY,
      `${JSON.stringify({ cases: `${first}-${last}`, mismatches: differing.length, ...tally, byKind: Object.fromEntries(found), first: differing.slice(0, 5) }, null, 2)}\n`,
    );
  }
  expect(differing.slice(0, 5)).toEqual([]);
  // Not vacuous: the search found a reading in some cases and refused in others,
  // in every date shape, and the three gaps of the seeded population are drawn.
  expect(tally.foundTotal).toBeGreaterThan(0);
  expect(tally.foundTotal).toBeLessThan(total);
  expect(Array.from(found.keys()).toSorted()).toEqual(KINDS.toSorted());
  for (const stat of found.values()) {
    expect(stat.found).toBeGreaterThan(0);
    expect(stat.found).toBeLessThan(stat.calls);
  }
  expect(tally.altOrLongAltered).toBeGreaterThan(0);
  expect(tally.altOrLongRefused).toBeGreaterThan(0);
  expect(tally.altOver40).toBeGreaterThan(0);
  expect(tally.altWithStored).toBeGreaterThan(0);
  // The cut-off's two sides: a block of exactly 20 rows and of 21 hold the stretch,
  // and some of each are read.
  expect(tally.found20).toBeGreaterThan(0);
  expect(tally.found21).toBeGreaterThan(0);
});
