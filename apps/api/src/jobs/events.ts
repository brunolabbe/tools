/**
 * The job event hub: fan-out from one orchestrator to N SSE subscribers.
 *
 * Deliberately **not** a replay log. A client that connects mid-job gets the
 * frames from that moment on, and reconciles the past by re-fetching the job —
 * which is what `apps/web` already does on every reconnect. Buffering history
 * here would mean deciding how much to keep and for how long, for a client that
 * has a simpler and more reliable way to catch up.
 *
 * Delivery is best-effort by design. A subscriber that throws (a socket that
 * closed between our check and our write) is dropped rather than allowed to
 * break the emit for everyone else — the orchestrator's progress must not
 * depend on any listener's health.
 */

import type { JobEvent, JobProgress, JobResult, JobStatus, ProbeResult } from "@downloader/shared";
import type { AppErrorPayload } from "@downloader/shared";

export type JobEventListener = (event: JobEvent) => void;

export interface Unsubscribe {
  (): void;
}

export class JobEventHub {
  readonly #byJob = new Map<string, Set<JobEventListener>>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  subscribe(jobId: string, listener: JobEventListener): Unsubscribe {
    let listeners = this.#byJob.get(jobId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#byJob.set(jobId, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.#byJob.get(jobId);
      if (current === undefined) return;
      current.delete(listener);
      // Drop the empty set: otherwise a long-lived server accumulates one entry
      // per job it has ever served.
      if (current.size === 0) this.#byJob.delete(jobId);
    };
  }

  subscriberCount(jobId: string): number {
    return this.#byJob.get(jobId)?.size ?? 0;
  }

  emit(event: JobEvent): void {
    const jobId = event.type === "heartbeat" ? undefined : event.jobId;
    if (jobId === undefined) return;
    const listeners = this.#byJob.get(jobId);
    if (listeners === undefined) return;
    for (const listener of new Set(listeners)) {
      try {
        listener(event);
      } catch {
        listeners.delete(listener);
      }
    }
  }

  // Typed helpers, so no call site hand-builds a frame and gets `at` wrong.

  status(jobId: string, status: JobStatus): void {
    this.emit({ type: "status", jobId, status, at: this.#now() });
  }

  progress(jobId: string, progress: JobProgress): void {
    this.emit({ type: "progress", jobId, progress, at: this.#now() });
  }

  probed(jobId: string, probe: ProbeResult): void {
    this.emit({ type: "probed", jobId, probe, at: this.#now() });
  }

  completed(jobId: string, result: JobResult): void {
    this.emit({ type: "completed", jobId, result, at: this.#now() });
  }

  failed(jobId: string, error: AppErrorPayload): void {
    this.emit({ type: "failed", jobId, error, at: this.#now() });
  }

  canceled(jobId: string, error: AppErrorPayload): void {
    this.emit({ type: "canceled", jobId, error, at: this.#now() });
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}
