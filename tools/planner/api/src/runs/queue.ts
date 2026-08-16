/**
 * In-process run queue, behind an interface so a real broker can replace it
 * later without touching a caller.
 *
 * The interface is the point. `RunQueue` says nothing about being in-process, so
 * the orchestrator, the routes and the tests all work unchanged against a
 * Redis-backed implementation. What it does commit to is the two things a
 * distributed queue also provides: a concurrency cap, and cancellation of work
 * that is queued *or* already running.
 *
 * **Cancellation is why this is not just a semaphore.** `runFanOut` takes an
 * `AbortSignal` and every in-flight `ModelRequest` carries it, so aborting the
 * controller here is what actually stops the provider calls. A cancel that only
 * moved a database row to `canceled` would leave the fan-out running and the
 * bill accruing — the trap pl-16's brief names first.
 *
 * ## Why not the downloader's `InProcessJobQueue`
 *
 * It is the same shape, and it was weighed as a candidate for `packages/core`
 * alongside the rate limiter, which did move. Two things kept it here. Its
 * `QueuedTask` is keyed on a `jobId` and it aborts with the *downloader's*
 * `AppError`, so lifting it means parameterising the error type — and the error
 * a cancellation carries is the one thing about a queue that is not generic.
 * And `01-ARCHITECTURE.md` already committed this tool to "an in-process queue,
 * as the downloader chose", which is the same decision, not the same code. If a
 * third consumer appears, lift it then and pay for the parameter once.
 */

import { AppError } from "@planner/contract";

export interface QueuedRun {
  runId: string;
  /** Receives a signal that fires on cancel *and* on shutdown. */
  run: (signal: AbortSignal) => Promise<void>;
}

export interface RunQueue {
  /** Rejects new work once `close()` has begun. */
  enqueue(task: QueuedRun): void;
  /**
   * Cancels a run whether it is waiting or running. Returns false when the run
   * is not in the queue at all — which the caller must not treat as an error,
   * since a run that finished a millisecond ago is legitimately absent.
   */
  cancel(runId: string): boolean;
  has(runId: string): boolean;
  readonly running: number;
  readonly waiting: number;
  /** Stops intake, cancels everything in flight, and waits for it to unwind. */
  close(): Promise<void>;
}

interface Entry {
  task: QueuedRun;
  controller: AbortController;
}

export interface InProcessRunQueueOptions {
  concurrency: number;
  /**
   * Called when a task rejects. The orchestrator records failure itself, so this
   * is a backstop for bugs, not the error path.
   */
  onTaskError?: (runId: string, error: unknown) => void;
}

export class InProcessRunQueue implements RunQueue {
  readonly #concurrency: number;
  readonly #onTaskError: (runId: string, error: unknown) => void;
  readonly #waiting: Entry[] = [];
  readonly #running = new Map<string, Entry>();
  readonly #settled = new Set<Promise<void>>();
  #closing = false;

  constructor(options: InProcessRunQueueOptions) {
    this.#concurrency = Math.max(1, options.concurrency);
    this.#onTaskError = options.onTaskError ?? (() => undefined);
  }

  get running(): number {
    return this.#running.size;
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  has(runId: string): boolean {
    return this.#running.has(runId) || this.#waiting.some((entry) => entry.task.runId === runId);
  }

  enqueue(task: QueuedRun): void {
    if (this.#closing) {
      throw new AppError("INTERNAL", "The server is shutting down and is not accepting new runs.", {
        details: { run: task.runId },
      });
    }
    this.#waiting.push({ task, controller: new AbortController() });
    this.#pump();
  }

  cancel(runId: string): boolean {
    const running = this.#running.get(runId);
    if (running !== undefined) {
      // A typed reason survives every layer that re-wraps an abort, so the
      // orchestrator sees JOB_CANCELED rather than having to guess — and
      // `runFanOut` can tell a cancellation from a specialist failure, which is
      // what keeps a canceled draft from being recorded as a plan with holes.
      running.controller.abort(new AppError("JOB_CANCELED"));
      return true;
    }
    const index = this.#waiting.findIndex((entry) => entry.task.runId === runId);
    if (index === -1) return false;
    const [removed] = this.#waiting.splice(index, 1);
    removed?.controller.abort(new AppError("JOB_CANCELED"));
    return true;
  }

  async close(): Promise<void> {
    this.#closing = true;
    // Queued-but-unstarted work is dropped: starting a fan-out during shutdown
    // only to abandon it halfway helps nobody, and it costs money.
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
      this.#running.set(entry.task.runId, entry);

      const promise = entry.task
        .run(entry.controller.signal)
        .catch((error: unknown) => {
          this.#onTaskError(entry.task.runId, error);
        })
        .finally(() => {
          this.#running.delete(entry.task.runId);
          this.#settled.delete(promise);
          // Only pump again once we are not closing, or a shutdown would keep
          // starting the very work it is trying to stop.
          if (!this.#closing) this.#pump();
        });
      this.#settled.add(promise);
    }
  }
}
