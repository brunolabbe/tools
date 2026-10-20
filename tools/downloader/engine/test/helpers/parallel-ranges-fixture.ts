/**
 * The fixture the parallel-ranges specs share (dl-129, split from
 * parallel-ranges.test.ts the way dl-117 split the browser resolver's).
 *
 * dl-98: parallel ranged reads for a progressive source throttled per
 * connection.
 *
 * The origin here throttles **each request** to a fixed rate, which is the
 * shape the reported origin had (about 27 KB/s per connection, about four
 * times that across four); `sharedBps` makes it throttle the client as a
 * whole instead, the per-IP case Decision 5 calls no speed-up. It counts what
 * it is asked: every request's `Range`, its replayed headers, and how many
 * were open at once — "counted at the fixture", as the ticket asks.
 *
 * The feeder's ranged fetches carry a closed range (`bytes=a-b`); the
 * connection it relays, and the one it continues on after a fallback, carry
 * an open one (`bytes=a-`), as ffmpeg's do; the seek probe's is `bytes=1-1`.
 * So "a ranged fetch the fan-out opened" is a closed range other than the
 * probe's, which is how the refusing origins below pick them out.
 *
 * **Each spec file owns its origin.** The state below is module state, and
 * vitest loads a module afresh for every test file (`isolate` is on), so a file
 * that calls `startOrigin` in `beforeAll` starts a server of its own, with its
 * own counters, and no other file sees it. Nothing here registers a hook: a file
 * wires `startOrigin`, `stopOrigin` and `resetAfterEach` up itself, as
 * `browser-harness.ts` leaves `startBrowserHarness` to its files.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";
import type { AppError } from "@downloader/contract";
import type { MediaVariant, RequestContext } from "@downloader/contract";
import type { EngineConfigInput } from "../../src/config.ts";
import type { RefusalKind } from "../../src/download/parallel-ranges.ts";
import { PARALLEL_RANGE_DEFAULTS, RangeFeeder } from "../../src/download/parallel-ranges.ts";
import { createEngine } from "../../src/index.ts";
import type { MediaStream } from "../../src/index.ts";
import { NOOP_LOGGER } from "../../src/logger.ts";
import { FFMPEG, generateBitrateProgressive, packetDigests } from "./media.ts";

export const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://player.example/watch/98",
    "User-Agent": "Mozilla/5.0 (FixtureBrowser)",
    Cookie: "cdn_token=s3cr3t98",
  },
};

/** Real ffmpeg on throttled transfers of a few megabytes. */
export const SLOW = 120_000;

/** A small chunk and a short window, so a few megabytes split into many chunks quickly. */
export const FAST_SPLIT = { chunkBytes: 128 * 1024, measureMs: 200 } as const;

type Refusal = "429" | "403" | "503" | "reset" | "200";

export interface Behaviour {
  /** Each request on its own at this rate. Null is as fast as the socket goes. */
  perConnectionBps: number | null;
  /** Every request together at this rate: a per-client throttle. */
  sharedBps: number | null;
  /** How the origin answers a ranged fetch the fan-out opened. */
  refuse: Refusal | null;
  /**
   * Every request answered `200` with the whole body chunked: no `Range`, and
   * no length anywhere, so nothing can learn the file's size.
   */
  sizeless: boolean;
  /** Bytes per write. 16 KiB unless a test needs the origin's writes larger (gate 1's F3). */
  slice: number;
  /** The first fan-out fetch is answered with headers and then nothing, once (gate 1's F2). */
  stallFirstFanOut: boolean;
  /** The next open-ended request (a relay) is answered this late, once (gate 2's F10). */
  relayHeaderDelayMs: number;
}

export interface Seen {
  range: string | undefined;
  referer: string | undefined;
  cookie: string | undefined;
  userAgent: string | undefined;
  /** Requests already open when this one arrived. */
  openAtArrival: number;
  refused: boolean;
  at: number;
}

const DEFAULT_BEHAVIOUR: Behaviour = {
  perConnectionBps: null,
  sharedBps: null,
  refuse: null,
  sizeless: false,
  slice: 16 * 1024,
  stallFirstFanOut: false,
  relayHeaderDelayMs: 0,
};
export let behaviour: Behaviour = { ...DEFAULT_BEHAVIOUR };
export let seen: Seen[] = [];
export let open = 0;
export let maxOpen = 0;
/** For the shared throttle: when the next slice may go, for any connection. */
let sharedNext = 0;

