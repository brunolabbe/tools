/**
 * Turning a plan into what a reader sees.
 *
 * Presentation only, like the wizard's `format.ts`, and with one rule that is
 * not merely presentational: **a cost is a band and is never rendered as a
 * single figure.** Analysis §5 ranks prices the fastest-ageing thing this tool
 * touches, which is why `CostEstimate` has no field for one number — printing
 * the midpoint or the low end here would put the quote back that the contract
 * went out of its way to make unrepresentable.
 */

import type { CandidateLocation, CostEstimate, PlanDay, Place } from "@planner/contract";

/** Enum members are kebab-case on the wire and prose on the page. */
export function humanise(value: string): string {
  return value.replaceAll("-", " ");
}

/**
 * A day's heading.
 *
 * **`date` is null on every flexible-dates trip**, which is a normal trip and
 * not an edge case: the brief said "ten nights, whenever is best", so there is
 * no calendar and the day's identity is its index. A heading that invented a
 * date here would be planning against one the user never chose — the exact
 * thing `PlanDay.date` is nullable to prevent.
 */
export function dayHeading(day: PlanDay): string {
  const ordinal = `Day ${String(day.dayIndex + 1)}`;
  return day.date === null ? ordinal : `${ordinal} · ${day.date}`;
}

function placeName(place: Place): string {
  // `locality` is free text and nothing parses structure back out of it — it is
  // shown as the specialist wrote it, or not at all.
  return place.locality === null ? place.name : `${place.name}, ${place.locality}`;
}

/**
 * Where an item is, or where it runs between.
 *
 * Both ends, always, for a leg: pl-15 made `location` a union precisely so a
 * drive stops hiding its endpoints in its title, and rendering only `from`
 * would silently drop where it goes.
 *
 * **Nothing is said about coordinates.** A leg can be half-grounded — the
 * multi-city rail leg has them on its origin station and not on its
 * destination — and there is no honest sentence about that until Phase 3 has a
 * use for them. Saying "we know where one end is" would be noise about a
 * distinction the reader cannot act on. Decided here rather than left to fall
 * out of the template.
 */
export function describeLocation(location: CandidateLocation): string {
  return location.kind === "at"
    ? placeName(location.place)
    : `${placeName(location.from)} → ${placeName(location.to)}`;
}

/**
 * A cost band, in words.
 *
 * `low === high` is a genuinely fixed price — a museum's posted admission — and
 * the contract allows it deliberately, as a *different claim* from a narrow
 * estimate. So it is labelled as posted rather than printed bare: the rule this
 * file exists for is that no estimate is shown as one number, and the way to
 * keep it is to say which of the two a figure is.
 */
export function describeCost(cost: CostEstimate): string {
  const basis = cost.basis === "per-person" ? "per person" : "for the party";
  const amount =
    cost.low === cost.high
      ? `${cost.low.toLocaleString()} ${cost.currency}, a posted price`
      : `${cost.low.toLocaleString()}–${cost.high.toLocaleString()} ${cost.currency}`;
  return `${amount}, ${basis}`;
}
