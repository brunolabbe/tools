/**
 * The town pass: places to sleep around the towns a trip names, before the
 * fan-out runs — pl-60 — and, since pl-62, places to eat around the same towns.
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
 * ## Places to eat (pl-62)
 *
 * `food` reads the same towns' places to eat, from **a second `nearbyPoint` per
 * located town**, asked for `FOOD_KINDS` alone — the owner's answer to pl-62's
 * Decision 3. A query of its own, rather than food clauses in the lodging one,
 * so `lodging`'s query text and reply do not change and a food query that fails
 * does not take the places to sleep with it. The radius and the cap are
 * `lodging`'s numbers (Decision 6, chosen from pl-62's Build 1 counts), and are
 * named apart so either can move alone.
 *
 * ## Calls
 *
 * Per town, one `locate` and two `nearbyPoint`s, the lodging query and then the
 * food query. A `locate` the corridor pass already made for the same name is a
 * cache hit and costs nothing, which is the destination's case on any brief
 * with a corridor. A town that does not locate costs its `locate` and no query.
 * So the pass spends at most `3 × MAX_LODGING_TOWNS` = 12 calls of
 * `MAX_GROUNDING_CALLS`, and the shapes pl-60's and pl-62's Logs count are
 * asserted by `api/test/lodging-run.test.ts`.
 *
 * ## The coverage it writes
 *
 * The owner chose, on 2026-10-21, that `lodging` may fall back to a kind of
 * place where its town's list is empty, and that the remedy for a thin town is
 * the coverage note. So every town that came back with nothing, could not be
 * found, was refused by the budget or fell past `MAX_LODGING_TOWNS` is named in
 * one, and a trip that names no town at all says so. "Came back with nothing"
 * is what the map answered, not what was left once an earlier town had claimed
 * the same premises. `UncheckedConstraint.detail` is free text, so naming a
 * town needs no contract change.
 *
 * pl-60's `lodging-run.test.ts` asserts the calls beneath the cache, and
 * `lodging-pass.test.ts` and `grounding-cache.test.ts` the budget they claim.
 */

import { AppError, isAnswered } from "@planner/contract";
import type { Coordinates, Place, TripBrief, UncheckedConstraint } from "@planner/contract";
import type { Find, TripContext } from "@planner/agent";
import { FOOD_KINDS, LODGING_KINDS } from "@planner/agent";
import type { DiscoveryKind } from "@planner/agent";
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

/**
 * How far from a town's point a place to eat still counts as that town — 10 km,
 * the owner's answer to pl-62's Decision 6 (2026-10-24), the same as
 * `LODGING_RADIUS_METRES`. pl-62's Build 1 capture gives it: 117 food finds
 * around the nine localities at 10 km against 108 at 6 km, so the radius moves
 * few finds and the cap moves many.
 */
export const FOOD_RADIUS_METRES = 10_000;

/**
 * How many places to eat one town hands `food`, the closest first — ten, the
 * same answer. At 10 km it shows 65 of Build 1's 117 finds: the cap binds in
 * Gaspé, Matane, Percé and Rivière-du-Loup, and there the ten are the town's
 * centre (the tenth within 237 m of Gaspé's point and 276 m of Percé's), which
 * is where a party that stays in a town eats. Ten also keeps `food`'s block no
 * longer than `lodging`'s for the same towns.
 */
export const MAX_FOOD_FINDS_PER_TOWN = 10;

/** How much of a town's name a coverage sentence repeats — the brief allows 500 characters. */
const MAX_TOWN_CHARS = 60;

/** Steps this pass reports per town: its `locate`, its lodging query, then its food query. */
export const TOWN_STEPS_PER_TOWN = 3;

/** The brief's stops and then its destination, deduplicated, at most `MAX_LODGING_TOWNS`. */
export function lodgingTowns(brief: TripBrief): string[] {
  return namedTowns(brief).slice(0, MAX_LODGING_TOWNS);
}

/**
 * Every town the brief names, in `lodgingTowns`'s order and deduplicated the
 * same way, before the cap — so the ones past it can be named rather than
 * dropped in silence (gate 1, 2026-10-24; the owner chose the sentence).
 */
function namedTowns(brief: TripBrief): string[] {
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
  return towns;
}

