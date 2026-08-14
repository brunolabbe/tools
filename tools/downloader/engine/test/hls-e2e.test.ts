/**
 * Milestone M1, end to end.
 *
 * Generates a real HLS stream with the bundled ffmpeg (synthetic video + tone,
 * segmented into `.ts` with a master playlist), serves it from a local
 * `node:http` server that **403s any request without the captured headers**,
 * and drives the whole engine at it. That last part is the load-bearing bit:
 * the segments are gated as well as the manifest, so a download that only
 * replays the context on the playlist fails here exactly as it would on a CDN.
 *
 * The result is then checked the way a user would experience it — playable,
 * with `moov` ahead of `mdat` so it streams instead of buffering whole.
 *
 * No third-party network access: everything is generated and served locally.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { JobProgress, MediaVariant, RequestContext } from "@downloader/contract";
import { resolveFfmpegPath } from "../src/config.ts";
import { createEngine } from "../src/index.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { startFixtureServer } from "./helpers/http.ts";

const FFMPEG = resolveFfmpegPath();
const CLIP_SECONDS = 6;

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://player.example/watch/42",
    Origin: "https://player.example",
    "User-Agent": "Mozilla/5.0 (FixtureBrowser)",
    Cookie: "cdn_token=s3cr3t",
  },
};

let fixtureDir: string;
let storageDir: string;
let server: FixtureServer;
/** Per-response delay, so the cancellation test has something to interrupt. */
let responseDelayMs = 0;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** Segments a short synthetic clip into `.ts` plus a media and a master playlist. */
async function generateHlsFixture(dir: string): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=320x240:rate=15:duration=${CLIP_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=44100:duration=${CLIP_SECONDS}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "15",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(dir, "seg%03d.ts"),
    path.join(dir, "index.m3u8"),
  ]);

  await fs.writeFile(
    path.join(dir, "master.m3u8"),
    [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240,CODECS="avc1.42c01e,mp4a.40.2"',
      "index.m3u8",
      "",
    ].join("\n"),
    "utf8",
  );
}

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-hls-fixture-"));
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-hls-storage-"));
  await generateHlsFixture(fixtureDir);

  server = await startFixtureServer(async (request, response) => {
    // The gate: this is a CDN checking what the browser sent implicitly.
    if (
      request.headers.referer !== CONTEXT.headers["Referer"] ||
      request.headers.cookie !== CONTEXT.headers["Cookie"] ||
      request.headers["user-agent"] !== CONTEXT.headers["User-Agent"]
    ) {
      response.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
      return;
    }

    const name = path.basename(new URL(request.url ?? "/", "http://x").pathname);
    let body: Buffer;
    try {
      body = await fs.readFile(path.join(fixtureDir, name));
    } catch {
      response.writeHead(404).end();
      return;
    }

    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }

    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(name)] ?? "application/octet-stream",
      "content-length": String(body.length),
    });
    response.end(body);
  });
});

afterAll(async () => {
  await server?.close();
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.rm(storageDir, { recursive: true, force: true });
});

function variant(): MediaVariant {
  return {
    id: "v0",
    protocol: "hls",
    url: `${server.origin}/master.m3u8`,
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc1.42c01e",
    audioCodec: "mp4a.40.2",
    width: 320,
    height: 240,
    durationSec: CLIP_SECONDS,
    label: "240p",
  };
}

/** Top-level MP4 box names in file order. */
async function topLevelBoxes(file: string): Promise<string[]> {
  const buffer = await fs.readFile(file);
  const names: string[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const name = buffer.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize) break;
    names.push(name);
    offset += size;
  }
  return names;
}

/** Re-reads the produced file with ffmpeg; a non-zero exit means unplayable. */
async function assertDecodable(file: string): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-xerror",
    "-i",
    file,
    "-f",
    "null",
    "-",
  ]);
}

