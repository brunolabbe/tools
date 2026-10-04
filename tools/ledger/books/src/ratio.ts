/**
 * The ratio the buffer is shared at, derived from the two salaries (lg-5).
 *
 * A ratio is **parts per million** per person, because the owner's ratio has four
 * significant decimals of a percent and basis points would round them away
 * (`docs/00-ANALYSIS.md` §5, _Numbers_). It is derived from salaries and then
 * stored, with the date it takes effect, so a settlement can always be
 * recomputed with the ratio it actually used.
 *
 * **Rounding.** Each share is rounded half-up to a whole part per million. For
 * two people the exact shares sum to 1 000 000, so their fractions sum to one
 * and only one share rounds up — except on an exact tie, where both fractions
 * are one half and both would. So the first person, by id, takes their share
 * rounded half-up, and the second takes what is left: the same as rounding both
 * whenever that sums to 1 000 000, and on the tie the first takes the extra
 * part. The arithmetic is in `bigint`, so no salary is ever large enough to lose
 * a digit.
 */

import { AppError } from "@ledger/contract";

export const PARTS_PER_MILLION = 1_000_000;

export interface SalaryInput {
  personId: string;
  amountCents: number;
}

export interface Share {
  personId: string;
  partsPerMillion: number;
}

/** The two shares, in id order, summing to exactly 1 000 000. */
export function ratioFromSalaries(salaries: readonly SalaryInput[]): Share[] {
  const [first, second] = salaries.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  if (salaries.length !== 2 || first === undefined || second === undefined) {
    throw new AppError("BAD_REQUEST", "A ratio is between two people's salaries.");
  }
  if (first.personId === second.personId) {
    throw new AppError("BAD_REQUEST", "A ratio is between two different people.");
  }
  for (const { amountCents } of salaries) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new AppError("BAD_REQUEST", "A salary is a whole number of cents, zero or more.");
    }
  }
  const total = BigInt(first.amountCents) + BigInt(second.amountCents);
  if (total === 0n) {
    throw new AppError("BAD_REQUEST", "Two salaries of zero give no ratio.");
  }
  // round(a / total × 1e6) half-up = floor((2 × a × 1e6 + total) / (2 × total)).
  const million = BigInt(PARTS_PER_MILLION);
  const firstParts = Number((2n * BigInt(first.amountCents) * million + total) / (2n * total));
  return [
    { personId: first.personId, partsPerMillion: firstParts },
    { personId: second.personId, partsPerMillion: PARTS_PER_MILLION - firstParts },
  ];
}

/**
 * The ratio in effect on `date`: of those taking effect on or before it, the one
 * that took effect last. `null` before the first. The caller passes only the
 * records that stand — a corrected ratio is superseded, not in effect.
 */
export function ratioInEffect<R extends { effectiveFrom: string }>(
  ratios: readonly R[],
  date: string,
): R | null {
  let found: R | null = null;
  for (const ratio of ratios) {
    if (ratio.effectiveFrom > date) continue;
    if (found === null || ratio.effectiveFrom > found.effectiveFrom) found = ratio;
  }
  return found;
}
