/**
 * A grounding provider that answers from the `grounding_cache` table before it
 * asks the one behind it.
 *
 * §5: **grounding is where the latency and the bill live, and a plan revision
 * re-asks most of the same questions.** Phase 4 is built entirely out of
 * re-asking them — a re-plan of three days reads the same brief, the same
 * pinned items and most of the same places — so this is not an optimisation
 * bolted on afterwards. It is what makes revision affordable.
 *
 * ## It wraps; it is not threaded through
 *
 * This is a `GroundingProvider` that holds another one, so pl-28's adapter
 * never learns that SQLite exists, the fixture provider is cacheable for free,
 * and a test can assert the wrapped provider was called exactly once for two
 * identical questions. Everything above the seam — `context.grounding` — sees
 * the seam and nothing else.
 *
 * `name` is the inner provider's, deliberately. `/api/health` answers "which
 * backend is this deployment grounding against", and "cached" is not a backend.
 *
 * ## `Source.fetchedAt` is the original fetch time, never `now()`
 *
 * The sharpest trap in this file. `contract/src/candidate.ts` documents
 * `Source.fetchedAt` as the thing that decides whether a fact may still be
 * shown — stamp a hit with the current time and every cached fact claims to be
 * fresh, the TTL becomes decorative, and the plan view's verified marking
 * starts asserting something nobody checked today. **A hit is the same fact,
 * read at the same moment it was read the first time**, so the timestamp comes
 * off the row.
 *
 * ## A `null` is not cached
 *
 * "Nobody established it" is a real answer this seam has a word for, and it is
 * the one answer this table does not keep. Three reasons: it has no `Source`,
 * so there is nothing to write in the two columns that make the table
 * inspectable; a real backend's `null` is as often a gap in *its* coverage
 * today as a fact about the world; and `expires_at` would have to be computed
 * from a lifetime nobody has argued for. The cost is that a question nobody can
 * answer is re-asked, and it is stated here rather than discovered: if that
 * shows up as a bill, the fix is a negative TTL of its own, argued for in the
 * architecture's configuration table like every other one.
 *
 * ## Its keys come from a model, so every index over them is a `Map`
 *
 * A place name reaches this file from a candidate a model wrote.
 * `{}["constructor"]` is a function rather than `undefined`, so a plain object
 * keyed on one of these answers for names it does not hold — pl-24's gazetteer
 * found that the expensive way, and a place called "Constructor" came back
 * located and its leg came back measured at zero. A SQLite row is not exposed
 * to it; the read-through map below is, and it is a `Map`.
 */

import type {
  GroundingBudget,
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  TravelEstimate,
  TravelMatrix,
  TravelMode,
  TravelRequest,
} from "@planner/agent";
import { coordinatesSchema, sourceSchema } from "@planner/contract";
import type { Place, Source } from "@planner/contract";
import type { Database } from "better-sqlite3";
import type { GroundingCacheTtlHours } from "../config.ts";
import { deleteExpiredGrounding, selectGrounding, upsertGrounding } from "../db/grounding-cache.ts";
import type { AppLogger } from "../logger.ts";

/**
 * The kinds, which are the seam's methods.
 *
 * A third arrives with a third method and brings its own TTL with it — see
 * `GroundingCacheTtlHours`, where the compiler asks for one.
 */
const LOCATE = "locate";
const TRAVEL = "travel";

// ---------------------------------------------------------------------------
// Normalising the question
// ---------------------------------------------------------------------------

/**
 * Joins the parts of a key. A NUL, because nothing survives `normalisePart`
 * carrying one — see below — so no place name can forge another question's key
 * by containing the separator. Each kind has a fixed number of parts, so one
 * separator is unambiguous.
 */
const KEY_SEPARATOR = "\u0000";

/**
 * A part that is not there at all, distinct from one that is empty.
 *
 * A `Place` with no `locality` and a `Place` whose locality is `"  "` are
 * different questions — the first says nothing, the second says something
 * unusable — and collapsing them would be this file's own version of two
 * questions sharing an answer.
 */
const ABSENT = "\u0001";

