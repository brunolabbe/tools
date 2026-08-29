/**
 * The discovery pass, over a brief a run could plausibly draft from.
 *
 * The sibling of `travel-measure.test.ts`: a hand-built `RunGrounding` double
 * drives the pass through every branch — no corridor, both ends located, one
 * end that will not locate, a corridor with nothing on it, a corridor the
 * budget refuses, and a corridor with something to measure a detour against.
 * Nothing here goes near the database or a network socket.
 */

import { describe, expect, test } from "vitest";
import { emptyBrief, slot } from "@planner/contract";
import type { RunProgress, TripBrief } from "@planner/contract";
import type { Find, LocateRequest, NearbyRequest, TravelRequest } from "@planner/agent";
import {
  answered,
  REFUSED,
  UNKNOWN,
  type GroundingOutcome,
  type RunGrounding,
} from "../src/grounding/cache.ts";
import { createLogger } from "../src/logger.ts";
import { discoverAlongCorridor, hasCorridor } from "../src/runs/discovery.ts";

const logger = createLogger({ level: "silent" });

function briefWith(origin: string | null, destination: string | null): TripBrief {
  return {
    ...emptyBrief(),
    origin: origin === null ? slot.declined() : slot.answered(origin),
    destination: destination === null ? slot.declined() : slot.answered(destination),
  };
}

const MONTREAL = { latitude: 45.5019, longitude: -73.5674 };

function find(overrides: Partial<Find> = {}): Find {
  return {
    name: "A lookout over the valley",
    coordinates: { latitude: 46.1, longitude: -72.4 },
    kind: "viewpoint",
    tags: new Map([["tourism", "viewpoint"]]),
    sources: [
      {
        url: "https://www.openstreetmap.org/node/1",
        title: "OpenStreetMap",
        fetchedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    notability: [],
    detourMinutes: null,
    ...overrides,
  };
}

/** A double whose three methods a test configures independently. */
function provider(overrides: {
  locate?: (request: LocateRequest) => Promise<
    GroundingOutcome<{
      coordinates: typeof MONTREAL;
      source: { url: string; title: string | null; fetchedAt: string };
    }>
  >;
  nearby?: (request: NearbyRequest) => Promise<GroundingOutcome<Find[]>>;
  travel?: (
    request: TravelRequest,
  ) => Promise<ReturnType<RunGrounding["travel"]> extends Promise<infer T> ? T : never>;
}): RunGrounding {
  return {
    name: "test",
    refused: 0,
    locate:
      overrides.locate ??
      (async () =>
        answered({
          coordinates: MONTREAL,
          source: {
            url: "https://fixtures.invalid",
            title: null,
            fetchedAt: "2027-01-01T00:00:00.000Z",
          },
        })),
    nearby: overrides.nearby ?? (async () => answered([])),
    travel:
      overrides.travel ??
      (async (request) => request.origins.map(() => request.destinations.map(() => UNKNOWN))),
  };
}

function progressOf(): { events: RunProgress[]; onProgress: (event: RunProgress) => void } {
  const events: RunProgress[] = [];
  return { events, onProgress: (event) => events.push(event) };
}

describe("hasCorridor", () => {
  test("both ends named", () => {
    expect(hasCorridor(briefWith("Montréal", "Percé"))).toBe(true);
  });

  test("a declined destination — 'somewhere warm, you pick' — has no corridor", () => {
    expect(hasCorridor(briefWith("Montréal", null))).toBe(false);
  });

  test("a declined origin has no corridor either", () => {
    expect(hasCorridor(briefWith(null, "Percé"))).toBe(false);
  });
});

describe("discoverAlongCorridor", () => {
  test("no corridor: nothing found, nothing said, no call made", async () => {
    const { events, onProgress } = progressOf();
    let called = false;
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", null),
      provider: provider({
        locate: async () => {
          called = true;
          return answered({
            coordinates: MONTREAL,
            source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
          });
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress,
    });

    expect(result).toEqual({ finds: [], coverage: [] });
    expect(called).toBe(false);
    expect(events).toEqual([]);
  });

  test("an end that will not locate: no finds, a coverage note naming the reason, no nearby call", async () => {
    const { onProgress } = progressOf();
    let nearbyCalled = false;
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Nowhere Nobody Has Heard Of"),
      provider: provider({
        locate: async (request) =>
          request.place.name === "Montréal"
            ? answered({
                coordinates: MONTREAL,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              })
            : UNKNOWN,
        nearby: async () => {
          nearbyCalled = true;
          return answered([]);
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress,
    });

    expect(result.finds).toEqual([]);
    expect(result.coverage).toHaveLength(1);
    expect(result.coverage[0]?.kind).toBe("coverage");
    expect(result.coverage[0]?.detail).toMatch(/could not be found on the map/i);
    expect(nearbyCalled).toBe(false);
  });

  test("a corridor with nothing on it: empty finds, one coverage note naming the ground as thin", async () => {
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({ nearby: async () => answered([]) }),
      logger,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(result.finds).toEqual([]);
    expect(result.coverage).toEqual([
      {
        kind: "coverage",
        detail: expect.stringMatching(/very little on the map/i) as unknown as string,
        candidateIds: [],
      },
    ]);
  });

  test("a corridor the budget refused: empty finds, a coverage note naming the budget", async () => {
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({ nearby: async () => REFUSED }),
      logger,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(result.finds).toEqual([]);
    expect(result.coverage[0]?.detail).toMatch(/used the number of lookups/i);
  });

  test("a corridor with something on it: finds returned, no coverage note, and a detour cost per find", async () => {
    const only = find();
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({
        nearby: async () => answered([only]),
        // origins = [origin, find], destinations = [destination, find].
        // [0][0] = baseline (origin→destination): 180 min.
        // [0][1] = origin→find: 100 min. [1][0] = find→destination: 90 min.
        // detour = 100 + 90 - 180 = 10 minutes.
        travel: async (request) => {
          void request;
          return [
            [
              answered({
                distanceMeters: 250_000,
                durationMinutes: 180,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              }),
              answered({
                distanceMeters: 140_000,
                durationMinutes: 100,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              }),
            ],
            [
              answered({
                distanceMeters: 130_000,
                durationMinutes: 90,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              }),
              answered({
                distanceMeters: 0,
                durationMinutes: 0,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              }),
            ],
          ];
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(result.coverage).toEqual([]);
    expect(result.finds).toHaveLength(1);
    expect(result.finds[0]?.detourMinutes).toBe(10);
    expect(result.finds[0]?.name).toBe(only.name);
  });

  test("a detour matrix that could not be measured: finds still returned, with a null detour", async () => {
    const only = find();
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({
        nearby: async () => answered([only]),
        travel: async () => {
          throw new Error("the routing service refused the connection");
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(result.finds).toHaveLength(1);
    expect(result.finds[0]?.detourMinutes).toBeNull();
  });

  test("reports four steps, known before the first request goes out", async () => {
    const { events, onProgress } = progressOf();
    await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({ nearby: async () => answered([find()]) }),
      logger,
      signal: new AbortController().signal,
      onProgress,
    });

    for (const event of events) {
      expect(event).toMatchObject({ type: "grounding", total: 4 });
    }
    expect(events.at(-1)).toMatchObject({ done: 4, total: 4 });
  });

  test("a cancellation propagates rather than being swallowed as a plain failure", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      discoverAlongCorridor({
        brief: briefWith("Montréal", "Québec City"),
        provider: provider({
          locate: async () => {
            throw new DOMException("aborted", "AbortError");
          },
        }),
        logger,
        signal: controller.signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow(/aborted/i);
  });
});
