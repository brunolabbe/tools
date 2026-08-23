/**
 * The table the packer packs under.
 *
 * ## Why the packer is handed a table instead of measuring anything
 *
 * This package has **no model, no network, no clock**, and
 * `test/purity.test.ts` scans for it rather than trusting the sentence. So the
 * package that packs days cannot be the package that fetches distances: the
 * pass that calls `GroundingProvider` lives in `api`, between the fan-out and
 * the composer, and what reaches here is what it came back with.
 *
 * It is a **required** argument to `compose` and to `pack`, the way
 * `TripCapacity` is a required argument to `runFanOut`, and for the same
 * reason: a caller that forgets it should be a compile error rather than a plan
 * quietly packed under nothing. `NOTHING_MEASURED` is the explicit way to say
 * there was no grounding — which is a real and, until pl-27, universal state,
 * and one worth having to name.
 *
 * ## Why the seam's matrix does not appear here
 *
 * `GroundingProvider.travel` answers a matrix over *places*, because measuring
 * every pair up front is what dissolves the packer's circularity — travel time
 * between consecutive items is only knowable once you know the order, and the
 * order is what the packer is deciding. But the packer's question is about
 * *candidates*, not places, and a candidate is `at` a place or runs `between`
 * two, so turning one into the other means knowing which end of a leg you
 * arrive at and which you leave from. That translation belongs beside the
 * matrix, in `api`, and this interface is what it produces.
 */

import { NOT_ESTABLISHED, type Candidate, type ItemTravel } from "@planner/contract";

/**
 * How long it takes to get from one candidate to the next.
 *
 * It answers an `ItemTravel` and never a bare `null`, which is the shape's
 * whole point: "nobody could say" and "this run stopped asking" are different
 * sentences to a reader, and a table that returned `null` for both would leave
 * the plan unable to tell them apart. A day packed under nothing but
 * `not-established` is packed exactly as it was before grounding existed, which
 * is the property that makes this change additive.
 */
export interface TravelTable {
  /**
   * From the end of `from` to the start of `to`.
   *
   * Direction matters even when a backend's numbers are symmetric: a one-way
   * system, a ferry with a timetable in one direction and a seasonal closure
   * are all reasons A→B and B→A differ, and a table that could not express it
   * would be one every real backend has to lie to.
   */
  between(from: Candidate, to: Candidate): ItemTravel;
}

/**
 * The table for a run that measured nothing: no grounding backend configured,
 * or one that had no answer for anything.
 *
 * `not-established` and not `over-budget`, because nothing here was refused —
 * there was simply no answer. Named rather than left as an object literal at
 * each call site, because "we did not measure" is a statement a reader of a
 * test should see made.
 */
export const NOTHING_MEASURED: TravelTable = {
  between: () => NOT_ESTABLISHED,
};

/**
 * Minutes to charge a day for a transition.
 *
 * Only a measured one costs anything. A transition nobody could measure and one
 * nobody could afford to ask about are equally uncharged — the day cannot be
 * budgeted for a number that does not exist — and they differ only in what the
 * plan *says*, which is `unchecked.ts`'s business rather than the packer's.
 */
export function transitionMinutes(travel: ItemTravel | null): number {
  return travel?.kind === "measured" ? travel.durationMinutes : 0;
}
