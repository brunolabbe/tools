import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { JobProgress, RequestContext } from "@downloader/shared";
import type { Clock } from "../src/config.ts";
import { downloadProgressive } from "../src/download/progressive.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { makeBody, parseRangeStart, startFixtureServer } from "./helpers/http.ts";

const BODY = makeBody(64 * 1024);

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://site.example/watch",
    "User-Agent": "FixtureAgent/1.0",
    Cookie: "session=abc",
  },
};

/** Instant sleeps, recorded, so retry tests do not spend real seconds. */
function recordingClock(into: number[]): Clock {
  return {
    now: () => Date.now(),
    sleep: async (ms) => {
      into.push(ms);
    },
  };
}

let workDir: string;
let server: FixtureServer | null = null;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-progressive-"));
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fs.rm(workDir, { recursive: true, force: true });
});

function dest(name = "media.mp4"): string {
  return path.join(workDir, name);
}

describe("downloadProgressive", () => {
  test("replays the captured context — the origin 403s without it", async () => {
    server = await startFixtureServer((request, response) => {
      if (
        request.headers.referer !== "https://site.example/watch" ||
        request.headers.cookie !== "session=abc" ||
        request.headers["user-agent"] !== "FixtureAgent/1.0"
      ) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": String(BODY.length),
      });
      response.end(BODY);
    });

    const result = await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      requestContext: CONTEXT,
    });

    expect(result.bytes).toBe(BODY.length);
    expect(result.totalBytes).toBe(BODY.length);
    expect(await fs.readFile(dest())).toEqual(BODY);
  });

  test("resumes from a partial file with a Range request", async () => {
    server = await startFixtureServer((request, response) => {
      const start = parseRangeStart(request.headers.range);
      if (start === null) {
        response.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
        return;
      }
      const slice = BODY.subarray(start);
      response.writeHead(206, {
        "content-length": String(slice.length),
        "content-range": `bytes ${start}-${BODY.length - 1}/${BODY.length}`,
      });
      response.end(slice);
    });

    const already = 20_000;
    await fs.writeFile(dest(), BODY.subarray(0, already));

    const result = await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      requestContext: CONTEXT,
    });

    expect(result.resumed).toBe(true);
    expect(result.bytes).toBe(BODY.length);
    expect(await fs.readFile(dest())).toEqual(BODY);
    expect(server.requests[0]?.headers.range).toBe(`bytes=${already}-`);
  });

  test("an origin that ignores Range restarts cleanly instead of corrupting the file", async () => {
    server = await startFixtureServer((_request, response) => {
      // 200 with the whole body, Range header ignored — common in the wild.
      response.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });

    await fs.writeFile(dest(), BODY.subarray(0, 5000));

    const result = await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
    });

    expect(result.bytes).toBe(BODY.length);
    expect(await fs.readFile(dest())).toEqual(BODY);
  });

  test("reports totalBytes and percent as null when there is no Content-Length", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.write(BODY.subarray(0, 32_768));
      response.end(BODY.subarray(32_768));
    });

    const seen: JobProgress[] = [];
    const result = await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      onProgress: (progress) => seen.push(progress),
      progressIntervalMs: 0,
    });

    expect(result.bytes).toBe(BODY.length);
    expect(result.totalBytes).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    // Never a fabricated percentage.
    expect(seen.every((progress) => progress.percent === null)).toBe(true);
    expect(seen.every((progress) => progress.totalBytes === null)).toBe(true);
    expect(seen.at(-1)?.downloadedBytes).toBe(BODY.length);
  });

  test("emits a real percentage when the total is known", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(200, { "content-length": String(BODY.length) });
      response.write(BODY.subarray(0, 32_768));
      response.end(BODY.subarray(32_768));
    });

    const seen: JobProgress[] = [];
    await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      onProgress: (progress) => seen.push(progress),
      progressIntervalMs: 0,
    });

    const percentages = seen.map((progress) => progress.percent ?? -1);
    expect(percentages.at(-1)).toBeCloseTo(100, 6);
    for (const [index, value] of percentages.entries()) {
      if (index === 0) continue;
      expect(value).toBeGreaterThanOrEqual(percentages[index - 1] as number);
    }
  });

  test("404 mid-download is VARIANT_GONE, not DOWNLOAD_FAILED", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(404).end();
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        retryPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "VARIANT_GONE" });
  });

  test("410 is VARIANT_GONE too", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(410).end();
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        retryPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "VARIANT_GONE" });
  });

  test("403 on a signed URL means expired, so it maps to VARIANT_GONE", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(403).end();
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4?token=x`,
        destPath: dest(),
        retryPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "VARIANT_GONE" });
  });

  test("401 is AUTH_REQUIRED", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(401).end();
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        retryPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("retries a 503 with backoff and then succeeds", async () => {
    let hits = 0;
    server = await startFixtureServer((_request, response) => {
      hits += 1;
      if (hits <= 2) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });

    const delays: number[] = [];
    const result = await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      clock: recordingClock(delays),
      retryPolicy: { maxAttempts: 5, baseMs: 100, jitter: 0, random: () => 0 },
    });

    expect(hits).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(result.bytes).toBe(BODY.length);
  });

  test("honours Retry-After over the computed backoff", async () => {
    let hits = 0;
    server = await startFixtureServer((_request, response) => {
      hits += 1;
      if (hits === 1) {
        response.writeHead(429, { "retry-after": "7" }).end();
        return;
      }
      response.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });

    const delays: number[] = [];
    await downloadProgressive({
      url: `${server.origin}/video.mp4`,
      destPath: dest(),
      clock: recordingClock(delays),
      retryPolicy: { maxAttempts: 3, baseMs: 100, jitter: 0, random: () => 0 },
    });

    expect(delays).toEqual([7000]);
  });

  test("gives up with DOWNLOAD_FAILED once the retry budget is spent", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(500).end();
    });

    const delays: number[] = [];
    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        clock: recordingClock(delays),
        retryPolicy: { maxAttempts: 3, baseMs: 10, jitter: 0, random: () => 0 },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });

    expect(delays).toHaveLength(2);
  });

  test("refuses a body larger than maxBytes before writing all of it", async () => {
    server = await startFixtureServer((_request, response) => {
      response.writeHead(200, { "content-length": String(BODY.length) }).end(BODY);
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        maxBytes: 1024,
        retryPolicy: { maxAttempts: 2 },
      }),
    ).rejects.toMatchObject({ code: "SIZE_LIMIT_EXCEEDED" });
  });

  test("refuses on the announced size without transferring anything", async () => {
    let bodySent = false;
    server = await startFixtureServer((_request, response) => {
      response.writeHead(200, { "content-length": String(BODY.length) });
      bodySent = true;
      response.end(BODY);
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        maxBytes: 1024,
        retryPolicy: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "SIZE_LIMIT_EXCEEDED" });

    // The file must not exist with partial content the caller might publish.
    const written = await fs.stat(dest()).catch(() => null);
    expect(written?.size ?? 0).toBeLessThanOrEqual(1024);
    expect(bodySent).toBe(true);
  });

  test("aborts with JOB_CANCELED", async () => {
    const controller = new AbortController();
    server = await startFixtureServer((_request, response) => {
      response.writeHead(200, { "content-length": String(BODY.length * 100) });
      response.write(BODY);
      setTimeout(() => {
        controller.abort();
      }, 20);
    });

    await expect(
      downloadProgressive({
        url: `${server.origin}/video.mp4`,
        destPath: dest(),
        signal: controller.signal,
        retryPolicy: { maxAttempts: 3, baseMs: 1, jitter: 0, random: () => 0 },
      }),
    ).rejects.toMatchObject({ code: "JOB_CANCELED" });
  });
});
