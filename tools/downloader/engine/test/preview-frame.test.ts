/**
 * dl-56: one preview frame, grabbed from a stream.
 *
 * Against a real HLS stream generated with ffmpeg at `beforeAll`, the way
 * `e2e/fixtures/hls-origin.ts` and `hls-e2e.test.ts` build theirs, served from a
 * loopback origin that **403s any request without the captured headers** — the
 * segments as well as the playlist, so a grab that replayed the context on the
 * manifest alone fails here as it would on a CDN.
 *
 * The bound is the part the tests are most about. A stream that trickles its
 * bytes defeats every stall timeout ffmpeg has, so the only thing standing
 * between a slow origin and a probe that never answers is `runFfmpeg`'s timer
 * and its process-tree kill. "Leaves no process behind" is asserted by finding
 * the ffmpeg process by a marker in its argv while it runs, and not finding it
 * afterwards — the positive half is what keeps the negative half from passing
 * on a process table this test cannot read.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { MediaVariant, RequestContext } from "@downloader/contract";
import { resolveFfmpegPath } from "../src/config.ts";
import {
  buildPreviewFrameArgs,
  choosePreviewVariant,
  grabPreviewFrame,
  PREVIEW_SEEK_CAP_SEC,
  previewSeekSec,
} from "../src/ffmpeg/preview-frame.ts";
import type { Logger } from "../src/logger.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { startFixtureServer } from "./helpers/http.ts";

const FFMPEG = resolveFfmpegPath();
const CLIP_SECONDS = 6;

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://player.example/watch/42",
    "User-Agent": "Mozilla/5.0 (FixtureBrowser)",
    Cookie: "cdn_token=s3cr3t",
  },
};

let fixtureDir: string;
let tmpRoot: string;
let server: FixtureServer;
/** Paths whose response is trickled a byte at a time, for the timeout tests. */
const trickled = new Set<string>();

