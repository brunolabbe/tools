/**
 * The discovery pass: what a corridor query proposes, before the fan-out ever
 * runs.
 *
 * `00-ANALYSIS.md` §5's 2026-08-22 amendment: grounding may be a *source* of
 * candidates and not only a check on them. §2's five failures are all ways a
 * proposed thing is **wrong**; none of them is the good thing never being
 * **proposed**. A model asked for stops between two towns returns the famous
 * ones, because famous is what its training weights over-represent — this pass
 * is what gives a specialist a chance to hear about the one that is not.
 *
 * ```
 * queued ──► grounding (discover) ──► fanning-out ──► grounding (measure) ──► composing
 *            this file                                pl-27's travel.ts
 * ```
 *
 * ## Why it runs before the fan-out, and not after
 *
 * pl-27's pass measures what specialists already proposed — it is a *check*.
 * This one *proposes*: its finds are material `activities`, `food` and
 * `conditions-and-gear` read while they are writing candidates, not something
 * to verify afterwards. So it has to finish before `runFanOut` starts, which
 * is why `RUN_TRANSITIONS` enters `grounding` twice rather than adding a new
 * state — see the note there.
 *
 * ## The corridor does not wait for `route-and-logistics`
 *
 * That would be circular, and it would also mean the specialist that proposes
 * legs never gets to see what is beside them. Origin and destination are in
 * the brief before any specialist runs, so the corridor is drawn from those
 * alone — a straight line between the two, not a road-following route. Corridor
 * *routes* the API can compute now: no `GroundingProvider` method returns a
 * route's geometry, only a matrix of distances (`travel`) and a point
 * (`locate`). Building one would mean a new seam method — a genuinely bigger
 * decision than this ticket's scope, and one with a fixture wall of its own
 * (Valhalla's own `/route`, uncaptured, exactly `firstCoordinates`'s problem
 * one endpoint over). A straight line is honest about what it is and correct
 * for the purpose it serves here: `radiusMetres` already has to be generous
 * enough to admit a real road's curve away from the straight line between its
 * ends, and widening it a little further to admit the whole corridor's gentle
 * bend costs nothing a traveller would notice.
 *
 * ## Two calls always, discovery a third, detour costing a fourth
 *
 * Locate the origin, locate the destination, query the corridor, then — only
 * if there is anything to measure — one matrix call pricing the detour to
 * every survivor at once. That is `MAX_GROUNDING_CALLS` spending at most four
 * calls on this pass, matching pl-27's "one matrix, not n²" argument: a
 * corridor with forty finds still costs one `travel` call, not forty.
 */

import { AppError, isAnswered } from "@planner/contract";
import type { Place, RunProgress, TripBrief, UncheckedConstraint } from "@planner/contract";
import type { Find } from "@planner/agent";
import { DISCOVERY_KINDS } from "@planner/agent";
import { unchecked } from "@planner/itinerary";
import type { GroundingOutcome, RunGrounding, TravelOutcomeMatrix } from "../grounding/cache.ts";
import type { AppLogger } from "../logger.ts";

/**
 * How far off the corridor still counts as "on the way" — pl-29's own title
 * picks six kilometres, so that is the number here. Not configurable: it is
 * content the way `itinerary/src/limits.ts`'s tables are, and it is one
 * constant rather than a per-shape one because nothing about a trip's shape
 * changes what "still basically on the road" means.
 */
export const DISCOVERY_RADIUS_METRES = 6_000;

/** Every kind this pass asks a corridor query for. Discovery does not filter by shape. */
const KINDS = DISCOVERY_KINDS;

export interface DiscoverInput {
  brief: TripBrief;
  /** This run's grounding, sharing its budget with pl-27's measuring pass — see the orchestrator. */
  provider: RunGrounding;
  logger: AppLogger;
  signal: AbortSignal;
  /** One `{ done, total }` frame per step finished — the same shape pl-27's pass reports. */
  onProgress: (progress: RunProgress) => void;
}

