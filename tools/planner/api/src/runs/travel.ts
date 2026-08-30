/**
 * The grounding pass: locate what the specialists named, measure between it,
 * and hand the composer a table it can pack under.
 *
 * `00-ANALYSIS.md` §5 ranks **distances and travel times** first of the four
 * things grounding buys, because §2's failure 1 — three towns in a day that are
 * six hours apart — is the most common way an AI itinerary is wrong. This file
 * is where that stops being true of this tool.
 *
 * ```
 * fanning-out ──► candidates
 *                     │
 *                     ▼   grounding
 *          distinct places across every candidate
 *                     │   locate ×N, one per place with no coordinates yet
 *                     ▼
 *          one travel matrix over the located ones      ← one call, not n²
 *                     │
 *                     ▼   composing
 *          compose({ …, travel })  ──► days packed under measured transitions
 * ```
 *
 * ## Why it lives here and not in `@planner/itinerary`
 *
 * That package has **no model, no network, no clock**, enforced by
 * `itinerary/test/purity.test.ts` and not by good intentions. The package that
 * packs days must not be the package that fetches distances, so the pass sits
 * in `api` — which is also the only place in this tool that reads configuration
 * — and what crosses into the composer is a plain `TravelTable`.
 *
 * ## Why one matrix
 *
 * The packer's problem is circular otherwise: the time between consecutive
 * items is only knowable once you know the order, and the order is what the
 * packer is deciding. Measuring every pair up front dissolves it, which is why
 * `GroundingProvider.travel` is matrix-shaped, and it is **one** call against
 * `MAX_GROUNDING_CALLS` rather than n².
 *
 * ## A place that will not locate is not a failure
 *
 * It has no coordinates, its legs have no measurement, and it is still a
 * perfectly good candidate: the plan says travel time was unchecked *for those
 * items* and packs the rest under measured numbers. That is `PlanGap`'s
 * philosophy one level down, and the fan-out's rule that one specialist failing
 * does not fail the run is the precedent. **The same governs the backend being
 * down entirely** — the plan is the plan it would have been without grounding,
 * with the gap named, and not an error page. The one thing that does propagate
 * is a cancellation, because a canceled run must not quietly produce a draft.
 */

import type { TravelEstimate } from "@planner/agent";
import { AppError, MAX_SOURCES, NOT_ESTABLISHED, OVER_BUDGET } from "@planner/contract";
import type {
  Candidate,
  CandidateLocation,
  Coordinates,
  ItemTravel,
  Place,
  RunProgress,
  Source,
} from "@planner/contract";
import type { TravelTable } from "@planner/itinerary";
import {
  travelOutcome,
  type GroundingOutcome,
  type RunGrounding,
  type TravelOutcomeMatrix,
} from "../grounding/cache.ts";
import { placeIdentity } from "../grounding/place-key.ts";
import type { AppLogger } from "../logger.ts";

/** How you are assumed to be getting about. The only mode this seam has today. */
const MODE = "driving" as const;

/** One place a run needs an answer about, under the identity the seam uses. */
export interface RunPlace {
  key: string;
  place: Place;
}

/**
 * The places a run's candidates name, deduplicated, and which of them still
 * need a lookup.
 *
 * **Deduplicated by `placeIdentity`, which is the seam's own normaliser** —
 * name *and* locality, the same string the cache keys `locate` and `travel` by.
 * Two spellings of one place sent as two rows is a wider matrix than the run
 * needs to pay for; two *different* places merged into one row is worse than
 * paying, because the survivor's coordinates are written onto both and the plan
 * then measures a leg to somewhere nobody is going. The first draft of this
 * pass used the fixture provider's `fixturePlaceKey`, which is name-only and
 * did exactly that — see `place-key.ts`.
 */
export interface RunPlaces {
  /** Every distinct place across the candidates, in first-seen order. */
  all: RunPlace[];
  /** Those with no coordinates yet — one lookup each. */
  toLocate: RunPlace[];
}

/** Both ends of a leg; the one place of everything else. */
function placesOf(location: CandidateLocation): Place[] {
  return location.kind === "at" ? [location.place] : [location.from, location.to];
}

