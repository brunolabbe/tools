import { describe, expect, test } from "vitest";
import { MODEL_ASSERTED, slot } from "@planner/contract";
import type { CostBasis, CostEstimate } from "@planner/contract";
import { budgetCeiling, isOverBudget, partySize, totalCost } from "../src/cost.ts";
import { briefFor } from "./helpers.ts";

function cost(low: number, high: number, basis: CostBasis, currency = "CAD"): CostEstimate {
  return { currency, low, high, basis, provenance: MODEL_ASSERTED };
}

describe("totalCost", () => {
  test("sums a band as a band, and never as a figure", () => {
    const total = totalCost(
      [
        { id: "a", cost: cost(100, 150, "per-party") },
        { id: "b", cost: cost(20, 40, "per-party") },
      ],
      4,
    );

    expect(total.band).toEqual({ currency: "CAD", low: 120, high: 190 });
  });

  test("per-person multiplies by the party and per-party does not", () => {
    const total = totalCost(
      [
        { id: "ticket", cost: cost(12, 12, "per-person") },
        { id: "parking", cost: cost(10, 10, "per-party") },
      ],
      4,
    );

    expect(total.band).toEqual({ currency: "CAD", low: 58, high: 58 });
  });

  test("a line with no cost is a hole in the total, named", () => {
    const total = totalCost(
      [
        { id: "hotel", cost: cost(200, 240, "per-party") },
        { id: "mystery", cost: null },
      ],
      2,
    );

    expect(total.band).toEqual({ currency: "CAD", low: 200, high: 240 });
    expect(total.withoutCost).toEqual(["mystery"]);
  });

  test("mixed currencies are not summed, because nothing here converts", () => {
    // A rate is a fact with an age, which makes it grounding. Adding CAD to EUR
    // would be wrong in a way nobody reading the plan could see.
    const total = totalCost(
      [
        { id: "a", cost: cost(100, 100, "per-party", "CAD") },
        { id: "b", cost: cost(80, 80, "per-party", "EUR") },
      ],
      2,
    );

    expect(total.band).toBeNull();
    expect(total.currencies.toSorted()).toEqual(["CAD", "EUR"]);
  });

  test("nothing with a cost at all is null, not zero", () => {
    expect(totalCost([{ id: "a", cost: null }], 2).band).toBeNull();
  });
});

describe("budgetCeiling", () => {
  test("a total budget is the figure itself", () => {
    expect(
      budgetCeiling({ kind: "amount", currency: "CAD", amount: 4200, basis: "total" }, 4, 9),
    ).toEqual({ currency: "CAD", low: 4200, high: 4200 });
  });

  test("per-person multiplies by the party, per-day by the days", () => {
    expect(
      budgetCeiling({ kind: "amount", currency: "EUR", amount: 500, basis: "per-person" }, 3, 9)
        ?.high,
    ).toBe(1500);
    expect(
      budgetCeiling({ kind: "amount", currency: "EUR", amount: 120, basis: "per-day" }, 3, 9)?.high,
    ).toBe(1080);
  });

  test("a band budget has no figure, and this package refuses to invent one", () => {
    // Deciding that "moderate" is €2,000 would be inventing the single most
    // consequential number in the plan. The honest consequence is that the
    // budget check does not run, and the plan says so.
    expect(budgetCeiling({ kind: "band", band: "moderate" }, 4, 9)).toBeNull();
  });
});

describe("isOverBudget", () => {
  const ceiling = { currency: "CAD", low: 1000, high: 1000 };

  test("a band that straddles the budget is not a violation", () => {
    // €1,800–€2,400 against €2,000 is a plan that might fit, and refusing to
    // ship it treats an estimate as a quote.
    expect(isOverBudget({ currency: "CAD", low: 900, high: 1400 }, ceiling)).toBe(false);
  });

  test("a band whose cheapest reading still exceeds the budget is", () => {
    expect(isOverBudget({ currency: "CAD", low: 1001, high: 1400 }, ceiling)).toBe(true);
  });

  test("a currency mismatch is not a violation, because it is not a comparison", () => {
    expect(isOverBudget({ currency: "EUR", low: 9000, high: 9000 }, ceiling)).toBe(false);
  });

  test("no total and no ceiling are both simply not over", () => {
    expect(isOverBudget(null, ceiling)).toBe(false);
    expect(isOverBudget({ currency: "CAD", low: 5000, high: 5000 }, null)).toBe(false);
  });
});

describe("partySize", () => {
  test("is what the party said", () => {
    expect(partySize(briefFor({ travellers: 5 }))).toBe(5);
  });

  test("falls back to one, which is the assumption that cannot inflate a total", () => {
    const brief = {
      ...briefFor({}),
      travellers: slot.declined() as ReturnType<typeof slot.declined>,
    };
    expect(partySize(brief)).toBe(1);
  });
});
