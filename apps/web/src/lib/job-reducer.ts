/**
 * Pure reduction of the `JobEvent` stream onto `Job` state.
 *
 * SSE is at-most-once from the client's point of view: frames are dropped while
 * disconnected and can in principle arrive out of order behind a buffering
 * proxy. Every rule below exists to make the fold total and monotonic, so a
 * late or duplicated frame can never move a job backwards. Genuine gaps are
 * repaired by re-fetching the job on reconnect (see `job-stream.ts`).
 */

import { TERMINAL_STATUSES, canTransition } from "@downloader/shared";
import type { Job, JobEvent, JobStatus, ProbeResult } from "@downloader/shared";

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
  // An illegal transition means we missed the intermediate states. Hold the
  // status and let the reconnect refetch supply the truth; guessing here would
  // put the UI in a state the server never reported.
  if (!canTransition(job.status, next)) return job;
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

/**
 * Applies one event. Always returns a `Job`; returns the *same reference* when
 * the event is a no-op, so React can skip re-rendering on heartbeats.
 */
export function applyJobEvent(job: Job, event: JobEvent): Job {
  if (event.type === "heartbeat") return job;
  if (event.jobId !== job.id) return job;
  // Terminal states are facts, not snapshots — nothing may follow them.
  if (TERMINAL_STATUSES.has(job.status)) return job;
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
