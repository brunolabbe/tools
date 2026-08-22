/**
 * The job pipeline, end to end through the HTTP surface.
 *
 * These are the tests that make M3 a claim rather than a hope: create a job,
 * watch it move through the FSM, and fetch the resulting file from the token
 * the API minted. The resolver and the engine are stubs; everything between
 * them is the real thing.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { Job, JobResponse, JobStatus, ProbeResponse } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { initialProgress } from "../src/db/job-store.ts";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
  StubResolver,
  variant,
  waitFor,
} from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

async function createJob(current: Harness, payload: Record<string, unknown> = {}): Promise<Job> {
  const response = await current.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url: SOURCE_URL, ...payload },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as JobResponse).job;
}

function readJob(current: Harness, id: string): Job {
  return current.app.context.store.get(id);
}

/**
 * A latch a test can hold a job at.
 *
 * The resolver and the engine are stubs, so a job runs to completion faster
 * than the test can subscribe to its events. Blocking inside the resolver is
 * how a test watches a sequence instead of racing it.
 */
function latch(): { wait: Promise<void>; open: () => void } {
  // Definitely assigned: the executor runs synchronously inside the constructor.
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

async function runToTerminal(current: Harness, id: string): Promise<Job> {
  return await waitFor(
    () => readJob(current, id),
    (job) => job.status === "completed" || job.status === "failed" || job.status === "canceled",
    { label: `job ${id} to finish` },
  );
}

describe("the happy path", () => {
  test("a job runs to completed and its file is downloadable from the token", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { emitProgress: true },
    });

    const created = await createJob(harness);
    expect(created.status).toBe("queued");

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    expect(finished.error).toBeNull();
    expect(finished.result).not.toBeNull();
    expect(finished.result?.filename).toBe("video.mp4");
    expect(finished.finishedAt).not.toBeNull();

    // The download URL is a capability, not a job id in disguise.
    const downloadUrl = finished.result?.downloadUrl ?? "";
    expect(downloadUrl.startsWith("/api/files/")).toBe(true);
    expect(downloadUrl).not.toContain(created.id);

    const file = await harness.app.server.inject({ method: "GET", url: downloadUrl });
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe("stub-video-bytes-0123456789");
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(file.headers["accept-ranges"]).toBe("bytes");
  });

  test("the variant the client picked is the one the engine is handed", async () => {
    const wanted = variant({ id: "hls-720p", height: 720, width: 1280, label: "720p" });
    const handed: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ variants: [variant(), wanted] })),
      engineOptions: {
        onDownload: (request) => handed.push(request.variant.id),
      },
    });

    const created = await createJob(harness, { options: { variantId: "hls-720p" } });
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("completed");
    expect(handed).toEqual(["hls-720p"]);
    expect(finished.variantId).toBe("hls-720p");
  });

  test("with no variantId the server picks the highest quality", async () => {
    const handed: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({
          variants: [
            variant({ id: "sd", width: 640, height: 360, bitrateBps: 800_000 }),
            variant({ id: "hd", width: 1920, height: 1080, bitrateBps: 5_000_000 }),
          ],
        }),
      ),
      engineOptions: { onDownload: (request) => handed.push(request.variant.id) },
    });

    const created = await createJob(harness);
    await runToTerminal(harness, created.id);
    expect(handed).toEqual(["hd"]);
  });
});