export interface LodgingInput {
  brief: TripBrief;
  /** The run's grounding, the same budget the corridor pass and measuring spend. */
  provider: RunGrounding;
  trip: TripContext | undefined;
  logger: AppLogger;
  signal: AbortSignal;
  /** Called once per step finished, `TOWN_STEPS_PER_TOWN` per town whatever happened. */
  onStep: () => void;
}

export interface LodgingResult {
  finds: Find[];
  coverage: UncheckedConstraint[];
}

/** What happened to a town before either query: shared by both categories. */
type TownOutcome = "unlocated" | "uncapped";
/** What one query answered for one town, per category. */
type QueryOutcome = "found" | "empty" | "refused";

export async function discoverLodging(input: LodgingInput): Promise<LodgingResult> {
  const named = namedTowns(input.brief);
  const towns = named.slice(0, MAX_LODGING_TOWNS);
  if (towns.length === 0) {
    return {
      finds: [],
      coverage: [
        unchecked(
          "coverage",
          "This trip names no town to stay in, so the map was not checked for places to stay or to eat.",
        ),
      ],
    };
  }

  const sleep = newCategory();
  const eat = newCategory();
  const outcomes = new Map<TownOutcome, string[]>();
  const note = (outcome: TownOutcome, town: string): void => {
    outcomes.set(outcome, [...(outcomes.get(outcome) ?? []), town]);
  };

  for (const town of towns) {
    const located = await locateTown(input, town);
    input.onStep();
    if (located === "refused" || located === null) {
      input.onStep();
      input.onStep();
      if (located === null) {
        note("unlocated", town);
      } else {
        sleep.note("refused", town);
        eat.note("refused", town);
      }
      continue;
    }

    const lodging = await queryTown(input, located, LODGING_RADIUS_METRES, LODGING_KINDS);
    input.onStep();
    keep(sleep, lodging, town, located, MAX_LODGING_FINDS_PER_TOWN);

    const food = await queryTown(input, located, FOOD_RADIUS_METRES, FOOD_KINDS);
    input.onStep();
    keep(eat, food, town, located, MAX_FOOD_FINDS_PER_TOWN);
  }

  for (const town of named.slice(MAX_LODGING_TOWNS)) note("uncapped", town);

  return {
    // Places to sleep first, then places to eat: each reader's filter keeps
    // the order it is given, so `lodging`'s list is the one it had before pl-62.
    finds: [...sleep.finds, ...eat.finds],
    coverage: coverageFor(outcomes, sleep.outcomes, eat.outcomes),
  };
}

/** One category's finds and outcomes across the towns, de-duplicated by element. */
interface Category {
  finds: Find[];
  seen: Set<string>;
  outcomes: Map<QueryOutcome, string[]>;
  note: (outcome: QueryOutcome, town: string) => void;
}

function newCategory(): Category {
  const outcomes = new Map<QueryOutcome, string[]>();
  return {
    finds: [],
    seen: new Set<string>(),
    outcomes,
    note: (outcome, town) => {
      outcomes.set(outcome, [...(outcomes.get(outcome) ?? []), town]);
    },
  };
}

/** One town's answer to one query, capped closest first and added to its category. */
function keep(
  category: Category,
  answer: Find[] | "refused",
  town: string,
  point: Coordinates,
  cap: number,
): void {
  if (answer === "refused") {
    category.note("refused", town);
    return;
  }
  const kept = answer
    .filter((find) => !category.seen.has(identity(find)))
    .toSorted((a, b) => compareByDistance(a, b, point))
    .slice(0, cap);
  for (const find of kept) category.seen.add(identity(find));
  category.finds.push(...kept);
  // What the map answered decides the sentence, not what was left after an
  // earlier town claimed the same premises: a town whose finds were all
  // handed over already has them, and the reader sees them (pl-60's gate 1).
  category.note(answer.length === 0 ? "empty" : "found", town);
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
    const status = AppError.from(error).details?.status;
    input.logger.warn("the town pass could not locate a town", {
      provider: input.provider.name,
      code: AppError.from(error).code,
      ...(typeof status === "number" ? { status } : {}),
    });
    return null;
  }
}

/**
 * One town's query. A backend that fails is the corridor pass's case and gets
 * its answer: no finds, logged, and the town is named as having none — this
 * plan cannot say what is there either way.
 */