export interface DiscoverResult {
  /**
   * What the corridor query found, with a detour cost where one could be
   * measured. Handed to `runFanOut` as `finds`, which threads it to the
   * specialists that read map data.
   */
  finds: Find[];
  /**
   * At most one `coverage` entry — the discovery pass has one thing to say
   * about one corridor. Empty when there was a corridor and it was not thin,
   * or when there was no corridor to discover along at all: a trip with a
   * declined destination has nothing this entry could honestly be about.
   */
  coverage: UncheckedConstraint[];
}

/** Nothing to discover along, and nothing to say about it — the common shape before this ticket. */
const NOTHING: DiscoverResult = { finds: [], coverage: [] };

/** Steps this pass always counts, whether or not each one ends up doing anything — see the header. */
const TOTAL_STEPS = 4;

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof AppError) return error.code === "CANCELED" || error.code === "JOB_CANCELED";
  return error instanceof Error && error.name === "AbortError";
}

function placeFor(name: string): Place {
  return { name, locality: null, coordinates: null };
}

/**
 * Does this brief even have a corridor? Both ends named — a declined
 * destination ("somewhere warm, you pick") has nothing to draw a line to, and
 * an unanswered origin means there is no brief to draft from at all, which
 * `runFanOut` already refuses before this pass would ever run.
 */
function corridorEndpoints(brief: TripBrief): { origin: string; destination: string } | null {
  if (!isAnswered(brief.origin) || !isAnswered(brief.destination)) return null;
  return { origin: brief.origin.value, destination: brief.destination.value };
}

/**
 * Whether this brief has a corridor to discover along at all — the orchestrator's
 * question, asked *before* it decides whether to enter `grounding`. A run that
 * will not call `provider.nearby` must not pass through a state it spends no
 * time in, the same argument `RUN_TRANSITIONS`'s note makes about the fan-out.
 */
export function hasCorridor(brief: TripBrief): boolean {
  return corridorEndpoints(brief) !== null;
}

export async function discoverAlongCorridor(input: DiscoverInput): Promise<DiscoverResult> {
  const { brief, provider, logger, signal } = input;

  const endpoints = corridorEndpoints(brief);
  if (endpoints === null) return NOTHING;

  let done = 0;
  const finished = (): void => {
    done += 1;
    input.onProgress({ type: "grounding", done, total: TOTAL_STEPS });
  };

  const origin = placeFor(endpoints.origin);
  const destination = placeFor(endpoints.destination);

  const originLocated = await locate(provider, origin, signal, logger);
  finished();
  const destinationLocated = await locate(provider, destination, signal, logger);
  finished();

  if (originLocated === null || destinationLocated === null) {
    // No corridor without both ends. Not a refusal and not "nobody knows
    // anything about this trip" — the fan-out proceeds exactly as it would
    // have before this ticket, and the coverage note says why nothing else
    // ran, honestly, without reaching for "the ground is thin" language that
    // implies a query was actually made.
    finished();
    finished();
    return {
      finds: [],
      coverage: [
        unchecked(
          "coverage",
          "Where this trip starts or ends could not be found on the map, so nothing nearby along the way could be checked.",
        ),
      ],
    };
  }

  const corridor = [originLocated, destinationLocated];
  const nearbyOutcome = await nearby(provider, corridor, signal, logger);
  finished();

  if (nearbyOutcome.kind === "refused") {
    finished();
    return {
      finds: [],
      coverage: [
        unchecked(
          "coverage",
          "This route's map data was never checked: the run had already used the number of lookups it is allowed.",
        ),
      ],
    };
  }

  // `nearby` never actually answers `unknown` — a discovery backend that
  // answered at all answered with a list, per `RunGrounding.nearby`'s own doc
  // — but the type is shared with `locate` and `travel`, which do use it, so
  // this file still has to say what it means for a case it should not reach.
  // Treated the same as a genuinely empty list: this pass has one sentence for
  // "nothing came back", and inventing a second because of *why* would be
  // exactly the kind of distinction the coverage entry's own doc comment says
  // it does not carry.
  const finds = nearbyOutcome.kind === "answered" ? nearbyOutcome.value : [];
  if (finds.length === 0) {
    finished();
    return {
      finds: [],
      coverage: [
        unchecked(
          "coverage",
          "There is very little on the map along this route. Something worth stopping for may exist without this plan ever finding it.",
        ),
      ],
    };
  }

  const withDetours = await detourCosts(provider, origin, destination, finds, signal, logger);
  finished();

  return { finds: withDetours, coverage: [] };
}

