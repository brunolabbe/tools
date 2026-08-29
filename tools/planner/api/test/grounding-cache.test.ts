/**
 * The grounding cache.
 *
 * Five things are worth more than the rest of this file put together, and each
 * has a test named after it:
 *
 * - two identical questions cost one call, asserted by counting, never by
 *   timing;
 * - a hit carries the *original* `fetchedAt`, asserted with a clock that moved
 *   between the write and the read;
 * - a hit does not spend the run's grounding budget, and a miss does;
 * - a lookup the budget refused says `refused` and never `unknown`, because
 *   "we could not afford to ask" and "nobody knows" are different sentences in
 *   front of a user;
 * - a question named `constructor` misses like any other unknown one.
 *
 * The provider behind the cache is a counting fake rather than the fixture
 * provider, because a test needs to move the clock between a write and a read
 * and to hand the cache a `fetchedAt` it did not choose — a backend claiming a
 * time in the future, and one claiming a time long past.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { groundingBudget } from "@planner/agent";
import type {
  Find,
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  ModelProvider,
  ModelReply,
  ModelRequest,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import { AppError, runCancelUrl } from "@planner/contract";
import type { Place, Source } from "@planner/contract";
import type { GroundingCacheTtlHours } from "../src/config.ts";
import type { AppLogger } from "../src/logger.ts";
import { countGrounding, upsertGrounding } from "../src/db/grounding-cache.ts";
import { migrate } from "../src/db/schema.ts";
import { createApp } from "../src/index.ts";
import {
  CachingGroundingProvider,
  evictExpiredGrounding,
  groundingForRun,
  locateKey,
  travelKey,
  travelOutcome,
} from "../src/grounding/cache.ts";
import {
  createRunHarness,
  deferred,
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
  /**
   * Hours to add to the clock when stamping an answer.
   *
   * A real backend's `Source.fetchedAt` is its claim, not ours, and the two
   * directions fail differently: a clock running fast would extend its own TTL
   * for ever, and a fact read months ago must not become good for months more
   * merely because we asked for it today.
   */
  readonly #stampOffsetHours: number;

  constructor(
    clock: Clock,
    known: readonly string[] = ["rimouski", "québec city"],
    stampOffsetHours = 0,
  ) {
    this.#clock = clock;
    this.#known = new Set(known);
    this.#stampOffsetHours = stampOffsetHours;
  }

  #source(what: string): Source {
    return {
      url: `https://fixtures.invalid/counting/${what}`,
      title: "A counting fake, not a measurement",
      fetchedAt: new Date(
        this.#clock.now().getTime() + this.#stampOffsetHours * 3_600_000,
      ).toISOString(),
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

  /** Not this suite's concern (pl-29) — nothing here ever calls it. */
  async nearby(): Promise<Find[]> {
    return [];
  }
}

const TTL: GroundingCacheTtlHours = { locate: 24, travel: 12 };

interface LoggedLine {
  level: string;
  message: string;
  fields?: Record<string, unknown> | undefined;
}

/** Keeps every line, so a test can assert that a silent branch is not silent. */
function recordingLogger(): { logger: AppLogger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  const at =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      lines.push({ level, message, fields });
    };
  const logger: AppLogger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => logger,
  };
  return { logger, lines };
}

