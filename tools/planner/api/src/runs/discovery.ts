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
 * (Valhalla's own `/route`, uncaptured, exactly the problem `geocoderResults`
 * had one endpoint over — `firstCoordinates` when this was written, renamed by
 * pl-34). A straight line is honest about what it is and correct
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

import { AppError, isAnswered, MAX_REVISION_READING } from "@planner/contract";
import type {
  Coordinates,
  Place,
  RunProgress,
  Source,
  TripBrief,
  UncheckedConstraint,
} from "@planner/contract";
import type { Corridor, Find, NearbyArticle, TripContext } from "@planner/agent";
import { DISCOVERY_KINDS } from "@planner/agent";
import { unchecked } from "@planner/itinerary";
import type { GroundingOutcome, RunGrounding, TravelOutcomeMatrix } from "../grounding/cache.ts";
import { haversineMetres } from "../grounding/geometry.ts";
import type { AppLogger } from "../logger.ts";

/**
 * How far off the corridor still counts as "on the way" — pl-29's own title
 * picks six kilometres, so that is the number here. Not configurable: it is
 * content the way `itinerary/src/limits.ts`'s tables are, and it is one
 * constant rather than a per-shape one because nothing about a trip's shape
 * changes what "still basically on the road" means.
 */
export const DISCOVERY_RADIUS_METRES = 6_000;

/**
 * Wikipedia's geosearch ceiling, and the tile size that follows from it.
 *
 * 10 km is the largest radius the API accepts; asking for more is an error
 * rather than more coverage.
 */
const NOTABILITY_TILE_METRES = 10_000;

/**
 * How many geosearch calls one corridor may cost.
 *
 * Six, against a `MAX_GROUNDING_CALLS` of 40 — enough to spread over a long
 * corridor without letting one pass eat the run's allowance, since `locate`
 * and `travel` still have to be paid for out of the same 40. A corridor longer
 * than six tiles is covered in patches rather than end to end, and
 * `notability: []` on an unreached find already means "nothing checked".
 */
const MAX_NOTABILITY_TILES = 6;

/**
 * How close an article has to be to a find to be *about* it.
 *
 * 250 m: near enough that a monument and its article are the same thing, far
 * enough to survive the disagreement between where OSM puts a node and where
 * Wikipedia puts a coordinate. Wrong in both directions occasionally, which is
 * why this attaches a `Source` and never a score — §5's amendment again.
 */
const NOTABILITY_MATCH_METRES = 250;

/**
 * How wide to look for a Wikivoyage entry about a corridor end.
 *
 * 10 km, the API's ceiling: these are city and region articles whose
 * coordinate is a downtown pin, and a corridor end geocoded to a suburb should
 * still find the city it is in.
 */
const READING_RADIUS_METRES = 10_000;

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
  /**
   * Editorial context about the route itself — Wikivoyage entries for the
   * corridor's own ends (pl-33). Carried onto `PlanRevision.reading` rather
   * than onto any find: measured at 2 English and 7 French articles for an
   * entire city, all of them about the city, so attaching one to a viewpoint
   * would claim a relationship the source does not have.
   */
  reading: Source[];
}

/** Nothing to discover along, and nothing to say about it — the common shape before this ticket. */
const NOTHING: DiscoverResult = { finds: [], coverage: [], reading: [] };

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
 * The trip context a `locate` call gets, out of the brief — pl-37.
 *
 * `undefined` when the destination was declined, which is a real answer and not
 * a hole: `contract/src/brief.ts` leaves `destination` unrequired on purpose,
 * and "somewhere warm, you pick" is a trip with nothing here to say.
 *
 * **It lives in this file because this is where the brief is already read.**
 * `hasCorridor` and `corridorEndpoints` are here for the same reason, and the
 * orchestrator already imports from here — a fourth module holding one
 * four-line brief reader would be a module named for a type rather than for a
 * job.
 */