describe("re-probing", () => {
  test("the job re-probes rather than reusing the probe from /api/probe", async () => {
    // The rule from analysis §5, and the reason the `probing` state exists:
    // signed URLs expire in 30–300 s, so a probe taken at request time is
    // very likely dead by the time a worker slot frees up.
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver });

    const probe = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    expect(probe.statusCode).toBe(200);
    expect((probe.json() as ProbeResponse).cached).toBe(false);
    expect(resolver.calls).toBe(1);

    const created = await createJob(harness);
    await runToTerminal(harness, created.id);

    // Two calls: one for the route, one for the job. The job did not read the
    // cache the route just populated.
    expect(resolver.calls).toBe(2);
  });

  test("a VARIANT_GONE download re-probes once and succeeds on the retry", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      engineOptions: {
        failWith: (call) => (call === 0 ? new AppError("VARIANT_GONE") : undefined),
      },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("completed");
    expect(harness.engine.calls).toBe(2);
    // Two probes: the first attempt and the retry's fresh one.
    expect(resolver.calls).toBe(2);
    expect(finished.attempts).toBe(2);
  });

  test("the job is observably in `probing` while it re-probes", async () => {
    // dl-9, and the reason the FSM has its one back-edge. Before it existed the
    // retry re-probed in place, so a job reported `downloading` throughout a
    // period when it was doing nothing of the sort.
    const statusAtProbe: (JobStatus | undefined)[] = [];
    const firstProbe = latch();
    harness = await createHarness({
      resolver: new StubResolver(async (call) => {
        // The stubs are instantaneous, so a job left to itself finishes before
        // the test can subscribe. Holding the first probe open is what makes
        // the frame sequence observable rather than a race.
        if (call === 0) await firstProbe.wait;
        // One job per harness, so the first row is this job. Read from the
        // store rather than a captured id: the first probe starts before
        // `POST /api/jobs` has returned one.
        statusAtProbe.push(harness?.app.context.store.list().jobs[0]?.status);
        return probeResult();
      }),
      engineOptions: {
        failWith: (call) => (call === 0 ? new AppError("VARIANT_GONE") : undefined),
      },
    });

    const created = await createJob(harness);
    const frames: JobStatus[] = [];
    harness.app.context.events.subscribe(created.id, (event) => {
      if (event.type === "status") frames.push(event.status);
    });
    firstProbe.open();

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    expect(statusAtProbe[1]).toBe("probing");
    // `queued → probing` went out before the subscription; everything from the
    // held probe onwards is here, and the back-edge is the second entry.
    expect(frames).toEqual(["downloading", "probing", "downloading", "completed"]);
  });

  test("the re-probe resets progress rather than carrying the dead attempt's bytes", async () => {
    const firstProbe = latch();
    harness = await createHarness({
      resolver: new StubResolver(async (call) => {
        if (call === 0) await firstProbe.wait;
        return probeResult();
      }),
      engineOptions: {
        // Report bytes, then fail: an expiry mid-download leaves a percentage
        // on screen that refers to an attempt being abandoned.
        onDownload: (request, call) => {
          if (call === 0)
            request.onProgress?.({
              ...initialProgress("downloading"),
              downloadedBytes: 512,
              totalBytes: 1024,
              percent: 50,
            });
        },
        failWith: (call) => (call === 0 ? new AppError("VARIANT_GONE") : undefined),
      },
    });

    const created = await createJob(harness);
    const bytes: number[] = [];
    harness.app.context.events.subscribe(created.id, (event) => {
      if (event.type === "progress") bytes.push(event.progress.downloadedBytes);
    });
    firstProbe.open();

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    // 512 from the dead attempt, then a frame telling the client it is back to
    // zero — not a stale bar sitting at 50% under "Re-analysing".
    expect(bytes).toEqual([512, 0]);
    expect(finished.progress.percent).toBe(100);
  });

  test("a DOWNLOAD_FAILED during downloading is re-probe-worthy too", async () => {
    // ffmpeg does its own fetching and reports an expired manifest only as text
    // on stderr, so an expiry surfaces as DOWNLOAD_FAILED rather than
    // VARIANT_GONE — engine/src/download/manifest.ts maps every ffmpeg failure
    // to that one code. Not retrying it would leave the commonest expiry case
    // unhandled; MAX_REPROBE_RETRIES in jobs/orchestrator.ts carries the rest.
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: {
        failWith: (call) => (call === 0 ? new AppError("DOWNLOAD_FAILED") : undefined),
      },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    expect(harness.engine.calls).toBe(2);
  });

  test("it retries once and no more", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { failWith: () => new AppError("VARIANT_GONE") },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("VARIANT_GONE");
    // A second fresh probe producing dead URLs means the problem is not expiry,
    // and looping would burn a browser probe per attempt.
    expect(harness.engine.calls).toBe(2);
  });

  test("a non-retryable failure is not retried at all", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { failWith: () => new AppError("MUX_FAILED") },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("MUX_FAILED");
    expect(harness.engine.calls).toBe(1);
  });

  test("a variant id that vanished between probes substitutes rather than failing", async () => {
    // Resolvers do not promise stable ids across probes — the sniffer's ids
    // come from whatever the page requested that time.
    const handed: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ variants: [variant({ id: "renumbered-9" })] })),
      engineOptions: { onDownload: (request) => handed.push(request.variant.id) },
    });

    const created = await createJob(harness, { options: { variantId: "gone-forever" } });
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("completed");
    expect(handed).toEqual(["renumbered-9"]);
  });
});