async function locate(
  provider: RunGrounding,
  place: Place,
  signal: AbortSignal,
  logger: AppLogger,
): Promise<Place | null> {
  try {
    const outcome = await provider.locate({ place, signal });
    if (outcome.kind !== "answered") return null;
    return { ...place, coordinates: outcome.value.coordinates };
  } catch (error: unknown) {
    if (isCancellation(error, signal)) throw error;
    logger.warn("discovery could not locate a corridor endpoint", {
      provider: provider.name,
      code: AppError.from(error).code,
    });
    return null;
  }
}

async function nearby(
  provider: RunGrounding,
  corridor: readonly Place[],
  signal: AbortSignal,
  logger: AppLogger,
): Promise<GroundingOutcome<Find[]>> {
  const points = corridor
    .map((place) => place.coordinates)
    .filter((point): point is NonNullable<typeof point> => point !== null);

  try {
    return await provider.nearby({
      corridor: points,
      radiusMetres: DISCOVERY_RADIUS_METRES,
      kinds: KINDS,
      signal,
    });
  } catch (error: unknown) {
    if (isCancellation(error, signal)) throw error;
    // The backend being down entirely is not a refusal — nobody declined to
    // pay for this — and it is not "the ground is thin" either, which would
    // be a claim about the map rather than about the service. It degrades to
    // the same coverage sentence a genuinely empty answer gets: the honest
    // difference between "asked and got nothing" and "could not ask" is not
    // one this pass's one entry per corridor can carry without a second kind,
    // and both leave a traveller in the identical position — this plan cannot
    // say what is nearby.
    logger.warn("the corridor could not be queried", {
      provider: provider.name,
      code: AppError.from(error).code,
    });
    return { kind: "answered", value: [] };
  }
}

/**
 * One detour cost per find, from one matrix call.
 *
 * `origins = [origin, ...finds]`, `destinations = [destination, ...finds]`:
 * cell `[0][0]` is the corridor's own baseline, cell `[0][i+1]` is
 * origin→find, cell `[i+1][0]` is find→destination. One call prices every
 * find's detour and the baseline it is measured against, the same "one
 * matrix, not n²" argument pl-27's pass already makes.
 */
async function detourCosts(
  provider: RunGrounding,
  origin: Place,
  destination: Place,
  finds: readonly Find[],
  signal: AbortSignal,
  logger: AppLogger,
): Promise<Find[]> {
  const findPlaces = finds.map((find) => placeFor(find.name));
  // A find's own coordinates are always known — `nearby` never returns one
  // without them — so every place sent here can be routed to or from.
  const withCoordinates = findPlaces.map((place, index) => ({
    ...place,
    coordinates: finds[index]?.coordinates ?? null,
  }));

  let matrix: TravelOutcomeMatrix | null = null;
  try {
    const outcome = await provider.travel({
      origins: [origin, ...withCoordinates],
      destinations: [destination, ...withCoordinates],
      mode: "driving",
      signal,
    });
    matrix = outcome;
  } catch (error: unknown) {
    if (isCancellation(error, signal)) throw error;
    logger.warn("a detour cost could not be measured", {
      provider: provider.name,
      code: AppError.from(error).code,
    });
  }

  if (matrix === null) return [...finds];

  const baseline = cellMinutes(matrix, 0, 0);

  return finds.map((find, index) => {
    const toFind = cellMinutes(matrix, 0, index + 1);
    const fromFind = cellMinutes(matrix, index + 1, 0);
    const detourMinutes =
      baseline === null || toFind === null || fromFind === null
        ? null
        : Math.max(0, toFind + fromFind - baseline);
    return { ...find, detourMinutes };
  });
}

function cellMinutes(matrix: TravelOutcomeMatrix, row: number, column: number): number | null {
  const cell = matrix[row]?.[column];
  return cell !== undefined && cell.kind === "answered" ? cell.value.durationMinutes : null;
}