function generate(args: string[]): Promise<void> {
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

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-preview-fixture-"));
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "engine-preview-tmp-"));
  await generate([
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=640x360:rate=15:duration=${CLIP_SECONDS}`,
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
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(fixtureDir, "seg%03d.ts"),
    path.join(fixtureDir, "index.m3u8"),
  ]);

  server = await startFixtureServer(async (request, response) => {
    if (
      request.headers.referer !== CONTEXT.headers["Referer"] ||
      request.headers.cookie !== CONTEXT.headers["Cookie"] ||
      request.headers["user-agent"] !== CONTEXT.headers["User-Agent"]
    ) {
      response.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", "http://x");
    const name = path.basename(url.pathname);
    let body: Buffer;
    try {
      body = await fs.readFile(path.join(fixtureDir, name));
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": String(body.length) });
    if (!trickled.has(name)) {
      response.end(body);
      return;
    }
    // One byte every 50 ms: never idle long enough for any stall timeout, and
    // nowhere near done inside any budget a test here sets.
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= body.length || response.destroyed) {
        clearInterval(timer);
        response.end();
        return;
      }
      response.write(body.subarray(offset, offset + 1));
      offset += 1;
    }, 50);
    response.once("close", () => clearInterval(timer));
  });
});

afterAll(async () => {
  await server?.close();
  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A logger that keeps what `grabPreviewFrame` said, so a test can read the reason. */
function recording(): { logger: Logger; debug: { message: string; fields: unknown }[] } {
  const debug: { message: string; fields: unknown }[] = [];
  return {
    debug,
    logger: {
      ...silent,
      debug: (message, fields) => void debug.push({ message, fields }),
    },
  };
}

/** Every process whose argv contains `marker`, read off `/proc`. Linux only. */
async function processesWith(marker: string): Promise<number[]> {
  const found: number[] = [];
  for (const entry of await fs.readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    // oxlint-disable-next-line no-await-in-loop
    const cmdline = await fs.readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
    if (cmdline.includes(marker)) found.push(Number(entry));
  }
  return found;
}

async function tmpLeftovers(): Promise<string[]> {
  return (await fs.readdir(tmpRoot)).filter((name) => name.startsWith("preview-"));
}

describe("grabPreviewFrame against a generated HLS stream", () => {
  test("returns JPEG bytes, inside the timeout, with the context replayed on every request", async () => {
    const before = server.requests.length;
    const timeoutMs = 15_000;
    const startedAt = performance.now();
    const bytes = await grabPreviewFrame({
      url: `${server.origin}/index.m3u8`,
      protocol: "hls",
      requestContext: CONTEXT,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tmpRoot,
      timeoutMs,
      maxOutputBytes: 512 * 1024,
      logger: silent,
    });

    expect(performance.now() - startedAt).toBeLessThan(timeoutMs);
    expect(bytes).not.toBeNull();
    expect([...(bytes as Buffer).subarray(0, 2)]).toEqual([0xff, 0xd8]);

    const made = server.requests.slice(before);
    // The segments are where a header-only-on-the-manifest bug would show.
    expect(made.some((request) => request.url.endsWith(".ts"))).toBe(true);
    for (const request of made) {
      expect(request.headers.referer).toBe(CONTEXT.headers["Referer"]);
      expect(request.headers.cookie).toBe(CONTEXT.headers["Cookie"]);
    }
    expect(await tmpLeftovers()).toEqual([]);
  }, 30_000);

  test("the frame is scaled down to the preview size, never past it", async () => {
    const bytes = await grabPreviewFrame({
      url: `${server.origin}/index.m3u8`,
      protocol: "hls",
      requestContext: CONTEXT,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tmpRoot,
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024,
    });
    // SOF0 carries height then width, big-endian, after its length and precision.
    const jpeg = bytes as Buffer;
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    const height = jpeg.readUInt16BE(sof + 5);
    const width = jpeg.readUInt16BE(sof + 7);
    // 640x360 in, longest edge 256 out, aspect kept.
    expect(width).toBe(256);
    expect(height).toBe(144);
  }, 30_000);

  test("without the context the origin refuses it, and the grab is null rather than a throw", async () => {
    const { logger, debug } = recording();
    const bytes = await grabPreviewFrame({
      url: `${server.origin}/index.m3u8`,
      protocol: "hls",
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tmpRoot,
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024,
      logger,
    });
    expect(bytes).toBeNull();
    expect(debug.map((entry) => entry.fields)).toContainEqual(
      expect.objectContaining({ code: "DOWNLOAD_FAILED" }),
    );
    expect(await tmpLeftovers()).toEqual([]);
  }, 30_000);

  test("output over maxOutputBytes is null", async () => {
    const { logger, debug } = recording();
    const bytes = await grabPreviewFrame({
      url: `${server.origin}/index.m3u8`,
      protocol: "hls",
      requestContext: CONTEXT,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tmpRoot,
      timeoutMs: 15_000,
      // A frame of this fixture is kilobytes; a hundred bytes cannot hold one.
      maxOutputBytes: 100,
      logger,
    });
    expect(bytes).toBeNull();
    expect(debug.map((entry) => entry.message).join("\n")).toMatch(
      /larger than the cap|did not produce one/u,
    );
    expect(await tmpLeftovers()).toEqual([]);
  }, 30_000);

  test.skipIf(process.platform !== "linux")(
    "a stream that trickles is cut off at the timeout, and its ffmpeg is gone when the grab returns",
    async () => {
      trickled.add("seg000.ts");
      trickled.add("seg001.ts");
      // In the URL, so it is in ffmpeg's argv and nothing else's.
      const marker = `grab-${randomUUID()}`;
      const { logger, debug } = recording();
      const timeoutMs = 2_000;
      try {
        const startedAt = performance.now();
        const pending = grabPreviewFrame({
          url: `${server.origin}/index.m3u8?${marker}`,
          protocol: "hls",
          requestContext: CONTEXT,
          durationSec: CLIP_SECONDS,
          ffmpegPath: FFMPEG,
          tmpRoot,
          timeoutMs,
          maxOutputBytes: 512 * 1024,
          logger,
        });

        // The positive control: while it runs, the process is findable this way.
        await new Promise((resolve) => setTimeout(resolve, 750));
        expect(await processesWith(marker)).not.toEqual([]);

        const bytes = await pending;
        const elapsedMs = performance.now() - startedAt;

        expect(bytes).toBeNull();
        expect(debug.map((entry) => entry.fields)).toContainEqual(
          expect.objectContaining({ code: "TIMEOUT" }),
        );
        // Bounded by the timeout plus the kill's grace, not by the stream.
        expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
        expect(elapsedMs).toBeLessThan(timeoutMs + 4_000);
        expect(await processesWith(marker)).toEqual([]);
        expect(await tmpLeftovers()).toEqual([]);
      } finally {
        trickled.clear();
      }
    },
    30_000,
  );

  test("a canceled caller is not a stream failure, so it throws rather than answering null", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      grabPreviewFrame({
        url: `${server.origin}/index.m3u8`,
        protocol: "hls",
        requestContext: CONTEXT,
        ffmpegPath: FFMPEG,
        tmpRoot,
        timeoutMs: 15_000,
        maxOutputBytes: 512 * 1024,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "JOB_CANCELED" });
    expect(await tmpLeftovers()).toEqual([]);
  });
});

describe("what the grab asks ffmpeg for", () => {
  const destPath = "/storage/tmp/preview-x/frame.jpg";

  test("one video frame, no other streams, as MJPEG to a file rather than stdout", () => {
    const args = buildPreviewFrameArgs(
      { url: "https://cdn.example/v.m3u8", protocol: "hls", durationSec: 120 },
      destPath,
    );
    const input = args.indexOf("-i");
    expect(args[input + 1]).toBe("https://cdn.example/v.m3u8");
    // Exactly one input: a variant's `audioUrl` is never opened for a frame.
    expect(args.filter((arg) => arg === "-i")).toHaveLength(1);
    const after = args.slice(input + 2);
    expect(after).toEqual(expect.arrayContaining(["-an", "-sn", "-dn"]));
    expect(after[after.indexOf("-map") + 1]).toBe("0:v:0");
    expect(after[after.indexOf("-frames:v") + 1]).toBe("1");
    expect(after[after.indexOf("-f") + 1]).toBe("mjpeg");
    expect(args.at(-1)).toBe(destPath);
    // `pipe:1` is progress, which is what enforces the byte cap mid-run.
    expect(args[args.indexOf("-progress") + 1]).toBe("pipe:1");
  });

  test("the seek is output-side, a tenth in, capped, and absent without a duration", () => {
    const seekOf = (durationSec: number | null): string[] => {
      const args = buildPreviewFrameArgs(
        { url: "https://cdn.example/v.m3u8", protocol: "hls", durationSec },
        destPath,
      );
      const at = args.indexOf("-ss");
      if (at === -1) return [];
      // After the input, where it decodes forward instead of reopening segments.
      expect(at).toBeGreaterThan(args.indexOf("-i"));
      return [args[at + 1] as string];
    };
    expect(seekOf(10)).toEqual(["1.000"]);
    expect(seekOf(3600)).toEqual([PREVIEW_SEEK_CAP_SEC.toFixed(3)]);
    expect(seekOf(null)).toEqual([]);
    expect(previewSeekSec(0)).toBe(0);
    expect(previewSeekSec(Number.NaN)).toBe(0);
  });

  test("TLS verification stays on for an https input, with the CA file it was given", () => {
    const args = buildPreviewFrameArgs(
      {
        url: "https://cdn.example/v.m3u8",
        protocol: "hls",
        tlsCaFile: "/run/egress-ca.pem",
      },
      destPath,
    );
    expect(args[args.indexOf("-tls_verify") + 1]).toBe("1");
    expect(args[args.indexOf("-ca_file") + 1]).toBe("/run/egress-ca.pem");
  });

  test("the context's headers are input options, ahead of the input", () => {
    const args = buildPreviewFrameArgs(
      { url: "https://cdn.example/v.m3u8", protocol: "hls", requestContext: CONTEXT },
      destPath,
    );
    const headers = args.indexOf("-headers");
    expect(headers).toBeGreaterThan(-1);
    expect(headers).toBeLessThan(args.indexOf("-i"));
    expect(args[headers + 1]).toContain("referer: https://player.example/watch/42");
  });
});

function base(overrides: Partial<MediaVariant>): MediaVariant {
  return {
    id: "v",
    protocol: "hls",
    url: "https://cdn.example/v.m3u8",
    hasVideo: true,
    label: "v",
    ...overrides,
  };
}

describe("choosePreviewVariant", () => {
  test("the cheapest rendition with video", () => {
    const chosen = choosePreviewVariant([
      base({ id: "1080p", bitrateBps: 5_000_000 }),
      base({ id: "audio", hasVideo: false, bitrateBps: 64_000 }),
      base({ id: "240p", bitrateBps: 300_000 }),
      base({ id: "480p", bitrateBps: 900_000 }),
    ]);
    expect(chosen?.id).toBe("240p");
  });

  test("an unknown bitrate is not cheap", () => {
    const chosen = choosePreviewVariant([
      base({ id: "unknown" }),
      base({ id: "720p", bitrateBps: 2_000_000 }),
    ]);
    expect(chosen?.id).toBe("720p");
  });

  test("with no bitrates to compare, the probe's own order stands", () => {
    const chosen = choosePreviewVariant([
      base({ id: "audio", hasVideo: false }),
      base({ id: "first-video" }),
      base({ id: "second-video" }),
    ]);
    expect(chosen?.id).toBe("first-video");
  });

  test("nothing with video is nothing to grab", () => {
    expect(choosePreviewVariant([base({ hasVideo: false })])).toBeNull();
    expect(choosePreviewVariant([])).toBeNull();
  });
});

/**
 * Split DASH, which the Build names and which nothing above exercises: video
 * and audio in separate adaptation sets, fragmented MP4 behind an init segment,
 * all behind the same header gate. The grab opens the MPD alone and maps the
 * first video stream, so it has to reach a frame without the audio set.
 */
describe("grabPreviewFrame against a generated split-DASH stream", () => {
  beforeAll(async () => {
    await generate([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=640x360:rate=15:duration=${CLIP_SECONDS}`,
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
      "-f",
      "dash",
      "-seg_duration",
      "2",
      "-adaptation_sets",
      "id=0,streams=v id=1,streams=a",
      // Into the same directory the gated origin serves; the DASH names
      // (`dash.mpd`, `*.m4s`) cannot collide with the HLS ones.
      "-init_seg_name",
      "dash-init-$RepresentationID$.m4s",
      "-media_seg_name",
      "dash-chunk-$RepresentationID$-$Number%05d$.m4s",
      path.join(fixtureDir, "dash.mpd"),
    ]);
  }, 30_000);

  test("returns JPEG bytes, with the context replayed on the init and media segments", async () => {
    const before = server.requests.length;
    const bytes = await grabPreviewFrame({
      url: `${server.origin}/dash.mpd`,
      protocol: "dash",
      requestContext: CONTEXT,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tmpRoot,
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024,
      logger: silent,
    });

    expect(bytes).not.toBeNull();
    expect([...(bytes as Buffer).subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const made = server.requests.slice(before);
    expect(made.some((request) => request.url.includes("dash-init-0"))).toBe(true);
    expect(made.some((request) => request.url.includes("dash-chunk-0-"))).toBe(true);
    for (const request of made) {
      expect(request.headers.referer).toBe(CONTEXT.headers["Referer"]);
    }
    expect(await tmpLeftovers()).toEqual([]);
  }, 30_000);
});
