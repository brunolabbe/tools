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
import { runRetentionSweep } from "../src/server.ts";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
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

  // --- dl-44: the preview lives as long as the file it depicts -------------

  test("the preview outlives the in-memory store's ten minutes", async () => {
    // Done-when 1. The whole of dl-44's reason to exist: the result panel lives
    // six hours and the in-memory bytes lived ten minutes, so for ~97% of that
    // panel's life the image was silently absent. The clock is advanced past
    // `THUMBNAIL_TTL_MS` rather than the behaviour being read off the code.
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
      expect(thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);

      // The in-memory store is on the same injected clock, so this is the real
      // expiry and not a stubbed one: eleven minutes on, `get` drops the entry.
      clock = new Date(clock.getTime() + 11 * 60_000);
      const token = thumbnailPath.slice(ROUTES.thumbnail("").length);
      expect(harness.app.context.thumbnails.get(token)).toBeNull();

      // Before dl-44 this was a 404 with nothing logged, which is exactly the
      // failure the ticket calls silent.
      const served = await harness.app.server.inject({ method: "GET", url: thumbnailPath });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(served.rawPayload.equals(PNG)).toBe(true);
    } finally {
      await image.close();
    }
  });

  test("the retention sweep unlinks the preview with the file", async () => {
    // Done-when 2, asserted on the bytes rather than on the route: the image
    // sits inside `out/<jobId>/`, which is what the sweep deletes, so "the
    // image goes when the file goes" has no second rule to fall out of step.
    let clock = new Date("2026-09-07T10:00:00.000Z");
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
        now: () => clock,
        config: { fileRetentionHours: 6 },
      });

      const created = await createJob(harness);
      const finished = await runToTerminal(harness, created.id);
      const thumbnailPath = finished.thumbnailPath ?? "";
      // Where `persistThumbnail` puts it: inside the job's own out directory,
      // named for its content type. See `PERSISTED_THUMBNAIL_STEM`.
      const onDisk = path.join(harness.storageRoot, "out", created.id, "preview.png");
      // The write happened at all — otherwise the unlink below proves nothing.
      expect((await fs.stat(onDisk)).size).toBe(PNG.byteLength);

      // Seven hours on, past `fileRetentionHours`, so the file token has lapsed
      // and the sweep takes the job's output directory.
      clock = new Date(clock.getTime() + 7 * 3_600_000);
      await runRetentionSweep(harness.app.context);

      await expect(fs.stat(onDisk)).rejects.toThrow();
      // And the route agrees, which is the half a user sees.
      const served = await harness.app.server.inject({ method: "GET", url: thumbnailPath });
      expect(served.statusCode).toBe(404);
      // The row went too, so nothing is left pointing at deleted bytes.
      expect(
        harness.app.context.store.findThumbnail(thumbnailPath.slice(ROUTES.thumbnail("").length)),
      ).toBeNull();
    } finally {
      await image.close();
    }
  });

  test("a restart does not lose the preview of a job whose file survived it", async () => {
    // Done-when 3. Two apps over one database and one storage directory, which
    // is what a redeploy is: the in-memory store is empty in the second, and
    // the token the first minted still resolves because the bytes are on disk.
    const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl44-db-"));
    const databasePath = path.join(dbDir, "jobs.sqlite");
    const image = await imageOrigin();
    let first: Harness | undefined;
    try {
      first = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
        config: { databasePath },
      });
      const created = await createJob(first);
      const finished = await runToTerminal(first, created.id);
      const thumbnailPath = finished.thumbnailPath ?? "";
      expect(thumbnailPath).not.toBe("");

      // Down. Not `dispose()`, which would take the storage directory with it —
      // a restart that loses the file is a different test.
      await first.app.shutdown();

      // Up again on the same database and the same storage.
      harness = await createHarness({
        config: { databasePath, storageDir: first.storageRoot },
        engineOptions: { storageRoot: first.storageRoot },
      });
      // Nothing carried over in memory; only the row and the bytes did.
      expect(harness.app.context.thumbnails.size).toBe(0);

      const served = await harness.app.server.inject({ method: "GET", url: thumbnailPath });
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload.equals(PNG)).toBe(true);
    } finally {
      await image.close();
      // **Close both databases before unlinking anything.** This is the only
      // test in the suite backed by a real SQLite file rather than `:memory:`,
      // and it is the only one that has to say this out loud.
      //
      // The second app is still up here: `afterEach` is what disposes it, and
      // `afterEach` runs *after* this `finally`. Measured on Linux by counting
      // `/proc/self/fd` at each point — 3 descriptors on `jobs.sqlite`, `-wal`
      // and `-shm` are open at this line and drop to 0 only inside `afterEach`.
      // POSIX unlinks an open file happily, so this cost nothing here and
      // failed on Windows, where an open handle refuses `unlink` with `EBUSY`.
      // `shutdown()` is idempotent, so disposing again in `afterEach` is a
      // no-op and the first app's second shutdown below is free.
      await harness?.app.shutdown();
      await first?.app.shutdown();
      if (first !== undefined) await fs.rm(first.storageRoot, { recursive: true, force: true });
      await fs.rm(dbDir, { recursive: true, force: true });
    }
  });

  test("a row naming a type outside the allowlist is refused, bytes or no bytes", async () => {
    // The read path re-checks `record.contentType` because the value becomes a
    // `Content-Type` on our own origin, and the row is a boundary: a build that
    // did not agree with this one, or a hand-edited database, is the case it is
    // for. Without this test, deleting that check is green across the whole
    // downloader project — measured, not assumed.
    //
    // The row is written by hand rather than captured, because `captureThumbnail`
    // allowlists before storing and so cannot produce one. Everything else about
    // it is valid: a real job, a real file on disk, a well-formed token — which
    // is what isolates the branch under test from the three refusals above it.
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const created = await createJob(harness);
      const finished = await runToTerminal(harness, created.id);
      const onDisk = path.join(harness.storageRoot, "out", created.id, "preview.png");
      expect((await fs.stat(onDisk)).size).toBe(PNG.byteLength);

      const store = harness.app.context.store;
      // Well formed: 43 base64url characters, so it passes the shape guard and
      // reaches the check this test is about.
      const servable = "a".repeat(43);
      const refused = "b".repeat(43);
      store.saveThumbnail({
        token: servable,
        jobId: created.id,
        path: onDisk,
        contentType: "image/png",
      });
      store.saveThumbnail({
        token: refused,
        jobId: created.id,
        path: onDisk,
        // An SVG is a document that can carry script; serving one from this
        // origin would be a stored XSS. See `ALLOWED_CONTENT_TYPES`.
        contentType: "image/svg+xml",
      });

      // The control, so a 404 below cannot be blamed on the hand-written row:
      // the same bytes under an allowed type serve.
      const ok = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.thumbnail(servable),
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers["content-type"]).toBe("image/png");

      const blocked = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.thumbnail(refused),
      });
      expect(blocked.statusCode).toBe(404);
      expect(blocked.headers["content-type"]).not.toContain("image/svg+xml");

      // The finished job's own preview is untouched by any of this.
      expect(
        (
          await harness.app.server.inject({
            method: "GET",
            url: finished.thumbnailPath ?? "",
          })
        ).statusCode,
      ).toBe(200);
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
      expect(await fs.readdir(path.join(harness.storageRoot, "out"))).toEqual([]);
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
    // VARIANT_GONE — tools/downloader/engine/src/download/manifest.ts maps every
    // ffmpeg failure to that one code. Not retrying it would leave the commonest
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