/**
 * Where a candidate leaves you, and where it wants you to be.
 *
 * A leg ends at its `to` and begins at its `from`, so the transition between
 * two items is measured from the first one's `to` to the second one's `from` —
 * which is the whole reason pl-15 made a candidate carry both its ends. Anything
 * `at` a place both ends and begins there.
 */
function endsAt(candidate: Candidate): Place {
  const { location } = candidate;
  return location.kind === "at" ? location.place : location.to;
}

function beginsAt(candidate: Candidate): Place {
  const { location } = candidate;
  return location.kind === "at" ? location.place : location.from;
}

/**
 * Which row of this run's matrix a place belongs to.
 *
 * `placeIdentity` and then, **where the place already carries a point, that
 * point**. Two things follow, and the second is the one that took a gate to
 * notice:
 *
 * - A place with no coordinates is keyed by its identity alone, which is what
 *   makes the deduplication worth doing: the run asks about "Rimouski, Québec"
 *   once however many candidates name it.
 * - Two places with the **same** identity and **different** coordinates are two
 *   rows. That is the one case where the inputs *prove* the two are not the
 *   same place, and the earlier shape threw that proof away — it kept the first
 *   and dropped the second, so the survivor's point was written onto both
 *   candidates and both indexed one cell. Coordinates are the only evidence a
 *   `Place` carries beyond its prose, and evidence that settles a question must
 *   not be discarded for a tidier key.
 *
 * The cost is a wider matrix when one candidate carries a point for a place
 * another names without one. That is a row, and it buys never merging two
 * places on nothing but a name.
 *
 * **It is computed on the place as the fan-out proposed it**, before the pass
 * writes located coordinates back — see `endsOf`, which pins each candidate's
 * two keys once so nothing recomputes a key from an object this pass has since
 * changed.
 *
 * ## What it still merges, and why that is the honest stopping point
 *
 * Two different places with the same name, the same locality and **no**
 * coordinates are one key, and nothing here can tell them apart. Refusing to
 * merge them would not help: the run would ask the backend the identical
 * question twice and get the identical answer, so both candidates would carry
 * the same point either way. The ambiguity is in the question, and it needs
 * something a `Candidate` does not carry — an identifier, or a seam that can
 * say "more than one place matches". Named in `place-key.ts` and left to pl-28
 * rather than papered over with a key that only looks safer.
 */
export function runPlaceKey(place: Place): string {
  const identity = placeIdentity(place);
  if (place.coordinates === null) return identity;
  const { latitude, longitude } = place.coordinates;
  return `${identity}\u0000${String(latitude)},${String(longitude)}`;
}

export function runPlaces(candidates: readonly Candidate[]): RunPlaces {
  const all = new Map<string, RunPlace>();
  for (const candidate of candidates) {
    for (const place of placesOf(candidate.location)) {
      const key = runPlaceKey(place);
      // First spelling wins. Nothing replaces an entry any more: two places
      // that reach the same key are the same question — same name, same
      // locality, and either both unlocated or located at the same point.
      if (!all.has(key)) all.set(key, { key, place });
    }
  }

  const list = [...all.values()];
  return { all: list, toLocate: list.filter((each) => each.place.coordinates === null) };
}

/**
 * Each candidate's two ends, keyed once, before anything is written back.
 *
 * `between` is asked about the candidates the *composer* holds, and those are
 * the ones this pass has already filled coordinates into — so recomputing a key
 * from them would not match the index, which was built from the places as
 * proposed. Pinning both keys per candidate id removes the hazard rather than
 * documenting it: an id survives `withCoordinates` untouched.
 */
function endsOf(
  candidates: readonly Candidate[],
): ReadonlyMap<string, { begins: string; ends: string }> {
  return new Map(
    candidates.map((candidate) => [
      candidate.id,
      { begins: runPlaceKey(beginsAt(candidate)), ends: runPlaceKey(endsAt(candidate)) },
    ]),
  );
}

export interface MeasureInput {
  candidates: readonly Candidate[];
  places: RunPlaces;
  /**
   * This run's grounding: pl-25's cache with this run's budget inside it, from
   * `groundingForRun`. Misses claim a call, hits do not, and a refusal makes no
   * call at all — which is why nothing here holds a `GroundingBudget` of its
   * own, and why nothing here ever touches `context.grounding` directly.
   *
   * Every answer is a `GroundingOutcome`, so "nobody knows" and "we never
   * asked" arrive as different values rather than as one `null` this pass would
   * have to guess about.
   */
  provider: RunGrounding;
  logger: AppLogger;
  signal: AbortSignal;
  /** One `{ done, total }` frame per lookup answered. */
  onProgress: (progress: RunProgress) => void;
}

