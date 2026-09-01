/**
 * The measuring pass itself, over candidates a run could plausibly produce.
 *
 * `travel-pass.test.ts` drives the whole run and reads the plan back, which is
 * the claim that matters; this file is the other half — the cases the six
 * checked-in candidate sets cannot express, chiefly two different places that
 * share a name. Nothing here goes near the database or a route.
 */

import { describe, expect, test } from "vitest";
import {
  location,
  MODEL_ASSERTED,
  type Candidate,
  type Coordinates,
  type ItemTravel,
  type Place,
  type Source,
} from "@planner/contract";
import type { LocateRequest, TravelRequest, TripContext } from "@planner/agent";
import {
  answered,
  REFUSED,
  UNKNOWN,
  type GroundingOutcome,
  type RunGrounding,
  type TravelOutcomeMatrix,
} from "../src/grounding/cache.ts";
import { placeIdentity } from "../src/grounding/place-key.ts";
import { createLogger } from "../src/logger.ts";
import { measureTravel, runPlaces } from "../src/runs/travel.ts";

const logger = createLogger({ level: "silent" });

function place(name: string, locality: string | null): Place {
  return { name, locality, coordinates: null };
}

let sequence = 0;
function at(name: string, locality: string | null): Candidate {
  sequence += 1;
  return {
    id: `cand-${String(sequence)}`,
    specialist: "activities",
    title: name,
    summary: "A thing a specialist proposed.",
    location: location.at(place(name, locality)),
    durationMinutes: 60,
    cost: null,
    season: null,
    bookingLeadTimeDays: null,
    provenance: MODEL_ASSERTED,
  };
}

/** The same candidate, at a place that already knows where it is. */
function withPoint(candidate: Candidate, coordinates: Coordinates): Candidate {
  const { location: where } = candidate;
  if (where.kind !== "at") throw new Error("this helper only moves an `at` candidate");
  return { ...candidate, location: location.at({ ...where.place, coordinates }) };
}

/** A gazetteer keyed the way the seam keys places: name **and** locality. */
function gazetteer(entries: Record<string, { latitude: number; longitude: number }>): RunGrounding {
  const table = new Map(Object.entries(entries));
  return {
    name: "test",
    refused: 0,
    async locate(request: LocateRequest): Promise<
      GroundingOutcome<{
        coordinates: { latitude: number; longitude: number };
        source: { url: string; title: string | null; fetchedAt: string };
      }>
    > {
      const found = table.get(placeIdentity(request.place));
      if (found === undefined) return UNKNOWN;
      return answered({
        coordinates: found,
        source: {
          url: "https://fixtures.invalid/planner/test",
          title: "A test double, not a measurement",
          fetchedAt: "2027-01-01T00:00:00.000Z",
        },
      });
    },
    async travel(request: TravelRequest): Promise<TravelOutcomeMatrix> {
      return request.origins.map(() => request.destinations.map(() => UNKNOWN));
    },
    /** This suite is entirely about the measuring pass; discovery is pl-29's own file. */
    async articlesNear(): Promise<GroundingOutcome<never[]>> {
      return answered([]);
    },
    async nearby(): Promise<GroundingOutcome<never[]>> {
      return answered([]);
    },
  };
}