/**
 * What the normalisation drops, in full, so that nobody has to read the code to
 * find out:
 *
 * 1. **Case.** `Rimouski` and `rimouski` are one question.
 * 2. **Surrounding whitespace**, and
 * 3. **repeated whitespace inside** — `"Québec  City"` is the same question as
 *    `"Québec City"`, and a model writes both.
 * 4. **Control characters**, which are not a normalisation so much as a
 *    defence: they are what a name would need to contain to forge a separator
 *    and be answered with another pair's row.
 *
 * And what it deliberately does **not** drop, because each of these turns two
 * different questions into one:
 *
 * - **Accents.** `Montréal` and `Montreal` are two different strings and a real
 *   backend may well answer them differently. The fixture provider strips them
 *   in `placeKey` and that is *its* business — it is deciding whether its own
 *   small table holds an answer, not deciding that two questions are the same
 *   question.
 * - **Punctuation, articles, abbreviations.** `Saint-Anne` is not
 *   `Sainte Anne`, and `Mt Albert` is not `Mont Albert`. Guessing here is how a
 *   cache starts lying rather than missing.
 */
function normalisePart(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function placePart(place: Place): string {
  // `coordinates` is deliberately not in the key: it is what `locate` is *for*,
  // and a candidate that has already been located asks a different question
  // only in the sense that it need not ask at all.
  return `${normalisePart(place.name)}${KEY_SEPARATOR}${
    place.locality === null ? ABSENT : normalisePart(place.locality)
  }`;
}

/** The key for "where is this place". */
export function locateKey(place: Place): string {
  return placePart(place);
}

/**
 * The key for "how far from here to there, this way".
 *
 * **Ordered**, because a one-way system, a ferry timetable and a mountain pass
 * all make the two directions different questions, and a backend that happens
 * to answer them alike is not a licence to assume it. The fixture provider
 * stores both directions of every pair for exactly that reason: it chose to,
 * and the choice is visible.
 */
export function travelKey(from: Place, to: Place, mode: TravelMode): string {
  return `${mode}${KEY_SEPARATOR}${placePart(from)}${KEY_SEPARATOR}${placePart(to)}`;
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

/**
 * Drop what has aged out.
 *
 * On boot and after a run, and deliberately **not** on a timer: this process
 * already has a queue and a shutdown path to hang work off, and a timer is a
 * thing to leak in tests and to keep the event loop alive at exit. Neither
 * moment is load-bearing for correctness — `selectGrounding` refuses an expired
 * row whether or not a sweep has run — so this is about the table not growing
 * for ever, and a missed sweep costs disk rather than a wrong answer.
 */
export function evictExpiredGrounding(
  db: Database,
  now: Date,
  logger?: AppLogger | undefined,
): number {
  const removed = deleteExpiredGrounding(db, now.toISOString());
  if (removed > 0) logger?.debug("grounding cache evicted", { rows: removed });
  return removed;
}

// ---------------------------------------------------------------------------
// Spending the budget
// ---------------------------------------------------------------------------

/**
 * A provider that claims one call from a run's budget before each call it
 * makes, and makes none when the budget refuses.
 *
 * **This sits *inside* the cache, not outside it**, which is the whole of
 * step 4: the cache only reaches its inner provider on a miss, so a hit never
 * arrives here and never spends. `MAX_GROUNDING_CALLS` is a bill control and a
 * hit costs nothing — the name says "calls" and reads the other way, which is
 * why it is written down here rather than left to the reader.
 */
export interface RunGrounding extends GroundingProvider {
  /**
   * Lookups this run wanted, could not afford, and therefore never made.
   *
   * A refusal is **not** a `null` that means "nobody knows", and a caller must
   * not render it as one. What was skipped for want of budget is a `PlanGap` in
   * front of the user, the way a dropped specialist already is — that is
   * pl-24's argument and this is the number it needs. It is a count rather than
   * a throw because running out of budget is a planned outcome with copy
   * attached: `GroundingBudget.claim` does not throw, and neither does this.
   */
  readonly refused: number;
}

interface Budgeted extends GroundingProvider {
  readonly refused: number;
}

function budgeted(inner: GroundingProvider, budget: GroundingBudget): Budgeted {
  let refused = 0;
  return {
    name: inner.name,
    get refused() {
      return refused;
    },
    async locate(request: LocateRequest): Promise<LocatedPlace | null> {
      if (!budget.claim()) {
        refused += 1;
        return null;
      }
      return inner.locate(request);
    },
    async travel(request: TravelRequest): Promise<TravelMatrix> {
      if (!budget.claim()) {
        refused += 1;
        // The shape the caller asked for, with nothing in it. One matrix is one
        // call whatever its size, so a refusal costs the whole table at once —
        // which is why `applyBudget`'s argument holds here too: decide before
        // the request, not at cell forty-one.
        return request.origins.map(() => request.destinations.map(() => null));
      }
      return inner.travel(request);
    },
  };
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

export interface GroundingCacheOptions {
  db: Database;
  /** The provider a miss falls through to. */
  inner: GroundingProvider;
  ttlHours: GroundingCacheTtlHours;
  /** Injected so a test can move the clock between a write and a read. */
  now: () => Date;
  logger?: AppLogger | undefined;
}

export class CachingGroundingProvider implements GroundingProvider {
  readonly #options: GroundingCacheOptions;

  constructor(options: GroundingCacheOptions) {
    this.#options = options;
  }

  /** The backend's, not "cached". A cache is not a thing to ground against. */
  get name(): string {
    return this.#options.inner.name;
  }

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    const { db, inner, now } = this.#options;
    const key = locateKey(request.place);
    const at = now();

    const cached = selectGrounding(db, { kind: LOCATE, key, now: at.toISOString() });
    if (cached !== undefined) {
      const coordinates = coordinatesSchema.safeParse(cached.payload);
      // A row whose payload no longer fits the shape its kind promises is a
      // miss. Validating on the way out and not only on the way in is what
      // makes the column safe to widen later without a migration for every
      // reader — the same rule `readError` follows in `db/runs.ts`.
      if (coordinates.success) return { coordinates: coordinates.data, source: cached.source };
    }

    const located = await inner.locate(request);
    if (located === null) return null;

    this.#store(LOCATE, key, located.coordinates, located.source, at);
    return located;
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    const { db, inner, now } = this.#options;
    const at = now();
    const timestamp = at.toISOString();

    const keys = request.origins.map((from) =>
      request.destinations.map((to) => travelKey(from, to, request.mode)),
    );

    // A `Map`, not an object: these keys carry a place name a model wrote, and
    // a plain object answers for names it does not hold. See the file header.
    const answers = new Map<string, TravelEstimate>();
    const wantedOrigins = new Set<number>();
    const wantedDestinations = new Set<number>();

    keys.forEach((row, origin) => {
      row.forEach((key, destination) => {
        const cached = selectGrounding(db, { kind: TRAVEL, key, now: timestamp });
        const estimate = cached === undefined ? null : readEstimate(cached.payload, cached.source);
        if (estimate === null) {
          wantedOrigins.add(origin);
          wantedDestinations.add(destination);
          return;
        }
        answers.set(key, estimate);
      });
    });

    if (wantedOrigins.size > 0 && wantedDestinations.size > 0) {
      // The sub-matrix over the rows and columns that are missing something.
      // Every missing cell has its row in one set and its column in the other,
      // so this covers all of them — and the extra cells it may pick up are
      // ones we would otherwise pay for next time. One call, whatever its size,
      // is the shape `TravelMatrix` exists for.
      //
      // `flatMap` rather than an index list so the place and the row it came
      // from travel together and nothing has to be indexed back out.
      const origins = request.origins.flatMap((place, index) =>
        wantedOrigins.has(index) ? [{ place, index }] : [],
      );
      const destinations = request.destinations.flatMap((place, index) =>
        wantedDestinations.has(index) ? [{ place, index }] : [],
      );

      const measured = await inner.travel({
        origins: origins.map((entry) => entry.place),
        destinations: destinations.map((entry) => entry.place),
        mode: request.mode,
        signal: request.signal,
      });

      origins.forEach((origin, row) => {
        destinations.forEach((destination, column) => {
          const estimate = measured[row]?.[column] ?? null;
          const key = keys[origin.index]?.[destination.index];
          if (estimate === null || key === undefined) return;
          answers.set(key, estimate);
          this.#store(
            TRAVEL,
            key,
            { distanceMeters: estimate.distanceMeters, durationMinutes: estimate.durationMinutes },
            estimate.source,
            at,
          );
        });
      });
    }

    return keys.map((row) => row.map((key) => answers.get(key) ?? null));
  }

  /**
   * A per-run view that spends that run's budget on **misses only**.
   *
   * The composition is the argument: this returns a cache whose inner provider
   * is the budgeted one, so the budget is only ever reached after the table has
   * failed to answer. Written this way round rather than as a flag, because the
   * other order — a budget outside a cache — silently charges for hits and
   * looks identical at the call site.
   */
  forRun(budget: GroundingBudget): RunGrounding {
    const inner = budgeted(this.#options.inner, budget);
    const cached = new CachingGroundingProvider({ ...this.#options, inner });
    return {
      name: cached.name,
      get refused() {
        return inner.refused;
      },
      locate: (request) => cached.locate(request),
      travel: (request) => cached.travel(request),
    };
  }

  /** Drop what has aged out. See `evictExpiredGrounding`. */
  evictExpired(): number {
    return evictExpiredGrounding(this.#options.db, this.#options.now(), this.#options.logger);
  }

  /**
   * Write one answer, with its deadline computed from its kind.
   *
   * `expires_at` is stored rather than derived on read so that changing a TTL
   * neither resurrects what had aged out nor kills what was still good, and so
   * the table answers "what is still current" to a plain `SELECT`.
   */
  #store(kind: string, key: string, payload: unknown, source: Source, at: Date): void {
    const { db, ttlHours, logger } = this.#options;

    // The `Source` is validated before it is stored, not because we wrote it —
    // pl-28's adapter builds one out of a reply from somewhere else, and a
    // cached fact whose provenance `provenanceSchema` would refuse is a row
    // that can only ever produce a fact nobody may show. It is not an error:
    // the answer still goes back to the caller, it simply is not kept.
    const validated = sourceSchema.safeParse(source);
    if (!validated.success) {
      logger?.warn("grounding answer not cached: its source does not validate", { kind });
      return;
    }

    const fetchedAt = validated.data.fetchedAt;
    // The deadline runs from when the fact was read, not from when we happened
    // to store it: an answer a backend read in January is good until January,
    // whichever boot first asked for it. Clamped to `now` so a backend with a
    // fast clock cannot extend its own TTL indefinitely.
    const base = Math.min(Date.parse(fetchedAt), at.getTime());
    const ttl = kind === LOCATE ? ttlHours.locate : ttlHours.travel;
    const expiresAt = new Date(base + ttl * 3_600_000);

    // An answer that arrives already expired is not stored. A row that can
    // never be served is a table that only grows, and a TTL of zero — how a
    // deployment turns the cache off — would otherwise write every answer it
    // was told not to keep.
    if (expiresAt.getTime() <= at.getTime()) return;

    upsertGrounding(db, {
      kind,
      key,
      payload,
      source: validated.data,
      fetchedAt,
      expiresAt: expiresAt.toISOString(),
    });
  }
}

/**
 * A cached `travel` payload, back in the shape the seam promises.
 *
 * Hand-checked rather than schema-parsed: `TravelEstimate` belongs to
 * `@planner/agent`, which owns no zod, and inventing a schema for it in `api`
 * would be a second definition of a type that already has one.
 */
function readEstimate(payload: unknown, source: Source): TravelEstimate | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { distanceMeters, durationMinutes } = payload as Record<string, unknown>;
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) return null;
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) return null;
  return { distanceMeters, durationMinutes, source };
}

/**
 * The grounding a single run gets: the cache, spending that run's budget on
 * misses only.
 *
 * One entry point so a caller never has to know whether a cache is in the way.
 * With one, the budget sits *inside* it and a hit is free; without one — an
 * injected provider in a test, a deployment that has somehow turned the cache
 * off — every lookup is a miss and every miss is a call, which is the same rule
 * arriving at the same answer.
 */
export function groundingForRun(
  provider: GroundingProvider,
  budget: GroundingBudget,
): RunGrounding {
  if (provider instanceof CachingGroundingProvider) return provider.forRun(budget);
  return budgeted(provider, budget);
}
