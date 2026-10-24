/**
 * The town pass on its own (pl-60): which towns, which finds, which notes.
 *
 * `lodging-run.test.ts` runs it inside a real run for the six set A briefs;
 * this file drives `discoverLodging` and `discover` directly against a
 * `RunGrounding` double, for the branches a fixture gazetteer cannot reach.
 *
 * Since pl-62 the pass asks each located town a second time, for places to
 * eat. The double answers that query from `food`, and with nothing by default,
 * so the cases here stay about places to sleep and say what the food query
 * added to them; `food-pass.test.ts` has the food query's own cases.
 */

import { describe, expect, test } from "vitest";
import {
  TRIP_SHAPES,
  uncheckedConstraintSchema,
  type Coordinates,
  type RunProgress,
  type TripBrief,
} from "@planner/contract";
import { AppError } from "@planner/contract";
import Database from "better-sqlite3";
import { FOOD_KINDS, groundingBudget, LODGING_KINDS } from "@planner/agent";
import type { Find, GroundingProvider, NearbyPointRequest } from "@planner/agent";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  answered,
  CachingGroundingProvider,
  groundingForRun,
  REFUSED,
  UNKNOWN,
  type GroundingOutcome,
  type RunGrounding,
} from "../src/grounding/cache.ts";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import { ValhallaGroundingProvider } from "../src/grounding/valhalla.ts";
import { migrate } from "../src/db/schema.ts";
import type { AppLogger } from "../src/logger.ts";
import { discover } from "../src/runs/discovery.ts";
import {
  discoverLodging,
  FOOD_RADIUS_METRES,
  LODGING_RADIUS_METRES,
  lodgingTowns,
  MAX_LODGING_FINDS_PER_TOWN,
  MAX_LODGING_TOWNS,
} from "../src/runs/lodging.ts";

const silent: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

const GASPE: Coordinates = { latitude: 48.8317, longitude: -64.4838 };
const PERCE: Coordinates = { latitude: 48.5223, longitude: -64.2136 };

