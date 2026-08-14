/**
 * Engine configuration.
 *
 * The engine is a library: it takes its configuration as an argument rather than
 * reading `process.env` behind the caller's back. `loadEngineConfig()` exists so
 * the CLI and tests have a one-liner, but `apps/api` is expected to parse and
 * validate the environment once at boot (per docs/01-ARCHITECTURE.md) and pass
 * the values in explicitly.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { AppError } from "@downloader/contract";
import type { Logger } from "./logger.ts";
import { NOOP_LOGGER } from "./logger.ts";

/** A `fetch`-shaped function. Injectable so callers can supply a proxy dispatcher. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Wall-clock seam so retry/GC/rate logic is testable without real time. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new AppError("JOB_CANCELED"));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      function onAbort(): void {
        clearTimeout(timer);
        reject(new AppError("JOB_CANCELED"));
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

export interface EngineConfig {
  /** Root of `tmp/` and `out/`. Every output path is verified to resolve inside it. */
  storageDir: string;
  /** Absolute path to the ffmpeg binary. */
  ffmpegPath: string;
  /** Per-job output cap. Checked from bitrate x duration *before* downloading. */
  maxFileSizeBytes: number;
  /**
   * Global cap on everything under `storageDir`, `tmp/` included. Zero disables
   * it. Distinct from the free-space check in `estimate.ts`: that one protects
   * the volume, this one protects everything *else* sharing the volume.
   */
  maxTotalStorageBytes: number;
  /** How long finished artifacts survive the retention sweep. */
  fileRetentionHours: number;
  /** How long a `tmp/<jobId>` directory may sit untouched before it counts as orphaned. */
  tmpRetentionHours: number;
  /** Hard wall-clock ceiling on a single ffmpeg invocation. */
  stageTimeoutMs: number;
  /** Concurrent segment fetches on the manual (non-ffmpeg) download path. */
  segmentConcurrency: number;
  /** Retry budget for a single HTTP request, including the first attempt. */
  maxAttempts: number;
  /** First backoff delay; doubles each attempt up to `maxBackoffMs`. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /**
   * Applies to downloading as well as probing — signed URLs are frequently
   * IP-bound, so a mismatched egress between the two produces 403s that look
   * like random flakes (analysis 5).
   */
  proxyUrl: string | undefined;
  /**
   * Node's global `fetch` has no proxy support. When `proxyUrl` is set the
   * caller must supply a dispatcher-aware fetch here; the engine warns and
   * proceeds unproxied otherwise rather than silently ignoring the setting.
   */
  fetchImpl: FetchLike;
  clock: Clock;
  logger: Logger;
}

export type EngineConfigInput = Partial<EngineConfig>;

/**
 * Path to the bundled ffmpeg. Resolved through `createRequire` rather than an
 * ESM default import because `ffmpeg-static` is CommonJS whose `module.exports`
 * *is* the string; the interop shape of a default import differs between the
 * type checker and the runtime.
 */
export function bundledFfmpegPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved: unknown = require("ffmpeg-static");
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

export function resolveFfmpegPath(override?: string | undefined): string {
  const candidate = override ?? process.env["FFMPEG_PATH"] ?? bundledFfmpegPath();
  if (candidate === null || candidate === undefined || candidate.length === 0) {
    throw new AppError("INTERNAL", "No ffmpeg binary is available.", {
      details: { hint: "Set FFMPEG_PATH or install ffmpeg-static for this platform." },
    });
  }
  return candidate;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Separate from `positiveNumber` because zero is a meaningful value: "no cap". */
function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const ENGINE_DEFAULTS = {
  storageDir: "./storage",
  maxFileSizeMb: 4096,
  maxTotalStorageGb: 50,
  fileRetentionHours: 6,
  tmpRetentionHours: 6,
  stageTimeoutMs: 3_600_000,
  segmentConcurrency: 6,
  maxAttempts: 5,
  baseBackoffMs: 500,
  maxBackoffMs: 30_000,
} as const;

/** Builds a config from explicit overrides, falling back to env, then defaults. */
export function loadEngineConfig(
  input: EngineConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const storageDir = path.resolve(
    input.storageDir ?? env["STORAGE_DIR"] ?? ENGINE_DEFAULTS.storageDir,
  );
  const maxFileSizeBytes =
    input.maxFileSizeBytes ??
    positiveNumber(env["MAX_FILE_SIZE_MB"], ENGINE_DEFAULTS.maxFileSizeMb) * 1024 * 1024;

  return {
    storageDir,
    ffmpegPath: input.ffmpegPath ?? resolveFfmpegPath(env["FFMPEG_PATH"]),
    maxFileSizeBytes,
    maxTotalStorageBytes:
      input.maxTotalStorageBytes ??
      nonNegativeNumber(env["MAX_TOTAL_STORAGE_GB"], ENGINE_DEFAULTS.maxTotalStorageGb) *
        1024 *
        1024 *
        1024,
    fileRetentionHours:
      input.fileRetentionHours ??
      positiveNumber(env["FILE_RETENTION_HOURS"], ENGINE_DEFAULTS.fileRetentionHours),
    tmpRetentionHours:
      input.tmpRetentionHours ??
      positiveNumber(env["FILE_RETENTION_HOURS"], ENGINE_DEFAULTS.tmpRetentionHours),
    stageTimeoutMs:
      input.stageTimeoutMs ?? positiveNumber(env["JOB_TIMEOUT_MS"], ENGINE_DEFAULTS.stageTimeoutMs),
    segmentConcurrency: input.segmentConcurrency ?? ENGINE_DEFAULTS.segmentConcurrency,
    maxAttempts: input.maxAttempts ?? ENGINE_DEFAULTS.maxAttempts,
    baseBackoffMs: input.baseBackoffMs ?? ENGINE_DEFAULTS.baseBackoffMs,
    maxBackoffMs: input.maxBackoffMs ?? ENGINE_DEFAULTS.maxBackoffMs,
    proxyUrl: input.proxyUrl ?? env["PROXY_URL"] ?? undefined,
    fetchImpl: input.fetchImpl ?? globalThis.fetch,
    clock: input.clock ?? SYSTEM_CLOCK,
    logger: input.logger ?? NOOP_LOGGER,
  };
}
