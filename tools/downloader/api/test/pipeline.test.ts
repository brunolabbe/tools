/**
 * The job pipeline, end to end through the HTTP surface.
 *
 * These are the tests that make M3 a claim rather than a hope: create a job,
 * watch it move through the FSM, and fetch the resulting file from the token
 * the API minted. The resolver and the engine are stubs; everything between
 * them is the real thing.
 */

import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { AppError, ROUTES } from "@downloader/contract";
import type { Job, JobResponse, JobStatus, ProbeResponse } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { initialProgress } from "../src/db/job-store.ts";
import type { LightMyRequestResponse as Response } from "fastify";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
  STUB_BODY,
  StubResolver,
  variant,
  waitFor,
} from "./helpers.ts";
import type { Harness } from "./helpers.ts";

/** A 1x1 PNG. Real bytes, so a content-type assertion means something. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  downloads.clear();
});

/**
 * The download each job's link started, by job id. Since dl-53 a job does
 * nothing until its link is opened, so `createJob` opens it: the request is
 * the visitor, and its response is the file.
 */
const downloads = new Map<string, Promise<Response>>();

async function createJob(
  current: Harness,
  payload: Record<string, unknown> = {},
  { open = true } = {},
): Promise<Job> {
  const response = await current.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url: SOURCE_URL, ...payload },
  });
  expect(response.statusCode).toBe(201);
  const job = (response.json() as JobResponse).job;
  if (open) openLink(current, job);
  return job;
}

/** Opens a job's link, as a visitor clicking it would. */
function openLink(current: Harness, job: Job): void {
  const opened = current.app.server.inject({ method: "GET", url: job.link?.url ?? "" });
  opened.catch(() => undefined);
  downloads.set(job.id, opened);
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
  test("a job runs to completed, streamed on its link's response", async () => {
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

    expect(finished.result?.sizeBytes).toBe(STUB_BODY.byteLength);

    // The link is a capability, not a job id in disguise, and it was spent.
    const link = created.link?.url ?? "";
    expect(link.startsWith("/api/files/")).toBe(true);
    expect(link).not.toContain(created.id);
    expect(finished.link).toBeNull();

    const file = await (downloads.get(created.id) as Promise<Response>);
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe(STUB_BODY.toString());
    expect(file.headers["content-type"]).toBe("video/mp4");
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(file.headers["cache-control"]).toBe("private, no-store");
    // No length is known when the headers go, and there is no file to seek in.
    expect(file.headers["content-length"]).toBeUndefined();
    expect(file.headers["accept-ranges"]).toBeUndefined();

    // Single use: the second open is `410`, with the code a client renders.
    const again = await harness.app.server.inject({ method: "GET", url: link });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({ error: { code: "FILE_EXPIRED" } });
  });

  test("the variant the client picked is the one the engine is handed", async () => {
    const wanted = variant({ id: "hls-720p", height: 720, width: 1280, label: "720p" });
    const handed: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ variants: [variant(), wanted] })),
      engineOptions: {
        onStream: (request) => handed.push(request.variant.id),
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
      engineOptions: { onStream: (request) => handed.push(request.variant.id) },
    });

    const created = await createJob(harness);
    await runToTerminal(harness, created.id);
    expect(handed).toEqual(["hd"]);
  });
});

