/**
 * The run queue.
 *
 * Two properties, and they are the two a distributed queue would also have to
 * provide: a concurrency cap, because each run is itself a fan-out, and
 * cancellation of work that is waiting *or* already running. The second is the
 * one that matters most — the signal this hands a task is the signal every
 * in-flight `ModelRequest` carries, so a cancel that did not reach it would
 * leave the fan-out running and the bill accruing.
 */

import { describe, expect, test } from "vitest";
import { AppError } from "@planner/contract";
import { InProcessRunQueue } from "../src/runs/queue.ts";
import { deferred } from "./helpers/runs.ts";

/** A task that parks until the test releases it, or until it is aborted. */
function parked(): {
  run: (signal: AbortSignal) => Promise<void>;
  started: Promise<void>;
  release: () => void;
  aborts: { reason: unknown }[];
} {
  const aborts: { reason: unknown }[] = [];
  const entered = deferred();
  const open = deferred();

  return {
    started: entered.promise,
    release: open.resolve,
    aborts,
    run: async (signal: AbortSignal) => {
      entered.resolve();
      await Promise.race([
        open.promise,
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborts.push({ reason: signal.reason });
            reject(signal.reason as Error);
          });
        }),
      ]);
    },
  };
}

describe("the run queue", () => {
  test("runs up to the concurrency cap and holds the rest", async () => {
    const queue = new InProcessRunQueue({ concurrency: 2 });
    const first = parked();
    const second = parked();
    const third = parked();

    queue.enqueue({ runId: "a", run: first.run });
    queue.enqueue({ runId: "b", run: second.run });
    queue.enqueue({ runId: "c", run: third.run });

    await Promise.all([first.started, second.started]);
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(1);

    first.release();
    await third.started;
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(0);

    second.release();
    third.release();
    await queue.close();
  });

  test("cancels a running task with a typed reason the fan-out understands", async () => {
    const queue = new InProcessRunQueue({ concurrency: 1 });
    const task = parked();
    queue.enqueue({ runId: "a", run: task.run });
    await task.started;

    expect(queue.cancel("a")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Typed rather than a bare abort: `runFanOut` tells a cancellation from a
    // specialist failure by this code, and that is what keeps a canceled draft
    // from being recorded as a completed plan with holes.
    expect(task.aborts).toHaveLength(1);
    expect(AppError.from(task.aborts[0]?.reason).code).toBe("JOB_CANCELED");
    await queue.close();
  });

  test("cancels a task that has not started yet", async () => {
    const queue = new InProcessRunQueue({ concurrency: 1 });
    const running = parked();
    const waiting = parked();
    queue.enqueue({ runId: "a", run: running.run });
    queue.enqueue({ runId: "b", run: waiting.run });
    await running.started;

    expect(queue.has("b")).toBe(true);
    expect(queue.cancel("b")).toBe(true);
    expect(queue.has("b")).toBe(false);

    running.release();
    await queue.close();
  });

  test("cancelling a run it has never heard of is false, not an error", () => {
    const queue = new InProcessRunQueue({ concurrency: 1 });
    // A run that finished a millisecond ago is legitimately absent, and the
    // caller must not treat that as a failure.
    expect(queue.cancel("gone")).toBe(false);
  });

  test("a task that rejects is reported and does not stall the queue", async () => {
    const seen: string[] = [];
    const queue = new InProcessRunQueue({
      concurrency: 1,
      onTaskError: (runId) => {
        seen.push(runId);
      },
    });

    queue.enqueue({
      runId: "a",
      run: async () => {
        throw new AppError("INTERNAL");
      },
    });
    const next = parked();
    queue.enqueue({ runId: "b", run: next.run });

    await next.started;
    expect(seen).toEqual(["a"]);

    next.release();
    await queue.close();
  });

  test("closing stops intake and cancels everything in flight", async () => {
    const queue = new InProcessRunQueue({ concurrency: 1 });
    const task = parked();
    queue.enqueue({ runId: "a", run: task.run });
    await task.started;

    await queue.close();
    expect(task.aborts).toHaveLength(1);
    expect(() => {
      queue.enqueue({ runId: "b", run: async () => undefined });
    }).toThrow(AppError);
  });
});
