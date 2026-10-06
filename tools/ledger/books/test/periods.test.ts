/**
 * Periods (lg-6): a recurring item's dated lines, which period a date falls in,
 * and matching a closed period's deposit to the row that brought it in. Every
 * date and amount is invented.
 */

import { describe, expect, test } from "vitest";
import {
  dayAfter,
  enteredLate,
  matchDeposits,
  periodIndexOf,
  recurringDates,
} from "../src/index.ts";
import type { CandidateRow, Expectation } from "../src/index.ts";

describe("recurringDates", () => {
  test("one line a month, on the start's day of the month", () => {
    expect(recurringDates({ startDate: "2026-01-15", endDate: null }, "2026-04-14")).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
  });

  test("on a month's last day when the month is shorter than the start's day", () => {
    expect(recurringDates({ startDate: "2027-01-31", endDate: null }, "2028-04-30")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
      "2027-06-30",
      "2027-07-31",
      "2027-08-31",
      "2027-09-30",
      "2027-10-31",
      "2027-11-30",
      "2027-12-31",
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
      "2028-04-30",
    ]);
  });

  test("none after its end date", () => {
    expect(
      recurringDates({ startDate: "2026-01-01", endDate: "2026-03-01" }, "2026-12-31"),
    ).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  test("none before its start", () => {
    expect(recurringDates({ startDate: "2026-05-01", endDate: null }, "2026-04-30")).toEqual([]);
  });
});

describe("a period spanning a new year", () => {
  test("holds exactly the months it covers", () => {
    // November to February: four months, where the workbook's older
    // MONTH(end) − MONTH(start) made it −9 (§6).
    const periods = [
      { start: "2025-07-01", end: "2025-10-31" },
      { start: "2025-11-01", end: "2026-02-28" },
    ];
    const lines = recurringDates({ startDate: "2025-06-10", endDate: null }, "2026-06-30");

    const held = lines.filter((date) => periodIndexOf(periods, date) === 1);

    expect(held).toEqual(["2025-11-10", "2025-12-10", "2026-01-10", "2026-02-10"]);
  });
});

describe("periodIndexOf", () => {
  const periods = [
    { start: "2026-01-01", end: "2026-03-31" },
    { start: "2026-04-01", end: "2026-06-30" },
  ];

  test("a date belongs to the period whose days include it, ends included", () => {
    expect(periodIndexOf(periods, "2026-01-01")).toBe(0);
    expect(periodIndexOf(periods, "2026-03-31")).toBe(0);
    expect(periodIndexOf(periods, "2026-04-01")).toBe(1);
    expect(periodIndexOf(periods, "2026-06-30")).toBe(1);
  });

  test("nothing before the first period's start, or after the last's end", () => {
    expect(periodIndexOf(periods, "2025-12-31")).toBe(-1);
    expect(periodIndexOf(periods, "2026-07-01")).toBe(-1);
  });

  test("the first period from the beginning holds every earlier date", () => {
    expect(periodIndexOf([{ start: null, end: "2026-03-31" }], "1999-01-01")).toBe(0);
  });

  test("a gap goes to the later period and an overlap to the earlier, so each date counts once", () => {
    const uneven = [
      { start: "2026-01-01", end: "2026-03-31" },
      { start: "2026-04-10", end: "2026-06-30" },
      { start: "2026-06-01", end: "2026-09-30" },
    ];
    expect(periodIndexOf(uneven, "2026-04-05")).toBe(1);
    expect(periodIndexOf(uneven, "2026-06-15")).toBe(1);
  });
});

describe("dayAfter", () => {
  test("crosses a month, a year and a leap day", () => {
    expect(dayAfter("2026-01-31")).toBe("2026-02-01");
    expect(dayAfter("2025-12-31")).toBe("2026-01-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("2027-02-28")).toBe("2027-03-01");
  });
});

function expecting(
  periodId: number,
  end: string,
  depositCents: number | null,
  payerId: string | null = "alex",
): Expectation {
  return { periodId, end, payerId, depositCents };
}

function row(id: number, date: string, amountCents: number, personId = "alex"): CandidateRow {
  return { id, date, amountCents, personId };
}

describe("matchDeposits", () => {
  test("a row filed to the payer, on or after the end, within a cent, is the deposit", () => {
    const matches = matchDeposits(
      [expecting(1, "2026-03-31", 15_000)],
      [row(9, "2026-04-02", 14_999)],
    );

    expect(matches).toEqual([{ periodId: 1, status: "matched", rowId: 9 }]);
  });

  test("two cents off, another person's, or dated before the end, it is still expected", () => {
    const rows = [
      row(1, "2026-04-02", 15_002),
      row(2, "2026-04-02", 15_000, "sam"),
      row(3, "2026-03-30", 15_000),
    ];

    expect(matchDeposits([expecting(1, "2026-03-31", 15_000)], rows)).toEqual([
      { periodId: 1, status: "expected", rowId: null },
    ]);
  });

  test("an earlier deposit never made is folded into the later close, which the one payment settles", () => {
    // The second close asked for the first period's 150 again, and nothing more.
    const expectations = [expecting(1, "2026-03-31", 15_000), expecting(2, "2026-06-30", 15_000)];

    expect(matchDeposits(expectations, [row(7, "2026-07-03", 15_000)])).toEqual([
      { periodId: 1, status: "folded", rowId: null },
      { periodId: 2, status: "matched", rowId: 7 },
    ]);
  });

  test("a deposit made on time is the earlier close's, which the later cannot take", () => {
    const expectations = [expecting(1, "2026-03-31", 15_000), expecting(2, "2026-06-30", 15_000)];
    const rows = [row(4, "2026-04-02", 15_000), row(8, "2026-07-02", 15_000)];

    expect(matchDeposits(expectations, rows)).toEqual([
      { periodId: 1, status: "matched", rowId: 4 },
      { periodId: 2, status: "matched", rowId: 8 },
    ]);
  });

  test("nothing owed, or owed only directly, awaits no deposit", () => {
    const expectations = [expecting(1, "2026-03-31", 0, null), expecting(2, "2026-06-30", null)];

    expect(matchDeposits(expectations, [row(1, "2026-07-01", 0)])).toEqual([
      { periodId: 1, status: "none", rowId: null },
      { periodId: 2, status: "direct", rowId: null },
    ]);
  });
});

// Gate 1, low 6: the period's last day itself.
describe("matchDeposits, on the boundary", () => {
  test("a deposit dated on the period's last day is its deposit", () => {
    const matches = matchDeposits(
      [expecting(1, "2026-03-31", 15_000)],
      [row(5, "2026-03-31", 15_000)],
    );

    expect(matches).toEqual([{ periodId: 1, status: "matched", rowId: 5 }]);
  });
});

// Gate 1, med 3: what the open period lists as late.
describe("enteredLate", () => {
  const closed = [
    { start: null, end: "2026-06-30", closedAt: "2026-07-01T20:00:00.000Z" },
    { start: "2026-07-01", end: "2026-09-30", closedAt: "2026-10-01T09:00:00.000Z" },
  ];

  test("dated in a closed period and first entered after the last close", () => {
    expect(enteredLate(closed, "2026-09-15", "2026-10-02T08:00:00.000Z")).toBe(true);
    expect(enteredLate(closed, "2026-03-01", "2026-10-02T08:00:00.000Z")).toBe(true);
  });

  // Gate 2, med 5: a later close counted it, so it is late no longer.
  test("not once a later close has counted it, though its own period closed before it", () => {
    expect(enteredLate(closed, "2026-03-01", "2026-07-02T08:00:00.000Z")).toBe(false);
  });

  test("not when it was entered before its period closed, even after an earlier one did", () => {
    expect(enteredLate(closed, "2026-09-15", "2026-09-16T08:00:00.000Z")).toBe(false);
  });

  test("not when it is dated after every closed period", () => {
    expect(enteredLate(closed, "2026-10-01", "2026-10-02T08:00:00.000Z")).toBe(false);
  });

  test("never while nothing has closed", () => {
    expect(enteredLate([], "2026-09-15", "2026-10-02T08:00:00.000Z")).toBe(false);
  });
});