export interface MeasureResult {
  /**
   * The run's candidates, with every place grounding could locate now carrying
   * its coordinates — the field that has been nullable since pl-4 waiting for
   * precisely this. An existing coordinate is never overwritten: it was already
   * a located place, and re-writing it would turn checked-in data into whatever
   * this deployment's backend happens to say.
   */
  candidates: Candidate[];
  /** What the composer packs under. `NOTHING_MEASURED` when nothing answered. */
  travel: TravelTable;
}

/**
 * Was this the user stopping the run, or grounding breaking?
 *
 * The same three tests the orchestrator makes, because a cancellation has to
 * cross this pass rather than be swallowed by the catch-all below: everything
 * else here is degraded into a plan that names its gap, and a canceled run must
 * not produce a plan at all.
 */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof AppError) return error.code === "CANCELED" || error.code === "JOB_CANCELED";
  return error instanceof Error && error.name === "AbortError";
}

/**
 * A grounding outcome that is not an answer, as the plan records it.
 *
 * One line, and it is the whole of what this pass has to say about an empty
 * result — because pl-25's seam already made the distinction a *value*. An
 * earlier draft of this file had to infer it by reading `RunGrounding.refused`
 * around each call and attributing the delta, which worked only because the
 * locate loop happened to be sequential with one budget and no retry above it,
 * none of which was asserted anywhere. Parallelising that loop with one call of
 * budget left would have shipped an answered lookup as `over-budget`.
 */
function unanswered(outcome: { kind: "unknown" } | { kind: "refused" }): ItemTravel {
  return outcome.kind === "refused" ? OVER_BUDGET : NOT_ESTABLISHED;
}

export async function measureTravel(input: MeasureInput): Promise<MeasureResult> {
  const { places, provider, logger, signal } = input;

  // Knowable before the first lookup goes out, which is what lets the UI show a
  // fraction rather than a spinner — the same property the roster's size has.
  // One step per place we do not have coordinates for, plus the matrix.
  //
  // **Steps finished, not calls made.** The distinction only shows up on one
  // path — every place failing to locate, so there is nothing to send a matrix
  // over — and on that path the step is genuinely finished: nothing is left to
  // wait for. Counting it as outstanding would leave the bar short of its own
  // total for a run that had nothing more to do, which reads as work still
  // happening. `done` reaches `total` on every path out of this function.
  const total = places.toLocate.length + 1;
  let done = 0;
  const finished = (): void => {
    done += 1;
    input.onProgress({ type: "grounding", done, total });
  };

  const located = new Map<string, Coordinates>();
  /**
   * What geocoded each place *this pass* located, per place — pl-36.
   *
   * `locate` has always answered with a `Source` beside its coordinates and
   * this pass has always dropped it, so every geocoded point on every plan was
   * unattributed: `located` is `Map<string, Coordinates>` and there was no
   * field for a citation to survive in. It rides here rather than on the
   * `Place` — see `measured` for where it lands and why nothing in the contract
   * had to move.
   *
   * A place that arrived carrying its own coordinates is absent, deliberately:
   * nothing looked it up, so there is nothing to cite for it.
   */
  const geocoded = new Map<string, Source>();
  /** Places with no coordinates, and why — `unknown` or `refused`, per place. */
  const unlocated = new Map<string, ItemTravel>();
  for (const each of places.all) {
    if (each.place.coordinates !== null) located.set(each.key, each.place.coordinates);
  }

  for (const each of places.toLocate) {
    try {
      const outcome = await provider.locate({ place: each.place, signal });
      if (outcome.kind === "answered") {
        located.set(each.key, outcome.value.coordinates);
        geocoded.set(each.key, outcome.value.source);
      } else unlocated.set(each.key, unanswered(outcome));
    } catch (error: unknown) {
      if (isCancellation(error, signal)) throw error;
      // One place that would not resolve is not a failed run — it is a place
      // with no coordinates, whose legs the plan then names as unmeasured. A
      // thrown backend is not a refusal: nobody declined to pay for this.
      unlocated.set(each.key, NOT_ESTABLISHED);
      logger.warn("a place could not be located", {
        provider: provider.name,
        code: AppError.from(error).code,
      });
    }
    finished();
  }

  const unaffordable = [...unlocated.values()].filter((why) => why.kind === "over-budget").length;
  if (unaffordable > 0) {
    // §9's ceiling, spent. Not silent, and not only a log line: every item whose
    // transition touches one of these reaches the plan as `over-budget`.
    logger.warn("grounding budget spent before every place was located", {
      located: located.size,
      unaffordable,
      places: places.all.length,
    });
  }

  const candidates = withCoordinates(input.candidates, located);
  const ends = endsOf(input.candidates);
  const order = places.all.filter((each) => located.has(each.key));
  if (order.length === 0) {
    // Not one place located, so there is no matrix to send and the step ends
    // here rather than being skipped — see the note on `total` above.
    finished();
    return { candidates, travel: tableFor(null, order, unlocated, ends, geocoded) };
  }

  const asked = order.map((each) => ({
    ...each.place,
    coordinates: located.get(each.key) ?? null,
  }));
  let matrix: TravelOutcomeMatrix | null = null;
  try {
    matrix = await provider.travel({ origins: asked, destinations: asked, mode: MODE, signal });
  } catch (error: unknown) {
    if (isCancellation(error, signal)) throw error;
    // The backend being down entirely lands here, and it is the same answer as
    // one place failing to resolve: the plan is the plan it would have been
    // without grounding, and it says travel time went unchecked.
    logger.warn("the travel matrix could not be measured", {
      provider: provider.name,
      code: AppError.from(error).code,
    });
  }
  finished();

  return { candidates, travel: tableFor(matrix, order, unlocated, ends, geocoded) };
}

