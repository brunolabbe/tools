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
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import type { DownloadEngine, MediaStream, StreamOutcome, StreamRequest } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import type { MediaVariant, ProbeResult, Resolver, ResolveOptions } from "@downloader/contract";
import type { LightMyRequestResponse } from "fastify";
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
  /** Return an error to fail before the first byte, or undefined to succeed. */
  failWith?: (call: number) => AppError | undefined;
  /** Return an error to cut the stream after its first chunk, with that code. */
  failAfterFirstChunk?: (call: number) => AppError | undefined;
  /** Called with each stream request, for assertions on what was handed over. */
  onStream?: (request: StreamRequest, call: number) => void;
  /** Emits a progress callback before the first byte. */
  emitProgress?: boolean;
  /** The body, chunk by chunk. Defaults to one small chunk. */
  chunks?: readonly Buffer[];
  /** Delay before each chunk after the first, so a test can act mid-stream. */
  chunkDelayMs?: number;
}

export const STUB_BODY = Buffer.from("stub-video-bytes-0123456789");

/**
 * An engine that streams a few real bytes, so the link route can be tested end
 * to end without ffmpeg — including a cut after the first byte, and a reader
 * that goes away. It writes nothing anywhere, as the real one does not.
 */
export function createStubEngine(options: StubEngineOptions): DownloadEngine & { calls: number } {
  let calls = 0;

  const engine = {
    // `/api/health` stats this path before calling ffmpeg available, so it has
    // to be a real executable. Node's own binary is the one guaranteed to
    // exist wherever the tests run; the stub never actually runs it.
    config: { ffmpegPath: process.execPath } as DownloadEngine["config"],
    get calls() {
      return calls;
    },
    async stream(request: StreamRequest): Promise<MediaStream> {
      const call = calls++;
      options.onStream?.(request, call);
      const { signal } = request;
      const aborted = (): AppError =>
        signal?.reason instanceof AppError ? signal.reason : new AppError("JOB_CANCELED");
      if (signal?.aborted === true) throw aborted();

      const failure = options.failWith?.(call);
      if (failure !== undefined) throw failure;

      if (options.emitProgress === true) {
        request.onProgress?.({
          stage: "downloading",
          percent: 50,
          downloadedBytes: 512,
          totalBytes: null,
          segmentsDone: null,
          segmentsTotal: null,
          speedBps: 1024,
          etaSec: 1,
          processedSec: 30,
        });
      }

      const chunks = options.chunks ?? [STUB_BODY];
      const late = options.failAfterFirstChunk?.(call);
      const body = new PassThrough();
      body.on("error", () => undefined);
      let sent = 0;

      const done = (async (): Promise<StreamOutcome> => {
        for (const [index, chunk] of chunks.entries()) {
          if (index > 0 && (options.chunkDelayMs ?? 0) > 0) {
            // oxlint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, options.chunkDelayMs));
          }
          if (signal?.aborted === true || body.destroyed) throw aborted();
          body.write(chunk);
          sent += chunk.length;
          if (index === 0 && late !== undefined) {
            // Later than the first byte, as a real failure is: the headers
            // have gone by the time it lands.
            await new Promise((resolve) => setTimeout(resolve, 50));
            throw late;
          }
        }
        body.end();
        await finished(body, { readable: false });
        return { bytes: sent, durationSec: 120 };
      })().catch((error: unknown) => {
        const appError = AppError.from(error);
        body.destroy(appError);
        throw appError;
      });
      done.catch(() => undefined);
      signal?.addEventListener("abort", () => body.destroy(aborted()), { once: true });

      return {
        body,
        contentType: "video/mp4",
        filename: "video.mp4",
        container: "mp4",
        transcodes: [],
        done,
      };
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
    // No ffmpeg, like the rest of this harness: the stub engine's "binary" is
    // node, and `probeResult()` names no image, so the real grab would spawn it
    // on nearly every probe here. A test about the grab passes its own (dl-56).
    grabFrame: async () => null,
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
      rateLimitProbeEventsPerMinute: 0,
      rateLimitJobsPerMinute: 0,
      rateLimitFilesPerMinute: 0,
      rateLimitThumbnailPerMinute: 0,
      // Off unless a test asks, and off *explicitly* rather than by omission:
      // an omitted key falls through to the environment, and a developer who
      // exported their Turnstile keys would otherwise see every suite here
      // refused for want of a token (dl-50).
      turnstile: undefined,
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

/**
 * Opens a job's link the way a visitor clicking it would, and does not wait
 * for the file: since dl-53 nothing runs until this happens. The response is
 * returned for a test that wants it.
 */
export function openLink(
  current: Harness,
  job: { link?: { url: string } | null | undefined },
): Promise<LightMyRequestResponse> {
  const opened = current.app.server.inject({ method: "GET", url: job.link?.url ?? "" });
  opened.catch(() => undefined);
  return opened;
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
