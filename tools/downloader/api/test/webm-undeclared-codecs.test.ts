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
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { AppError, canMakeWebm, ROUTES } from "@downloader/contract";
import type { Job, JobResponse, MediaVariant, ProbeResult } from "@downloader/contract";
import { createEngine, resolveFfmpegPath } from "@downloader/engine";
import { DirectUrlResolver } from "@downloader/resolvers";
import type * as ResolversModule from "@downloader/resolvers";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { buildRegistry } from "../src/resolvers.ts";
import { createHarness, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

/**
 * The browser tier needs Chromium, which this file is not about: it is
 * replaced by a tier that reports what the real one does for a plain file it
 * saw on the network — a size and a container, and no codec. Everything after
 * that, the wrapper `buildRegistry` puts around it included, is real.
 */
const browserTier = vi.hoisted(() => ({ url: "" }));
vi.mock("@downloader/resolvers", async (importOriginal) => {
  const actual = await importOriginal<typeof ResolversModule>();
  class FakeBrowserTier {
    readonly name = "browser";
    readonly priority = 50;
    readonly confirmsAge = false;
    canHandle(): boolean {
      return true;
    }
    resolve(): Promise<ProbeResult> {
      return Promise.resolve({
        sourceUrl: "https://page.example/watch",
        resolver: "browser",
        title: "a page",
        variants: [
          {
            id: "browser-0",
            protocol: "progressive",
            url: browserTier.url,
            hasVideo: true,
            container: "mp4",
            label: "MP4",
          },
        ],
        subtitles: [],
        requestContext: { headers: {} },
        drm: { protected: false, systems: [] },
        isLive: false,
        probedAt: new Date().toISOString(),
      });
    }
    dispose(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { ...actual, BrowserResolver: FakeBrowserTier };
});

const FFMPEG = resolveFfmpegPath();
const SLOW = 90_000;

let dir: string;
let server: http.Server;
let origin: string;
/** Requests that carried a `Range` header, by path: what a header read looks like. */
const ranged = new Map<string, number>();
/** Header reads (ranged, not ffmpeg's), in order, and how many to refuse next. */
const headerReads: string[] = [];
let refuseHeaderReads = 0;

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
      // A header read is a ranged request that is not ffmpeg's. The first
      // `refuseHeaderReads` of them are answered 403: an origin that serves the
      // read at one probe and not at the next.
      const fromFfmpeg = (request.headers["user-agent"] ?? "").startsWith("Lavf");
      if (range !== null && !fromFfmpeg) {
        headerReads.push(name);
        if (refuseHeaderReads > 0) {
          refuseHeaderReads -= 1;
          response.writeHead(403).end();
          return;
        }
      }
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

describe("dl-99: the browser tier's variants are described through the registry", () => {
  test(
    "an undeclared MP4 the browser tier found gets its codecs from its header",
    async () => {
      browserTier.url = `${origin}/h264.mp4`;
      const { registry } = buildRegistry({
        config: loadApiConfig(
          { enableYtdlpResolver: false, enableBrowserResolver: true, enableDirectResolver: false },
          {},
        ),
        logger: createLogger({ level: "silent" }),
        fetchImpl: globalThis.fetch,
      });
      const probe = await registry.resolve(new URL(`${origin}/watch/page`), {
        timeoutMs: 20_000,
        signal: AbortSignal.timeout(20_000),
      });
      const found = probe.variants[0] as MediaVariant;

      expect(probe.resolver).toBe("browser");
      expect(found.videoCodec).toBe("avc1");
      expect(found.audioCodec).toBe("mp4a");
      expect(canMakeWebm(found)).toBe(true);
    },
    SLOW,
  );
});

describe("dl-99: a header read that leaves a variant undeclared says so", () => {
  test("in the log, without the URL's credential", async () => {
    const lines: string[] = [];
    const { registry } = buildRegistry({
      config: loadApiConfig(
        { enableYtdlpResolver: false, enableBrowserResolver: false, enableDirectResolver: true },
        {},
      ),
      logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
      fetchImpl: globalThis.fetch,
    });
    await registry.resolve(new URL(`${origin}/not-media.mp4?token=s3cr3t-signature`), {
      timeoutMs: 20_000,
      signal: AbortSignal.timeout(20_000),
    });

    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((candidate) => String(candidate["msg"]).includes("still undeclared"));
    expect(entry).toBeDefined();
    expect(entry?.["resolver"]).toBe("direct");
    expect(lines.join("\n")).not.toContain("s3cr3t-signature");
  }, 30_000);
});

describe("dl-99: a header read that fails only at the job's probe", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
    refuseHeaderReads = 0;
  });

  async function runWebmJob(name: string): Promise<{ job: Job; file: string }> {
    harness = await createHarness({ engine: createEngine({ maxFileSizeBytes: 64 * 1024 * 1024 }) });
    const created = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: `${origin}/${name}`, options: { container: "webm" } },
    });
    expect(created.statusCode).toBe(201);
    const job = (created.json() as JobResponse).job;
    const opened = await harness.app.server.inject({ method: "GET", url: job.link?.url ?? "" });
    const file = path.join(dir, `job-${name}.webm`);
    await fs.writeFile(file, opened.rawPayload);
    const current = harness;
    const finished = await waitFor(
      () => current.app.context.store.get(job.id),
      (candidate) => candidate.status === "completed" || candidate.status === "failed",
      { timeoutMs: 60_000, label: `job ${job.id}` },
    );
    return { job: finished, file };
  }

  test(
    "is read again once, and the job completes as VP9 and Opus",
    async () => {
      headerReads.length = 0;
      refuseHeaderReads = 1;
      const { job, file } = await runWebmJob("h264.mp4");

      expect(job.status).toBe("completed");
      expect(job.attempts).toBe(2);
      // The refused read, then the re-probe's.
      expect(headerReads.filter((name) => name === "h264.mp4").length).toBeGreaterThanOrEqual(2);
      expect(await codecsOf(file)).toEqual(["opus", "vp9"]);
    },
    SLOW,
  );

  test(
    "a variant that really is undeclared is refused after one re-probe, not looped",
    async () => {
      headerReads.length = 0;
      const { job } = await runWebmJob("not-media.mp4");

      expect(job.status).toBe("failed");
      expect(job.error?.code).toBe("CONTAINER_UNSUPPORTED");
      expect(job.error?.retryable).toBe(false);
      expect(job.attempts).toBe(2);
      const settled = headerReads.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(headerReads.length).toBe(settled);
    },
    SLOW,
  );
});