export function tripContextFor(brief: TripBrief): TripContext | undefined {
  return isAnswered(brief.destination) ? { destination: brief.destination.value } : undefined;
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

  // Non-null by construction: `corridorEndpoints` returned, so the destination
  // is answered. Read through the same helper the orchestrator uses rather than
  // rebuilt here, so one function decides what trip context is.
  const trip = tripContextFor(brief);

  const originLocated = await locate(provider, origin, trip, signal, logger);
  finished();
  const destinationLocated = await locate(provider, destination, trip, signal, logger);
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
      reading: [],
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
      reading: [],
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
      reading: [],
      coverage: [
        unchecked(
          "coverage",
          "There is very little on the map along this route. Something worth stopping for may exist without this plan ever finding it.",
        ),
      ],
    };
  }

  const backed = await notability(provider, corridor, finds, signal, logger);
  const reading = await corridorReading(provider, corridor, backed, signal, logger);
  const withDetours = await detourCosts(provider, origin, destination, backed, signal, logger);
  finished();

  return { finds: withDetours, coverage: [], reading };
}

/**
 * Editorial backing for the finds, from an encyclopedia — pl-33 Build step 2.
 *
 * ## Why this is here and not in `nearby`
 *
 * `nearby` is one call however many finds it returns, and its own doc comment
 * says so. A geosearch is one call **per point**, and Wikipedia refuses a
 * corridor-sized bounding box outright (`toobig`, measured). So a corridor
 * costs several, which makes this a budgeted pass beside `detourCosts` rather
 * than more work hidden inside a method that promises to cost one.
 *
 * ## What it spends, and what happens when it runs out
 *
 * One call per tile, up to `MAX_NOTABILITY_TILES`, and it stops the moment the
 * budget refuses. A half-tiled corridor is not a failure and is not reported
 * as a gap: `notability: []` already means "nothing checked" rather than
 * "nothing found", so a find the budget never reached is indistinguishable
 * from one nobody has written about — which is honest, because from here they
 * are the same thing.
 *
 * ## The language
 *
 * Counted from the corridor's own `wikipedia` tags, not configured and not
 * derived from a country. The finds state it: pl-33 measured 16 `fr:` to 3
 * `en:` on this corridor, and 426 French articles to 189 English ones over one
 * 10 km radius in the same region. A corridor whose finds name no language at
 * all is not guessed at — there is nothing to count, so nothing is asked.
 */
async function notability(
  provider: RunGrounding,
  corridor: readonly Place[],
  finds: readonly Find[],
  signal: AbortSignal,
  logger: AppLogger,
): Promise<Find[]> {
  const language = dominantLanguage(finds);
  if (language === null) return [...finds];

  // Same narrowing `nearby` does: a corridor endpoint that never geocoded has
  // no coordinates and cannot be asked about.
  const points = corridor
    .map((place) => place.coordinates)
    .filter((point): point is Coordinates => point !== null);

  const articles: NearbyArticle[] = [];
  for (const point of notabilityTiles(points)) {
    let outcome;
    try {
      outcome = await provider.articlesNear({
        coordinates: point,
        radiusMetres: NOTABILITY_TILE_METRES,
        language,
        signal,
      });
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw error;
      // One tile failing is not the pass failing: the rest of the corridor is
      // still worth asking about, and a find nobody reached keeps the same
      // empty `notability` a find nobody wrote about has.
      logger.warn("a notability lookup failed, continuing with the rest", {
        provider: provider.name,
        code: AppError.from(error).code,
      });
      continue;
    }

    if (outcome.kind === "refused") break;
    if (outcome.kind === "answered") articles.push(...outcome.value);
  }

  if (articles.length === 0) return [...finds];

  return finds.map((find) => {
    const near = articles.filter(
      (article) =>
        haversineMetres(find.coordinates, article.coordinates) <= NOTABILITY_MATCH_METRES,
    );
    if (near.length === 0) return find;

    // The map's own tags first, then anything geosearch added that the tags
    // did not already name. Same url means same article, whichever found it.
    const seen = new Set(find.notability.map((source) => source.url));
    const added = near.filter((article) => !seen.has(article.source.url));
    return { ...find, notability: [...find.notability, ...added.map((a) => a.source)] };
  });
}

