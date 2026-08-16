/**
 * What the composer did **not** check, said out loud.
 *
 * The repo's _never fake progress_ rule reaches further here than it does
 * anywhere else in the tool. A packed plan looks equally finished whether every
 * constraint was enforced or three of them were skipped for want of data, and
 * the difference is invisible to the reader — which makes silence about it the
 * most consequential lie this package could tell. So every constraint the
 * composer could not evaluate comes back as data on the result, and pl-10
 * renders it beside the days.
 *
 * **This is not `PlanGap`, and the two must not be merged.** A `PlanGap` says a
 * *specialist* did not contribute — it names one, and every one of its reasons
 * is about the fan-out. "We could not check travel time" is not a statement
 * about a specialist at all: route-and-logistics ran perfectly and returned
 * good candidates, and the thing missing is a distance nobody has. Reaching for
 * `specialist-not-applicable` to carry it would put a false sentence in front
 * of a user about a specialist that worked.
 *
 * It therefore lives on the composer's result rather than on the persisted
 * revision, which is the honest shape available without a contract change —
 * see the log on pl-9. If it should survive a reload, `PlanGapReason` needs a
 * member that is about a constraint rather than about a specialist, and that is
 * a contract change with its own ticket.
 */

export const UNCHECKED_CONSTRAINTS = [
  /**
   * Travel time between consecutive items. §2's failure 1, and the one this
   * list exists for.
   *
   * `Place.coordinates` is `null` until grounding lands, so there is no leg to
   * compute — decided 2026-08-16 for Phase 2 (roadmap, _Still open_): pack
   * without it and name the gap, rather than invent a duration or pull
   * grounding forward. A drive a specialist *stated* a duration for is still
   * bounded by the day's drive budget; what is unchecked is the distance
   * between one item and the next.
   */
  "travel-time",
  /** A backcountry party's `maxDailyDistanceKm`. Same cause: no coordinates, no legs. */
  "daily-distance",
  /** A machine's `rangeKm` between fuel stops. Same cause. */
  "machine-range",
  /** Whether a place is open on the day it was placed. Opening hours are Phase 3. */
  "opening-hours",
  /**
   * The brief's deal-breakers.
   *
   * `dealBreakers` is free text — "no more than one night in any campground
   * without showers" — and no arithmetic decides whether a candidate violates
   * it. §7 puts a deal-breaker check "in code", and in code is exactly where
   * this one cannot happen: a keyword match against a sentence would fail both
   * ways and would look like a check while being none. So it is stated as
   * unchecked, the specialists that read the brief carry it, and the honest
   * fix is a structured constraint the composer can evaluate rather than a
   * cleverer string search.
   */
  "deal-breakers",
  /** Costs arrived in more than one currency, and this package converts nothing. */
  "budget-currency",
  /** The budget is a band ("moderate"), so there is no figure to sum against. */
  "budget-band",
  /** A placed candidate whose `season` is `null` — not established, not all-year. */
  "season-unknown",
  /** The brief has no calendar, so no season could be compared to a day at all. */
  "season-no-calendar",
  /** The brief has no departure, so no booking lead time could be counted back from it. */
  "booking-no-departure",
  /** A placed candidate with no `durationMinutes` — it consumed no part of the day's budget. */
  "duration-unknown",
  /** `effort` was declined, so the day's size is an assumption. See `ASSUMED_EFFORT`. */
  "effort-assumed",
  /** The trip is longer than `MAX_PLAN_DAYS` and the plan stops short of its last day. */
  "trip-truncated",
] as const;

export type UncheckedConstraintKind = (typeof UNCHECKED_CONSTRAINTS)[number];

/**
 * One constraint that was not enforced, and what it applies to.
 *
 * `detail` is written for a reader of the plan, not for a log — the same bar
 * `PlanGap.detail` sets. `candidateIds` is empty when the constraint is about
 * the whole plan rather than about particular items.
 */
export interface UncheckedConstraint {
  kind: UncheckedConstraintKind;
  detail: string;
  candidateIds: string[];
}

/** Constructor, so no caller assembles one with a missing array. */
export function unchecked(
  kind: UncheckedConstraintKind,
  detail: string,
  candidateIds: readonly string[] = [],
): UncheckedConstraint {
  return { kind, detail, candidateIds: [...candidateIds] };
}
