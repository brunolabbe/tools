import { describe, expect, test } from "vitest";
import { ALL_YEAR } from "@planner/contract";
import type { TripDates } from "@planner/contract";
import { couldBeInSeason, filterBySeason, inSeasonOn, inSeasonOnDay } from "../src/season.ts";
import { candidate } from "./helpers.ts";

const SKI: TripDates = { kind: "exact", departure: "2028-01-10", return: "2028-01-14" };
const SUMMER: TripDates = { kind: "exact", departure: "2027-07-10", return: "2027-07-14" };

describe("inSeasonOn", () => {
  test("an ordinary window includes both its endpoints", () => {
    const window = { from: "06-01", to: "10-15" };

    expect(inSeasonOn(window, "06-01")).toBe(true);
    expect(inSeasonOn(window, "10-15")).toBe(true);
    expect(inSeasonOn(window, "05-31")).toBe(false);
    expect(inSeasonOn(window, "10-16")).toBe(false);
  });

  test("a window that wraps the new year is a season, not a bug", () => {
    // 12-01 to 04-15 is a ski season. A comparison assuming from <= to would
    // make winter unrepresentable — which is why the contract refuses to
    // "fix" the pair by ordering it.
    const window = { from: "12-01", to: "04-15" };

    expect(inSeasonOn(window, "12-25")).toBe(true);
    expect(inSeasonOn(window, "01-15")).toBe(true);
    expect(inSeasonOn(window, "04-15")).toBe(true);
    expect(inSeasonOn(window, "07-01")).toBe(false);
    expect(inSeasonOn(window, "11-30")).toBe(false);
  });

  test("ALL_YEAR is every day", () => {
    for (const day of ["01-01", "06-30", "12-31"]) expect(inSeasonOn(ALL_YEAR, day)).toBe(true);
  });
});

describe("couldBeInSeason", () => {
  test("a winter thing survives a winter trip and not a summer one", () => {
    const skidoo = candidate({ specialist: "activities", season: { from: "12-01", to: "04-15" } });

    expect(couldBeInSeason(skidoo, SKI)).toBe(true);
    expect(couldBeInSeason(skidoo, SUMMER)).toBe(false);
  });

  test("a null season is not all-year, and is not filtered either", () => {
    // The two are different claims and the filter must not collapse them: an
    // unknown window passes through and is recorded as unchecked, because
    // "nobody established this" is not evidence of a conflict.
    const unknown = candidate({ specialist: "lodging", season: null });
    expect(couldBeInSeason(unknown, SKI)).toBe(true);

    const allYear = candidate({ specialist: "lodging", season: ALL_YEAR });
    expect(couldBeInSeason(allYear, SKI)).toBe(true);

    const split = filterBySeason([unknown, allYear], SKI);
    expect(split.seasonUnknown).toEqual([unknown.id]);
  });

  test("in season for part of the trip is in season for the trip", () => {
    // The hard filter may only remove what cannot possibly work; keeping a
    // candidate off the days it is shut is the packer's job, and removing it
    // here would delete a real option over a day it was never placed on.
    const shoulder = candidate({
      specialist: "activities",
      season: { from: "07-13", to: "09-30" },
    });
    expect(couldBeInSeason(shoulder, SUMMER)).toBe(true);
  });

  test("a flexible window is checked against everywhere the trip could land", () => {
    const winter = candidate({ specialist: "activities", season: { from: "12-01", to: "04-15" } });

    expect(
      couldBeInSeason(winter, {
        kind: "window",
        earliest: "2027-10-01",
        latest: "2027-12-20",
        nights: 3,
      }),
    ).toBe(true);
    expect(
      couldBeInSeason(winter, {
        kind: "window",
        earliest: "2027-06-01",
        latest: "2027-08-31",
        nights: 3,
      }),
    ).toBe(false);
  });

  test("open dates have no calendar, so nothing can be ruled out by one", () => {
    const winter = candidate({ specialist: "activities", season: { from: "12-01", to: "04-15" } });
    expect(couldBeInSeason(winter, { kind: "open", nights: 4 })).toBe(true);
  });
});

describe("inSeasonOnDay", () => {
  test("a day with no date cannot contradict a known season", () => {
    const winter = candidate({ specialist: "activities", season: { from: "12-01", to: "04-15" } });
    expect(inSeasonOnDay(winter, null)).toBe(true);
    expect(inSeasonOnDay(winter, "2028-01-05")).toBe(true);
    expect(inSeasonOnDay(winter, "2027-07-05")).toBe(false);
  });
});

describe("filterBySeason", () => {
  test("the out-of-season candidates never reach packing, by id", () => {
    const summerOnly = candidate({
      specialist: "activities",
      season: { from: "06-01", to: "09-30" },
    });
    const winterOnly = candidate({
      specialist: "activities",
      season: { from: "12-01", to: "04-15" },
    });

    const split = filterBySeason([summerOnly, winterOnly], SKI);

    expect(split.kept.map((kept) => kept.id)).toEqual([winterOnly.id]);
    expect(split.outOfSeason).toEqual([summerOnly.id]);
  });
});
