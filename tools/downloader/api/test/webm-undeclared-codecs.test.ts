/**
 * dl-99, across the seam it lives on: the direct tier reports a plain file by
 * its size and Content-Type, the registry's wrapper reads the codecs out of the
 * file's own header, and the engine then transcodes, copies or refuses WebM.
 *
 * In `api/` because the engine may not import the resolvers; the fixtures are
 * real files made by the bundled ffmpeg and served from loopback.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError, canMakeWebm } from "@downloader/contract";
import type { MediaVariant, ProbeResult } from "@downloader/contract";
import { createEngine, resolveFfmpegPath } from "@downloader/engine";
import { DirectUrlResolver } from "@downloader/resolvers";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { buildRegistry } from "../src/resolvers.ts";

const FFMPEG = resolveFfmpegPath();
const SLOW = 90_000;

let dir: string;
let server: http.Server;
let origin: string;
/** Requests that carried a `Range` header, by path: what a header read looks like. */
const ranged = new Map<string, number>();

function ffmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-nostdin", ...args], {
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
    child.once("close", (code) => resolve(code === 0 ? stderr : `exit ${code}: ${stderr}`));
  });
}

const SOURCES = [
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=160x120:rate=10:duration=2",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=44100:duration=2",
];

const QUIET = ["-loglevel", "error", "-y"];
const H264_AAC = [
  ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
  ["-shortest", "-movflags", "+faststart"],
].flat();
const VP9_OPUS = [
  ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "100k"],
  ["-c:a", "libopus", "-shortest"],
].flat();

/** Codec names of a file's streams, read back by ffmpeg itself. */
async function codecsOf(file: string): Promise<string[]> {
  const described = await ffmpeg(["-i", file]);
  return [...described.matchAll(/Stream #\d+:\d+.*?: (?:Video|Audio): (\w+)/gu)]
    .map((match) => match[1] ?? "")
    .toSorted();
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dl99-"));
  await ffmpeg([...QUIET, ...SOURCES, ...H264_AAC, path.join(dir, "h264.mp4")]);
  await ffmpeg([...QUIET, ...SOURCES, ...VP9_OPUS, path.join(dir, "vp9.webm")]);
  // Named like an MP4 and served as one; the bytes are not.
  await fs.writeFile(path.join(dir, "not-media.mp4"), Buffer.alloc(200_000, 0x41));

  server = http.createServer((request, response) => {
    void (async () => {
      const name = path.basename(new URL(request.url ?? "/", "http://x").pathname);
      let body: Buffer;
      try {
        body = await fs.readFile(path.join(dir, name));
      } catch {
        response.writeHead(404).end();
        return;
      }
      const type = name.endsWith(".webm") ? "video/webm" : "video/mp4";
      const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
      if (range !== null) ranged.set(name, (ranged.get(name) ?? 0) + 1);
      if (request.method === "HEAD") {
        response
          .writeHead(200, { "content-type": type, "content-length": String(body.length) })
          .end();
        return;
      }
      if (range === null) {
        response
          .writeHead(200, {
            "content-type": type,
            "content-length": String(body.length),
            "accept-ranges": "bytes",
          })
          .end(body);
        return;
      }
      const start = Number(range[1]);
      const end = range[2] === "" ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
      response
        .writeHead(206, {
          "content-type": type,
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "content-length": String(end - start + 1),
        })
        .end(body.subarray(start, end + 1));
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, SLOW);

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  await fs.rm(dir, { recursive: true, force: true });
});

/** The chain as the service composes it, with only the direct tier on. */
async function probeThroughRegistry(name: string): Promise<ProbeResult> {
  const { registry } = buildRegistry({
    config: loadApiConfig(
      { enableYtdlpResolver: false, enableBrowserResolver: false, enableDirectResolver: true },
      {},
    ),
    logger: createLogger({ level: "silent" }),
    fetchImpl: globalThis.fetch,
  });
  return await registry.resolve(new URL(`${origin}/${name}`), {
    timeoutMs: 20_000,
    signal: AbortSignal.timeout(20_000),
  });
}

async function streamAsWebm(probe: ProbeResult, label: string): Promise<string> {
  const media = await createEngine({ maxFileSizeBytes: 64 * 1024 * 1024 }).stream({
    jobId: label,
    variant: probe.variants[0] as MediaVariant,
    requestContext: probe.requestContext,
    options: { container: "webm" },
  });
  const received = path.join(dir, `${label}.webm`);
  const handle = await fs.open(received, "w");
  try {
    for await (const chunk of media.body) await handle.write(chunk as Buffer);
  } finally {
    await handle.close();
  }
  await media.done;
  return received;
}

describe("dl-99: an undeclared file chosen as WebM", () => {
  test(
    "the reproduction: an H.264/AAC MP4 the tier did not describe completes as VP9 and Opus",
    async () => {
      // Without the header read the tier reports no codec, and WebM is refused.
      const bare = (
        await new DirectUrlResolver({ fetch: globalThis.fetch }).resolve(
          new URL(`${origin}/h264.mp4`),
          { timeoutMs: 20_000, signal: AbortSignal.timeout(20_000) },
        )
      ).variants[0] as MediaVariant;
      expect(bare.videoCodec).toBeUndefined();
      expect(canMakeWebm(bare)).toBe(false);

      const probe = await probeThroughRegistry("h264.mp4");
      const found = probe.variants[0] as MediaVariant;
      expect(found.videoCodec).toBe("avc1");
      expect(found.audioCodec).toBe("mp4a");
      expect(canMakeWebm(found)).toBe(true);

      const received = await streamAsWebm(probe, "dl99-h264");
      expect(await codecsOf(received)).toEqual(["opus", "vp9"]);
    },
    SLOW,
  );

  test(
    "a WebM source is copied whole, and its header is never read",
    async () => {
      ranged.clear();
      const probe = await probeThroughRegistry("vp9.webm");
      const found = probe.variants[0] as MediaVariant;
      expect(found.container).toBe("webm");
      expect(found.videoCodec).toBeUndefined();
      expect(canMakeWebm(found)).toBe(true);
      expect(ranged.get("vp9.webm")).toBeUndefined();

      const received = await streamAsWebm(probe, "dl99-webm");
      expect(await codecsOf(received)).toEqual(["opus", "vp9"]);
    },
    SLOW,
  );

  test(
    "an MP4 whose header cannot be read stays undeclared, is refused for WebM",
    async () => {
      const probe = await probeThroughRegistry("not-media.mp4");
      const found = probe.variants[0] as MediaVariant;
      expect(found.videoCodec).toBeUndefined();
      expect(canMakeWebm(found)).toBe(false);

      const error = await streamAsWebm(probe, "dl99-garbage").then(
        () => null,
        (cause: unknown) => AppError.from(cause),
      );
      expect(error?.code).toBe("CONTAINER_UNSUPPORTED");
    },
    SLOW,
  );
});
