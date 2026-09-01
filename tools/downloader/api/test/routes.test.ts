/**
 * The HTTP surface: validation, status mapping, the probe cache, SSE framing
 * and file serving. The pipeline itself is covered in `pipeline.test.ts`.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  AppError,
  jobListResponseSchema,
  jobResponseSchema,
  parseJobEvent,
  ROUTES,
} from "@downloader/contract";
import type {
  JobListResponse,
  JobResponse,
  ProbeResponse,
  ProbeResult,
} from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { formatSseFrame } from "../src/routes/events.ts";
import { contentDisposition, parseRange } from "../src/routes/files.ts";
import { statusForCode, toErrorResponse } from "../src/http-errors.ts";
import type { HealthResponse } from "../src/routes/health.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

/** A 1×1 PNG. Real bytes, so a content-type assertion means something. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

describe("the preview image never lets the client name a URL", () => {
  /** A real origin on loopback, so the probe route's own `guardedFetch` runs. */
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

  test("the response carries our path and not the origin URL the page chose", async () => {
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      const body = response.json() as ProbeResponse;

      // Asserted on the body rather than by reading the code: an origin URL the
      // client is not allowed to fetch has no business reaching the client.
      expect(body.probe.thumbnailUrl).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(image.origin);
      expect(body.probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    } finally {
      await image.close();
    }
  });

  test("that path serves the bytes, typed from an allowlist and with nosniff", async () => {
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const probe = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        })
      ).json() as ProbeResponse;

      const served = await harness.app.server.inject({
        method: "GET",
        url: probe.probe.thumbnailPath ?? "",
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      // Without this a browser may overrule the type on a body whose first bytes
      // a hostile origin chose.
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(served.rawPayload.equals(PNG)).toBe(true);
    } finally {
      await image.close();
    }
  });

  test("a cache hit hands back a token that still resolves", async () => {
    // The token is minted before the probe cache is written, so the second
    // (cached) answer carries the first answer's token. That only works while
    // the thumbnail store outlives `PROBE_CACHE_TTL_CEILING_MS`.
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const send = async (): Promise<ProbeResponse> =>
        (
          await (harness as Harness).app.server.inject({
            method: "POST",
            url: ROUTES.probe,
            payload: { url: SOURCE_URL },
          })
        ).json() as ProbeResponse;

      const first = await send();
      const second = await send();
      expect(second.cached).toBe(true);
      expect(second.probe.thumbnailPath).toBe(first.probe.thumbnailPath);
      expect(
        (
          await harness.app.server.inject({
            method: "GET",
            url: second.probe.thumbnailPath ?? "",
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await image.close();
    }
  });

  test("a thumbnail on a blocked address costs the preview, not the probe", async () => {
    // A real guard, not a stub. Private addresses are refused, and only the two
    // fictional media hosts are exempted — so `169.254.169.254` is blocked on
    // its address without any DNS being consulted.
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({ thumbnailUrl: "http://169.254.169.254/latest/meta-data/" }),
      ),
      config: {
        ssrfAllowPrivateAddresses: false,
        ssrfAllowHosts: ["site.example", "cdn.example"],
      },
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });

    // The video is still downloadable, which is the whole point of `bestEffort`.
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProbeResponse;
    expect(body.probe.variants).toHaveLength(1);
    expect(body.probe.thumbnailPath).toBeUndefined();
    expect(body.probe.thumbnailUrl).toBeUndefined();
  });

  test("a probe with no thumbnail is unchanged", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const body = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      })
    ).json() as ProbeResponse;
    expect(body.probe.thumbnailPath).toBeUndefined();
    expect(body.probe.variants).toHaveLength(1);
  });

  test("an unknown token is THUMBNAIL_NOT_FOUND, 404 — not JOB_NOT_FOUND and not a 500", async () => {
    harness = await createHarness();
    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.thumbnail("a".repeat(43)),
    });
    expect(response.statusCode).toBe(404);
    // Its own code: this names neither a job nor a route, and reusing
    // `JOB_NOT_FOUND` would need its copy rewritten here — the tell that the
    // code is wrong.
    expect(response.json()).toMatchObject({
      error: { code: "THUMBNAIL_NOT_FOUND", retryable: false },
    });
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

