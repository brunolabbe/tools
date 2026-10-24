/**
 * The town pass's food query (pl-62) on its own: which finds `food` is handed,
 * and which notes the plan carries, driven through `discoverLodging` against a
 * `RunGrounding` double. `lodging-pass.test.ts` holds the lodging cases and
 * what the food query added to them; `lodging-run.test.ts` runs both in a real
 * run for the six set A briefs.
 */

import { describe, expect, test } from "vitest";
import type { Coordinates, TripBrief } from "@planner/contract";
import { AppError } from "@planner/contract";
import { FOOD_KINDS, LODGING_KINDS } from "@planner/agent";
import type { Find, FoodKind, NearbyPointRequest } from "@planner/agent";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  answered,
  REFUSED,
  UNKNOWN,
  type GroundingOutcome,
  type RunGrounding,
} from "../src/grounding/cache.ts";
import type { AppLogger } from "../src/logger.ts";
import {
  discoverLodging,
  FOOD_RADIUS_METRES,
  MAX_FOOD_FINDS_PER_TOWN,
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

function place(name: string, at: Coordinates, id: number, kind: FoodKind | "motel"): Find {
  const tag: [string, string] =
    kind === "motel"
      ? ["tourism", "motel"]
      : kind === "bakery"
        ? ["shop", "bakery"]
        : ["amenity", kind];
  return {
    name,
    coordinates: at,
    kind,
    tags: new Map([tag, ["name", name]]),
    sources: [
      {
        url: `https://www.openstreetmap.org/node/${String(id)}`,
        title: "OpenStreetMap",
        fetchedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    notability: [],
    detourMinutes: null,
  };
}

type Answer = (request: NearbyPointRequest) => Promise<GroundingOutcome<Find[]>>;

/** Towns by name; the lodging query answered by `sleep` and the food query by `eat`. */
function grounding(options: {
  towns: Record<string, Coordinates>;
  sleep?: Answer;
  eat?: Answer;
}): RunGrounding & { asked: NearbyPointRequest[] } {
  const asked: NearbyPointRequest[] = [];
  return {
    name: "test",
    refused: 0,
    asked,
    locate: async (request) => {
      const town = options.towns[request.place.name];
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
      const answer = request.kinds === FOOD_KINDS ? options.eat : options.sleep;
      return answer === undefined ? answered([]) : await answer(request);
    },
    articlesNear: async () => answered([]),
  };
}

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

async function townPass(
  brief: TripBrief,
  provider: RunGrounding,
): ReturnType<typeof discoverLodging> {
  return await discoverLodging({
    brief,
    provider,
    trip: undefined,
    logger: silent,
    signal: new AbortController().signal,
    onStep: () => {},
  });
}

const NO_FOOD = (towns: string): string =>
  `No places to eat around ${towns} are on the map. Somewhere to eat there may exist without this plan having found it.`;

describe("the town pass's food query (pl-62)", () => {
  test("asks each located town once more, at 10 km for the food kinds, and keeps the closest ten", async () => {
    const many = Array.from({ length: 17 }, (_, index) =>
      place(
        `Café ${String(index)}`,
        { latitude: GASPE.latitude + index * 0.001, longitude: GASPE.longitude },
        100 + index,
        "cafe",
      ),
    );
    const provider = grounding({
      towns: { Gaspé: GASPE },
      eat: async () => answered([...many].toReversed()),
    });

    const result = await townPass(roadTrip(["Gaspé"], null), provider);

    expect(provider.asked.map((request) => [request.kinds, request.radiusMetres])).toEqual([
      [LODGING_KINDS, 10_000],
      [FOOD_KINDS, FOOD_RADIUS_METRES],
    ]);
    expect(FOOD_RADIUS_METRES).toBe(10_000);
    expect(MAX_FOOD_FINDS_PER_TOWN).toBe(10);
    expect(result.finds.map((find) => find.name)).toEqual(
      many.slice(0, MAX_FOOD_FINDS_PER_TOWN).map((find) => find.name),
    );
  });

  test("places to sleep come first in the list and keep their own cap; places to eat follow with theirs", async () => {
    const motels = Array.from({ length: 12 }, (_, index) =>
      place(`Motel ${String(index)}`, PERCE, index, "motel"),
    );
    const meals = Array.from({ length: 12 }, (_, index) =>
      place(`Resto ${String(index)}`, PERCE, 50 + index, "restaurant"),
    );
    const provider = grounding({
      towns: { Percé: PERCE },
      sleep: async () => answered(motels),
      eat: async () => answered(meals),
    });

    const result = await townPass(roadTrip(["Percé"], null), provider);

    expect(result.finds.map((find) => find.kind)).toEqual([
      ...Array.from({ length: 10 }, () => "motel"),
      ...Array.from({ length: 10 }, () => "restaurant"),
    ]);
    expect(result.coverage).toEqual([]);
  });

  test("a place to eat two towns both reach is handed over once, and neither town is reported as having none", async () => {
    const shared = place("Café de la Gare", PERCE, 7, "cafe");
    const provider = grounding({
      towns: { Percé: PERCE, "Percé Rock": PERCE },
      sleep: async () => answered([place("Motel du Rocher", PERCE, 9, "motel")]),
      eat: async () => answered([shared]),
    });

    const result = await townPass(roadTrip(["Percé Rock"], "Percé"), provider);

    expect(result.finds.filter((find) => find.kind === "cafe")).toEqual([shared]);
    expect(result.coverage).toEqual([]);
  });

  test("a food query that fails is a town with nowhere to eat, and the places to sleep are kept", async () => {
    const motel = place("Motel Fleur de Lys", GASPE, 3, "motel");
    const provider = grounding({
      towns: { Gaspé: GASPE },
      sleep: async () => answered([motel]),
      eat: async () => {
        throw new AppError("UNREACHABLE", undefined, { details: { status: 406 } });
      },
    });

    const result = await townPass(roadTrip(["Gaspé"], null), provider);

    expect(result.finds).toEqual([motel]);
    expect(result.coverage.map((entry) => entry.detail)).toEqual([NO_FOOD("Gaspé")]);
  });

  test("a lodging query that fails does not take the places to eat with it", async () => {
    const bakery = place("Boulangerie du Quai", GASPE, 4, "bakery");
    const provider = grounding({
      towns: { Gaspé: GASPE },
      sleep: async () => {
        throw new AppError("TIMEOUT");
      },
      eat: async () => answered([bakery]),
    });

    const result = await townPass(roadTrip(["Gaspé"], null), provider);

    expect(result.finds).toEqual([bakery]);
    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "No places to stay around Gaspé are on the map. Somewhere to stay there may exist without this plan having found it.",
    ]);
  });

  test("a food query the budget refused is named as never looked up, apart from the places to sleep", async () => {
    const provider = grounding({
      towns: { Gaspé: GASPE },
      sleep: async () => answered([place("Motel du Havre", GASPE, 5, "motel")]),
      eat: async () => REFUSED,
    });

    const result = await townPass(roadTrip(["Gaspé"], null), provider);

    expect(result.coverage.map((entry) => entry.detail)).toEqual([
      "Places to eat around Gaspé were never looked up: the run had already used the number of lookups it is allowed.",
    ]);
  });

  test("one element tagged both a place to stay and a place to eat is handed to each reader once, since the two lists are de-duplicated apart", async () => {
    // Overpass answers each query with the element under the kinds it asked
    // for, so the same node/42 comes back as a hotel and as a restaurant.
    // Neither list may drop it because the other already holds it (gate 1).
    const asHotel: Find = {
      ...place("Hôtel-Restaurant du Quai", GASPE, 42, "motel"),
      kind: "hotel",
    };
    const asRestaurant = place("Hôtel-Restaurant du Quai", GASPE, 42, "restaurant");
    const provider = grounding({
      towns: { Gaspé: GASPE },
      sleep: async () => answered([asHotel]),
      eat: async () => answered([asRestaurant]),
    });

    const result = await townPass(roadTrip(["Gaspé"], null), provider);

    expect(result.finds).toEqual([asHotel, asRestaurant]);
    expect(result.coverage).toEqual([]);
  });
});
