/**
 * The history's series (lg-9), each on a synthetic history: invented people,
 * invented amounts, one with a payment that changes at a renewal and one whose
 * year holds a ratio change.
 */

import { describe, expect, test } from "vitest";
import type { ClosedPeriod } from "@ledger/contract";
import {
  bufferSeries,
  contributionSeries,
  fixedItemsByMonth,
  mortgageAsOf,
  mortgageOwnSeries,
  mortgagePayments,
  salariesByYear,
  settlementsInRange,
  spendingByPeriod,
} from "../src/index.ts";
import type { SpendingEntry, SpendingSpan, StatRow } from "../src/index.ts";

const PEOPLE = ["alex", "sam"];
const ALL = { from: null, to: null };

let nextId = 1;
function row(
  date: string,
  amountCents: number,
  bucket: StatRow["bucket"],
  personId: string | null,
  description = "invented",
): StatRow {
  return { id: nextId++, date, description, amountCents, bucket, personId };
}

/** Alex's part of a ratio in parts per million; sam has the rest. */
function share(alex: number) {
  return [
    { personId: "sam", partsPerMillion: 1_000_000 - alex },
    { personId: "alex", partsPerMillion: alex },
  ];
}

function entry(
  date: string,
  amountCents: number,
  categoryId: number | null,
  source: SpendingEntry["source"],
  label: string | null = null,
): SpendingEntry {
  return { date, amountCents, categoryId, label, source };
}

function item(label: string, monthlyCents: number, startDate: string, endDate: string | null) {
  return { label, monthlyCents, startDate, endDate };
}

function closed(id: number, end: string, formula: ClosedPeriod["settlement"]["formula"]) {
  return {
    id,
    start: null,
    end,
    closedAt: `${end}T12:00:00Z`,
    closedBy: "alex",
    settlement: {
      formula,
      ratioId: 1,
      shares: [],
      payerId: "sam",
      recipientId: "alex",
      depositCents: 1000,
      netCents: 600,
    },
    deposit: { status: "matched", rowId: null },
  } satisfies ClosedPeriod;
}

/**
 * The mortgage payment is 700.00 a month until the renewal of February 2026,
 * then 820.01 — an odd cent, so the split has something to say. A rebate in
 * March is money in and not a payment. The buffer is funded by both, drawn on
 * twice for large sums and once for a small one.
 */
const HISTORY: StatRow[] = [
  row("2025-11-03", 40000, "mortgage", "alex"),
  row("2025-11-03", 100000, "current-expenses", "sam"),
  row("2025-11-03", 60000, "current-expenses", "alex"),
  row("2025-11-15", -70000, "mortgage", null),
  row("2025-11-20", -60000, "current-expenses", null, "Roof repair"),
  row("2025-12-02", -12000, "current-expenses", null, "Plumber"),
  row("2025-12-15", -70000, "mortgage", null),
  row("2026-01-10", 20000, "current-expenses", "alex"),
  row("2026-01-15", -70000, "mortgage", null),
  row("2026-02-02", 80000, "mortgage", "sam"),
  row("2026-02-15", -82001, "mortgage", null),
  row("2026-02-20", -150000, "current-expenses", null, "New boiler"),
  row("2026-03-15", -82001, "mortgage", null),
  row("2026-03-20", 5000, "mortgage", null),
  row("2026-04-15", -82001, "mortgage", null),
];

describe("mortgagePayments", () => {
  test("lists the payments, marking the one that changed with the one before it", () => {
    const payments = mortgagePayments(HISTORY, ALL);

    expect(payments.map((payment) => [payment.date, payment.cents, payment.changed])).toEqual([
      ["2025-11-15", 70000, false],
      ["2025-12-15", 70000, false],
      ["2026-01-15", 70000, false],
      ["2026-02-15", 82001, true],
      ["2026-03-15", 82001, false],
      ["2026-04-15", 82001, false],
    ]);
    expect(payments[0]?.previousCents).toBeNull();
    expect(payments[3]).toMatchObject({ previousCents: 70000, cents: 82001 });
  });

  test("a deposit and a rebate are not payments", () => {
    const dates = mortgagePayments(HISTORY, ALL).map((payment) => payment.date);

    expect(dates).not.toContain("2025-11-03");
    expect(dates).not.toContain("2026-03-20");
  });

  test("a range starting after the renewal still compares with the payment before the range", () => {
    const from = mortgagePayments(HISTORY, { from: "2026-02-15", to: "2026-03-01" });
    const after = mortgagePayments(HISTORY, { from: "2026-03-01", to: null });

    expect(from).toEqual([
      { date: "2026-02-15", cents: 82001, previousCents: 70000, changed: true },
    ]);
    expect(after[0]).toEqual({
      date: "2026-03-15",
      cents: 82001,
      previousCents: 82001,
      changed: false,
    });
  });

  test("a bucket's payments alone: a payment filed to a person is not one", () => {
    const rows = [row("2026-01-01", -5000, "mortgage", "sam")];

    expect(mortgagePayments(rows, ALL)).toEqual([]);
  });
});

