/**
 * Job lifecycle contracts.
 *
 * A job is one (source URL + chosen variant) → one file streamed to the visitor
 * who opened its link, as ffmpeg produces it, with no copy kept (dl-53). The
 * state machine below is authoritative; the orchestrator must not introduce
 * states that are not listed here, and the UI may rely on the transitions being
 * legal.
 */

import { isLegalTransition, terminalStatuses, type TransitionTable } from "@webtools/core";
import type { AppErrorPayload } from "./errors.ts";
import type { MediaVariant, ProbeResult } from "./media.ts";

/**
 * Written as a const tuple with the union derived from it, matching
 * `ERROR_CODES`. The array is what `jobStatusSchema` validates against, so
 * there is exactly one list and a schema cannot fall out of step with the type.
 */
export const JOB_STATUSES = [
  /**
   * Accepted, and holding a link nobody has opened yet. Opening it is what
   * starts the work; until then the job holds no slot.
   */
  "queued",
  /** Re-resolving the source (fresh probe, because signed URLs expire fast). */
  "probing",
  /**
   * Bytes are going to the visitor as ffmpeg produces them — fetching, joining
   * audio and video and embedding subtitles all happen in this one pass, which
   * is why there is no separate `muxing` state any more (dl-53).
   */
  "downloading",
  /** The stream reached its end: the visitor has the whole file. Nothing is kept. */
  "completed",
  /** Terminal failure; `error` is populated. */
  "failed",
  /**
   * Stopped by the visitor — the cancel button, a closed tab or a dropped
   * connection — or its link expired unopened. `error` carries `JOB_CANCELED`,
   * and `error.details.reason` says which. Not a failure of the tool (dl-57).
   */
  "canceled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Legal transitions. Exported so the orchestrator and its tests share one
 * definition rather than each encoding the rules separately.
 *
 * **`downloading → probing` is the one back-edge**, and it is deliberate. A
 * signed media URL that expires mid-download is not a failure of the job, it is
 * a reason to resolve the source again — so the job genuinely returns to
 * probing, and says so, rather than re-probing while still reporting
 * `downloading`. Bounded by the orchestrator, which retries once (dl-9).
 *
 * **Only before the first byte** (dl-53). Once a byte has gone to the visitor
 * there is nothing to restart: a second attempt would begin a second file on a
 * response that is already half the first, so a later failure ends the job.
 */
export const JOB_TRANSITIONS: TransitionTable<JobStatus> = {
  queued: ["probing", "canceled", "failed"],
  probing: ["downloading", "failed", "canceled"],
  downloading: ["probing", "completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

/** Derived from the table above — a status with nowhere to go is terminal. */
export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = terminalStatuses(JOB_TRANSITIONS);

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return isLegalTransition(JOB_TRANSITIONS, from, to);
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

/**
 * What a finished stream was. There is no link here any more: the file went to
 * the visitor who opened the job's link and no copy exists to link to (dl-53).
 */
export interface JobResult {
  /** Sanitised, filesystem-safe name derived from the source title. */
  filename: string;
  /** Bytes sent to the visitor. */
  sizeBytes: number;
  container: string;
  durationSec: number | null;
}

/**
 * The single-use link that starts a job (dl-53).
 *
 * Opening it takes a job slot, re-probes and streams the file on that same
 * response. It works **once**: a second `GET` answers `410`, and so does one
 * after `expiresAt`. A shared link is therefore not a copy of a download — it
 * is either the download, or nothing.
 */
export interface JobLink {
  /**
   * Opaque, unguessable URL served by the API — `ROUTES.file(token)`.
   * Never a predictable id, and never derived from the job id.
   */
  url: string;
  /** ISO-8601. After this, an unopened link answers `410` and the job is canceled. */
  expiresAt: string;
}

/**
 * A job record.
 *
 * **`status` is authoritative for cancellation.** "Canceled" is representable
 * two ways — `status === "canceled"` and an `error` carrying `JOB_CANCELED` —
 * and only the first is load-bearing. The orchestrator sets both: `error` exists
 * so a client has copy to render and a `retryable` flag to obey, but a client
 * deciding *whether* a job was canceled must read `status` and nothing else.
 * Never infer the status from the error code.
 */
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
  /**
   * Snapshot of the preview image's **proxied path** — `/api/thumbnail/<token>`
   * on this API, never the origin URL a page named. Kept for the same reason
   * `variant` is: so the downloads list can still show the video after the
   * probe has aged out.
   *
   * Optional as well as nullable, and deliberately: the field is newer than the
   * `downloader:jobs:v1` records in browsers today, and `jobSchema` is what
   * those records are re-read through. See the note in `api.ts`.
   */
  thumbnailPath?: string | null | undefined;
  /**
   * The link that starts this job, while it can still be opened; null once it
   * has been opened or has expired. Optional as well as nullable for the same
   * reason `thumbnailPath` is: records persisted before dl-53 do not carry it.
   */
  link?: JobLink | null | undefined;
}

/** Containers a caller may ask for. `source` means "keep the origin container". */
export const CONTAINER_OPTIONS = ["mp4", "mkv", "webm", "source"] as const;

export type ContainerOption = (typeof CONTAINER_OPTIONS)[number];

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
  container?: ContainerOption | undefined;
  /** Burn nothing in — embed as a soft subtitle track when the container supports it. */
  embedSubtitles?: boolean | undefined;
  /** BCP-47 codes to embed. Empty/omitted means none. */
  subtitleLanguages?: string[] | undefined;
  /** Strip video, keep audio only. */
  audioOnly?: boolean | undefined;
  /** For live sources: how many seconds to capture before stopping. */
  liveDurationSec?: number | undefined;
}

/**
 * Server-Sent Events pushed on the job progress channel.
 *
 * The three terminal statuses each get their own frame carrying the payload
 * that explains them — `completed` its `JobResult`, `failed` and `canceled`
 * their `AppErrorPayload`. A client that only listens therefore never has to
 * synthesise the reason a job ended, and never has to re-fetch to find it.
 * A `status` frame is still emitted alongside each of them, so a client that
 * only tracks state can ignore the payload frames entirely.
 */
export type JobEvent =
  | { type: "status"; jobId: string; status: JobStatus; at: string }
  | { type: "progress"; jobId: string; progress: JobProgress; at: string }
  | { type: "probed"; jobId: string; probe: ProbeResult; at: string }
  | { type: "completed"; jobId: string; result: JobResult; at: string }
  | { type: "failed"; jobId: string; error: AppErrorPayload; at: string }
  /** Carries the `JOB_CANCELED` payload; `status` remains the authority. */
  | { type: "canceled"; jobId: string; error: AppErrorPayload; at: string }
  /** Periodic no-op so intermediaries do not close an idle connection. */
  | { type: "heartbeat"; at: string };
