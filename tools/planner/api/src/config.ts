/**
 * Environment parsing, done once at boot.
 *
 * This app is the only place in the tool that reads `process.env`. The agent
 * package is a library and takes its configuration — including which provider
 * to talk to — as arguments.
 */

import path from "node:path";
import process from "node:process";
import { ANTHROPIC_EFFORTS } from "@planner/agent";
import type { AnthropicEffort } from "@planner/agent";
import { AppError } from "@planner/contract";
// This tool's `trustProxy` was pl-38's deliberate duplicate of the
// downloader's; repo-40 replaced it with the shared function below, the
// planner being its second consumer. See that file for the parsing rules.
import { trustProxy } from "@webtools/core";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Model backends this build knows how to construct.
 *
 * `scripted` is the default and answers from a fixed script — see
 * `ScriptedProvider`. It means a fresh clone runs with no key, no account and
 * no bill, and it is what CI uses. A real provider is a deliberate act —
 * `anthropic` is the first (pl-39), and it does not start without a key.
 */
export const MODEL_PROVIDERS = ["scripted", "anthropic"] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];

/**
 * Grounding backends this build knows how to construct.
 *
 * The same list, the same default and the same argument one seam over:
 * `fixtures` answers from a checked-in table, so a fresh clone plans with no
 * key and no bill and CI asserts against something that does not change
 * overnight. A real backend is a deliberate act — `valhalla` is the first, and
 * it does not start without endpoints.
 */
export const GROUNDING_PROVIDERS = ["fixtures", "valhalla"] as const;
export type GroundingProviderName = (typeof GROUNDING_PROVIDERS)[number];

/**
 * Where the grounding backends live, when one is configured.
 *
 * **No defaults, on purpose.** A routing URL that quietly falls back to
 * somebody's public instance is a surprise bill or a surprise outage, and there
 * is no sensible localhost guess either — the endpoint is a fact about a
 * deployment and nothing else can know it. `createGroundingProvider` refuses to
 * boot rather than start a service that would fail on its first run.
 *
 * Two of them because **a router does not geocode**: Valhalla answers "how far
 * is it from here to there" and something else — Nominatim, on the same
 * regional extract — answers "where is this place". One seam, two services.
 */
export interface GroundingEndpoints {
  /** Valhalla's base URL. `/sources_to_targets` hangs off it. */
  routing: string | undefined;
  /** Nominatim's base URL. `/search` hangs off it. */
  geocoder: string | undefined;
  /**
   * An Overpass API instance's base URL, for `nearby` (pl-29). `/interpreter`
   * hangs off it. **Optional, unlike the two above**: a deployment can measure
   * distances and geocode without discovering anything nearby, and a run with
   * this unset simply discovers nothing rather than refusing to boot — see
   * `ValhallaProviderOptions.overpassUrl`.
   */
  discovery: string | undefined;
}

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

/**
 * What the model charges, in dollars per million tokens, one rate per kind
 * (pl-49).
 *
 * **Settings, never a table in code**: prices change, and they differ by model
 * and by platform, so the only honest source is the operator who pays the bill.
 * Each is `undefined` unless set, and `cost-report.ts` prints no dollar figure
 * while any one of them is — it names the unset ones instead of guessing a
 * rate. The server reads none of them; they are parsed here so that a bad one
 * refuses the boot, where an operator will see it, rather than surfacing only
 * the day somebody runs the report.
 */
export interface ModelPrices {
  inputPerMTok: number | undefined;
  outputPerMTok: number | undefined;
  cacheReadPerMTok: number | undefined;
  cacheWritePerMTok: number | undefined;
}

/** Which variable sets which price. The report names these when one is unset. */
export const MODEL_PRICE_VARIABLES = {
  inputPerMTok: "MODEL_PRICE_INPUT_PER_MTOK",
  outputPerMTok: "MODEL_PRICE_OUTPUT_PER_MTOK",
  cacheReadPerMTok: "MODEL_PRICE_CACHE_READ_PER_MTOK",
  cacheWritePerMTok: "MODEL_PRICE_CACHE_WRITE_PER_MTOK",
} as const satisfies Record<keyof ModelPrices, string>;

