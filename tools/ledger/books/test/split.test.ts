/**
 * The mortgage split, by shares, equally or at the ratio, from a date (lg-63).
 * Invented people and amounts.
 *
 * **The history.** Three people, `alex`, `casey` and `sam`, from 2026-01-02 to
 * 2026-08-15. Each puts money in on 2026-01-02, alex and sam again on 2026-04-01
 * and 2026-07-02. Eight joint rows: payments of 700.01, 700.03, 700.01, 700.01,
 * 700.03, 700.01 and 700.02 on the 15th of each month, and a rebate of one cent on
 * 2026-03-15. Every one of them is an odd or uneven number of cents, and neither
 * stretch's total divides evenly between the people in it. The first ratio, from
 * 2026-01-01, is 60 / 15 / 25 %; the period closes on 2026-06-30, casey is retired
 * from 2026-07-01, and the ratio confirmed at the close is alex 70 %, sam 30 %.
 * The shares record names 50 / 20 / 30 %. So the parts are unequal under every
 * mode but `equal`, and casey retires under each of them.
 */

import { describe, expect, test } from "vitest";
import { apportion, mortgageAsOf, mortgageOwnSeries, splitCents } from "../src/index.ts";
import type {
  FiledRow,
  MortgageSplitInput,
  RatioInput,
  RetirementInput,
  SplitHistory,
  StatRow,
} from "../src/index.ts";

const PEOPLE = ["alex", "casey", "sam"];
const ALL = { from: null, to: null };

function row(date: string, amountCents: number, personId: string | null): FiledRow & StatRow {
  return { id: 0, date, description: "", amountCents, bucket: "mortgage", personId };
}

function parts(entries: Record<string, number>) {
  return Object.entries(entries).map(([personId, partsPerMillion]) => ({
    personId,
    partsPerMillion,
  }));
}

const HISTORY = [
  row("2026-01-02", 90_000, "alex"),
  row("2026-01-02", 30_000, "casey"),
  row("2026-01-02", 60_000, "sam"),
  row("2026-01-15", -70_001, null),
  row("2026-02-15", -70_003, null),
  row("2026-03-15", 1, null),
  row("2026-04-01", 100_000, "alex"),
  row("2026-04-01", 60_000, "sam"),
  row("2026-04-15", -70_001, null),
  row("2026-05-15", -70_001, null),
  row("2026-06-15", -70_003, null),
  row("2026-07-02", 100_000, "alex"),
  row("2026-07-02", 60_000, "sam"),
  row("2026-07-15", -70_001, null),
  row("2026-08-15", -70_002, null),
];
const FIRST_DAY = "2026-01-02";
const LAST_DAY = "2026-08-15";
const DEPOSITS = { alex: 290_000, casey: 30_000, sam: 180_000 };

const RATIOS: RatioInput[] = [
  { effectiveFrom: "2026-01-01", shares: parts({ alex: 600_000, casey: 150_000, sam: 250_000 }) },
  { effectiveFrom: "2026-07-01", shares: parts({ alex: 700_000, sam: 300_000 }) },
];
const RETIRED: RetirementInput[] = [
  { personId: "casey", action: "retire", fromDate: "2026-07-01" },
];
const SHARES = parts({ alex: 500_000, casey: 200_000, sam: 300_000 });

function record(
  effectiveFrom: string,
  mode: MortgageSplitInput["mode"],
  shares = SHARES,
): MortgageSplitInput {
  return { effectiveFrom, mode, shares: mode === "shares" ? shares : [] };
}

function history(...splits: MortgageSplitInput[]): SplitHistory {
  return { ratios: RATIOS, splits };
}

