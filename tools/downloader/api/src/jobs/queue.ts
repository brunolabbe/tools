/**
 * In-process job queue, behind an interface so BullMQ can replace it later
 * without touching a caller.
 *
 * The interface is the point. `JobQueue` says nothing about being in-process,
 * so the orchestrator, the routes and the tests all work unchanged against a
 * Redis-backed implementation. What it does commit to is the two things a
 * distributed queue also provides: a concurrency cap, and cancellation of work
 * that is queued *or* already running.
 *
 * A browser probe costs ~15 s and ~300 MB, so `MAX_CONCURRENT_JOBS` is a memory
 * bound, not a politeness setting.
 */

import { AppError } from "@downloader/contract";

export interface QueuedTask {
  jobId: string;
  /** Receives a signal that fires on cancel *and* on shutdown. */
  run: (signal: AbortSignal) => Promise<void>;
}

export interface JobQueue {
  /** Rejects new work once `close()` has begun. */
  enqueue(task: QueuedTask): void;
  /**
   * Cancels a job whether it is waiting or running. Returns false when the job
   * is not in the queue at all — which the caller must not treat as an error,
   * since a job that finished a millisecond ago is legitimately absent.
   */
  cancel(jobId: string): boolean;
  has(jobId: string): boolean;
  readonly running: number;
  readonly waiting: number;
  /** Stops intake, cancels everything in flight, and waits for it to unwind. */
  close(): Promise<void>;
}

interface Entry {
  task: QueuedTask;
  controller: AbortController;
}

export interface InProcessQueueOptions {
  concurrency: number;
  /** Called when a task rejects. The orchestrator records failure itself, so
   *  this is a backstop for bugs, not the error path. */
  onTaskError?: (jobId: string, error: unknown) => void;
}

export class InProcessJobQueue implements JobQueue {
  readonly #concurrency: number;
  readonly #onTaskError: (jobId: string, error: unknown) => void;
  readonly #waiting: Entry[] = [];
  readonly #running = new Map<string, Entry>();
  readonly #settled = new Set<Promise<void>>();
  #closing = false;

  constructor(options: InProcessQueueOptions) {
    this.#concurrency = Math.max(1, options.concurrency);
    this.#onTaskError = options.onTaskError ?? (() => undefined);
  }

  get running(): number {
    return this.#running.size;
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  has(jobId: string): boolean {
    return this.#running.has(jobId) || this.#waiting.some((entry) => entry.task.jobId === jobId);
  }

  enqueue(task: QueuedTask): void {
    if (this.#closing) {
      throw new AppError("INTERNAL", "The server is shutting down and is not accepting new jobs.", {
        details: { jobId: task.jobId },
      });
    }
    this.#waiting.push({ task, controller: new AbortController() });
    this.#pump();
  }

  cancel(jobId: string): boolean {
    const running = this.#running.get(jobId);
    if (running !== undefined) {
      // A typed reason survives every layer that re-wraps an abort, so the
      // orchestrator sees JOB_CANCELED rather than having to guess.
      running.controller.abort(new AppError("JOB_CANCELED"));
      return true;
    }
    const index = this.#waiting.findIndex((entry) => entry.task.jobId === jobId);
    if (index === -1) return false;
    const [removed] = this.#waiting.splice(index, 1);
    removed?.controller.abort(new AppError("JOB_CANCELED"));
    return true;
  }

  async close(): Promise<void> {
    this.#closing = true;
    // Queued-but-unstarted work is dropped: starting a download during shutdown
    // only to abandon it half-written helps nobody.
    while (this.#waiting.length > 0) {
      const entry = this.#waiting.pop();
      entry?.controller.abort(new AppError("JOB_CANCELED"));
    }
    for (const entry of this.#running.values()) {
      entry.controller.abort(new AppError("JOB_CANCELED"));
    }
    await Promise.allSettled(this.#settled);
  }

  #pump(): void {
    while (this.#running.size < this.#concurrency && this.#waiting.length > 0) {
      const entry = this.#waiting.shift();
      if (entry === undefined) return;
      this.#running.set(entry.task.jobId, entry);

      const promise = entry.task
        .run(entry.controller.signal)
        .catch((error: unknown) => {
          this.#onTaskError(entry.task.jobId, error);
        })
        .finally(() => {
          this.#running.delete(entry.task.jobId);
          this.#settled.delete(promise);
          // Only pump again once we are not closing, or a shutdown would keep
          // starting the very work it is trying to stop.
          if (!this.#closing) this.#pump();
        });
      this.#settled.add(promise);
    }
  }
}
