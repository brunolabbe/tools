/**
 * Who is in the books on a date, and the mortgage's joint rows split between
 * them (lg-35). Invented people and amounts.
 */

import { describe, expect, test } from "vitest";
import { mortgageAsOf, mortgageOwnSeries, peopleOn, retiredOn } from "../src/index.ts";
import type { FiledRow, RetirementInput, StatRow } from "../src/index.ts";

const PEOPLE = ["alex", "casey", "sam"];

function retire(personId: string, fromDate: string): RetirementInput {
  return { personId, action: "retire", fromDate };
}

function back(personId: string, fromDate: string): RetirementInput {
  return { personId, action: "return", fromDate };
}

describe("peopleOn", () => {
  test("everyone is in until a retirement takes effect, and from its first day they are not", () => {
    const records = [retire("casey", "2026-07-01")];

    expect(peopleOn(PEOPLE, records, "2026-06-30")).toEqual(PEOPLE);
    expect(peopleOn(PEOPLE, records, "2026-07-01")).toEqual(["alex", "sam"]);
    expect(peopleOn(PEOPLE, [], "2026-07-01")).toEqual(PEOPLE);
  });

  test("a return brings them back from its own day, and two on one day read in their order", () => {
    const records = [retire("casey", "2026-07-01"), back("casey", "2026-09-01")];

    expect(peopleOn(PEOPLE, records, "2026-08-31")).toEqual(["alex", "sam"]);
    expect(peopleOn(PEOPLE, records, "2026-09-01")).toEqual(PEOPLE);
    // Retired and returned before the same close: both from one day, the return last.
    expect(
      retiredOn([retire("casey", "2026-07-01"), back("casey", "2026-07-01")], "2026-07-01"),
    ).toEqual(new Set());
  });
});

function row(date: string, amountCents: number, personId: string | null): FiledRow & StatRow {
  return { id: 0, date, description: "", amountCents, bucket: "mortgage", personId };
}

describe("the mortgage's joint rows, with a retirement", () => {
  // Three deposits, a payment while all three are in, and two after casey leaves.
  const ROWS = [
    row("2026-06-01", 30_000, "alex"),
    row("2026-06-01", 30_000, "casey"),
    row("2026-06-01", 30_000, "sam"),
    row("2026-06-15", -30_001, null),
    row("2026-07-15", -20_001, null),
    row("2026-08-15", -20_000, null),
  ];
  const RECORDS = [retire("casey", "2026-07-01")];

  test("a row dated on or after the retirement gives them no share; one before still does", () => {
    const position = mortgageAsOf(ROWS, PEOPLE, "2026-08-31", RECORDS);

    // The June payment in thirds, its odd cent to alex; July and August's
    // 40 001 in halves between alex and sam, the odd cent to alex again.
    expect(position.own).toEqual([
      { personId: "alex", ownCents: 30_000 - 10_001 - 20_001 },
      { personId: "casey", ownCents: 30_000 - 10_000 },
      { personId: "sam", ownCents: 30_000 - 10_000 - 20_000 },
    ]);
    expect(position.own.reduce((sum, one) => sum + one.ownCents, 0)).toBe(position.balanceCents);
  });

  test("without the records, every joint row is split between all three, as before", () => {
    const position = mortgageAsOf(ROWS, PEOPLE, "2026-08-31");

    expect(position.own.map((one) => one.ownCents)).toEqual([
      30_000 - 23_334,
      30_000 - 23_334,
      30_000 - 23_334,
    ]);
  });

  test("a person who left and came back splits one total with the same people, not two", () => {
    const rows = [row("2026-06-15", -1, null), row("2026-09-15", -1, null)];
    const records = [retire("casey", "2026-07-01"), back("casey", "2026-09-01")];

    // -2 between three: one cent each to the first two by id, never two to alex.
    expect(
      mortgageAsOf(rows, PEOPLE, "2026-09-30", records).own.map((one) => one.ownCents),
    ).toEqual([-1, -1, 0]);
  });

  test("the series agrees with mortgageAsOf on every day, retirement included", () => {
    const series = mortgageOwnSeries(ROWS, PEOPLE, { from: null, to: null }, RECORDS);

    expect(series.length).toBe(4);
    for (const point of series) {
      expect(point.own, point.date).toEqual(mortgageAsOf(ROWS, PEOPLE, point.date, RECORDS).own);
    }
  });
});
