/**
 * Environment parsing, done once at boot.
 *
 * This app is the only place in the tool that reads `process.env`. The agent
 * package is a library and takes its configuration — including which provider
 * to talk to — as arguments.
 */

import path from "node:path";
import process from "node:process";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Model backends this build knows how to construct.
 *
 * `scripted` is the default and answers from a fixed script — see
 * `ScriptedProvider`. It means a fresh clone runs with no key, no account and
 * no bill, and it is what CI uses. A real provider is a deliberate act.
 */
export const MODEL_PROVIDERS = ["scripted"] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];

/**
 * Grounding backends this build knows how to construct.
 *
 * The same list, the same default and the same argument one seam over:
 * `fixtures` answers from a checked-in table, so a fresh clone plans with no
 * key and no bill and CI asserts against something that does not change
 * overnight. A real backend is a deliberate act — pl-28 adds the first.
 */
export const GROUNDING_PROVIDERS = ["fixtures"] as const;
export type GroundingProviderName = (typeof GROUNDING_PROVIDERS)[number];

/**
 * Cache lifetimes, in hours, one per kind of question the seam can ask.
 *
 * A record and not two loose numbers so that the day the seam grows a third
 * method the compiler asks for its TTL, rather than a lookup quietly falling
 * back to somebody's favourite default.
 */
export interface GroundingCacheTtlHours {
  /** Where somewhere is. */
  locate: number;
  /** How far apart two places are, and how long that takes. */
  travel: number;
}

export interface ApiConfig {
  host: string;
  port: number;

  /** SQLite file. `:memory:` is honoured, and is what the tests use. */
  databasePath: string;

  modelProvider: ModelProviderName;
  /** Ceiling on one reply. See `ModelRequest.maxOutputTokens`. */
  maxOutputTokens: number;

  groundingProvider: GroundingProviderName;
  /**
   * How many grounding calls one run may make (§9).
   *
   * **Calls, not lookups.** A matrix over eight places is one call and
   * sixty-four pairs, and it is the call that costs — in latency, in rate
   * limit, and on a metered backend in money. Counting pairs would make the
   * cheap thing look expensive and push a caller back to n² pairwise requests
   * to stay under the cap. `GroundingBudget` is the shape that spends it.
   *
   * Grounding is where this tool's bill will live once a real backend is
   * configured, which is why it gets its own ceiling rather than sharing the
   * roster's.
   */
  maxGroundingCalls: number;

  /**
   * How long a grounded answer stays good, in hours, per kind of question.
   *
   * **It varies by kind because the facts do.** §5: a distance is good for a
   * year and an opening time is good for a day, and one number for both would
   * either re-measure every road every week or serve last summer's hours in
   * February. The kinds are the seam's methods, so there is a row here the day
   * `GroundingProvider` grows an `hours` method and not before — which is the
   * row `01-ARCHITECTURE.md`'s "hours for an opening time" is waiting for.
   *
   * Spent on write: `expires_at` is computed from the kind when the row is
   * stored, so changing one of these does not retroactively resurrect or kill
   * what is already in the table.
   */
  groundingCacheTtlHours: GroundingCacheTtlHours;

  /**
   * How many specialists one run may pay for (§9).
   *
   * **Kept at 5 with a roster of six for some shapes**, which means the budget
   * specialist is dropped on those trips and the plan says so — a
   * `specialist-dropped-for-budget` gap, on the stored revision, in front of the
   * user. That is the cap working rather than a bug: "run every specialist every
   * time" is not the design, the composer sums the cost bands in code whether or
   * not a budget specialist ran, and a cap nothing ever hits is not a cost
   * control. Raise it deliberately, per deployment, not to make a gap go away.
   */
  maxSpecialists: number;
  /**
   * Hard ceiling on a run's output tokens, or `undefined` for no ceiling beyond
   * `maxSpecialists`.
   *
   * Spent by degrading the roster rather than by discovering it halfway through:
   * it divides down into how many specialists this run can afford, and the lower
   * of that and `maxSpecialists` is what `runFanOut` is given. A run that stopped
   * mid-fan-out for want of budget would have paid for a plan it cannot ship.
   */
  runTokenBudget: number | undefined;
  /** Each run is itself a fan-out, so this is a memory and a spend bound. */
  maxConcurrentRuns: number;
  /**
   * Runs one client may start per minute.
   *
   * A plan run is a roster of model calls, which is expensive enough to be a
   * trivial denial of service — the architecture's security posture calls this
   * out separately from the per-run budget for that reason. Zero disables it.
   */
  rateLimitRunsPerMinute: number;

  /**
   * Built UI to serve from this process, same-origin. Undefined serves nothing,
   * which is a perfectly good headless configuration.
   */
  webDir: string | undefined;

  /** Origins allowed to call the API from a browser. Empty means same-origin only. */
  corsOrigins: readonly string[];
  logLevel: LogLevel;
}