/**
 * Wikivoyage for the corridor's own ends — pl-33 Build step 3.
 *
 * **Not per find, and that is the measurement rather than a preference.** A
 * geosearch of `en.wikivoyage.org` around Québec City returns 2 articles and
 * `fr.` returns 7, against 189 and 426 on Wikipedia over the same circle. They
 * are city articles: attaching "Québec City" to a viewpoint inside it would
 * assert that the article is about the viewpoint, which is exactly the fusion
 * §5's amendment refuses.
 *
 * So one lookup per corridor end, a tight radius, and the answers ride on the
 * revision. Two calls at most, and they come out of the same budget as
 * everything else — a run that has spent its allowance gets `reading: []`,
 * which means "nothing checked" here as everywhere.
 */
async function corridorReading(
  provider: RunGrounding,
  corridor: readonly Place[],
  finds: readonly Find[],
  signal: AbortSignal,
  logger: AppLogger,
): Promise<Source[]> {
  const language = dominantLanguage(finds);
  if (language === null) return [];

  const ends = corridor
    .map((place) => place.coordinates)
    .filter((point): point is Coordinates => point !== null);

  const reading: Source[] = [];
  const seen = new Set<string>();
  for (const point of ends) {
    let outcome;
    try {
      outcome = await provider.articlesNear({
        coordinates: point,
        radiusMetres: READING_RADIUS_METRES,
        language,
        site: "wikivoyage",
        signal,
      });
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw error;
      logger.warn("a corridor reading lookup failed, continuing", {
        provider: provider.name,
        code: AppError.from(error).code,
      });
      continue;
    }

    if (outcome.kind === "refused") break;
    if (outcome.kind !== "answered") continue;

    for (const article of outcome.value) {
      if (seen.has(article.source.url)) continue;
      seen.add(article.source.url);
      reading.push(article.source);
      // Bounded because it is stored — `MAX_REVISION_READING`. Both ends of a
      // long corridor deserve a turn, so this stops rather than letting the
      // first end fill the list.
      if (reading.length >= MAX_REVISION_READING) return reading;
    }
  }

  return reading;
}

/**
 * Which language edition to ask, counted from what the mappers wrote.
 *
 * `null` when the corridor's finds name none — the honest answer to "which
 * language is this region written in" when the region has not said.
 */
function dominantLanguage(finds: readonly Find[]): string | null {
  const counts = new Map<string, number>();
  for (const find of finds) {
    for (const source of find.notability) {
      const match = /^https:\/\/([a-z-]+)\.wikipedia\.org\//i.exec(source.url);
      const language = match?.[1];
      if (language === undefined) continue;
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Points to ask about, spaced so their circles tile the corridor rather than
 * overlap it.
 *
 * Bounded by `MAX_NOTABILITY_TILES` before the budget is even consulted: a
 * 950 km corridor would otherwise ask for fifty calls and be refused after
 * `MAX_GROUNDING_CALLS`, having spent the whole run's allowance on one pass.
 * Evenly spaced along the polyline's own points, so a long corridor gets
 * coverage spread over it rather than a dense start and nothing after.
 */
function notabilityTiles(corridor: Corridor): Coordinates[] {
  if (corridor.length === 0) return [];
  if (corridor.length <= MAX_NOTABILITY_TILES) return [...corridor];

  const step = (corridor.length - 1) / (MAX_NOTABILITY_TILES - 1);
  const points: Coordinates[] = [];
  for (let index = 0; index < MAX_NOTABILITY_TILES; index += 1) {
    const point = corridor[Math.round(index * step)];
    if (point !== undefined) points.push(point);
  }
  return points;
}

/**
 * One corridor endpoint, located.
 *
 * **`trip` is passed even for the endpoint that *is* the destination**, and the
 * circularity is deliberate rather than overlooked — pl-37. `placeFor` builds
 * both endpoints with `locality: null`, so both are exactly the bare-name case
 * the trip context exists for, and the origin genuinely benefits. For the
 * destination the context is the place's own name, which can narrow only among
 * rows the query already matched: measured over the captured bare `Percé`
 * reply, the hint `perce` matches the Idaho county as well as the Québec town.
 * That is why `chooseResult` runs no settlement tiebreak behind a destination
 * hint — with one, this call site would have answered Québec on no evidence.
 * With none, the worst it can do is what it did before: decline.
 */
async function locate(
  provider: RunGrounding,
  place: Place,
  trip: TripContext | undefined,
  signal: AbortSignal,
  logger: AppLogger,
): Promise<Place | null> {
  try {
    const outcome = await provider.locate({ place, trip, signal });
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
