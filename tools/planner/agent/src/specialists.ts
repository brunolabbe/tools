/**
 * What each specialist is, what it may return, and what bounds it.
 *
 * One shape for all seven — brief in, `Candidate`s out — because the alternative
 * is seven callers and seven ways for one of them to start writing a schedule.
 * `00-ANALYSIS.md` §4: **a specialist proposes options; it never writes the
 * schedule.** Nothing it returns says which day anything falls on, and the
 * output schema has no field that could.
 *
 * ## The appetite answers are constraints, not context
 *
 * Found by [pl-9](../../docs/work/pl-9-composer-and-critic.md) composing the six
 * checked-in candidate sets on 2026-08-16: the route candidates are routinely
 * over the day's drive budget and the composer drops every one of them, so a
 * road trip comes out with no drives in it. The road-trip fixture proposes a
 * 5½-hour leg to a party that answered `half-day`, which is 5 hours.
 *
 * The composer is right to refuse them, and the fix is here. `driveAppetite`,
 * `pace` and `effort` are **bounds on what a specialist may propose**, not
 * flavour for its prose, and the numbers they translate into are
 * `@planner/itinerary`'s `limits.ts` — passed in as `TripCapacity` rather than
 * imported, because this package owns no arithmetic tables and must not become
 * a second place a day's length is decided.
 *
 * A leg longer than the day allows has to be split or not proposed. The prompt
 * says so and `CANDIDATE_LIMIT_OF` is what enforces it after the reply, because
 * a rule a model was merely asked to follow is not a rule (§2).
 */

import type { Specialist } from "@planner/contract";

// ---------------------------------------------------------------------------
// What a day holds
// ---------------------------------------------------------------------------

/**
 * The day's ceilings, and the trip's length, as the caller computed them.
 *
 * Structurally what `@planner/itinerary`'s `dayCapacity(brief)` returns, plus
 * `tripSpan(dates).dayCount` — so a caller writes
 * `{ dayCount: tripSpan(dates).dayCount, ...dayCapacity(brief) }` and nothing is
 * re-derived here. It is a **required** argument on the fan-out rather than an
 * optional one for exactly the reason pl-9 found: a caller who forgets it writes
 * the bug this type exists to prevent, and forgetting should be a compile error.
 */
export interface TripCapacity {
  /** How many `PlanDay`s this trip will have. */
  dayCount: number;
  /** Minutes of doing a day may hold, from the party's effort appetite. */
  activityMinutes: number;
  /** Minutes behind the wheel a day may hold. `null` when the shape has no drive appetite. */
  driveMinutes: number | null;
  /** How many scheduled things a city day holds, from the party's pace. `null` otherwise. */
  activityItems: number | null;
}

/**
 * Which of the day's budgets one specialist's output is charged to.
 *
 * **This is `@planner/itinerary`'s `BUCKET_OF` seen from the proposing side, and
 * the two must agree.** They are separate because the packer's table is about
 * where a candidate goes and this one is about what a specialist may propose,
 * and because `agent` depending on `itinerary` would make the package that talks
 * to a model depend on the package that must never do arithmetic for it. The
 * agreement is not left to care: `agent/test/limits-agree.test.ts` imports both
 * and fails when they drift.
 *
 * `anchor` and `unscheduled` have no minute ceiling. A hotel consumes no part of
 * a day — it is where the day ends — and "bring crampons" is true of the trip
 * rather than of Tuesday.
 */
export const CANDIDATE_LIMIT_OF: Record<Specialist, "drive" | "activity" | "none"> = {
  "route-and-logistics": "drive",
  lodging: "none",
  activities: "activity",
  food: "activity",
  "conditions-and-gear": "none",
  budget: "none",
  practicalities: "none",
};

/**
 * The longest one candidate from this specialist may be, in minutes.
 *
 * `null` means no ceiling, which is honest for a hotel and for a gear note. A
 * drive on a shape with no drive appetite falls back to the activity budget, the
 * same substitution the packer makes: a three-hour transfer is three hours gone
 * whether or not the party was asked how much road they like.
 */
export function candidateCeiling(specialist: Specialist, capacity: TripCapacity): number | null {
  switch (CANDIDATE_LIMIT_OF[specialist]) {
    case "drive":
      return capacity.driveMinutes ?? capacity.activityMinutes;
    case "activity":
      return capacity.activityMinutes;
    case "none":
      return null;
  }
}

// ---------------------------------------------------------------------------
// The specialists themselves
// ---------------------------------------------------------------------------

export interface SpecialistDefinition {
  /** What to call it in a sentence a user reads. */
  title: string;
  /** Its brief, in the prompt's words. */
  role: string;
  /**
   * The `CandidateLocation` kind its output must have, enforced after the reply.
   *
   * `between` for `route-and-logistics` alone: a leg carries both its ends as
   * structure, not in its title (pl-15). A route candidate that came back `at`
   * one place is a leg whose endpoints went back into prose, and it is rejected
   * rather than stored — that is what stops the fixtures' old shape being
   * written again.
   */
  location: "at" | "between";
  /** Roughly how many options are worth having. A ceiling, never a quota to fill. */
  proposeAtMost: number;
}

export const SPECIALIST_DEFINITIONS: Record<Specialist, SpecialistDefinition> = {
  "route-and-logistics": {
    title: "route and logistics",
    role: "You propose the legs this trip is made of — drives, rides, transfers, ferries and trains — with the stops that make a long one bearable.",
    location: "between",
    proposeAtMost: 6,
  },
  lodging: {
    title: "lodging",
    role: "You propose places to sleep that match the roughest night the party said they would accept, and you say how far ahead each one has to be booked.",
    location: "at",
    proposeAtMost: 6,
  },
  activities: {
    title: "activities",
    role: "You propose things to do: what they are, how long they take, and when they are open.",
    location: "at",
    proposeAtMost: 8,
  },
  "conditions-and-gear": {
    title: "conditions and gear",
    role: "You describe the conditions this trip turns on — season, weather bands, snow, trail and tide — and the kit they imply. You never present any of it as clearance to go: point at the authoritative local source and say who it is.",
    location: "at",
    proposeAtMost: 4,
  },
  food: {
    title: "food",
    role: "You propose meals that are part of the trip rather than fuel for it, and you respect anything the party said they cannot eat.",
    location: "at",
    proposeAtMost: 6,
  },
  budget: {
    title: "budget",
    role: "You give cost estimates as bands and say what assumption each one rests on. You never total anything: the tool sums the bands itself, in code.",
    location: "at",
    proposeAtMost: 4,
  },
  practicalities: {
    title: "practicalities",
    role: "You cover permits, documents, rentals, insurance and connectivity — the paperwork that decides whether the trip happens.",
    location: "at",
    proposeAtMost: 4,
  },
};
