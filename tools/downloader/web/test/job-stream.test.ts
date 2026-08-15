import { describe, expect, test, vi } from "vitest";
import type { Job, JobEvent } from "@downloader/contract";
import { DEFAULT_BACKOFF, backoffDelay } from "../src/lib/backoff.ts";
import type { EventStreamHandlers } from "../src/lib/event-stream.ts";
import { createJobStream } from "../src/lib/job-stream.ts";
import type { StreamState } from "../src/lib/job-stream.ts";
import { createFakeClock, flush } from "./helpers.ts";

function stubJob(status: Job["status"] = "downloading"): Job {
  return {
    id: "job-1",
    sourceUrl: "https://videos.example.com/watch/sample",
    variantId: null,
    variant: null,
    status,
    progress: {
      stage: status,
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      segmentsDone: null,
      segmentsTotal: null,
      speedBps: null,
      etaSec: null,
      processedSec: null,
    },
    result: null,
    error: null,
    attempts: 0,
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    finishedAt: null,
  };
}

interface Harness {
  connections: EventStreamHandlers[];
  closed: number;
}

function setup(overrides: { refetch?: () => Promise<Job>; maxAttempts?: number } = {}) {
  const fake = createFakeClock();
  const harness: Harness = { connections: [], closed: 0 };
  const events: JobEvent[] = [];
  const reconciled: Job[] = [];
  const states: StreamState[] = [];
  const refetch = vi.fn(overrides.refetch ?? (() => Promise.resolve(stubJob())));

  const stream = createJobStream({
    jobId: "job-1",
    open: (_jobId, handlers) => {
      harness.connections.push(handlers);
      return {
        close: () => {
          harness.closed += 1;
        },
      };
    },
    refetch,
    onEvent: (event) => events.push(event),
    onReconciled: (job) => reconciled.push(job),
    onStateChange: (state) => states.push(state),
    clock: fake.clock,
    // 0.5 is the jitter midpoint, so the schedule is exactly exponential.
    random: () => 0.5,
    ...(overrides.maxAttempts === undefined ? {} : { maxAttempts: overrides.maxAttempts }),
  });

  return { fake, harness, events, reconciled, states, refetch, stream };
}

/** 0.5 is the jitter midpoint, so the schedule is exactly exponential. */
const half = (): number => 0.5;

