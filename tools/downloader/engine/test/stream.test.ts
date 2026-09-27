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
import { AppError } from "@downloader/contract";
import type { JobOptions, MediaVariant, RequestContext, SubtitleTrack } from "@downloader/contract";
import type { EngineConfigInput } from "../src/config.ts";
import { createEngine } from "../src/index.ts";
import type { MediaStream } from "../src/index.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { startFixtureServer } from "./helpers/http.ts";
import {
  generateDash,
  generateHls,
  generateProgressive,
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
});