export interface ApiConfig {
  host: string;
  port: number;

  /** SQLite file. `:memory:` is honoured, and is what the tests use. */
  databasePath: string;

  modelProvider: ModelProviderName;
  /**
   * The key for `anthropic`. No default, and **never logged**: this object
   * carries it as a plain string, which is why the boot line names the provider
   * and the model and nothing else, and why nothing may log this config whole.
   * `createModelProvider` refuses to boot `anthropic` without it.
   */
  anthropicApiKey: string | undefined;
  /**
   * Which model a real provider asks. Ignored under `scripted`, which reports
   * `scripted` as its model whatever this says.
   */
  model: string;
  /**
   * How hard the model thinks, and so how much it spends. `low` by default,
   * decided with pl-39: a specialist answers in a ≈909-token reply, and the
   * top of the range earns its cost only on hard problems.
   */
  modelEffort: AnthropicEffort;
  /**
   * Per-attempt ceiling on one model call, in milliseconds.
   *
   * **Long, unlike `groundingTimeoutMs`, and for the opposite reason.** A
   * routing matrix that is slow is an instance in trouble; a model reply that
   * is slow is a model writing up to `maxOutputTokens` of thinking and JSON,
   * which is the job. Two minutes is the ceiling on that, not the expectation.
   * It still costs a queue slot while it runs, so it is not simply large — and
   * the SDK retries a timeout, so a call can hold the slot for three times this
   * before it becomes a named gap. **Unmeasured**: no key existed where it was
   * chosen, and pl-40 is where a real latency distribution replaces the guess.
   */
  modelTimeoutMs: number;
  /**
   * Ceiling on one reply. See `ModelRequest.maxOutputTokens`.
   *
   * 8,000 since pl-39, up from 2,048. A model that thinks by default counts its
   * thinking against this, so the old cap turned an ordinary reply into a
   * `length` stop and a re-ask. **It is also the divisor `runBudgetFor` spends
   * `RUN_TOKEN_BUDGET` with**, so raising it bought a quarter as many
   * specialists for the same budget — see the deployment document.
   */
  maxOutputTokens: number;
  /** What each token kind costs, for the report. See `ModelPrices`. */
  modelPrices: ModelPrices;

