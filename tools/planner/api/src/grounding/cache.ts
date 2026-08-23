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
 * identical questions. Nothing below it learns there is a cache, and nothing
 * above it learns there is a backend.
 *
 * What is above it does **not** get the seam. `AppContext.grounding` is
 * `RunGroundingSource` — `{ name, forRun }` — so the only lookup reachable from
 * a run is one that spends that run's budget and can say it was refused. The
 * plain `GroundingProvider` methods are still here, and `server.ts` is the only
 * place that holds this object as both, because it is the only place that
 * builds it. See `RunGroundingSource` below for what that closes.
 *
 * `name` is the inner provider's, deliberately. `/api/health` answers "which
 * backend is this deployment grounding against", and "cached" is not a backend.
 *
 * ## Two shapes, and the run gets the richer one
 *
 * As a `GroundingProvider` it answers `T | null`, which is all a caller with
 * nothing to spend can distinguish. `forRun(budget)` hands back a
 * `RunGrounding`, whose answers are a three-way `GroundingOutcome`: a run can
 * come back empty because nobody knows, *or* because its budget would not pay
 * for the call, and a plan that renders those alike claims to have checked
 * something nobody asked about. That is the shape this file got wrong first
 * time round; see `GroundingOutcome`.
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
import { AppError, coordinatesSchema, sourceSchema } from "@planner/contract";
import type { Place, Source } from "@planner/contract";
import type { Database } from "better-sqlite3";
import type { GroundingCacheTtlHours } from "../config.ts";
import { deleteExpiredGrounding, selectGrounding, upsertGrounding } from "../db/grounding-cache.ts";
import type { AppLogger } from "../logger.ts";
import { KEY_SEPARATOR, placeIdentity } from "./place-key.ts";

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
 * The normalisation itself moved to `place-key.ts` in pl-27, unchanged.
 *
 * It was private here, and a second caller then needed the *same* identity for
 * a different job — deduplicating the place list a run sends to `travel` — and,
 * finding nothing exported, built a worse one out of the fixture provider's
 * table-lookup key. Which merged two places that share a name. The fix is that
 * the seam owns one normaliser and every caller asks it; `place-key.ts` carries
 * the full argument, including what it drops and what it refuses to.
 */

