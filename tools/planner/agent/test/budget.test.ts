/**
 * The budget is enforced before the fan-out, and what it costs is recorded.
 *
 * §9: discovering the ceiling mid-fan-out means paying for half a plan. So the
 * cut happens against the roster's size, which is known before a single request
 * goes out, and the specialists that were cut leave a `PlanGap` that says so —
 * a thinner plan that does not admit it is the repo's _never fake progress_ rule
 * broken where it is least visible.
 */

import { describe, expect, test } from "vitest";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { applyBudget, DEFAULT_RUN_BUDGET, rosterFor, rosterGaps } from "../src/index.ts";

const roster = () => rosterFor(loadFixture("multi-city").brief);

describe("degrading the roster to fit", () => {
  test("a roster inside the cap is untouched", () => {
    const decision = roster();
    const budgeted = applyBudget(decision, { ...DEFAULT_RUN_BUDGET, maxSpecialists: 10 });

    expect(budgeted.running).toEqual(decision.running);
    expect(budgeted.droppedForBudget).toEqual([]);
  });

  test("a roster over the cap is cut from the back of the order", () => {
    const decision = roster();
    expect(decision.running).toHaveLength(6);

    const budgeted = applyBudget(decision, { ...DEFAULT_RUN_BUDGET, maxSpecialists: 4 });

    expect(budgeted.running).toHaveLength(4);
    // The four the composer can put on a day survive; the two whose output is
    // never scheduled are what a plan loses least by losing.
    expect(budgeted.running.map((entry) => entry.specialist)).toEqual([
      "route-and-logistics",
      "lodging",
      "activities",
      "food",
    ]);
    expect(budgeted.droppedForBudget.map((entry) => entry.specialist)).toEqual([
      "practicalities",
      "budget",
    ]);
  });

  test("the architecture's default of five drops one from a six-specialist trip", () => {
    const budgeted = applyBudget(roster(), DEFAULT_RUN_BUDGET);
    expect(budgeted.droppedForBudget.map((entry) => entry.specialist)).toEqual(["budget"]);
  });

  test("a cap of nothing runs nothing rather than quietly running one", () => {
    const budgeted = applyBudget(roster(), { ...DEFAULT_RUN_BUDGET, maxSpecialists: 0 });
    expect(budgeted.running).toEqual([]);
    expect(budgeted.droppedForBudget).toHaveLength(6);
  });
});

describe("what a degraded roster tells the user", () => {
  test("a dropped specialist and an inapplicable one are different sentences", () => {
    const decision = roster();
    const budgeted = applyBudget(decision, { ...DEFAULT_RUN_BUDGET, maxSpecialists: 4 });
    const gaps = rosterGaps(decision, budgeted);

    const dropped = gaps.find((gap) => gap.specialist === "budget");
    expect(dropped?.reason).toBe("specialist-dropped-for-budget");
    expect(dropped?.detail).toMatch(/inside its budget/);

    const absent = gaps.find((gap) => gap.specialist === "conditions-and-gear");
    expect(absent?.reason).toBe("specialist-not-applicable");
    expect(absent?.detail).not.toMatch(/budget/);
  });

  test("every specialist that will not contribute has a gap, and nobody has two", () => {
    const decision = roster();
    const budgeted = applyBudget(decision, { ...DEFAULT_RUN_BUDGET, maxSpecialists: 4 });
    const gaps = rosterGaps(decision, budgeted);

    const named = gaps.map((gap) => gap.specialist);
    expect(new Set(named).size).toBe(named.length);
    expect(named).toHaveLength(7 - budgeted.running.length);
  });
});