describe("backoffDelay", () => {
  test("is exponential and capped", () => {
    expect(backoffDelay(1, DEFAULT_BACKOFF, half)).toBe(500);
    expect(backoffDelay(2, DEFAULT_BACKOFF, half)).toBe(1_000);
    expect(backoffDelay(3, DEFAULT_BACKOFF, half)).toBe(2_000);
    expect(backoffDelay(4, DEFAULT_BACKOFF, half)).toBe(4_000);
    expect(backoffDelay(9, DEFAULT_BACKOFF, half)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  test("jitter stays within the configured band and never exceeds the cap", () => {
    for (const roll of [0, 0.25, 0.75, 1]) {
      const delay = backoffDelay(3, DEFAULT_BACKOFF, () => roll);
      expect(delay).toBeGreaterThanOrEqual(1_500);
      expect(delay).toBeLessThanOrEqual(2_500);
    }
    expect(backoffDelay(20, DEFAULT_BACKOFF, () => 1)).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
  });
});

describe("createJobStream", () => {
  test("does not refetch on the first connection", async () => {
    const { harness, refetch, stream, states } = setup();
    stream.start();
    harness.connections[0]?.onOpen();
    await flush();
    expect(refetch).not.toHaveBeenCalled();
    expect(states).toEqual(["connecting", "open"]);
  });

  test("reconnects on the exponential schedule and reconciles on every reopen", async () => {
    const { fake, harness, refetch, reconciled, stream } = setup();
    stream.start();
    harness.connections[0]?.onOpen();
    await flush();

    harness.connections[0]?.onError();
    expect(harness.connections).toHaveLength(1);
    fake.advance(499);
    expect(harness.connections).toHaveLength(1);
    fake.advance(1);
    expect(harness.connections).toHaveLength(2);

    harness.connections[1]?.onOpen();
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(reconciled).toHaveLength(1);

    // A successful open resets the attempt counter, so the next failure waits
    // the initial delay again rather than continuing to grow.
    harness.connections[1]?.onError();
    fake.advance(500);
    expect(harness.connections).toHaveLength(3);
  });

  test("backs off further when reconnects keep failing before opening", () => {
    const { fake, harness, stream } = setup();
    stream.start();
    harness.connections[0]?.onError();
    fake.advance(500);
    harness.connections[1]?.onError();
    fake.advance(999);
    expect(harness.connections).toHaveLength(2);
    fake.advance(1);
    expect(harness.connections).toHaveLength(3);
    harness.connections[2]?.onError();
    fake.advance(2_000);
    expect(harness.connections).toHaveLength(4);
  });

  test("gives up after maxAttempts", () => {
    const { fake, harness, stream } = setup({ maxAttempts: 2 });
    stream.start();
    harness.connections[0]?.onError();
    fake.advance(500);
    harness.connections[1]?.onError();
    fake.advance(1_000);
    harness.connections[2]?.onError();
    fake.advance(60_000);
    expect(harness.connections).toHaveLength(3);
    expect(stream.state).toBe("closed");
  });

  test("stops on a terminal event and schedules nothing further", () => {
    const { fake, harness, events, stream } = setup();
    stream.start();
    harness.connections[0]?.onOpen();
    harness.connections[0]?.onEvent({
      type: "failed",
      jobId: "job-1",
      error: { code: "DRM_PROTECTED", message: "no", retryable: false },
      at: "2026-08-05T10:00:05.000Z",
    });
    expect(events).toHaveLength(1);
    expect(stream.state).toBe("closed");
    expect(harness.closed).toBe(1);
    harness.connections[0]?.onError();
    fake.advance(60_000);
    expect(harness.connections).toHaveLength(1);
  });

  test("a terminal status frame does not close the stream before its payload", () => {
    // The server sends `status: completed` and then `completed`, and only the
    // second carries the result and the download link. Treating the status
    // frame as the end closed the socket in between, so the job finished with
    // no file to download.
    const { harness, events, stream } = setup();
    stream.start();
    harness.connections[0]?.onOpen();
    harness.connections[0]?.onEvent({
      type: "status",
      jobId: "job-1",
      status: "completed",
      at: "2026-08-05T10:00:05.000Z",
    });

    expect(stream.state).toBe("open");
    expect(harness.closed).toBe(0);

    harness.connections[0]?.onEvent({
      type: "completed",
      jobId: "job-1",
      result: {
        filename: "video.mp4",
        sizeBytes: 1024,
        container: "mp4",
        durationSec: 10,
        downloadUrl: "/api/files/abc",
        expiresAt: "2026-08-05T16:00:00.000Z",
      },
      at: "2026-08-05T10:00:05.100Z",
    });

    expect(events).toHaveLength(2);
    expect(stream.state).toBe("closed");
  });

  test("a reconcile that reports a terminal job closes the stream", async () => {
    const { fake, harness, stream } = setup({
      refetch: () => Promise.resolve(stubJob("completed")),
    });
    stream.start();
    harness.connections[0]?.onError();
    fake.advance(500);
    harness.connections[1]?.onOpen();
    await flush();
    expect(stream.state).toBe("closed");
  });

  test("stop() cancels a pending reconnect", () => {
    const { fake, harness, stream } = setup();
    stream.start();
    harness.connections[0]?.onError();
    stream.stop();
    fake.advance(60_000);
    expect(harness.connections).toHaveLength(1);
    expect(fake.pending).toBe(0);
  });

  test("callbacks arriving after stop() are ignored", async () => {
    const { harness, events, refetch, stream } = setup();
    stream.start();
    const first = harness.connections[0];
    stream.stop();
    first?.onOpen();
    first?.onEvent({ type: "heartbeat", at: "2026-08-05T10:00:05.000Z" });
    await flush();
    expect(events).toHaveLength(0);
    expect(refetch).not.toHaveBeenCalled();
  });
});
