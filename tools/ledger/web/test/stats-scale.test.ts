/**
 * The arithmetic of a chart (lg-9), apart from drawing it: round axes, where a
 * date sits, which mark a pointer is nearest, and which colour an entity gets.
 */

import { describe, expect, test } from "vitest";
import {
  assignSlots,
  dayNumber,
  formatAxisCents,
  monthTicks,
  nearestIndex,
  niceTicks,
  project,
} from "../src/stats/scale.ts";

describe("niceTicks", () => {
  test("puts gridlines on round numbers that cover the values, reaching zero", () => {
    const axis = niceTicks(0, 82001, 4, 5000);

    expect(axis.ticks).toEqual([0, 20000, 40000, 60000, 80000, 100000]);
    expect(axis.min).toBe(0);
    expect(axis.max).toBe(100000);
  });

  test("a line far from zero need not reach it", () => {
    const axis = niceTicks(70000, 82001, 4, 5000, false);

    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThanOrEqual(70000);
    expect(axis.max).toBeGreaterThanOrEqual(82001);
  });

  test("a series that goes below zero gets an axis that holds it", () => {
    const axis = niceTicks(-42000, 108000, 4, 10000);

    expect(axis.min).toBeLessThanOrEqual(-42000);
    expect(axis.ticks).toContain(0);
    expect(axis.max).toBeGreaterThanOrEqual(108000);
  });

  test("every value equal still gets an axis, and never a step finer than asked", () => {
    const axis = niceTicks(70000, 70000, 4, 5000, false);

    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.ticks[1]! - axis.ticks[0]!).toBeGreaterThanOrEqual(5000);
  });
});

describe("formatAxisCents", () => {
  test.each([
    [0, "0 $"],
    [120000, "1,200 $"],
    [-35000, "−350 $"],
    [123456789, "1,234,568 $"],
    [-40, "0 $"],
  ])("%i is %s", (cents, text) => {
    expect(formatAxisCents(cents)).toBe(text);
  });
});

describe("time", () => {
  test("dates subtract in days", () => {
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-01")).toBe(28);
    expect(dayNumber("2028-03-01") - dayNumber("2028-02-01")).toBe(29);
  });

  test("labels at most as many month starts as fit, every month or every few", () => {
    expect(monthTicks("2026-01-15", "2026-05-20", 10)).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
    expect(monthTicks("2024-01-01", "2026-12-31", 4)).toHaveLength(4);
    expect(monthTicks("2026-03-05", "2026-03-25", 4)).toEqual([]);
  });
});

describe("nearestIndex", () => {
  test("finds the mark under a pointer, the earlier on a tie, and none when there are none", () => {
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([10, 50, 90], 70)).toBe(1);
    expect(nearestIndex([10, 50, 90], 71)).toBe(2);
    expect(nearestIndex([10, 30], 20)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe("project", () => {
  test("places a value between two pixel positions, and a flat domain at the start", () => {
    expect(project(50, { min: 0, max: 100 }, 200, 0)).toBe(100);
    expect(project(7, { min: 7, max: 7 }, 200, 0)).toBe(200);
  });
});

describe("assignSlots", () => {
  test("gives up to eight entities a colour each, in the order given", () => {
    const { slotOf, folded } = assignSlots(["a", "b", "c"], 8);

    expect([...slotOf.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(folded).toEqual([]);
  });

  test("past eight, the seven first keep theirs and the rest share the eighth", () => {
    const keys = Array.from({ length: 10 }, (_, at) => at + 1);

    const { slotOf, folded } = assignSlots(keys, 8);

    expect(keys.slice(0, 7).map((key) => slotOf.get(key))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(folded).toEqual([8, 9, 10]);
    expect(slotOf.get(10)).toBe(8);
  });

  test("exactly eight need no fold", () => {
    const keys = Array.from({ length: 8 }, (_, at) => at + 1);

    expect(assignSlots(keys, 8).folded).toEqual([]);
  });

  test("an entity's slot is its place in the list and does not depend on who else is shown", () => {
    const all = assignSlots([1, 2, 3, 4], 8).slotOf;

    // The caller passes the whole list however few are drawn, so 4 is the fourth.
    expect(all.get(4)).toBe(4);
  });
});