async function measure(
  candidates: readonly Candidate[],
  provider: RunGrounding,
  trip?: TripContext,
): Promise<Awaited<ReturnType<typeof measureTravel>>> {
  return measureTravel({
    candidates,
    places: runPlaces(candidates),
    provider,
    trip,
    logger,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
}

/**
 * The same provider, recording every `LocateRequest` it is handed — pl-37.
 *
 * The whole request and not just one field: what is under test is that the
 * pass hands the seam what it was given, and a recorder that only kept
 * `trip.destination` could not see a rewritten `place` beside it.
 */
function watching(provider: RunGrounding): {
  provider: RunGrounding;
  requests: LocateRequest[];
} {
  const requests: LocateRequest[] = [];
  return {
    provider: {
      ...provider,
      locate: (request) => {
        requests.push(request);
        return provider.locate(request);
      },
    },
    requests,
  };
}

/** Every place on a candidate, so a test can read what the pass wrote back. */
function coordinatesOf(candidate: Candidate): (readonly [number, number] | null)[] {
  const { location: where } = candidate;
  const places = where.kind === "at" ? [where.place] : [where.from, where.to];
  return places.map((each) =>
    each.coordinates === null
      ? null
      : ([each.coordinates.latitude, each.coordinates.longitude] as const),
  );
}

describe("two places that share a name", () => {
  /**
   * The defect this file was written for.
   *
   * Deduplicating by name alone merged these two into one lookup, and then
   * `withCoordinates` wrote the survivor's point onto both — persisted, so no
   * later run would re-locate them — and both ends indexed the same matrix
   * cell. The plan reported a grounded transition to the wrong province.
   */
  test("are located separately and keep their own coordinates", async () => {
    const quebec = at("Saint-Jean", "Québec, Canada");
    const newBrunswick = at("Saint-Jean", "New Brunswick, Canada");

    const asked: string[] = [];
    const provider = gazetteer({
      [placeIdentity(place("Saint-Jean", "Québec, Canada"))]: {
        latitude: 45.3168,
        longitude: -73.2624,
      },
      [placeIdentity(place("Saint-Jean", "New Brunswick, Canada"))]: {
        latitude: 45.2733,
        longitude: -66.0633,
      },
    });
    const watched: RunGrounding = {
      ...provider,
      locate: (request) => {
        asked.push(placeIdentity(request.place));
        return provider.locate(request);
      },
    };

    const result = await measure([quebec, newBrunswick], watched);

    expect(asked).toHaveLength(2);
    expect(coordinatesOf(result.candidates[0] as Candidate)).toEqual([[45.3168, -73.2624]]);
    expect(coordinatesOf(result.candidates[1] as Candidate)).toEqual([[45.2733, -66.0633]]);
  });

  /**
   * The one case the inputs can settle by themselves.
   *
   * Same name, same locality, different known points — so these are provably
   * two places, and the earlier shape threw the proof away: it kept the first
   * `RunPlace` and dropped the second, wrote the survivor's coordinates onto
   * both candidates and indexed both to one matrix cell. Coordinates are the
   * only evidence a `Place` carries beyond its prose.
   */
  test("that carry different coordinates are two places, not one", async () => {
    const first = at("Le Manoir", null);
    const second = at("Le Manoir", null);
    first.location = location.at({
      name: "Le Manoir",
      locality: null,
      coordinates: { latitude: 48.45, longitude: -68.52 },
    });
    second.location = location.at({
      name: "Le Manoir",
      locality: null,
      coordinates: { latitude: 45.5, longitude: -73.57 },
    });

    expect(runPlaces([first, second]).all).toHaveLength(2);

    const result = await measure([first, second], gazetteer({}));
    expect(coordinatesOf(result.candidates[0] as Candidate)).toEqual([[48.45, -68.52]]);
    expect(coordinatesOf(result.candidates[1] as Candidate)).toEqual([[45.5, -73.57]]);
  });

  /**
   * And the one the inputs cannot, recorded so nobody reads the test above as
   * closing the class. Two inns of one name with no locality and no point are
   * one question, and asking it twice would return one answer twice — see
   * `runPlaceKey` and `place-key.ts`. What must **not** happen is a plan
   * claiming a measurement it did not earn, and it does not: with no gazetteer
   * entry the leg is `not-established`.
   */
  test("that carry no coordinates at all are one question, and it stays unanswered", async () => {
    const first = at("Le Manoir", null);
    const second = at("Le Manoir", null);

    expect(runPlaces([first, second]).all).toHaveLength(1);

    const result = await measure([first, second], gazetteer({}));
    expect(result.travel.between(first, second)).toEqual({ kind: "not-established" });
  });

  test("and one spelling of one place is still asked about once", async () => {
    // The other half of the same rule: deduplication has to still happen, or
    // the run pays for a wider matrix than it needs.
    const first = at("Québec  City", "Québec, Canada");
    const second = at("québec city", " Québec, Canada ");

    const asked: string[] = [];
    const provider = gazetteer({});
    const result = await measure([first, second], {
      ...provider,
      locate: (request) => {
        asked.push(placeIdentity(request.place));
        return provider.locate(request);
      },
    });

    expect(asked).toHaveLength(1);
    expect(result.candidates).toHaveLength(2);
  });
});

describe("what a leg says when there is no measurement", () => {
  test("a refused lookup is not a leg nobody knows about", async () => {
    const here = at("Rimouski", "Québec, Canada");
    const there = at("Percé", "Québec, Canada");
    const provider = gazetteer({});

    const spent = await measure([here, there], {
      ...provider,
      locate: async () => REFUSED,
    });
    expect(spent.travel.between(here, there)).toEqual({ kind: "over-budget" });

    const silent = await measure([here, there], provider);
    expect(silent.travel.between(here, there)).toEqual({ kind: "not-established" });
  });

  test("a backend that throws is not a refusal — nobody declined to pay", async () => {
    const here = at("Alma", "Québec, Canada");
    const there = at("Saguenay", "Québec, Canada");
    const provider = gazetteer({});

    const broken = await measure([here, there], {
      ...provider,
      locate: () => {
        throw new Error("the routing service refused the connection");
      },
    });

    expect(broken.travel.between(here, there)).toEqual({ kind: "not-established" });
  });
});

/**
 * What a measured leg says it read, or a failure naming what the leg was
 * instead — a leg that came back `not-established` would otherwise fail an
 * assertion about titles with no hint of why.
 */
function legSources(travel: ItemTravel): Source[] {
  if (travel.kind !== "measured") throw new Error(`the leg was ${travel.kind}, not measured`);
  if (travel.provenance.kind !== "grounded") throw new Error("a measured leg was not grounded");
  return travel.provenance.sources;
}

/**
 * pl-36's finding 1: `locate` answers with a `Source` and this pass used to
 * drop it on the floor, so every geocoded point on every plan was
 * unattributed. It lands on the leg the geocode made measurable — the only
 * user-visible fact a coordinate produces — so these tests read it off
 * `ItemTravel.measured.provenance`.
 *
 * The real provider gives its geocoder and its router the **same URL** and
 * tells them apart in the title, which is why every assertion below reads
 * titles rather than URLs: it is the shape the defect actually has.
 */
describe("what a measured leg cites", () => {
  const GEOCODED = "OpenStreetMap, geocoded by Nominatim";
  const ROUTED = "OpenStreetMap, routed by Valhalla";
  const OSM = "https://www.openstreetmap.org/copyright";

  /**
   * A provider shaped like the real one: one URL, two titles, and a `fetchedAt`
   * that moves with each lookup so "the earliest reading wins" can be seen.
   */
  function osm(
    entries: Record<string, { latitude: number; longitude: number }>,
    readAt: readonly string[] = ["2027-03-01T00:00:00.000Z", "2027-03-02T00:00:00.000Z"],
  ): RunGrounding {
    const table = new Map(Object.entries(entries));
    let lookups = 0;
    return {
      ...gazetteer(entries),
      async locate(request: LocateRequest) {
        const found = table.get(placeIdentity(request.place));
        if (found === undefined) return UNKNOWN;
        const fetchedAt = readAt[lookups % readAt.length] ?? readAt[0] ?? "";
        lookups += 1;
        return answered({
          coordinates: found,
          source: { url: OSM, title: GEOCODED, fetchedAt },
        });
      },
      async travel(request: TravelRequest): Promise<TravelOutcomeMatrix> {
        return request.origins.map(() =>
          request.destinations.map(() =>
            answered({
              distanceMeters: 100_000,
              durationMinutes: 90,
              source: { url: OSM, title: ROUTED, fetchedAt: "2027-03-03T00:00:00.000Z" },
            }),
          ),
        );
      },
    };
  }

  test("names the geocoder that placed its ends, not only the router", async () => {
    const here = at("Rimouski", "Québec, Canada");
    const there = at("Percé", "Québec, Canada");

    const result = await measure(
      [here, there],
      osm({
        [placeIdentity(place("Rimouski", "Québec, Canada"))]: {
          latitude: 48.45,
          longitude: -68.52,
        },
        [placeIdentity(place("Percé", "Québec, Canada"))]: { latitude: 48.52, longitude: -64.21 },
      }),
    );

    const sources = legSources(result.travel.between(here, there));
    expect(sources.map((each) => each.title)).toEqual([ROUTED, GEOCODED]);
    // Two lookups, one citation: the pair collapses on url *and* title, and
    // the earlier of the two readings is the one the plan keeps — claiming
    // the fresher for both would be the plan saying it knows something more
    // recently than it does.
    expect(sources.filter((each) => each.title === GEOCODED)).toHaveLength(1);
    expect(sources[1]?.fetchedAt).toBe("2027-03-01T00:00:00.000Z");
  });

  test("cites no geocoder for an end it never looked up", async () => {
    // Both ends arrive carrying their own point, so nothing is geocoded and
    // there is nothing to attribute to a geocoder. The paired assertion above
    // is what makes this one worth having: without it, a leg citing only the
    // router would pass whether the fix existed or not.
    const here = withPoint(at("Gaspé", "Québec, Canada"), { latitude: 48.83, longitude: -64.48 });
    const there = withPoint(at("Matane", "Québec, Canada"), { latitude: 48.84, longitude: -67.53 });

    const result = await measure([here, there], osm({}));

    expect(legSources(result.travel.between(here, there)).map((each) => each.title)).toEqual([
      ROUTED,
    ]);
  });

  test("cites the one end it did look up, and not the one it did not", async () => {
    const here = withPoint(at("Amqui", "Québec, Canada"), { latitude: 48.46, longitude: -67.43 });
    const there = at("Causapscal", "Québec, Canada");

    const result = await measure(
      [here, there],
      osm({
        [placeIdentity(place("Causapscal", "Québec, Canada"))]: {
          latitude: 48.36,
          longitude: -67.23,
        },
      }),
    );

    const sources = legSources(result.travel.between(here, there));
    expect(sources.map((each) => each.title)).toEqual([ROUTED, GEOCODED]);
  });
});

/**
 * The trip context the pass carries to `locate`, and nowhere else — pl-37.
 *
 * The seam grew a field; this file's job is that the *pass* hands it over
 * unchanged and does not let it become a fact about anything. The choosing
 * behind it is `grounding-valhalla.test.ts`'s, over real captures.
 */
describe("what the pass tells `locate` about the trip", () => {
  test("every lookup carries it, as the prose it was handed", async () => {
    const first = at("Percé", null);
    const second = at("Tadoussac", null);
    const { provider, requests } = watching(gazetteer({}));

    await measure([first, second], provider, { destination: "Québec, Canada" });

    expect(requests.map((each) => each.trip?.destination)).toEqual([
      "Québec, Canada",
      "Québec, Canada",
    ]);
  });

  test("a run with no destination sends none, rather than an empty one", async () => {
    // A brief may decline its destination and that is an instruction, not a
    // hole. `undefined` and `""` are different questions to the cache key, so
    // inventing the second here would partition rows for nothing.
    const { provider, requests } = watching(gazetteer({}));

    await measure([at("Percé", null)], provider);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.trip).toBeUndefined();
  });

  /**
   * **It is a hint for choosing, never evidence that a place is somewhere.**
   *
   * The failure this rules out is the tempting one: a place the geocoder could
   * not find, quietly given the destination's coordinates because "the trip is
   * going there anyway". That is a fabricated point with a `Source` behind it,
   * which is the worst thing this tool can produce. A destination changes
   * which of a geocoder's answers is believed and it never manufactures one.
   */
  test("and a place nobody could locate is still unlocated, destination or not", async () => {
    const nowhere = at("Zzqqxv", null);

    const result = await measure([nowhere], gazetteer({}), { destination: "Québec, Canada" });

    expect(coordinatesOf(result.candidates[0] as Candidate)).toEqual([null]);
  });
});
