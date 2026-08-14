import { describe, expect, test } from "vitest";
import type { Job, JobEvent, JobProgress } from "@downloader/contract";
import { applyJobEvent, applyJobEvents, reconcileJob, upsertJob } from "../src/lib/job-reducer.ts";

const T0 = "2026-08-05T10:00:00.000Z";
const T1 = "2026-08-05T10:00:01.000Z";
const T2 = "2026-08-05T10:00:02.000Z";
const T3 = "2026-08-05T10:00:03.000Z";

function progress(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    stage: "downloading",
    percent: 50,
    downloadedBytes: 1_000,
    totalBytes: 2_000,
    segmentsDone: 5,
    segmentsTotal: 10,
    speedBps: 500,
    etaSec: 2,
    processedSec: 30,
    ...overrides,
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    sourceUrl: "https://videos.example.com/watch/sample",
    variantId: "hls-720p",
    variant: null,
    status: "queued",
    progress: progress({ stage: "queued", percent: null, downloadedBytes: 0, totalBytes: null }),
    result: null,
    error: null,
    attempts: 0,
    createdAt: T0,
    updatedAt: T0,
    finishedAt: null,
    ...overrides,
  };
}

const result = {
  filename: "clip.mp4",
  sizeBytes: 2_000,
  container: "mp4",
  durationSec: 60,
  downloadUrl: "/api/files/abc",
  expiresAt: "2026-08-05T16:00:00.000Z",
};

