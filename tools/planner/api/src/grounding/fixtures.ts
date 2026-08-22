/**
 * A grounding provider that answers from a checked-in table instead of from
 * anything outside the process.
 *
 * The counterpart of `ScriptedProvider`, and it sits beside it in the boot
 * switch because that pair is what a fresh clone runs: no key, no account, no
 * bill, and a suite whose assertions are about the code that called grounding
 * rather than about what a map API happened to say this morning.
 *
 * It is not a stub in the sense of "unfinished". It never becomes a routing
 * engine, and it should stay obviously not one — its sources point at a host
 * that cannot resolve, and `/api/health` reports it by name.
 *
 * ## It never interpolates, and that is its whole discipline
 *
 * The tempting version of this file computes a great-circle distance for a pair
 * it does not hold and multiplies by an average speed. That version makes
 * pl-27's tests pass against arithmetic, and — worse — makes a deployment whose
 * real backend is misconfigured indistinguishable from one that is working. So
 * a pair that is not in the table gets `null`, which is a real answer this seam
 * has a word for, and the plan says a leg went unmeasured.
 *
 * The single exception is a place measured from *itself*, which is zero. That
 * is a fact about identity rather than an estimate, and a matrix over one list
 * has a diagonal whether or not anybody wanted one.
 */

import { AppError } from "@planner/contract";
import type { Place } from "@planner/contract";
import type {
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  TravelEstimate,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import {
  FIXTURE_DRIVING,
  FIXTURE_PLACES,
  fixtureSource,
  legKey,
  placeKey,
} from "./fixture-data.ts";

/** The name `/api/health` reports and the config's `GROUNDING_PROVIDER` selects. */
export const FIXTURE_PROVIDER_NAME = "fixtures";

/**
 * Cancellation is checked between lookups rather than inside them.
 *
 * Nothing here awaits anything, so there is no in-flight request to abort — but
 * a caller that passed a signal is entitled to have it honoured, and a pass
 * that keeps filling a matrix after its run was canceled is doing work nobody
 * will read. `CANCELED` and not `JOB_CANCELED`: this is a library, and naming a
 * concept from the layer above it is what that distinction exists to stop.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AppError("CANCELED");
}

export class FixtureGroundingProvider implements GroundingProvider {
  readonly name = FIXTURE_PROVIDER_NAME;

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    throwIfAborted(request.signal);

    const key = placeKey(request.place.name);
    const coordinates = FIXTURE_PLACES.get(key);
    if (coordinates === undefined) return null;

    return {
      // A copy, not the table's own object. `Object.freeze` on the table is
      // shallow, so handing out the entry lets a caller that adjusts
      // coordinates in place — rounding, a unit conversion — rewrite the
      // gazetteer for the rest of the process. `estimate` below already builds
      // a fresh object; this is the same rule, not a different one.
      coordinates: { ...coordinates },
      source: fixtureSource(`places/${key}`),
    };
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    throwIfAborted(request.signal);

    // Keyed once per place rather than once per cell: an 8×8 matrix is 64 cells
    // over 16 names, and `placeKey` normalises a string every time it is called.
    const origins = request.origins.map((place) => placeKey(place.name));
    const destinations = request.destinations.map((place) => placeKey(place.name));

    return origins.map((from) => {
      throwIfAborted(request.signal);
      return destinations.map((to) => estimate(from, to));
    });
  }
}

/**
 * One cell.
 *
 * A place we do not hold is `null` even against itself — "zero from itself" is
 * only honest about somewhere we can say we know of. Answering zero for a name
 * nobody has heard of would be inventing a place and measuring it at the same
 * time.
 */
function estimate(from: string, to: string): TravelEstimate | null {
  if (from === to) {
    if (!FIXTURE_PLACES.has(from)) return null;
    return { distanceMeters: 0, durationMinutes: 0, source: fixtureSource(`legs/${from}`) };
  }

  const leg = FIXTURE_DRIVING.get(legKey(from, to));
  if (leg === undefined) return null;

  return {
    distanceMeters: leg.distanceMeters,
    durationMinutes: leg.durationMinutes,
    source: fixtureSource(`legs/${from}/${to}`),
  };
}

/**
 * A `Place` as this provider would key it, exported so a caller assembling a
 * matrix can deduplicate its list the same way the lookup will.
 *
 * Without it pl-27 has to either send the same place twice under two spellings
 * — paying for a wider matrix than it needs — or reimplement the normalisation
 * and drift from it.
 */
export function fixturePlaceKey(place: Place): string {
  return placeKey(place.name);
}