let dir: string;
export let files: Record<string, Buffer>;
let origin: http.Server;
export let originUrl: string;

/** A response the fixture holds open and silent; ended in `afterEach`. */
export const stalled: http.ServerResponse[] = [];

/**
 * What a throttled origin may owe a client after a late wake-up: one Windows
 * timer tick (15.6 ms) and some. More would let a stall come out as a burst
 * that a 50 ms speed-up window reads as a faster origin.
 */
const MAX_CREDIT_MS = 25;

/**
 * A rate that is slow against a source declared 0.5 s long, whose 4 MB are read
 * at about 8 MB/s as media: every test that needs "slow" and then reads the
 * whole file to the end pays 4 MB over this rate, once per read. Four MB/s is
 * half the media rate, where 1 and 2 MB/s were an eighth and a quarter of it
 * and made the same claims at two to four times the cost (dl-112).
 */
export const SLOW_AGAINST_HALF_A_SECOND = 4_000_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A closed range other than the probe's: a fetch the fan-out opened. */
export function isFanOut(range: string | undefined): boolean {
  return range !== undefined && /^bytes=\d+-\d+$/u.test(range) && range !== "bytes=1-1";
}

async function send(
  response: http.ServerResponse,
  body: Buffer,
  bps: { perConnection: number | null; shared: number | null },
): Promise<void> {
  let offset = 0;
  let next = performance.now();
  while (offset < body.length && !response.destroyed) {
    const slice = body.subarray(offset, offset + behaviour.slice);
    offset += slice.length;
    // A throttle is a bucket that refills at the rate, not a timer per slice
    // (dl-106). On Windows a timer fires on a ~15.6 ms tick when nothing else
    // on the machine has asked for finer, so `sleep(4)` takes 15.6 ms and a
    // fixture that sleeps once per 16 KiB slice cannot go faster than about
    // 1 MB/s, whatever rate it was told: a "4 MB/s" origin read 1.4 MB/s there,
    // slower than the media it was meant to outrun, and a "2 MB/s per client"
    // origin read 1.1 MB/s on one connection and 2 on four, a 1.8x speed-up that
    // the feeder rightly kept. So a late wake-up writes every slice that fell
    // due while it slept, and the schedule is not reset to `now`; what a stall
    // may bank is capped, so a reader that paused is not answered with a burst.
    if (bps.shared !== null) {
      const now = performance.now();
      sharedNext = Math.max(sharedNext, now - MAX_CREDIT_MS) + (slice.length * 1000) / bps.shared;
      if (sharedNext > now) {
        // oxlint-disable-next-line no-await-in-loop
        await sleep(sharedNext - now);
      }
    } else if (bps.perConnection !== null) {
      next =
        Math.max(next, performance.now() - MAX_CREDIT_MS) +
        (slice.length * 1000) / bps.perConnection;
      const wait = next - performance.now();
      if (wait > 0) {
        // oxlint-disable-next-line no-await-in-loop
        await sleep(wait);
      }
    }
    if (response.destroyed) return;
    if (!response.write(slice)) {
      // oxlint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        const done = (): void => {
          response.off("drain", done);
          response.off("close", done);
          resolve();
        };
        response.once("drain", done);
        response.once("close", done);
      });
    }
  }
  if (!response.destroyed) response.end();
}

