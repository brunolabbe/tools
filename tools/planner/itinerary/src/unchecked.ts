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
 *
 * ## What pl-27 changed, and why it did not change the above
 *
 * `travel-time` is no longer unconditional. It is now a statement about which
 * of *this plan's* transitions were measured, and the input it reads that from
 * — `PlanItem.travelFromPrevious` — **is** stored, which looks like the opposite
 * decision to the one this header argues for.
 *
 * It is not. A measured distance is evidence: it came from outside, at a
 * moment, from a source, and there is nothing on the revision to re-derive it
 * from, so a plan that did not keep it could not say what its days were packed
 * against once the cache row expired. The list below is still a derivation, and
 * it is still derived from the revision the reader is holding — it just has one
 * more field of that revision to read. Nothing here re-measures anything.
 */

import {
  AppError,
  isAnswered,
  type Candidate,
  type ItemTravel,
  type PlanDay,
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
 * Every transition a plan's days have, and what measured each one.
 *
 * A transition is a **within-day** pair: an item and the item before it on the
 * same day. The first item of a day is not one, because nothing on that day
 * precedes it — the same rule `transitionTo` in `pack.ts` packs by, which is
 * what keeps this list and the days it is printed beside talking about one
 * thing.
 *
 * The hop from the last item of one day to the first of the next is genuinely
 * not measured here, and it is not silently claimed either: it is not a pair on
 * any day, so nothing measures it and nothing charges for it — see
 * `interDayTransitions` below, which is how the plan says so out loud.
 *
 * Reading it off the days rather than off a table handed in is what makes the
 * composer's list and a reader's list identical: both are looking at the items
 * the revision actually holds.
 */
function transitionsOf(
  days: readonly PlanDay[],
): { candidateId: string; travel: ItemTravel | null }[] {
  return days.flatMap((day) =>
    day.items
      .filter((_item, index) => index > 0)
      .map((item) => ({ candidateId: item.candidateId, travel: item.travelFromPrevious })),
  );
}

/**
 * The first item of every day after a day that had one — the overnight hops.
 *
 * **These are never measured, so they are always named.** The packer has no
 * order between days until every bucket has been placed, so a cross-day pair's
 * predecessor changes retroactively as later buckets land, and there is no day
 * whose budget it could honestly be charged to. That argument is about
 * *charging*; it is not a licence to go quiet. On a list whose entire job is
 * naming what went unchecked, dropping `travel-time` because every within-day
 * pair was measured would tell a reader the getting-about was checked when the
 * longest hops on the trip were not looked at at all.
 *
 * So this returns the items a plan cannot speak for, and the entry naming them
 * stands whatever the backend answered.
 */
function interDayTransitions(days: readonly PlanDay[]): string[] {
  const ids: string[] = [];
  let previousDayHadItems = false;
  for (const day of days) {
    const first = day.items[0];
    if (previousDayHadItems && first !== undefined) ids.push(first.candidateId);
    if (day.items.length > 0) previousDayHadItems = true;
  }
  return [...new Set(ids)];
}

/** The candidates in a set of transitions, deduplicated and in order. */
function idsOf(transitions: readonly { candidateId: string }[]): string[] {
  return [...new Set(transitions.map((each) => each.candidateId))];
}

/**
 * What a plan did not check, from the plan itself.
 *
 * `days` is the whole of what this needs to know about the schedule — which
 * candidates made it onto a day, in what order, and what was measured about
 * getting to each. The composer passes the days it has just built; a reader
 * passes a stored revision's through `uncheckedForRevision`. Both get the same
 * list for the same plan, which is the property that makes this survive a
 * reload.
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
  /** The plan's days, in order, with their items in position order. */
  days: readonly PlanDay[];
}): UncheckedConstraint[] {
  const { brief, dates, candidates, days } = input;
  const placedIds = new Set(days.flatMap((day) => day.items.map((item) => item.candidateId)));
  // Every candidate, not the season filter's `kept` set: a pinned candidate
  // outranks that filter (see `compose.ts`), so it can be on a day and out of
  // `kept` at once — and what is on the plan is what this list must speak for.
  const placed = candidates.filter((candidate) => placedIds.has(candidate.id));

  const notes: UncheckedConstraint[] = [];

  // --- Travel time. First, and conditional since pl-27.
  //
  // It was unconditional from pl-9 until then, and the reason was true at the
  // time: `Place.coordinates` was null, so nothing could measure the distance
  // between one item and the next — decided 2026-08-16, roadmap _Still open_.
  // pl-15 gave a leg both its ends and pl-24 gave the tool something that can
  // measure between them, so the sentence is now a claim about **this** plan
  // and not about the phase. It survives in three forms rather than being
  // deleted, because a plan whose transitions nobody could measure must still
  // say so.
  const transitions = transitionsOf(days);
  const unanswered = transitions.filter((each) => each.travel?.kind !== "measured");
  // Two different sentences, and they get two entries rather than one blurred
  // between them: "no routing service knows this road" sends a reader nowhere,
  // and "this plan stopped asking" is fixable by whoever set the ceiling.
  const notEstablished = unanswered.filter((each) => each.travel?.kind !== "over-budget");
  const overBudget = unanswered.filter((each) => each.travel?.kind === "over-budget");

  if (notEstablished.length === transitions.length && overBudget.length === 0) {
    // Nothing was measured and nothing was refused — including the degenerate
    // plan with no two items on any one day, where there was nothing to measure
    // and so nothing has been checked either. The Phase 2 sentence, unchanged.
    notes.push(
      unchecked(
        "travel-time",
        "How long it takes to get from one of these to the next was not checked. Nothing here measured a distance.",
      ),
    );
  } else if (notEstablished.length > 0) {
    // Some of it came back. The plan names the items it could not measure the
    // trip to, rather than disowning the whole day — a backend that answered
    // for four places out of nine has said something true about the five.
    notes.push(
      unchecked(
        "travel-time",
        "How long it takes to get to these from the thing before them was not checked. Nothing could measure a distance to them.",
        idsOf(notEstablished),
      ),
    );
  }

  // The overnight hops, always, because they are never measured.
  //
  // This is the entry that stops the list going quiet. Once every within-day
  // pair is measured the branches above fall silent, and on a list whose entire
  // job is naming what went unchecked, silence is a claim — it would tell a
  // reader the getting-about was checked when the longest moves on the trip
  // were not looked at at all. It is unconditional rather than a fallback for
  // that branch: the hop is unmeasured whatever the backend said about the rest,
  // so a plan that named it only sometimes would be naming it for the wrong
  // reason.
  const overnight = interDayTransitions(days);
  if (overnight.length > 0) {
    notes.push(
      unchecked(
        "travel-time",
        "Getting from the end of one day to the start of the next was not checked. Only the moves within a single day were looked at.",
        overnight,
      ),
    );
  }

  if (overBudget.length > 0) {
    // §9's ceiling, in front of the user rather than in a log line. It is the
    // same constraint that went unchecked, so it is the same `kind` — what
    // differs is why, and why is what `detail` is for.
    notes.push(
      unchecked(
        "travel-time",
        "How long it takes to get to these was never looked up: this plan had used the number of lookups it is allowed.",
        idsOf(overBudget),
      ),
    );
  }

  notes.push(
    unchecked(
      "opening-hours",
      "Whether these places are open on the days they were put on was not checked.",
    ),
  );

  if (isAnswered(brief.dealBreakers) && brief.dealBreakers.value.length > 0) {
    notes.push(
      unchecked(
        "deal-breakers",
        "The things you said would rule a trip out were passed to the people proposing it, but nothing here could check the plan against them.",
      ),
    );
  }

  // These two are the other constraints pl-9 blamed on a missing distance, and
  // they stay unconditional after pl-27 — with their copy rewritten, because
  // "see travel time" now points at an entry that is often not there.
  //
  // The distance that arrived is a **driving** one: `TravelMode` has one member
  // and `GroundingProvider.travel` is asked for `driving`. A backcountry
  // party's `maxDailyDistanceKm` is a distance on foot and a machine's
  // `rangeKm` is a distance along a trail network, and neither is measured by
  // asking a routing engine how you would drive it — the fixture provider makes
  // the point deliberately, holding both ends of the Mont-Albert plateau
  // traverse and no leg between them, because there is no road. Dropping these
  // two because a road distance came back would be claiming to have checked a
  // hiking day against the wrong measurement, which is the exact fabrication
  // this list exists to prevent. They become checkable when the mode enum gains
  // the members pl-24 shaped it for, and not before.
  const details = brief.details;
  if (details?.shape === "backcountry" && isAnswered(details.maxDailyDistanceKm)) {
    notes.push(
      unchecked(
        "daily-distance",
        "How far each day actually goes was not checked. Nothing here measures a distance on foot.",
      ),
    );
  }
  if (details?.shape === "motorised-touring" && isAnswered(details.rangeKm)) {
    notes.push(
      unchecked(
        "machine-range",
        "Whether each day stays inside your range was not checked. Nothing here measures a distance along a trail network.",
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
 *
 * **`revision.coverage` is appended, not derived.** pl-29: a thin corridor is
 * evidence a live backend produced once, at compose time, not a function of
 * the days this revision holds — `uncheckedFor` cannot rebuild it, the way it
 * cannot rebuild a measured leg from nothing but the days it packed. It rides
 * through exactly as `compose` first attached it, which is what makes this
 * function and `compose`'s own returned `unchecked` agree on the plan the run
 * just built as well as on one read back a week later.
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

  return [
    ...uncheckedFor({ brief, dates: brief.dates.value, candidates, days: revision.days }),
    ...revision.coverage,
  ];
}