  groundingProvider: GroundingProviderName;
  /**
   * Where a real backend lives. Both `undefined` under the fixture default,
   * which reaches nothing. See `GroundingEndpoints`.
   */
  groundingEndpoints: GroundingEndpoints;
  /**
   * Per-request ceiling on a grounding call, in milliseconds.
   *
   * **Short on purpose.** A run holds a queue slot while it grounds and
   * `MAX_CONCURRENT_RUNS` is 2, so two requests hanging is the whole service —
   * and a routing instance rebuilding its tiles hangs rather than refuses,
   * which is the failure this bounds. A timeout maps to core's `TIMEOUT`, which
   * is retryable, and a leg nobody measured is a named gap rather than a failed
   * run: the cost of being impatient here is low and the cost of being patient
   * is the whole queue.
   */
  groundingTimeoutMs: number;
  /**
   * The same ceiling for discovery, which is a different backend entirely.
   *
   * Split from `groundingTimeoutMs` by pl-33. The paragraph above is right
   * about a routing matrix and was simply never true of an Overpass corridor
   * search: measured against the public instance with the query the adapter
   * really sends, Montréal→Québec City is 28.7 s and Montréal→Percé — this
   * tool's own motivating example — is **149 s**. One 5 s ceiling for both
   * meant discovery could not have succeeded once.
   *
   * Being impatient here costs a queue slot, exactly as above, which is why
   * this is not simply large. It is sized for a **self-hosted** Overpass over
   * a regional extract, which is what `compose.yaml` now brings up and what
   * `OVERPASS_URL` should point at; the public instance is a shared service
   * whose long-corridor latency no client-side number can fix.
   */
  groundingDiscoveryTimeoutMs: number;
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
   * Whether `X-Forwarded-For` may name the client.
   *
   * Off by default, and that default is load-bearing rather than conservative:
   * `rateLimitRunsPerMinute` is keyed on `request.ip` (`clientKey`, in
   * `@webtools/core/rate-limit`), so trusting a header any client can send would
   * let that client mint itself as many buckets as it likes, which makes the
   * limit decorative. Set it to `true` — or better, to the proxy's address or
   * CIDR — only when this process genuinely sits behind a proxy that overwrites
   * the header.
   *
   * Mirrors `ApiConfig.trustProxy` in the downloader
   * (`tools/downloader/api/src/config.ts`) — same shape, same default, same
   * argument against `true`, and since repo-40 the same parsing function
   * (pl-38 duplicated it deliberately; repo-40 lifted it to
   * `@webtools/core`). What is tool-specific is what this setting feeds —
   * this tool's own `rateLimitRunsPerMinute` bucket above, not the
   * downloader's three — which is why this field itself is not shared.
   */
  trustProxy: boolean | string;

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
  // The owner's choice for pl-39. Configurable per deployment, and ignored
  // under `scripted`.
  model: "claude-opus-5",
  modelEffort: "low",
  // Two minutes an attempt. See `ApiConfig.modelTimeoutMs`: unmeasured, and
  // pl-40 is where a real latency replaces it.
  modelTimeoutMs: 120_000,
  groundingProvider: "fixtures",
  // Duplicated as `DEFAULT_RUN_BUDGET.maxOutputTokens` in `agent/src/budget.ts`,
  // on purpose — see that constant.
  maxOutputTokens: 8_000,
  maxGroundingCalls: 40,
  // A year for a place and six months for a road. Coordinates do not move;
  // a driving time does — roadworks, a re-signed limit, a rebuilt interchange —
  // so the two differ, which is the whole reason this is per-kind. Both are
  // long because §5's argument for caching at all is that a distance is good
  // for a year and re-measuring the same road every boot is the cost this
  // exists to avoid.
  groundingCacheTtlLocateHours: 8_760,
  groundingCacheTtlTravelHours: 4_320,
  // Five seconds. A matrix over a few dozen points on a warm regional graph is
  // milliseconds; anything approaching this is an instance in trouble, and
  // waiting longer for it costs a queue slot rather than buying an answer.
  groundingTimeoutMs: 5_000,
  // Thirty seconds, for a self-hosted Overpass over a regional extract. Not
  // enough for the public instance on a long corridor (149 s, measured) — that
  // is deliberate: the fix for a shared service being slow is not to wait
  // longer for it, and a corridor that overruns now says so as a `TIMEOUT`
  // rather than returning an empty list. See pl-33.
  groundingDiscoveryTimeoutMs: 30_000,
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

/**
 * A setting that may legitimately be absent, kept as the operator wrote it.
 *
 * Trimmed and then treated as absent when empty, so `VALHALLA_URL=` in a
 * `.env` — the shape a commented-out line collapses into — means "not set"
 * rather than "set to nothing", which would otherwise reach a `new URL()` as a
 * boot crash with a confusing message.
 */
function optionalText(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : value;
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
 * A name this build does not know refuses to boot.
 *
 * **It used to fall back to `scripted`**, on the argument that a typo could only
 * mean a visibly scripted assistant. That was true while `scripted` was the only
 * name, and pl-8's Log said when it would stop being true: the day a second
 * provider exists. pl-39 is that day. `MODEL_PROVIDER=antropic` on a production
 * host would run the script and bill nothing while its operator believes a real
 * model is configured — and the operator is the one person who will not be
 * reading `/api/health` to find out. An empty value is "not set", and takes the
 * default, the same way `optionalText` treats a commented-out `.env` line.
 */
function modelProvider(raw: string | undefined): ModelProviderName {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return API_DEFAULTS.modelProvider;
  if ((MODEL_PROVIDERS as readonly string[]).includes(value)) return value as ModelProviderName;
  throw new AppError(
    "AGENT_UNCONFIGURED",
    `MODEL_PROVIDER is "${value}", which this build does not know. It is one of: ${MODEL_PROVIDERS.join(", ")}.`,
    { details: { variable: "MODEL_PROVIDER", value, known: [...MODEL_PROVIDERS] } },
  );
}

/**
 * Same refusal, one seam over — folded in with pl-39 rather than filed.
 *
 * This used to fall back to `fixtures`, argued the way `MODEL_PROVIDER`'s was:
 * the fixture provider reaches nothing, so a typo's worst case was a plan whose
 * legs said they were unmeasured. That argument is about what a *user* sees, and
 * it holds. What it missed is the operator: `GROUNDING_PROVIDER=valhala` is
 * somebody who meant a real routing engine and got a service that boots healthy
 * and never measures anything — the exact failure `createGroundingProvider`
 * already refuses for a *recognised* name with no endpoint, which is the same
 * mistake one character earlier. The two checks now agree.
 *
 * `INTERNAL` rather than `AGENT_UNCONFIGURED`: grounding is not the agent, and
 * `requiredEndpoint` already names a grounding misconfiguration that way.
 */
function groundingProvider(raw: string | undefined): GroundingProviderName {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return API_DEFAULTS.groundingProvider;
  if ((GROUNDING_PROVIDERS as readonly string[]).includes(value)) {
    return value as GroundingProviderName;
  }
  throw new AppError(
    "INTERNAL",
    `GROUNDING_PROVIDER is "${value}", which this build does not know. It is one of: ${GROUNDING_PROVIDERS.join(", ")}.`,
    { details: { variable: "GROUNDING_PROVIDER", value, known: [...GROUNDING_PROVIDERS] } },
  );
}

/**
 * An effort level the API accepts, or a refusal to boot.
 *
 * Not a fallback to `low`, for `modelProvider`'s reason: `MODEL_EFFORT=hgih` is
 * an operator who asked for more thinking and would silently get the least.
 */
function modelEffort(raw: string | undefined): AnthropicEffort {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return API_DEFAULTS.modelEffort;
  if ((ANTHROPIC_EFFORTS as readonly string[]).includes(value)) return value as AnthropicEffort;
  throw new AppError(
    "AGENT_UNCONFIGURED",
    `MODEL_EFFORT is "${value}", which is not an effort level. It is one of: ${ANTHROPIC_EFFORTS.join(", ")}.`,
    { details: { variable: "MODEL_EFFORT", value, known: [...ANTHROPIC_EFFORTS] } },
  );
}

/**
 * A price per million tokens, unset, or a refusal to boot (pl-49).
 *
 * Not `int`'s clamp-and-fall-back, for `modelEffort`'s reason:
 * `MODEL_PRICE_OUTPUT_PER_MTOK=25$` is an operator who meant a rate, and
 * silently treating it as unset turns every dollar figure into "unknown" with
 * nothing to say why. A negative rate and a non-finite one refuse too — the
 * first is a typo and the second prices every run at infinity. Blank is unset,
 * as a commented-out `.env` line collapses into.
 *
 * `INTERNAL` rather than `AGENT_UNCONFIGURED`: a price configures no assistant,
 * and that code's sentence is "no planning assistant is configured". The
 * refusal is a deployment's misconfiguration, which is what `requiredEndpoint`
 * in `server.ts` raises `INTERNAL` for.
 */
function price(raw: string | undefined, variable: string): number | undefined {
  const value = (raw ?? "").trim();
  if (value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(
      "INTERNAL",
      `${variable} is "${value}", which is not a price. It is a non-negative number of dollars per million tokens, or unset.`,
      { details: { variable, value } },
    );
  }
  return parsed;
}

/**
 * `ANTHROPIC_CUSTOM_HEADERS` refuses to boot a real model — the owner's
 * decision on pl-39, taken over re-sending the key on every request.
 *
 * The SDK reads this variable unconditionally, no client option switches it
 * off, and a header in it can replace the explicit key — reproduced with a
 * stubbed `fetch`. Re-sending `x-api-key` per request would close the key, but
 * not a stray `anthropic-beta` or any other header that changes what a request
 * does or bills. Refusing closes all of them, the same way a typo'd
 * `MODEL_PROVIDER` refuses above.
 *
 * **Only under `anthropic`.** No other provider constructs the SDK, so under
 * `scripted` the variable reaches nothing, and refusing there would stop a
 * developer whose shell exports it for other tooling from running the default.
 *
 * **Blank is unset**, and that is measured rather than assumed: SDK 0.125.0
 * trims the value and treats an empty result as absent, so a blank or
 * whitespace-only value adds no header. This trims the same way, so the two
 * cannot disagree about what "set" means.
 *
 * **The value is never repeated** in the message or the details. A variable
 * whose job is carrying headers may be carrying a key.
 */
function refuseCustomHeaders(provider: ModelProviderName, raw: string | undefined): void {
  if (provider !== "anthropic") return;
  if ((raw ?? "").trim() === "") return;
  throw new AppError(
    "AGENT_UNCONFIGURED",
    'MODEL_PROVIDER is "anthropic" and ANTHROPIC_CUSTOM_HEADERS is set. The Anthropic SDK applies that variable to every request and it can replace the configured key, so this service refuses to start with it. Unset it.',
    { details: { variable: "ANTHROPIC_CUSTOM_HEADERS" } },
  );
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

  const resolvedModelProvider = overrides.modelProvider ?? modelProvider(env["MODEL_PROVIDER"]);
  refuseCustomHeaders(resolvedModelProvider, env["ANTHROPIC_CUSTOM_HEADERS"]);

  return {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    databasePath,
    modelProvider: resolvedModelProvider,
    // Read here and nowhere else — the SDK would read it from `process.env`
    // itself if it were not handed one. Not validated here: whether a missing
    // key is a problem depends on which provider was named, which is
    // `createModelProvider`'s question.
    anthropicApiKey: overrides.anthropicApiKey ?? optionalText(env["ANTHROPIC_API_KEY"]),
    model: overrides.model ?? optionalText(env["MODEL"]) ?? API_DEFAULTS.model,
    modelEffort: overrides.modelEffort ?? modelEffort(env["MODEL_EFFORT"]),
    modelTimeoutMs:
      overrides.modelTimeoutMs ??
      int(env["MODEL_TIMEOUT_MS"], API_DEFAULTS.modelTimeoutMs, { max: 600_000 }),
    groundingProvider: overrides.groundingProvider ?? groundingProvider(env["GROUNDING_PROVIDER"]),
    // Parsed, never defaulted, and not validated here: whether a missing one is
    // a problem depends on which provider was named, which is
    // `createGroundingProvider`'s question and not this file's.
    groundingEndpoints: overrides.groundingEndpoints ?? {
      routing: optionalText(env["VALHALLA_URL"]),
      geocoder: optionalText(env["GEOCODER_URL"]),
      discovery: optionalText(env["OVERPASS_URL"]),
    },
    groundingTimeoutMs:
      overrides.groundingTimeoutMs ??
      int(env["GROUNDING_TIMEOUT_MS"], API_DEFAULTS.groundingTimeoutMs, { max: 120_000 }),
    groundingDiscoveryTimeoutMs:
      overrides.groundingDiscoveryTimeoutMs ??
      int(env["GROUNDING_DISCOVERY_TIMEOUT_MS"], API_DEFAULTS.groundingDiscoveryTimeoutMs, {
        max: 300_000,
      }),
    maxOutputTokens:
      overrides.maxOutputTokens ??
      int(env["MAX_OUTPUT_TOKENS"], API_DEFAULTS.maxOutputTokens, { max: 32_000 }),
    modelPrices: overrides.modelPrices ?? {
      inputPerMTok: price(
        env[MODEL_PRICE_VARIABLES.inputPerMTok],
        MODEL_PRICE_VARIABLES.inputPerMTok,
      ),
      outputPerMTok: price(
        env[MODEL_PRICE_VARIABLES.outputPerMTok],
        MODEL_PRICE_VARIABLES.outputPerMTok,
      ),
      cacheReadPerMTok: price(
        env[MODEL_PRICE_VARIABLES.cacheReadPerMTok],
        MODEL_PRICE_VARIABLES.cacheReadPerMTok,
      ),
      cacheWritePerMTok: price(
        env[MODEL_PRICE_VARIABLES.cacheWritePerMTok],
        MODEL_PRICE_VARIABLES.cacheWritePerMTok,
      ),
    },
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
    trustProxy: overrides.trustProxy ?? trustProxy(env["TRUST_PROXY"]),
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
  };
}
