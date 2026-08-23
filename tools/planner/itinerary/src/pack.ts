/**
 * The day packer.
 *
 * Candidates in, days out, under the constraints the brief and the candidates
 * actually carry — and under nothing else. §2's decision in its narrowest form:
 * this is arithmetic, so it is code, and it is code that can be wrong in a way
 * a unit test catches.
 *
 * ## What a day is made of
 *
 * Three buckets, and which one a candidate lands in is a property of the
 * specialist that proposed it rather than a guess about its title:
 *
 * - **drive** — `route-and-logistics`. Legs and transfers, bounded by the
 *   party's drive appetite where the shape has one.
 * - **activity** — `activities` and `food`. Bounded by the party's effort
 *   appetite, and on a city trip by their pace as well.
 * - **anchor** — `lodging`. One per day, and it consumes no part of the day:
 *   it is where the day ends, not something the day has to fit around.
 *
 * The rest — `conditions-and-gear`, `budget`, `practicalities` — are not
 * scheduled at all. "Bring crampons" and "the park pass is €30" are true of the
 * trip and not of Tuesday, and putting them on a day would be inventing a
 * placement to fill a shape. They stay on the plan as candidates (a candidate
 * belongs to the plan, not to a revision) and pl-10 reads them from there.
 *
 * ## Days are filled evenly, not front to back
 *
 * The day chosen is the one with the least in that bucket already, ties going
 * to the earlier day. First-fit would pack day one to its ceiling and leave the
 * last three empty, which is a worse plan for the same set of candidates and is
 * not what anyone means by a week.
 *
 * ## What it refuses to invent
 *
 * A candidate with no `durationMinutes` consumes no minutes, takes an item slot
 * and carries a note saying so. The alternative — a plausible ninety minutes —
 * is the exact thing `Candidate`'s `null` exists to prevent, one layer down.
 * `startsAt` is `null` on every item this package produces: a wall-clock start
 * is a claim about something outside the plan fixing it, and without opening
 * hours (Phase 3) there is nothing that could.
 */