/** The key for "where is this place". The place's identity, and nothing else. */
export function locateKey(place: Place): string {
  return placeIdentity(place);
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
  return `${mode}${KEY_SEPARATOR}${placeIdentity(from)}${KEY_SEPARATOR}${placeIdentity(to)}`;
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
// What a lookup came back with
// ---------------------------------------------------------------------------

/**
 * The three ways a run's grounding lookup ends, and why this is a union rather
 * than `T | null`.
 *
 * `GroundingProvider` answers `null` for "nobody established it", which is the
 * right shape for a seam that only ever asks. A **run** has a second way to
 * come back empty: it wanted to ask and could not afford to. Those two must
 * never be the same value. With a ceiling of forty and forty-five places to
 * locate, lookups forty-one to forty-five are never sent — and a caller holding
 * `null` for them writes "nothing established where this is" against five
 * places nobody asked about. That is a plan lying about what it checked, which
 * is *never fake progress* broken in the one place §5 says the bill lives.
 *
 * So the distinction is in the type and the compiler asks about it at every
 * call site, rather than a comment asking each author to remember:
 *
 * - `answered` — the fact, and a `Source` saying when it was read.
 * - `unknown` — the backend was asked and has no answer. This is the leg a plan
 *   reports as unmeasured: an `UncheckedConstraint`.
 * - `refused` — the run's grounding budget would not pay for the call, so
 *   nothing was asked and nobody knows anything either way. What a run skipped
 *   for want of budget is a `PlanGap`, in front of the user, the way a dropped
 *   specialist already is (pl-24 step 8).
 */
export type GroundingOutcome<T> =
  | { readonly kind: "answered"; readonly value: T }
  | { readonly kind: "unknown" }
  | { readonly kind: "refused" };

/**
 * Named so that no call site writes the literal and the two empties read apart.
 *
 * **Exported as of pl-27**, which is the condition the previous note set. A
 * caller that only *reads* an outcome uses `outcome.kind`, so these had no
 * consumer and stayed private; a caller that *builds* one needs them, and
 * pl-27's `travel-measure.test.ts` stands a `RunGrounding` double up to drive
 * the measuring pass over candidates the six checked-in sets cannot express.
 * Writing `{ kind: "unknown" }` at that call site is the thing this naming
 * exists to prevent, so the export is the smaller change.
 */
export const UNKNOWN = { kind: "unknown" } as const;
export const REFUSED = { kind: "refused" } as const;

export function answered<T>(value: T): GroundingOutcome<T> {
  return { kind: "answered", value };
}

/**
 * `TravelMatrix` with the same distinction, per cell.
 *
 * Per cell and not per call, because one call is genuinely mixed: a revision
 * that adds a stop is answered from the table for the pairs it already holds
 * and refused for the ones it does not, inside the same matrix.
 */
export type TravelOutcomeMatrix = readonly (readonly GroundingOutcome<TravelEstimate>[])[];

/**
 * One cell by position, so no caller indexes the matrix by hand and transposes
 * it — `travelCell`'s argument, one type along.
 *
 * Out of range **throws** where `travelCell` returns `null`, and the difference
 * is deliberate. The three outcomes are statements about the world; an index
 * that was never sent is a statement about the caller. Folding it into
 * `unknown` would put "we asked and nobody knew" against a pair nobody asked
 * about, which is the exact collapse this type exists to prevent.
 */
export function travelOutcome(
  matrix: TravelOutcomeMatrix,
  origin: number,
  destination: number,
): GroundingOutcome<TravelEstimate> {
  const cell = matrix[origin]?.[destination];
  if (cell === undefined) {
    throw new AppError("INTERNAL", "A grounding matrix was asked for a pair it was not sent.");
  }
  return cell;
}

// ---------------------------------------------------------------------------
// Spending the budget
// ---------------------------------------------------------------------------

/**
 * The grounding one run gets: the cache, spending that run's budget on
 * **misses only**.
 *
 * **Not a `GroundingProvider`**, and that is the point. The seam's methods
 * answer `T | null`; a run needs the third answer above. A view that still
 * satisfied `GroundingProvider` could be handed anywhere the seam is expected
 * and the distinction would be lost on the way through — silently, which is how
 * it was lost the first time this file was written.
 */
export interface RunGrounding {
  /** The backend's name. A cache is not a thing to ground against. */
  readonly name: string;
  locate(request: LocateRequest): Promise<GroundingOutcome<LocatedPlace>>;
  travel(request: TravelRequest): Promise<TravelOutcomeMatrix>;
  /**
   * Calls this run wanted, could not afford and never made.
   *
   * The per-lookup `refused` outcome is the authority and is what a caller
   * renders against a place or a leg; this is the run-level tally, for the one
   * sentence a `PlanGap` needs. It counts **calls**, so one refused matrix over
   * eight places is one — the same unit `MAX_GROUNDING_CALLS` is denominated
   * in, and for the same reason.
   */
  readonly refused: number;
}

/**
 * The capability to hand out a per-run view, and **nothing else**. Only the
 * cache has it.
 *
 * `groundingForRun` asks for this rather than for a `GroundingProvider` on
 * purpose. The shape before the first review dispatched on `instanceof` and
 * fell back to a plain budgeted wrapper for anything else — so a second
 * decorator placed around the cache would have gone on compiling and quietly
 * started charging the budget for cache hits, which is the one thing this file
 * argues against. Asking for the capability instead means that mistake does not
 * typecheck.
 *
 * **It deliberately does not extend `GroundingProvider`.** It did, and that
 * left the un-budgeted door open one level up: `AppContext.grounding` was one
 * of these, so `context.grounding.locate(…)` compiled, answered `T | null` and
 * spent no budget at all — the obvious spelling, and the one that quietly
 * reinstates every failure the outcome type above exists to prevent. The
 * context now carries only this, so from a run there is no un-budgeted method
 * to reach. `CachingGroundingProvider` still implements both interfaces;
 * `server.ts` is the one place that holds it as both, because it is the one
 * place that builds it.
 */
export interface RunGroundingSource {
  /** Reported by `/api/health`. The backend's name — a cache is not a backend. */
  readonly name: string;
  forRun(budget: GroundingBudget): RunGrounding;
}

/**
 * What a run may spend, and where a refusal is counted.
 *
 * Passed down into the lookups rather than wrapped around them: the cache only
 * reaches this after the table has failed to answer, which is the whole of
 * step 4 — `MAX_GROUNDING_CALLS` is a bill control, a hit costs nothing, so the
 * budget counts misses. The name says "calls" and reads the other way round,
 * which is why it is spelled out at both call sites below.
 */
interface RunSpend {
  budget: GroundingBudget;
  refuse: () => void;
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

export class CachingGroundingProvider implements GroundingProvider, RunGroundingSource {
  readonly #options: GroundingCacheOptions;

  constructor(options: GroundingCacheOptions) {
    this.#options = options;
  }

  /** The backend's, not "cached". A cache is not a thing to ground against. */
  get name(): string {
    return this.#options.inner.name;
  }

  /**
   * The seam's shape, for a caller with no budget to spend.
   *
   * Nothing is lost on the way down: with no `RunSpend` there is no refusal to
   * flatten, so the only two outcomes a caller can reach here are the two
   * `GroundingProvider` already has words for.
   */
  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    const outcome = await this.#locate(request, null);
    return outcome.kind === "answered" ? outcome.value : null;
  }

  /** Same, for the matrix. A cell is `null` where the outcome was not an answer. */
  async travel(request: TravelRequest): Promise<TravelMatrix> {
    const outcomes = await this.#travel(request, null);
    return outcomes.map((row) => row.map((cell) => (cell.kind === "answered" ? cell.value : null)));
  }

  async #locate(
    request: LocateRequest,
    spend: RunSpend | null,
  ): Promise<GroundingOutcome<LocatedPlace>> {
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
      if (coordinates.success) {
        return answered({ coordinates: coordinates.data, source: cached.source });
      }
    }

    // A miss, and **only** a miss, reaches the budget: the ceiling is a bill
    // control and a hit costs nothing. Everything above returned already.
    if (spend !== null && !spend.budget.claim()) {
      spend.refuse();
      return REFUSED;
    }

    const located = await inner.locate(request);
    if (located === null) return UNKNOWN;

    this.#store(LOCATE, key, located.coordinates, located.source, at);
    return answered(located);
  }

  async #travel(request: TravelRequest, spend: RunSpend | null): Promise<TravelOutcomeMatrix> {
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

    // Set once, when the budget turns the call down. Every cell the table could
    // not answer is then `refused` rather than `unknown`: nothing was asked, so
    // nobody knows anything either way about those pairs.
    let refusedCall = false;

    if (wantedOrigins.size > 0 && wantedDestinations.size > 0) {
      // One matrix is one call whatever its size, so a refusal costs the whole
      // sub-table at once — `applyBudget`'s argument one layer down: decide
      // before the request rather than at cell forty-one. Claimed here and not
      // earlier, because a matrix the table holds in full asks for nothing.
      if (spend !== null && !spend.budget.claim()) {
        spend.refuse();
        refusedCall = true;
      } else {
        // The sub-matrix over the rows and columns that are missing something.
        // Every missing cell has its row in one set and its column in the
        // other, so this covers all of them — and the extra cells it may pick
        // up are ones we would otherwise pay for next time. One call, whatever
        // its size, is the shape `TravelMatrix` exists for.
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
              {
                distanceMeters: estimate.distanceMeters,
                durationMinutes: estimate.durationMinutes,
              },
              estimate.source,
              at,
            );
          });
        });
      }
    }

    return keys.map((row) =>
      row.map((key) => {
        const estimate = answers.get(key);
        if (estimate !== undefined) return answered(estimate);
        // A cell the table could not answer is `unknown` when the backend was
        // asked about it and `refused` when nothing was asked at all. Collapsing
        // the two here is the defect this type exists to make impossible.
        return refusedCall ? REFUSED : UNKNOWN;
      }),
    );
  }

  /**
   * A per-run view that spends that run's budget on **misses only**, and that
   * says which of the three things happened to each lookup.
   *
   * The budget is handed *down* into the lookup rather than wrapped around it,
   * so it can only be reached after the table has failed to answer. A budget
   * wrapped around a cache charges for hits and looks identical at the call
   * site, which is why the direction is stated rather than left to the reader.
   */
  forRun(budget: GroundingBudget): RunGrounding {
    let refused = 0;
    const spend: RunSpend = {
      budget,
      refuse: () => {
        refused += 1;
      },
    };
    return {
      name: this.name,
      get refused() {
        return refused;
      },
      locate: (request) => this.#locate(request, spend),
      travel: (request) => this.#travel(request, spend),
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
    //
    // **Logged**, because everything else about this branch is invisible: a
    // backend whose `fetchedAt` is older than the TTL disables the cache
    // completely and silently, and every lookup then spends budget. That is
    // exactly what a frozen `FIXTURE_FETCHED_AT` would have done to the default
    // provider on 2027-02-18. `debug` rather than `warn` at zero TTL, which is
    // a deployment saying so on purpose rather than a fault.
    if (expiresAt.getTime() <= at.getTime()) {
      const line = "grounding answer not cached: it arrived already expired";
      if (ttl === 0) logger?.debug(line, { kind, reason: "ttl is zero" });
      else logger?.warn(line, { kind, fetchedAt, ttlHours: ttl });
      return;
    }

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
 * The grounding a single run gets — the one entry point a caller needs.
 *
 * It takes a `RunGroundingSource` and not a `GroundingProvider`, which is the
 * whole of the guarantee: the only thing in this tool that can hand out a
 * per-run view is the cache, so there is no arrangement of decorators in which
 * this quietly returns something that charges the budget for a hit. Wrap the
 * cache in something new and either that thing carries `forRun` through, or the
 * call here stops compiling.
 */
export function groundingForRun(source: RunGroundingSource, budget: GroundingBudget): RunGrounding {
  return source.forRun(budget);
}