describe("mortgageOwnSeries", () => {
  test("agrees with mortgageAsOf, odd cent included, on every day the bucket moved", () => {
    const series = mortgageOwnSeries(HISTORY, PEOPLE, ALL);

    expect(series.length).toBeGreaterThan(5);
    for (const point of series) {
      const position = mortgageAsOf(HISTORY, PEOPLE, point.date);
      expect(point.own, point.date).toEqual(position.own);
      expect(point.balanceCents, point.date).toBe(position.balanceCents);
      expect(point.own.reduce((sum, one) => sum + one.ownCents, 0)).toBe(point.balanceCents);
    }
  });

  test("a range trims the points and not the totals", () => {
    const [first] = mortgageOwnSeries(HISTORY, PEOPLE, { from: "2026-03-01", to: null });

    // Everything before March is still in the balance.
    expect(first).toMatchObject({ date: "2026-03-15" });
    expect(first?.balanceCents).toBe(mortgageAsOf(HISTORY, PEOPLE, "2026-03-15").balanceCents);
  });

  test("gives the odd cent of a joint total to the person who sorts first", () => {
    const series = mortgageOwnSeries([row("2026-01-01", -7001, "mortgage", null)], PEOPLE, ALL);

    expect(series[0]?.own).toEqual([
      { personId: "alex", ownCents: -3501 },
      { personId: "sam", ownCents: -3500 },
    ]);
  });
});

describe("contributionSeries", () => {
  test("is cumulative per person and per bucket, and a joint row is nobody's", () => {
    const [mortgage, buffer] = contributionSeries(HISTORY, PEOPLE, ALL);

    expect(mortgage?.bucket).toBe("mortgage");
    expect(mortgage?.points).toEqual([
      {
        date: "2025-11-03",
        contributions: [
          { personId: "alex", contributedCents: 40000 },
          { personId: "sam", contributedCents: 0 },
        ],
      },
      {
        date: "2026-02-02",
        contributions: [
          { personId: "alex", contributedCents: 40000 },
          { personId: "sam", contributedCents: 80000 },
        ],
      },
    ]);
    expect(buffer?.points.map((point) => point.date)).toEqual(["2025-11-03", "2026-01-10"]);
    expect(buffer?.points[1]?.contributions).toEqual([
      { personId: "alex", contributedCents: 80000 },
      { personId: "sam", contributedCents: 100000 },
    ]);
  });

  test("shows from the range's start but counts from the first row", () => {
    const [, buffer] = contributionSeries(HISTORY, PEOPLE, { from: "2026-01-01", to: null });

    expect(buffer?.points).toHaveLength(1);
    expect(buffer?.points[0]?.contributions[0]).toEqual({
      personId: "alex",
      contributedCents: 80000,
    });
  });

  test("money returned to a person counts against what they put in", () => {
    const rows = [
      row("2026-01-01", 30000, "current-expenses", "sam"),
      row("2026-01-05", -10000, "current-expenses", "sam"),
    ];

    const [, buffer] = contributionSeries(rows, PEOPLE, ALL);

    expect(buffer?.points.at(-1)?.contributions[1]).toEqual({
      personId: "sam",
      contributedCents: 20000,
    });
  });
});

describe("bufferSeries", () => {
  test("is the balance at the end of each day it moved", () => {
    const { points } = bufferSeries(HISTORY, ALL, 50000);

    expect(points).toEqual([
      { date: "2025-11-03", balanceCents: 160000 },
      { date: "2025-11-20", balanceCents: 100000 },
      { date: "2025-12-02", balanceCents: 88000 },
      { date: "2026-01-10", balanceCents: 108000 },
      { date: "2026-02-20", balanceCents: -42000 },
    ]);
  });

  test("lists the rows behind the large drops, with the balance each left", () => {
    const { drops } = bufferSeries(HISTORY, ALL, 50000);

    expect(
      drops.map((drop) => [drop.description, drop.amountCents, drop.balanceAfterCents]),
    ).toEqual([
      ["Roof repair", -60000, 100000],
      ["New boiler", -150000, -42000],
    ]);
    expect(drops[0]?.rowId).toBeGreaterThan(0);
  });

  test("a lower threshold lists the plumber too, a range lists only its own", () => {
    expect(bufferSeries(HISTORY, ALL, 10000).drops).toHaveLength(3);
    expect(bufferSeries(HISTORY, { from: "2026-01-01", to: null }, 10000).drops).toHaveLength(1);
  });

  test("a drop exactly the size asked for is listed", () => {
    expect(bufferSeries(HISTORY, ALL, 60000).drops.map((drop) => drop.amountCents)).toEqual([
      -60000, -150000,
    ]);
  });
});

