/**
 * The grounding cache.
 *
 * Four things are worth more than the rest of this file put together, and each
 * has a test named after it:
 *
 * - two identical questions cost one call, asserted by counting, never by
 *   timing;
 * - a hit carries the *original* `fetchedAt`, asserted with a clock that moved
 *   between the write and the read;
 * - a hit does not spend the run's grounding budget, and a miss does;
 * - a question named `constructor` misses like any other unknown one.
 *
 * The provider behind the cache is a counting fake rather than the fixture
 * provider, because the fixture provider's `Source.fetchedAt` is frozen at the
 * date its table was written — which is exactly the value the third assertion
 * has to see change.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { groundingBudget } from "@planner/agent";
import type {
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import type { Place, Source } from "@planner/contract";
import type { GroundingCacheTtlHours } from "../src/config.ts";
import { countGrounding, upsertGrounding } from "../src/db/grounding-cache.ts";
import { migrate } from "../src/db/schema.ts";
import { createApp } from "../src/index.ts";
import {
  CachingGroundingProvider,
  evictExpiredGrounding,
  groundingForRun,
  locateKey,
  travelKey,
} from "../src/grounding/cache.ts";
import {
  createRunHarness,
  intakeReadyToDraft,
  runToCompletion,
  startRunOver,
} from "./helpers/runs.ts";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

/** As a candidate names one. Coordinates null — that is what `locate` is for. */
function place(name: string, locality: string | null = null): Place {
  return { name, locality, coordinates: null };
}

/** A clock a test moves by hand, so nothing here waits for anything. */
class Clock {
  #at: number;

  constructor(iso: string) {
    this.#at = Date.parse(iso);
  }

  now = (): Date => new Date(this.#at);

  advanceHours(hours: number): void {
    this.#at += hours * 3_600_000;
  }
}

/**
 * The provider behind the cache: it counts, and it stamps every answer with the
 * clock, so a cached `fetchedAt` is distinguishable from a fresh one.
 *
 * It knows two places and one leg. Everything else is `null`, which is the
 * seam's word for "nobody established it" and is deliberately the answer this
 * cache does not keep.
 */
class CountingProvider implements GroundingProvider {
  readonly name = "counting";
  locates = 0;
  travels = 0;
  /** The shape of each matrix it was asked for, so a test can see the narrowing. */
  readonly travelSizes: { origins: number; destinations: number }[] = [];

  readonly #clock: Clock;
  readonly #known: ReadonlySet<string>;

  constructor(clock: Clock, known: readonly string[] = ["rimouski", "québec city"]) {
    this.#clock = clock;
    this.#known = new Set(known);
  }

  #source(what: string): Source {
    return {
      url: `https://fixtures.invalid/counting/${what}`,
      title: "A counting fake, not a measurement",
      fetchedAt: this.#clock.now().toISOString(),
    };
  }

  #knows(candidate: Place): boolean {
    return this.#known.has(candidate.name.trim().toLowerCase());
  }

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    this.locates += 1;
    if (!this.#knows(request.place)) return null;
    return {
      coordinates: { latitude: 48.45, longitude: -68.52 },
      source: this.#source("place"),
    };
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    this.travels += 1;
    this.travelSizes.push({
      origins: request.origins.length,
      destinations: request.destinations.length,
    });
    return request.origins.map((from) =>
      request.destinations.map((to) =>
        this.#knows(from) && this.#knows(to)
          ? {
              distanceMeters: 300_000,
              durationMinutes: 180,
              source: this.#source("leg"),
            }
          : null,
      ),
    );
  }
}

const TTL: GroundingCacheTtlHours = { locate: 24, travel: 12 };

function build(
  clock: Clock,
  options: { ttlHours?: GroundingCacheTtlHours; known?: readonly string[] } = {},
): { cache: CachingGroundingProvider; inner: CountingProvider; database: Database.Database } {
  const database = new Database(":memory:");
  migrate(database);
  db = database;

  const inner =
    options.known === undefined
      ? new CountingProvider(clock)
      : new CountingProvider(clock, options.known);
  const cache = new CachingGroundingProvider({
    db: database,
    inner,
    ttlHours: options.ttlHours ?? TTL,
    now: clock.now,
  });
  return { cache, inner, database };
}

