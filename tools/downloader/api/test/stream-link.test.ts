/**
 * dl-53 through the HTTP surface: a job's link starts the job and streams the
 * file on the same response, and nothing is kept.
 *
 * Two halves. The first runs the real API with the stub engine over a real
 * socket, which is what makes "the connection was cut" and "the visitor went
 * away" things a test can do rather than simulate. The second runs the real
 * engine — ffmpeg, the egress proxy, the direct resolver — against generated
 * fixtures, for the Done-when lines that are about the bytes: fragmented MP4
 * that `ffprobe` reads at the source's length, headers before the stream ends,
 * a cut at the size cap, and a storage directory and a temp directory that are
 * the same before and after.
 */

import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { AppError, ROUTES } from "@downloader/contract";
import type { Job, JobResponse } from "@downloader/contract";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  generateDash,
  generateHls,
  generateProgressive,
  listTree,
  probeMedia,
  topLevelBoxes,
} from "../../engine/test/helpers/media.ts";
import { createLogger } from "../src/logger.ts";
import { createApp, runSweep } from "../src/server.ts";
import type { App } from "../src/server.ts";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
  STUB_BODY,
  StubResolver,
  waitFor,
} from "./helpers.ts";
import type { Harness } from "./helpers.ts";

interface Received {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** True when the connection ended without a complete response. */
  aborted: boolean;
  headersAtMs: number;
  endAtMs: number;
}

/**
 * A real `GET` over a real socket. `abortAfterBytes` makes it the visitor who
 * closes the tab mid-download.
 */
function get(
  origin: string,
  url: string,
  { abortAfterBytes = null as number | null, onHeaders = (): void => undefined } = {},
): Promise<Received> {
  const started = performance.now();
  return new Promise<Received>((resolve, reject) => {
    const request = http.get(`${origin}${url}`, (response) => {
      const headersAtMs = performance.now() - started;
      onHeaders();
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (aborted: boolean): void => {
        if (settled) return;
        settled = true;
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          aborted: aborted || !response.complete,
          headersAtMs,
          endAtMs: performance.now() - started,
        });
      };
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (abortAfterBytes !== null && size >= abortAfterBytes) {
          request.destroy();
          finish(true);
        }
      });
      response.once("end", () => finish(false));
      response.once("close", () => finish(true));
    });
    request.once("error", (error) => {
      if (abortAfterBytes === null) reject(error);
    });
  });
}