/**
 * The table the composer packs under, over one matrix.
 *
 * Built rather than closed over inline so that every path out of the pass —
 * nothing located, the backend throwing, the budget refusing — produces a table
 * of the same shape, and none of them can answer with a state it did not earn.
 *
 * `travelOutcome` **throws** for a pair it was not sent, which is why the two
 * ends are looked up in `index` first: an unlocated end is a statement about
 * the world and belongs in `unlocated`, while an index out of range would be a
 * statement about this function being wrong.
 */
function tableFor(
  matrix: TravelOutcomeMatrix | null,
  order: readonly RunPlace[],
  unlocated: ReadonlyMap<string, ItemTravel>,
  ends: ReadonlyMap<string, { begins: string; ends: string }>,
  /** What geocoded each end, for the legs that turn out to be measured (pl-36). */
  geocoded: ReadonlyMap<string, Source>,
  /** What a leg is when the whole matrix call threw. Nobody declined to pay. */
  whenNoMatrix: ItemTravel = NOT_ESTABLISHED,
): TravelTable {
  const index = new Map(order.map((each, position) => [each.key, position]));

  return {
    between: (from, to) => {
      // The keys as the fan-out proposed these places, not as they are now:
      // `withCoordinates` has since filled points in, and a key recomputed off
      // that would miss an index built before it.
      const originKey = ends.get(from.id)?.ends;
      const destinationKey = ends.get(to.id)?.begins;
      if (originKey === undefined || destinationKey === undefined) return NOT_ESTABLISHED;

      // An end we never located, and the reason we did not is carried per
      // place: a refusal is not "nobody knows".
      const origin = index.get(originKey);
      const destination = index.get(destinationKey);
      if (origin === undefined || destination === undefined) {
        return unlocated.get(originKey) ?? unlocated.get(destinationKey) ?? NOT_ESTABLISHED;
      }
      if (matrix === null) return whenNoMatrix;

      const outcome: GroundingOutcome<TravelEstimate> = travelOutcome(matrix, origin, destination);
      return outcome.kind === "answered"
        ? measured(outcome.value, [geocoded.get(originKey), geocoded.get(destinationKey)])
        : unanswered(outcome);
    },
  };
}