describe("the preview a job keeps", () => {
  /** A loopback origin serving a real image, so the capture runs for real. */
  async function imageOrigin(): Promise<{ origin: string; close: () => Promise<void> }> {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${port}`,
      close: async () =>
        await new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  }

  test("the re-probe's preview is snapshotted onto the job and survives to completion", async () => {
    // The whole persistence path in one go: the orchestrator's own capture, the
    // `store.patch` beside the variant, the SQLite column, and `rowToJob`'s
    // re-parse through `jobSchema`. The job's token is one *this run* minted —
    // nothing here depends on the probe cache still holding anything.
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });

      const created = await createJob(harness);
      // Not yet: the snapshot is written by the re-probe, not at intake.
      expect(created.thumbnailPath).toBeNull();

      const finished = await runToTerminal(harness, created.id);
      expect(finished.status).toBe("completed");
      expect(finished.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
      // Our path, never the address the page named.
      expect(finished.thumbnailPath).not.toContain(image.origin);

      // And it actually serves, which is what makes the snapshot worth keeping.
      const served = await harness.app.server.inject({
        method: "GET",
        url: finished.thumbnailPath ?? "",
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
    } finally {
      await image.close();
    }
  });

  test("a probe with no preview leaves the job with none, and still completes", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const finished = await runToTerminal(harness, (await createJob(harness)).id);
    expect(finished.status).toBe("completed");
    expect(finished.thumbnailPath).toBeNull();
  });

  test("a preview on a blocked address costs the preview, not the download", async () => {
    // The orchestrator's half of Done-when 7. A real guard: private addresses
    // refused, only the two fictional media hosts exempt, so the link-local
    // literal is blocked without any DNS being consulted.
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({ thumbnailUrl: "http://169.254.169.254/latest/meta-data/" }),
      ),
      config: {
        ssrfAllowPrivateAddresses: false,
        ssrfAllowHosts: ["site.example", "cdn.example"],
      },
    });

    const finished = await runToTerminal(harness, (await createJob(harness)).id);
    expect(finished.status).toBe("completed");
    expect(finished.result?.filename).toBe("video.mp4");
    expect(finished.thumbnailPath).toBeNull();
  });

  // --- dl-53: one copy, in memory, for ten minutes -------------------------

  test("a job's preview keeps only its ten minutes too, and nothing is written", async () => {
    // dl-44 kept a completed job's preview on disk beside its file. dl-53
    // removed the files, and the owner chose on 2026-09-27 to remove that copy
    // with them: this is the behaviour dl-44 shipped, reversed on purpose.
    let clock = new Date("2026-09-07T10:00:00.000Z");
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
        now: () => clock,
      });

      const finished = await runToTerminal(harness, (await createJob(harness)).id);
      expect(finished.status).toBe("completed");
      const thumbnailPath = finished.thumbnailPath ?? "";
      expect(
        (await harness.app.server.inject({ method: "GET", url: thumbnailPath })).statusCode,
      ).toBe(200);

      clock = new Date(clock.getTime() + 11 * 60_000);
      const served = await harness.app.server.inject({ method: "GET", url: thumbnailPath });
      expect(served.statusCode).toBe(404);
      expect(served.json()).toMatchObject({ error: { code: "THUMBNAIL_NOT_FOUND" } });
      expect(await fs.readdir(harness.storageRoot)).toEqual([]);
    } finally {
      await image.close();
    }
  });

  test("a probe that never became a job keeps only its ten minutes", async () => {
    // The other side of the decision recorded on dl-44: the in-memory store is
    // kept, and it is the *only* source for a bare probe. There is no
    // `out/<jobId>/` to keep a copy beside, and inventing a retention rule for
    // one was the cost this ticket declined to pay.
    let clock = new Date("2026-09-07T10:00:00.000Z");
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
        now: () => clock,
      });
      const probe = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        })
      ).json() as ProbeResponse;
      const thumbnailPath = probe.probe.thumbnailPath ?? "";
      expect(
        (await harness.app.server.inject({ method: "GET", url: thumbnailPath })).statusCode,
      ).toBe(200);

      clock = new Date(clock.getTime() + 11 * 60_000);
      expect(
        (await harness.app.server.inject({ method: "GET", url: thumbnailPath })).statusCode,
      ).toBe(404);
      // Nothing was written to disk for it, so nothing is left to own.
      expect(await fs.readdir(harness.storageRoot)).toEqual([]);
    } finally {
      await image.close();
    }
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

    const created = await createJob(harness, {}, { open: false });
    const frames: JobStatus[] = [];
    harness.app.context.events.subscribe(created.id, (event) => {
      if (event.type === "status") frames.push(event.status);
    });
    openLink(harness, created);
    firstProbe.open();

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    expect(statusAtProbe[1]).toBe("probing");
    // Subscribed before the link was opened (dl-53), so the whole run is here,
    // and the back-edge is the third entry.
    expect(frames).toEqual(["probing", "downloading", "probing", "downloading", "completed"]);
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
        onStream: (request, call) => {
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

    const created = await createJob(harness, {}, { open: false });
    const bytes: number[] = [];
    harness.app.context.events.subscribe(created.id, (event) => {
      if (event.type === "progress") bytes.push(event.progress.downloadedBytes);
    });
    openLink(harness, created);
    firstProbe.open();

    const finished = await runToTerminal(harness, created.id);
    expect(finished.status).toBe("completed");
    // The first probe's reset, 512 from the dead attempt, then a frame telling
    // the client it is back to zero — not a stale bar at 50% under "Re-analysing".
    expect(bytes).toEqual([0, 512, 0]);
    expect(finished.progress.percent).toBe(100);
  });

  test("a DOWNLOAD_FAILED during downloading is re-probe-worthy too", async () => {
    // ffmpeg does its own fetching and reports an expired manifest only as text
    // on stderr, so an expiry surfaces as DOWNLOAD_FAILED rather than
    // VARIANT_GONE — tools/downloader/engine/src/stream.ts runs ffmpeg with
    // `failureCode: "DOWNLOAD_FAILED"`, so every ffmpeg failure is that code. Not retrying it would leave the commonest
    // expiry case unhandled; MAX_REPROBE_RETRIES in
    // tools/downloader/api/src/jobs/orchestrator.ts carries the rest.
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
      engineOptions: { failWith: () => new AppError("SIZE_LIMIT_EXCEEDED") },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("SIZE_LIMIT_EXCEEDED");
    expect(harness.engine.calls).toBe(1);
  });

  test("a variant id that vanished between probes substitutes rather than failing", async () => {
    // Resolvers do not promise stable ids across probes — the sniffer's ids
    // come from whatever the page requested that time.
    const handed: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(probeResult({ variants: [variant({ id: "renumbered-9" })] })),
      engineOptions: { onStream: (request) => handed.push(request.variant.id) },
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

  // dl-59: `run()` is never invoked for a job still in the wait line, so the
  // orchestrator never unwinds and never writes the terminal state itself —
  // unlike the running-job case above, the cancel route has to do it directly.
  test("cancelling a job that cannot start yet reaches canceled, not stuck at queued", async () => {
    let releaseFirst: (() => void) | undefined;
    const blockedFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    harness = await createHarness({
      resolver: new StubResolver(async () => {
        await blockedFirst;
        return probeResult();
      }),
      // One running slot, so the second job sits in the wait line rather than
      // running — no other client cap in the way of admitting it.
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0 },
    });

    try {
      const first = await createJob(harness);
      const second = await createJob(harness, { url: `${SOURCE_URL}/2` });
      await waitFor(
        () => (harness as Harness).app.context.queue.waiting,
        (n) => n === 1,
        { label: "second job to be waiting" },
      );

      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.cancelJob(second.id),
      });
      expect(response.statusCode).toBe(200);
      // The response body itself, not a stale "queued" snapshot.
      expect((response.json() as JobResponse).job.status).toBe("canceled");

      const stored = readJob(harness, second.id);
      expect(stored.status).toBe("canceled");
      expect(stored.error?.code).toBe("JOB_CANCELED");

      // A restart must not treat a canceled-while-waiting job as one that was
      // mid-flight when the process died.
      expect(harness.app.context.store.unfinished().map((job) => job.id)).not.toContain(second.id);

      releaseFirst?.();
      const finishedFirst = await runToTerminal(harness, first.id);
      expect(finishedFirst.status).toBe("completed");
    } finally {
      // An assertion failing above must not leave the blocked resolver
      // dangling forever — that turns a red test into a hung `afterEach`.
      releaseFirst?.();
    }
  });

  // Position in the wait line must not matter: this cancels the job behind
  // the front of the line, not the only one waiting.
  test("cancelling a waiting job that is not first in line still reaches canceled", async () => {
    let releaseFirst: (() => void) | undefined;
    const blockedFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    harness = await createHarness({
      resolver: new StubResolver(async () => {
        await blockedFirst;
        return probeResult();
      }),
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0 },
    });

    try {
      const first = await createJob(harness);
      const second = await createJob(harness, { url: `${SOURCE_URL}/2` });
      const third = await createJob(harness, { url: `${SOURCE_URL}/3` });
      await waitFor(
        () => (harness as Harness).app.context.queue.waiting,
        (n) => n === 2,
        { label: "two jobs waiting" },
      );

      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.cancelJob(third.id),
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as JobResponse).job.status).toBe("canceled");
      expect(readJob(harness, third.id).status).toBe("canceled");
      // The job ahead of it in the line is untouched.
      expect(readJob(harness, second.id).status).toBe("queued");

      releaseFirst?.();
      const finishedFirst = await runToTerminal(harness, first.id);
      expect(finishedFirst.status).toBe("completed");
      const finishedSecond = await runToTerminal(harness, second.id);
      expect(finishedSecond.status).toBe("completed");
    } finally {
      releaseFirst?.();
    }
  });
});

describe("concurrency", () => {
  test("MAX_CONCURRENT_JOBS is respected", async () => {
    let inFlight = 0;
    let peak = 0;
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 30));

    harness = await createHarness({
      // dl-51's per-client cap is a different concern from this test's — every
      // job here comes from the same simulated address, so it is disabled
      // rather than sized around.
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 0 },
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

describe("cancellation survives a restart (dl-59)", () => {
  test("a restart over a real database reports a canceled wait-line job as canceled, not the interrupted-restart INTERNAL", async () => {
    // Done-when 3, proven by an actual restart rather than only by
    // `store.unfinished()` excluding the row: two apps over one database and
    // one storage directory, the same shape as "a restart does not lose the
    // preview of a job whose file survived it" above — see that test's
    // `finally` for why both databases close before anything is unlinked.
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl59-db-"));
    const databasePath = path.join(dbDir, "jobs.sqlite");
    let releaseFirst: (() => void) | undefined;
    const blockedFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let first: Harness | undefined;
    try {
      first = await createHarness({
        resolver: new StubResolver(async () => {
          await blockedFirst;
          return probeResult();
        }),
        config: { databasePath, maxConcurrentJobs: 1, maxJobsPerClient: 0 },
      });
      await createJob(first);
      const second = await createJob(first, { url: `${SOURCE_URL}/2` });
      await waitFor(
        () => (first as Harness).app.context.queue.waiting,
        (n) => n === 1,
        { label: "second job to be waiting" },
      );

      const canceled = await first.app.server.inject({
        method: "POST",
        url: ROUTES.cancelJob(second.id),
      });
      expect(canceled.statusCode).toBe(200);

      // Down, releasing the first job's resolver first so nothing is left
      // blocked mid-flight when the process "dies".
      releaseFirst?.();
      await first.app.shutdown();

      // Up again on the same database — a restart, not a fresh boot.
      harness = await createHarness({
        config: { databasePath, storageDir: first.storageRoot },
        engineOptions: { storageRoot: first.storageRoot },
      });

      const afterRestart = readJob(harness, second.id);
      expect(afterRestart.status).toBe("canceled");
      expect(afterRestart.error?.code).toBe("JOB_CANCELED");
      // The false description this bug produced, ruled out by name: a
      // canceled-while-waiting job must never come back as the restart's
      // own "was running" story.
      expect(afterRestart.error?.message).not.toContain(
        "restarted while this download was running",
      );
    } finally {
      releaseFirst?.();
      await harness?.app.shutdown();
      await first?.app.shutdown();
      if (first !== undefined) await fs.rm(first.storageRoot, { recursive: true, force: true });
      await fs.rm(dbDir, { recursive: true, force: true });
    }
  });
});

describe("CONTAINER_UNSUPPORTED is re-probed once although it is not retryable (dl-99)", () => {
  test("a refusal that a fresh probe clears completes on the retry", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      engineOptions: {
        failWith: (call) => (call === 0 ? new AppError("CONTAINER_UNSUPPORTED") : undefined),
      },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("completed");
    expect(finished.attempts).toBe(2);
    expect(harness.engine.calls).toBe(2);
    expect(resolver.calls).toBe(2);
  });

  test("one that the fresh probe repeats ends the job, still not retryable", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      engineOptions: { failWith: () => new AppError("CONTAINER_UNSUPPORTED") },
    });

    const created = await createJob(harness);
    const finished = await runToTerminal(harness, created.id);

    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("CONTAINER_UNSUPPORTED");
    expect(finished.error?.retryable).toBe(false);
    expect(finished.attempts).toBe(2);
    expect(harness.engine.calls).toBe(2);
  });
});