function sleepFind(name: string, at: Coordinates, id: number): Find {
  return {
    name,
    coordinates: at,
    kind: "motel",
    tags: new Map([
      ["tourism", "motel"],
      ["name", name],
    ]),
    sources: [
      {
        url: `https://www.openstreetmap.org/way/${String(id)}`,
        title: "OpenStreetMap",
        fetchedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    notability: [],
    detourMinutes: null,
  };
}

/**
 * A grounding double: towns by name, finds by town point, and what was asked.
 * `finds` answers the lodging query and `food` the food query (pl-62), which
 * finds nothing unless a case says otherwise.
 */
function grounding(options: {
  towns?: Record<string, Coordinates | "refused" | "throws">;
  finds?: (request: NearbyPointRequest) => Promise<GroundingOutcome<Find[]>>;
  food?: (request: NearbyPointRequest) => Promise<GroundingOutcome<Find[]>>;
}): RunGrounding & { asked: NearbyPointRequest[]; located: string[] } {
  const asked: NearbyPointRequest[] = [];
  const located: string[] = [];
  return {
    name: "test",
    refused: 0,
    asked,
    located,
    locate: async (request) => {
      located.push(request.place.name);
      const town = options.towns?.[request.place.name];
      if (town === "refused") return REFUSED;
      if (town === "throws") throw new AppError("UNREACHABLE");
      if (town === undefined) return UNKNOWN;
      return answered({
        coordinates: town,
        source: {
          url: "https://fixtures.invalid",
          title: null,
          fetchedAt: "2027-01-01T00:00:00.000Z",
        },
      });
    },
    travel: async (request) => request.origins.map(() => request.destinations.map(() => UNKNOWN)),
    nearby: async () => answered([]),
    nearbyPoint: async (request) => {
      asked.push(request);
      const answer = request.kinds === FOOD_KINDS ? options.food : options.finds;
      return answer === undefined ? answered([]) : await answer(request);
    },
    articlesNear: async () => answered([]),
  };
}

function lodgingFor(brief: TripBrief, provider: RunGrounding): ReturnType<typeof discoverLodging> {
  return discoverLodging({
    brief,
    provider,
    trip: undefined,
    logger: silent,
    signal: new AbortController().signal,
    onStep: () => {},
  });
}

/** The food query's note for towns with nowhere to eat on the map (pl-62). */
const NO_FOOD = (towns: string): string =>
  `No places to eat around ${towns} are on the map. Somewhere to eat there may exist without this plan having found it.`;

/** `road-trip.json` with its stops and destination replaced. */
function roadTrip(mustSee: string[], destination: string | null): TripBrief {
  const brief = loadFixture("road-trip").brief;
  if (brief.details?.shape !== "road-trip") throw new Error("road-trip fixture is not a road trip");
  return {
    ...brief,
    destination:
      destination === null ? { state: "declined" } : { state: "answered", value: destination },
    details: { ...brief.details, mustSee: { state: "answered", value: mustSee } },
  };
}

describe("which towns the pass asks about", () => {
  test("the six set A briefs: stops first, then the destination, never the origin", () => {
    const towns = Object.fromEntries(
      TRIP_SHAPES.map((shape) => [shape, lodgingTowns(loadFixture(shape).brief)]),
    );

    expect(towns).toEqual({
      "road-trip": ["Percé Rock", "Forillon National Park", "Gaspésie"],
      backcountry: ["Parc national de la Gaspésie"],
      "motorised-touring": [],
      "city-and-culture": ["Rome"],
      resort: [],
      "multi-city": ["Vienna", "Ljubljana", "Trieste", "Central Europe"],
    });
  });

  test("a name given twice is asked once, and no more than four are asked", () => {
    expect(lodgingTowns(roadTrip(["Percé", " percé ", "Gaspé"], "Gaspé"))).toEqual([
      "Percé",
      "Gaspé",
    ]);
    expect(lodgingTowns(roadTrip(["A", "B", "C", "D", "E"], "F"))).toHaveLength(MAX_LODGING_TOWNS);
  });
});

describe("what the pass finds and says", () => {
  test("asks each located town at 10 km for the lodging kinds, and keeps the closest ten", async () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      sleepFind(
        `Motel ${String(index)}`,
        { latitude: GASPE.latitude + index * 0.001, longitude: GASPE.longitude },
        index,
      ),
    );
    const provider = grounding({
      towns: { Gaspé: GASPE },
      finds: async () => answered([...many].toReversed()),
    });

    const result = await lodgingFor(roadTrip(["Gaspé"], null), provider);

    // The lodging query, then the food query beside it (pl-62).
    expect(provider.asked).toEqual([
      {
        point: GASPE,
        radiusMetres: LODGING_RADIUS_METRES,
        kinds: LODGING_KINDS,
        signal: expect.any(AbortSignal),
      },
      {
        point: GASPE,
        radiusMetres: FOOD_RADIUS_METRES,
        kinds: FOOD_KINDS,
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(LODGING_RADIUS_METRES).toBe(10_000);
    expect(result.finds.map((find) => find.name)).toEqual(
      many.slice(0, MAX_LODGING_FINDS_PER_TOWN).map((find) => find.name),
    );
    expect(result.coverage.map((entry) => entry.detail)).toEqual([NO_FOOD("Gaspé")]);
  });

  test("a premises two towns both reach is handed over once", async () => {
    const shared = sleepFind("Motel du Rocher", PERCE, 9);
    const provider = grounding({
      towns: { Percé: PERCE, "Percé Rock": PERCE },
      finds: async () => answered([shared]),
    });

    const result = await lodgingFor(roadTrip(["Percé Rock"], "Percé"), provider);

    expect(result.finds).toEqual([shared]);
    // Two towns, each asked for places to sleep and places to eat (pl-62).
    expect(provider.asked).toHaveLength(4);
  });

  test("names each town by what happened to it, one sentence per outcome", async () => {
    const provider = grounding({
      towns: { Gaspé: GASPE, Percé: PERCE, Amqui: "refused", Matane: "throws" },
      finds: async (request) => (request.point === PERCE ? REFUSED : answered([])),
    });

    const result = await lodgingFor(roadTrip(["Gaspé", "Percé", "Amqui"], "Matane"), provider);

    expect(result.finds).toEqual([]);
    // Percé's lodging query was refused and its food query was not; the budget
    // refused Amqui's locate, so neither of its queries was made (pl-62).
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "Where Matane is could not be found on the map, so places to stay and places to eat there were not checked.",
      "No places to stay around Gaspé are on the map. Somewhere to stay there may exist without this plan having found it.",
      "Places to stay around Percé and Amqui were never looked up: the run had already used the number of lookups it is allowed.",
      NO_FOOD("Gaspé and Percé"),
      "Places to eat around Amqui were never looked up: the run had already used the number of lookups it is allowed.",
    ]);
  });

  test("a town query that fails is a town with nothing found, not a failed run", async () => {
    const provider = grounding({
      towns: { Gaspé: GASPE },
      finds: async () => {
        throw new AppError("UNREACHABLE", undefined, { details: { status: 406 } });
      },
    });

    const result = await lodgingFor(roadTrip(["Gaspé"], null), provider);

    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "No places to stay around Gaspé are on the map. Somewhere to stay there may exist without this plan having found it.",
      NO_FOOD("Gaspé"),
    ]);
  });

  test("a trip that names no town says so, and asks nothing", async () => {
    const provider = grounding({});
    const result = await lodgingFor(roadTrip([], null), provider);

    expect(provider.located).toEqual([]);
    expect(provider.asked).toEqual([]);
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "This trip names no town to stay in, so the map was not checked for places to stay or to eat.",
    ]);
  });

  test("a long town name is cut, so the note stays inside the contract's bound", async () => {
    const long = "A".repeat(500);
    const provider = grounding({});
    const result = await lodgingFor(
      roadTrip([long, `${long}B`, `${long}C`, `${long}D`], null),
      provider,
    );

    expect(result.coverage).toHaveLength(1);
    for (const entry of result.coverage) {
      expect(uncheckedConstraintSchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("discover: both passes as one (pl-60)", () => {
  test("the corridor's finds then the towns', one progress count over both, and both passes' notes", async () => {
    const motel = sleepFind("Motel Fleur de Lys", PERCE, 3);
    const provider = grounding({
      towns: {
        "Montréal, Québec": { latitude: 45.5, longitude: -73.57 },
        Gaspésie: GASPE,
        "Percé Rock": PERCE,
      },
      finds: async (request) => answered(request.point === PERCE ? [motel] : []),
    });
    const frames: RunProgress[] = [];

    const result = await discover({
      brief: roadTrip(["Percé Rock"], "Gaspésie"),
      provider,
      logger: silent,
      signal: new AbortController().signal,
      onProgress: (frame) => frames.push(frame),
    });

    expect(result.finds).toEqual([motel]);
    // The corridor found nothing and says so; Gaspésie had nothing to sleep in,
    // and neither town had anywhere to eat (pl-62).
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "There is very little on the map along this route. Something worth stopping for may exist without this plan ever finding it.",
      "No places to stay around Gaspésie are on the map. Somewhere to stay there may exist without this plan having found it.",
      NO_FOOD("Percé Rock and Gaspésie"),
    ]);
    // Four corridor steps and three per town, counted once and never backwards.
    const grounded = frames.filter((frame) => frame.type === "grounding");
    expect(grounded.map((frame) => frame.total)).toEqual(grounded.map(() => 10));
    expect(grounded.map((frame) => (frame.type === "grounding" ? frame.done : -1))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // The destination was located once, by the corridor pass; the town pass
    // asked the cache-less double again, which a real run's cache answers.
    expect(provider.located.filter((name) => name === "Gaspésie")).toHaveLength(2);
  });

  test("a brief with towns and no corridor still runs the town pass", async () => {
    const provider = grounding({ towns: { "Percé Rock": PERCE } });
    const result = await discover({
      brief: roadTrip(["Percé Rock"], null),
      provider,
      logger: silent,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(provider.asked.map((request) => request.point)).toEqual([PERCE, PERCE]);
    expect(result.reading).toEqual([]);
  });
});

describe("gate 1's findings on the town pass (pl-60, round 1)", () => {
  test("towns past the cap are named, so a stop the pass never asked about is not silent", async () => {
    const provider = grounding({
      towns: { S1: GASPE, S2: PERCE, S3: GASPE, S4: PERCE },
      finds: async (request) =>
        answered([sleepFind(`Motel at ${String(request.point.latitude)}`, request.point, 1)]),
    });

    const result = await lodgingFor(
      roadTrip(["S1", "S2", "S3", "S4", "S5", "S6"], "Dest"),
      provider,
    );

    expect(provider.located).toEqual(["S1", "S2", "S3", "S4"]);
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "Places to stay and places to eat around S5, S6 and Dest were not looked up: this plan asks about at most 4 towns, the stops it names first.",
      NO_FOOD("S1, S2, S3 and S4"),
    ]);
  });

  test("twenty towns past the cap are counted rather than listed, inside the contract's bound", async () => {
    const stops = Array.from(
      { length: 20 },
      (_, index) => `${"Saint-".repeat(12)}${String(index)}`,
    );
    const result = await lodgingFor(roadTrip(stops, "Dest"), grounding({}));
    const overflow = result.coverage.at(-1);

    expect(overflow?.detail).toContain("and 13 more were not looked up");
    expect(uncheckedConstraintSchema.safeParse(overflow).success).toBe(true);
  });

  test("a town whose finds were all handed over for an earlier town is not reported as having none", async () => {
    const shared = sleepFind("Motel du Rocher", PERCE, 9);
    const provider = grounding({
      towns: { Percé: PERCE, "Percé, Québec": PERCE },
      finds: async () => answered([shared]),
    });

    const result = await lodgingFor(roadTrip(["Percé", "Percé, Québec"], null), provider);

    expect(result.finds).toEqual([shared]);
    // Only the food query's note: neither town had anywhere to eat (pl-62).
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      NO_FOOD("Percé and Percé, Québec"),
    ]);
  });

  test("two finds with no element url are two finds, not one, even across towns", async () => {
    const unlinked = (name: string, at: Coordinates): Find => ({
      ...sleepFind(name, at, 0),
      sources: [
        {
          url: "https://www.openstreetmap.org/copyright",
          title: "OpenStreetMap",
          fetchedAt: "2027-01-01T00:00:00.000Z",
        },
      ],
    });
    const provider = grounding({
      towns: { Gaspé: GASPE, Percé: PERCE },
      finds: async (request) =>
        answered([
          request.point === GASPE
            ? unlinked("Motel du Havre", GASPE)
            : unlinked("Motel du Rocher", PERCE),
        ]),
    });

    const result = await lodgingFor(roadTrip(["Gaspé", "Percé"], null), provider);

    expect(result.finds.map((find) => find.name)).toEqual(["Motel du Havre", "Motel du Rocher"]);
  });

  test("over the real cache and budget, the pass claims at most 12 calls however many towns a brief names", async () => {
    const database = new Database(":memory:");
    migrate(database);
    try {
      const inner = new FixtureGroundingProvider(() => new Date("2027-01-01T00:00:00.000Z"));
      const everywhere: GroundingProvider = {
        name: "everywhere",
        locate: async () => ({
          coordinates: GASPE,
          source: {
            url: "https://fixtures.invalid",
            title: null,
            fetchedAt: "2027-01-01T00:00:00.000Z",
          },
        }),
        travel: async (request) => await inner.travel(request),
        nearby: async (request) => await inner.nearby(request),
        nearbyPoint: async (request) => await inner.nearbyPoint(request),
        articlesNear: async (request) => await inner.articlesNear(request),
      };
      const cache = new CachingGroundingProvider({
        db: database,
        inner: everywhere,
        ttlHours: { locate: 24, travel: 12 },
        now: () => new Date("2027-01-01T00:00:00.000Z"),
      });
      const budget = groundingBudget(40);

      await lodgingFor(
        roadTrip(["S1", "S2", "S3", "S4", "S5", "S6"], "Dest"),
        groundingForRun(cache, budget),
      );

      // A `locate` and two town queries per town since pl-62: 12 of the run's 40.
      expect(40 - budget.remaining()).toBe(3 * MAX_LODGING_TOWNS);
    } finally {
      database.close();
    }
  });
});

describe("the town pass, when the backend refuses (pl-61)", () => {
  test("a 406 from the geocoder and from Overpass reaches each town-pass warn with its status", async () => {
    const warnings: { message: string; fields: Record<string, unknown> | undefined }[] = [];
    const spy: AppLogger = {
      debug: () => {},
      info: () => {},
      warn: (message, fields) => {
        warnings.push({ message, fields });
      },
      error: () => {},
      child: () => spy,
    };
    // One stub, both refusals: Percé's geocoder query is refused (the locate
    // warn), Gaspé is found and its Overpass query is refused (the query warn).
    const valhalla = new ValhallaGroundingProvider({
      routingUrl: "http://valhalla.internal:8002",
      geocoderUrl: "http://nominatim.internal:8080",
      overpassUrl: "http://overpass.internal:8090",
      timeoutMs: 5_000,
      now: () => new Date("2027-01-01T00:00:00.000Z"),
      fetch: (async (input: unknown) => {
        const url = new URL(String(input));
        if (url.origin === "http://overpass.internal:8090") {
          return new Response("refused", { status: 406 });
        }
        if (url.searchParams.get("q") === "Percé") {
          return new Response("refused", { status: 406 });
        }
        return new Response(
          JSON.stringify([
            { lat: "48.8317", lon: "-64.4838", display_name: "Gaspé, Québec", addresstype: "town" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof globalThis.fetch,
    });

    const result = await discoverLodging({
      brief: roadTrip(["Percé", "Gaspé"], null),
      provider: overValhalla(valhalla),
      trip: undefined,
      logger: spy,
      signal: new AbortController().signal,
      onStep: () => {},
    });

    expect(result.finds).toEqual([]);
    const located = warnings.filter(
      (entry) => entry.message === "the town pass could not locate a town",
    );
    const queried = warnings.filter(
      (entry) => entry.message === "the town pass could not query a town",
    );
    expect(located).toHaveLength(1);
    expect(located[0]?.fields).toMatchObject({ code: "UNREACHABLE", status: 406 });
    expect(queried).toHaveLength(1);
    expect(queried[0]?.fields).toMatchObject({ code: "UNREACHABLE", status: 406 });
  });
});

/** A `RunGrounding` over a real `ValhallaGroundingProvider`, so its refusals reach the pass. */
function overValhalla(valhalla: ValhallaGroundingProvider): RunGrounding {
  return {
    name: "valhalla",
    refused: 0,
    locate: async (request) => {
      const located = await valhalla.locate(request);
      return located === null ? UNKNOWN : answered(located);
    },
    nearby: async () => answered([]),
    nearbyPoint: async (request) => answered(await valhalla.nearbyPoint(request)),
    travel: async (request) => request.origins.map(() => request.destinations.map(() => UNKNOWN)),
    articlesNear: async () => answered([]),
  };
}
