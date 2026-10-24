/**
 * The town pass: places to sleep around the towns a trip names, before the
 * fan-out runs — pl-60.
 *
 * pl-29's corridor pass (`discovery.ts`) hands `activities`, `food` and
 * `conditions-and-gear` what a map holds along the way. This one hands
 * `lodging` what a map holds where the party might stop, so that the one
 * proposal a traveller books can be a real premises and not a name from
 * memory. pl-58 measured why it was needed: asked to name a premises, `lodging`
 * named one in 33 of 418 mentions, and two of the ones it named were not found.
 *
 * ## Where the towns come from
 *
 * `lodging` runs in the same fan-out as `route-and-logistics`, so the night
 * stops are not known yet. What the brief knows before any specialist runs is
 * its destination and, for two shapes, the stops it names: a road trip's
 * `mustSee` and a multi-city trip's `cities`. Those are the towns, stops first
 * and then the destination, at most `MAX_LODGING_TOWNS`. The origin is left
 * out: it is where the party lives or sets off from, not where they sleep.
 * pl-60's Log measured what this misses: for pl-58's set A road trip, 14 of
 * `lodging`'s 23 mentions were in towns no brief field names (Gaspé 8 of them),
 * and those keep the kind-of-place fallback.
 *
 * ## Calls
 *
 * Per town, one `locate` and one `nearbyPoint`. A `locate` the corridor pass
 * already made for the same name is a cache hit and costs nothing, which is the
 * destination's case on any brief with a corridor. A town that does not locate
 * costs its `locate` and no query. So the pass spends at most
 * `2 × MAX_LODGING_TOWNS` = 8 calls of `MAX_GROUNDING_CALLS`, and the shapes
 * pl-60's Log counts are asserted by `api/test/lodging-run.test.ts`.
 *
 * ## The coverage it writes
 *
 * The owner chose, on 2026-10-21, that `lodging` may fall back to a kind of
 * place where its town's list is empty, and that the remedy for a thin town is
 * the coverage note. So every town that came back with nothing, could not be
 * found or was never asked about is named in one, and a trip that names no
 * town at all says so. `UncheckedConstraint.detail` is free text, so naming a
 * town needs no contract change.
 */

import { AppError, isAnswered } from "@planner/contract";
import type { Coordinates, Place, TripBrief, UncheckedConstraint } from "@planner/contract";
import type { Find, TripContext } from "@planner/agent";
import { LODGING_KINDS } from "@planner/agent";
import { unchecked } from "@planner/itinerary";
import type { RunGrounding } from "../grounding/cache.ts";
import { haversineMetres } from "../grounding/geometry.ts";
import type { AppLogger } from "../logger.ts";

/**
 * How far from a town's point still counts as that town — 10 km, the owner's
 * answer of 2026-10-24. pl-60's Build 1 capture gives it: 141 lodging finds
 * around its nine localities, Gaspé 24 and Percé 40, and Forillon's three
 * campgrounds reached from the park's own point but not from Gaspé's. Content,
 * like `DISCOVERY_RADIUS_METRES`, and not configuration.
 */
export const LODGING_RADIUS_METRES = 10_000;

/**
 * How many towns one run asks about. Four: a multi-city trip's three cities and
 * its destination fit, and four towns at two calls each is 8 of the run's 40.
 */
export const MAX_LODGING_TOWNS = 4;

/**
 * How many finds one town hands `lodging`, the closest first.
 *
 * Ten, so four towns cost at most the forty a corridor's `MAX_DISCOVERY_FINDS`
 * already lets into one prompt. Percé had 40 within 10 km; a party choosing a
 * night there is choosing among the ten nearest the point it named, and the
 * rest are a cost in tokens with nothing to say that the ten do not.
 */
export const MAX_LODGING_FINDS_PER_TOWN = 10;

/** How much of a town's name a coverage sentence repeats — the brief allows 500 characters. */
const MAX_TOWN_CHARS = 60;

/** Steps this pass reports per town: its `locate`, then its query. */
export const LODGING_STEPS_PER_TOWN = 2;

/** The brief's stops and then its destination, deduplicated, at most `MAX_LODGING_TOWNS`. */
export function lodgingTowns(brief: TripBrief): string[] {
  const named: string[] = [];
  const details = brief.details;
  if (details?.shape === "road-trip" && isAnswered(details.mustSee))
    named.push(...details.mustSee.value);
  if (details?.shape === "multi-city" && isAnswered(details.cities))
    named.push(...details.cities.value);
  if (isAnswered(brief.destination)) named.push(brief.destination.value);

  const seen = new Set<string>();
  const towns: string[] = [];
  for (const raw of named) {
    const town = raw.trim();
    const key = town.toLocaleLowerCase();
    if (town === "" || seen.has(key)) continue;
    seen.add(key);
    towns.push(town);
  }
  return towns.slice(0, MAX_LODGING_TOWNS);
}

export interface LodgingInput {
  brief: TripBrief;
  /** The run's grounding, the same budget the corridor pass and measuring spend. */
  provider: RunGrounding;
  trip: TripContext | undefined;
  logger: AppLogger;
  signal: AbortSignal;
  /** Called once per step finished, `LODGING_STEPS_PER_TOWN` per town whatever happened. */
  onStep: () => void;
}