async function listen(app: App): Promise<string> {
  await app.server.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

async function post(app: App, url: string = SOURCE_URL): Promise<Job> {
  const response = await app.server.inject({ method: "POST", url: ROUTES.jobs, payload: { url } });
  expect(response.statusCode).toBe(201);
  return (response.json() as JobResponse).job;
}

function terminal(app: App, id: string): Promise<Job> {
  return waitFor(
    () => app.context.store.get(id),
    (job) => ["completed", "failed", "canceled"].includes(job.status),
    { label: `job ${id} to end`, timeoutMs: 20_000 },
  );
}

// --- the stub engine, over a socket ------------------------------------------

describe("the link, with the stub engine over a real socket", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("an error before the first byte answers JSON with its code, and the job row keeps it", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      // Not re-probe-worthy, so it is the first attempt's answer.
      engineOptions: { failWith: () => new AppError("SIZE_LIMIT_EXCEEDED") },
    });
    const origin = await listen(harness.app);
    const job = await post(harness.app);

    const received = await get(origin, job.link?.url ?? "");
    expect(received.status).toBe(413);
    expect(received.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(received.body.toString("utf8"))).toMatchObject({
      error: { code: "SIZE_LIMIT_EXCEEDED" },
    });
    const ended = await terminal(harness.app, job.id);
    expect(ended.status).toBe("failed");
    expect(ended.error?.code).toBe("SIZE_LIMIT_EXCEEDED");
  });

  test("an error after the first byte cuts the connection, and the job row carries the code", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: {
        chunks: [STUB_BODY, STUB_BODY],
        failAfterFirstChunk: () => new AppError("TIMEOUT"),
      },
    });
    const origin = await listen(harness.app);
    const job = await post(harness.app);

    const received = await get(origin, job.link?.url ?? "");
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    const ended = await terminal(harness.app, job.id);
    expect(ended.status).toBe("failed");
    expect(ended.error?.code).toBe("TIMEOUT");
    // Not a re-probe: a byte had already gone out.
    expect(harness.engine.calls).toBe(1);
  });

  test("a visitor who disconnects mid-stream cancels the job, recorded as its own outcome", async () => {
    let signal: AbortSignal | undefined;
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: {
        chunks: Array.from({ length: 50 }, () => STUB_BODY),
        chunkDelayMs: 20,
        onStream: (request) => {
          signal = request.signal;
        },
      },
    });
    const origin = await listen(harness.app);
    const job = await post(harness.app);

    const received = await get(origin, job.link?.url ?? "", { abortAfterBytes: 1 });
    expect(received.aborted).toBe(true);
    const ended = await terminal(harness.app, job.id);
    expect(ended.status).toBe("canceled");
    expect(ended.error).toMatchObject({
      code: "JOB_CANCELED",
      details: { reason: "disconnected" },
    });
    // The engine was told: this is what kills ffmpeg in production.
    expect(signal?.aborted).toBe(true);
  });

  test("a visitor who leaves while waiting for a slot cancels the waiting job", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = await createHarness({
      resolver: new StubResolver(async () => {
        await held;
        return probeResult();
      }),
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0 },
    });
    try {
      const origin = await listen(harness.app);
      const first = await post(harness.app);
      const second = await post(harness.app);
      void get(origin, first.link?.url ?? "").catch(() => undefined);
      await waitFor(
        () => harness?.app.context.queue.running,
        (n) => n === 1,
      );

      const request = http.get(`${origin}${second.link?.url ?? ""}`);
      request.on("error", () => undefined);
      await waitFor(
        () => harness?.app.context.queue.waiting,
        (n) => n === 1,
      );
      request.destroy();

      const ended = await terminal(harness.app, second.id);
      expect(ended.status).toBe("canceled");
      expect(ended.error).toMatchObject({ details: { reason: "disconnected" } });
    } finally {
      release?.();
    }
  });

  test("no slot inside the bounded wait is a 429 with Retry-After, and the link stays usable", async () => {
    // Owner decision 6: the wait plus the probe's timeout stays under 100 s.
    // A probe timeout of 99.95 s leaves a 50 ms wait, so the refusal is quick.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness = await createHarness({
      resolver: new StubResolver(async (call) => {
        if (call === 0) await held;
        return probeResult();
      }),
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0, probeTimeoutMs: 99_950 },
    });
    try {
      const busy = await post(harness.app);
      const waiting = await post(harness.app);
      const blocked = harness.app.server.inject({ method: "GET", url: busy.link?.url ?? "" });
      blocked.catch(() => undefined);
      await waitFor(
        () => harness?.app.context.queue.running,
        (n) => n === 1,
      );

      const refused = await harness.app.server.inject({
        method: "GET",
        url: waiting.link?.url ?? "",
      });
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

      // Given back: the job waits for its link again, and the link works.
      const after = harness.app.context.store.get(waiting.id);
      expect(after.status).toBe("queued");
      expect(after.link).toEqual(waiting.link);
      expect(harness.app.context.queue.waiting).toBe(0);

      release?.();
      await terminal(harness.app, busy.id);
      const served = await harness.app.server.inject({
        method: "GET",
        url: waiting.link?.url ?? "",
      });
      expect(served.statusCode).toBe(200);
    } finally {
      release?.();
    }
  });

  test("the sweep cancels a job whose link expired unopened, as link-expired", async () => {
    let clock = new Date("2026-09-27T10:00:00.000Z");
    harness = await createHarness({ resolver: new StubResolver(probeResult()), now: () => clock });
    const job = await post(harness.app);
    const frames: string[] = [];
    harness.app.context.events.subscribe(job.id, (event) => {
      frames.push(event.type);
    });

    clock = new Date(clock.getTime() + 14 * 60_000);
    runSweep(harness.app.context);
    expect(harness.app.context.store.get(job.id).status).toBe("queued");

    clock = new Date(clock.getTime() + 2 * 60_000);
    runSweep(harness.app.context);
    const ended = harness.app.context.store.get(job.id);
    expect(ended.status).toBe("canceled");
    expect(ended.error).toMatchObject({
      code: "JOB_CANCELED",
      details: { reason: "link-expired" },
    });
    expect(ended.link).toBeNull();
    // A listening card learns it without polling.
    expect(frames).toEqual(["status", "canceled"]);
  });
});

