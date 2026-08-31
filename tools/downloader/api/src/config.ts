/**
 * Environment parsing, done once at boot.
 *
 * `tools/downloader/docs/01-ARCHITECTURE.md` puts this here on purpose: the engine and the
 * resolvers are libraries that take configuration as arguments, so this app is
 * the only place `process.env` is read. Everything below it receives values.
 */

import path from "node:path";
import process from "node:process";
import { ALLOWED_SCHEMES, AppError } from "@downloader/contract";

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
   * Lets video be fetched over TLS without checking the certificate, which is
   * what happened everywhere until dl-19.
   *
   * It exists for one real case — an operator behind a TLS-intercepting
   * corporate proxy, whose certificates are re-issued by a root this process has
   * never heard of. `ffmpegCaFile` is the better answer for that operator and
   * should be tried first; this one is the answer when even that is not
   * available. `createApp` warns at boot whenever it is on, because a security
   * check that can be turned off silently is one that gets turned off and left.
   *
   * Since dl-27 the party doing the checking is the egress proxy rather than
   * ffmpeg, so this now turns it off for the segment connections as well as the
   * manifest — which is what it always read as and never was.
   */
  ffmpegAllowUnverifiedTls: boolean;
  /**
   * Whether ffmpeg's egress proxy **terminates** its TLS, which is how the
   * segment connections get verified at all. On by default; this is dl-27's
   * behaviour and the reason that ticket exists.
   *
   * Off puts ffmpeg back behind the tunnelling proxy dl-14 built, which is
   * dl-21's state exactly: the manifest connection is verified and the segments
   * are not, because libavformat propagates neither TLS option onto them.
   *
   * **It exists so that an operator broken by the interception has somewhere to
   * go that is not `ffmpegAllowUnverifiedTls`.** Those two are not
   * interchangeable and the difference is the whole point of having both: this
   * one narrows what is verified, that one stops verifying. An operator who can
   * only find the second reaches for it, and gives up the manifest check and
   * every `guardedFetch`-adjacent expectation with it, to fix a problem in the
   * proxy.
   *
   * A value this parser does not recognise falls back to the default, so a
   * typo'd `FFMPEG_TLS_INTERCEPT=flase` leaves interception **on**. That
   * direction is deliberate: for a flag whose off state reopens a hole, the
   * unparseable case has to fail closed.
   */
  ffmpegTlsIntercept: boolean;
  /**
   * An extra CA bundle for the **egress proxy** to trust, merged with the system
   * store.
   *
   * Read the noun carefully, because dl-27 moved it: ffmpeg's own trust store is
   * the root that proxy generates, and this is the file the proxy uses when it
   * verifies the real origin. It is merged rather than substituted — `-ca_file`
   * and Node's `ca` option both *replace* a store, and a deployment given only
   * its operator's root would refuse every public origin.
   *
   * **It moves back to ffmpeg when `ffmpegTlsIntercept` is off**, because then
   * ffmpeg is the party meeting the origin again and the proxy is a tunnel that
   * sees no certificate. `server.ts` picks the proxy and the trust store as one
   * decision for exactly that reason.
   */
  ffmpegCaFile: string | undefined;

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
   * Token bucket on `GET /api/files/:token`, keyed on the **file token** rather
   * than the caller — see `routes/files.ts`. Zero disables it, which is the
   * escape hatch for an operator serving large files to a small audience.
   *
   * Two orders of magnitude above the other two because the client is a video
   * player, not a form. A Chromium `<video>` issues one open-ended `Range`
   * request per completed seek, so a user dragging the scrub bar generates
   * hundreds of requests a minute with no ill intent at all; dl-23 measured
   * 207–274 in a minute of heavy scrubbing against a 39 MB clip. This is a
   * rate limit on a capability that was deliberately handed out, so it is sized
   * to leave that client alone and still cut an unmetered hammer — measured at
   * 24k requests a minute from eight sockets — by roughly forty.
   */
  rateLimitFilesPerMinute: number;
  /**
   * Whether `X-Forwarded-For` may name the client.
   *
   * Off by default, and that default is load-bearing rather than conservative:
   * the probe and jobs limits above are keyed on `request.ip`, so trusting a
   * header any client can send would turn those two into a formality. Set it to
   * `true` — or better, to the proxy's address or CIDR — only when this process
   * genuinely sits behind a proxy that overwrites the header.
   *
   * `rateLimitFilesPerMinute` is deliberately outside that dependency: it keys
   * on the file token, so it means the same thing behind a proxy, behind CGNAT
   * and with this setting off.
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
  rateLimitFilesPerMinute: 600,
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

/**
 * The egress proxy, checked at boot rather than at the first fetch.
 *
 * Before `dispatcher.ts` this value only reached subprocesses, where a typo
 * meant ffmpeg failed on a download minutes later. It now configures a
 * `ProxyAgent` at startup, and an unusable one should stop the process here —
 * a service that silently egresses from the wrong address is the failure this
 * setting exists to prevent.
 */
function proxyUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (value === "") return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError("INTERNAL", "PROXY_URL is not a valid URL.", {
      details: { hint: "Expected something like http://proxy.internal:3128" },
    });
  }
  // `ProxyAgent` speaks to the proxy over HTTP or HTTPS. A socks5:// value is
  // the common mistake, and it would otherwise fail at the first request.
  if (!(ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    throw new AppError("INTERNAL", "PROXY_URL must be an http: or https: address.", {
      details: { scheme: parsed.protocol },
    });
  }
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
    // expendability rule in tools/downloader/docs/02-ROADMAP.md.
    enableYtdlpResolver: overrides.enableYtdlpResolver ?? bool(env["ENABLE_YTDLP_RESOLVER"], true),
    enableBrowserResolver:
      overrides.enableBrowserResolver ?? bool(env["ENABLE_BROWSER_RESOLVER"], true),
    enableDirectResolver:
      overrides.enableDirectResolver ?? bool(env["ENABLE_DIRECT_RESOLVER"], true),
    proxyUrl: overrides.proxyUrl ?? proxyUrl(env["PROXY_URL"]),
    ffmpegPath: overrides.ffmpegPath ?? env["FFMPEG_PATH"] ?? undefined,
    ffmpegAllowUnverifiedTls:
      overrides.ffmpegAllowUnverifiedTls ?? bool(env["FFMPEG_ALLOW_UNVERIFIED_TLS"], false),
    ffmpegTlsIntercept: overrides.ffmpegTlsIntercept ?? bool(env["FFMPEG_TLS_INTERCEPT"], true),
    ffmpegCaFile: overrides.ffmpegCaFile ?? optionalPath(env["FFMPEG_CA_FILE"]),
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
    rateLimitFilesPerMinute:
      overrides.rateLimitFilesPerMinute ??
      int(env["RATE_LIMIT_FILES_PER_MINUTE"], API_DEFAULTS.rateLimitFilesPerMinute, { min: 0 }),
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