describe("applyJobEvent", () => {
  test("heartbeats and foreign job ids are no-ops, by reference", () => {
    const base = job();
    expect(applyJobEvent(base, { type: "heartbeat", at: T1 })).toBe(base);
    expect(applyJobEvent(base, { type: "status", jobId: "other", status: "probing", at: T1 })).toBe(
      base,
    );
  });

  test("follows the FSM through a normal run", () => {
    const events: JobEvent[] = [
      { type: "status", jobId: "job-1", status: "probing", at: T1 },
      { type: "status", jobId: "job-1", status: "downloading", at: T2 },
      { type: "progress", jobId: "job-1", progress: progress(), at: T2 },
      { type: "completed", jobId: "job-1", result, at: T3 },
    ];
    const final = applyJobEvents(job(), events);
    expect(final.status).toBe("completed");
    expect(final.result).toEqual(result);
    expect(final.finishedAt).toBe(T3);
    expect(final.progress.stage).toBe("completed");
  });

  test("applies a status the server reports even when it skips states", () => {
    // queued → muxing is not a step in JOB_TRANSITIONS, and it does not need to
    // be: the frame says where the job *is*, so the only thing a jump tells us
    // is that we missed the frames in between. Refusing it used to leave the
    // card showing a state the server had already left.
    const next = applyJobEvent(job(), {
      type: "status",
      jobId: "job-1",
      status: "muxing",
      at: T1,
    });
    expect(next.status).toBe("muxing");
  });

  test("the result still lands when the status frame announced it first", () => {
    // The outcome arrives in two frames — `status: completed`, then
    // `completed` with the result. Treating the first as the last word left a
    // job reading "Ready" with no file attached.
    const final = applyJobEvents(job({ status: "downloading", updatedAt: T1 }), [
      { type: "status", jobId: "job-1", status: "completed", at: T2 },
      { type: "completed", jobId: "job-1", result, at: T3 },
    ]);
    expect(final.status).toBe("completed");
    expect(final.result).toEqual(result);
  });

  test("a contradictory outcome cannot overturn one already recorded", () => {
    const completed = applyJobEvents(job({ status: "downloading", updatedAt: T1 }), [
      { type: "status", jobId: "job-1", status: "completed", at: T2 },
      { type: "completed", jobId: "job-1", result, at: T3 },
    ]);
    const late = applyJobEvent(completed, {
      type: "failed",
      jobId: "job-1",
      error: { code: "DOWNLOAD_FAILED", message: "nope", retryable: true },
      at: T3,
    });
    expect(late).toBe(completed);
  });

  test("a job that finished before the stream opened still reaches completed", () => {
    // The regression that hung the UI on every fast download. The first frame
    // a client sees is the route's opening snapshot, which reports the job's
    // *current* status — `downloading` for anything that started while the
    // POST response was still in flight. That is not adjacent to `queued`, so
    // holding the status meant every later frame was refused too and the card
    // sat at "Queued" while its byte counter climbed.
    const final = applyJobEvents(job(), [
      { type: "status", jobId: "job-1", status: "downloading", at: T1 },
      { type: "progress", jobId: "job-1", progress: progress({ stage: "downloading" }), at: T1 },
      { type: "status", jobId: "job-1", status: "muxing", at: T2 },
      { type: "status", jobId: "job-1", status: "completed", at: T3 },
    ]);
    expect(final.status).toBe("completed");
    expect(final.finishedAt).toBe(T3);
  });

  test("a progress frame repairs a status frame lost while disconnected", () => {
    const start = job({ status: "probing", updatedAt: T1 });
    const next = applyJobEvent(start, {
      type: "progress",
      jobId: "job-1",
      progress: progress({ stage: "downloading" }),
      at: T2,
    });
    expect(next.status).toBe("downloading");
    expect(next.progress.percent).toBe(50);
  });

  test("ignores frames older than the state we already applied", () => {
    const current = applyJobEvent(job(), {
      type: "status",
      jobId: "job-1",
      status: "probing",
      at: T2,
    });
    const late = applyJobEvent(current, {
      type: "progress",
      jobId: "job-1",
      progress: progress({ percent: 5 }),
      at: T1,
    });
    expect(late).toBe(current);
  });

  test("out-of-order delivery converges when the newest frame is a legal step", () => {
    const ordered: JobEvent[] = [
      { type: "status", jobId: "job-1", status: "downloading", at: T2 },
      { type: "progress", jobId: "job-1", progress: progress({ percent: 80 }), at: T3 },
    ];
    const start = job({ status: "probing", updatedAt: T1 });
    const inOrder = applyJobEvents(start, ordered);
    const outOfOrder = applyJobEvents(start, [ordered[1]!, ordered[0]!]);
    // The late progress frame carries the stage, so it lands on the same status
    // and the status frame behind it is discarded as stale.
    expect(outOfOrder.status).toBe(inOrder.status);
    expect(outOfOrder.progress.percent).toBe(80);
  });

  test("a reordered frame cannot drag the status backwards", () => {
    // The newest frame wins and the older one behind it is dropped as stale,
    // which is what keeps the fold monotonic now that adjacency is no longer
    // what guards it.
    const next = applyJobEvents(job(), [
      { type: "progress", jobId: "job-1", progress: progress({ percent: 80 }), at: T3 },
      { type: "status", jobId: "job-1", status: "probing", at: T1 },
    ]);
    expect(next.status).toBe("downloading");
    expect(next.progress.percent).toBe(80);
  });

  test("terminal states absorb everything that follows", () => {
    const failed = applyJobEvent(job({ status: "downloading", updatedAt: T1 }), {
      type: "failed",
      jobId: "job-1",
      error: { code: "DOWNLOAD_FAILED", message: "nope", retryable: true },
      at: T2,
    });
    expect(failed.status).toBe("failed");
    const after = applyJobEvent(failed, { type: "completed", jobId: "job-1", result, at: T3 });
    expect(after).toBe(failed);
  });

  test("completion is honoured even when the intermediate frames were missed", () => {
    // queued → completed is not a legal *transition*, but a completed frame is
    // the server reporting a fact, not a state guess.
    const done = applyJobEvent(job(), { type: "completed", jobId: "job-1", result, at: T3 });
    expect(done.status).toBe("completed");
  });

  test("keeps percent null rather than inventing one", () => {
    const next = applyJobEvent(job({ status: "downloading", updatedAt: T1 }), {
      type: "progress",
      jobId: "job-1",
      progress: progress({ percent: null, totalBytes: null, etaSec: null }),
      at: T2,
    });
    expect(next.progress.percent).toBeNull();
  });
});

describe("reconcileJob", () => {
  test("prefers the server copy", () => {
    const local = job({ status: "downloading", updatedAt: T1 });
    const remote = job({ status: "muxing", updatedAt: T2 });
    expect(reconcileJob(local, remote).status).toBe("muxing");
  });

  test("keeps a strictly newer local copy", () => {
    const local = job({ status: "muxing", updatedAt: T3 });
    const remote = job({ status: "downloading", updatedAt: T1 });
    expect(reconcileJob(local, remote).status).toBe("muxing");
  });

  test("accepts the remote when there is no local copy", () => {
    const remote = job({ id: "job-2" });
    expect(reconcileJob(undefined, remote)).toBe(remote);
  });
});

describe("upsertJob", () => {
  test("replaces in place and prepends new jobs", () => {
    const a = job({ id: "a" });
    const b = job({ id: "b" });
    expect(upsertJob([a], b).map((entry) => entry.id)).toEqual(["b", "a"]);
    const updated = job({ id: "a", status: "probing" });
    const list = upsertJob([a, b], updated);
    expect(list).toHaveLength(2);
    expect(list[0]?.status).toBe("probing");
  });
});