describe("M1: HLS download end to end", () => {
  test("produces a playable, seekable, fast-start MP4 from a gated HLS source", async () => {
    const engine = createEngine({ storageDir, maxFileSizeBytes: 256 * 1024 * 1024 });
    await engine.init();

    const stages: string[] = [];
    const progress: JobProgress[] = [];

    const outcome = await engine.download({
      jobId: "m1",
      variant: variant(),
      requestContext: CONTEXT,
      title: "Fixture: clip / with*bad<chars>",
      durationSec: CLIP_SECONDS,
      onStage: (stage) => stages.push(stage),
      onProgress: (value) => progress.push(value),
    });

    expect(stages).toEqual(["downloading", "muxing"]);
    expect(outcome.container).toBe("mp4");
    expect(outcome.sizeBytes).toBeGreaterThan(10_000);
    expect(outcome.transcodes).toEqual([]);

    // The hostile title never becomes a path.
    expect(outcome.filename).toBe("Fixture_ clip _ with_bad_chars_.mp4");
    expect(path.dirname(outcome.path)).toBe(path.join(storageDir, "out", "m1"));

    // Duration survived the remux.
    expect(outcome.durationSec ?? 0).toBeGreaterThan(CLIP_SECONDS - 1);
    expect(outcome.durationSec ?? 0).toBeLessThan(CLIP_SECONDS + 1);

    // Fast start: the index is ahead of the media, so a browser can play while
    // it downloads instead of waiting for the whole file.
    const boxes = await topLevelBoxes(outcome.path);
    expect(boxes).toContain("moov");
    expect(boxes).toContain("mdat");
    expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));

    await assertDecodable(outcome.path);

    // Headers were replayed on the segments too, not just the playlist.
    const segmentRequests = server.requests.filter((request) => request.url.endsWith(".ts"));
    expect(segmentRequests.length).toBeGreaterThan(1);
    expect(
      segmentRequests.every((request) => request.headers.referer === CONTEXT.headers["Referer"]),
    ).toBe(true);
    expect(
      segmentRequests.every((request) => request.headers.cookie === CONTEXT.headers["Cookie"]),
    ).toBe(true);

    // Real progress, and a real percentage because the duration was known.
    expect(progress.length).toBeGreaterThan(0);
    const percentages = progress.map((value) => value.percent).filter((value) => value !== null);
    expect(percentages.length).toBeGreaterThan(0);
    expect(percentages.at(-1) ?? 0).toBeGreaterThan(90);
    expect(progress.at(-1)?.processedSec ?? 0).toBeGreaterThan(CLIP_SECONDS - 1);

    // Working files are gone; the artifact is not.
    await expect(fs.stat(path.join(storageDir, "tmp", "m1"))).rejects.toThrow();
    await expect(fs.stat(outcome.path)).resolves.toBeDefined();
  });

  test("a missing Referer is a 403, which the engine reports as VARIANT_GONE", async () => {
    const engine = createEngine({ storageDir });
    await engine.init();

    await expect(
      engine.download({
        jobId: "no-headers",
        variant: variant(),
        requestContext: { headers: {} },
        title: "unauthorised",
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });

    // Nothing is left behind for a failed job.
    await expect(fs.stat(path.join(storageDir, "out", "no-headers"))).rejects.toThrow();
    await expect(fs.stat(path.join(storageDir, "tmp", "no-headers"))).rejects.toThrow();
  });

  test("a runtime size cap stops the download even when no estimate was possible", async () => {
    const engine = createEngine({ storageDir, maxFileSizeBytes: 16 * 1024 });
    await engine.init();

    const noBitrate = { ...variant(), durationSec: undefined };
    await expect(
      engine.download({
        jobId: "too-big",
        variant: noBitrate,
        requestContext: CONTEXT,
        title: "oversized",
      }),
    ).rejects.toMatchObject({ code: "SIZE_LIMIT_EXCEEDED" });

    await expect(fs.stat(path.join(storageDir, "out", "too-big"))).rejects.toThrow();
  });

  test("cancelling kills the process tree and leaves no artifacts", async () => {
    responseDelayMs = 250;
    try {
      const engine = createEngine({ storageDir });
      await engine.init();

      const controller = new AbortController();
      const pending = engine.download({
        jobId: "cancelled",
        variant: variant(),
        requestContext: CONTEXT,
        title: "cancel me",
        signal: controller.signal,
      });

      setTimeout(() => {
        controller.abort();
      }, 400);

      await expect(pending).rejects.toMatchObject({ code: "JOB_CANCELED" });
      await expect(fs.stat(path.join(storageDir, "tmp", "cancelled"))).rejects.toThrow();
      await expect(fs.stat(path.join(storageDir, "out", "cancelled"))).rejects.toThrow();
    } finally {
      responseDelayMs = 0;
    }
  });

  test("the manual segment fallback fetches every segment with the context replayed", async () => {
    const engine = createEngine({ storageDir, segmentConcurrency: 2 });
    await engine.init();

    const names = (await fs.readdir(fixtureDir)).filter((name) => name.endsWith(".ts")).toSorted();
    expect(names.length).toBeGreaterThan(1);

    const before = server.requests.length;
    const outcome = await engine.download({
      jobId: "fallback",
      variant: variant(),
      requestContext: CONTEXT,
      title: "fallback",
      durationSec: CLIP_SECONDS,
      // ffmpeg is bypassed for *fetching* only; assembly still goes through it.
      segmentUrls: names.map((name) => `${server.origin}/${name}`),
    });

    expect(outcome.sizeBytes).toBeGreaterThan(10_000);
    await assertDecodable(outcome.path);

    const fetched = server.requests.slice(before).filter((request) => request.url.endsWith(".ts"));
    expect(fetched).toHaveLength(names.length);
    expect(fetched.every((request) => request.headers.cookie === CONTEXT.headers["Cookie"])).toBe(
      true,
    );
    // No playlist was requested: the URL list came from the caller.
    expect(server.requests.slice(before).some((request) => request.url.endsWith(".m3u8"))).toBe(
      false,
    );
  });

  test("live sources demand an explicit duration limit", async () => {
    const engine = createEngine({ storageDir });
    await engine.init();

    await expect(
      engine.download({
        jobId: "live",
        variant: variant(),
        requestContext: CONTEXT,
        isLive: true,
      }),
    ).rejects.toMatchObject({ code: "LIVE_STREAM_UNSUPPORTED" });
  });

  test("a live capture is bounded by liveDurationSec", async () => {
    const engine = createEngine({ storageDir });
    await engine.init();

    const outcome = await engine.download({
      jobId: "live-capped",
      variant: variant(),
      requestContext: CONTEXT,
      title: "live capture",
      isLive: true,
      options: { liveDurationSec: 2 },
    });

    expect(outcome.durationSec ?? 0).toBeLessThan(CLIP_SECONDS - 1);
    expect(outcome.durationSec ?? 0).toBeGreaterThan(1);
  });
});
