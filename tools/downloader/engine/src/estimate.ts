/**
 * Pre-flight size and disk checks.
 *
 * The point is timing, not arithmetic: an eight-hour 4K manifest must be refused
 * *before* the download starts. Discovering the cap after four hours of transfer
 * has burned the bandwidth, filled the disk, and told the user nothing they
 * could not have been told immediately (analysis §7).
 *
 * When the size genuinely cannot be estimated the checks pass and the runtime
 * caps in `runner.ts` and `progressive.ts` take over. Refusing on "unknown"
 * would reject most live and manifest-only sources.
 */

import { AppError } from "@downloader/contract";
import type { MediaVariant } from "@downloader/contract";
import { freeDiskBytes } from "./storage.ts";

export type EstimateBasis =
  /** The resolver measured it (`Content-Length`, or a `filesize` from yt-dlp). */
  | "measured"
  /** The resolver supplied a figure it had already flagged as approximate. */
  | "declared-estimate"
  /** Computed here from bitrate x duration. */
  | "bitrate-duration"
  /** Neither size nor bitrate+duration was available. */
  | "unknown";

export interface SizeEstimate {
  bytes: number | null;
  basis: EstimateBasis;
  durationSec: number | null;
  bitrateBps: number | null;
}

export interface EstimateOptions {
  /** Falls back to `variant.durationSec`; pass the probe's duration when richer. */
  durationSec?: number | null;
  /**
   * Only used when `variant.audioUrl` names a *separate* rendition whose bitrate
   * is unknown — a muxed variant's bitrate already includes its audio. Erring
   * high here is deliberate: an under-estimate defeats the whole check.
   */
  assumedAudioBitrateBps?: number;
  /** Container and index overhead. */
  overheadFactor?: number;
  /** Seconds captured from a live source, which otherwise has no duration. */
  liveDurationSec?: number | null;
}

const DEFAULT_ASSUMED_AUDIO_BITRATE_BPS = 128_000;
const DEFAULT_OVERHEAD_FACTOR = 1.02;

export function estimateVariantBytes(
  variant: MediaVariant,
  options: EstimateOptions = {},
): SizeEstimate {
  const durationSec = options.liveDurationSec ?? options.durationSec ?? variant.durationSec ?? null;
  const bitrateBps = variant.bitrateBps ?? null;

  // A live capture has an explicit duration limit and a stale `filesizeBytes`
  // from the resolver would describe the whole DVR window, not our slice.
  const useDeclaredSize = options.liveDurationSec === undefined || options.liveDurationSec === null;

  if (useDeclaredSize && typeof variant.filesizeBytes === "number" && variant.filesizeBytes > 0) {
    return {
      bytes: variant.filesizeBytes,
      basis: variant.filesizeIsEstimate === true ? "declared-estimate" : "measured",
      durationSec,
      bitrateBps,
    };
  }

  if (bitrateBps !== null && bitrateBps > 0 && durationSec !== null && durationSec > 0) {
    let bitsPerSecond = bitrateBps;
    // `!== false`: an unverified track we are about to mux in should be
    // budgeted for, because over-estimating a size limit is the safe direction.
    if (
      typeof variant.audioUrl === "string" &&
      variant.audioUrl.length > 0 &&
      variant.hasAudio !== false
    ) {
      bitsPerSecond += options.assumedAudioBitrateBps ?? DEFAULT_ASSUMED_AUDIO_BITRATE_BPS;
    }
    const overhead = options.overheadFactor ?? DEFAULT_OVERHEAD_FACTOR;
    return {
      bytes: Math.round(((bitsPerSecond * durationSec) / 8) * overhead),
      basis: "bitrate-duration",
      durationSec,
      bitrateBps,
    };
  }

  return { bytes: null, basis: "unknown", durationSec, bitrateBps };
}

/**
 * Throws `SIZE_LIMIT_EXCEEDED` when the estimate is over the cap.
 *
 * Returns whether a check was actually possible, so a caller can decide to
 * insist on a runtime cap when it was not.
 */
export function assertWithinSizeLimit(
  estimate: SizeEstimate,
  maxBytes: number,
  context: Record<string, unknown> = {},
): boolean {
  if (estimate.bytes === null) return false;
  if (estimate.bytes <= maxBytes) return true;

  throw new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
    details: {
      ...context,
      estimatedBytes: estimate.bytes,
      limitBytes: maxBytes,
      basis: estimate.basis,
      ...(estimate.durationSec === null ? {} : { durationSec: estimate.durationSec }),
      ...(estimate.bitrateBps === null ? {} : { bitrateBps: estimate.bitrateBps }),
    },
  });
}

export interface DiskCheckOptions {
  /** Estimated output size. Null skips the proportional part of the check. */
  requiredBytes: number | null;
  /**
   * Multiplier on `requiredBytes`. Defaults to 2 because the working copy under
   * `tmp/` and the muxed result coexist for the duration of the mux.
   */
  headroomFactor?: number;
  /** Absolute floor of free space to leave behind. */
  minFreeBytes?: number;
  /** Injectable for tests; production uses `statfs`. */
  freeBytesImpl?: (dir: string) => Promise<number | null>;
}

const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;

/** Throws `DISK_FULL`. A platform that will not report free space passes. */
export async function assertDiskSpace(dir: string, options: DiskCheckOptions): Promise<void> {
  const free = await (options.freeBytesImpl ?? freeDiskBytes)(dir);
  if (free === null) return;

  const minFree = options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
  const needed = (options.requiredBytes ?? 0) * (options.headroomFactor ?? 2) + minFree;

  if (free < needed) {
    throw new AppError("DISK_FULL", undefined, {
      details: { freeBytes: free, neededBytes: Math.round(needed), dir },
    });
  }
}
