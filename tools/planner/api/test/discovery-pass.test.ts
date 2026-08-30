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
import type {
  Find,
  LocateRequest,
  NearbyArticle,
  NearbyRequest,
  NotabilityRequest,
  TravelRequest,
} from "@planner/agent";
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
  articlesNear?: (request: NotabilityRequest) => Promise<GroundingOutcome<NearbyArticle[]>>;
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
    // pl-33: the notability pass asks only when the finds name a language, so
    // a double that answers nothing here changes nothing for tests about
    // locate, travel and coverage.
    articlesNear: overrides.articlesNear ?? (async () => answered([])),
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

    expect(result).toEqual({ finds: [], coverage: [], reading: [] });
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

  /**
   * Done-when, read literally: "the number of routing calls is asserted".
   * Every other detour test above uses exactly one find, so none of them can
   * tell "one matrix call regardless of find count" apart from "one call per
   * find" — both produce the same result for N=1. This is the test that
   * distinguishes them.
   */
  test("many finds still cost exactly one travel() call, not one per find", async () => {
    const finds = [find({ name: "A" }), find({ name: "B" }), find({ name: "C" })];
    let travelCalls = 0;
    let sizes: { origins: number; destinations: number } | null = null;

    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Québec City"),
      provider: provider({
        nearby: async () => answered(finds),
        travel: async (request) => {
          travelCalls += 1;
          sizes = { origins: request.origins.length, destinations: request.destinations.length };
          // origins/destinations are [endpoint, ...finds] — one row/column per
          // find plus the baseline. Every cell answered with the same minutes
          // so the assertion below is about *shape*, not arithmetic.
          return request.origins.map(() =>
            request.destinations.map(() =>
              answered({
                distanceMeters: 1_000,
                durationMinutes: 1,
                source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
              }),
            ),
          );
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    expect(travelCalls).toBe(1);
    expect(sizes).toEqual({ origins: 4, destinations: 4 }); // [endpoint, A, B, C]
    expect(result.finds).toHaveLength(3);
    expect(result.finds.map((f) => f.detourMinutes)).toEqual([1, 1, 1]);
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

/**
 * The notability pass — pl-33 Build step 2.
 *
 * It lives here and not in `nearby` because a geosearch costs one call *per
 * point* and `nearby` promises to cost one however many finds it returns. What
 * these tests pin is the accounting that follows: the language comes from the
 * corridor's own tags, the tile count is bounded before the budget is
 * consulted, and a refusal stops the pass rather than half-filling it.
 */
describe("discoverAlongCorridor, attaching notability", () => {
  const AT = "2027-01-01T00:00:00.000Z";
  function findAt(
    name: string,
    coordinates: typeof MONTREAL,
    notability: { url: string; title: string | null; fetchedAt: string }[] = [],
  ): Find {
    return {
      name,
      coordinates,
      kind: "viewpoint",
      tags: new Map(),
      sources: [
        { url: "https://www.openstreetmap.org/node/1", title: "OpenStreetMap", fetchedAt: AT },
      ],
      notability,
      detourMinutes: null,
    };
  }

  const TAGGED_FR = {
    url: "https://fr.wikipedia.org/wiki/Quelque_chose",
    title: "Quelque chose",
    fetchedAt: AT,
  };

  test("asks the language the corridor's own finds already name", async () => {
    const asked: string[] = [];
    await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () =>
          answered([
            findAt("Belvédère", MONTREAL, [TAGGED_FR]),
            findAt("Autre", MONTREAL, [TAGGED_FR]),
            findAt("Cenotaph", MONTREAL, [
              { url: "https://en.wikipedia.org/wiki/Cenotaph", title: "Cenotaph", fetchedAt: AT },
            ]),
          ]),
        articlesNear: async (request) => {
          asked.push(request.language);
          return answered([]);
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    // Two `fr:` tags against one `en:`, so French — counted from what the
    // mappers wrote, not configured and not derived from a country. Every tile
    // asks the same edition.
    expect(new Set(asked)).toEqual(new Set(["fr"]));
    expect(asked.length).toBeGreaterThan(0);
  });

  test("a find with no language named anywhere is never asked about", async () => {
    let called = 0;
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Unnamed viewpoint", MONTREAL)]),
        articlesNear: async () => {
          called += 1;
          return answered([]);
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    // Nothing states a language, so nothing is guessed and no call is spent.
    expect(called).toBe(0);
    expect(result.finds[0]?.notability).toEqual([]);
  });

  test("stops the moment the budget refuses, rather than half-filling", async () => {
    let calls = 0;
    await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Belvédère", MONTREAL, [TAGGED_FR])]),
        articlesNear: async () => {
          calls += 1;
          return REFUSED;
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    // Two, and the number is the point: each pass stops at its *own* first
    // refusal rather than carrying on through its remaining tiles. The
    // notability tiling gives up after one, and the corridor-reading pass then
    // asks once and gives up too. A refused call is not a spent one, so this
    // costs the budget nothing — what it proves is that neither pass grinds
    // through a list it has already been told it cannot afford.
    expect(calls).toBe(2);
  });

  test("a wikivoyage entry rides on the plan, never on a find", async () => {
    // pl-33's measurement: Wikivoyage returns 2 English and 7 French articles
    // for an entire city, all of them *about the city*. Attaching one to a
    // viewpoint inside it would assert a relationship the source does not
    // have, so it lands on the revision instead — even though this one sits
    // exactly on top of the find.
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Belvédère", MONTREAL, [TAGGED_FR])]),
        articlesNear: async (request) =>
          answered(
            request.site === "wikivoyage"
              ? [
                  {
                    source: {
                      url: "https://fr.wikivoyage.org/wiki/Montr%C3%A9al",
                      title: "Montréal",
                      fetchedAt: AT,
                    },
                    coordinates: MONTREAL,
                  },
                ]
              : [],
          ),
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    expect(result.reading.map((source) => source.url)).toEqual([
      "https://fr.wikivoyage.org/wiki/Montr%C3%A9al",
    ]);
    // Same coordinates as the find, and still not attached to it.
    expect(result.finds[0]?.notability.map((source) => source.url)).toEqual([TAGGED_FR.url]);
  });

  test("asks wikivoyage in the same language the corridor named", async () => {
    const sites: string[] = [];
    await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Belvédère", MONTREAL, [TAGGED_FR])]),
        articlesNear: async (request) => {
          sites.push(`${request.site ?? "wikipedia"}:${request.language}`);
          return answered([]);
        },
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    // Both projects, one language, counted from the corridor's own tags.
    expect(sites).toContain("wikivoyage:fr");
    expect(sites).toContain("wikipedia:fr");
    expect(sites.every((entry) => entry.endsWith(":fr"))).toBe(true);
  });

  test("notability spends first, so a tight budget costs the detour and not the find", async () => {
    // pl-33's gate raised this as an ordering nobody had written down: the two
    // notability passes now run *before* `detourCosts`, where `detourCosts`
    // used to be the only consumer after `nearby`. Up to 8 calls (6 tiles plus
    // 2 corridor ends) can go first, so on a corridor whose budget is tight
    // the thing that loses is detour costing.
    //
    // That is the right way round and this pins it rather than leaving it to
    // be rediscovered: a find with no detour measured is still a find, and
    // says so with `detourMinutes: null` — the same "nobody measured this"
    // §5 asks for everywhere else. A find with no notability that was never
    // asked about is indistinguishable from one nobody wrote about, which is
    // the weaker outcome of the two.
    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Belvédère", MONTREAL, [TAGGED_FR])]),
        articlesNear: async () =>
          answered([
            {
              source: {
                url: "https://fr.wikipedia.org/wiki/Proche",
                title: "Proche",
                fetchedAt: AT,
              },
              coordinates: MONTREAL,
            },
          ]),
        // The budget is gone by the time the matrix is asked for.
        travel: async (request) =>
          request.origins.map(() => request.destinations.map(() => REFUSED)),
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    expect(result.finds).toHaveLength(1);
    // Never faked, and never dropped: the find survives with its backing.
    expect(result.finds[0]?.detourMinutes).toBeNull();
    expect(result.finds[0]?.notability.map((source) => source.url)).toContain(
      "https://fr.wikipedia.org/wiki/Proche",
    );
  });

  test("attaches an article near a find, and leaves a distant one alone", async () => {
    const near = { latitude: MONTREAL.latitude + 0.001, longitude: MONTREAL.longitude };
    const far = { latitude: MONTREAL.latitude + 0.05, longitude: MONTREAL.longitude };

    const result = await discoverAlongCorridor({
      brief: briefWith("Montréal", "Percé"),
      provider: provider({
        nearby: async () => answered([findAt("Belvédère", MONTREAL, [TAGGED_FR])]),
        articlesNear: async () =>
          answered([
            {
              source: {
                url: "https://fr.wikipedia.org/wiki/Proche",
                title: "Proche",
                fetchedAt: AT,
              },
              coordinates: near,
            },
            {
              source: { url: "https://fr.wikipedia.org/wiki/Loin", title: "Loin", fetchedAt: AT },
              coordinates: far,
            },
          ]),
      }),
      logger,
      signal: new AbortController().signal,
      onProgress: progressOf().onProgress,
    });

    const urls = result.finds[0]?.notability.map((source) => source.url) ?? [];
    // ~111 m away: the same thing. ~5.5 km away: a different thing entirely,
    // and attaching it would be the fusion §5's amendment refuses.
    expect(urls).toContain("https://fr.wikipedia.org/wiki/Proche");
    expect(urls).not.toContain("https://fr.wikipedia.org/wiki/Loin");
    // The tag the map already carried is still first and is not duplicated.
    expect(urls[0]).toBe(TAGGED_FR.url);
  });
});