describe("the grounding cache", () => {
  test("reports the backend's name, because a cache is not a thing to ground against", () => {
    const { cache } = build(new Clock("2026-08-22T09:00:00.000Z"));
    expect(cache.name).toBe("counting");
  });

  describe("a second identical question", () => {
    test("costs one `locate` call, not two", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);

      const first = await cache.locate({ place: place("Rimouski") });
      const second = await cache.locate({ place: place("Rimouski") });

      expect(inner.locates).toBe(1);
      expect(second).toEqual(first);
    });

    test("costs one `travel` call, not two", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const request = {
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      } as const;

      const first = await cache.travel(request);
      const second = await cache.travel(request);

      expect(inner.travels).toBe(1);
      expect(second).toEqual(first);
      expect(second[0]?.[0]?.durationMinutes).toBe(180);
    });

    test("asks only for the cells it is missing, and one call covers them", async () => {
      // The half of the matrix argument the cache adds: a revision that adds
      // one stop re-asks a table it mostly already holds, and paying for the
      // whole thing again is the cost §5 says makes revision unaffordable.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, { known: ["a", "b", "c"] });

      await cache.travel({
        origins: [place("A")],
        destinations: [place("B")],
        mode: "driving",
      });
      const wider = await cache.travel({
        origins: [place("A")],
        destinations: [place("B"), place("C")],
        mode: "driving",
      });

      // Two calls, and the second asked for one cell rather than two: A→B was
      // already held, so only its column was missing.
      expect(inner.travels).toBe(2);
      expect(inner.travelSizes).toEqual([
        { origins: 1, destinations: 1 },
        { origins: 1, destinations: 1 },
      ]);
      expect(wider[0]?.[0]).not.toBeNull();
      expect(wider[0]?.[1]).not.toBeNull();
    });

    test("a matrix it holds in full costs no call at all", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, { known: ["a", "b"] });
      const request = {
        origins: [place("A"), place("B")],
        destinations: [place("A"), place("B")],
        mode: "driving",
      } as const;

      const first = await cache.travel(request);
      const second = await cache.travel(request);

      expect(inner.travels).toBe(1);
      expect(second).toEqual(first);
    });
  });

  describe("what a hit says about itself", () => {
    test("carries the original fetch time, not the time it was served", async () => {
      // The sharpest trap in the ticket. `Source.fetchedAt` is what decides
      // whether a fact may still be shown, so a hit stamped with `now()` makes
      // every cached fact claim to be fresh and the TTL decorative.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock);

      const fresh = await cache.locate({ place: place("Rimouski") });
      clock.advanceHours(5);
      const served = await cache.locate({ place: place("Rimouski") });

      expect(fresh?.source.fetchedAt).toBe("2026-08-22T09:00:00.000Z");
      expect(served?.source.fetchedAt).toBe("2026-08-22T09:00:00.000Z");
      expect(served?.source.fetchedAt).not.toBe(clock.now().toISOString());
    });

    test("carries the original fetch time through a `travel` cell too", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock);
      const request = {
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      } as const;

      await cache.travel(request);
      clock.advanceHours(5);
      const served = await cache.travel(request);

      expect(served[0]?.[0]?.source.fetchedAt).toBe("2026-08-22T09:00:00.000Z");
    });
  });

  describe("expiry", () => {
    test("does not serve a row that has aged out", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, { ttlHours: { locate: 1, travel: 1 } });

      await cache.locate({ place: place("Rimouski") });
      clock.advanceHours(2);
      await cache.locate({ place: place("Rimouski") });

      expect(inner.locates).toBe(2);
    });

    test("keeps a row that has not", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, { ttlHours: { locate: 6, travel: 6 } });

      await cache.locate({ place: place("Rimouski") });
      clock.advanceHours(2);
      await cache.locate({ place: place("Rimouski") });

      expect(inner.locates).toBe(1);
    });

    test("varies by kind: the same clock outlives one TTL and not the other", async () => {
      // The title of the ticket. One number for both would either re-measure
      // every road every week or serve a fact long after it stopped being one.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, { ttlHours: { locate: 48, travel: 1 } });
      const request = {
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      } as const;

      await cache.locate({ place: place("Rimouski") });
      await cache.travel(request);
      clock.advanceHours(6);
      await cache.locate({ place: place("Rimouski") });
      await cache.travel(request);

      expect(inner.locates).toBe(1);
      expect(inner.travels).toBe(2);
    });

    test("an expired row is gone once eviction runs", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, database } = build(clock, { ttlHours: { locate: 1, travel: 1 } });

      await cache.locate({ place: place("Rimouski") });
      expect(countGrounding(database)).toBe(1);

      clock.advanceHours(2);
      expect(evictExpiredGrounding(database, clock.now())).toBe(1);
      expect(countGrounding(database)).toBe(0);
    });

    test("eviction leaves what is still good alone", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, database } = build(clock, { ttlHours: { locate: 48, travel: 1 } });

      await cache.locate({ place: place("Rimouski") });
      await cache.travel({
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      });
      expect(countGrounding(database)).toBe(2);

      clock.advanceHours(6);
      expect(evictExpiredGrounding(database, clock.now())).toBe(1);
      expect(countGrounding(database)).toBe(1);
    });

    test("a TTL of zero writes nothing, which is how a deployment turns it off", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner, database } = build(clock, { ttlHours: { locate: 0, travel: 0 } });

      await cache.locate({ place: place("Rimouski") });
      await cache.locate({ place: place("Rimouski") });

      expect(inner.locates).toBe(2);
      expect(countGrounding(database)).toBe(0);
    });
  });

  describe("the run's budget", () => {
    test("a miss spends a call and a hit does not", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const budget = groundingBudget(4);
      const run = groundingForRun(cache, budget);

      await run.locate({ place: place("Rimouski") });
      expect(budget.remaining()).toBe(3);

      await run.locate({ place: place("Rimouski") });
      expect(budget.remaining()).toBe(3);
      expect(inner.locates).toBe(1);
      expect(run.refused).toBe(0);
    });

    test("a run out of budget makes no call, and says so rather than answering null", async () => {
      // A refusal is not a `null` that means "nobody knows" — it is a `PlanGap`
      // in front of the user, which is why it is counted rather than swallowed.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const run = groundingForRun(cache, groundingBudget(1));

      await run.locate({ place: place("Rimouski") });
      const refused = await run.locate({ place: place("Québec City") });

      expect(inner.locates).toBe(1);
      expect(refused).toBeNull();
      expect(run.refused).toBe(1);
    });

    test("a hit still answers once the budget is spent, because it costs nothing", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock);
      const run = groundingForRun(cache, groundingBudget(1));

      const first = await run.locate({ place: place("Rimouski") });
      await run.locate({ place: place("Québec City") }); // spends nothing; refused
      const again = await run.locate({ place: place("Rimouski") });

      expect(again).toEqual(first);
      expect(run.refused).toBe(1);
    });

    test("without a cache in the way, every lookup is a call", async () => {
      // `groundingForRun` is one entry point whether or not a cache is present,
      // so the rule reaches the same answer either way rather than depending on
      // how the app happened to be assembled.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const inner = new CountingProvider(clock);
      const budget = groundingBudget(2);
      const run = groundingForRun(inner, budget);

      await run.locate({ place: place("Rimouski") });
      await run.locate({ place: place("Rimouski") });

      expect(inner.locates).toBe(2);
      expect(budget.remaining()).toBe(0);
    });
  });

  describe("questions that are not questions", () => {
    test.each(["constructor", "__proto__", "toString", "valueOf"])(
      "%s misses like any other unknown place",
      async (name) => {
        // pl-24 found this the expensive way: its gazetteer was a plain object,
        // and `{}["constructor"]` is a function rather than `undefined`, so a
        // place called "Constructor" came back located and its leg came back
        // measured at zero. Every index over a model-written key here is a
        // `Map` or a SQLite row.
        const clock = new Clock("2026-08-22T09:00:00.000Z");
        const { cache, database } = build(clock);

        await expect(cache.locate({ place: place(name) })).resolves.toBeNull();
        const matrix = await cache.travel({
          origins: [place(name)],
          destinations: [place(name)],
          mode: "driving",
        });

        expect(matrix[0]?.[0]).toBeNull();
        expect(countGrounding(database)).toBe(0);
      },
    );

    test("a `null` is not stored, so nothing can be served as an answer nobody gave", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner, database } = build(clock);

      await cache.locate({ place: place("Chibougamau") });
      await cache.locate({ place: place("Chibougamau") });

      expect(countGrounding(database)).toBe(0);
      // The stated cost of not caching a negative: the question is re-asked.
      expect(inner.locates).toBe(2);
    });
  });

  describe("what the key normalisation drops", () => {
    test("case and surrounding whitespace: one row, one call", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner, database } = build(clock);

      await cache.locate({ place: place("Rimouski") });
      await cache.locate({ place: place("  RIMOUSKI  ") });

      expect(inner.locates).toBe(1);
      expect(countGrounding(database)).toBe(1);
    });

    test("repeated whitespace inside a name, which a model writes both ways", () => {
      expect(locateKey(place("Québec  City"))).toBe(locateKey(place("Québec City")));
    });

    test("control characters, so no name can forge another pair's key", () => {
      // A NUL joins the parts of a key. Left in a name, `"quebec\\u0000city"`
      // would be indistinguishable from the pair `"quebec"` + `"city"`.
      expect(travelKey(place("quebec\u0000city"), place("rimouski"), "driving")).not.toBe(
        travelKey(place("quebec"), place("city rimouski"), "driving"),
      );
    });

    test("and nothing else — accents stay, because they are a different question", () => {
      // The fixture provider strips them in `placeKey`, and that is its
      // business: it is deciding whether its own table holds an answer, not
      // deciding that two questions are one. A real backend may well answer
      // these differently.
      expect(locateKey(place("Montréal"))).not.toBe(locateKey(place("Montreal")));
    });

    test("nor punctuation, nor an abbreviation anyone would expand by eye", () => {
      expect(locateKey(place("Sainte-Anne-des-Monts"))).not.toBe(
        locateKey(place("Sainte Anne des Monts")),
      );
      expect(locateKey(place("Mt Albert"))).not.toBe(locateKey(place("Mont Albert")));
    });

    test("a locality is part of the question, and having none is not having an empty one", () => {
      expect(locateKey(place("Alma", "Québec"))).not.toBe(locateKey(place("Alma")));
      expect(locateKey(place("Alma", "   "))).not.toBe(locateKey(place("Alma")));
    });

    test("a travel key is ordered, because the two directions are two questions", () => {
      expect(travelKey(place("A"), place("B"), "driving")).not.toBe(
        travelKey(place("B"), place("A"), "driving"),
      );
    });

    test("and carries the mode, so a mode nobody asked for cannot answer", () => {
      // One member today. The key holds it now so that adding the second is a
      // member of `TRAVEL_MODES` rather than a migration and an invalidation.
      expect(travelKey(place("A"), place("B"), "driving")).toContain("driving");
    });
  });
});