/** Every calendar day from `first` through `last`, inclusive. */
function everyDay(first: string, last: string): string[] {
  const days: string[] = [];
  for (let at = new Date(`${first}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
    const day = at.toISOString().slice(0, 10);
    if (day > last) return days;
    days.push(day);
  }
}

function ownAt(split: SplitHistory, asOf: string): number[] {
  return mortgageAsOf(HISTORY, PEOPLE, asOf, RETIRED, split).own.map((one) => one.ownCents);
}

/** The history's parts sum to its balance on every one of its days, as of the day and in the series. */
function expectSumsOnEveryDay(split: SplitHistory): void {
  for (const day of everyDay(FIRST_DAY, LAST_DAY)) {
    const position = mortgageAsOf(HISTORY, PEOPLE, day, RETIRED, split);
    expect(
      position.own.reduce((sum, one) => sum + one.ownCents, 0),
      day,
    ).toBe(position.balanceCents);
  }
  const series = mortgageOwnSeries(HISTORY, PEOPLE, ALL, RETIRED, split);
  expect(series.length).toBe(11);
  for (const point of series) {
    expect(
      point.own.reduce((sum, one) => sum + one.ownCents, 0),
      point.date,
    ).toBe(point.balanceCents);
    expect(point.own, point.date).toEqual(
      mortgageAsOf(HISTORY, PEOPLE, point.date, RETIRED, split).own,
    );
  }
}

// Done when 1, and a retirement under each of the three modes.
describe("one history under each mode", () => {
  // Joint rows before casey retires total −3 500.08, after −1 400.03.

  test("by shares: each person's parts, casey's handed to alex and sam pro rata once retired", () => {
    const split = history(record("2026-01-01", "shares"));

    // Before: 50 / 20 / 30 % of −350 008 is −175 004, −70 001.6, −105 002.4; the
    // cent left goes to the largest remainder, casey's. After: casey's 20 % goes
    // 5 : 3, so alex 62.5 % and sam 37.5 % of −140 003, −87 501.875 and
    // −52 501.125, the cent to alex.
    expect(ownAt(split, LAST_DAY)).toEqual([
      DEPOSITS.alex - 175_004 - 87_502,
      DEPOSITS.casey - 70_002,
      DEPOSITS.sam - 105_002 - 52_501,
    ]);
    expectSumsOnEveryDay(split);
  });

  test("equally: between the three, then between the two who remain", () => {
    const split = history(record("2026-01-01", "equal"));

    // −350 008 in thirds is −116 669 each and a cent to alex; −140 003 in
    // halves is −70 001 each and a cent to alex.
    expect(ownAt(split, LAST_DAY)).toEqual([
      DEPOSITS.alex - 116_670 - 70_002,
      DEPOSITS.casey - 116_669,
      DEPOSITS.sam - 116_669 - 70_001,
    ]);
    // No record is `equal`.
    expect(ownAt(history(), LAST_DAY)).toEqual(ownAt(split, LAST_DAY));
    expectSumsOnEveryDay(split);
  });

  test("at the ratio: each row at the ratio in effect on its date, the close's naming only those who remain", () => {
    const split = history(record("2026-01-01", "ratio"));

    // 60 / 15 / 25 % of −350 008 is −210 004.8, −52 501.2 and −87 502, the cent
    // to alex; 70 / 30 % of −140 003 is −98 002.1 and −42 000.9, the cent to sam.
    expect(ownAt(split, LAST_DAY)).toEqual([
      DEPOSITS.alex - 210_005 - 98_002,
      DEPOSITS.casey - 52_501,
      DEPOSITS.sam - 87_502 - 42_001,
    ]);
    expectSumsOnEveryDay(split);
  });

  test("a mode changed twice: equally, by shares from 2026-04-01, at the ratio from 2026-08-01", () => {
    const split = history(
      record("2026-04-01", "shares"),
      record("2026-01-01", "equal"),
      record("2026-08-01", "ratio"),
    );

    // Equally to March, −140 003 in thirds: −46 667 each, a cent to alex and to
    // casey. By shares in April to June, −210 005 at 50 / 20 / 30 %: −105 002.5,
    // −42 001, −63 001.5, the cent to alex on the tie. By shares in July, casey
    // retired: −70 001 at 5 : 3, the cent to alex. At the ratio in August:
    // −70 002 at 70 / 30 %, the cent to sam.
    expect(ownAt(split, LAST_DAY)).toEqual([
      DEPOSITS.alex - 46_668 - 105_003 - 43_751 - 49_001,
      DEPOSITS.casey - 46_668 - 42_001,
      DEPOSITS.sam - 46_667 - 63_001 - 26_250 - 21_001,
    ]);
    expectSumsOnEveryDay(split);

    // The series marks each change on the first day the bucket moved under it,
    // and names the new split.
    const series = mortgageOwnSeries(HISTORY, PEOPLE, ALL, RETIRED, split);
    expect(series.filter((point) => point.splitChanged).map((point) => point.date)).toEqual([
      "2026-04-01",
      "2026-07-02",
      "2026-08-15",
    ]);
    expect(series.find((point) => point.date === "2026-07-02")?.split).toEqual({
      mode: "shares",
      effectiveFrom: "2026-04-01",
      noRatio: false,
      parts: parts({ alex: 625_000, sam: 375_000 }),
    });
    expect(series.at(-1)?.split).toEqual({
      mode: "ratio",
      effectiveFrom: "2026-08-01",
      noRatio: false,
      parts: parts({ alex: 700_000, sam: 300_000 }),
    });
  });
});

// Done when 2.
test("a record from a later date leaves every day before it exactly as it was", () => {
  const before = history(record("2026-01-01", "equal"));
  const after = history(record("2026-01-01", "equal"), record("2026-04-01", "shares"));

  const days = everyDay(FIRST_DAY, "2026-03-31");
  expect(days.length).toBe(89);
  for (const day of days) {
    expect(ownAt(after, day), day).toEqual(ownAt(before, day));
  }
  expect(ownAt(after, "2026-04-15")).not.toEqual(ownAt(before, "2026-04-15"));
});

// Done when 3: lg-23's reproduction, a third person added at a close.
test("a third person added at a close leaves the first two's own money before it unchanged", () => {
  const rows = [
    row("2026-01-02", 50_000, "alex"),
    row("2026-01-05", 40_000, "sam"),
    row("2026-01-12", -70_001, null),
    row("2026-07-02", 30_000, "casey"),
    row("2026-07-12", -60_001, null),
  ];
  const ratios: RatioInput[] = [
    { effectiveFrom: "2026-01-01", shares: parts({ alex: 600_000, sam: 400_000 }) },
    { effectiveFrom: "2026-07-01", shares: parts({ alex: 500_000, casey: 200_000, sam: 300_000 }) },
  ];
  const withCasey = { ratios, splits: [] };
  const twoOfThem = { ratios: ratios.slice(0, 1), splits: [] };

  for (const day of everyDay("2026-01-02", "2026-06-30")) {
    const three = mortgageAsOf(rows, PEOPLE, day, [], withCasey).own;
    const two = mortgageAsOf(rows, ["alex", "sam"], day, [], twoOfThem).own;
    expect(
      three.filter((one) => one.personId !== "casey"),
      day,
    ).toEqual(two);
    expect(three.find((one) => one.personId === "casey")?.ownCents, day).toBe(0);
  }
  // January's payment stays in halves between alex and sam, the cent to alex;
  // July's is in thirds, a cent to alex. Before lg-63 casey read −23 334 here.
  expect(mortgageAsOf(rows, PEOPLE, "2026-06-30", [], withCasey).own).toEqual([
    { personId: "alex", ownCents: 50_000 - 35_001 },
    { personId: "casey", ownCents: 0 },
    { personId: "sam", ownCents: 40_000 - 35_000 },
  ]);
  expect(mortgageAsOf(rows, PEOPLE, "2026-07-31", [], withCasey).own).toEqual([
    { personId: "alex", ownCents: 50_000 - 35_001 - 20_001 },
    { personId: "casey", ownCents: 30_000 - 20_000 },
    { personId: "sam", ownCents: 40_000 - 35_000 - 20_000 },
  ]);
});

// Done when 4.
test("with no record, a household of two reads what one split of the cumulative total always gave", () => {
  const rows: FiledRow[] = [];
  let seed = 11;
  const next = (): number => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed;
  };
  for (let day = 0; day < 200; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10);
    const kind = next() % 3;
    if (kind === 0) rows.push(row(date, 30_000 + (next() % 20_000), "alex"));
    if (kind === 1) rows.push(row(date, 30_000 + (next() % 20_000), "sam"));
    if (kind === 2) rows.push(row(date, -(60_000 + (next() % 999)), null));
  }
  const ratios: RatioInput[] = [
    { effectiveFrom: "2025-03-01", shares: parts({ alex: 600_000, sam: 400_000 }) },
  ];

  for (const { date } of rows) {
    const joint = rows
      .filter((one) => one.personId === null && one.date <= date)
      .reduce((sum, one) => sum + one.amountCents, 0);
    const [alexHalf = 0, samHalf = 0] = splitCents(joint, 2);
    const deposits = (person: string) =>
      rows
        .filter((one) => one.personId === person && one.date <= date)
        .reduce((sum, one) => sum + one.amountCents, 0);
    const today = [
      { personId: "alex", ownCents: deposits("alex") + alexHalf },
      { personId: "sam", ownCents: deposits("sam") + samHalf },
    ];
    expect(mortgageAsOf(rows, ["alex", "sam"], date).own, date).toEqual(today);
    expect(mortgageAsOf(rows, ["alex", "sam"], date, [], { ratios, splits: [] }).own).toEqual(
      today,
    );
  }
});

// Done when 5.
test("many odd-cent payments split equally leave the parts within a cent of each other", () => {
  const rows: FiledRow[] = [];
  for (let day = 0; day < 500; day++) {
    const date = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
    rows.push(row(date, -(70_001 + 2 * (day % 37)), null));
  }
  const split = { ratios: [], splits: [record("2024-01-01", "equal")] };

  const shares = mortgageAsOf(rows, PEOPLE, "2025-12-31", [], split).own.map((one) => one.ownCents);
  expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  // The fixture can tell: rounding each payment on its own gives alex the
  // extra cent of every payment that leaves one, and drifts.
  const perRow = [0, 1, 2].map((index) =>
    rows.reduce((sum, one) => sum + (splitCents(one.amountCents, 3)[index] ?? 0), 0),
  );
  expect(Math.max(...perRow) - Math.min(...perRow)).toBeGreaterThan(100);
});

describe("a retirement the records did not foresee", () => {
  const rows = [row("2026-06-15", -10_001, null), row("2026-07-15", -10_001, null)];

  test("a ratio still naming the retired person hands their part to the rest pro rata", () => {
    const split = {
      ratios: RATIOS.slice(0, 1),
      splits: [record("2026-01-01", "ratio")],
    };

    // July's −10 001 at 60 : 25, alex 70.5882… %, sam 29.4117… %.
    expect(mortgageAsOf(rows, PEOPLE, "2026-07-31", RETIRED, split).own).toEqual([
      { personId: "alex", ownCents: -6_001 - 7_060 },
      { personId: "casey", ownCents: -1_500 },
      { personId: "sam", ownCents: -2_500 - 2_941 },
    ]);
  });

  test("shares that leave only zero parts behind split what remains equally", () => {
    const split = {
      ratios: [],
      splits: [record("2026-01-01", "shares", parts({ alex: 0, casey: 1_000_000, sam: 0 }))],
    };

    expect(mortgageAsOf(rows, PEOPLE, "2026-07-31", RETIRED, split).own).toEqual([
      { personId: "alex", ownCents: -5_001 },
      { personId: "casey", ownCents: -10_001 },
      { personId: "sam", ownCents: -5_000 },
    ]);
  });
});

describe("apportion", () => {
  test("is splitCents for equal weights, whichever the sign", () => {
    for (const cents of [-70_001, 70_001, -2, 10, 0, -350_008]) {
      // `+ 0` because splitCents' Math.trunc gives −0 for a small negative share.
      expect(
        apportion(cents, [
          ["a", 1],
          ["b", 1],
          ["c", 1],
        ]),
        String(cents),
      ).toEqual(splitCents(cents, 3).map((share) => share + 0));
    }
  });

  test("gives the cents left to the largest remainders, a tie to the earlier", () => {
    expect(
      apportion(-210_005, [
        ["alex", 5],
        ["casey", 2],
        ["sam", 3],
      ]),
    ).toEqual([-105_003, -42_001, -63_001]);
    expect(
      apportion(1_000_000, [
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
    ).toEqual([333_334, 333_333, 333_333]);
  });
});