describe("terminal answers about the source", () => {
  test("DRM stops the pipeline and never reaches the engine", async () => {
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({
          drm: { protected: true, systems: ["widevine"], evidence: "MPD ContentProtection" },
        }),
      ),
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("DRM_PROTECTED");
    expect(finished.error?.retryable).toBe(false);
    // The hard stop is only a hard stop if nothing downstream ran.
    expect(harness.engine.calls).toBe(0);
  });

  test("a live stream with no duration limit is refused before downloading", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ isLive: true, durationSec: undefined })),
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("LIVE_STREAM_UNSUPPORTED");
    expect(harness.engine.calls).toBe(0);
  });

  test("a live stream with an explicit duration proceeds", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ isLive: true, durationSec: undefined })),
    });

    const created = await createJob(harness, { options: { liveDurationSec: 60 } });
    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
  });
});

describe("cancellation", () => {
  test("cancelling a running job reaches canceled, not failed", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    harness = await createHarness({
      resolver: new StubResolver(async () => {
        // Hold the job in `probing` so the cancel lands mid-flight.
        await blocked;
        return probeResult();
      }),
    });

    const created = await createJob(harness);
    await waitFor(
      () => readJob(harness as Harness, created.id),
      (job) => job.status === "probing",
      { label: "job to start probing" },
    );

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.cancelJob(created.id),
    });
    expect(response.statusCode).toBe(200);
    release?.();

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("canceled");
    // `status` is authoritative, but the payload is present so a listen-only
    // client has copy to render.
    expect(finished.error?.code).toBe("JOB_CANCELED");
    expect(finished.error?.retryable).toBe(false);
    expect(harness.engine.calls).toBe(0);
  });

  test("cancelling a finished job is idempotent, not an error", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.cancelJob(created.id),
    });
    expect(response.statusCode).toBe(200);
    // Still completed: a client that raced the last event does not get to undo it.
    expect((response.json() as JobResponse).job.status).toBe("completed");
  });

  test("cancelling an unknown job is a 404", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.cancelJob("00000000-0000-0000-0000-000000000000"),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("concurrency", () => {
  test("MAX_CONCURRENT_JOBS is respected", async () => {
    let inFlight = 0;
    let peak = 0;
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 30));

    harness = await createHarness({
      config: { maxConcurrentJobs: 2 },
      resolver: new StubResolver(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await gate;
        inFlight--;
        return probeResult();
      }),
    });

    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      // oxlint-disable-next-line no-await-in-loop
      const job = await createJob(harness);
      ids.push(job.id);
    }

    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop
      const finished = await runToTerminal(harness, id);
      expect(finished.status).toBe("completed");
    }
    // A browser probe costs ~300 MB, so this cap is a memory bound.
    expect(peak).toBeLessThanOrEqual(2);
  });
});
