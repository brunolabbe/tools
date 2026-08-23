/**
 * A movement somebody measured, and the record of it on the plan.
 *
 * `00-ANALYSIS.md` §5 ranks **distances and travel times** first of the four
 * things grounding buys, because §2's failure 1 — three towns in a day that are
 * six hours apart — is the most common way an AI itinerary is wrong. This is
 * the shape that fact takes once something outside the model has answered it.
 *
 * ## Why it is *stored* and `UncheckedConstraint` is not
 *
 * pl-10 refused to store the unchecked list and derived it from the revision
 * instead, and this goes the other way on purpose. The two are different in the
 * way that matters:
 *
 * - `unchecked` is a **derivation** from things the revision already holds, so
 *   deriving it a second time cannot disagree with the days it is printed
 *   beside.
 * - A measured distance is **evidence**. It came from outside, at a moment,
 *   from a source, and there is nothing on the revision to re-derive it from.
 *   Its cache row will expire (pl-25); the plan must still be able to say what
 *   it was packed against and when that was read. A plan that silently
 *   re-measures on read is a plan whose days no longer follow from its numbers.
 *
 * So it sits on the `PlanItem`, beside the placement it justifies, and it is
 * written once with the revision and never again.
 *
 * ## It carries a `Provenance` and not a bare `Source`
 *
 * `Provenance` is the vocabulary the plan view already renders (pl-10), and a
 * measurement is exactly the kind of fact that vocabulary exists for: a
 * `grounded` reading with the backend that produced it behind it, never a
 * number with nothing behind it. `provenanceSchema` refuses a grounded fact
 * with no source, which is the check that keeps this honest.
 */

import { z } from "zod";
import { provenanceSchema } from "./candidate.ts";
import type { Provenance } from "./candidate.ts";

/**
 * Half the equator. Nothing on one itinerary is further apart than that, and a
 * ceiling is what keeps a backend's bad row out of the document — grounding
 * output is somebody else's text, like a model reply.
 */
export const MAX_TRAVEL_DISTANCE_METERS = 20_037_500;

/** A fortnight. Past this the number is not a transition between two items. */
export const MAX_TRAVEL_DURATION_MINUTES = 20_160;

/**
 * One movement, measured.
 *
 * Both numbers or neither — the seam's `TravelEstimate` has the same rule and
 * for the same reason: half a fact about a leg is a fact a reader has to guess
 * the other half of. Zero is legal and means the two ends are the same place.
 */
export interface MeasuredTravel {
  distanceMeters: number;
  /** Named to match `Candidate.durationMinutes`; the tool has one unit for time. */
  durationMinutes: number;
  /** Where the measurement came from. `grounded`, with the backend behind it. */
  provenance: Provenance;
}

export const measuredTravelSchema = z.object({
  distanceMeters: z.number().min(0).max(MAX_TRAVEL_DISTANCE_METERS),
  durationMinutes: z.number().min(0).max(MAX_TRAVEL_DURATION_MINUTES),
  provenance: provenanceSchema,
}) satisfies z.ZodType<MeasuredTravel>;

// ---------------------------------------------------------------------------
// What the plan knows about one transition
// ---------------------------------------------------------------------------

/**
 * What the plan knows about getting from one item to the next.
 *
 * Three states and not two, and the third is the one worth the union.
 *
 * - **`measured`** — somebody answered, and the answer is here with its source.
 * - **`not-established`** — we asked and nobody could say. `Candidate`'s rule
 *   about `durationMinutes` and `season`, one layer out: not knowing is a real
 *   answer and it is not a failure.
 * - **`over-budget`** — we never asked, because the run had spent the lookups
 *   `MAX_GROUNDING_CALLS` allows it. §9's ceiling is a bill control, and what it
 *   costs must be in front of the user rather than in a log line.
 *
 * **The last two are different sentences and must not collapse into one.** "No
 * routing service knows this road" and "this plan stopped asking" send a reader
 * to two different places — the second is fixable by configuration and the first
 * is not — and telling them the first when the second is true is a claim to have
 * checked something nobody looked at. That is the repo's _never fake progress_
 * rule at the level of a single fact.
 */
export type ItemTravel =
  | ({ kind: "measured" } & MeasuredTravel)
  | { kind: "not-established" }
  | { kind: "over-budget" };

export const itemTravelSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("measured"),
    distanceMeters: z.number().min(0).max(MAX_TRAVEL_DISTANCE_METERS),
    durationMinutes: z.number().min(0).max(MAX_TRAVEL_DURATION_MINUTES),
    provenance: provenanceSchema,
  }),
  z.object({ kind: z.literal("not-established") }),
  z.object({ kind: z.literal("over-budget") }),
]) satisfies z.ZodType<ItemTravel>;

/** Nobody answered, and nobody was prevented from trying. The ordinary miss. */
export const NOT_ESTABLISHED: ItemTravel = { kind: "not-established" };

/** Never asked, for want of budget. Not the same fact as `NOT_ESTABLISHED`. */
export const OVER_BUDGET: ItemTravel = { kind: "over-budget" };

/**
 * The measurement, or `null` where there is none.
 *
 * For a reader that only wants the numbers and treats both empties alike — a
 * test asserting a distance, a view rendering one. Anything that has to *say*
 * which empty it is reads `kind` directly, which is most of the callers in
 * `src`: that is the whole reason the union exists, and this helper is
 * deliberately not the way to reach it.
 */
export function measuredOrNull(travel: ItemTravel | null): MeasuredTravel | null {
  if (travel === null || travel.kind !== "measured") return null;
  return {
    distanceMeters: travel.distanceMeters,
    durationMinutes: travel.durationMinutes,
    provenance: travel.provenance,
  };
}
