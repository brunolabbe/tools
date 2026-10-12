import { describe, expect, test } from "vitest";
import type { AppErrorPayload, Job, JobEvent, JobProgress } from "@downloader/contract";
import {
  applyJobEvent,
  applyJobEvents,
  reconcileJob,
  refusalAfter,
  upsertJob,
} from "../src/lib/job-reducer.ts";
import { variant } from "./fixtures.ts";

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
    originConnections: null,
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
    // queued → downloading is not a step in JOB_TRANSITIONS, and it does not
    // need to be: the frame says where the job *is*, so the only thing a jump tells us
    // is that we missed the frames in between. Refusing it used to leave the
    // card showing a state the server had already left.
    const next = applyJobEvent(job(), {
      type: "status",
      jobId: "job-1",
      status: "downloading",
      at: T1,
    });
    expect(next.status).toBe("downloading");
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
    const local = job({ status: "probing", updatedAt: T1 });
    const remote = job({ status: "downloading", updatedAt: T2 });
    expect(reconcileJob(local, remote).status).toBe("downloading");
  });

  test("keeps a strictly newer local copy", () => {
    const local = job({ status: "downloading", updatedAt: T3 });
    const remote = job({ status: "probing", updatedAt: T1 });
    expect(reconcileJob(local, remote).status).toBe("downloading");
  });

  test("accepts the remote when there is no local copy", () => {
    const remote = job({ id: "job-2" });
    expect(reconcileJob(undefined, remote)).toBe(remote);
  });

  describe("a finished job the server has cleared (dl-107)", () => {
    const chosen = variant();
    const finished = { sizeBytes: 10, container: "mp4", durationSec: 3 };
    const local = job({
      status: "completed",
      updatedAt: T1,
      variant: chosen,
      result: { ...finished, filename: "Sample.mp4" },
    });
    const cleared = job({
      status: "completed",
      updatedAt: T2,
      sourceUrl: "",
      variant: null,
      result: { ...finished, filename: "" },
    });

    test("keeps the page address, the variant and the filename the browser already holds", () => {
      const next = reconcileJob(local, cleared);
      expect(next.sourceUrl).toBe(local.sourceUrl);
      expect(next.variant).toEqual(chosen);
      expect(next.result?.filename).toBe("Sample.mp4");
      // The server still wins everything it did not blank.
      expect(next.updatedAt).toBe(T2);
      expect(next.result?.sizeBytes).toBe(10);
    });

    test("from what a restore actually holds: a card saved mid-download keeps its page and variant, and has no filename to keep", () => {
      // The state `useJobs`' restore produces: the job was non-terminal when the
      // tab closed, so there is no `result` and the filename never reached this
      // browser (it arrives only on the `completed` event). Gate 1 of dl-107.
      const saved = job({ status: "downloading", updatedAt: T1, variant: chosen, result: null });
      const next = reconcileJob(saved, cleared);
      expect(next.sourceUrl).toBe(saved.sourceUrl);
      expect(next.variant).toEqual(chosen);
      expect(next.status).toBe("completed");
      // Nothing local to keep, so the server's blank stands here. The card names
      // the file by the title this browser kept instead (job-card.test.tsx).
      expect(next.result?.filename).toBe("");
    });

    test("takes the server's blanks when there is no local copy to keep", () => {
      expect(reconcileJob(undefined, cleared).sourceUrl).toBe("");
    });

    test("does not keep a local address over a server one that is not blank", () => {
      const moved = job({ status: "completed", updatedAt: T2, sourceUrl: "https://x.example/" });
      expect(reconcileJob(local, moved).sourceUrl).toBe("https://x.example/");
    });
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

describe("a refused link (dl-77)", () => {
  const error: AppErrorPayload = {
    code: "RATE_LIMITED",
    message: "You already have as many downloads running as this server allows.",
    retryable: true,
    details: { retryAfterSec: 30 },
  };
  const refused = (at: string): JobEvent => ({ type: "refused", jobId: "job-1", error, at });

  test("changes nothing on the job: it stays queued, with its link", () => {
    const queued = job({
      updatedAt: T1,
      link: { url: "/api/files/abc", expiresAt: "2026-08-05T10:15:00.000Z" },
    });
    expect(applyJobEvent(queued, refused(T2))).toBe(queued);
  });

  test("does not stop a later status frame from taking effect", () => {
    const queued = job({ updatedAt: T1 });
    const after = applyJobEvents(queued, [
      refused(T2),
      { type: "status", jobId: "job-1", status: "probing", at: T3 },
    ]);
    expect(after.status).toBe("probing");
    expect(after.link).toBeNull();
  });

  test("is kept for a queued job, and a newer one replaces it", () => {
    const queued = job({ updatedAt: T1 });
    expect(refusalAfter(undefined, queued, refused(T2))).toBe(error);
    const newer: AppErrorPayload = { ...error, message: "again" };
    expect(
      refusalAfter(error, queued, { type: "refused", jobId: "job-1", error: newer, at: T3 }),
    ).toBe(newer);
  });

  test("is dropped when the job has moved on, whichever frame got here first", () => {
    // The page cannot see the browser's failed download, so the only race is
    // between frames: a refusal for an attempt that has since been overtaken.
    const probing = job({ status: "probing", updatedAt: T3 });
    expect(refusalAfter(undefined, probing, refused(T2))).toBeUndefined();
    const queuedLater = job({ updatedAt: T3 });
    expect(refusalAfter(undefined, queuedLater, refused(T2))).toBeUndefined();
    expect(refusalAfter(error, queuedLater, refused(T2))).toBe(error);
  });

  test("is not touched by any other frame, and needs a job to attach to", () => {
    const queued = job({ updatedAt: T1 });
    expect(
      refusalAfter(error, queued, { type: "status", jobId: "job-1", status: "queued", at: T2 }),
    ).toBe(error);
    expect(refusalAfter(error, queued, { type: "heartbeat", at: T2 })).toBe(error);
    expect(refusalAfter(undefined, undefined, refused(T2))).toBeUndefined();
  });
});
