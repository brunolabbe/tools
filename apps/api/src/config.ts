/**
 * Environment parsing, done once at boot.
 *
 * `docs/01-ARCHITECTURE.md` puts this here on purpose: the engine and the
 * resolvers are libraries that take configuration as arguments, so this app is
 * the only place `process.env` is read. Everything below it receives values.
 */

import path from "node:path";
import process from "node:process";
import { AppError } from "@downloader/shared";

export interface ApiConfig {
  host: string;
  port: number;

  /** Root of `tmp/` and `out/`, shared with the engine. */
  storageDir: string;
  /** SQLite file. `:memory:` is honoured, and is what the tests use. */
  databasePath: string;

  maxConcurrentJobs: number;
  maxConcurrentBrowsers: number;
  /**
   * Probe requests allowed to be in flight at once, across all clients. The
   * per-IP limiter bounds one caller; this bounds a distributed flood, which
   * passes every per-IP bucket by definition.
   */
  maxConcurrentProbes: number;
  /** Budget for one resolution chain, across every tier it tries. */
  probeTimeoutMs: number;
  /** Ceiling on a single ffmpeg invocation. */
  stageTimeoutMs: number;
  maxFileSizeBytes: number;
  /** Global cap on everything under `storageDir`. Zero disables the quota. */
  maxTotalStorageBytes: number;
  fileRetentionHours: number;
  /** How often the retention sweep runs. */
  gcIntervalMs: number;
  /**
   * Probe cache TTL. Capped hard at 60 s: long enough to spare a double-click,
   * short enough that the signed URLs inside a cached result are still alive
   * (analysis §5). A longer TTL would serve dead links with a straight face.
   */
  probeCacheTtlMs: number;

  enableYtdlpResolver: boolean;
  enableBrowserResolver: boolean;
  enableDirectResolver: boolean;

  proxyUrl: string | undefined;
  ffmpegPath: string | undefined;
  ytdlpPath: string | undefined;

  /**
   * Built UI to serve from this process, same-origin. Undefined serves nothing,
   * which is a perfectly good headless configuration — see `routes/web.ts`.
   */
  webDir: string | undefined;

  /** Origins allowed to call the API from a browser. Empty means same-origin only. */
  corsOrigins: readonly string[];
  logLevel: LogLevel;

  /** Per-IP token bucket on `POST /api/probe`. Zero disables it. */
  rateLimitProbePerMinute: number;
  /** Per-IP token bucket on `POST /api/jobs`. Zero disables it. */
  rateLimitJobsPerMinute: number;
  /**
   * Whether `X-Forwarded-For` may name the client.
   *
   * Off by default, and that default is load-bearing rather than conservative:
   * every per-IP limit above is keyed on `request.ip`, so trusting a header any
   * client can send would turn the rate limiter into a formality. Set it to
   * `true` — or better, to the proxy's address or CIDR — only when this process
   * genuinely sits behind a proxy that overwrites the header.
   */
  trustProxy: boolean | string;

  /** See `SsrfGuardOptions`. Both are escape hatches for local development. */
  ssrfAllowHosts: readonly string[];
  ssrfAllowPrivateAddresses: boolean;
}

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const API_DEFAULTS = {
  host: "127.0.0.1",
  port: 8080,
  storageDir: "./storage",
  databaseFile: "jobs.db",
  maxConcurrentJobs: 2,
  maxConcurrentBrowsers: 2,
  probeTimeoutMs: 45_000,
  stageTimeoutMs: 3_600_000,
  maxFileSizeMb: 4096,
  maxTotalStorageGb: 50,
  fileRetentionHours: 6,
  gcIntervalMs: 15 * 60_000,
  probeCacheTtlMs: 30_000,
  logLevel: "info",
  rateLimitProbePerMinute: 10,
  rateLimitJobsPerMinute: 5,
} as const;

/**
 * In-flight probes allowed per configured browser slot.
 *
 * Above 1 so a probe waiting on the browser pool does not idle a slot, but
 * bounded, because each waiting request holds a socket for up to
 * `probeTimeoutMs`.
 */
const PROBES_PER_BROWSER_SLOT = 4;

/** The brief's cap. A cache that outlives the URLs it holds is worse than none. */
export const PROBE_CACHE_TTL_CEILING_MS = 60_000;

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

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

/**
 * `false` (the default), `true`, or a proxy address / CIDR / comma-separated
 * list, which Fastify accepts verbatim and is the form worth preferring.
 */
function trustProxy(raw: string | undefined): boolean | string {
  const value = raw?.trim() ?? "";
  if (value === "") return false;
  const lower = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;
  return value;
}

function logLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? API_DEFAULTS.logLevel).trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : "info";
}

