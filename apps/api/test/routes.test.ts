/**
 * The HTTP surface: validation, status mapping, the probe cache, SSE framing
 * and file serving. The pipeline itself is covered in `pipeline.test.ts`.
 */

import path from "node:path";
import { AppError, parseJobEvent, ROUTES } from "@downloader/shared";
import type { JobResponse, ProbeResponse } from "@downloader/shared";
import { afterEach, describe, expect, test } from "vitest";
import { formatSseFrame } from "../src/routes/events.ts";
import { contentDisposition, parseRange } from "../src/routes/files.ts";
import { statusForCode, toErrorResponse } from "../src/http-errors.ts";
import type { HealthResponse } from "../src/routes/health.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("POST /api/probe", () => {
  test("returns the probe and reports it uncached", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProbeResponse;
    expect(body.cached).toBe(false);
    expect(body.probe.variants).toHaveLength(1);
  });

  test("serves the double-click from cache, and `refresh` bypasses it", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver });

    const send = async (payload: Record<string, unknown>) =>
      (
        await (harness as Harness).app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload,
        })
      ).json() as ProbeResponse;

    expect((await send({ url: SOURCE_URL })).cached).toBe(false);
    expect((await send({ url: SOURCE_URL })).cached).toBe(true);
    expect(resolver.calls).toBe(1);

    expect((await send({ url: SOURCE_URL, refresh: true })).cached).toBe(false);
    expect(resolver.calls).toBe(2);
  });

  test("a zero TTL disables the cache entirely", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver, config: { probeCacheTtlMs: 0 } });
    for (let index = 0; index < 2; index++) {
      // oxlint-disable-next-line no-await-in-loop
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
    }
    expect(resolver.calls).toBe(2);
  });

  test("rejects a non-http URL with INVALID_URL, not a 500", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "file:///etc/passwd" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_URL" } });
  });

  test("a resolver's terminal verdict keeps its own status", async () => {
    harness = await createHarness({
      resolver: new StubResolver(async () => {
        throw new AppError("DRM_PROTECTED");
      }),
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    // 451 is the one status that means precisely this.
    expect(response.statusCode).toBe(451);
    expect(response.json()).toMatchObject({ error: { code: "DRM_PROTECTED", retryable: false } });
  });
});

describe("job routes", () => {
  test("creating a job validates the body", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: "not a url" },
    });
    expect(response.statusCode).toBe(400);
  });

  test("listing returns newest first with a total", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    for (let index = 0; index < 3; index++) {
      // oxlint-disable-next-line no-await-in-loop
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      });
    }
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.jobs });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { jobs: unknown[]; total: number };
    expect(body.total).toBe(3);
    expect(body.jobs).toHaveLength(3);
  });

  test("an unknown job id is a 404", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.job("nope") });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });
});

describe("GET /api/health", () => {
  test("reports the resolver chain and queue depth", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(200);
    const body = response.json() as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.resolvers).toContain("stub");
    expect(body.jobs.maxConcurrent).toBe(2);
  });

  test("reports the tiers, the volume and the version an operator has to ask about", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const body = (
      await harness.app.server.inject({ method: "GET", url: ROUTES.health })
    ).json() as HealthResponse;

    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    // The harness disables both tiers, which must read as disabled rather than
    // as broken — "off" and "missing" are different operational answers.
    expect(body.ytdlp).toEqual({ enabled: false, available: false, path: null });
    expect(body.browser.enabled).toBe(false);
    expect(body.storage.dir).toBe(harness.storageRoot);
    expect(body.storage.quotaBytes).toBeGreaterThan(0);
    // `statfs` answers on both CI platforms; null is the documented fallback.
    expect(body.storage.freeBytes === null || body.storage.freeBytes > 0).toBe(true);
  });

  test("a configured ffmpeg that is not actually there is 503, not a green light", async () => {
    // The failure this catches: `ffmpeg-static` hands out a confident path
    // inside node_modules whether or not its postinstall download ran, so a
    // container built with --omit=optional passes every other check and then
    // fails every single job.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    (harness.engine.config as { ffmpegPath: string }).ffmpegPath = path.join(
      harness.storageRoot,
      "no-such-ffmpeg",
    );

    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(503);
    const body = response.json() as HealthResponse;
    expect(body.ok).toBe(false);
    expect(body.ffmpeg.available).toBe(false);
  });
});

/** A harness whose single job has already finished, plus its download URL. */
async function completedHarness(): Promise<{ current: Harness; url: string }> {
  const current = await createHarness({ resolver: new StubResolver(probeResult()) });
  const created = (
    await current.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    })
  ).json() as JobResponse;
  const finished = await waitFor(
    () => current.app.context.store.get(created.job.id),
    (job) => job.status === "completed" || job.status === "failed",
    { label: "job to finish" },
  );
  expect(finished.status).toBe("completed");
  return { current, url: finished.result?.downloadUrl ?? "" };
}