describe("salariesByYear", () => {
  const SALARIES = [
    { personId: "alex", year: 2025, amountCents: 5_000_000 },
    { personId: "sam", year: 2025, amountCents: 4_000_000 },
    { personId: "sam", year: 2026, amountCents: 4_400_000 },
    { personId: "alex", year: 2026, amountCents: 5_200_000 },
  ];
  const RATIOS = [
    { effectiveFrom: "2025-01-01", shares: share(555_556) },
    { effectiveFrom: "2026-03-01", shares: share(541_667) },
    { effectiveFrom: "2026-09-01", shares: share(540_000) },
  ];

  test("gives each year's salaries and the ratio in effect on its last day", () => {
    const years = salariesByYear(SALARIES, RATIOS, ALL);

    expect(years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(years[0]?.salaries).toEqual([
      { personId: "alex", amountCents: 5_000_000 },
      { personId: "sam", amountCents: 4_000_000 },
    ]);
    expect(years[0]?.ratio?.effectiveFrom).toBe("2025-01-01");
    expect(years[0]?.ratio?.shares[0]).toEqual({ personId: "alex", partsPerMillion: 555_556 });
  });

  test("a year holding a ratio change lists both, and ends on the later", () => {
    const [, y2026] = salariesByYear(SALARIES, RATIOS, ALL);

    expect(y2026?.changes.map((change) => change.effectiveFrom)).toEqual([
      "2026-03-01",
      "2026-09-01",
    ]);
    expect(y2026?.ratio?.effectiveFrom).toBe("2026-09-01");
  });

  test("a year with a salary and no ratio yet has none, and a range keeps only its years", () => {
    const years = salariesByYear(
      [...SALARIES, { personId: "alex", year: 2024, amountCents: 1 }],
      RATIOS,
      ALL,
    );
    const ranged = salariesByYear(SALARIES, RATIOS, { from: "2026-02-01", to: null });

    expect(years[0]).toMatchObject({ year: 2024, ratio: null, changes: [] });
    expect(ranged.map((year) => year.year)).toEqual([2026]);
  });

  test("a ratio that took effect in a year with no salary still has its year", () => {
    const years = salariesByYear([], RATIOS, ALL);

    expect(years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(years[0]?.salaries).toEqual([]);
  });
});

describe("spendingByPeriod", () => {
  const SPANS: SpendingSpan[] = [
    { start: null, end: "2026-01-31", open: false },
    { start: "2026-02-01", end: "2026-02-28", open: false },
    { start: "2026-03-01", end: "2026-03-20", open: true },
  ];
  const ENTRIES: SpendingEntry[] = [
    entry("2026-01-10", 8000, 1, "card"),
    entry("2026-01-12", 2000, 1, "account"),
    entry("2026-01-20", 1500, 2, "card"),
    entry("2026-02-03", 4000, null, "card", "Épicerie"),
    entry("2026-02-04", 2500, null, "card", "Épicerie"),
    entry("2026-02-05", 900, null, "account", "Divers"),
    entry("2026-02-06", -1000, 1, "account"),
    entry("2026-03-05", 700, 2, "card"),
    // After the open period's end: not counted anywhere.
    entry("2026-04-01", 99999, 1, "card"),
  ];

  test("totals each period by category and by where it was paid from", () => {
    const periods = spendingByPeriod(ENTRIES, SPANS, ALL);

    expect(periods).toHaveLength(3);
    expect(periods[0]).toMatchObject({
      start: null,
      end: "2026-01-31",
      open: false,
      totalCents: 11500,
      cardCents: 9500,
      accountCents: 2000,
    });
    expect(periods[0]?.categories).toEqual([
      { categoryId: 1, cents: 10000 },
      { categoryId: 2, cents: 1500 },
    ]);
    expect(periods[2]).toMatchObject({ open: true, totalCents: 700 });
  });

  test("uncategorised comes last and carries what its amounts were called", () => {
    const [, february] = spendingByPeriod(ENTRIES, SPANS, ALL);

    expect(february?.categories.map((one) => one.categoryId)).toEqual([1, null]);
    expect(february?.categories[1]).toEqual({
      categoryId: null,
      cents: 7400,
      detail: [
        { label: "Épicerie", cents: 6500 },
        { label: "Divers", cents: 900 },
      ],
    });
  });

  test("a refund takes from its category", () => {
    const [, february] = spendingByPeriod(ENTRIES, SPANS, ALL);

    expect(february?.categories[0]).toEqual({ categoryId: 1, cents: -1000 });
  });

  test("a range returns the periods it overlaps, each whole", () => {
    const periods = spendingByPeriod(ENTRIES, SPANS, { from: "2026-02-20", to: "2026-03-02" });

    expect(periods.map((period) => period.end)).toEqual(["2026-02-28", "2026-03-20"]);
    expect(periods[0]?.totalCents).toBe(4000 + 2500 + 900 - 1000);
  });

  test("an amount dated before the first period starts is not counted", () => {
    const periods = spendingByPeriod(
      [entry("2025-12-31", 5000, 1, "card")],
      [{ start: "2026-01-01", end: "2026-01-31", open: true }],
      ALL,
    );

    expect(periods[0]?.totalCents).toBe(0);
  });
});

describe("fixedItemsByMonth", () => {
  const ITEMS = [
    item("Insurance", 12000, "2026-01-10", "2026-03-31"),
    // The same item at its renewal price, filed as a new version under another case.
    item("insurance", 13000, "2026-04-10", null),
    item("Internet", 7000, "2026-02-05", null),
    // Sorts first by name and started last.
    item("Alarm", 5000, "2026-03-01", null),
  ];

  test("reads versions that share a label as one line, month by month", () => {
    const { months, series } = fixedItemsByMonth(ITEMS, "2026-05-20", ALL);

    expect(months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
    expect(series).toEqual([
      { label: "Insurance", cents: [12000, 12000, 12000, 13000, 13000] },
      { label: "Internet", cents: [0, 7000, 7000, 7000, 7000] },
      { label: "Alarm", cents: [0, 0, 5000, 5000, 5000] },
    ]);
  });

  test("the lines come in the order their labels started, whatever the range", () => {
    const labels = (range: Parameters<typeof fixedItemsByMonth>[2]) =>
      fixedItemsByMonth(ITEMS, "2026-05-20", range).series.map((line) => line.label);

    expect(labels(ALL)).toEqual(["Insurance", "Internet", "Alarm"]);
    expect(labels({ from: "2026-04-01", to: null })).toEqual(["Insurance", "Internet", "Alarm"]);
    expect(labels({ from: null, to: "2026-03-31" })).toEqual(["Insurance", "Internet", "Alarm"]);
  });

  test("a range starts at its month and stops at the day it names", () => {
    const { months, series } = fixedItemsByMonth(ITEMS, "2026-04-30", {
      from: "2026-03-01",
      to: "2026-04-30",
    });

    expect(months).toEqual(["2026-03", "2026-04"]);
    expect(series[0]?.cents).toEqual([12000, 13000]);
  });

  test("nothing generated is no months and no series", () => {
    expect(fixedItemsByMonth([], "2026-05-20", ALL)).toEqual({ months: [], series: [] });
  });

  test("a range that drops an earlier item keeps its line, of zeros, so the later ones keep their place", () => {
    // Gym ended in February; Internet started in it and runs on.
    const items = [
      item("Gym", 4000, "2026-01-05", "2026-02-28"),
      item("Internet", 7000, "2026-02-05", null),
    ];

    const all = fixedItemsByMonth(items, "2026-05-20", ALL);
    const later = fixedItemsByMonth(items, "2026-05-20", { from: "2026-04-01", to: null });

    expect(all.series.map((line) => line.label)).toEqual(["Gym", "Internet"]);
    expect(later.months).toEqual(["2026-04", "2026-05"]);
    expect(later.series).toEqual([
      { label: "Gym", cents: [0, 0] },
      { label: "Internet", cents: [7000, 7000] },
    ]);
  });
});

describe("settlementsInRange", () => {
  test("lists the periods closed inside the range, oldest first, with their formula", () => {
    const periods = [
      closed(3, "2026-03-31", "v3"),
      closed(2, "2026-02-28", "v2"),
      closed(1, "2026-01-31", "v1"),
    ];

    const all = settlementsInRange(periods, ALL);
    const some = settlementsInRange(periods, { from: "2026-02-01", to: "2026-03-01" });

    expect(all.map((period) => period.settlement.formula)).toEqual(["v1", "v2", "v3"]);
    expect(some.map((period) => period.id)).toEqual([2]);
  });
});
