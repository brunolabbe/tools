/**
 * The grounding seam's own arithmetic.
 *
 * There is no implementation in this package to test — that is the point of a
 * seam — so what is left is the budget and the matrix accessor, both of which
 * pl-27 depends on getting exactly right.
 */

import { describe, expect, test } from "vitest";
import { groundingBudget, travelCell, TRAVEL_MODES, type TravelMatrix } from "../src/index.ts";

describe("the grounding budget", () => {
  test("hands out exactly its ceiling and then refuses", () => {
    const budget = groundingBudget(3);

    expect(budget.remaining()).toBe(3);
    expect(budget.claim()).toBe(true);
    expect(budget.claim()).toBe(true);
    expect(budget.claim()).toBe(true);
    expect(budget.remaining()).toBe(0);

    // Refuses rather than throwing: running out of budget is a planned outcome
    // with copy attached — a `PlanGap` in front of the user — not an exception.
    expect(budget.claim()).toBe(false);
    expect(budget.remaining()).toBe(0);
  });

  test("never reports a negative remainder, however often it is refused", () => {
    const budget = groundingBudget(1);
    budget.claim();
    budget.claim();
    budget.claim();

    expect(budget.remaining()).toBe(0);
  });

  test("a ceiling of zero grounds nothing at all", () => {
    // `MAX_GROUNDING_CALLS=0` is how a deployment turns grounding off without
    // reconfiguring the provider, so it has to be the honest zero rather than
    // an off-by-one that lets one call through.
    const budget = groundingBudget(0);

    expect(budget.remaining()).toBe(0);
    expect(budget.claim()).toBe(false);
  });

  test("refuses to be talked into extra calls by a nonsense ceiling", () => {
    expect(groundingBudget(-5).claim()).toBe(false);
    expect(groundingBudget(2.9).remaining()).toBe(2);
  });

  test("two budgets do not share a counter", () => {
    const one = groundingBudget(1);
    const other = groundingBudget(1);

    expect(one.claim()).toBe(true);
    expect(other.claim()).toBe(true);
  });
});

describe("reading a travel matrix", () => {
  const cell = { distanceMeters: 1_000, durationMinutes: 10, source: {} as never };
  // 1×2, so a transposed read is visible. On a square matrix it would not be.
  const matrix: TravelMatrix = [[null, cell]];

  test("reads rows as origins and columns as destinations", () => {
    expect(travelCell(matrix, 0, 0)).toBeNull();
    expect(travelCell(matrix, 0, 1)).toBe(cell);
  });

  test("answers null off the end rather than throwing", () => {
    // A caller that asked for a pair it did not send has already lost; it
    // should not also take the run down with it.
    expect(travelCell(matrix, 1, 0)).toBeNull();
    expect(travelCell(matrix, 0, 9)).toBeNull();
    expect(travelCell([], 0, 0)).toBeNull();
  });
});

describe("travel modes", () => {
  test("driving is the one this slice builds", () => {
    // An enum rather than a boolean or an absent parameter, so the day a
    // motorised-touring trip wants a snowmobile trail network that is a new
    // member here and not a change to every signature on the seam.
    expect(TRAVEL_MODES).toEqual(["driving"]);
  });
});
