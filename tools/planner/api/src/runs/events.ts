/**
 * The run event hub: fan-out from one run to N SSE subscribers, and the one
 * place in this tool that turns a `RunProgress` into a `RunEvent`.
 *
 * **This is where the envelope is added.** `@planner/agent` emits the payload
 * and has no clock — the same prohibition `@planner/itinerary` carries, so that
 * the same inputs produce the same output twice. The run's id and the `at` are
 * this layer's to fill, and they are filled here rather than at each call site
 * so that no frame can be built with the wrong one.
 *
 * Deliberately **not** a replay log. A client that connects mid-run gets the
 * frames from that moment on and reconciles the past by re-fetching the plan;
 * buffering history here would mean deciding how much to keep and for how long,
 * for a client that has a simpler way to catch up. The stream sends the current
 * status immediately on connect for the same reason.
 *
 * Delivery is best-effort. A subscriber that throws — a socket that closed
 * between our check and our write — is dropped rather than allowed to break the
 * emit for everyone else: the run's progress must not depend on any listener's
 * health.
 */

import type { AppErrorPayload, RunEvent, RunProgress, RunStatus } from "@planner/contract";

export type RunEventListener = (event: RunEvent) => void;

export interface Unsubscribe {
  (): void;
}

export class RunEventHub {
  readonly #byRun = new Map<string, Set<RunEventListener>>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  subscribe(runId: string, listener: RunEventListener): Unsubscribe {
    let listeners = this.#byRun.get(runId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#byRun.set(runId, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.#byRun.get(runId);
      if (current === undefined) return;
      current.delete(listener);
      // Drop the empty set: otherwise a long-lived server accumulates one entry
      // per run it has ever served.
      if (current.size === 0) this.#byRun.delete(runId);
    };
  }

  subscriberCount(runId: string): number {
    return this.#byRun.get(runId)?.size ?? 0;
  }

  emit(event: RunEvent): void {
    if (event.type === "heartbeat") return;
    const listeners = this.#byRun.get(event.runId);
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

  status(runId: string, status: RunStatus): void {
    this.emit({ type: "status", runId, status, at: this.#now() });
  }

  /** The agent's payload, wrapped. The only transformation on the way to a client. */
  progress(runId: string, progress: RunProgress): void {
    this.emit({ type: "progress", runId, progress, at: this.#now() });
  }

  done(runId: string, planId: string, revisionId: string): void {
    this.emit({ type: "done", runId, planId, revisionId, at: this.#now() });
  }

  failed(runId: string, error: AppErrorPayload): void {
    this.emit({ type: "failed", runId, error, at: this.#now() });
  }

  canceled(runId: string, error: AppErrorPayload): void {
    this.emit({ type: "canceled", runId, error, at: this.#now() });
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}
