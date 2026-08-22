/**
 * What a plan did **not** check, said out loud.
 *
 * The repo's _never fake progress_ rule reaches further here than it does
 * anywhere else in the tool. A packed plan looks equally finished whether every
 * constraint was enforced or three of them were skipped for want of data, and
 * the difference is invisible to the reader — which makes silence about it the
 * most consequential lie this tool could tell. So every constraint the composer
 * could not evaluate is data, and the plan view renders it beside the days.
 *
 * **This is not `PlanGap`, and the two must not be merged.** A `PlanGap` says a
 * *specialist* did not contribute — it names one, and every one of its reasons
 * is about the fan-out. "We could not check travel time" is not a statement
 * about a specialist at all: route-and-logistics ran perfectly and returned
 * good candidates, and the thing missing is a distance nobody has. Reaching for
 * `specialist-not-applicable` to carry it would put a false sentence in front
 * of a user about a specialist that worked.
 *
 * ## Why it is contract and not `@planner/itinerary`'s alone
 *
 * It was the composer's private type until pl-10, because nothing outside the
 * composer's own result had seen it. Now the plan view renders it and the API
 * sends it, which makes it a wire type — and a wire type defined in the package
 * that happens to compute it would have to be redefined by every reader.
 * `@planner/itinerary` still owns the *deriving*; this file owns the vocabulary
 * and the shape.
 *
 * It is deliberately **not** stored. The list is a function of the brief, the
 * candidates and which of them were placed, so it is derived from the revision
 * being read — see `uncheckedForRevision`. Storing it would let a stored list
 * disagree with the days it is printed beside.
 */

import { z } from "zod";

/** Same ceiling as `PlanGap.detail`: this is a sentence, not a report. */
export const MAX_UNCHECKED_DETAIL_CHARS = 500;

export const UNCHECKED_CONSTRAINTS = [
  /**
   * Travel time between consecutive items. §2's failure 1, and the one this
   * list exists for.
   *
   * **It is conditional as of pl-27, and it was not before.** It was on every
   * plan from pl-9 until then, and the reason was true at the time:
   * `Place.coordinates` was `null`, so a leg had no measured length — decided
   * 2026-08-16 for Phase 2 (roadmap, _Still open_), pack without it and name
   * the gap rather than invent a duration or pull grounding forward. pl-15 gave
   * a leg both of its ends and pl-24 gave the tool something that can measure
   * between them, so an entry now says something about **one plan** instead of
   * about the phase: it carries the candidates whose transition nothing could
   * measure, or the ones a run could not afford to look up, and it still stands
   * plan-wide in its original words when nothing was measured at all.
   *
   * **It is the one kind that may appear more than once in a list**, because
   * those are different sentences about different items, and wherever a plan
   * has placed items on two or more days at least one is present: a transition
   * is a pair of items within one day, so the overnight hop between days is
   * measured by nothing and named whatever the backend said about the rest. A
   * plan whose placed items all land on one day has no such hop, and may
   * legitimately carry no entry at all.
   *
   * A reader that assumed one entry per kind — a renderer keying a list by it,
   * say — stops being right here. `uncheckedConstraintKey` below is the
   * identity to use instead.
   *
   * A drive a specialist *stated* a duration for was always bounded by the
   * day's drive budget. What this entry has always been about is the distance
   * between one item and the next, and that is what a measured transition —
   * `PlanItem.travelFromPrevious` — now answers where it is present.
   */
  "travel-time",
  /**
   * A backcountry party's `maxDailyDistanceKm`.
   *
   * Still unconditional after pl-27, and the reason is a **mode** rather than a
   * missing distance: `TravelMode` has one member, `driving`, and how far a
   * party walks in a day is not answered by asking a routing engine how one
   * would drive it. See the note beside this entry in `itinerary`'s
   * `unchecked.ts`.
   */
  "daily-distance",
  /** A machine's `rangeKm` between fuel stops. Same reason as `daily-distance`: no trail mode. */
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
  /** Costs arrived in more than one currency, and nothing here converts. */
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

export const uncheckedConstraintSchema = z.object({
  kind: z.enum(UNCHECKED_CONSTRAINTS),
  detail: z.string().trim().min(1).max(MAX_UNCHECKED_DETAIL_CHARS),
  candidateIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<UncheckedConstraint>;

/**
 * Which entry this is — its identity within one plan's list.
 *
 * **The `kind` used to be that identity and stopped being it in pl-27.** A list
 * held at most one entry per kind until then, so every reader could and did use
 * the kind: the plan view keyed its `<li>` by it. `travel-time` now arrives up
 * to three times on one plan, because "nothing could measure this", "this run
 * stopped asking" and "nothing ever measures the hop between days" are three
 * different sentences about three different sets of items — and a list whose
 * whole job is saying which applies to what cannot collapse them.
 *
 * It lives here rather than in the renderer that first needed it, for the
 * reason this whole file lives here: the vocabulary belongs with the type, and
 * a second reader that invented its own would be free to disagree about when
 * two entries are the same entry. Where that matters most is React
 * reconciliation — a duplicate key can carry one entry's text under another's
 * position, or drop one — but the statement is about the data, not about React.
 *
 * The parts are joined by NUL, and that is not decoration. A separator a value
 * can contain is a separator a value can forge: with a comma between candidate
 * ids, `["a,b"]` and `["a", "b"]` are one key. Nothing that reaches here can
 * hold a NUL — `detail` is trimmed prose and an id is a `Candidate.id` — and
 * the same argument is made at greater length in `api`'s `place-key.ts`.
 */
export function uncheckedConstraintKey(constraint: UncheckedConstraint): string {
  const separator = "\u0000";
  return [constraint.kind, constraint.detail, constraint.candidateIds.join(separator)].join(
    separator,
  );
}
