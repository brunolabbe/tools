import { describe, expect, test } from "vitest";
import { MAX_PLAN_DAYS } from "@planner/contract";
import { daysUntilDeparture, monthDay, possibleMonthDays, tripSpan } from "../src/dates.ts";

describe("tripSpan", () => {
  test("exact dates give a day per night plus the day you come home", () => {
    const span = tripSpan({ kind: "exact", departure: "2027-07-03", return: "2027-07-11" });

    expect(span.dayCount).toBe(9);
    expect(span.dates[0]).toBe("2027-07-03");
    expect(span.dates.at(-1)).toBe("2027-07-11");
    expect(span.truncated).toBe(false);
  });

  test("a window has days and no calendar", () => {
    const span = tripSpan({
      kind: "window",
      earliest: "2027-02-01",
      latest: "2027-02-28",
      nights: 3,
    });

    expect(span.dayCount).toBe(4);
    // Not "the first four days of the window": the trip may land anywhere
    // inside it, and dating the days would be choosing a departure the user
    // deliberately did not.
    expect(span.dates).toEqual([null, null, null, null]);
  });

  test("open dates have days and no calendar either", () => {
    expect(tripSpan({ kind: "open", nights: 10 }).dates.every((date) => date === null)).toBe(true);
  });

  test("a month boundary is crossed correctly", () => {
    const span = tripSpan({ kind: "exact", departure: "2027-02-27", return: "2027-03-02" });
    expect(span.dates).toEqual(["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"]);
  });

  test("a leap day is a day", () => {
    const span = tripSpan({ kind: "exact", departure: "2028-02-28", return: "2028-03-01" });
    expect(span.dates).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  test("the longest trip loses its last day, and says so", () => {
    // 60 nights is 61 days and a plan holds 60. Reported rather than clamped in
    // silence — the composer turns this into an unchecked constraint.
    const span = tripSpan({ kind: "open", nights: 60 });

    expect(span.dayCount).toBe(MAX_PLAN_DAYS);
    expect(span.truncated).toBe(false);
  });

  test("truncation is only reported when there were dates to truncate", () => {
    const span = tripSpan({ kind: "exact", departure: "2027-01-01", return: "2027-03-31" });
    expect(span.dayCount).toBe(MAX_PLAN_DAYS);
    expect(span.truncated).toBe(true);
  });
});

describe("daysUntilDeparture", () => {
  const now = new Date("2027-01-01T23:30:00.000Z");

  test("counts whole days to an exact departure", () => {
    expect(
      daysUntilDeparture({ kind: "exact", departure: "2027-03-02", return: "2027-03-05" }, now),
    ).toBe(60);
  });

  test("a window counts from its earliest day, which cannot be optimistic", () => {
    expect(
      daysUntilDeparture(
        { kind: "window", earliest: "2027-01-11", latest: "2027-02-11", nights: 3 },
        now,
      ),
    ).toBe(10);
  });

  test("open dates have no departure to count back from", () => {
    // Not zero: zero means "nothing can be booked", and the honest answer to
    // "when do you leave" being unanswered is that no deadline is knowable.
    expect(daysUntilDeparture({ kind: "open", nights: 5 }, now)).toBeNull();
  });

  test("a departure already past is zero rather than negative", () => {
    expect(
      daysUntilDeparture({ kind: "exact", departure: "2026-01-01", return: "2026-01-05" }, now),
    ).toBe(0);
  });
});

describe("possibleMonthDays", () => {
  test("exact dates give the trip's own days", () => {
    const days = possibleMonthDays({
      kind: "exact",
      departure: "2027-07-03",
      return: "2027-07-05",
    });
    expect([...(days ?? [])].toSorted()).toEqual(["07-03", "07-04", "07-05"]);
  });

  test("a window gives every day the trip could land on, not just its length", () => {
    const days = possibleMonthDays({
      kind: "window",
      earliest: "2027-12-28",
      latest: "2028-01-02",
      nights: 2,
    });
    expect(days?.has("12-31")).toBe(true);
    expect(days?.has("01-01")).toBe(true);
  });

  test("open dates have no calendar at all", () => {
    expect(possibleMonthDays({ kind: "open", nights: 5 })).toBeNull();
  });

  test("a window longer than a year is every day, and does not run away", () => {
    const days = possibleMonthDays({
      kind: "window",
      earliest: "2027-01-01",
      latest: "2031-01-01",
      nights: 3,
    });
    expect(days?.size).toBe(366);
  });
});

test("monthDay drops the year and nothing else", () => {
  expect(monthDay("2027-07-03")).toBe("07-03");
});