/** A row that expired long before any clock a test could be holding. */
function seedExpired(database: Database.Database): void {
  upsertGrounding(database, {
    kind: "locate",
    key: "somewhere old\u0000",
    payload: { latitude: 48.45, longitude: -68.52 },
    source: {
      url: "https://fixtures.invalid/counting/place",
      title: "A counting fake, not a measurement",
      fetchedAt: "2020-01-01T00:00:00.000Z",
    },
    fetchedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2021-01-01T00:00:00.000Z",
  });
}

describe("where eviction runs", () => {
  test("on boot, because a process that was down for a month comes up holding stale answers", async () => {
    // A file database rather than `:memory:`, because the claim under test is
    // precisely that the table outlives the process — which is why
    // `01-ARCHITECTURE.md` made this a table and not an in-process map.
    const dir = mkdtempSync(path.join(tmpdir(), "planner-grounding-cache-"));
    const databasePath = path.join(dir, "planner.db");
    try {
      const first = await createApp({ config: { databasePath, logLevel: "silent" } });
      seedExpired(first.context.db);
      expect(countGrounding(first.context.db)).toBe(1);
      await first.shutdown();

      const second = await createApp({ config: { databasePath, logLevel: "silent" } });
      expect(countGrounding(second.context.db)).toBe(0);
      await second.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("and after a run, however that run ended", async () => {
    const harness = await createRunHarness();
    try {
      seedExpired(harness.app.context.db);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      expect(countGrounding(harness.app.context.db)).toBe(0);
    } finally {
      await harness.close();
    }
  });
});