import {
  isAnswered,
  MAX_ITEMS_PER_DAY,
  type Candidate,
  type ItemTravel,
  type Specialist,
  type TripBrief,
} from "@planner/contract";
import {
  ACTIVITY_MINUTES_PER_DAY,
  ASSUMED_EFFORT,
  DRIVE_MINUTES_PER_DAY,
  ITEMS_PER_CITY_DAY,
} from "./limits.ts";
import { inSeasonOnDay } from "./season.ts";
import { transitionMinutes, type TravelTable } from "./travel.ts";
import type { TripSpan } from "./dates.ts";

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export const BUCKETS = ["drive", "activity", "anchor", "unscheduled"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * Which bucket each specialist's output falls in — a table, for the reason the
 * roster is one: "why is that not on a day" has to be answerable by reading a
 * row rather than by tracing the packer.
 */
export const BUCKET_OF: Record<Specialist, Bucket> = {
  "route-and-logistics": "drive",
  lodging: "anchor",
  activities: "activity",
  food: "activity",
  "conditions-and-gear": "unscheduled",
  budget: "unscheduled",
  practicalities: "unscheduled",
};

/** The order buckets are placed in, and the order they appear within a day. */
const PLACEMENT_ORDER: Bucket[] = ["drive", "activity", "anchor"];

// ---------------------------------------------------------------------------
// What the packer produces
// ---------------------------------------------------------------------------

export interface PackedItem {
  candidateId: string;
  bucket: Bucket;
  pinned: boolean;
  note: string | null;
  /**
   * Getting here from the item before it on this day (pl-27).
   *
   * `null` means exactly one thing — **nothing on this day precedes it** — and
   * every other answer is a named `ItemTravel`, including the two ways there is
   * no measurement. See `PlanItem.travelFromPrevious`, which is where this ends
   * up, and `transitionTo` for why an anchor carries one it is not charged for.
   */
  travelFromPrevious: ItemTravel | null;
}

export interface PackedDay {
  dayIndex: number;
  date: string | null;
  items: PackedItem[];
}

export const EXCLUSION_REASONS = [
  /** Its specialist's output is not scheduled onto days at all. */
  "not-schedulable",
  /** Its season window does not cover any day the trip could fall on. */
  "out-of-season",
  /** In season for the trip, but not for any day that still had room. */
  "no-day-in-season",
  /** Its booking lead time is longer than the time left before departure. */
  "booking-deadline-passed",
  /** Every day was already full, by items, by minutes or by pace. */
  "no-day-had-room",
  /** The critic dropped it to bring a day or a total back inside its constraint. */
  "dropped-by-critic",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface Excluded {
  candidateId: string;
  reason: ExclusionReason;
}

export interface PackResult {
  days: PackedDay[];
  excluded: Excluded[];
  /** Placed despite having no `durationMinutes`, so the day's budget under-counts. */
  durationUnknown: string[];
}

/** Where a previous revision put a pinned item. A re-plan may not move it off this day. */
export interface PinnedPlacement {
  candidateId: string;
  dayIndex: number;
  position: number;
}

export interface PackInput {
  brief: TripBrief;
  /** Already through the season filter — see `filterBySeason`. */
  candidates: readonly Candidate[];
  span: TripSpan;
  /**
   * What the grounding pass measured between candidates. Required rather than
   * optional: a caller that forgot it would silently pack under nothing, which
   * is the state this argument exists to make visible. `NOTHING_MEASURED` is
   * how a caller says there was no grounding.
   */
  travel: TravelTable;
  /** `null` when the brief has no departure to count a lead time back from. */
  daysUntilDeparture: number | null;
  pinned?: readonly PinnedPlacement[];
  /** Candidates the critic has already ruled out this run. */
  excluded?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// The day's capacity
// ---------------------------------------------------------------------------

interface Capacity {
  activityMinutes: number;
  /** `null` when the shape has no drive appetite; drives then eat the activity budget. */
  driveMinutes: number | null;
  /** `null` when the shape has no pace answer. `MAX_ITEMS_PER_DAY` still applies. */
  activityItems: number | null;
  /** True when `effort` was not answered and `ASSUMED_EFFORT` stood in for it. */
  effortAssumed: boolean;
}

function capacityOf(brief: TripBrief): Capacity {
  const effortAssumed = !isAnswered(brief.effort);
  const effort = isAnswered(brief.effort) ? brief.effort.value : ASSUMED_EFFORT;

  const details = brief.details;
  const driveMinutes =
    details?.shape === "road-trip" && isAnswered(details.driveAppetite)
      ? DRIVE_MINUTES_PER_DAY[details.driveAppetite.value]
      : null;
  const activityItems =
    details?.shape === "city-and-culture" && isAnswered(details.pace)
      ? ITEMS_PER_CITY_DAY[details.pace.value]
      : null;

  return {
    activityMinutes: ACTIVITY_MINUTES_PER_DAY[effort],
    driveMinutes,
    activityItems,
    effortAssumed,
  };
}

/** Exported so the critic checks a packed day against the same numbers that built it. */
export function dayCapacity(brief: TripBrief): Capacity {
  return capacityOf(brief);
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

interface DayState {
  dayIndex: number;
  date: string | null;
  /** Pinned first, in their previous order; then whatever was packed around them. */
  pinnedItems: PackedItem[];
  packedItems: PackedItem[];
  activityMinutes: number;
  driveMinutes: number;
  activityCount: number;
  hasAnchor: boolean;
  /**
   * The candidate the next item on this day will be travelled to from, or
   * `null` while the day is empty.
   *
   * **The item appended last is the item that comes last**, which is what makes
   * charging a transition as we go exact rather than an estimate. Pins lead the
   * day and are appended first; everything else is appended bucket by bucket in
   * `PLACEMENT_ORDER`, and `sortByBucket` is a stable sort over that same
   * order — so the sequence this field tracks is the sequence the day ends up
   * in. A transition *into* a day's first item is deliberately not modelled: it
   * belongs to no day's budget, and there is no order between days until every
   * bucket has been placed.
   */
  lastCandidateId: string | null;
}

function noteFor(candidate: Candidate): string | null {
  return candidate.durationMinutes === null
    ? "How long this takes was not established, so it was not counted against the day."
    : null;
}

/**
 * Whether a candidate can be added to a day without breaking one of its bounds.
 *
 * Pinned items do not go through this — they are the user's decision and the
 * packer's input, so a pin that makes a day impossible produces an over-full
 * day for the critic to find, not a silently dropped pin.
 */
function fits(
  day: DayState,
  candidate: Candidate,
  bucket: Bucket,
  capacity: Capacity,
  transition: number,
): boolean {
  if (day.pinnedItems.length + day.packedItems.length >= MAX_ITEMS_PER_DAY) return false;
  if (!inSeasonOnDay(candidate, day.date)) return false;

  if (bucket === "anchor") return !day.hasAnchor;

  // The candidate's own stated duration, plus getting to it from the thing
  // before it on this day. The second half is pl-27, and it is `0` for every
  // plan composed without grounding — which is what keeps the change additive.
  const minutes = (candidate.durationMinutes ?? 0) + transition;

  if (bucket === "drive" && capacity.driveMinutes !== null) {
    return day.driveMinutes + minutes <= capacity.driveMinutes;
  }

  // A drive on a shape with no drive appetite is charged to the day's activity
  // budget: a three-hour transfer is three hours gone whether or not the party
  // was asked how much road they like.
  if (capacity.activityItems !== null && bucket === "activity") {
    if (day.activityCount >= capacity.activityItems) return false;
  }
  return day.activityMinutes + minutes <= capacity.activityMinutes;
}

function charge(
  day: DayState,
  candidate: Candidate,
  bucket: Bucket,
  capacity: Capacity,
  transition: number,
): void {
  const minutes = (candidate.durationMinutes ?? 0) + transition;
  if (bucket === "drive" && capacity.driveMinutes !== null) {
    day.driveMinutes += minutes;
  } else if (bucket !== "anchor") {
    day.activityMinutes += minutes;
    day.activityCount += 1;
  } else {
    day.hasAnchor = true;
  }
  day.lastCandidateId = candidate.id;
}

/**
 * What was measured about getting to `candidate` on `day`, or `null`.
 *
 * One thing is deliberately not a transition: the **first item of a day**.
 * Nothing on that day precedes it, and the hop from wherever the party slept
 * belongs to no day's budget — the packer has no order between days until every
 * bucket has been placed.
 *
 * ## The anchor is measured and not charged, and that is not an inconsistency
 *
 * Getting to where you sleep is real travel and the plan should say what it
 * costs, so it is recorded. It is not *charged*, because `fits` cannot refuse
 * an anchor on budget — a day has to be able to end somewhere, and pl-9's rule
 * is that the bed is where the day ends rather than something the day fits
 * around. Charging it could only ever produce an over-full day that the critic
 * then rejects, which turns "the hotel is a long way off" into a plan the user
 * does not get. `charge` ignores the minutes on the anchor branch already; this
 * function does not have to know that, and the record reaches the plan either
 * way.
 */
function transitionTo(
  day: DayState,
  candidate: Candidate,
  travel: TravelTable,
  byId: ReadonlyMap<string, Candidate>,
): ItemTravel | null {
  if (day.lastCandidateId === null) return null;
  const previous = byId.get(day.lastCandidateId);
  return previous === undefined ? null : travel.between(previous, candidate);
}

/** How full a day already is in this bucket, for the least-loaded choice. */
function load(day: DayState, bucket: Bucket): number {
  if (bucket === "anchor") return day.hasAnchor ? 1 : 0;
  if (bucket === "drive") return day.driveMinutes;
  return day.activityMinutes;
}

export function pack(input: PackInput): PackResult {
  const { brief, span, daysUntilDeparture } = input;
  const capacity = capacityOf(brief);
  const excludedIds = input.excluded ?? new Set<string>();
  const pinnedBy = new Map(
    (input.pinned ?? []).map((placement) => [placement.candidateId, placement]),
  );

  const days: DayState[] = Array.from({ length: span.dayCount }, (_, dayIndex) => ({
    dayIndex,
    date: span.dates[dayIndex] ?? null,
    pinnedItems: [],
    packedItems: [],
    activityMinutes: 0,
    driveMinutes: 0,
    activityCount: 0,
    hasAnchor: false,
    lastCandidateId: null,
  }));

  const excluded: Excluded[] = [];
  const durationUnknown: string[] = [];
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));

  const record = (candidate: Candidate): void => {
    if (candidate.durationMinutes === null) durationUnknown.push(candidate.id);
  };

  // --- Pinned first, in their previous day and order. The user's placement is
  // an input constraint, so it is honoured before anything competes for room.
  const pinnedInOrder = [...pinnedBy.values()].toSorted(
    (left, right) => left.dayIndex - right.dayIndex || left.position - right.position,
  );
  for (const placement of pinnedInOrder) {
    const candidate = byId.get(placement.candidateId);
    const day = days[placement.dayIndex];
    if (candidate === undefined || day === undefined) continue;
    const bucket = BUCKET_OF[candidate.specialist];
    const travelled = transitionTo(day, candidate, input.travel, byId);
    day.pinnedItems.push({
      candidateId: candidate.id,
      bucket,
      pinned: true,
      note: noteFor(candidate),
      travelFromPrevious: travelled,
    });
    charge(day, candidate, bucket, capacity, transitionMinutes(travelled));
    record(candidate);
  }

  // --- Then everything else, bucket by bucket. Drives are the skeleton of a
  // day, activities hang off them, and the anchor is where the day ends.
  for (const bucket of PLACEMENT_ORDER) {
    for (const candidate of input.candidates) {
      if (pinnedBy.has(candidate.id)) continue;
      if (BUCKET_OF[candidate.specialist] !== bucket) continue;

      if (excludedIds.has(candidate.id)) {
        excluded.push({ candidateId: candidate.id, reason: "dropped-by-critic" });
        continue;
      }
      if (
        candidate.bookingLeadTimeDays !== null &&
        daysUntilDeparture !== null &&
        candidate.bookingLeadTimeDays > daysUntilDeparture
      ) {
        excluded.push({ candidateId: candidate.id, reason: "booking-deadline-passed" });
        continue;
      }

      // The transition is per-day — it depends on what is already on that day —
      // so it is worked out once per candidate and day, and the same value
      // decides the fit and pays for it.
      const travelled = new Map<number, ItemTravel | null>(
        days.map((day) => [day.dayIndex, transitionTo(day, candidate, input.travel, byId)]),
      );
      const options = days.filter((day) =>
        fits(
          day,
          candidate,
          bucket,
          capacity,
          transitionMinutes(travelled.get(day.dayIndex) ?? null),
        ),
      );
      const chosen = options.reduce<DayState | null>(
        (best, day) => (best === null || load(day, bucket) < load(best, bucket) ? day : best),
        null,
      );

      if (chosen === null) {
        // Distinguish "the calendar was against it" from "the days were full":
        // they are different sentences to a user, and only one of them is
        // fixable by dropping something else.
        const anyDayInSeason = days.some((day) => inSeasonOnDay(candidate, day.date));
        excluded.push({
          candidateId: candidate.id,
          reason: anyDayInSeason ? "no-day-had-room" : "no-day-in-season",
        });
        continue;
      }

      const arrival = travelled.get(chosen.dayIndex) ?? null;
      chosen.packedItems.push({
        candidateId: candidate.id,
        bucket,
        pinned: false,
        note: noteFor(candidate),
        travelFromPrevious: arrival,
      });
      charge(chosen, candidate, bucket, capacity, transitionMinutes(arrival));
      record(candidate);
    }
  }

  for (const candidate of input.candidates) {
    if (BUCKET_OF[candidate.specialist] === "unscheduled") {
      excluded.push({ candidateId: candidate.id, reason: "not-schedulable" });
    }
  }

  return {
    days: days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      // Pinned keep their relative order and lead the day; the rest follow in
      // bucket order. Positions are assigned from this list and are dense,
      // which the contract requires — so a pin fixes the day and the order
      // among pins, and cannot fix an absolute index the day may no longer have.
      items: [...day.pinnedItems, ...sortByBucket(day.packedItems)],
    })),
    excluded,
    durationUnknown,
  };
}

function sortByBucket(items: readonly PackedItem[]): PackedItem[] {
  return items.toSorted(
    (left, right) => PLACEMENT_ORDER.indexOf(left.bucket) - PLACEMENT_ORDER.indexOf(right.bucket),
  );
}