export function loadApiConfig(
  overrides: Partial<ApiConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const storageDir = path.resolve(
    overrides.storageDir ?? env["STORAGE_DIR"] ?? API_DEFAULTS.storageDir,
  );
  const rawDatabase = overrides.databasePath ?? env["DATABASE_PATH"];
  const databasePath =
    rawDatabase === ":memory:"
      ? ":memory:"
      : (rawDatabase ?? path.join(storageDir, API_DEFAULTS.databaseFile));

  // Hoisted because the default probe concurrency is derived from it.
  const maxConcurrentBrowsers =
    overrides.maxConcurrentBrowsers ??
    int(env["MAX_CONCURRENT_BROWSERS"], API_DEFAULTS.maxConcurrentBrowsers, { max: 16 });

  const config: ApiConfig = {
    host: overrides.host ?? env["HOST"] ?? API_DEFAULTS.host,
    port: overrides.port ?? int(env["PORT"], API_DEFAULTS.port, { min: 0, max: 65_535 }),
    storageDir,
    databasePath,
    maxConcurrentJobs:
      overrides.maxConcurrentJobs ??
      int(env["MAX_CONCURRENT_JOBS"], API_DEFAULTS.maxConcurrentJobs, { max: 64 }),
    maxConcurrentBrowsers,
    maxConcurrentProbes:
      overrides.maxConcurrentProbes ??
      int(env["MAX_CONCURRENT_PROBES"], maxConcurrentBrowsers * PROBES_PER_BROWSER_SLOT, {
        max: 256,
      }),
    probeTimeoutMs:
      overrides.probeTimeoutMs ?? int(env["PROBE_TIMEOUT_MS"], API_DEFAULTS.probeTimeoutMs),
    stageTimeoutMs:
      overrides.stageTimeoutMs ?? int(env["JOB_TIMEOUT_MS"], API_DEFAULTS.stageTimeoutMs),
    maxFileSizeBytes:
      overrides.maxFileSizeBytes ??
      int(env["MAX_FILE_SIZE_MB"], API_DEFAULTS.maxFileSizeMb) * 1024 * 1024,
    maxTotalStorageBytes:
      overrides.maxTotalStorageBytes ??
      int(env["MAX_TOTAL_STORAGE_GB"], API_DEFAULTS.maxTotalStorageGb, { min: 0 }) *
        1024 *
        1024 *
        1024,
    fileRetentionHours:
      overrides.fileRetentionHours ??
      int(env["FILE_RETENTION_HOURS"], API_DEFAULTS.fileRetentionHours),
    gcIntervalMs: overrides.gcIntervalMs ?? int(env["GC_INTERVAL_MS"], API_DEFAULTS.gcIntervalMs),
    probeCacheTtlMs: Math.min(
      PROBE_CACHE_TTL_CEILING_MS,
      overrides.probeCacheTtlMs ??
        int(env["PROBE_CACHE_TTL_MS"], API_DEFAULTS.probeCacheTtlMs, { min: 0 }),
    ),
    // Both generic tiers default on. yt-dlp defaults on too, but its resolver
    // reports `canHandle() === false` when the binary is absent, so enabling it
    // on a machine without it is a no-op rather than an error — see the
    // expendability rule in docs/02-ROADMAP.md.
    enableYtdlpResolver: overrides.enableYtdlpResolver ?? bool(env["ENABLE_YTDLP_RESOLVER"], true),
    enableBrowserResolver:
      overrides.enableBrowserResolver ?? bool(env["ENABLE_BROWSER_RESOLVER"], true),
    enableDirectResolver:
      overrides.enableDirectResolver ?? bool(env["ENABLE_DIRECT_RESOLVER"], true),
    proxyUrl: overrides.proxyUrl ?? env["PROXY_URL"] ?? undefined,
    ffmpegPath: overrides.ffmpegPath ?? env["FFMPEG_PATH"] ?? undefined,
    ytdlpPath: overrides.ytdlpPath ?? env["YTDLP_PATH"] ?? undefined,
    // Resolved so a relative WEB_DIR means the same thing wherever the process
    // was started from, matching how storageDir is handled above.
    webDir: overrides.webDir ?? optionalPath(env["WEB_DIR"]),
    corsOrigins: overrides.corsOrigins ?? list(env["CORS_ORIGINS"]),
    logLevel: overrides.logLevel ?? logLevel(env["LOG_LEVEL"]),
    rateLimitProbePerMinute:
      overrides.rateLimitProbePerMinute ??
      int(env["RATE_LIMIT_PROBE_PER_MINUTE"], API_DEFAULTS.rateLimitProbePerMinute, { min: 0 }),
    rateLimitJobsPerMinute:
      overrides.rateLimitJobsPerMinute ??
      int(env["RATE_LIMIT_JOBS_PER_MINUTE"], API_DEFAULTS.rateLimitJobsPerMinute, { min: 0 }),
    trustProxy: overrides.trustProxy ?? trustProxy(env["TRUST_PROXY"]),
    ssrfAllowHosts: overrides.ssrfAllowHosts ?? list(env["SSRF_ALLOW_HOSTS"]),
    ssrfAllowPrivateAddresses:
      overrides.ssrfAllowPrivateAddresses ?? bool(env["SSRF_ALLOW_PRIVATE_ADDRESSES"], false),
  };

  assertUsable(config);
  return config;
}

/**
 * Refuses a configuration that cannot resolve anything.
 *
 * With every tier off, the API would accept probes and answer `NO_MEDIA_FOUND`
 * for every URL on earth — a failure that looks like broken coverage rather
 * than a misconfiguration, and one that would waste a lot of debugging.
 */
function assertUsable(config: ApiConfig): void {
  if (
    !config.enableBrowserResolver &&
    !config.enableYtdlpResolver &&
    !config.enableDirectResolver
  ) {
    throw new AppError("INTERNAL", "Every resolver tier is disabled; nothing could be resolved.", {
      details: {
        hint: "Enable at least ENABLE_BROWSER_RESOLVER or ENABLE_DIRECT_RESOLVER.",
      },
    });
  }
}
