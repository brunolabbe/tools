/**
 * Job lifecycle contracts.
 *
 * A job is one (source URL + chosen variant) → one file on disk. The state
 * machine below is authoritative; the orchestrator must not introduce states
 * that are not listed here, and the UI may rely on the transitions being legal.
 */

import type { AppErrorPayload } from "./errors.ts";
import type { MediaVariant, ProbeResult } from "./media.ts";

export type JobStatus =
  /** Accepted, waiting for a worker slot. */
  | "queued"
  /** Re-resolving the source (fresh probe, because signed URLs expire fast). */
  | "probing"
  /** Pulling segments or bytes. This is where almost all wall-clock time goes. */
  | "downloading"
  /** ffmpeg is remuxing / joining audio+video / embedding subtitles. */
  | "muxing"
  /** File is on disk and downloadable. */
  | "completed"
  /** Terminal failure; `error` is populated. */
  | "failed"
  /** User canceled; partial artifacts cleaned up. */
  | "canceled";

/**
 * Legal transitions. Exported so the orchestrator and its tests share one
 * definition rather than each encoding the rules separately.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ["probing", "canceled", "failed"],
  probing: ["downloading", "failed", "canceled"],
  downloading: ["muxing", "completed", "failed", "canceled"],
  muxing: ["completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "completed",
  "failed",
  "canceled",
]);

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/**
 * Progress snapshot.
 *
 * Every numeric field is nullable on purpose: for a live HLS manifest or a
 * chunked response with no Content-Length there is genuinely no total, and the
 * UI must render an indeterminate state rather than a fake percentage.
 */
export interface JobProgress {
  stage: JobStatus;
  /** 0–100, or null when the total is unknown. */
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  segmentsDone: number | null;
  segmentsTotal: number | null;
  /** Bytes/sec over a trailing window, not a cumulative average. */
  speedBps: number | null;
  etaSec: number | null;
  /** Seconds of media written so far — parsed from ffmpeg's `time=` output. */
  processedSec: number | null;
}

export interface JobResult {
  /** Sanitised, filesystem-safe name derived from the source title. */
  filename: string;
  sizeBytes: number;
  container: string;
  durationSec: number | null;
  /**
   * Opaque, unguessable, time-limited URL served by the API.
   * Never a raw filesystem path, and never a predictable id.
   */
  downloadUrl: string;
  /** ISO-8601. After this the file is garbage-collected and the URL 410s. */
  expiresAt: string;
}

export interface Job {
  id: string;
  sourceUrl: string;
  /** Null until a variant is chosen (auto-select picks one during `probing`). */
  variantId: string | null;
  /** Snapshot of the chosen variant, kept so the UI can label the job after the probe ages out. */
  variant: MediaVariant | null;
  status: JobStatus;
  progress: JobProgress;
  result: JobResult | null;
  error: AppErrorPayload | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Set when the job reaches a terminal state. */
  finishedAt: string | null;
}

/**
 * Options accepted when creating a job.
 *
 * Each property is written `?: T | undefined` rather than `?: T` on purpose:
 * the repo builds with `exactOptionalPropertyTypes`, and zod's `.optional()`
 * yields `T | undefined`. Spelling it out keeps the parsed request assignable
 * to this type without a cast at the boundary.
 */
export interface JobOptions {
  /** Omit to let the server pick the highest-quality variant. */
  variantId?: string | undefined;
  /** Preferred output container. Defaults to `mp4` when codecs allow it. */
  container?: "mp4" | "mkv" | "webm" | "source" | undefined;
  /** Burn nothing in — embed as a soft subtitle track when the container supports it. */
  embedSubtitles?: boolean | undefined;
  /** BCP-47 codes to embed. Empty/omitted means none. */
  subtitleLanguages?: string[] | undefined;
  /** Strip video, keep audio only. */
  audioOnly?: boolean | undefined;
  /** For live sources: how many seconds to capture before stopping. */
  liveDurationSec?: number | undefined;
}

/** Server-Sent Events pushed on the job progress channel. */
export type JobEvent =
  | { type: "status"; jobId: string; status: JobStatus; at: string }
  | { type: "progress"; jobId: string; progress: JobProgress; at: string }
  | { type: "probed"; jobId: string; probe: ProbeResult; at: string }
  | { type: "completed"; jobId: string; result: JobResult; at: string }
  | { type: "failed"; jobId: string; error: AppErrorPayload; at: string }
  /** Periodic no-op so intermediaries do not close an idle connection. */
  | { type: "heartbeat"; at: string };