/**
 * Every distinct citation behind one fact, the oldest reading of each kept.
 *
 * **Deduplicated on the URL *and* the title, not the URL alone** — pl-36. This
 * provider cites one URL for everything it answers
 * (`https://www.openstreetmap.org/copyright`, the attribution page the ODbL
 * asks for, and deliberately not the deployment's own endpoint) and tells its
 * services apart in the title: "OpenStreetMap, routed by Valhalla" against
 * "OpenStreetMap, geocoded by Nominatim". Keying on the URL alone would keep
 * whichever arrived first and silently drop the other, so a plan measured
 * across two services would name one of them.
 *
 * **The earliest `fetchedAt` wins.** Two lookups against one backend read it at
 * two moments; §5 ages a grounded fact out by when it was read, and keeping the
 * fresher of the two for both is the plan claiming to know something more
 * recently than it does.
 */
function citations(sources: readonly (Source | undefined)[]): Source[] {
  const kept = new Map<string, Source>();
  for (const source of sources) {
    if (source === undefined) continue;
    const key = `${source.url}\u0000${source.title ?? ""}`;
    const seen = kept.get(key);
    // The separator is `runPlaceKey`'s, for its reason: a byte neither half can
    // contain, so two different pairs cannot concatenate into one key.
    //
    // `Map.set` on a key it already holds keeps that key's position, so the
    // routing citation stays first however many geocodes follow it.
    if (seen === undefined || source.fetchedAt < seen.fetchedAt) kept.set(key, source);
  }
  // Cannot bite today — this provider has two distinct citations and
  // `MAX_SOURCES` is five. It is here so a seam with more of them cannot build
  // a `Provenance` that `provenanceSchema` then refuses on the way to the
  // database, which would cost the whole revision rather than one citation.
  return [...kept.values()].slice(0, MAX_SOURCES);
}

/**
 * One answered cell as the plan records it.
 *
 * The `Source`s behind it become a `grounded` `Provenance`, which is the
 * vocabulary the plan view already renders (pl-10) and the one
 * `provenanceSchema` refuses to build without a source. Everything else on the
 * candidate stays `model-asserted`: knowing where a place is is not evidence
 * that the thing proposed there exists, which is §5's item 3 and a different
 * question from this one.
 *
 * ## Why the geocoder is cited here too — pl-36
 *
 * This number was not read off one service. It is a route between two points a
 * *geocoder* supplied, so a wrong geocode is a wrong distance: both reads are
 * links in the chain that produced the figure the composer packs days under,
 * and a citation naming only the second of them under-reports what the plan
 * depended on. Nothing in the contract had to move to say so —
 * `Provenance.sources` is a list, and this is that list used for what it is
 * for.
 *
 * **This is where a located place's citation lands, and it is the only place a
 * reader can be shown one.** A geocoded coordinate is never itself rendered —
 * nothing under `web/src` reads a `latitude` — so the only user-visible fact
 * derived from one is the leg measured across it. Hanging the citation off that
 * fact rather than off the `Place` also costs no contract change and no rewrite
 * of every stored candidate; the alternatives are weighed in pl-36's Log.
 *
 * An end this pass did **not** look up contributes nothing: a place that
 * arrived carrying its own coordinates was located by somebody else, and citing
 * a geocoder for it would be claiming a lookup that never happened.
 */
function measured(cell: TravelEstimate, ends: readonly (Source | undefined)[]): ItemTravel {
  return {
    kind: "measured",
    distanceMeters: cell.distanceMeters,
    durationMinutes: cell.durationMinutes,
    provenance: { kind: "grounded", sources: citations([cell.source, ...ends]) },
  };
}

/** The candidates again, with every place this pass located carrying its point. */
function withCoordinates(
  candidates: readonly Candidate[],
  located: ReadonlyMap<string, Coordinates>,
): Candidate[] {
  const fill = (place: Place): Place => {
    if (place.coordinates !== null) return place;
    const found = located.get(runPlaceKey(place));
    return found === undefined ? place : { ...place, coordinates: { ...found } };
  };

  return candidates.map((candidate) => ({
    ...candidate,
    location:
      candidate.location.kind === "at"
        ? { kind: "at", place: fill(candidate.location.place) }
        : {
            kind: "between",
            from: fill(candidate.location.from),
            to: fill(candidate.location.to),
          },
  }));
}