export interface LodgingResult {
  finds: Find[];
  coverage: UncheckedConstraint[];
}

type TownOutcome = "found" | "empty" | "unlocated" | "refused";

export async function discoverLodging(input: LodgingInput): Promise<LodgingResult> {
  const towns = lodgingTowns(input.brief);
  if (towns.length === 0) {
    return {
      finds: [],
      coverage: [
        unchecked(
          "coverage",
          "This trip names no town to stay in, so the map was not checked for places to stay.",
        ),
      ],
    };
  }

  const finds: Find[] = [];
  const seen = new Set<string>();
  const outcomes = new Map<TownOutcome, string[]>();
  const note = (outcome: TownOutcome, town: string): void => {
    outcomes.set(outcome, [...(outcomes.get(outcome) ?? []), town]);
  };

  for (const town of towns) {
    const located = await locateTown(input, town);
    input.onStep();
    if (located === "refused" || located === null) {
      input.onStep();
      note(located === null ? "unlocated" : "refused", town);
      continue;
    }

    const answer = await queryTown(input, located);
    input.onStep();
    if (answer === "refused") {
      note("refused", town);
      continue;
    }

    const kept = answer
      .filter((find) => !seen.has(identity(find)))
      .toSorted((a, b) => compareByDistance(a, b, located))
      .slice(0, MAX_LODGING_FINDS_PER_TOWN);
    for (const find of kept) seen.add(identity(find));
    finds.push(...kept);
    note(kept.length === 0 ? "empty" : "found", town);
  }

  return { finds, coverage: coverageFor(outcomes) };
}

async function locateTown(
  input: LodgingInput,
  town: string,
): Promise<Coordinates | null | "refused"> {
  const place: Place = { name: town, locality: null, coordinates: null };
  try {
    const outcome = await input.provider.locate({ place, trip: input.trip, signal: input.signal });
    if (outcome.kind === "refused") return "refused";
    return outcome.kind === "answered" ? outcome.value.coordinates : null;
  } catch (error: unknown) {
    if (isCancellation(error, input.signal)) throw error;
    input.logger.warn("the town pass could not locate a town", {
      provider: input.provider.name,
      code: AppError.from(error).code,
    });
    return null;
  }
}

/**
 * One town's query. A backend that fails is the corridor pass's case and gets
 * its answer: no finds, logged, and the town is named as having none — this
 * plan cannot say what is there either way.
 */
async function queryTown(input: LodgingInput, point: Coordinates): Promise<Find[] | "refused"> {
  try {
    const outcome = await input.provider.nearbyPoint({
      point,
      radiusMetres: LODGING_RADIUS_METRES,
      kinds: LODGING_KINDS,
      signal: input.signal,
    });
    if (outcome.kind === "refused") return "refused";
    return outcome.kind === "answered" ? outcome.value : [];
  } catch (error: unknown) {
    if (isCancellation(error, input.signal)) throw error;
    input.logger.warn("the town pass could not query a town", {
      provider: input.provider.name,
      code: AppError.from(error).code,
    });
    return [];
  }
}

/** A find's identity across towns: its source url, which names the OSM element. */
function identity(find: Find): string {
  return (
    find.sources[0]?.url ??
    `${find.name}\u0000${String(find.coordinates.latitude)},${String(find.coordinates.longitude)}`
  );
}

/** Closest to the town's point first, then by name, so the cap keeps the same ten every time. */
function compareByDistance(a: Find, b: Find, point: Coordinates): number {
  const distance = haversineMetres(a.coordinates, point) - haversineMetres(b.coordinates, point);
  return distance !== 0 ? distance : a.name.localeCompare(b.name);
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof AppError) return error.code === "CANCELED" || error.code === "JOB_CANCELED";
  return error instanceof Error && error.name === "AbortError";
}

/** One sentence per outcome that leaves a town unchecked, naming the towns. */
function coverageFor(outcomes: ReadonlyMap<TownOutcome, string[]>): UncheckedConstraint[] {
  const coverage: UncheckedConstraint[] = [];
  const unlocated = outcomes.get("unlocated");
  if (unlocated !== undefined) {
    coverage.push(
      unchecked(
        "coverage",
        `Where ${townList(unlocated)} ${unlocated.length === 1 ? "is" : "are"} could not be found on the map, so places to stay there were not checked.`,
      ),
    );
  }
  const empty = outcomes.get("empty");
  if (empty !== undefined) {
    coverage.push(
      unchecked(
        "coverage",
        `No places to stay around ${townList(empty)} are on the map. Somewhere to stay there may exist without this plan having found it.`,
      ),
    );
  }
  const refused = outcomes.get("refused");
  if (refused !== undefined) {
    coverage.push(
      unchecked(
        "coverage",
        `Places to stay around ${townList(refused)} were never looked up: the run had already used the number of lookups it is allowed.`,
      ),
    );
  }
  return coverage;
}

/** "A", "A and B", "A, B and C" — each name cut to `MAX_TOWN_CHARS`. */
function townList(towns: readonly string[]): string {
  const names = towns.map((town) =>
    town.length > MAX_TOWN_CHARS ? `${town.slice(0, MAX_TOWN_CHARS - 1)}…` : town,
  );
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
