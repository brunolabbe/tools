/**
 * dl-53: every rendition streamed to a real HTTP client as it is produced, and
 * nothing written anywhere on the way.
 *
 * Each case generates a real source with ffmpeg, serves it from a local origin
 * that **403s any request without the captured headers**, streams it through
 * `engine.stream()` into a real `node:http` response, and reads it with a real
 * client. The result is then read back by `ffprobe` — its container, its
 * streams and its length — rather than trusted from the arguments.
 *
 * "Nothing written" is asserted, not assumed: the process's temp directory is
 * listed before and after every stream. The engine has no storage directory
 * any more; `STORAGE_DIR` is the API's, and its suite lists that one.
 * The temp directory is a private one this file points `TMPDIR` at, so a
 * sibling suite writing to the shared `/tmp` cannot make the listing lie in
 * either direction — and it is what `os.tmpdir()` returns to Node and what
 * ffmpeg inherits, which is the claim.
 *
 * The lengths differ on purpose (4, 5, 6, 8, 9 and 11 seconds): a tolerance
 * checked against one uniform length could pass on a constant.
 */

import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { AppError, DEFAULT_ERROR_MESSAGES } from "@downloader/contract";
import type { JobOptions, MediaVariant, RequestContext, SubtitleTrack } from "@downloader/contract";
import type { EngineConfigInput } from "../src/config.ts";
import { createEngine } from "../src/index.ts";
import type { Logger } from "../src/logger.ts";
import { NOOP_LOGGER } from "../src/logger.ts";
import { assertContainerCanHold } from "../src/mux.ts";
import { buildStreamArgs, expectedOutputBytes } from "../src/stream.ts";
import type { MediaStream } from "../src/index.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { startFixtureServer } from "./helpers/http.ts";
import {
  generateDash,
  generateHls,
  generateLongGop,
  generateProgressive,
  generateWebm,
  listTree,
  probeMedia,
  SUBTITLE_VTT,
  topLevelBoxes,
} from "./helpers/media.ts";

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://player.example/watch/53",
    "User-Agent": "Mozilla/5.0 (FixtureBrowser)",
    Cookie: "cdn_token=s3cr3t",
  },
};

/** Duration tolerance, in seconds. A 2 s segment either side would be caught. */
const TOLERANCE_SEC = 0.6;

let fixtureRoot: string;
let privateTmp: string;
let outputDir: string;
let origin: FixtureServer;
/** Per-request delay at the origin, for the cases that need a stream to take time. */
let originDelayMs = 0;
/**
 * A delay on the third segment onwards only, so the first byte comes at full
 * speed and the stream then stalls — "after the first byte" by construction,
 * rather than by a timing margin a loaded machine can eat.
 */
let lateSegmentDelayMs = 0;
/**
 * A fault a test injects at the origin: answers the request itself and returns
 * true, or returns false to let it be served normally. `count` is how many
 * times this path has been asked for, this test included.
 */
type Fault = (
  pathname: string,
  count: number,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  body: Buffer,
) => boolean;
let fault: Fault | null = null;
const requestCounts = new Map<string, number>();

/** Sends `fraction` of what was asked for, then resets the connection. */
function cutShort(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  body: Buffer,
  fraction: number,
): void {
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
  const start = range === null ? 0 : Number(range[1]);
  const end = range === null || range[2] === "" ? body.length - 1 : Number(range[2]);
  const length = end - start + 1;
  response.writeHead(range === null ? 200 : 206, {
    "accept-ranges": "bytes",
    ...(range === null ? {} : { "content-range": `bytes ${start}-${end}/${body.length}` }),
    "content-length": String(length),
  });
  response.write(body.subarray(start, start + Math.floor(length * fraction)), () => {
    request.socket.destroy();
  });
}
const savedTmp: Record<string, string | undefined> = {};

const TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mpd": "application/dash+xml",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".vtt": "text/vtt",
};

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "engine-stream-fixture-"));
  await Promise.all([
    generateHls(path.join(fixtureRoot, "hls6"), 6),
    generateHls(path.join(fixtureRoot, "hls11"), 11),
    // Gate 2's reproduction: six 1 s segments, of which the origin serves two.
    generateHls(path.join(fixtureRoot, "midfail"), 6, 1),
    generateDash(path.join(fixtureRoot, "dash8"), 8),
    generateProgressive(path.join(fixtureRoot, "prog9"), 9),
    generateProgressive(path.join(fixtureRoot, "prog4"), 4),
    generateProgressive(path.join(fixtureRoot, "pair5"), 5),
  ]);
  await fs.mkdir(path.join(fixtureRoot, "subs"));
  await fs.writeFile(path.join(fixtureRoot, "subs", "en.vtt"), SUBTITLE_VTT, "utf8");

  origin = await startFixtureServer(async (request, response) => {
    if (
      request.headers.referer !== CONTEXT.headers["Referer"] ||
      request.headers.cookie !== CONTEXT.headers["Cookie"]
    ) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://x").pathname;
    // From the third segment on, every connection is reset: a source that
    // fails mid-stream, after the first byte has gone.
    if (/^\/midfail\/seg0*[2-9]\d*\.ts$/u.test(pathname)) {
      request.socket.destroy();
      return;
    }
    const file = path.join(fixtureRoot, ...pathname.split("/").filter((part) => part !== ".."));
    let body: Buffer;
    try {
      body = await fs.readFile(file);
    } catch {
      response.writeHead(404).end();
      return;
    }
    const count = (requestCounts.get(pathname) ?? 0) + 1;
    requestCounts.set(pathname, count);
    if (fault?.(pathname, count, request, response, body) === true) return;
    if (originDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, originDelayMs));
    if (lateSegmentDelayMs > 0 && /seg0*[2-9]\d*\.ts$/u.test(file)) {
      await new Promise((resolve) => setTimeout(resolve, lateSegmentDelayMs));
    }
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    // Ranges, because ffmpeg seeks a progressive MP4 whose index is at the end.
    const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
    if (range !== null) {
      const start = Number(range[1]);
      const end = range[2] === "" ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
      if (start >= body.length) {
        response.writeHead(416, { "content-range": `bytes */${body.length}` }).end();
        return;
      }
      response.writeHead(206, {
        "content-type": type,
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${body.length}`,
        "content-length": String(end - start + 1),
      });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, {
      "content-type": type,
      "accept-ranges": "bytes",
      "content-length": String(body.length),
    });
    response.end(body);
  });

  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-stream-received-"));
  privateTmp = await fs.mkdtemp(path.join(os.tmpdir(), "engine-stream-tmpdir-"));
  for (const key of ["TMPDIR", "TMP", "TEMP"]) {
    savedTmp[key] = process.env[key];
    process.env[key] = privateTmp;
  }
}, 120_000);

afterAll(async () => {
  for (const [key, value] of Object.entries(savedTmp)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await origin?.close();
  for (const dir of [fixtureRoot, outputDir, privateTmp]) {
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  fault = null;
  requestCounts.clear();
  originDelayMs = 0;
  lateSegmentDelayMs = 0;
});

function engineWith(overrides: EngineConfigInput = {}) {
  return createEngine({ maxFileSizeBytes: 256 * 1024 * 1024, ...overrides });
}

function hlsVariant(name: string, seconds: number): MediaVariant {
  return {
    id: name,
    protocol: "hls",
    url: `${origin.origin}/${name}/master.m3u8`,
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc1.42c01e",
    audioCodec: "mp4a.40.2",
    durationSec: seconds,
    label: name,
  };
}

interface Received {
  status: number;
  contentType: string | undefined;
  disposition: string | undefined;
  bytes: number;
  /** ms from the request to the response headers, and to the last byte. */
  headersAtMs: number;
  endAtMs: number;
  /** How many origin requests had been made when the headers arrived. */
  originRequestsAtHeaders: number;
  /** True when the connection was cut rather than ended. */
  aborted: boolean;
  file: string;
  json: unknown;
}

/**
 * One real HTTP exchange: a server that answers with `open()`'s stream, and a
 * client that writes what it receives to disk *on the test's side* — the
 * received copy is the test's evidence, not the engine's output.
 */
async function exchange(
  label: string,
  open: () => Promise<MediaStream>,
  onStream: (media: MediaStream) => void = () => undefined,
  clientAbortAfterBytes: number | null = null,
): Promise<Received> {
  const server = http.createServer((request, response) => {
    void (async () => {
      let media: MediaStream;
      try {
        media = await open();
      } catch (error: unknown) {
        const payload = AppError.from(error).toPayload();
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: payload }));
        return;
      }
      onStream(media);
      response.writeHead(200, {
        "content-type": media.contentType,
        "content-disposition": `attachment; filename="${media.filename}"`,
      });
      media.body.pipe(response);
      media.body.once("error", () => response.destroy());
      response.once("close", () => {
        if (!response.writableFinished) media.body.destroy();
      });
      media.done.catch(() => undefined);
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const file = path.join(outputDir, `${label}.bin`);
  const started = performance.now();

  try {
    return await new Promise<Received>((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
        const headersAtMs = performance.now() - started;
        const originRequestsAtHeaders = origin.requests.length;
        const chunks: Buffer[] = [];
        let bytes = 0;
        let aborted = false;
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          bytes += chunk.length;
          if (clientAbortAfterBytes !== null && bytes >= clientAbortAfterBytes) {
            aborted = true;
            request.destroy();
          }
        });
        response.once("aborted", () => {
          aborted = true;
        });
        let finished = false;
        const record = async (): Promise<void> => {
          const endAtMs = performance.now() - started;
          const body = Buffer.concat(chunks);
          await fs.writeFile(file, body);
          let json: unknown = null;
          if ((response.headers["content-type"] ?? "").includes("json")) {
            json = JSON.parse(body.toString("utf8"));
          }
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers["content-type"],
            disposition: response.headers["content-disposition"],
            bytes,
            headersAtMs,
            endAtMs,
            originRequestsAtHeaders,
            aborted: aborted || !response.complete,
            file,
            json,
          });
        };
        const finish = (): void => {
          if (finished) return;
          finished = true;
          record().catch(reject);
        };
        response.once("end", finish);
        response.once("close", () => {
          if (!response.complete) {
            aborted = true;
            finish();
          }
        });
      });
      request.once("error", (error: NodeJS.ErrnoException) => {
        if (clientAbortAfterBytes === null) reject(error);
      });
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

/** Live ffmpeg processes whose argv names this origin. Linux only. */
function ffmpegProcessesForOrigin(): number[] {
  const needle = origin.origin.replace("http://", "");
  const found: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (argv.includes(needle) && argv.includes("pipe:1")) found.push(Number(entry));
    } catch {
      // Exited between the listing and the read.
    }
  }
  return found;
}

async function snapshotDirs(): Promise<{ tmp: string[] }> {
  return { tmp: await listTree(privateTmp) };
}

describe("dl-53: streaming each rendition to a real HTTP client", () => {
  test("the temp directory the suite lists is the one Node and ffmpeg are using", () => {
    expect(os.tmpdir()).toBe(privateTmp);
  });

  const cases: {
    label: string;
    seconds: number;
    kinds: string[];
    variant: () => MediaVariant;
  }[] = [
    {
      label: "HLS, 6 s",
      seconds: 6,
      kinds: ["video", "audio"],
      variant: () => hlsVariant("hls6", 6),
    },
    {
      label: "HLS, 11 s",
      seconds: 11,
      kinds: ["video", "audio"],
      variant: () => hlsVariant("hls11", 11),
    },
    {
      label: "DASH MPD with a separate audio adaptation set, 8 s",
      seconds: 8,
      kinds: ["video", "audio"],
      variant: () => ({
        id: "dash8",
        protocol: "dash",
        url: `${origin.origin}/dash8/manifest.mpd`,
        hasVideo: true,
        hasAudio: true,
        durationSec: 8,
        label: "dash8",
      }),
    },
    {
      label: "DASH with the audio rendition as its own URL, 5 s",
      seconds: 5,
      kinds: ["video", "audio"],
      variant: () => ({
        id: "pair5",
        protocol: "dash",
        url: `${origin.origin}/pair5/video-only.mp4`,
        audioUrl: `${origin.origin}/pair5/audio-only.m4a`,
        hasVideo: true,
        hasAudio: true,
        durationSec: 5,
        label: "pair5",
      }),
    },
    {
      label: "progressive MP4 with its index at the end, 9 s",
      seconds: 9,
      kinds: ["video", "audio"],
      variant: () => ({
        id: "prog9",
        protocol: "progressive",
        url: `${origin.origin}/prog9/moov-end.mp4`,
        hasVideo: true,
        // Unverified, as a progressive file nobody inspected is (dl-42).
        durationSec: 9,
        label: "prog9",
      }),
    },
    {
      label: "progressive fast-start MP4, 4 s",
      seconds: 4,
      kinds: ["video", "audio"],
      variant: () => ({
        id: "prog4",
        protocol: "progressive",
        url: `${origin.origin}/prog4/faststart.mp4`,
        hasVideo: true,
        hasAudio: true,
        durationSec: 4,
        label: "prog4",
      }),
    },
  ];

  test.each(cases)(
    "$label: fragmented MP4, read back at its length, nothing written",
    async (entry) => {
      const engine = engineWith();
      const before = await snapshotDirs();

      let media: MediaStream | undefined;
      const received = await exchange(
        entry.label.replaceAll(/\W+/gu, "-"),
        () =>
          engine.stream({
            jobId: entry.label,
            variant: entry.variant(),
            requestContext: CONTEXT,
            title: `Fixture: ${entry.label}`,
          }),
        (opened) => {
          media = opened;
        },
      );

      expect(received.status).toBe(200);
      expect(received.contentType).toBe("video/mp4");
      expect(received.aborted).toBe(false);
      expect(await media?.done).toMatchObject({ bytes: received.bytes });

      const boxes = await topLevelBoxes(received.file);
      // Fragmented: an empty `moov` first, then media in `moof`/`mdat` pairs.
      expect(boxes.slice(0, 2)).toEqual(["ftyp", "moov"]);
      expect(boxes).toContain("moof");

      const probed = await probeMedia(received.file);
      expect(probed.formatName).toContain("mp4");
      expect(probed.streams.map((stream) => stream.kind).toSorted()).toEqual(
        entry.kinds.toSorted(),
      );
      expect(Math.abs((probed.durationSec ?? 0) - entry.seconds)).toBeLessThan(TOLERANCE_SEC);

      expect(await snapshotDirs()).toEqual(before);
    },
  );

  test("with subtitles embedded, the track arrives and still nothing is written", async () => {
    const engine = engineWith();
    const before = await snapshotDirs();
    const track: SubtitleTrack = {
      id: "en",
      url: `${origin.origin}/subs/en.vtt`,
      language: "en",
      label: "English",
      format: "vtt",
      autoGenerated: false,
    };
    const options: JobOptions = { embedSubtitles: true, subtitleLanguages: ["en"] };

    const received = await exchange("subtitles", () =>
      engine.stream({
        jobId: "subtitles",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
        subtitles: [track],
        options,
      }),
    );

    expect(received.status).toBe(200);
    const probed = await probeMedia(received.file);
    expect(probed.streams).toContainEqual({ kind: "subtitle", codec: "mov_text" });
    // Fetched by ffmpeg with the replayed headers, not by anything that saves it.
    const subtitleRequest = origin.requests.find((request) => request.url === "/subs/en.vtt");
    expect(subtitleRequest?.headers.referer).toBe(CONTEXT.headers["Referer"]);
    expect(await snapshotDirs()).toEqual(before);
  });

  test("a subtitle track that will not open costs the track, not the download", async () => {
    const engine = engineWith();
    const received = await exchange("missing-subtitle", () =>
      engine.stream({
        jobId: "missing-subtitle",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
        subtitles: [
          {
            id: "fr",
            url: `${origin.origin}/subs/nope.vtt`,
            language: "fr",
            label: "French",
            format: "vtt",
            autoGenerated: false,
          },
        ],
        options: { embedSubtitles: true, subtitleLanguages: ["fr"] },
      }),
    );
    expect(received.status).toBe(200);
    const probed = await probeMedia(received.file);
    expect(probed.streams.map((stream) => stream.kind).toSorted()).toEqual(["audio", "video"]);
  });

  test("response headers arrive while the origin is still being read", async () => {
    // 11 s in 2 s segments is six segments; at 250 ms a request the whole
    // stream cannot take less than two seconds, and the headers must not wait
    // for it.
    originDelayMs = 250;
    const engine = engineWith();
    const requestsBefore = origin.requests.length;
    const received = await exchange("headers-first", () =>
      engine.stream({
        jobId: "headers-first",
        variant: hlsVariant("hls11", 11),
        requestContext: CONTEXT,
      }),
    );

    expect(received.status).toBe(200);
    const segmentRequests = origin.requests
      .slice(requestsBefore)
      .filter((request) => request.url.startsWith("/hls11/seg"));
    expect(segmentRequests.length).toBe(6);
    const originRequestsAtHeaders = received.originRequestsAtHeaders - requestsBefore;
    // master + index + at most the segments ffmpeg needed to write its header.
    expect(originRequestsAtHeaders).toBeLessThan(2 + segmentRequests.length);
    expect(received.endAtMs - received.headersAtMs).toBeGreaterThan(500);
  });

  test("an error before the first byte is thrown, with its code, and nothing is written", async () => {
    const engine = engineWith();
    const before = await snapshotDirs();
    await expect(
      engine.stream({
        jobId: "no-headers",
        variant: hlsVariant("hls6", 6),
        requestContext: { headers: {} },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    expect(await snapshotDirs()).toEqual(before);
  });

  test("an error after the first byte cuts the connection and rejects `done` with its code", async () => {
    lateSegmentDelayMs = 10_000;
    const engine = engineWith({ stageTimeoutMs: 4_000 });
    let media: MediaStream | undefined;
    const received = await exchange(
      "late-failure",
      () =>
        engine.stream({
          jobId: "late-failure",
          variant: hlsVariant("hls11", 11),
          requestContext: CONTEXT,
        }),
      (opened) => {
        media = opened;
      },
    );

    expect(received.status).toBe(200);
    expect(received.bytes).toBeGreaterThan(0);
    expect(received.aborted).toBe(true);
    await expect(media?.done).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("a stream that passes the size cap is cut and says SIZE_LIMIT_EXCEEDED", async () => {
    const limit = 96 * 1024;
    // No duration, so no estimate: the pre-flight check passes and the runtime
    // cap is the only thing that can stop it.
    const engine = engineWith({ maxFileSizeBytes: limit });
    let media: MediaStream | undefined;
    const received = await exchange(
      "size-cap",
      () =>
        engine.stream({
          jobId: "size-cap",
          variant: { ...hlsVariant("hls11", 11), durationSec: undefined },
          requestContext: CONTEXT,
        }),
      (opened) => {
        media = opened;
      },
    );

    if (received.status === 200) {
      expect(received.aborted).toBe(true);
      expect(received.bytes).toBeLessThanOrEqual(limit);
      await expect(media?.done).rejects.toMatchObject({ code: "SIZE_LIMIT_EXCEEDED" });
    } else {
      // ffmpeg's own progress block can notice first, before a byte was read.
      expect(received.json).toMatchObject({ error: { code: "SIZE_LIMIT_EXCEEDED" } });
    }
  });

  test.skipIf(process.platform !== "linux")(
    "a client that disconnects mid-stream leaves no ffmpeg behind",
    async () => {
      originDelayMs = 250;
      const engine = engineWith();
      let media: MediaStream | undefined;
      const received = await exchange(
        "disconnect",
        () =>
          engine.stream({
            jobId: "disconnect",
            variant: hlsVariant("hls11", 11),
            requestContext: CONTEXT,
          }),
        (opened) => {
          media = opened;
        },
        1,
      );
      expect(received.aborted).toBe(true);
      await expect(media?.done).rejects.toMatchObject({ code: "JOB_CANCELED" });
      // The kill is asynchronous; give the tree a moment to be reaped.
      for (let waited = 0; waited < 3000 && ffmpegProcessesForOrigin().length > 0; waited += 100) {
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(ffmpegProcessesForOrigin()).toEqual([]);
    },
  );

  test("cancelling after the first byte kills ffmpeg and rejects `done` with JOB_CANCELED", async () => {
    originDelayMs = 250;
    const engine = engineWith();
    const controller = new AbortController();
    const media = await engine.stream({
      jobId: "cancel",
      variant: hlsVariant("hls11", 11),
      requestContext: CONTEXT,
      signal: controller.signal,
    });
    media.body.resume();
    controller.abort();
    await expect(media.done).rejects.toMatchObject({ code: "JOB_CANCELED" });
  });

  test("a source that fails after the first byte fails the stream, not a truncated success", async () => {
    // Gate 2's high finding, reproduced: ffmpeg's HLS demuxer retries a failed
    // segment, logs "failed too many times, skipping" and, left to itself,
    // exits 0 with the segments it got — a clean response carrying two
    // seconds of a six-second video. The stream must end as a failure the
    // job records, never as a short success.
    const engine = engineWith();
    let media: MediaStream | undefined;
    const received = await exchange(
      "midfail",
      () =>
        engine.stream({
          jobId: "midfail",
          variant: hlsVariant("midfail", 6),
          requestContext: CONTEXT,
        }),
      (opened) => {
        media = opened;
      },
    );

    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    await expect(media?.done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  /**
   * Gate 4's two reproductions, and the controls that keep them honest: each
   * source below fails after the first byte, and each control recovers from a
   * failure of the same shape and must not be failed for it.
   */
  async function streamed(
    label: string,
    variant: MediaVariant,
  ): Promise<{
    received: Received;
    done: Promise<unknown> | undefined;
  }> {
    const engine = engineWith();
    let media: MediaStream | undefined;
    const received = await exchange(
      label,
      () => engine.stream({ jobId: label, variant, requestContext: CONTEXT }),
      (opened) => {
        media = opened;
      },
    );
    return { received, done: media?.done };
  }

  const dash8 = (): MediaVariant => ({
    id: "dash8",
    protocol: "dash",
    url: `${origin.origin}/dash8/manifest.mpd`,
    hasVideo: true,
    hasAudio: true,
    durationSec: 8,
    label: "dash8",
  });
  const prog9 = (): MediaVariant => ({
    id: "prog9",
    protocol: "progressive",
    url: `${origin.origin}/prog9/moov-end.mp4`,
    hasVideo: true,
    durationSec: 9,
    label: "prog9",
  });

  test("a DASH fragment that cannot be fetched after the first byte fails the stream", async () => {
    // The DASH demuxer never retries a fragment: one failure is a hole in the
    // middle, and the container still declares the full length around it.
    fault = (pathname, _count, request) => {
      if (!pathname.endsWith("/dash8/chunk-stream0-00003.m4s")) return false;
      request.socket.destroy();
      return true;
    };
    const { received, done } = await streamed("dash-gap", dash8());
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  test("a progressive body cut after the first byte and never served again fails the stream", async () => {
    // The fourth request is the sequential body read: dl-102’s seek probe, then
    // ffmpeg finding the index at the end; it stops at 40%, and every reconnect
    // finds the URL gone (a 404 — a signed link expiring mid-download — rather
    // than a reset, only because ffmpeg gives up on it in 11 s rather than 55).
    fault = (pathname, count, request, response, body) => {
      if (!pathname.endsWith("/prog9/moov-end.mp4") || count < 4) return false;
      if (count === 4) cutShort(request, response, body, 0.4);
      else response.writeHead(404).end();
      return true;
    };
    const { received, done } = await streamed("prog-cut", prog9());
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  }, 60_000);

  test("control: a progressive body cut once and resumed on reconnect completes whole", async () => {
    // ffmpeg logs "Stream ends prematurely" here too, and then reconnects and
    // gets the rest — which is why that line cannot be the signal.
    let cut = false;
    fault = (pathname, count, request, response, body) => {
      if (!pathname.endsWith("/prog9/moov-end.mp4") || count !== 4) return false;
      // The sequential read: open-ended from just past the header, so neither
      // the probe's bytes=1-1 nor ffmpeg's read of the tail.
      const start = Number(/^bytes=(\d+)-$/u.exec(request.headers.range ?? "")?.[1] ?? -1);
      cut = start > 1 && start < body.length / 2;
      cutShort(request, response, body, 0.4);
      return true;
    };
    const { received, done } = await streamed("prog-heal", prog9());
    // A count that drifts off the body read leaves nothing to heal from.
    expect(cut).toBe(true);
    expect(received.aborted).toBe(false);
    await expect(done).resolves.toMatchObject({ bytes: received.bytes });
    const probed = await probeMedia(received.file);
    expect(Math.abs((probed.durationSec ?? 0) - 9)).toBeLessThan(TOLERANCE_SEC);
  }, 60_000);

  test("control: an HLS segment refused once and served on the retry completes whole", async () => {
    fault = (pathname, count, request) => {
      if (!pathname.endsWith("/hls6/seg002.ts") || count !== 1) return false;
      request.socket.destroy();
      return true;
    };
    const { received, done } = await streamed("hls-heal", hlsVariant("hls6", 6));
    expect(received.aborted).toBe(false);
    await expect(done).resolves.toMatchObject({ bytes: received.bytes });
    const probed = await probeMedia(received.file);
    expect(Math.abs((probed.durationSec ?? 0) - 6)).toBeLessThan(TOLERANCE_SEC);
  });

  /**
   * Gate 4's low: a segment refused on its certificate is skipped the same way
   * as a lost one, and must say which. A real refusal needs the API's egress
   * proxy, which this package cannot import, so ffmpeg is stood in for by a
   * script that writes the lines the proxy's refusal produces
   * (`api/test/two-origin-tls.test.ts` is the real one, end to end).
   */
  async function standIn(lines: readonly string[]): Promise<string> {
    const dir = await fs.mkdtemp(path.join(outputDir, "stand-in-"));
    const script = path.join(dir, "ffmpeg");
    await fs.writeFile(
      script,
      [
        `#!${process.execPath}`,
        "process.stdout.write(Buffer.alloc(4096, 1));",
        "setTimeout(() => {",
        `  for (const line of ${JSON.stringify(lines)}) process.stderr.write(line + "\\n");`,
        "  setTimeout(() => process.exit(0), 5000);",
        "}, 100);",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return script;
  }

  test.skipIf(process.platform === "win32")(
    "a segment skipped after a certificate refusal is TLS_VERIFICATION_FAILED, not DOWNLOAD_FAILED",
    async () => {
      const refusal =
        "[httpproxy @ 0x1] HTTP error 502 TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)";
      const skipped = "[hls @ 0x2] Segment 2 of playlist 0 failed too many times, skipping";

      for (const [lines, code] of [
        [[refusal, skipped], "TLS_VERIFICATION_FAILED"],
        [[skipped], "DOWNLOAD_FAILED"],
      ] as const) {
        const engine = engineWith({ ffmpegPath: await standIn(lines) });
        // oxlint-disable-next-line no-await-in-loop
        const media = await engine.stream({
          jobId: `stand-in-${code}`,
          variant: hlsVariant("hls6", 6),
          requestContext: CONTEXT,
        });
        media.body.resume();
        // oxlint-disable-next-line no-await-in-loop
        await expect(media.done).rejects.toMatchObject({ code });
      }
    },
  );

  /**
   * Gate 6's cut-body shape, on the owner's answer of 2026-09-27: a segment,
   * fragment or file whose body stops short of its `Content-Length`, rather
   * than being refused. ffmpeg writes "Stream ends prematurely" for it, and for
   * a progressive transfer it then reconnects and heals — so the line fails the
   * stream only when no "Will reconnect" from the **same connection** follows.
   */
  test("an HLS segment whose body is cut short fails the stream", async () => {
    fault = (pathname, count, request, response, body) => {
      if (!pathname.endsWith("/hls6/seg002.ts") || count !== 1) return false;
      cutShort(request, response, body, 0.4);
      return true;
    };
    const { received, done } = await streamed("hls-cut-body", hlsVariant("hls6", 6));
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  test("a DASH fragment whose body is cut short fails the stream", async () => {
    fault = (pathname, _count, request, response, body) => {
      if (!pathname.endsWith("/dash8/chunk-stream0-00003.m4s")) return false;
      cutShort(request, response, body, 0.4);
      return true;
    };
    const { received, done } = await streamed("dash-cut-body", dash8());
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  test("control: a segment delivered whole but with corrupt bytes completes", async () => {
    // Gate 6's false failure for "corrupt input packet": nothing was lost in
    // transfer, so nothing here may fail it. 4 KB of the segment, inverted.
    fault = (pathname, _count, _request, response, body) => {
      if (!pathname.endsWith("/hls6/seg002.ts")) return false;
      const damaged = Buffer.from(body);
      const from = Math.floor(damaged.length / 2);
      for (let index = from; index < Math.min(damaged.length, from + 4096); index += 1) {
        damaged[index] = (damaged[index] ?? 0) ^ 0xff;
      }
      response.writeHead(200, { "content-length": String(damaged.length) });
      response.end(damaged);
      return true;
    };
    const { received, done } = await streamed("hls-corrupt", hlsVariant("hls6", 6));
    expect(received.aborted).toBe(false);
    await expect(done).resolves.toMatchObject({ bytes: received.bytes });
  });

  test("control: a separate audio rendition cut once and resumed on reconnect completes whole", async () => {
    // Two inputs, two connections logging on two threads: the reconnect is
    // attributed to the audio connection that ended early, by its own prefix.
    fault = (pathname, count, request, response, body) => {
      if (!pathname.endsWith("/pair5/audio-only.m4a") || count !== 2) return false;
      cutShort(request, response, body, 0.4);
      return true;
    };
    const { received, done } = await streamed("pair-heal", {
      id: "pair5",
      protocol: "dash",
      url: `${origin.origin}/pair5/video-only.mp4`,
      audioUrl: `${origin.origin}/pair5/audio-only.m4a`,
      hasVideo: true,
      hasAudio: true,
      durationSec: 5,
      label: "pair5",
    });
    expect(received.aborted).toBe(false);
    await expect(done).resolves.toMatchObject({ bytes: received.bytes });
    const probed = await probeMedia(received.file);
    expect(probed.streams.map((stream) => stream.kind).toSorted()).toEqual(["audio", "video"]);
    expect(Math.abs((probed.durationSec ?? 0) - 5)).toBeLessThan(TOLERANCE_SEC);
  }, 60_000);

  test.skipIf(process.platform === "win32")(
    "an early end is matched to a reconnect by its own connection, however the lines interleave",
    async () => {
      // Two connections, as a video and a separate audio input give. Each line
      // carries its connection's address; a reconnect on one never answers for
      // the other.
      // oxlint-disable-next-line consistent-function-scoping -- read beside its lines
      const ended = (address: string): string =>
        `[http @ ${address}] Stream ends prematurely at 30028, should be 75004`;
      // oxlint-disable-next-line consistent-function-scoping -- read beside its lines
      const reconnect = (address: string): string =>
        `[http @ ${address}] Will reconnect at 30028 in 0 second(s), error=Input/output error.`;

      const healed = [ended("0xa1"), ended("0xb2"), reconnect("0xb2"), reconnect("0xa1")];
      const engineHealed = engineWith({ ffmpegPath: await standIn(healed) });
      const whole = await engineHealed.stream({
        jobId: "interleaved-healed",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
      });
      whole.body.resume();
      await expect(whole.done).resolves.toBeDefined();

      const oneLeft = [ended("0xa1"), ended("0xb2"), reconnect("0xb2")];
      const engineCut = engineWith({ ffmpegPath: await standIn(oneLeft) });
      const cut = await engineCut.stream({
        jobId: "interleaved-cut",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
      });
      cut.body.resume();
      await expect(cut.done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    },
    30_000,
  );

  // The Windows build prints a context pointer without `0x`, zero-padded to
  // sixteen digits, and ends every line CRLF. That is the shape CI's Windows leg
  // logged in run 35404674345: `[http @ 0000019e45be7ec0] HTTP error 404 Not
  // Found\r\n`. Read on every platform, since it needs no ffmpeg at all.
  test("the connection is read off a Windows-shaped line as well as a Linux one", async () => {
    const { connectionOf } = await import("../src/stream.ts");
    const linux = "[http @ 0x557cbe02b840]";
    const windows = "[http @ 0000019e45be7ec0]";
    for (const prefix of [linux, windows]) {
      const early = connectionOf(`${prefix} Stream ends prematurely at 1, should be 2`);
      expect(early).not.toBeNull();
      expect(connectionOf(`${prefix} Will reconnect at 1 in 0 second(s), error=End of file.`)).toBe(
        early,
      );
    }
    expect(connectionOf(`${windows} x`)).not.toBe(connectionOf("[http @ 0000019e45bad940] x"));
  });

  test.skipIf(process.platform === "win32")(
    "a healed early end on a Windows-shaped connection completes, and an unanswered one still fails",
    async () => {
      // oxlint-disable-next-line consistent-function-scoping -- read beside its lines
      const ended = (address: string): string =>
        `[http @ ${address}] Stream ends prematurely at 30028, should be 75004\r`;
      // oxlint-disable-next-line consistent-function-scoping -- read beside its lines
      const reconnect = (address: string): string =>
        `[http @ ${address}] Will reconnect at 30028 in 0 second(s), error=Input/output error.\r`;
      const video = "0000019e45be7ec0";
      const audio = "0000019e45bad940";

      const healed = [ended(video), ended(audio), reconnect(audio), reconnect(video)];
      const engineHealed = engineWith({ ffmpegPath: await standIn(healed) });
      const whole = await engineHealed.stream({
        jobId: "windows-healed",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
      });
      whole.body.resume();
      await expect(whole.done).resolves.toBeDefined();

      const oneLeft = [ended(video), ended(audio), reconnect(audio)];
      const engineCut = engineWith({ ffmpegPath: await standIn(oneLeft) });
      const cut = await engineCut.stream({
        jobId: "windows-cut",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
      });
      cut.body.resume();
      await expect(cut.done).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    },
    30_000,
  );
});

/** Every `ffmpeg` line the engine logged — the stderr that survived the runner (dl-96). */
function capturingLogger(lines: string[]): Logger {
  return {
    ...NOOP_LOGGER,
    debug: (message, fields) => {
      if (message === "ffmpeg") lines.push(String(fields?.["line"]));
    },
  };
}

/**
 * dl-96. A progressive file the browser tier found carries a size and no
 * duration, and behind a slow origin its progress read `unknown total` and
 * `0 B/s` for minutes: the percent waits on a duration nobody supplied, and
 * the rate is measured on bytes that leave ffmpeg one whole fragment at a time.
 */
describe("dl-96: progress on a source the probe could not time", () => {
  beforeAll(async () => {
    await generateLongGop(path.join(fixtureRoot, "longgop9"), 9, 6);
  }, 60_000);

  test("ffmpeg's own Duration line turns the percent on, and the size becomes the total", async () => {
    const source = path.join(fixtureRoot, "prog9", "moov-end.mp4");
    const sourceBytes = (await fs.stat(source)).size;
    const logged: string[] = [];
    const seen: { percent: number | null; totalBytes: number | null }[] = [];
    const engine = engineWith({ logger: capturingLogger(logged) });

    const media = await engine.stream({
      jobId: "dl-96-untimed",
      // What the browser tier hands over: a measured size, no duration.
      variant: {
        id: "untimed",
        protocol: "progressive",
        url: `${origin.origin}/prog9/moov-end.mp4`,
        hasVideo: true,
        filesizeBytes: sourceBytes,
        filesizeIsEstimate: false,
        label: "untimed",
      },
      requestContext: CONTEXT,
      onProgress: (progress) =>
        seen.push({ percent: progress.percent, totalBytes: progress.totalBytes }),
    });
    media.body.resume();
    const outcome = await media.done;

    const percents = seen.map((entry) => entry.percent).filter((value) => value !== null);
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeGreaterThan(95);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    expect(seen.every((entry) => entry.totalBytes === sourceBytes)).toBe(true);
    // The expectation the total stands for: a copy differs by its boxes alone.
    expect(Math.abs(outcome.bytes - sourceBytes) / sourceBytes).toBeLessThan(0.01);
    expect(Math.abs((outcome.durationSec ?? 0) - 9)).toBeLessThan(TOLERANCE_SEC);

    // Real ffmpeg at `level+info`, and none of its info reached the log or the
    // matchers: no input description, no level tags.
    expect(
      logged.filter((line) => /Duration:|Stream #|Input #|\[(?:info|warning)\]/u.test(line)),
    ).toEqual([]);
  });

  test("a long-GOP source still reaches the reader at least once a second", async () => {
    const received = await exchange("dl-96-long-gop", () =>
      engineWith().stream({
        jobId: "dl-96-long-gop",
        variant: {
          id: "longgop9",
          protocol: "progressive",
          url: `${origin.origin}/longgop9/moov-end.mp4`,
          hasVideo: true,
          hasAudio: true,
          label: "longgop9",
        },
        requestContext: CONTEXT,
      }),
    );

    expect(received.status).toBe(200);
    // Keyframes at 0 s and 6 s: two fragments uncapped, one a second capped.
    const fragments = (await topLevelBoxes(received.file)).filter((box) => box === "moof");
    expect(fragments.length).toBeGreaterThanOrEqual(9);
    const probed = await probeMedia(received.file);
    expect(Math.abs((probed.durationSec ?? 0) - 9)).toBeLessThan(TOLERANCE_SEC);
  });

  test("the source's size is a total only for a progressive file copied unchanged", () => {
    const measured: MediaVariant = {
      id: "m",
      protocol: "progressive",
      url: "https://cdn.example/a.mp4",
      hasVideo: true,
      filesizeBytes: 100_307_911,
      filesizeIsEstimate: false,
      label: "m",
    };
    const plain = { audioOnly: false, transcoded: false, live: false };

    expect(expectedOutputBytes(measured, plain)).toBe(100_307_911);
    expect(expectedOutputBytes({ ...measured, filesizeIsEstimate: undefined }, plain)).toBe(
      100_307_911,
    );
    expect(expectedOutputBytes({ ...measured, filesizeIsEstimate: true }, plain)).toBeNull();
    expect(expectedOutputBytes({ ...measured, filesizeBytes: undefined }, plain)).toBeNull();
    expect(expectedOutputBytes({ ...measured, protocol: "hls" }, plain)).toBeNull();
    expect(
      expectedOutputBytes({ ...measured, audioUrl: "https://cdn.example/a.m4a" }, plain),
    ).toBeNull();
    expect(expectedOutputBytes(measured, { ...plain, audioOnly: true })).toBeNull();
    expect(expectedOutputBytes(measured, { ...plain, transcoded: true })).toBeNull();
    expect(expectedOutputBytes(measured, { ...plain, live: true })).toBeNull();
  });
});

/**
 * dl-96's gate, F3. `expectedOutputBytes` is right on its own, but nothing
 * pinned what `attempt` hands it: with `audioOnly`, `transcoded` or `live`
 * hard-coded to false, every test still passed. Each of these makes the
 * source's size a different file's, so each must report no total.
 */
describe("dl-96: no expected total where the output is not the source copied", () => {
  async function totalsFor(options: JobOptions, isLive = false): Promise<(number | null)[]> {
    const source = path.join(fixtureRoot, "prog4", "faststart.mp4");
    const totals: (number | null)[] = [];
    const media = await engineWith().stream({
      jobId: "dl-96-no-total",
      variant: {
        id: "prog4-measured",
        protocol: "progressive",
        url: `${origin.origin}/prog4/faststart.mp4`,
        hasVideo: true,
        hasAudio: true,
        filesizeBytes: (await fs.stat(source)).size,
        filesizeIsEstimate: false,
        // Declared, because the transcode is decided from these: an undeclared
        // codec is copied, and H.264 copied into WebM is refused outright.
        videoCodec: "avc1.42c01e",
        audioCodec: "mp4a.40.2",
        label: "prog4-measured",
      },
      requestContext: CONTEXT,
      isLive,
      options,
      onProgress: (progress) => totals.push(progress.totalBytes),
    });
    media.body.resume();
    await media.done;
    return totals;
  }

  test("audio only", async () => {
    const totals = await totalsFor({ audioOnly: true });
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every((total) => total === null)).toBe(true);
  });

  test("a transcode: H.264 into WebM", async () => {
    const totals = await totalsFor({ container: "webm" });
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every((total) => total === null)).toBe(true);
  }, 60_000);

  test("a live capture", async () => {
    const totals = await totalsFor({ liveDurationSec: 2 }, true);
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every((total) => total === null)).toBe(true);
  });
});

/**
 * dl-99: a progressive file whose codecs nobody declared used to be copied
 * into WebM, which holds none of what such a file nearly always carries
 * (H.264, AAC), and ffmpeg refused it before writing a byte — a job that
 * failed as "the download failed partway through". Copying an undeclared codec
 * is still right for MP4 and MKV.
 */
describe("dl-99: an undeclared codec is not copied into WebM", () => {
  beforeAll(async () => {
    await generateWebm(path.join(fixtureRoot, "webm4"), 4);
  }, 60_000);

  function undeclared(overrides: Partial<MediaVariant> = {}): MediaVariant {
    return {
      id: "dl-99",
      protocol: "progressive",
      url: `${origin.origin}/prog4/faststart.mp4`,
      hasVideo: true,
      hasAudio: true,
      label: "dl-99",
      ...overrides,
    };
  }

  async function refusal(variant: MediaVariant, options: JobOptions): Promise<AppError> {
    const before = origin.requests.length;
    const outcome = await engineWith()
      .stream({ jobId: "dl-99-refused", variant, requestContext: CONTEXT, options })
      .then(
        () => null,
        (error: unknown) => AppError.from(error),
      );
    expect(outcome).not.toBeNull();
    // Refused before ffmpeg started: nothing was asked of the origin.
    expect(origin.requests.length).toBe(before);
    return outcome as AppError;
  }

  test("the reproduction: an undeclared MP4 chosen as WebM is refused with its reason", async () => {
    const error = await refusal(undeclared({ container: "mp4" }), { container: "webm" });
    expect(error.code).toBe("CONTAINER_UNSUPPORTED");
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/WebM/u);
    expect(error.details).toMatchObject({ container: "webm", variantId: "dl-99" });
  });

  test("so is a source whose container nobody named, and any other", async () => {
    for (const container of [undefined, "mkv", "flv"]) {
      // oxlint-disable-next-line no-await-in-loop
      const error = await refusal(undeclared({ container }), { container: "webm" });
      expect(error.code).toBe("CONTAINER_UNSUPPORTED");
    }
  });

  test("one undeclared track is enough", async () => {
    const error = await refusal(undeclared({ container: "mp4", videoCodec: "avc1.42c01e" }), {
      container: "webm",
    });
    expect(error.code).toBe("CONTAINER_UNSUPPORTED");
  });

  test("MP4 and MKV still copy an undeclared codec", async () => {
    for (const container of ["mp4", "mkv"] as const) {
      const variant = undeclared({ container: "mp4" });
      const { args, transcodes } = buildStreamArgs({
        url: variant.url,
        variant,
        requestContext: CONTEXT,
        container,
        audioOnly: false,
        subtitles: [],
      });
      expect(transcodes).toEqual([]);
      expect(args).not.toContain("-c:v");
      expect(args).not.toContain("-c:a");
    }
  });

  test("an undeclared WebM source is copied into WebM, by its arguments and by its result", async () => {
    const variant = undeclared({
      id: "dl-99-webm",
      url: `${origin.origin}/webm4/source.webm`,
      container: "webm",
    });
    const built = buildStreamArgs({
      url: variant.url,
      variant,
      requestContext: CONTEXT,
      container: "webm",
      audioOnly: false,
      subtitles: [],
    });
    expect(built.transcodes).toEqual([]);
    expect(built.args.join(" ")).toContain("-c copy");
    expect(built.args).not.toContain("-c:v");
    expect(built.args).not.toContain("-c:a");

    const received = await exchange("dl-99-webm-copy", () =>
      engineWith().stream({
        jobId: "dl-99-webm-copy",
        variant,
        requestContext: CONTEXT,
        options: { container: "webm" },
      }),
    );
    expect(received.status).toBe(200);
    const probed = await probeMedia(received.file);
    expect(probed.formatName).toContain("webm");
    expect(probed.streams.map((stream) => stream.codec).toSorted()).toEqual(["opus", "vp9"]);
  }, 60_000);

  test("a source whose codecs are declared (as a header read declares them) transcodes to VP9 and Opus", async () => {
    const received = await exchange("dl-99-declared", () =>
      engineWith().stream({
        jobId: "dl-99-declared",
        variant: undeclared({ container: "mp4", videoCodec: "avc1", audioCodec: "mp4a" }),
        requestContext: CONTEXT,
        options: { container: "webm" },
      }),
    );
    expect(received.status).toBe(200);
    const probed = await probeMedia(received.file);
    expect(probed.formatName).toContain("webm");
    expect(probed.streams.map((stream) => stream.codec).toSorted()).toEqual(["opus", "vp9"]);
  }, 60_000);
});

/**
 * dl-99, the owner's addition of 2026-10-07: a manifest variant is judged by
 * the same rule as a file. Undeclared, it is refused before an origin request;
 * declared, it is as before.
 */
describe("dl-99: a manifest variant with undeclared codecs is not copied into WebM", () => {
  // Functions, because the origin's address exists only once the suite has started it.
  const manifests: [string, () => MediaVariant][] = [
    ["HLS", () => ({ ...hlsVariant("hls6", 6), videoCodec: undefined, audioCodec: undefined })],
    [
      "DASH",
      () => ({
        id: "dash8",
        protocol: "dash",
        url: `${origin.origin}/dash8/manifest.mpd`,
        hasVideo: true,
        hasAudio: true,
        label: "dash8",
      }),
    ],
  ];

  for (const [name, build] of manifests) {
    test(`${name} is refused with CONTAINER_UNSUPPORTED before any origin request`, async () => {
      const variant = build();
      const before = origin.requests.length;
      const error = await engineWith()
        .stream({
          jobId: `dl-99-${name}`,
          variant,
          requestContext: CONTEXT,
          options: { container: "webm" },
        })
        .then(
          () => null,
          (cause: unknown) => AppError.from(cause),
        );
      expect(error?.code).toBe("CONTAINER_UNSUPPORTED");
      expect(error?.retryable).toBe(false);
      expect(origin.requests.length).toBe(before);
    });
  }

  test("an HLS variant whose codecs are declared as H.264/AAC still transcodes to VP9 and Opus", async () => {
    const received = await exchange("dl-99-hls-declared", () =>
      engineWith().stream({
        jobId: "dl-99-hls-declared",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
        options: { container: "webm" },
      }),
    );
    expect(received.status).toBe(200);
    const probed = await probeMedia(received.file);
    expect(probed.streams.map((stream) => stream.codec).toSorted()).toEqual(["opus", "vp9"]);
  }, 60_000);

  test("keep source on a WebM file with undeclared separate audio is refused as WebM is", async () => {
    const error = await engineWith()
      .stream({
        jobId: "dl-99-source",
        variant: {
          id: "dl-99-source",
          protocol: "progressive",
          url: `${origin.origin}/webm4/source.webm`,
          audioUrl: `${origin.origin}/prog4/audio-only.m4a`,
          container: "webm",
          hasVideo: true,
          hasAudio: true,
          label: "dl-99-source",
        },
        requestContext: CONTEXT,
        options: { container: "source" },
      })
      .then(
        () => null,
        (cause: unknown) => AppError.from(cause),
      );
    expect(error?.code).toBe("CONTAINER_UNSUPPORTED");
  });

  test("a manifest variant declared as VP9 and Opus is not refused and is copied", () => {
    const variant = {
      ...hlsVariant("hls6", 6),
      videoCodec: "vp09.00.10.08",
      audioCodec: "opus",
    };
    expect(() =>
      assertContainerCanHold("webm", variant, { audioOnly: false, jobId: "dl-99-vp9" }),
    ).not.toThrow();
    const built = buildStreamArgs({
      url: variant.url,
      variant,
      requestContext: CONTEXT,
      container: "webm",
      audioOnly: false,
      subtitles: [],
    });
    expect(built.transcodes).toEqual([]);
    expect(built.args).not.toContain("-c:v");
    expect(built.args).not.toContain("-c:a");
  });
});

type Outcome =
  | { refused: string; retryable: boolean; message: string }
  | { streamed: number; done: number | string; decodedFrames: number };

function large(url: string, overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "large",
    protocol: "progressive",
    url,
    hasVideo: true,
    hasAudio: true,
    durationSec: 4,
    label: "large",
    ...overrides,
  };
}

/** All 100 frames of the 4 s, 25 fps fixture, and `done` resolved with what was streamed. */
function expectWhole(outcome: Outcome): void {
  expect(outcome).toMatchObject({ decodedFrames: 100 });
  if ("streamed" in outcome) expect(outcome.done).toBe(outcome.streamed);
}

/**
 * A proxy that records the absolute URL it is asked for and answers as a
 * Range-ignoring origin would, itself, from `fixtureRoot`: it never sends a
 * request on. `refuse` answers `403` to everything, which is what the guarded
 * egress proxy does to a target it will not reach.
 */
async function startRecordingProxy(refuse: boolean): Promise<FixtureServer> {
  return startFixtureServer(async (request, response) => {
    if (refuse) {
      response.writeHead(403).end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://invalid.example").pathname;
    const file = path.join(fixtureRoot, ...pathname.split("/").filter((part) => part !== ".."));
    const body = await fs.readFile(file).catch(() => null);
    if (body === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": String(body.length) }).end(body);
  });
}

/**
 * dl-102. A progressive source goes to ffmpeg as a URL so that ffmpeg can seek
 * to an index at the end of the file — which it does with `Range`. An origin
 * that answers every request with `200` and the whole body takes that away,
 * and a tail-`moov` MP4 from it used to finish as a clean response of which
 * not one frame decodes. The fixture is about 1 MB because a small one cannot
 * fail: below roughly 64 to 91 KB ffmpeg has the whole file before it needs
 * to seek.
 *
 * Imported here rather than at the top so this block moves no line above it.
 */
describe("dl-102: an origin that ignores Range", () => {
  let generateLargeProgressive: (dir: string) => Promise<void>;
  let decodedVideoFrames: (file: string) => Promise<{ frames: number }>;
  /** The whole file with a `200`, whatever was asked. Gated like `origin`. */
  let ignoring: FixtureServer;

  beforeAll(async () => {
    ({ generateLargeProgressive, decodedVideoFrames } = await import("./helpers/media.ts"));
    await generateLargeProgressive(path.join(fixtureRoot, "large"));
    ignoring = await startFixtureServer(async (request, response) => {
      if (
        request.headers.referer !== CONTEXT.headers["Referer"] ||
        request.headers.cookie !== CONTEXT.headers["Cookie"]
      ) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let pathname = new URL(request.url ?? "/", "http://x").pathname;
      // `/moved/<path>` answers with a redirect to `<path>` on the same origin.
      if (pathname.startsWith("/moved/")) {
        response.writeHead(302, { location: pathname.slice("/moved".length) }).end();
        return;
      }
      // `/slow/<path>` is `<path>`, two seconds late.
      if (pathname.startsWith("/slow/")) {
        pathname = pathname.slice("/slow".length);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      const file = path.join(fixtureRoot, ...pathname.split("/").filter((part) => part !== ".."));
      let body: Buffer;
      try {
        body = await fs.readFile(file);
      } catch {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "content-length": String(body.length),
      });
      response.end(body);
    });
  }, 120_000);

  afterAll(async () => {
    await ignoring?.close();
  });

  /** What a visitor would be left with: the code that stopped it, or the file and its frames. */
  async function outcomeOf(
    label: string,
    variant: MediaVariant,
    overrides: EngineConfigInput = {},
  ): Promise<Outcome> {
    return engineWith(overrides)
      .stream({ jobId: label, variant, requestContext: CONTEXT })
      .then(
        async (media): Promise<Outcome> => {
          const chunks: Buffer[] = [];
          media.body.on("data", (chunk: Buffer) => chunks.push(chunk));
          const done = await media.done.then(
            (outcome) => outcome.bytes,
            (error: unknown) => AppError.from(error).code,
          );
          const file = path.join(outputDir, `${label}.mp4`);
          await fs.writeFile(file, Buffer.concat(chunks));
          const decoded = await decodedVideoFrames(file);
          return { streamed: Buffer.concat(chunks).length, done, decodedFrames: decoded.frames };
        },
        (error: unknown): Outcome => {
          const appError = AppError.from(error);
          return {
            refused: appError.code,
            retryable: appError.retryable,
            message: appError.message,
          };
        },
      );
  }

  test("a tail-moov MP4 from an origin that ignores Range is refused before the first byte", async () => {
    const source = path.join(fixtureRoot, "large", "moov-end.mp4");
    // Able to fail: past the size below which ffmpeg never seeks, and in the
    // layout ffmpeg itself writes, with `free` between `ftyp` and `mdat`.
    expect((await fs.stat(source)).size).toBeGreaterThanOrEqual(91_053);
    expect(await topLevelBoxes(source)).toEqual(["ftyp", "free", "mdat", "moov"]);

    const before = ignoring.requests.length;
    const outcome = await outcomeOf(
      "dl-102-refused",
      large(`${ignoring.origin}/large/moov-end.mp4`),
    );

    expect(outcome).toEqual({
      refused: "SOURCE_NOT_SEEKABLE",
      retryable: false,
      message: DEFAULT_ERROR_MESSAGES.SOURCE_NOT_SEEKABLE,
    });
    // One request, the probe's, with the captured headers replayed on it; no
    // ffmpeg was started to make a second.
    const asked = ignoring.requests.slice(before);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.headers.referer).toBe(CONTEXT.headers["Referer"]);
  }, 60_000);

  test("control: the same tail-moov file from an origin that honours Range completes whole", async () => {
    expectWhole(await outcomeOf("dl-102-honoured", large(`${origin.origin}/large/moov-end.mp4`)));
  }, 60_000);

  test("control: a fast-start MP4 from an origin that ignores Range completes whole", async () => {
    const before = ignoring.requests.length;
    expectWhole(
      await outcomeOf("dl-102-faststart", large(`${ignoring.origin}/large/faststart.mp4`)),
    );
    // The probe asked and was answered with the whole file; ffmpeg then read it.
    expect(ignoring.requests.length - before).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test("a redirect is followed to the origin that answers, and that origin is the one judged", async () => {
    const outcome = await outcomeOf(
      "dl-102-moved",
      large(`${ignoring.origin}/moved/large/moov-end.mp4`),
    );
    expect(outcome).toMatchObject({ refused: "SOURCE_NOT_SEEKABLE" });
  }, 60_000);

  test("a mirror that honours Range is tried after a primary that does not", async () => {
    const before = ignoring.requests.length;
    expectWhole(
      await outcomeOf(
        "dl-102-mirror",
        large(`${ignoring.origin}/large/moov-end.mp4`, {
          alternateUrls: [`${origin.origin}/large/moov-end.mp4`],
        }),
      ),
    );
    // The primary was asked once, by the probe, and never by ffmpeg.
    expect(ignoring.requests.length - before).toBe(1);
  }, 60_000);

  test("when every mirror ignores Range, the last refusal is the answer", async () => {
    const outcome = await outcomeOf(
      "dl-102-no-mirror",
      large(`${ignoring.origin}/large/moov-end.mp4`, {
        alternateUrls: [`${ignoring.origin}/moved/large/moov-end.mp4`],
      }),
    );
    expect(outcome).toMatchObject({ refused: "SOURCE_NOT_SEEKABLE" });
  }, 60_000);

  test("a separate audio file from an origin that ignores Range is refused as well", async () => {
    // `audio-only.m4a` is ffmpeg's default layout, its index last.
    expect(await topLevelBoxes(path.join(fixtureRoot, "pair5", "audio-only.m4a"))).toEqual([
      "ftyp",
      "free",
      "mdat",
      "moov",
    ]);
    const error = await engineWith()
      .stream({
        jobId: "dl-102-audio",
        variant: large(`${origin.origin}/large/faststart.mp4`, {
          audioUrl: `${ignoring.origin}/pair5/audio-only.m4a`,
        }),
        requestContext: CONTEXT,
      })
      .then(
        () => null,
        (cause: unknown) => AppError.from(cause),
      );
    expect(error?.code).toBe("SOURCE_NOT_SEEKABLE");
    expect(error?.details).toMatchObject({ input: "audio" });
  }, 60_000);

  test("with subtitles attached, a refusal is final and not retried without them", async () => {
    const before = ignoring.requests.length;
    const error = await engineWith()
      .stream({
        jobId: "dl-102-subtitles",
        variant: large(`${ignoring.origin}/large/moov-end.mp4`),
        requestContext: CONTEXT,
        subtitles: [
          {
            id: "en",
            url: `${origin.origin}/subs/en.vtt`,
            language: "en",
            label: "English",
            format: "vtt",
            autoGenerated: false,
          },
        ],
        options: { embedSubtitles: true, subtitleLanguages: ["en"] },
      })
      .then(
        () => null,
        (cause: unknown) => AppError.from(cause),
      );
    expect(error?.code).toBe("SOURCE_NOT_SEEKABLE");
    expect(ignoring.requests.length - before).toBe(1);
  }, 60_000);

  test("a cancel while the probe waits is JOB_CANCELED, and ffmpeg never starts", async () => {
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 200);
    const error = await engineWith()
      .stream({
        jobId: "dl-102-cancel",
        variant: large(`${ignoring.origin}/slow/large/moov-end.mp4`),
        requestContext: CONTEXT,
        signal: controller.signal,
      })
      .then(
        () => null,
        (cause: unknown) => AppError.from(cause),
      );
    expect(error?.code).toBe("JOB_CANCELED");
    expect(performance.now() - started).toBeLessThan(1_500);
  }, 60_000);

  test("the probe goes through the configured proxy, in absolute form", async () => {
    const proxy = await startRecordingProxy(false);
    try {
      const url = `${ignoring.origin}/large/moov-end.mp4`;
      const outcome = await outcomeOf("dl-102-proxied", large(url), { proxyUrl: proxy.origin });
      expect(outcome).toMatchObject({ refused: "SOURCE_NOT_SEEKABLE" });
      expect(proxy.requests.map((entry) => [entry.url, entry.headers.range])).toEqual([
        [url, "bytes=1-1"],
      ]);
    } finally {
      await proxy.close();
    }
  }, 60_000);

  test("a proxy that refuses the probe is not gone around, by the probe or by ffmpeg", async () => {
    const proxy = await startRecordingProxy(true);
    try {
      const before = ignoring.requests.length;
      const outcome = await outcomeOf(
        "dl-102-proxy-refuses",
        large(`${ignoring.origin}/large/moov-end.mp4`),
        { proxyUrl: proxy.origin },
      );
      // Unknown to the probe, so ffmpeg ran, through the same proxy, and failed
      // on its own terms.
      expect(outcome).toMatchObject({ refused: "DOWNLOAD_FAILED" });
      expect(proxy.requests.length).toBeGreaterThanOrEqual(2);
      expect(ignoring.requests.length).toBe(before);
    } finally {
      await proxy.close();
    }
  }, 60_000);
});

/**
 * How dl-103's origin answers a request: by itself, returning true, or false to
 * serve the whole file with a `200`. `count` is this test's request count, from 1.
 */
type BlindAnswer = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  count: number,
  body: Buffer,
) => boolean;

/** The code that stopped it, before the first byte or after; never a resolved `done`. */
function stoppedWith(outcome: Outcome): string | number {
  return "refused" in outcome ? outcome.refused : outcome.done;
}

/**
 * dl-103. dl-102's probe lets ffmpeg run when it gets no answer, so that
 * ffmpeg's own failures keep their codes; and on an origin that ignores
 * `Range`, eight of the ways a probe goes unanswered still ended in a `done`
 * that resolved with a file of which no frame decodes. Rows 3 and 13 of
 * dl-102's gate 1 were `DOWNLOAD_FAILED` before the probe existed: the one
 * fault the origin had was spent on the probe. This is the second line of
 * defence, read off ffmpeg's own `partial file`.
 *
 * Imported here rather than at the top so this block moves no line above it.
 */
describe("dl-103: an unanswered seek probe", () => {
  let generateLargeProgressive: (dir: string) => Promise<void>;
  let decodedVideoFrames: (file: string) => Promise<{ frames: number }>;
  /** Byte offset of the tail-`moov` fixture's `moov` box. */
  let moovAt: number;
  /**
   * An origin that ignores `Range`, except where a test's `answer` says
   * otherwise. Gated like `origin`.
   */
  let blind: FixtureServer;
  let answer: BlindAnswer | null = null;
  let blindCount = 0;

  beforeAll(async () => {
    ({ generateLargeProgressive, decodedVideoFrames } = await import("./helpers/media.ts"));
    const dir = path.join(fixtureRoot, "large-103");
    await generateLargeProgressive(dir);
    const tail = await fs.readFile(path.join(dir, "moov-end.mp4"));
    for (let at = 0; at < tail.length; at += tail.readUInt32BE(at)) {
      if (tail.toString("latin1", at + 4, at + 8) === "moov") moovAt = at;
    }
    blind = await startFixtureServer(async (request, response) => {
      if (
        request.headers.referer !== CONTEXT.headers["Referer"] ||
        request.headers.cookie !== CONTEXT.headers["Cookie"]
      ) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const pathname = new URL(request.url ?? "/", "http://x").pathname;
      const file = path.join(fixtureRoot, ...pathname.split("/").filter((part) => part !== ".."));
      const body = await fs.readFile(file).catch(() => null);
      if (body === null) {
        response.writeHead(404).end();
        return;
      }
      blindCount += 1;
      if (answer?.(request, response, blindCount, body) === true) return;
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": String(body.length),
      });
      response.end(body);
    });
  }, 120_000);

  afterEach(() => {
    answer = null;
    blindCount = 0;
  });

  afterAll(async () => {
    await blind?.close();
  });

  async function outcomeOf(label: string, variant: MediaVariant): Promise<Outcome> {
    return engineWith()
      .stream({ jobId: label, variant, requestContext: CONTEXT })
      .then(
        async (media): Promise<Outcome> => {
          const chunks: Buffer[] = [];
          media.body.on("data", (chunk: Buffer) => chunks.push(chunk));
          const done = await media.done.then(
            (outcome) => outcome.bytes,
            (error: unknown) => AppError.from(error).code,
          );
          const file = path.join(outputDir, `${label}.mp4`);
          await fs.writeFile(file, Buffer.concat(chunks));
          const decoded = await decodedVideoFrames(file);
          return { streamed: Buffer.concat(chunks).length, done, decodedFrames: decoded.frames };
        },
        (error: unknown): Outcome => {
          const appError = AppError.from(error);
          return {
            refused: appError.code,
            retryable: appError.retryable,
            message: appError.message,
          };
        },
      );
  }

  const rows: readonly [string, BlindAnswer][] = [
    [
      "row 2: a 403 for the probe's bytes=1-1 only",
      (request, response) => {
        if (request.headers.range !== "bytes=1-1") return false;
        response.writeHead(403).end();
        return true;
      },
    ],
    [
      "row 3: a 500 on the first request only",
      (_request, response, count) => {
        if (count !== 1) return false;
        response.writeHead(500).end();
        return true;
      },
    ],
    [
      "row 5: the first request's connection reset",
      (request, _response, count) => {
        if (count !== 1) return false;
        request.socket.destroy();
        return true;
      },
    ],
    [
      "the ninth case: bounded ranges honoured, an open-ended one answered whole",
      (request, response, _count, body) => {
        const range = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range ?? "");
        if (range === null) return false;
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), body.length - 1);
        response.writeHead(206, {
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "content-length": String(end - start + 1),
        });
        response.end(body.subarray(start, end + 1));
        return true;
      },
    ],
  ];

  for (const [name, fault103] of rows) {
    test(`${name}, from an origin that ignores Range, is SOURCE_NOT_SEEKABLE`, async () => {
      answer = fault103;
      const outcome = await outcomeOf(
        `dl-103-${name.slice(0, 6).replace(/\W/gu, "")}`,
        large(`${blind.origin}/large-103/moov-end.mp4`),
      );
      // Before the fix: `done` resolved with about 35 KB of which 0 of 100
      // frames decode.
      expect(stoppedWith(outcome), JSON.stringify(outcome)).toBe("SOURCE_NOT_SEEKABLE");
      // The fault was reached, so the probe went unanswered and ffmpeg ran.
      expect(blindCount).toBeGreaterThanOrEqual(2);
    }, 60_000);
  }

  test("a refusal from ffmpeg's own words tries the next mirror, as the probe's does", async () => {
    answer = rows[0]?.[1] ?? null;
    expectWhole(
      await outcomeOf(
        "dl-103-mirror",
        large(`${blind.origin}/large-103/moov-end.mp4`, {
          alternateUrls: [`${origin.origin}/large-103/moov-end.mp4`],
        }),
      ),
    );
    expect(blindCount).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test("control: a body cut inside the moov and healed on reconnect completes whole", async () => {
    // The open question C's text left: a heal whose cut falls in the index
    // itself. Served by `origin`, which honours Range; ffmpeg's read of the
    // tail starts at the `moov` and stops half-way through it.
    let cut = false;
    fault = (pathname, _count, request, response, body) => {
      if (!pathname.endsWith("/large-103/moov-end.mp4") || cut) return false;
      if (request.headers.range !== `bytes=${moovAt}-`) return false;
      cut = true;
      cutShort(request, response, body, 0.5);
      return true;
    };
    expect(moovAt).toBeGreaterThan(0);
    expectWhole(
      await outcomeOf("dl-103-heal-moov", large(`${origin.origin}/large-103/moov-end.mp4`)),
    );
    expect(cut).toBe(true);
  }, 60_000);

  /**
   * Which side of the first byte `partial file` lands on is the order of two
   * pipes, not a guarantee, so each branch is pinned with ffmpeg stood in for.
   * The probe asks `origin`, which honours Range, and lets the stand-in run.
   *
   * With `stderrFirst` the stand-in ignores SIGTERM, so the kill takes its 3 s
   * grace and the first chunk arrives while ffmpeg is still being killed: the
   * window in which a refusal has been decided and `firstChunk` has not seen
   * the process exit. Real ffmpeg dies at once and reaches the same refusal
   * through `firstChunk` rejecting; this is the other way in.
   */
  async function standIn103(stderrFirst: boolean): Promise<string> {
    const dir = await fs.mkdtemp(path.join(outputDir, "stand-in-103-"));
    const script = path.join(dir, "ffmpeg");
    const line = JSON.stringify(
      "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x55b9913a5340] stream 1, offset 0x30: partial file",
    );
    const stdout = "process.stdout.write(Buffer.alloc(4096, 1));";
    const stderr = `process.stderr.write(${line} + "\\n");`;
    await fs.writeFile(
      script,
      [
        `#!${process.execPath}`,
        stderrFirst ? 'process.on("SIGTERM", () => undefined);' : "",
        stderrFirst ? stderr : stdout,
        "setTimeout(() => {",
        `  ${stderrFirst ? stdout : stderr}`,
        "  setTimeout(() => process.exit(0), 5000);",
        `}, ${stderrFirst ? 100 : 300});`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return script;
  }

  test.skipIf(process.platform === "win32")(
    "`partial file` before the first byte refuses the stream, and after it cuts the stream",
    async () => {
      const variant = large(`${origin.origin}/large-103/moov-end.mp4`);
      const before = await engineWith({ ffmpegPath: await standIn103(true) })
        .stream({ jobId: "dl-103-before", variant, requestContext: CONTEXT })
        .then(
          () => null,
          (error: unknown) => AppError.from(error),
        );
      expect(before?.code).toBe("SOURCE_NOT_SEEKABLE");
      expect(before?.details).toMatchObject({ afterFirstByte: false });

      const media = await engineWith({ ffmpegPath: await standIn103(false) }).stream({
        jobId: "dl-103-after",
        variant,
        requestContext: CONTEXT,
      });
      media.body.resume();
      await expect(media.done).rejects.toMatchObject({
        code: "SOURCE_NOT_SEEKABLE",
        details: { afterFirstByte: true },
      });
      expect(media.body.destroyed).toBe(true);
    },
    30_000,
  );

  test.skipIf(process.platform === "win32")(
    "control: the same line from an HLS stream is not read as an unseekable origin",
    async () => {
      // A segment's demuxer is ffmpeg's to report: the probe never asked an
      // HLS origin anything, and its holes have their own codes (dl-53).
      const media = await engineWith({ ffmpegPath: await standIn103(false) }).stream({
        jobId: "dl-103-hls",
        variant: hlsVariant("hls6", 6),
        requestContext: CONTEXT,
      });
      media.body.resume();
      await expect(media.done).resolves.toBeDefined();
    },
    30_000,
  );
});
