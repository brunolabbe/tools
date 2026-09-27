/**
 * Engine configuration.
 *
 * The engine is a library: it takes its configuration as an argument rather than
 * reading `process.env` behind the caller's back. `loadEngineConfig()` exists so
 * the CLI and tests have a one-liner, but `apps/api` is expected to parse and
 * validate the environment once at boot (per tools/downloader/docs/01-ARCHITECTURE.md) and pass
 * the values in explicitly.
 */

import { createRequire } from "node:module";
import { AppError } from "@downloader/contract";
import type { Logger } from "./logger.ts";
import { NOOP_LOGGER } from "./logger.ts";

export interface EngineConfig {
  /** Absolute path to the ffmpeg binary. */
  ffmpegPath: string;
  /**
   * Per-job output cap. Checked from bitrate x duration before the stream
   * starts, and on the bytes themselves while it runs (dl-53).
   */
  maxFileSizeBytes: number;
  /** Hard wall-clock ceiling on a single ffmpeg invocation. */
  stageTimeoutMs: number;
  /**
   * Applies to downloading as well as probing — signed URLs are frequently
   * IP-bound, so a mismatched egress between the two produces 403s that look
   * like random flakes (analysis 5).
   */
  proxyUrl: string | undefined;
  /**
   * Whether ffmpeg checks the certificates it is encrypting to.
   *
   * On by default, which libavformat is not: `tls_verify` defaults to `0`
   * there. The engine's own fetches have always verified — undici does it
   * without being asked — so before dl-19 the manifest path was the unverified
   * half of the same tool, and nothing about a URL said which half you got.
   */
  tlsVerify: boolean;
  /**
   * A CA bundle for ffmpeg to trust instead of the system store. Unset means
   * the system store, which is what both ffmpeg builds this repo runs actually
   * use — measured in dl-19, not assumed.
   *
   * The environment fallback reads `EGRESS_CA_FILE` first and `FFMPEG_CA_FILE`
   * second, matching the API's alias policy. It matters only for a caller that
   * passes nothing — `scripts/download.ts`, the M1 CLI — because `api` always
   * supplies this explicitly on the path where it can differ.
   */
  tlsCaFile: string | undefined;
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

/**
 * Only the exact words. A typo'd `FFMPEG_ALLOW_UNVERIFIED_TLS=ture` must not
 * quietly read as "off" for a flag whose whole job is to be deliberate.
 */
function boolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

export const ENGINE_DEFAULTS = {
  maxFileSizeMb: 4096,
  stageTimeoutMs: 3_600_000,
} as const;

/** Builds a config from explicit overrides, falling back to env, then defaults. */
export function loadEngineConfig(
  input: EngineConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const maxFileSizeBytes =
    input.maxFileSizeBytes ??
    positiveNumber(env["MAX_FILE_SIZE_MB"], ENGINE_DEFAULTS.maxFileSizeMb) * 1024 * 1024;

  return {
    ffmpegPath: input.ffmpegPath ?? resolveFfmpegPath(env["FFMPEG_PATH"]),
    maxFileSizeBytes,
    stageTimeoutMs:
      input.stageTimeoutMs ?? positiveNumber(env["JOB_TIMEOUT_MS"], ENGINE_DEFAULTS.stageTimeoutMs),
    proxyUrl: input.proxyUrl ?? env["PROXY_URL"] ?? undefined,
    tlsVerify: input.tlsVerify ?? !boolean(env["FFMPEG_ALLOW_UNVERIFIED_TLS"], false),
    tlsCaFile: input.tlsCaFile ?? env["EGRESS_CA_FILE"] ?? env["FFMPEG_CA_FILE"] ?? undefined,
    logger: input.logger ?? NOOP_LOGGER,
  };
}
