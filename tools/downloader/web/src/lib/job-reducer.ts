/**
 * Pure reduction of the `JobEvent` stream onto `Job` state.
 *
 * SSE is at-most-once from the client's point of view: frames are dropped while
 * disconnected and can in principle arrive out of order behind a buffering
 * proxy. Every rule below exists to make the fold total and monotonic, so a
 * late or duplicated frame can never move a job backwards. Genuine gaps are
 * repaired by re-fetching the job on reconnect (see `job-stream.ts`).
 */

import { TERMINAL_STATUSES } from "@downloader/contract";
import type { Job, JobEvent, JobStatus, ProbeResult } from "@downloader/contract";

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Strictly older than what we already applied. Equal timestamps are accepted. */
function isStale(job: Job, at: string): boolean {
  const eventAt = timestamp(at);
  const jobAt = timestamp(job.updatedAt);
  if (Number.isNaN(eventAt) || Number.isNaN(jobAt)) return false;
  return eventAt < jobAt;
}

function withStatus(job: Job, next: JobStatus, at: string): Job {
  if (next === job.status) return { ...job, updatedAt: at };
  // A status frame is the server *reporting* where the job is, not asking to
  // move it, so it is applied whether or not the two states are adjacent.
  //
  // This used to gate on `canTransition` and hold the old status on a jump,
  // reasoning that a non-adjacent move meant missed frames. It does — but the
  // status we skipped to came from the server too, and refusing it left the UI
  // showing a state the server had already left. The case that made it visible
  // is the common one: a job that finishes between `POST /api/jobs` returning
  // and the event stream opening sends `downloading` as its first frame, which
  // is not adjacent to `queued`, so *every* subsequent frame was refused and
  // the card sat at "Queued" forever while its bytes ticked up underneath.
  //
  // Monotonicity, which is what the gate was really protecting, is still
  // guaranteed: `applyJobEvent` drops anything that arrives after a terminal
  // state or with an older timestamp.
  return {
    ...job,
    status: next,
    updatedAt: at,
    finishedAt: TERMINAL_STATUSES.has(next) ? at : job.finishedAt,
  };
}

function withProbe(job: Job, probe: ProbeResult, at: string): Job {
  const chosen = job.variantId
    ? (probe.variants.find((variant) => variant.id === job.variantId) ?? null)
    : null;
  return {
    ...job,
    variant: chosen ?? job.variant,
    updatedAt: at,
  };
}

/** The payload half of an outcome this job has already been told about. */
function completesCurrentStatus(job: Job, event: JobEvent): boolean {
  return (
    (event.type === "completed" && job.status === "completed") ||
    (event.type === "failed" && job.status === "failed") ||
    (event.type === "canceled" && job.status === "canceled")
  );
}

/**
 * Applies one event. Always returns a `Job`; returns the *same reference* when
 * the event is a no-op, so React can skip re-rendering on heartbeats.
 */
export function applyJobEvent(job: Job, event: JobEvent): Job {
  if (event.type === "heartbeat") return job;
  if (event.jobId !== job.id) return job;
  // Terminal states are facts, not snapshots — nothing may follow them, with
  // one exception: the outcome arrives in *two* frames. The server announces
  // `status: completed` and then sends `completed`, which is the half carrying
  // the result and the download link. Rejecting everything after the first
  // left a job showing "Ready" with no file attached to it.
  //
  // Only the payload that agrees with the status already recorded gets in, so
  // a late or duplicated `failed` still cannot overturn a completed job.
  if (TERMINAL_STATUSES.has(job.status) && !completesCurrentStatus(job, event)) return job;
  if (isStale(job, event.at)) return job;

  switch (event.type) {
    case "status":
      return withStatus(job, event.status, event.at);
    case "progress": {
      // A progress frame also carries the stage, which repairs a `status` frame
      // lost while disconnected without waiting for the reconcile fetch.
      const advanced = withStatus(job, event.progress.stage, event.at);
      return { ...advanced, progress: event.progress, updatedAt: event.at };
    }
    case "probed":
      return withProbe(job, event.probe, event.at);
    case "completed":
      // Terminal events are unconditional: `canTransition` would reject
      // queued → completed, but the server saying "done" outranks our idea of
      // which intermediate states we happened to observe.
      return {
        ...job,
        status: "completed",
        result: event.result,
        error: null,
        progress: { ...job.progress, stage: "completed" },
        updatedAt: event.at,
        finishedAt: event.at,
      };
    case "failed":
      return {
        ...job,
        status: "failed",
        error: event.error,
        updatedAt: event.at,
        finishedAt: event.at,
      };
    case "canceled":
      // `error` is populated for the copy, but `status` is what the rest of the
      // UI reads — see the note on `Job` in `shared/job.ts`.
      return {
        ...job,
        status: "canceled",
        error: event.error,
        updatedAt: event.at,
        finishedAt: event.at,
      };
  }
}

export function applyJobEvents(job: Job, events: readonly JobEvent[]): Job {
  return events.reduce(applyJobEvent, job);
}

/**
 * Merges a freshly fetched job with the locally reduced one. The server is
 * authoritative unless our copy is strictly newer, which happens when an event
 * lands while the refetch is in flight.
 */
export function reconcileJob(local: Job | undefined, remote: Job): Job {
  if (!local) return remote;
  const localAt = timestamp(local.updatedAt);
  const remoteAt = timestamp(remote.updatedAt);
  if (Number.isNaN(localAt) || Number.isNaN(remoteAt)) return remote;
  return remoteAt >= localAt ? remote : local;
}

export function isTerminal(job: Job): boolean {
  return TERMINAL_STATUSES.has(job.status);
}

/** Newest first, deduplicated by id. */
export function upsertJob(jobs: readonly Job[], job: Job): Job[] {
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index === -1) return [job, ...jobs];
  const next = [...jobs];
  next[index] = job;
  return next;
}