/** Runs a job to completion so there is a real token to leak. */
async function completed(current: Harness): Promise<{ id: string; token: string }> {
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
  const url = finished.result?.downloadUrl ?? "";
  return { id: created.job.id, token: url.slice(url.lastIndexOf("/") + 1) };
}

/**
 * The job list is unauthenticated and unfiltered by caller, so anything it
 * carries is world-readable to anyone who can reach the port.
 *
 * `contract/src/job.ts` calls `downloadUrl` *"opaque, unguessable... never a
 * predictable id"*, and that is true — and beside the point once an endpoint
 * hands the whole set out. Unguessable stops a search; it does not stop a
 * listing. So the capability is stripped from the list and kept on the
 * single-job read, where reaching it already requires knowing the job id.
 *
 * That trade only holds because a job id is `randomUUID()` — 122 bits from a
 * CSPRNG (`routes/jobs.ts`, and the store never reassigns it). If job ids were
 * ever made sequential or timestamped, this mitigation would move the hole
 * rather than close it, and the list would need real authorisation instead.
 */
describe("a job list does not hand out capabilities", () => {
  test("the list carries no download token, with nothing supplied", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { token } = await completed(harness);
    expect(token).toHaveLength(43);

    // No id, no token, no credential of any kind — the enumeration case.
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.jobs });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(ROUTES.file(""));

    // The list is still worth having: everything else about the job survives,
    // so this is a redaction and not an amputation.
    const body = response.json() as JobListResponse;
    expect(body.total).toBe(1);
    expect(body.jobs[0]?.result).toMatchObject({ filename: "video.mp4", container: "mp4" });
    expect(jobListResponseSchema.safeParse(body).success).toBe(true);
  });

  test("reading one job still carries it, because the app cannot work without it", async () => {
    // The guard against this cure becoming a disease. `JobCard.tsx` renders the
    // download button from `result.downloadUrl`, fed by `useJobs`'s `getJob`
    // poll — strip it there and the product stops doing the thing it is for.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { id, token } = await completed(harness);

    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.job(id) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as JobResponse;
    expect(body.job.result?.downloadUrl).toBe(ROUTES.file(token));
    expect(jobResponseSchema.safeParse(body).success).toBe(true);
  });

  test("a job id is not guessable, which is what makes the trade sound", async () => {
    // If this ever fails, the list-only mitigation above stops being enough.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const ids = new Set<string>();
    for (let index = 0; index < 5; index++) {
      // oxlint-disable-next-line no-await-in-loop
      const created = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
        })
      ).json() as JobResponse;
      ids.add(created.job.id);
      // RFC 4122 v4, variant 10xx: 122 bits from a CSPRNG.
      expect(created.job.id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
      );
    }
    expect(ids.size).toBe(5);
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

  test("the `probed` frame carries our path and not the origin URL", async () => {
    // **The second door.** This frame ships a whole `ProbeResult` to the client,
    // so rewriting only `POST /api/probe`'s body — which is all Done-when 5 asks
    // for — would have let the origin URL out by the other route. Asserted on
    // the raw frame text, not on a parsed field: "the shape we expected was
    // rewritten" and "the address is not in the bytes" are different claims and
    // only the second is the one worth having.
    const image = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => image.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(image.address() as AddressInfo).port}`;
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${origin}/og.png` })),
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

      expect(response.body).not.toContain(origin);
      const probed = response.body
        .split("\n\n")
        .filter((chunk) => chunk.startsWith("data: "))
        .map((chunk) => parseJobEvent(chunk.slice("data: ".length)))
        .find((event) => event?.type === "probed");

      // Present, so this is not passing because no frame was emitted.
      expect(probed).toBeDefined();
      const probe = (probed as { probe: ProbeResult }).probe;
      expect(probe.thumbnailUrl).toBeUndefined();
      expect(probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    } finally {
      image.closeAllConnections();
      await new Promise<void>((resolve) => image.close(() => resolve()));
    }
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
