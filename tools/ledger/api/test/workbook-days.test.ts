/**
 * The rule a paste and the workbook import share for the workbook's rows
 * (lg-40): day by day, never by wording, the order within a day free. Every
 * amount and balance here is invented.
 */

import { describe, expect, test } from "vitest";
import {
  LONGEST_SEARCHED_DAY,
  alignDays,
  dayBefore,
  dayRuns,
  matchDay,
  matchPart,
} from "../src/workbook-days.ts";
import type { DayEntry } from "../src/workbook-days.ts";

/** Rows on one date from an opening balance, each with the balance after it. */
function day(date: string, opening: number, amounts: readonly number[]): DayEntry[] {
  let balance = opening;
  return amounts.map((amountCents) => {
    balance += amountCents;
    return { date, amountCents, balanceCents: balance };
  });
}

describe("dayBefore", () => {
  test.each([
    ["2026-03-10", "2026-03-09"],
    ["2026-03-01", "2026-02-28"],
    ["2024-03-01", "2024-02-29"],
    ["2026-01-01", "2025-12-31"],
  ])("the day before %s is %s", (date, before) => {
    expect(dayBefore(date)).toBe(before);
  });
});

describe("dayRuns", () => {
  test("cuts rows into stretches of one date, wherever a date returns", () => {
    const dates = ["2026-03-01", "2026-03-01", "2026-03-02", "2026-03-01"].map((date) => ({
      date,
    }));

    expect(dayRuns(dates)).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(dayRuns([])).toEqual([]);
  });
});

describe("matchDay: a whole day against the bank's rows in its place", () => {
  const workbook = day("2026-03-01", 100_000, [10_000, 5_000, -20_000]);
  const bank = day("2026-03-01", 100_000, [-20_000, 10_000, 5_000]);

  test("the same amounts in another order, ending on the same balance, pair each row with its own", () => {
    expect(matchDay(workbook, bank, "a day either side")).toEqual([1, 2, 0]);
  });

  test("amounts that differ by one row are refused, though the day ends on the same balance", () => {
    const other = day("2026-03-01", 100_000, [-20_000, 9_000, 6_000]);

    expect(matchDay(workbook, other, "a day either side")).toBeNull();
  });

  test("a day ending elsewhere is refused", () => {
    expect(
      matchDay(workbook, day("2026-03-01", 100_100, [-20_000, 10_000, 5_000]), "any"),
    ).toBeNull();
  });

  test("a paste allows a day either side and no more; the import allows any", () => {
    const later = bank.map((row) => ({ ...row, date: "2026-03-02" }));
    const twoDays = bank.map((row) => ({ ...row, date: "2026-03-03" }));

    expect(matchDay(workbook, later, "a day either side")).not.toBeNull();
    expect(matchDay(workbook, twoDays, "a day either side")).toBeNull();
    expect(matchDay(workbook, twoDays, "any")).not.toBeNull();
  });
});

describe("matchPart: some of a day's rows, as the bank lists them, against the whole day", () => {
  // The workbook lists the day +10.00, +0.50, −3.00, +0.70; the bank, −3.00,
  // +10.00, +0.70, +0.50. Both open from 1 000.00 and close on 1 008.20.
  const run = day("2026-03-05", 100_000, [1_000, 50, -300, 70]);
  const bank = day("2026-03-05", 100_000, [-300, 1_000, 70, 50]);

  test("the bank's first rows open from the day's opening balance", () => {
    expect(matchPart(run, 0, bank.slice(0, 2), "a day either side")).toBe(true);
    expect(matchPart(run, 0, bank.slice(1, 3), "a day either side")).toBe(false);
  });

  test("the bank's last rows close on the day's closing balance", () => {
    expect(matchPart(run, 2, bank.slice(2), "a day either side")).toBe(true);
    expect(matchPart(run, 1, bank.slice(1), "a day either side")).toBe(true);
    // Taken as the last two when they are the middle two: they close elsewhere.
    expect(matchPart(run, 2, bank.slice(1, 3), "a day either side")).toBe(false);
  });

  test("rows from the middle open where some of the day's other amounts, as many as came before, reach", () => {
    // One row came first, and 997.00, where these open, is 1 000.00 and −3.00.
    expect(matchPart(run, 1, bank.slice(1, 3), "a day either side")).toBe(true);
    // The same rows said to come after two others: no two of the rest reach 997.00.
    expect(matchPart(run, 2, bank.slice(1, 2), "a day either side")).toBe(false);
  });

  test("a pasted amount the day does not hold is refused wherever it is placed", () => {
    const stranger = day("2026-03-05", 99_700, [999]);

    for (const before of [0, 1, 2, 3]) {
      expect(matchPart(run, before, stranger, "any")).toBe(false);
    }
  });

  test("the part must fit inside the day, and is dated within the window", () => {
    expect(matchPart(run, 3, bank.slice(2), "any")).toBe(false);
    const late = bank.slice(2).map((row) => ({ ...row, date: "2026-03-07" }));
    expect(matchPart(run, 2, late, "a day either side")).toBe(false);
    expect(matchPart(run, 2, late, "any")).toBe(true);
  });

  test("a day longer than the search allows admits no part that starts and ends inside it", () => {
    const amounts = Array.from({ length: LONGEST_SEARCHED_DAY + 1 }, (_, index) => 100 + index);
    const long = day("2026-03-05", 100_000, amounts);
    const middle = long.slice(1, 2);

    expect(matchPart(long, 1, middle, "any")).toBe(false);
    // Its first and last rows are still weighed, since they need no search.
    expect(matchPart(long, 0, long.slice(0, 1), "any")).toBe(true);
    expect(matchPart(long, amounts.length - 1, long.slice(-1), "any")).toBe(true);
  });
});

describe("alignDays: a stretch of whole days, as the workbook import compares", () => {
  test("pairs each workbook row with its bank row, day by day", () => {
    const workbook = [
      ...day("2026-03-01", 100_000, [10_000, 5_000, -20_000]),
      ...day("2026-03-02", 95_000, [-1_000]),
    ];
    const bank = [
      ...day("2026-03-01", 100_000, [-20_000, 10_000, 5_000]),
      ...day("2026-03-02", 95_000, [-1_000]),
    ];

    expect(alignDays(workbook, bank, "any")).toEqual([1, 2, 0, 3]);
    expect(alignDays(workbook, bank.slice(1), "any")).toBeNull();
  });
});
