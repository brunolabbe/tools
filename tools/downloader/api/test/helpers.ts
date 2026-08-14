/**
 * Test doubles for the two expensive dependencies.
 *
 * The registry and the engine are stubbed rather than mocked at the module
 * level: both are plain interfaces from `@downloader/contract` and
 * `@downloader/engine`, so a hand-written stub is smaller than a mock and says
 * exactly what it does. No network, no browser, no ffmpeg.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { DownloadEngine, DownloadOutcome, DownloadRequest } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import type { MediaVariant, ProbeResult, Resolver, ResolveOptions } from "@downloader/contract";
import { createApp } from "../src/server.ts";
import type { App, CreateAppOptions } from "../src/server.ts";
import { createLogger } from "../src/logger.ts";

export const SOURCE_URL = "https://site.example/watch/42";

export function variant(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "hls-1080p",
    protocol: "hls",
    url: "https://cdn.example/master.m3u8",
    hasVideo: true,
    hasAudio: true,
    width: 1920,
    height: 1080,
    bitrateBps: 5_000_000,
    label: "1080p · H.264 + AAC",
    ...overrides,
  };
}

export function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    sourceUrl: SOURCE_URL,
    resolver: "browser",
    title: "A test video",
    durationSec: 120,
    variants: [variant()],
    subtitles: [],
    requestContext: {
      headers: { Referer: SOURCE_URL, Cookie: "session=super-secret" },
    },
    drm: { protected: false, systems: [] },
    isLive: false,
    probedAt: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

/** A resolver that answers from a script, and records how often it was called. */
export class StubResolver implements Resolver {
  readonly name = "stub";
  readonly priority = 10;
  calls = 0;
  disposed = 0;
  /** What the caller asked for, so tests can assert on the options it composed. */
  lastOptions: ResolveOptions | undefined;

  readonly #script: (call: number) => Promise<ProbeResult>;

  constructor(script: ProbeResult | ((call: number) => Promise<ProbeResult>)) {
    this.#script = typeof script === "function" ? script : async () => script;
  }

  canHandle(): boolean {
    return true;
  }

  async resolve(_url: URL, options: ResolveOptions): Promise<ProbeResult> {
    const call = this.calls++;
    this.lastOptions = options;
    if (options.signal.aborted) throw new AppError("CANCELED");
    return await this.#script(call);
  }

  async dispose(): Promise<void> {
    this.disposed++;
  }
}

export interface StubEngineOptions {
  storageRoot: string;
  /** Return an error to fail the download, or undefined to succeed. */
  failWith?: (call: number) => AppError | undefined;
  /** Called with each download request, for assertions on what was handed over. */
  onDownload?: (request: DownloadRequest, call: number) => void;
  /** Emits progress and stage callbacks before returning. */
  emitProgress?: boolean;
}

/**
 * An engine that writes a real (tiny) file, so the file-serving route can be
 * tested end to end without ffmpeg.
 */
export function createStubEngine(options: StubEngineOptions): DownloadEngine & { calls: number } {
  const root = options.storageRoot;
  let calls = 0;

  const engine = {
    // `/api/health` stats this path before calling ffmpeg available, so it has
    // to be a real executable. Node's own binary is the one guaranteed to
    // exist wherever the tests run; the stub never actually runs it.
    config: { ffmpegPath: process.execPath } as DownloadEngine["config"],
    storage: { root } as DownloadEngine["storage"],
    get calls() {
      return calls;
    },
    async init(): Promise<void> {
      await fs.mkdir(path.join(root, "out"), { recursive: true });
    },
    async download(request: DownloadRequest): Promise<DownloadOutcome> {
      const call = calls++;
      options.onDownload?.(request, call);

      if (request.signal?.aborted === true) {
        throw request.signal.reason instanceof AppError
          ? request.signal.reason
          : new AppError("JOB_CANCELED");
      }

      const failure = options.failWith?.(call);
      if (failure !== undefined) throw failure;

      if (options.emitProgress === true) {
        request.onProgress?.({
          stage: "downloading",
          percent: 50,
          downloadedBytes: 512,
          totalBytes: 1024,
          segmentsDone: 1,
          segmentsTotal: 2,
          speedBps: 1024,
          etaSec: 1,
          processedSec: 30,
        });
        request.onStage?.("muxing");
      }

      const dir = path.join(root, "out", request.jobId);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, "video.mp4");
      const contents = Buffer.from("stub-video-bytes-0123456789");
      await fs.writeFile(filePath, contents);

      return {
        jobId: request.jobId,
        path: filePath,
        filename: "video.mp4",
        sizeBytes: contents.byteLength,
        container: "mp4",
        durationSec: 120,
        transcodes: [],
      };
    },
    async collectGarbage() {
      return { removedOutDirs: [], removedTmpDirs: [], freedBytes: 0 };
    },
    async removeJob(jobId: string): Promise<void> {
      await fs.rm(path.join(root, "out", jobId), { recursive: true, force: true });
    },
  } satisfies DownloadEngine & { calls: number };

  return engine;
}

export interface HarnessOptions extends CreateAppOptions {
  resolver?: Resolver;
  engineOptions?: Partial<StubEngineOptions>;
}

export interface Harness {
  app: App;
  storageRoot: string;
  engine: DownloadEngine & { calls: number };
  dispose(): Promise<void>;
}

/**
 * A fully wired app with stubbed resolver and engine.
 *
 * `:memory:` for SQLite and a temp dir for storage, so tests are independent
 * and leave nothing behind.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-api-test-"));
  const engine = createStubEngine({ storageRoot, ...options.engineOptions });

  const app = await createApp({
    engine,
    startGc: false,
    logger: createLogger({ level: "silent" }),
    ...options,
    config: {
      databasePath: ":memory:",
      storageDir: storageRoot,
      maxConcurrentJobs: 2,
      // Every stub host is fictional and resolves nowhere, so the guard has to
      // be told to allow them. The guard itself is tested separately.
      ssrfAllowPrivateAddresses: true,
      enableBrowserResolver: false,
      enableYtdlpResolver: false,
      enableDirectResolver: true,
      // Off unless a test asks for them. Every injected request shares one
      // client address, so the production defaults would have unrelated suites
      // tripping a limiter they are not testing. `rate-limit.test.ts` turns
      // them back on explicitly.
      rateLimitProbePerMinute: 0,
      rateLimitJobsPerMinute: 0,
      ...options.config,
    },
  });

  if (options.resolver !== undefined) {
    // `ResolverRegistry` has no removal API by design, and adding one just for
    // tests would be a contract change. Registering at priority 10 puts the
    // stub ahead of every real tier, and they never run because it succeeds.
    app.context.registry.register(options.resolver);
  }

  return {
    app,
    storageRoot,
    engine,
    async dispose(): Promise<void> {
      await app.shutdown();
      await fs.rm(storageRoot, { recursive: true, force: true });
    },
  };
}

/** Polls until a predicate holds, so tests never sleep a fixed duration. */
export async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  { timeoutMs = 5000, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}; last value: ${JSON.stringify(value)}`);
    }
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
