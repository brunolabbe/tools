/**
 * Reconnecting subscription to one job's event channel.
 *
 * Two rules drive the design:
 *  - the browser's own `EventSource` retry is not good enough here, because it
 *    reconnects on a fixed interval and tells us nothing, so we close the
 *    stream on error and own the backoff;
 *  - a reconnect is *always* followed by a refetch, because every frame emitted
 *    while we were disconnected is gone for good — the reduced state is only as
 *    correct as its last reconciliation.
 */

import { TERMINAL_STATUSES } from "@downloader/shared";
import type { Job, JobEvent } from "@downloader/shared";
import { DEFAULT_BACKOFF, backoffDelay } from "./backoff.ts";
import type { BackoffOptions } from "./backoff.ts";
import { systemClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import type { EventStream, EventStreamFactory } from "./event-stream.ts";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface JobStreamOptions {
  jobId: string;
  open: EventStreamFactory;
  /** Used to reconcile after every reconnect. */
  refetch: (jobId: string) => Promise<Job>;
  onEvent: (event: JobEvent) => void;
  /** Result of a reconcile fetch. */
  onReconciled?: (job: Job) => void;
  onReconcileError?: (error: unknown) => void;
  onStateChange?: (state: StreamState) => void;
  clock?: Clock;
  backoff?: BackoffOptions;
  random?: () => number;
  /** Give up after this many consecutive failures. */
  maxAttempts?: number;
}

export interface JobStream {
  start(): void;
  stop(): void;
  readonly state: StreamState;
  /** Consecutive failed connections since the last successful open. */
  readonly attempt: number;
}

export function createJobStream(options: JobStreamOptions): JobStream {
  const clock = options.clock ?? systemClock;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxAttempts ?? 8;

  let state: StreamState = "idle";
  let attempt = 0;
  let connections = 0;
  let stream: EventStream | null = null;
  let cancelTimer: (() => void) | null = null;
  let stopped = false;

  function setState(next: StreamState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function closeStream(): void {
    stream?.close();
    stream = null;
  }

  function connect(): void {
    if (stopped) return;
    setState(connections === 0 ? "connecting" : "reconnecting");
    const isReconnect = connections > 0;
    connections += 1;
    stream = options.open(options.jobId, {
      onOpen() {
        if (stopped) return;
        attempt = 0;
        setState("open");
        if (isReconnect) void reconcile();
      },
      onEvent(event) {
        if (stopped) return;
        options.onEvent(event);
        if (isTerminalEvent(event)) stop();
      },
      onError() {
        if (stopped) return;
        closeStream();
        scheduleReconnect();
      },
    });
  }

  async function reconcile(): Promise<void> {
    try {
      const job = await options.refetch(options.jobId);
      if (stopped) return;
      options.onReconciled?.(job);
      if (TERMINAL_STATUSES.has(job.status)) stop();
    } catch (error) {
      if (stopped) return;
      options.onReconcileError?.(error);
    }
  }

  function scheduleReconnect(): void {
    attempt += 1;
    if (attempt > maxAttempts) {
      stop();
      return;
    }
    setState("reconnecting");
    cancelTimer = clock.schedule(
      () => {
        cancelTimer = null;
        connect();
      },
      backoffDelay(attempt, backoff, random),
    );
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelTimer?.();
    cancelTimer = null;
    closeStream();
    setState("closed");
  }

  return {
    start() {
      if (stopped || connections > 0) return;
      connect();
    },
    stop,
    get state() {
      return state;
    },
    get attempt() {
      return attempt;
    },
  };
}

/**
 * Only the frames that *carry* the outcome end the stream.
 *
 * A terminal `status` frame used to count, which raced the server: it sends
 * `status: completed` and then `completed` — the frame holding the result and
 * the download link — back to back. Closing the socket on the first one threw
 * the second away, and the job finished with no file to download.
 *
 * Nothing hangs if a payload frame is lost instead: the server ends the stream
 * on its own after a terminal state, which surfaces here as an error, and the
 * reconnect's mandatory refetch supplies the outcome.
 */
function isTerminalEvent(event: JobEvent): boolean {
  return event.type === "completed" || event.type === "failed" || event.type === "canceled";
}