function build(
  clock: Clock,
  options: {
    ttlHours?: GroundingCacheTtlHours;
    known?: readonly string[];
    stampOffsetHours?: number;
    logger?: AppLogger;
  } = {},
): { cache: CachingGroundingProvider; inner: CountingProvider; database: Database.Database } {
  const database = new Database(":memory:");
  migrate(database);
  db = database;

  const inner = new CountingProvider(
    clock,
    options.known ?? ["rimouski", "québec city"],
    options.stampOffsetHours ?? 0,
  );
  const cache = new CachingGroundingProvider({
    db: database,
    inner,
    ttlHours: options.ttlHours ?? TTL,
    now: clock.now,
    logger: options.logger,
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

    test("runs the deadline from when the fact was read, not from when we stored it", async () => {
      // A backend answering with a fact it read five hours ago has three hours
      // of a six-hour lifetime left, not six. Storing it as good for six would
      // let a stale answer be laundered fresh by whichever boot first asked.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, {
        ttlHours: { locate: 6, travel: 6 },
        stampOffsetHours: -5,
      });

      await cache.locate({ place: place("Rimouski") });
      clock.advanceHours(2);
      await cache.locate({ place: place("Rimouski") });

      // Seven hours old against a six-hour lifetime: expired, so asked again.
      expect(inner.locates).toBe(2);
    });

    test("clamps a backend whose clock runs fast, so it cannot extend its own TTL", async () => {
      // `fetchedAt` is the backend's claim about itself. Unclamped, a source
      // dated ten hours from now would be good for sixteen on a six-hour TTL —
      // and a badly-set clock would hold an answer for as long as it was wrong.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock, {
        ttlHours: { locate: 6, travel: 6 },
        stampOffsetHours: 10,
      });

      await cache.locate({ place: place("Rimouski") });
      clock.advanceHours(3);
      await cache.locate({ place: place("Rimouski") });
      expect(inner.locates).toBe(1);

      clock.advanceHours(4);
      await cache.locate({ place: place("Rimouski") });
      // Seven hours after the write, against a lifetime clamped to start at the
      // write. Unclamped it would still have had nine hours to run.
      expect(inner.locates).toBe(2);
    });

    test("a fact older than its own lifetime is answered, not written down, and logged", async () => {
      // The `#store` branch the review found had no log line and no test: a
      // backend stamping every answer a week ago against a six-hour TTL turns
      // the cache off completely and silently. Every lookup is then a miss and
      // every miss spends budget, with nothing anywhere saying why.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { logger, lines } = recordingLogger();
      const { cache, inner, database } = build(clock, {
        ttlHours: { locate: 6, travel: 6 },
        stampOffsetHours: -24 * 7,
        logger,
      });

      const located = await cache.locate({ place: place("Rimouski") });

      expect(located).not.toBeNull();
      expect(countGrounding(database)).toBe(0);
      expect(inner.locates).toBe(1);
      expect(
        lines.filter(
          (line) =>
            line.level === "warn" &&
            line.message === "grounding answer not cached: it arrived already expired",
        ),
      ).toHaveLength(1);
    });

    test("a TTL of zero is a deployment's own decision, so it is not warned about", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { logger, lines } = recordingLogger();
      const { cache } = build(clock, { ttlHours: { locate: 0, travel: 0 }, logger });

      await cache.locate({ place: place("Rimouski") });

      expect(lines.filter((line) => line.level === "warn")).toEqual([]);
      expect(lines.some((line) => line.level === "debug")).toBe(true);
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

    test("a matrix the table holds in full spends nothing", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock, { known: ["a", "b"] });
      const request = {
        origins: [place("A"), place("B")],
        destinations: [place("A"), place("B")],
        mode: "driving",
      } as const;
      const budget = groundingBudget(4);
      const run = groundingForRun(cache, budget);

      await run.travel(request);
      expect(budget.remaining()).toBe(3);

      await run.travel(request);
      expect(budget.remaining()).toBe(3);
    });

    test("a run out of budget makes no call, and says refused rather than unknown", async () => {
      // The distinction the whole result type exists for. With a ceiling of
      // forty and forty-five places, lookups forty-one to forty-five are never
      // sent — and reporting them as `unknown` would write "nothing established
      // where this is" against five places nobody asked about.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const run = groundingForRun(cache, groundingBudget(1));

      await run.locate({ place: place("Rimouski") });
      const outcome = await run.locate({ place: place("Québec City") });

      expect(inner.locates).toBe(1);
      expect(outcome.kind).toBe("refused");
      expect(run.refused).toBe(1);
    });

    test("a place nobody has heard of is unknown, which is not the same word", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const run = groundingForRun(cache, groundingBudget(4));

      const outcome = await run.locate({ place: place("Chibougamau") });

      // It was asked, and the backend had no answer. That is an unmeasured leg
      // on the plan; a refusal is a `PlanGap`. Two different sentences.
      expect(inner.locates).toBe(1);
      expect(outcome.kind).toBe("unknown");
      expect(run.refused).toBe(0);
    });

    test("a refused matrix refuses only the cells it could not ask about", async () => {
      // One call is genuinely mixed: the pairs the table already holds are
      // answered, and only the rest are refused.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock, { known: ["a", "b", "c"] });
      const run = groundingForRun(cache, groundingBudget(1));

      await run.travel({
        origins: [place("A")],
        destinations: [place("B")],
        mode: "driving",
      });
      const wider = await run.travel({
        origins: [place("A")],
        destinations: [place("B"), place("C")],
        mode: "driving",
      });

      expect(travelOutcome(wider, 0, 0).kind).toBe("answered");
      expect(travelOutcome(wider, 0, 1).kind).toBe("refused");
      expect(run.refused).toBe(1);
    });

    test("a hit still answers once the budget is spent, because it costs nothing", async () => {
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock);
      const run = groundingForRun(cache, groundingBudget(1));

      const first = await run.locate({ place: place("Rimouski") });
      await run.locate({ place: place("Québec City") }); // refused; spends nothing
      const again = await run.locate({ place: place("Rimouski") });

      expect(again).toEqual(first);
      expect(again.kind).toBe("answered");
      expect(run.refused).toBe(1);
    });

    test("the seam's own methods never refuse, because there is no budget to refuse from", async () => {
      // `CachingGroundingProvider` is still a `GroundingProvider` for a caller
      // with nothing to spend, and flattening to `null` there loses nothing:
      // `refused` is unreachable without a `RunSpend`.
      //
      // Asserted by asking the *same question two ways at once*: a run whose
      // budget is exhausted refuses it, and the un-budgeted seam still answers
      // it. A call count alone would say nothing about refusal.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner } = build(clock);
      const run = groundingForRun(cache, groundingBudget(0));

      expect((await run.locate({ place: place("Rimouski") })).kind).toBe("refused");
      expect(inner.locates).toBe(0);

      const throughTheSeam = await cache.locate({ place: place("Rimouski") });
      expect(throughTheSeam).not.toBeNull();
      expect(inner.locates).toBe(1);

      const matrix = await cache.travel({
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      });
      expect(matrix[0]?.[0]).not.toBeNull();

      // And the only `null` it can produce is the unknown one.
      await expect(cache.locate({ place: place("Chibougamau") })).resolves.toBeNull();
    });
  });

  describe("reading a cell out of the outcome matrix", () => {
    test("a pair that was never sent throws rather than reading as unknown", async () => {
      // The three outcomes are statements about the world; an index nobody sent
      // is a statement about the caller. Folding it into `unknown` would put
      // "we asked and nobody knew" against a pair nobody asked about.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache } = build(clock);
      const run = groundingForRun(cache, groundingBudget(4));

      const matrix = await run.travel({
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      });

      expect(travelOutcome(matrix, 0, 0).kind).toBe("answered");
      expect(() => travelOutcome(matrix, 1, 0)).toThrow(AppError);
      expect(() => travelOutcome(matrix, 0, 9)).toThrow(AppError);
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

    test("the same three, on `travel`, at both ends of the leg", () => {
      // `travelKey` composes the same `placePart` twice, but the acceptance
      // clause says `locate` *and* `travel` share a row on case and whitespace
      // — and a key built from two ends is exactly where a normalisation
      // applied to one of them would go unnoticed.
      expect(travelKey(place("  QUÉBEC  City "), place("rimouski"), "driving")).toBe(
        travelKey(place("Québec City"), place("Rimouski"), "driving"),
      );
      expect(travelKey(place("Alma", "  SAGUENAY "), place("Rimouski", "Québec"), "driving")).toBe(
        travelKey(place("alma", "saguenay"), place("rimouski", "québec"), "driving"),
      );
    });

    test("and one row is what that costs the table, not two", async () => {
      // The clause is about a *row*, so it is asserted against the table and
      // not only against the key function.
      const clock = new Clock("2026-08-22T09:00:00.000Z");
      const { cache, inner, database } = build(clock);

      await cache.travel({
        origins: [place("Québec City")],
        destinations: [place("Rimouski")],
        mode: "driving",
      });
      await cache.travel({
        origins: [place("  québec  CITY  ")],
        destinations: [place("RIMOUSKI ")],
        mode: "driving",
      });

      expect(inner.travels).toBe(1);
      expect(countGrounding(database)).toBe(1);
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

/** Fails every specialist, so the run ends `failed` rather than `done`. */
class FailingProvider implements ModelProvider {
  readonly name = "failing";
  readonly model = "failing";

  async send(): Promise<ModelReply> {
    throw new AppError("AGENT_UNAVAILABLE");
  }
}

/** Blocks inside the provider until aborted, so a run can be canceled in flight. */
class BlockingProvider implements ModelProvider {
  readonly name = "blocking";
  readonly model = "blocking";
  readonly #entered = deferred();

  /** Resolves once at least one specialist is inside `send` and waiting. */
  get entered(): Promise<void> {
    return this.#entered.promise;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    this.#entered.resolve();
    return await new Promise<ModelReply>((_resolve, reject) => {
      const stop = (): void => {
        reject(new AppError("JOB_CANCELED"));
      };
      // Already aborted means the listener never fires and this promise never
      // settles, which is a hang rather than a failed assertion.
      if (request.signal?.aborted === true) stop();
      else request.signal?.addEventListener("abort", stop);
    });
  }
}

/** The one row `seedExpired` writes, so a test can ask about it by name. */
const SEEDED = { kind: "locate", key: "somewhere old\u0000" } as const;

/**
 * Whether the seeded row is still there, expiry ignored — which
 * `selectGrounding` will not do for you.
 *
 * The eviction tests ask this rather than "is the table empty". The claim
 * under test is that an expired row is deleted, and an empty table is only the
 * same statement for as long as nothing else in a run writes to this cache.
 * pl-27 makes a run ground for real, at which point "empty" stops being true
 * and would start failing for a reason that has nothing to do with eviction.
 */
function seededRowSurvives(database: Database.Database): boolean {
  const row = database
    .prepare<[string, string], { n: number }>(
      "SELECT COUNT(*) AS n FROM grounding_cache WHERE kind = ? AND key = ?",
    )
    .get(SEEDED.kind, SEEDED.key);
  return (row?.n ?? 0) > 0;
}

/** A row that expired long before any clock a test could be holding. */
function seedExpired(database: Database.Database): void {
  upsertGrounding(database, {
    ...SEEDED,
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

describe("how the app wires it up", () => {
  test("a run cannot reach an un-budgeted lookup through the context", async () => {
    // The door the second gate found still open. `RunGroundingSource` used to
    // extend `GroundingProvider`, so `context.grounding.locate(…)` compiled,
    // answered `T | null` and spent no budget at all — the obvious spelling,
    // and the one that reinstates both the unmetered bill and the collapse of
    // "we never asked" into "nobody knows".
    //
    // Asserted by the compiler, which is the only place a type-level guarantee
    // can be asserted: this suite is typechecked by the same gate the source
    // is, so the day `locate` becomes reachable again, `@ts-expect-error` has
    // nothing to suppress and `npm run check` fails.
    const harness = await createRunHarness();
    try {
      // @ts-expect-error — the un-budgeted seam is unreachable from a run.
      const unbudgetedLocate: unknown = harness.app.context.grounding.locate;
      // @ts-expect-error — and so is the matrix half of it.
      const unbudgetedTravel: unknown = harness.app.context.grounding.travel;

      // Both are still there at runtime — it is the same cache object, and
      // `server.ts` holds it as a `GroundingProvider` too. The guarantee is
      // entirely in the type, which is where a wrong spelling gets written.
      expect(unbudgetedLocate).toBeInstanceOf(Function);
      expect(unbudgetedTravel).toBeInstanceOf(Function);

      // What a run *does* get, and it is enough.
      expect(harness.app.context.grounding.name).toBe("fixtures");
      const run = groundingForRun(harness.app.context.grounding, groundingBudget(2));
      expect(run.refused).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("the provider and the cache around it read the same clock", async () => {
    // Defusing the time bomb inside the fixture provider was necessary and not
    // sufficient: `createGroundingProvider` built it on the *default* clock
    // while the cache took the injected one, so a deployment whose clock is
    // ahead of this file stamps answers later than the moment they are stored,
    // the clamp turns that into already-expired-on-write, and the cache is off
    // with every lookup spending budget.
    //
    // Pinned to 2030 because it is the wiring under test, not the provider: the
    // test one file over that proves a 2028 provider stamps 2028 passes by
    // constructing the provider directly, which is exactly the step that skips
    // the bug.
    const harness = await createRunHarness({ now: () => new Date("2030-06-01T12:00:00.000Z") });
    try {
      const run = groundingForRun(harness.app.context.grounding, groundingBudget(4));

      const first = await run.locate({ place: place("Rimouski") });
      const second = await run.locate({ place: place("Rimouski") });

      expect(first.kind).toBe("answered");
      expect(second.kind).toBe("answered");
      // The second answer came out of the table, which is only possible if the
      // row was written — and it is only written if the stamp is not in the
      // future relative to the cache's own clock.
      expect(countGrounding(harness.app.context.db)).toBe(1);
      expect(run.refused).toBe(0);
    } finally {
      await harness.close();
    }
  });
});

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
      expect(seededRowSurvives(first.context.db)).toBe(true);
      await first.shutdown();

      const second = await createApp({ config: { databasePath, logLevel: "silent" } });
      expect(seededRowSurvives(second.context.db)).toBe(false);
      await second.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("and after a run that finished", async () => {
    const harness = await createRunHarness();
    try {
      seedExpired(harness.app.context.db);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("done");
      expect(seededRowSurvives(harness.app.context.db)).toBe(false);
    } finally {
      await harness.close();
    }
  });

  test("after a run that failed", async () => {
    // "However that run ended" is the claim, and the sweep is in a `finally`
    // precisely so the two unhappy paths are covered by the same line. Asserted
    // rather than assumed: a `finally` is also the easiest block to lose.
    const harness = await createRunHarness({ model: new FailingProvider() });
    try {
      seedExpired(harness.app.context.db);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("failed");
      expect(seededRowSurvives(harness.app.context.db)).toBe(false);
    } finally {
      await harness.close();
    }
  });

  test("and a boot sweep that throws does not stop the service from booting", async () => {
    // The one fix in this round that the gate found untested, and the failure
    // is worse than the run-time one: an unguarded DELETE here rejects
    // `createApp`, so a lock or a full disk means the service does not start at
    // all — over work this cache itself calls not load-bearing, since an
    // expired row is refused on read whether or not anything deleted it.
    //
    // Spied on the prototype rather than the instance, because `createApp`
    // builds its own `Database` and there is nothing to reach for until it has.
    const { logger, lines } = recordingLogger();
    const prepare = Database.prototype.prepare;
    vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      this: Database.Database,
      sql: string,
    ) {
      if (sql.startsWith("DELETE FROM grounding_cache")) {
        throw new Error("SQLITE_FULL: database or disk is full");
      }
      return prepare.call(this, sql);
    } as typeof Database.prototype.prepare);

    try {
      const app = await createApp({ config: { databasePath: ":memory:" }, logger });
      await app.shutdown();

      const warning = lines.find(
        (line) => line.message === "grounding cache eviction failed at boot",
      );
      expect(warning?.level).toBe("warn");
      expect(warning?.fields?.["cause"]).toContain("SQLITE_FULL");
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("and a sweep that throws is reported as itself, not as a rejected run", async () => {
    // What the guard actually buys, stated exactly. The run row is committed
    // before `execute` returns and the queue releases the slot of a rejected
    // task, so an unguarded throw here loses no plan and wedges nothing — the
    // status below is `done` either way, which is why it is context here and
    // not the claim. What it does produce is an error-level "run task rejected"
    // blaming a run that succeeded for a DELETE it had nothing to do with. The
    // two log assertions are the ones that bite.
    const { logger, lines } = recordingLogger();
    const harness = await createRunHarness({ logger });
    try {
      const database = harness.app.context.db;
      const prepare = database.prepare.bind(database);
      // Only the sweep fails. Everything the run itself does still works, which
      // is what makes "the run still finished" mean anything.
      vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
        if (sql.startsWith("DELETE FROM grounding_cache")) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return prepare(sql);
      }) as typeof database.prepare);

      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      // Context, not the claim: this passes with the guard removed too.
      expect(finished.status).toBe("done");

      const warning = lines.find((line) => line.message === "grounding cache eviction failed");
      expect(warning?.level).toBe("warn");
      // The cause, not only `INTERNAL`: `AppError.from` gives everything
      // untyped the same code and the same generic sentence, and this line is
      // the only place a lock or a full disk is ever mentioned.
      expect(warning?.fields?.["cause"]).toContain("SQLITE_BUSY");
      expect(lines.some((line) => line.message === "run task rejected")).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await harness.close();
    }
  });

  test("and after one the user canceled", async () => {
    const provider = new BlockingProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      seedExpired(harness.app.context.db);
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      // Wait until the fan-out is genuinely in flight, or this would only prove
      // that a queued run can be dropped before the task body ever ran.
      await provider.entered;
      await harness.app.server.inject({ method: "POST", url: runCancelUrl(run.id) });
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("canceled");
      expect(seededRowSurvives(harness.app.context.db)).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