describe("a restart", () => {
  test("leaves a job whose link nobody opened waiting, and fails one that was running", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl53-restart-"));
    const databasePath = path.join(dir, "jobs.sqlite");
    const base = {
      logger: createLogger({ level: "silent" }),
      startGc: false,
      grabFrame: async () => null,
    };
    const config = {
      databasePath,
      storageDir: dir,
      ssrfAllowPrivateAddresses: true,
      enableBrowserResolver: false,
      enableYtdlpResolver: false,
      turnstile: undefined,
      rateLimitJobsPerMinute: 0,
    };
    const first = await createApp({ ...base, config });
    let second: App | undefined;
    try {
      const unopened = await post(first);
      const running = await post(first);
      first.context.store.claimLink((running.link?.url ?? "").split("/").at(-1) ?? "");
      first.context.store.transition(running.id, "probing");
      await first.shutdown();

      second = await createApp({ ...base, config });
      expect(second.context.store.get(unopened.id)).toMatchObject({
        status: "queued",
        link: unopened.link,
      });
      expect(second.context.store.get(running.id).status).toBe("failed");
    } finally {
      await first.shutdown();
      await second?.shutdown();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// --- the real engine --------------------------------------------------------

describe("the link, with real ffmpeg behind it", () => {
  let fixtureRoot: string;
  let storageDir: string;
  let privateTmp: string;
  let fixtures: http.Server;
  let fixtureOrigin: string;
  let delayMs = 0;
  /** On the third segment onwards only: the first byte at full speed, then a stall. */
  let lateSegmentDelayMs = 0;
  const saved: Record<string, string | undefined> = {};
  const apps: App[] = [];

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "api-dl53-fixture-"));
    await Promise.all([
      generateHls(path.join(fixtureRoot, "hls6"), 6),
      generateHls(path.join(fixtureRoot, "hls11"), 11),
      generateDash(path.join(fixtureRoot, "dash8"), 8),
      generateProgressive(path.join(fixtureRoot, "prog9"), 9),
    ]);
    fixtures = http.createServer((request, response) => {
      void (async () => {
        const pathname = new URL(request.url ?? "/", "http://x").pathname;
        const file = path.join(fixtureRoot, ...pathname.split("/").filter((p) => p !== ".."));
        let body: Buffer;
        try {
          body = await fs.readFile(file);
        } catch {
          response.writeHead(404).end();
          return;
        }
        if (delayMs > 0 && file.endsWith(".ts")) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (lateSegmentDelayMs > 0 && /seg0*[2-9]\d*\.ts$/u.test(file)) {
          await new Promise((resolve) => setTimeout(resolve, lateSegmentDelayMs));
        }
        const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
        if (range !== null) {
          const start = Number(range[1]);
          const end = range[2] === "" ? body.length - 1 : Number(range[2]);
          response.writeHead(206, {
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${body.length}`,
            "content-length": String(end - start + 1),
          });
          response.end(body.subarray(start, end + 1));
          return;
        }
        response.writeHead(200, {
          "accept-ranges": "bytes",
          "content-length": String(body.length),
          "content-type": file.endsWith(".mp4") ? "video/mp4" : "application/octet-stream",
        });
        response.end(body);
      })();
    });
    await new Promise<void>((resolve) => fixtures.listen(0, "127.0.0.1", resolve));
    fixtureOrigin = `http://127.0.0.1:${String((fixtures.address() as AddressInfo).port)}`;

    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-dl53-storage-"));
    privateTmp = await fs.mkdtemp(path.join(os.tmpdir(), "api-dl53-tmpdir-"));
    for (const key of ["TMPDIR", "TMP", "TEMP"]) {
      saved[key] = process.env[key];
      process.env[key] = privateTmp;
    }
  }, 120_000);

  afterEach(async () => {
    delayMs = 0;
    lateSegmentDelayMs = 0;
    while (apps.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      await apps.pop()?.shutdown();
    }
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fixtures.closeAllConnections();
    await new Promise<void>((resolve) => fixtures.close(() => resolve()));
    for (const dir of [fixtureRoot, storageDir, privateTmp]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The real app, the way the e2e config runs it: direct tier only, the SSRF
   * guard told about loopback, and the job database in \`STORAGE_DIR\` as it is
   * by default — which is what "the storage directory is unchanged" has to
   * survive.
   */
  async function realApp(
    config: { maxFileSizeBytes?: number; stageTimeoutMs?: number } = {},
  ): Promise<{ app: App; origin: string }> {
    const app = await createApp({
      startGc: false,
      logger: createLogger({ level: "silent" }),
      config: {
        storageDir,
        databasePath: path.join(storageDir, "jobs.db"),
        ssrfAllowHosts: ["127.0.0.1"],
        enableBrowserResolver: false,
        enableYtdlpResolver: false,
        enableDirectResolver: true,
        rateLimitProbePerMinute: 0,
        rateLimitProbeEventsPerMinute: 0,
        rateLimitJobsPerMinute: 0,
        rateLimitFilesPerMinute: 0,
        rateLimitThumbnailPerMinute: 0,
        turnstile: undefined,
        ...config,
      },
    });
    apps.push(app);
    return { app, origin: await listen(app) };
  }

  async function dirs(): Promise<{ storage: string[]; tmp: string[] }> {
    return { storage: await listTree(storageDir), tmp: await listTree(privateTmp) };
  }

  test("the temp directory listed is the one the process uses", () => {
    expect(os.tmpdir()).toBe(privateTmp);
  });

  const cases = [
    { label: "HLS", path: "/hls6/master.m3u8", seconds: 6 },
    { label: "DASH with a separate audio adaptation set", path: "/dash8/manifest.mpd", seconds: 8 },
    { label: "progressive MP4, index at the end", path: "/prog9/moov-end.mp4", seconds: 9 },
  ];

  test.each(cases)(
    "$label streams to a real client as fragmented MP4 that ffprobe reads, and nothing is kept",
    async (entry) => {
      const { app, origin } = await realApp();
      const job = await post(app, `${fixtureOrigin}${entry.path}`);
      const before = await dirs();

      const received = await get(origin, job.link?.url ?? "");
      expect(received.status).toBe(200);
      expect(received.aborted).toBe(false);
      expect(received.headers["content-type"]).toBe("video/mp4");
      expect(received.headers["content-disposition"]).toContain("attachment");
      expect(received.headers["content-length"]).toBeUndefined();

      const ended = await terminal(app, job.id);
      expect(ended.status).toBe("completed");
      expect(ended.result?.sizeBytes).toBe(received.body.length);

      // Written by the test, as the visitor\x27s browser would.
      const file = path.join(fixtureRoot, `received-${job.id}.mp4`);
      await fs.writeFile(file, received.body);
      expect((await topLevelBoxes(file)).slice(0, 2)).toEqual(["ftyp", "moov"]);
      const probed = await probeMedia(file);
      expect(probed.formatName).toContain("mp4");
      expect(probed.streams.map((stream) => stream.kind).toSorted()).toEqual(["audio", "video"]);
      expect(Math.abs((probed.durationSec ?? 0) - entry.seconds)).toBeLessThan(0.6);

      expect(await dirs()).toEqual(before);
    },
    60_000,
  );

  test("the headers arrive before the stream completes", async () => {
    delayMs = 250;
    const { app, origin } = await realApp();
    const job = await post(app, `${fixtureOrigin}/hls11/master.m3u8`);
    const received = await get(origin, job.link?.url ?? "");
    expect(received.status).toBe(200);
    // Six segments at 250 ms each cannot all have been read when the headers
    // went: most of the stream is still to come after them.
    expect(received.endAtMs - received.headersAtMs).toBeGreaterThan(500);
  }, 60_000);

  test.skipIf(process.platform !== "linux")(
    "a client that disconnects mid-stream leaves no ffmpeg, and the job is canceled",
    async () => {
      delayMs = 250;
      const { app, origin } = await realApp();
      const job = await post(app, `${fixtureOrigin}/hls11/master.m3u8`);
      const received = await get(origin, job.link?.url ?? "", { abortAfterBytes: 1 });
      expect(received.aborted).toBe(true);

      const ended = await terminal(app, job.id);
      expect(ended.status).toBe("canceled");
      expect(ended.error).toMatchObject({ details: { reason: "disconnected" } });

      const needle = fixtureOrigin.replace("http://", "");
      const alive = (): number[] =>
        readdirSync("/proc")
          .filter((entry) => /^\d+$/u.test(entry))
          .filter((entry) => {
            try {
              const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8");
              return argv.includes(needle) && argv.includes("pipe:1");
            } catch {
              return false;
            }
          })
          .map(Number);
      await waitFor(alive, (pids) => pids.length === 0, { label: "ffmpeg to be gone" });
      expect(alive()).toEqual([]);
    },
    60_000,
  );

  test("a stream that passes MAX_FILE_SIZE_MB is cut and recorded as SIZE_LIMIT_EXCEEDED", async () => {
    // The media playlist, not the master: no BANDWIDTH, so no estimate, and the
    // cap on the bytes themselves is the only thing that can stop it.
    const { app, origin } = await realApp({ maxFileSizeBytes: 96 * 1024 });
    const job = await post(app, `${fixtureOrigin}/hls11/index.m3u8`);
    const received = await get(origin, job.link?.url ?? "");

    const ended = await terminal(app, job.id);
    expect(ended.status).toBe("failed");
    expect(ended.error?.code).toBe("SIZE_LIMIT_EXCEEDED");
    if (received.status === 200) {
      expect(received.aborted).toBe(true);
      expect(received.body.length).toBeLessThanOrEqual(96 * 1024);
    } else {
      expect(received.status).toBe(413);
    }
  }, 60_000);

  test("an error after the first byte aborts the connection with the code on the job", async () => {
    lateSegmentDelayMs = 10_000;
    const { app, origin } = await realApp({ stageTimeoutMs: 4_000 });
    const job = await post(app, `${fixtureOrigin}/hls11/master.m3u8`);
    const received = await get(origin, job.link?.url ?? "");
    expect(received.status).toBe(200);
    expect(received.aborted).toBe(true);
    const ended = await terminal(app, job.id);
    expect(ended.status).toBe("failed");
    expect(ended.error?.code).toBe("TIMEOUT");
  }, 60_000);
});

describe("a fresh volume", () => {
  test("boots with a STORAGE_DIR that does not exist yet, and writes only the database there", async () => {
    // The e2e run found this: the engine used to create STORAGE_DIR for its
    // working files, and the database relied on it. dl-53 removed the working
    // files, and the first boot on an empty volume failed to open the database.
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-dl53-fresh-"));
    const storageDir = path.join(parent, "not-yet");
    const app = await createApp({
      logger: createLogger({ level: "silent" }),
      startGc: false,
      grabFrame: async () => null,
      config: {
        storageDir,
        enableBrowserResolver: false,
        enableYtdlpResolver: false,
        turnstile: undefined,
      },
    });
    try {
      expect(await listTree(storageDir)).toEqual(["jobs.db", "jobs.db-shm", "jobs.db-wal"]);
    } finally {
      await app.shutdown();
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});