async function queryTown(
  input: LodgingInput,
  point: Coordinates,
  radiusMetres: number,
  kinds: readonly DiscoveryKind[],
): Promise<Find[] | "refused"> {
  try {
    const outcome = await input.provider.nearbyPoint({
      point,
      radiusMetres,
      kinds,
      signal: input.signal,
    });
    if (outcome.kind === "refused") return "refused";
    return outcome.kind === "answered" ? outcome.value : [];
  } catch (error: unknown) {
    if (isCancellation(error, input.signal)) throw error;
    const status = AppError.from(error).details?.status;
    input.logger.warn("the town pass could not query a town", {
      provider: input.provider.name,
      code: AppError.from(error).code,
      ...(typeof status === "number" ? { status } : {}),
    });
    return [];
  }
}

/** A find's identity across towns: its source url, which names the OSM element. */
function identity(find: Find): string {
  // Only a url that names an element identifies one. `findFrom` gives an
  // element with no usable type or id the copyright page, which every such
  // find shares, so those fall back to name and position (gate 1).
  const url = find.sources[0]?.url;
  if (url !== undefined && ELEMENT_URL.test(url)) return url;
  return `${find.name}\u0000${String(find.coordinates.latitude)},${String(find.coordinates.longitude)}`;
}

/** An OSM element's own page — the shape `findFrom` builds from a type and an id. */
const ELEMENT_URL = /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/-?\d/;

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

/**
 * One sentence per outcome that leaves a town unchecked, naming the towns:
 * `lodging`'s first, as pl-60 wrote them, then `food`'s (pl-62). A town that
 * could not be found, or fell past the cap, was checked for neither, and its
 * one sentence says both.
 */
function coverageFor(
  towns: ReadonlyMap<TownOutcome, string[]>,
  sleep: ReadonlyMap<QueryOutcome, string[]>,
  eat: ReadonlyMap<QueryOutcome, string[]>,
): UncheckedConstraint[] {
  const coverage: UncheckedConstraint[] = [];
  const say = (detail: string): void => {
    coverage.push(unchecked("coverage", detail));
  };

  const unlocated = towns.get("unlocated");
  if (unlocated !== undefined) {
    say(
      `Where ${townList(unlocated)} ${unlocated.length === 1 ? "is" : "are"} could not be found on the map, so places to stay and places to eat there were not checked.`,
    );
  }
  const empty = sleep.get("empty");
  if (empty !== undefined) {
    say(
      `No places to stay around ${townList(empty)} are on the map. Somewhere to stay there may exist without this plan having found it.`,
    );
  }
  const refused = sleep.get("refused");
  if (refused !== undefined) {
    say(
      `Places to stay around ${townList(refused)} were never looked up: the run had already used the number of lookups it is allowed.`,
    );
  }
  const uncapped = towns.get("uncapped");
  if (uncapped !== undefined) {
    // A brief may name twenty stops, so this list is the one that can outgrow
    // `MAX_UNCHECKED_DETAIL_CHARS`: it names the first few and counts the rest.
    const named = uncapped.slice(0, MAX_TOWNS_NAMED);
    const more = uncapped.length - named.length;
    const list =
      more === 0 ? townList(named) : `${named.map(cut).join(", ")} and ${String(more)} more`;
    say(
      `Places to stay and places to eat around ${list} were not looked up: this plan asks about at most ${String(MAX_LODGING_TOWNS)} towns, the stops it names first.`,
    );
  }
  const hungry = eat.get("empty");
  if (hungry !== undefined) {
    say(
      `No places to eat around ${townList(hungry)} are on the map. Somewhere to eat there may exist without this plan having found it.`,
    );
  }
  const unfed = eat.get("refused");
  if (unfed !== undefined) {
    say(
      `Places to eat around ${townList(unfed)} were never looked up: the run had already used the number of lookups it is allowed.`,
    );
  }
  return coverage;
}

/** How many towns past the cap one sentence names before it counts the rest. */
const MAX_TOWNS_NAMED = 4;

/** A town's name as a sentence repeats it, cut to `MAX_TOWN_CHARS`. */
function cut(town: string): string {
  return town.length > MAX_TOWN_CHARS ? `${town.slice(0, MAX_TOWN_CHARS - 1)}…` : town;
}

/** "A", "A and B", "A, B and C" — each name cut to `MAX_TOWN_CHARS`. */
function townList(towns: readonly string[]): string {
  const names = towns.map(cut);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
