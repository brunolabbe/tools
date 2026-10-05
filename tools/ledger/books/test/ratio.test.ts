/**
 * The ratio from salaries (lg-5): parts per million, half-up, summing to exactly
 * 1 000 000. Invented salaries.
 */

import { describe, expect, test } from "vitest";
import { PARTS_PER_MILLION, ratioFromSalaries, ratioInEffect } from "../src/index.ts";

function ratio(alex: number, sam: number) {
  return ratioFromSalaries([
    { personId: "sam", amountCents: sam },
    { personId: "alex", amountCents: alex },
  ]);
}

function total(shares: ReturnType<typeof ratio>): number {
  return shares.reduce((sum, share) => sum + share.partsPerMillion, 0);
}

describe("ratioFromSalaries", () => {
  test("is parts per million, in id order", () => {
    expect(ratio(6_000_000, 4_000_000)).toEqual([
      { personId: "alex", partsPerMillion: 600_000 },
      { personId: "sam", partsPerMillion: 400_000 },
    ]);
  });

  test("rounds half-up, and the two halves still sum to exactly 1 000 000", () => {
    // A third is 333 333.33…: alex rounds down, sam's 666 666.67 rounds up.
    const third = ratio(1_000_000, 2_000_000);
    expect(third).toEqual([
      { personId: "alex", partsPerMillion: 333_333 },
      { personId: "sam", partsPerMillion: 666_667 },
    ]);
    expect(total(third)).toBe(PARTS_PER_MILLION);
  });

  test("on an exact half both would round up, so the first takes it and the sum holds", () => {
    // alex's share is exactly 0.5 ppm, and sam's exactly 999 999.5.
    const tie = ratio(1, 1_999_999);

    expect(tie).toEqual([
      { personId: "alex", partsPerMillion: 1 },
      { personId: "sam", partsPerMillion: 999_999 },
    ]);
    expect(total(tie)).toBe(PARTS_PER_MILLION);
  });

  // Varied on purpose: a fixture of round salaries would pass a version that
  // truncated, or that rounded each share alone and lost the sum on a tie.
  test("sums to 1 000 000 and is within half a part of exact, over many salaries", () => {
    let seed = 11;
    const next = (): number => {
      // Park–Miller: exact in a double, and no short cycle in the low bits.
      seed = (seed * 48_271) % 2_147_483_647;
      return seed;
    };
    for (let attempt = 0; attempt < 2000; attempt++) {
      const alex = next() % 20_000_000;
      const sam = 1 + (next() % 20_000_000);
      const shares = ratio(alex, sam);
      const [alexShare] = shares;

      expect(total(shares)).toBe(PARTS_PER_MILLION);
      // |ppm − alex / (alex + sam) × 1e6| ≤ ½, in integers.
      const error = Math.abs(2 * (alexShare?.partsPerMillion ?? 0) * (alex + sam) - 2e6 * alex);
      expect(error).toBeLessThanOrEqual(alex + sam);
    }
  });

  test("handles salaries far past any household's without losing a digit", () => {
    expect(total(ratio(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1))).toBe(
      PARTS_PER_MILLION,
    );
  });

  test("refuses anything but two people with a salary between them", () => {
    expect(() => ratioFromSalaries([{ personId: "alex", amountCents: 1 }])).toThrow(/two people/u);
    expect(() => ratio(0, 0)).toThrow(/zero/u);
    expect(() => ratio(-1, 10)).toThrow(/zero or more/u);
    expect(() =>
      ratioFromSalaries([
        { personId: "alex", amountCents: 1 },
        { personId: "alex", amountCents: 2 },
      ]),
    ).toThrow(/different/u);
  });
});

describe("ratioInEffect", () => {
  const RATIOS = [
    { id: 2, effectiveFrom: "2026-01-01" },
    { id: 1, effectiveFrom: "2025-01-01" },
    { id: 3, effectiveFrom: "2026-07-01" },
  ];

  test("is the one that took effect last, on or before the date", () => {
    expect(ratioInEffect(RATIOS, "2025-06-30")?.id).toBe(1);
    expect(ratioInEffect(RATIOS, "2026-01-01")?.id).toBe(2);
    expect(ratioInEffect(RATIOS, "2026-06-30")?.id).toBe(2);
    expect(ratioInEffect(RATIOS, "2026-07-01")?.id).toBe(3);
  });

  test("is null before the first", () => {
    expect(ratioInEffect(RATIOS, "2024-12-31")).toBeNull();
  });
});
