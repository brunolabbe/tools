/**
 * Working out what the composer did **not** check.
 *
 * The vocabulary — `UNCHECKED_CONSTRAINTS`, `UncheckedConstraint` and why it is
 * emphatically not a `PlanGap` — moved to `@planner/contract` in pl-10, when the
 * plan view started rendering it and the API started sending it. Read that file
 * for what the list *is*. This one derives it, which is still this package's
 * job: it is a statement about what the packing and the constraint checks in
 * here could not do.
 *
 * ## It survives a reload without being stored (pl-10)
 *
 * pl-9 left two ways to keep the list across a read: give `PlanGapReason` a
 * member that is about a constraint, or re-run `compose` on every read.
 * `uncheckedFor` below is a third and is the one taken, because **the list is a
 * function of the brief, the candidates and which of them were placed** — and a
 * stored revision says which were placed. So it is derived from the revision the
 * reader is looking at, which beats both:
 *
 * - Against **storing** it: a stored list can disagree with the days it is
 *   printed beside. This one cannot, because it is read off them.
 * - Against **re-composing**: no re-pack per read, and no drift. Re-composing
 *   re-runs the packer against today's `limits.ts` and today's date — a booking
 *   deadline that has since passed changes what packs — so it would print a list
 *   about a plan the reader is not looking at.
 *
 * The function reads **no clock**, which is what makes that claim hold. The one
 * clock-dependent input the composer had was `daysUntilDeparture`, and it turned
 * out to be dead: it was only tested for `null`, which happens exactly when the
 * dates are `open`, which the branch above it had already handled.
 */

import {
  AppError,
  isAnswered,
  revisionItems,
  type Candidate,
  type PlanRevision,
  type TripBrief,
  type TripDates,
  type UncheckedConstraint,
  type UncheckedConstraintKind,
} from "@planner/contract";
import { tripSpan } from "./dates.ts";
import { dayCapacity } from "./pack.ts";

/**
 * Re-exported so a caller that already depends on this package for the composer
 * does not need a second import for the type of what it returns.
 */
export {
  UNCHECKED_CONSTRAINTS,
  type UncheckedConstraint,
  type UncheckedConstraintKind,
} from "@planner/contract";

/** Constructor, so no caller assembles one with a missing array. */
export function unchecked(
  kind: UncheckedConstraintKind,
  detail: string,
  candidateIds: readonly string[] = [],
): UncheckedConstraint {
  return { kind, detail, candidateIds: [...candidateIds] };
}

// ---------------------------------------------------------------------------
// Deriving the list
// ---------------------------------------------------------------------------

/**
 * What a plan did not check, from the plan itself.
 *
 * `placedIds` is the whole of what this needs to know about the schedule —
 * which candidates made it onto a day. The composer passes the pack it has just
 * built; a reader passes a stored revision through `uncheckedForRevision`. Both
 * get the same list for the same plan, which is the property that makes this
 * survive a reload.
 *
 * Everything else is read off the brief and the candidates, so nothing here
 * depends on the packer's numbers or on today's date.
 */
