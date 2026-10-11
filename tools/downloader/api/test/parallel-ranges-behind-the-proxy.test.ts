/**
 * dl-98: the parallel ranged fetches go through the guarded egress proxy, and
 * the guard's SSRF check applies to each of them, redirect hops included.
 *
 * The engine enforces no SSRF policy of its own; the proxy `server.ts` hands
 * ffmpeg is the check, and the feeder's fetches take the same route as the
 * seek probe's (`seek-probe.ts`'s `get`). Here that proxy is the real one,
 * `startEgressProxy` with `createSsrfGuard`, as `manifest-refetch.test.ts`
 * builds it: the origin is exempt by name, and the literal loopback address is
 * not, so a hop to it is the guard's ordinary refusal.
 *
 * The origin redirects every ranged fetch the fan-out opens to a trap on the
 * literal address. Followed around the proxy, the trap would see a
 * connection; through it, the guard refuses the hop, the feeder reads that
 * `403` as Decision 5's refusal, and the job finishes on one connection.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { MediaVariant } from "@downloader/contract";
import {
  createEngine,
  PARALLEL_RANGE_DEFAULTS,
  RangeFeeder,
  resolveFfmpegPath,
} from "@downloader/engine";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import { createSsrfGuard } from "../src/ssrf.ts";

const FFMPEG = resolveFfmpegPath();
const SLOW = 120_000;
const FIXTURE_HOST = "origin.dl98.test";
const CONTEXT = { headers: { Referer: "https://player.example/98", Cookie: "cdn=s3cr3t98" } };

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

let dir: string;
let body: Buffer;
let origin: http.Server;
let originPort: number;
let trap: http.Server;
let trapPort: number;
let trapConnections = 0;
let proxy: EgressProxy;
const seen: {
  range: string | undefined;
  referer: string | undefined;
  cookie: string | undefined;
}[] = [];

function isFanOut(range: string | undefined): boolean {
  return range !== undefined && /^bytes=\d+-\d+$/u.test(range) && range !== "bytes=1-1";
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: http.Server | undefined): Promise<void> {
  if (server === undefined) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Writes `bytes` at `bytesPerSecond`, in slices: one connection's worth of a throttled origin. */
async function trickle(response: http.ServerResponse, bytes: Buffer, bytesPerSecond: number) {
  const slice = 16 * 1024;
  const started = performance.now();
  for (let offset = 0; offset < bytes.length && !response.destroyed; offset += slice) {
    const due = started + ((offset + slice) * 1000) / bytesPerSecond;
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, due - performance.now())));
    response.write(bytes.subarray(offset, offset + slice));
  }
  response.end();
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dl98-api-"));
  const file = path.join(dir, "clip.mp4");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"],
        ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=25:duration=3"],
        ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-b:v", "6M"],
        ["-movflags", "+faststart", file],
      ].flat(),
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  body = await fs.readFile(file);

  trap = http.createServer((_request, response) => response.end("should never be reached"));
  trap.on("connection", () => {
    trapConnections += 1;
  });
  trapPort = await listen(trap);

  origin = http.createServer((request, response) => {
    const range = request.headers.range;
    seen.push({ range, referer: request.headers.referer, cookie: request.headers.cookie });
    if (isFanOut(range)) {
      response.writeHead(302, { location: `http://127.0.0.1:${trapPort}/stolen` }).end();
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/u.exec(range ?? "");
    const start = match === null ? 0 : Number(match[1]);
    const end = match === null || match[2] === "" ? body.length - 1 : Number(match[2]);
    response.writeHead(206, {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${body.length}`,
      "content-length": String(end - start + 1),
    });
    void trickle(response, body.subarray(start, end + 1), 1_000_000);
  });
  originPort = await listen(origin);

  proxy = await startEgressProxy({
    guard: createSsrfGuard({ allowHosts: [FIXTURE_HOST], lookup: async () => ["127.0.0.1"] }),
    logger: NOOP_LOGGER,
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
  });
}, SLOW);

afterAll(async () => {
  await proxy?.close();
  await close(origin);
  await close(trap);
  await fs.rm(dir, { recursive: true, force: true });
});

function readAll(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: { range: "bytes=0-" }, agent: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => resolve(Buffer.concat(chunks)));
        // A cut read resolves short rather than hanging; the comparison then fails.
        response.once("close", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

describe("dl-98: the fan-out behind the guarded egress proxy", () => {
  test(
    "a ranged fetch redirected to a refused address is stopped at the guard, and the read completes",
    async () => {
      seen.length = 0;
      trapConnections = 0;
      const refused: string[] = [];
      const feeder = await RangeFeeder.start({
        url: `http://${FIXTURE_HOST}:${originPort}/clip.mp4`,
        requestContext: CONTEXT,
        route: { kind: "proxy", url: new URL(proxy.url) },
        tlsVerify: true,
        tlsCaFile: undefined,
        settings: { ...PARALLEL_RANGE_DEFAULTS, chunkBytes: 128 * 1024, measureMs: 200 },
        sizeHint: null,
        durationSec: () => 0.5,
        maxBytes: 0,
        logger: NOOP_LOGGER,
        jobId: "dl98-guard",
        onRefused: (host, kind) => refused.push(`${host} ${kind}`),
        onFatal: () => undefined,
      });
      const read = await readAll(feeder.url);
      const stats = feeder.stats();
      feeder.close();

      expect(read.equals(body)).toBe(true);
      expect(trapConnections).toBe(0);
      // The guard answered the hop `403`, which is one of Decision 5's refusals.
      expect(stats.refusal).toEqual({ kind: "status", detail: "403" });
      expect(refused).toEqual([`${FIXTURE_HOST} status`]);
      expect(seen.filter((entry) => isFanOut(entry.range)).length).toBeGreaterThan(0);
      for (const entry of seen) {
        expect(entry.referer).toBe(CONTEXT.headers.Referer);
        expect(entry.cookie).toBe(CONTEXT.headers.Cookie);
      }
    },
    SLOW,
  );

  test(
    "a whole job through the engine and the guarded proxy: ffmpeg reads the loopback, the guard sees the rest",
    async () => {
      seen.length = 0;
      trapConnections = 0;
      const engine = createEngine({
        maxFileSizeBytes: 64 * 1024 * 1024,
        proxyUrl: proxy.url,
        parallelRanges: { chunkBytes: 128 * 1024, measureMs: 200 },
      });
      const variant: MediaVariant = {
        id: "dl98",
        protocol: "progressive",
        url: `http://${FIXTURE_HOST}:${originPort}/clip.mp4`,
        container: "mp4",
        hasVideo: true,
        hasAudio: false,
        videoCodec: "avc1.64001f",
        durationSec: 0.5,
        filesizeBytes: body.length,
        label: "dl98",
      };
      const media = await engine.stream({ jobId: "dl98-job", variant, requestContext: CONTEXT });
      media.body.resume();
      const outcome = await media.done;

      expect(outcome.bytes).toBeGreaterThan(body.length / 2);
      expect(trapConnections).toBe(0);
      expect(seen.filter((entry) => isFanOut(entry.range)).length).toBeGreaterThan(0);

      // The host is remembered on this engine: the next job never fans out.
      seen.length = 0;
      const again = await engine.stream({ jobId: "dl98-job-2", variant, requestContext: CONTEXT });
      again.body.resume();
      await again.done;
      expect(seen.filter((entry) => isFanOut(entry.range))).toEqual([]);
    },
    SLOW,
  );
});
