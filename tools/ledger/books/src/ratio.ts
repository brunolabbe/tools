/**
 * The ratio the buffer is shared at, derived from the salaries (lg-5), of two
 * people or more (lg-23).
 *
 * A ratio is **parts per million** per person, because the owner's ratio has four
 * significant decimals of a percent and basis points would round them away
 * (`docs/00-ANALYSIS.md` §5, _Numbers_). It is derived from salaries and then
 * stored, with the date it takes effect, so a settlement can always be
 * recomputed with the ratio it actually used.
 *
 * **Rounding.** Each share is the exact share's whole number of parts per
 * million, and the parts left over — the exact shares sum to 1 000 000, so their
 * fractions sum to a whole number — go one each to the largest fractions, a tie
 * going to the person whose id sorts first (lg-23). That needs no state and gives
 * every reader the same answer, like the odd cent in `buckets.ts`. For two people
 * it is lg-5's rule exactly: their fractions sum to one, so the larger fraction
 * takes the part, which is rounding both half-up, and on an exact half, where
 * both would round up, the first takes it. The arithmetic is in `bigint`, so no
 * salary is ever large enough to lose a digit.
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

/** The shares, in id order, summing to exactly 1 000 000. */
export function ratioFromSalaries(salaries: readonly SalaryInput[]): Share[] {
  const sorted = salaries.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  if (sorted.length < 2) {
    throw new AppError("BAD_REQUEST", "A ratio is between at least two people's salaries.");
  }
  if (new Set(sorted.map((salary) => salary.personId)).size !== sorted.length) {
    throw new AppError("BAD_REQUEST", "A ratio is between different people.");
  }
  for (const { amountCents } of sorted) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new AppError("BAD_REQUEST", "A salary is a whole number of cents, zero or more.");
    }
  }
  const total = sorted.reduce((sum, salary) => sum + BigInt(salary.amountCents), 0n);
  if (total === 0n) {
    throw new AppError("BAD_REQUEST", "Salaries of zero give no ratio.");
  }
  // a / total × 1e6 = whole + remainder / total, in integers.
  const million = BigInt(PARTS_PER_MILLION);
  const exact = sorted.map((salary) => {
    const scaled = BigInt(salary.amountCents) * million;
    return { whole: scaled / total, remainder: scaled % total };
  });
  const left = Number(million - exact.reduce((sum, share) => sum + share.whole, 0n));
  // The largest remainders take a part each; on a tie the earlier id does.
  const ranked = exact
    .map((share, index) => ({ ...share, index }))
    .toSorted((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const extra = new Set(ranked.slice(0, left).map((share) => share.index));
  return sorted.map((salary, index) => ({
    personId: salary.personId,
    partsPerMillion: Number(exact[index]?.whole ?? 0n) + (extra.has(index) ? 1 : 0),
  }));
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