export async function startOrigin(): Promise<void> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dl98-"));
  // Six seconds at 8 Mb/s: about 4 MB, thirty-odd 128 KiB chunks.
  await generateBitrateProgressive(path.join(dir, "big"), 6, "8M");
  // The same samples in Matroska written as live: no duration anywhere in it,
  // so neither the probe nor ffmpeg can time it ("Duration: N/A" on 6.1.1 and 7.0.2).
  const mkv = path.join(dir, "big", "no-duration.mkv");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        path.join(dir, "big", "faststart.mp4"),
      ].concat(["-c", "copy", "-f", "matroska", "-live", "1", mkv]),
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  files = {
    "moov-end.mp4": await fs.readFile(path.join(dir, "big", "moov-end.mp4")),
    "faststart.mp4": await fs.readFile(path.join(dir, "big", "faststart.mp4")),
    "no-duration.mkv": await fs.readFile(mkv),
  };

  const handle = (request: http.IncomingMessage, response: http.ServerResponse): void => {
    const name = path.basename(new URL(request.url ?? "/", "http://x").pathname);
    const body = files[name];
    const range = request.headers.range;
    const fanOut = isFanOut(range);
    const refused = fanOut && behaviour.refuse !== null;
    seen.push({
      range,
      referer: request.headers.referer,
      cookie: request.headers.cookie,
      userAgent: request.headers["user-agent"],
      openAtArrival: open,
      refused,
      at: performance.now(),
    });
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    response.once("close", () => {
      open -= 1;
    });
    if (
      request.headers.referer !== CONTEXT.headers["Referer"] ||
      request.headers.cookie !== CONTEXT.headers["Cookie"]
    ) {
      response.writeHead(403).end("forbidden");
      return;
    }
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    const rates = { perConnection: behaviour.perConnectionBps, shared: behaviour.sharedBps };
    if (fanOut && behaviour.stallFirstFanOut) {
      behaviour.stallFirstFanOut = false;
      const [, from, to] = /^bytes=(\d+)-(\d+)$/u.exec(range ?? "") ?? [];
      response.writeHead(206, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-range": `bytes ${from}-${to}/${body.length}`,
        "content-length": String(Number(to) - Number(from) + 1),
      });
      response.flushHeaders();
      stalled.push(response);
      return;
    }
    if (refused) {
      switch (behaviour.refuse) {
        case "reset":
          request.socket.destroy();
          return;
        case "200":
          response.writeHead(200, {
            "content-type": "video/mp4",
            "content-length": String(body.length),
          });
          void send(response, body, rates);
          return;
        default:
          response.writeHead(Number(behaviour.refuse)).end();
          return;
      }
    }
    if (behaviour.sizeless) {
      response.writeHead(200, { "content-type": "video/mp4" });
      void send(response, body, rates);
      return;
    }
    const parsed = /^bytes=(\d+)-(\d*)$/u.exec(range ?? "");
    if (parsed === null) {
      response.writeHead(200, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-length": String(body.length),
      });
      void send(response, body, rates);
      return;
    }
    const start = Number(parsed[1]);
    const end = parsed[2] === "" ? body.length - 1 : Math.min(Number(parsed[2]), body.length - 1);
    if (start >= body.length) {
      response.writeHead(416, { "content-range": `bytes */${body.length}` }).end();
      return;
    }
    response.writeHead(206, {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${body.length}`,
      "content-length": String(end - start + 1),
    });
    void send(response, body.subarray(start, end + 1), rates);
  };
  origin = http.createServer((request, response) => {
    const range = request.headers.range;
    if (behaviour.relayHeaderDelayMs > 0 && range !== undefined && /^bytes=\d+-$/u.test(range)) {
      const delay = behaviour.relayHeaderDelayMs;
      behaviour.relayHeaderDelayMs = 0;
      setTimeout(() => handle(request, response), delay);
      return;
    }
    handle(request, response);
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originUrl = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
}

/** Closes this file's origin and removes its media. */
export async function stopOrigin(): Promise<void> {
  origin?.closeAllConnections();
  await new Promise<void>((resolve) =>
    origin === undefined ? resolve() : origin.close(() => resolve()),
  );
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Every feeder `feederFor` started, closed after each test whatever its outcome:
 * a failed assertion before a test's own `close` once left a feeder fetching
 * from the shared origin into the next test (gate 2's F11).
 */
const liveFeeders: RangeFeeder[] = [];

/** Polls `condition` until it holds, or fails with `describe()` after `ms`. */
export async function until(
  condition: () => boolean,
  ms: number,
  explain: () => string,
): Promise<void> {
  const deadline = performance.now() + ms;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`not within ${ms} ms: ${explain()}`);
    // oxlint-disable-next-line no-await-in-loop
    await sleep(10);
  }
}

/**
 * "Opens no more", counted and not timed (dl-106). `requestsAtStop` is what the
 * feeder had begun when it stopped, read before the stop closes it (ahead of
 * `abort()`, or in `onFatal`, which runs ahead of `close()`), so a request the
 * stop itself begins is counted against it. A fetch it had written to a socket in the
 * turn that stopped it reaches the origin a few ms later (3 ms, 1 run in 20 on
 * Linux) and is among that count; one opened afterwards, whenever it arrives, is
 * not, and neither the origin's tally nor the feeder's may exceed it. Call it
 * after the test has waited long enough for a late request to have landed.
 */
export function expectNothingOpenedSince(feeder: RangeFeeder, requestsAtStop: number): void {
  expect(feeder.stats().originRequests).toBe(requestsAtStop);
  expect(seen.length).toBeLessThanOrEqual(requestsAtStop);
}

/** Run after each test: closes what the test left open and clears the origin's counters. */
export function resetAfterEach(): void {
  for (const feeder of liveFeeders.splice(0)) feeder.close();
  for (const response of stalled.splice(0)) response.destroy();
  behaviour = { ...DEFAULT_BEHAVIOUR };
  resetCounts();
}

export function resetCounts(): void {
  seen = [];
  maxOpen = 0;
  sharedNext = 0;
}

export function variant(name: string, overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: name,
    protocol: "progressive",
    url: `${originUrl}/${name}`,
    container: "mp4",
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc1.42c01e",
    audioCodec: "mp4a.40.2",
    durationSec: 6,
    filesizeBytes: files[name]?.length,
    label: name,
    ...overrides,
  };
}

export function engineWith(overrides: EngineConfigInput = {}) {
  return createEngine({
    maxFileSizeBytes: 256 * 1024 * 1024,
    logger: NOOP_LOGGER,
    parallelRanges: FAST_SPLIT,
    ...overrides,
  });
}

export interface Ran {
  file: string;
  ms: number;
  bytes: number;
}

let runs = 0;

/** Streams one job to a file, the way a visitor's download would arrive, and times it. */
export async function run(
  engine: ReturnType<typeof engineWith>,
  source: MediaVariant,
): Promise<Ran> {
  const started = performance.now();
  const media: MediaStream = await engine.stream({
    jobId: `dl98-${runs}`,
    variant: source,
    requestContext: CONTEXT,
    title: "dl98",
  });
  const chunks: Buffer[] = [];
  media.body.on("data", (chunk: Buffer) => chunks.push(chunk));
  const outcome = await media.done;
  const ms = performance.now() - started;
  runs += 1;
  const file = path.join(dir, `out-${runs}.mp4`);
  await fs.writeFile(file, Buffer.concat(chunks));
  return { file, ms, bytes: outcome.bytes };
}

/** The fan-out's fetches the origin answered, and the most requests it had open at once. */
export function counted(): { fanOut: number; maxOpen: number; requests: number } {
  return {
    fanOut: seen.filter((entry) => isFanOut(entry.range)).length,
    maxOpen,
    requests: seen.length,
  };
}

const references = new Map<string, string[]>();

/** The media of `name` read the way it always was: one connection, ffmpeg straight to the origin. */
export async function reference(name: string): Promise<string[]> {
  const known = references.get(name);
  if (known !== undefined) return known;
  const saved = behaviour;
  behaviour = { ...DEFAULT_BEHAVIOUR };
  const ran = await run(engineWith({ singleConnectionHosts: ["127.0.0.1"] }), variant(name));
  behaviour = saved;
  resetCounts();
  const digests = await packetDigests(ran.file);
  references.set(name, digests);
  return digests;
}

export interface ProxyFixture {
  url: string;
  /** Absolute-form request targets, in order. */
  forwarded: string[];
  close(): Promise<void>;
}

/**
 * A forward proxy: absolute-form `GET`s are fetched from their target and
 * handed back, marked so the origin can tell they came this way; a `CONNECT`
 * is refused with `connectRefusal`, the status line the guarded proxy sends
 * for an origin certificate it would not verify (dl-27).
 */
export async function startProxy(connectRefusal: string): Promise<ProxyFixture> {
  const forwarded: string[] = [];
  const server = http.createServer((request, response) => {
    const target = request.url ?? "";
    forwarded.push(target);
    const options = {
      method: request.method,
      headers: { ...request.headers, "x-fixture-proxy": "1" },
      agent: false,
    };
    const onAnswer = (answer: http.IncomingMessage): void => {
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.headers);
      answer.pipe(response);
      response.once("close", () => answer.destroy());
    };
    // js/request-forgery, excused under docs/adr/005 by category, in
    // tools/downloader/engine/test/parallel-ranges.test.ts, 2026-10-11, with
    // the owner's excusal recorded in dl-98's Log: this is a test double, a
    // forward proxy on 127.0.0.1 that lives for one test and forwards whatever
    // absolute-form target that test sent it, so the request's URL is the
    // test's by design. It never ships, and no visitor reaches it. Field five
    // has no production design behind it to regress: what goes red if the
    // fixture stops forwarding is "every fetch, relayed and ranged, goes through
    // the proxy with the replayed headers" in this file. The call is on one line
    // because the suppression covers exactly the line after the comment.
    // codeql[js/request-forgery]
    const upstream = http.request(target, options, onAnswer);
    upstream.on("error", () => response.destroy());
    response.once("close", () => upstream.destroy());
    upstream.end();
  });
  server.on("connect", (_request, socket: Socket) => {
    socket.end(`HTTP/1.1 ${connectRefusal}\r\n\r\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    forwarded,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface FeederRun {
  feeder: RangeFeeder;
  fatal: AppError[];
  refused: { host: string; kind: RefusalKind }[];
}

export async function feederFor(
  name: string,
  overrides: Partial<Parameters<typeof RangeFeeder.start>[0]> = {},
): Promise<FeederRun> {
  const fatal: AppError[] = [];
  const refused: { host: string; kind: RefusalKind }[] = [];
  const feeder = await RangeFeeder.start({
    url: `${originUrl}/${name}`,
    requestContext: CONTEXT,
    route: { kind: "direct" },
    tlsVerify: true,
    tlsCaFile: undefined,
    settings: { ...PARALLEL_RANGE_DEFAULTS, ...FAST_SPLIT },
    sizeHint: null,
    // A media rate no origin here reaches: every run that is timed splits.
    durationSec: () => 0.001,
    maxBytes: 0,
    logger: NOOP_LOGGER,
    jobId: "dl98-feeder",
    onRefused: (host, kind) => refused.push({ host, kind }),
    onFatal: (error) => fatal.push(error),
    ...overrides,
  });
  liveFeeders.push(feeder);
  return { feeder, fatal, refused };
}

export interface Read {
  status: number;
  statusMessage: string;
  body: Buffer;
  complete: boolean;
}

/**
 * Reads the loopback as ffmpeg would, with `Range: bytes=<start>-`. `pauseAt`
 * stops reading after that many bytes for `pauseMs`, as ffmpeg does when the
 * visitor stops reading; `onPaused` runs at the end of the pause.
 */
export function readLoopback(
  url: string,
  options: {
    pauseAt?: number;
    pauseMs?: number;
    onPaused?: () => void;
    range?: string | null;
  } = {},
): Promise<Read> {
  const range = options.range === undefined ? "bytes=0-" : options.range;
  const headers = range === null ? {} : { range };
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let paused = false;
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        received += chunk.length;
        if (!paused && options.pauseAt !== undefined && received >= options.pauseAt) {
          paused = true;
          response.pause();
          setTimeout(() => {
            options.onPaused?.();
            response.resume();
          }, options.pauseMs ?? 0);
        }
      });
      const finish = (): void =>
        resolve({
          status: response.statusCode ?? 0,
          statusMessage: response.statusMessage ?? "",
          body: Buffer.concat(chunks),
          complete: response.complete,
        });
      response.once("end", finish);
      response.once("close", () => {
        if (!response.complete) finish();
      });
    });
    request.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") {
        resolve({ status: 0, statusMessage: "", body: Buffer.alloc(0), complete: false });
      } else reject(error);
    });
  });
}

/** `run`, keeping the `originConnections` of every progress snapshot the job reported (dl-108). */
export async function runSampling(
  engine: ReturnType<typeof engineWith>,
  source: MediaVariant,
): Promise<(number | null)[]> {
  const samples: (number | null)[] = [];
  runs += 1;
  const media: MediaStream = await engine.stream({
    jobId: `dl108-${runs}`,
    variant: source,
    requestContext: CONTEXT,
    title: "dl108",
    onProgress: (progress) => samples.push(progress.originConnections),
  });
  media.body.resume();
  await media.done;
  return samples;
}