export function uncheckedFor(input: {
  brief: TripBrief;
  /** The trip's dates, already narrowed — this package never invents a calendar. */
  dates: TripDates;
  /** Every candidate the plan draws on, placed or not. */
  candidates: readonly Candidate[];
  /** The candidates that made it onto a day. */
  placedIds: ReadonlySet<string>;
}): UncheckedConstraint[] {
  const { brief, dates, candidates, placedIds } = input;
  // Every candidate, not the season filter's `kept` set: a pinned candidate
  // outranks that filter (see `compose.ts`), so it can be on a day and out of
  // `kept` at once — and what is on the plan is what this list must speak for.
  const placed = candidates.filter((candidate) => placedIds.has(candidate.id));

  const notes: UncheckedConstraint[] = [
    // Always, and first. A leg carries both its ends since pl-15, but Phase 2
    // has no coordinates, so nothing measured the distance along one — decided
    // 2026-08-16, roadmap _Still open_.
    unchecked(
      "travel-time",
      "How long it takes to get from one of these to the next was not checked. Nothing here measured a distance.",
    ),
    unchecked(
      "opening-hours",
      "Whether these places are open on the days they were put on was not checked.",
    ),
  ];

  if (isAnswered(brief.dealBreakers) && brief.dealBreakers.value.length > 0) {
    notes.push(
      unchecked(
        "deal-breakers",
        "The things you said would rule a trip out were passed to the people proposing it, but nothing here could check the plan against them.",
      ),
    );
  }

  const details = brief.details;
  if (details?.shape === "backcountry" && isAnswered(details.maxDailyDistanceKm)) {
    notes.push(
      unchecked(
        "daily-distance",
        "How far each day actually goes was not checked — see travel time.",
      ),
    );
  }
  if (details?.shape === "motorised-touring" && isAnswered(details.rangeKm)) {
    notes.push(
      unchecked(
        "machine-range",
        "Whether each day stays inside your range was not checked — see travel time.",
      ),
    );
  }

  if (dayCapacity(brief).effortAssumed) {
    notes.push(
      unchecked(
        "effort-assumed",
        "You did not say how full you like a day, so these are ordinary ones.",
      ),
    );
  }

  // `open` dates are the only kind with no departure to count back from, which
  // is why there is no second branch here — see the header.
  if (dates.kind === "open") {
    notes.push(
      unchecked(
        "season-no-calendar",
        "There are no dates yet, so nothing was checked against a season.",
      ),
    );
    notes.push(
      unchecked(
        "booking-no-departure",
        "There are no dates yet, so no booking deadline could be checked.",
      ),
    );
  }

  // `null` is *not established*, never "all year" — the two must not collapse,
  // which is the whole reason `ALL_YEAR` exists.
  const seasonUnknown = placed.filter((candidate) => candidate.season === null);
  if (seasonUnknown.length > 0) {
    notes.push(
      unchecked(
        "season-unknown",
        "Nobody established when these are open, so they were left in.",
        seasonUnknown.map((candidate) => candidate.id),
      ),
    );
  }

  const durationUnknown = placed.filter((candidate) => candidate.durationMinutes === null);
  if (durationUnknown.length > 0) {
    notes.push(
      unchecked(
        "duration-unknown",
        "How long these take was never established, so they were not counted against the day.",
        durationUnknown.map((candidate) => candidate.id),
      ),
    );
  }

  if (isAnswered(brief.budget) && brief.budget.value.kind === "band") {
    notes.push(
      unchecked(
        "budget-band",
        "You gave a feel for the budget rather than a figure, so nothing was summed against it.",
      ),
    );
  }

  const currencies = new Set(
    placed
      .map((candidate) => candidate.cost?.currency)
      .filter((currency): currency is string => currency !== undefined),
  );
  if (currencies.size > 1) {
    notes.push(
      unchecked(
        "budget-currency",
        `Costs came back in ${[...currencies].toSorted().join(" and ")}, and nothing here converts between them, so the total was not summed.`,
      ),
    );
  }

  if (tripSpan(dates).truncated) {
    notes.push(
      unchecked(
        "trip-truncated",
        "This trip is longer than a plan can hold, so the last days are not here.",
      ),
    );
  }

  return notes;
}

/**
 * The same list, for a plan read back out of storage.
 *
 * This is what makes the honesty a property of the plan rather than of how the
 * reader arrived at it. Rendering `unchecked` only on the run that produced it
 * was the third option pl-10 named and refused: a plan opened from the list a
 * day later would look like one where everything had been checked.
 *
 * It takes the revision rather than a plan so a caller can ask about any of
 * them, which is what the revision picker needs.
 */
export function uncheckedForRevision(input: {
  brief: TripBrief;
  candidates: readonly Candidate[];
  revision: PlanRevision;
}): UncheckedConstraint[] {
  const { brief, candidates, revision } = input;

  // The same guard `compose` makes, and the same sentence: a brief with no
  // dates has no days, so there was never a plan to say anything about. A
  // stored plan always passes it — `startRun` refuses the brief otherwise.
  if (!isAnswered(brief.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }

  return uncheckedFor({
    brief,
    dates: brief.dates.value,
    candidates,
    placedIds: new Set(revisionItems(revision).map((item) => item.candidateId)),
  });
}
