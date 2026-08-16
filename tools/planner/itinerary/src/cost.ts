/**
 * Budget arithmetic over bands, never over points.
 *
 * §2's failure 4 is a budget that does not sum to its own line items, and it is
 * on the list because it is the kind of thing a model gets wrong and a computer
 * cannot. So the summing happens here, in ordinary TypeScript, and the result
 * is a band — the contract has no field for a single figure, deliberately, and
 * this module must not invent one by collapsing `low` and `high`.
 *
 * Two rules the arithmetic turns on:
 *
 * - **`per-person` multiplies by the party size; `per-party` does not.** A
 *   museum ticket at €12 per person for four people is €48 in the total and €12
 *   on the line, and both numbers have to stay true.
 * - **Currencies are never converted.** There is no rate in this package and
 *   there will not be one: a rate is a fact with an age, which makes it
 *   grounding, and a plan that silently added CAD to EUR would be wrong in a
 *   way nobody could see. Mixed currencies mean the total is not computable,
 *   and that is reported rather than papered over.
 */

import { isAnswered } from "@planner/contract";
import type { CostEstimate, TripBrief, TripBudget } from "@planner/contract";

/** A total, in one currency, as the band it actually is. */
export interface CostBand {
  currency: string;
  low: number;
  high: number;
}

export interface CostTotal {
  /** `null` when nothing had a cost at all, or when the currencies do not agree. */
  band: CostBand | null;
  /** Every currency seen. More than one is why `band` may be `null`. */
  currencies: string[];
  /** Ids of things that were placed with no cost estimate — a hole in the total. */
  withoutCost: string[];
}

/**
 * Sum a set of cost estimates for a party of this size.
 *
 * Ids travel alongside the estimates rather than being looked up here so the
 * caller decides what a "line" is — an item, a day, the trip — and this stays
 * one piece of arithmetic with one meaning.
 */
export function totalCost(
  lines: readonly { id: string; cost: CostEstimate | null }[],
  party: number,
): CostTotal {
  const currencies = new Set<string>();
  const withoutCost: string[] = [];
  let low = 0;
  let high = 0;
  let counted = 0;

  for (const line of lines) {
    if (line.cost === null) {
      withoutCost.push(line.id);
      continue;
    }
    currencies.add(line.cost.currency);
    const multiplier = line.cost.basis === "per-person" ? party : 1;
    low += line.cost.low * multiplier;
    high += line.cost.high * multiplier;
    counted += 1;
  }

  const band =
    counted > 0 && currencies.size === 1 ? { currency: [...currencies][0] ?? "", low, high } : null;

  return { band, currencies: [...currencies], withoutCost };
}

/**
 * The most the party said they would spend, as a figure this package can
 * compare against — or `null` when they did not give one.
 *
 * A `band` budget ("moderate", "shoestring") is deliberately not turned into a
 * number here. Deciding that "moderate" is €2,000 would be this package
 * inventing the single most consequential figure in the plan, and the honest
 * consequence is that the budget check does not run — recorded as
 * `"budget-band"` in `UNCHECKED_CONSTRAINTS` rather than passing quietly.
 *
 * `per-day` needs the day count, which is why it is an argument: the same
 * budget answer means a different ceiling for a long trip than a short one.
 */
export function budgetCeiling(
  budget: TripBudget,
  party: number,
  dayCount: number,
): CostBand | null {
  if (budget.kind === "band") return null;

  const multiplier =
    budget.basis === "per-person" ? party : budget.basis === "per-day" ? dayCount : 1;

  const amount = budget.amount * multiplier;
  return { currency: budget.currency, low: amount, high: amount };
}

/**
 * The party's size, for the arithmetic above.
 *
 * `travellers` is a required slot, so a brief that reaches the composer has
 * been asked — but it can still have been declined, and a declined slot is
 * indistinguishable from an unknown one by design. One is the assumption that
 * cannot inflate a total, and it is the only assumption that fails safe: a
 * per-person cost counted once is under, and being under is what the band's
 * `high` end is for.
 */
export function partySize(brief: TripBrief): number {
  return isAnswered(brief.travellers) ? brief.travellers.value : 1;
}

/**
 * Whether a total is over budget beyond any doubt.
 *
 * The test is against the band's **low** end, not its high: a total of
 * €1,800–€2,400 against a €2,000 budget is a plan that might fit, and refusing
 * to ship it would be treating an estimate as a quote. Only a total whose
 * cheapest reading still exceeds the ceiling is a constraint the plan actually
 * violates.
 *
 * A currency mismatch is not a violation. It is an unchecked constraint, and
 * the caller records it as one.
 */
export function isOverBudget(total: CostBand | null, ceiling: CostBand | null): boolean {
  if (total === null || ceiling === null) return false;
  if (total.currency !== ceiling.currency) return false;
  return total.low > ceiling.high;
}