export const API_DEFAULTS = {
  host: "127.0.0.1",
  // Not 8080: the downloader's API defaults there, and running both tools at
  // once should not need either of them reconfigured.
  port: 8090,
  dataDir: "./storage/planner",
  databaseFile: "planner.db",
  modelProvider: "scripted",
  groundingProvider: "fixtures",
  maxOutputTokens: 2_048,
  maxGroundingCalls: 40,
  // A year for a place and six months for a road. Coordinates do not move;
  // a driving time does — roadworks, a re-signed limit, a rebuilt interchange —
  // so the two differ, which is the whole reason this is per-kind. Both are
  // long because §5's argument for caching at all is that a distance is good
  // for a year and re-measuring the same road every boot is the cost this
  // exists to avoid.
  groundingCacheTtlLocateHours: 8_760,
  groundingCacheTtlTravelHours: 4_320,
  maxSpecialists: 5,
  maxConcurrentRuns: 2,
  rateLimitRunsPerMinute: 5,
  logLevel: "info",
} as const satisfies Partial<Record<string, unknown>>;

function int(
  raw: string | undefined,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** An integer that may be absent entirely, for a ceiling with no default. */
function optionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return undefined;
  return Math.trunc(value);
}

function optionalPath(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : path.resolve(value);
}

function list(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function logLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? API_DEFAULTS.logLevel).trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : "info";
}

/**
 * An unknown provider name falls back to the scripted one rather than throwing.
 *
 * The opposite of how `PROXY_URL` is treated in the downloader, and for the
 * opposite reason: a typo there sends traffic out of the wrong address, while a
 * typo here can only mean the assistant is visibly scripted — which the health
 * endpoint reports, and which nobody will mistake for a working model.
 */
function modelProvider(raw: string | undefined): ModelProviderName {
  const value = (raw ?? API_DEFAULTS.modelProvider).trim().toLowerCase();
  return (MODEL_PROVIDERS as readonly string[]).includes(value)
    ? (value as ModelProviderName)
    : API_DEFAULTS.modelProvider;
}

/**
 * Same fallback, same argument, one seam over.
 *
 * A typo cannot send a request anywhere it should not go — the fixture provider
 * reaches nothing — so the worst case is a plan whose legs are unmeasured, said
 * out loud on every affected line and reported by name at `/api/health`. That
 * is a visible failure, and refusing to boot over it would trade a plan that
 * admits what it did not check for no plan at all.
 */
function groundingProvider(raw: string | undefined): GroundingProviderName {
  const value = (raw ?? API_DEFAULTS.groundingProvider).trim().toLowerCase();
  return (GROUNDING_PROVIDERS as readonly string[]).includes(value)
    ? (value as GroundingProviderName)
    : API_DEFAULTS.groundingProvider;
}

export function loadApiConfig(
  overrides: Partial<ApiConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const rawDatabase = overrides.databasePath ?? env["DATABASE_PATH"];
  const databasePath =
    rawDatabase === ":memory:"
      ? ":memory:"
      : (rawDatabase ?? path.resolve(API_DEFAULTS.dataDir, API_DEFAULTS.databaseFile));

  return {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    databasePath,
    modelProvider: overrides.modelProvider ?? modelProvider(env["MODEL_PROVIDER"]),
    groundingProvider: overrides.groundingProvider ?? groundingProvider(env["GROUNDING_PROVIDER"]),
    maxOutputTokens:
      overrides.maxOutputTokens ??
      int(env["MAX_OUTPUT_TOKENS"], API_DEFAULTS.maxOutputTokens, { max: 32_000 }),
    maxSpecialists:
      overrides.maxSpecialists ?? int(env["MAX_SPECIALISTS"], API_DEFAULTS.maxSpecialists),
    maxGroundingCalls:
      overrides.maxGroundingCalls ??
      int(env["MAX_GROUNDING_CALLS"], API_DEFAULTS.maxGroundingCalls, { min: 0 }),
    groundingCacheTtlHours: overrides.groundingCacheTtlHours ?? {
      // `min: 0` on both: zero hours is how a deployment turns the cache off
      // without removing it, and every write it makes is expired before it
      // lands. Clamping up to one would keep serving an answer somebody
      // explicitly said not to keep.
      locate: int(
        env["GROUNDING_CACHE_TTL_LOCATE_HOURS"],
        API_DEFAULTS.groundingCacheTtlLocateHours,
        {
          min: 0,
        },
      ),
      travel: int(
        env["GROUNDING_CACHE_TTL_TRAVEL_HOURS"],
        API_DEFAULTS.groundingCacheTtlTravelHours,
        {
          min: 0,
        },
      ),
    },
    runTokenBudget: overrides.runTokenBudget ?? optionalInt(env["RUN_TOKEN_BUDGET"]),
    maxConcurrentRuns:
      overrides.maxConcurrentRuns ??
      int(env["MAX_CONCURRENT_RUNS"], API_DEFAULTS.maxConcurrentRuns),
    rateLimitRunsPerMinute:
      overrides.rateLimitRunsPerMinute ??
      int(env["RATE_LIMIT_RUNS_PER_MINUTE"], API_DEFAULTS.rateLimitRunsPerMinute, { min: 0 }),
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
  };
}