describe("file serving", () => {
  test("serves a byte range and reports it correctly", async () => {
    const { current, url } = await completedHarness();
    harness = current;
    const response = await current.app.server.inject({
      method: "GET",
      url,
      headers: { range: "bytes=5-9" },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 5-9/27");
    expect(response.headers["content-length"]).toBe("5");
    expect(response.body).toBe("video");
  });

  test("an unsatisfiable range is a 416, not a truncated body", async () => {
    const { current, url } = await completedHarness();
    harness = current;
    const response = await current.app.server.inject({
      method: "GET",
      url,
      headers: { range: "bytes=9999-" },
    });
    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */27");
  });

  test("a malformed token is rejected on shape before a database lookup", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.file("short") });
    expect(response.statusCode).toBe(404);
  });

  test("past its expiry the link is 410 Gone, not 404", async () => {
    // The distinction matters to a user staring at a link that worked yesterday.
    const { current, url } = await completedHarness();
    harness = current;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const record = current.app.context.store.findToken(token);
    expect(record).not.toBeNull();
    current.app.context.store.deleteToken(token);
    current.app.context.store.saveToken({ ...record!, expiresAt: "2020-01-01T00:00:00.000Z" });

    const response = await current.app.server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: { code: "FILE_EXPIRED" } });
  });

  test("still 410 after the sweep has deleted the file", async () => {
    // The end-to-end version of the store-level regression: once the retention
    // sweep has run, the link must still say "gone", not "never existed".
    const { current, url } = await completedHarness();
    harness = current;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const record = current.app.context.store.findToken(token);
    current.app.context.store.deleteToken(token);
    current.app.context.store.saveToken({ ...record!, expiresAt: "2020-01-01T00:00:00.000Z" });
    current.app.context.store.markSwept(token);
    await current.engine.removeJob(record!.jobId);

    const response = await current.app.server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: { code: "FILE_EXPIRED" } });
  });

  test("a completed file whose bytes vanished is 410, not a 500", async () => {
    const { current, url } = await completedHarness();
    harness = current;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const record = current.app.context.store.findToken(token);
    // The row outlived the file: the sweep ran between the two.
    await current.engine.removeJob(record!.jobId);

    const response = await current.app.server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(410);
  });
});

describe("SSE", () => {
  test("streams the job to completion and ends on the terminal frame", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { emitProgress: true },
    });
    const created = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;

    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents(created.job.id),
    });

    expect(response.headers["content-type"]).toContain("text/event-stream");
    // Nginx buffers proxied responses by default, which would hold every frame
    // until the download finished.
    expect(response.headers["x-accel-buffering"]).toBe("no");

    const events = response.body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => parseJobEvent(chunk.slice("data: ".length)));

    // Every frame validates against the shared schema — the union is emitted
    // verbatim, with no envelope.
    expect(events.every((event) => event !== null)).toBe(true);
    expect(events.at(-1)?.type).toBe("completed");
  });

  test("a job that finished before the client connected still gets its result", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const created = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;
    await waitFor(
      () => (harness as Harness).app.context.store.get(created.job.id),
      (job) => job.status === "completed",
      { label: "job to complete" },
    );

    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents(created.job.id),
    });
    const types = response.body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => parseJobEvent(chunk.slice("data: ".length))?.type);
    // Not left staring at `queued` waiting for an event that will never come.
    expect(types).toContain("completed");
  });

  test("events for an unknown job are a JSON 404, not an empty stream", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents("nope"),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });
});

describe("pure helpers", () => {
  test("formatSseFrame emits one JSON object terminated by a blank line", () => {
    const frame = formatSseFrame({ type: "heartbeat", at: "2026-08-06T10:00:00.000Z" });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(parseJobEvent(frame.slice(6).trim())?.type).toBe("heartbeat");
  });

  test("parseRange covers the forms a browser actually sends", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    // Clamped rather than refused: a client asking past the end still gets the tail.
    expect(parseRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=200-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=50-10", 100)).toBe("unsatisfiable");
    // Multi-range is ignored, which a server is always allowed to do.
    expect(parseRange("bytes=0-9,20-29", 100)).toBeNull();
  });

  test("contentDisposition survives a hostile filename", () => {
    const header = contentDisposition('e"vil\r\n.mp4');
    expect(header.startsWith("attachment;")).toBe(true);
    // No raw CR/LF, or the filename would inject a header.
    expect(header).not.toMatch(/[\r\n]/u);
  });
});

describe("error mapping", () => {
  test("client and source problems are 4xx; only our own failures are 5xx", () => {
    expect(statusForCode("INVALID_URL")).toBe(400);
    expect(statusForCode("DRM_PROTECTED")).toBe(451);
    expect(statusForCode("NO_MEDIA_FOUND")).toBe(422);
    expect(statusForCode("RATE_LIMITED")).toBe(429);
    expect(statusForCode("SIZE_LIMIT_EXCEEDED")).toBe(413);
    expect(statusForCode("FILE_EXPIRED")).toBe(410);
    expect(statusForCode("INTERNAL")).toBe(500);
    expect(statusForCode("DISK_FULL")).toBe(507);
  });

  test("internal details never cross the wire", () => {
    const { status, body } = toErrorResponse(
      new AppError("INTERNAL", "ENOENT: /home/deploy/storage/tmp/secret", {
        details: { stderr: "ffmpeg said something with /paths in it", status: 500 },
      }),
    );
    expect(status).toBe(500);
    // The message is replaced with the taxonomy's safe copy...
    expect(body.error.message).not.toContain("/home/deploy");
    // ...and only allowlisted detail keys survive.
    expect(body.error.details).toEqual({ status: 500 });
  });

  test("a non-AppError becomes INTERNAL rather than leaking a stack", () => {
    const { status, body } = toErrorResponse(new TypeError("x.y is not a function"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("is not a function");
  });
});
