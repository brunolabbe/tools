/**
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
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { AppError } from "@downloader/contract";
import type { MediaVariant, RequestContext } from "@downloader/contract";
import type { EngineConfigInput } from "../src/config.ts";
import { loadEngineConfig } from "../src/config.ts";
import type { FeederStats, RefusalKind } from "../src/download/parallel-ranges.ts";
import {
  hostListed,
  PARALLEL_RANGE_DEFAULTS,
  RangeFeeder,
} from "../src/download/parallel-ranges.ts";
import { createEngine } from "../src/index.ts";
import type { MediaStream } from "../src/index.ts";
import { NOOP_LOGGER } from "../src/logger.ts";
import { FFMPEG, generateBitrateProgressive, packetDigests } from "./helpers/media.ts";

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://player.example/watch/98",
    "User-Agent": "Mozilla/5.0 (FixtureBrowser)",
    Cookie: "cdn_token=s3cr3t98",
  },
};

/** Real ffmpeg on throttled transfers of a few megabytes. */
const SLOW = 120_000;

/** A small chunk and a short window, so a few megabytes split into many chunks quickly. */
const FAST_SPLIT = { chunkBytes: 128 * 1024, measureMs: 200 } as const;

type Refusal = "429" | "403" | "503" | "reset" | "200";

interface Behaviour {
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
}

interface Seen {
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
};
let behaviour: Behaviour = { ...DEFAULT_BEHAVIOUR };
let seen: Seen[] = [];
let open = 0;
let maxOpen = 0;
/** For the shared throttle: when the next slice may go, for any connection. */
let sharedNext = 0;

let dir: string;
let files: Record<string, Buffer>;
let origin: http.Server;
let originUrl: string;

/** A response the fixture holds open and silent; ended in `afterEach`. */
const stalled: http.ServerResponse[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A closed range other than the probe's: a fetch the fan-out opened. */
function isFanOut(range: string | undefined): boolean {
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
    if (bps.shared !== null) {
      const now = performance.now();
      sharedNext = Math.max(sharedNext, now) + (slice.length * 1000) / bps.shared;
      // oxlint-disable-next-line no-await-in-loop
      await sleep(Math.max(0, sharedNext - now));
    } else if (bps.perConnection !== null) {
      next += (slice.length * 1000) / bps.perConnection;
      // oxlint-disable-next-line no-await-in-loop
      await sleep(Math.max(0, next - performance.now()));
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

beforeAll(async () => {
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

  origin = http.createServer((request, response) => {
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
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originUrl = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
}, SLOW);

afterAll(async () => {
  origin?.closeAllConnections();
  await new Promise<void>((resolve) =>
    origin === undefined ? resolve() : origin.close(() => resolve()),
  );
  await fs.rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const response of stalled.splice(0)) response.destroy();
  behaviour = { ...DEFAULT_BEHAVIOUR };
  resetCounts();
});

function resetCounts(): void {
  seen = [];
  maxOpen = 0;
  sharedNext = 0;
}

function variant(name: string, overrides: Partial<MediaVariant> = {}): MediaVariant {
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

function engineWith(overrides: EngineConfigInput = {}) {
  return createEngine({
    maxFileSizeBytes: 256 * 1024 * 1024,
    logger: NOOP_LOGGER,
    parallelRanges: FAST_SPLIT,
    ...overrides,
  });
}

interface Ran {
  file: string;
  ms: number;
  bytes: number;
}

let runs = 0;

/** Streams one job to a file, the way a visitor's download would arrive, and times it. */
async function run(engine: ReturnType<typeof engineWith>, source: MediaVariant): Promise<Ran> {
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
function counted(): { fanOut: number; maxOpen: number; requests: number } {
  return {
    fanOut: seen.filter((entry) => isFanOut(entry.range)).length,
    maxOpen,
    requests: seen.length,
  };
}

const references = new Map<string, string[]>();

/** The media of `name` read the way it always was: one connection, ffmpeg straight to the origin. */
async function reference(name: string): Promise<string[]> {
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

describe("dl-98: a progressive source throttled per connection", () => {
  test(
    "a job that measures slow switches to 4 connections and finishes at least 3x faster",
    async () => {
      // 500 KB/s a connection against a media rate of about 690 KB/s: slow on one.
      behaviour.perConnectionBps = 500_000;
      const source = variant("moov-end.mp4");

      // The baseline is the production single-connection path: an opted-out host.
      const single = await run(engineWith({ singleConnectionHosts: ["127.0.0.1"] }), source);
      const singleCount = counted();
      resetCounts();

      const split = await run(engineWith(), source);
      const splitCount = counted();
      const timing = JSON.stringify({ singleMs: single.ms, splitMs: split.ms });

      expect(singleCount.fanOut).toBe(0);
      expect(splitCount.fanOut).toBeGreaterThan(4);
      // Four connections at once, and never a fifth.
      expect(splitCount.maxOpen).toBe(4);
      // Every one of them replayed the captured context.
      for (const entry of seen) {
        expect(entry.referer).toBe(CONTEXT.headers["Referer"]);
        expect(entry.cookie).toBe(CONTEXT.headers["Cookie"]);
        expect(entry.userAgent).toBe(CONTEXT.headers["User-Agent"]);
      }
      expect(single.ms / split.ms, timing).toBeGreaterThanOrEqual(3);
      expect(await packetDigests(split.file)).toEqual(await packetDigests(single.file));
    },
    SLOW,
  );

  test(
    "control: the speed-up is not remembered against the host, so the next job splits again",
    async () => {
      behaviour.perConnectionBps = 2_000_000;
      const engine = engineWith();
      // Declared short, so 2 MB/s is slow against it: about 8 MB/s of media.
      const source = variant("faststart.mp4", { durationSec: 0.5 });
      await run(engine, source);
      expect(counted().fanOut).toBeGreaterThan(0);
      resetCounts();
      await run(engine, source);
      expect(counted().fanOut).toBeGreaterThan(0);
    },
    SLOW,
  );

  test(
    "a fast origin stays on exactly one connection, counted at the fixture",
    async () => {
      // 4 MB/s against about 690 KB/s of media: judged fast after the window, and kept.
      behaviour.perConnectionBps = 4_000_000;
      await run(engineWith(), variant("faststart.mp4"));
      // The seek probe, then ffmpeg's one read through the relay.
      expect(counted()).toEqual({ fanOut: 0, maxOpen: 1, requests: 2 });
    },
    SLOW,
  );

  test(
    "a source of unknown size stays on one connection; control: ranged, so sized, it splits",
    async () => {
      // An origin that honours `Range` states the size in every `206`, so the
      // size is unknown only from one that does not; that one is never split.
      behaviour.perConnectionBps = 1_000_000;
      behaviour.sizeless = true;
      const source = variant("faststart.mp4", { durationSec: 0.5, filesizeBytes: undefined });
      await run(engineWith(), source);
      expect(counted()).toEqual({ fanOut: 0, maxOpen: 1, requests: 2 });
      resetCounts();

      behaviour.sizeless = false;
      await run(engineWith(), source);
      expect(counted().fanOut).toBeGreaterThan(0);
    },
    SLOW,
  );

  test(
    "a source of unknown duration stays on one connection; control: told its duration, it splits",
    async () => {
      behaviour.perConnectionBps = 1_000_000;
      const untimed = variant("no-duration.mkv", { container: "mkv", durationSec: undefined });
      const ran = await run(engineWith(), untimed);
      expect(counted()).toEqual({ fanOut: 0, maxOpen: 1, requests: 2 });
      expect(ran.bytes).toBeGreaterThan(1_000_000);
      resetCounts();

      await run(engineWith(), { ...untimed, durationSec: 0.5 });
      expect(counted().fanOut).toBeGreaterThan(0);
    },
    SLOW,
  );

  test(
    "an opted-out host stays on one connection, a subdomain of it too",
    async () => {
      behaviour.perConnectionBps = 1_000_000;
      const source = variant("faststart.mp4", { durationSec: 0.5 });
      await run(engineWith({ singleConnectionHosts: ["127.0.0.1"] }), source);
      expect(counted()).toEqual({ fanOut: 0, maxOpen: 1, requests: 2 });
      expect(hostListed("cdn.example.com", ["example.com"])).toBe(true);
      expect(hostListed("CDN.Example.com", [" .example.com "])).toBe(true);
      expect(hostListed("notexample.com", ["example.com"])).toBe(false);
      expect(hostListed("[::1]", ["::1"])).toBe(true);
    },
    SLOW,
  );

  test.each(["faststart.mp4", "moov-end.mp4"])(
    "the output of a split %s is identical in media to a single-connection run",
    async (name) => {
      const expected = await reference(name);
      behaviour.perConnectionBps = 2_000_000;
      const ran = await run(engineWith(), variant(name, { durationSec: 0.5 }));
      expect(counted().fanOut).toBeGreaterThan(4);
      const digests = await packetDigests(ran.file);
      expect(digests.length).toBeGreaterThan(100);
      expect(digests).toEqual(expected);
    },
    SLOW,
  );
});

describe("dl-98: a host that refuses parallel ranges", () => {
  const kinds: { kind: string; set: (b: Behaviour) => void }[] = [
    { kind: "a 429", set: (b) => (b.refuse = "429") },
    { kind: "a 403", set: (b) => (b.refuse = "403") },
    { kind: "a 503", set: (b) => (b.refuse = "503") },
    { kind: "a reset", set: (b) => (b.refuse = "reset") },
    { kind: "a 200 to a range request", set: (b) => (b.refuse = "200") },
    {
      kind: "no speed-up at 4 (a per-client throttle)",
      set: (b) => {
        b.perConnectionBps = null;
        b.sharedBps = 2_000_000;
      },
    },
  ];

  test.each(kinds)(
    "$kind: the job completes on one connection, identical in media, and the next job opens one",
    async ({ set }) => {
      const expected = await reference("faststart.mp4");
      behaviour.perConnectionBps = 2_000_000;
      set(behaviour);
      const engine = engineWith();
      const source = variant("faststart.mp4", { durationSec: 0.5 });

      const first = await run(engine, source);
      expect(await packetDigests(first.file)).toEqual(expected);
      const fanOut = seen.filter((entry) => isFanOut(entry.range));
      expect(fanOut.length).toBeGreaterThan(0);
      // After the fan-out stopped, one open-ended request carried the rest.
      const lastFanOut = Math.max(...fanOut.map((entry) => entry.at));
      const after = seen.filter((entry) => entry.at > lastFanOut);
      expect(after.length).toBeGreaterThan(0);
      for (const entry of after) expect(entry.range).toMatch(/^bytes=\d+-$/u);
      if (behaviour.refuse !== null) expect(seen.some((entry) => entry.refused)).toBe(true);
      resetCounts();

      // The host is remembered: the second job never opens a second connection.
      const second = await run(engine, source);
      expect(counted()).toEqual({ fanOut: 0, maxOpen: 1, requests: 2 });
      expect(await packetDigests(second.file)).toEqual(expected);
    },
    SLOW,
  );
});

describe("dl-98: cancelling a split job", () => {
  test(
    "a cancel after the first byte closes every origin connection and opens no more",
    async () => {
      behaviour.perConnectionBps = 500_000;
      const controller = new AbortController();
      const media = await engineWith().stream({
        jobId: "dl98-cancel",
        variant: variant("faststart.mp4"),
        requestContext: CONTEXT,
        signal: controller.signal,
      });
      media.body.resume();
      // Past the 200 ms window: split, with four fetches open.
      await sleep(700);
      expect(maxOpen).toBe(4);
      controller.abort();
      const canceledAt = performance.now();
      await expect(media.done).rejects.toMatchObject({ code: "JOB_CANCELED" });
      await sleep(500);
      expect(open).toBe(0);
      expect(seen.filter((entry) => entry.at > canceledAt)).toEqual([]);
    },
    SLOW,
  );
});

interface ProxyFixture {
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
async function startProxy(connectRefusal: string): Promise<ProxyFixture> {
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

interface FeederRun {
  feeder: RangeFeeder;
  fatal: AppError[];
  refused: { host: string; kind: RefusalKind }[];
}

async function feederFor(
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
  return { feeder, fatal, refused };
}

interface Read {
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
function readLoopback(
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

describe("dl-98: the feeder's own limits", () => {
  test(
    "bytes held ahead never exceed 4 x 4 MB, measured at the defaults with ffmpeg not reading",
    async () => {
      // 40 MB of bytes that differ, so a misplaced chunk cannot compare equal.
      const body = Buffer.alloc(40 * 1024 * 1024);
      for (let index = 0; index < body.length; index += 4) body.writeUInt32BE(index, index);
      files["forty.bin"] = body;
      behaviour.perConnectionBps = 40_000_000;
      const { feeder } = await feederFor("forty.bin", {
        // The owner's 4 connections of 4 MB, and only the window shortened.
        settings: { ...PARALLEL_RANGE_DEFAULTS, measureMs: 50 },
      });
      let heldWhilePaused: FeederStats | null = null;
      const read = await readLoopback(feeder.url, {
        pauseAt: 2 * 1024 * 1024,
        pauseMs: 1500,
        onPaused: () => {
          heldWhilePaused = feeder.stats();
        },
      });
      const stats = feeder.stats();
      feeder.close();

      expect(read.complete).toBe(true);
      expect(read.body.equals(body)).toBe(true);
      expect(stats.mode).toBe("parallel");
      expect(stats.maxConcurrentFetches).toBe(4);
      expect(stats.maxHeldBytes).toBeLessThanOrEqual(4 * 4 * 1024 * 1024);
      // The bound was reached, not merely respected by a reader too fast to fill it.
      expect((heldWhilePaused as FeederStats | null)?.maxHeldBytes).toBeGreaterThanOrEqual(
        3 * 4 * 1024 * 1024,
      );
    },
    SLOW,
  );

  test(
    "the size cap counts reassembled bytes, relayed and fetched, and stops every fetch",
    async () => {
      behaviour.perConnectionBps = 4_000_000;
      const limit = 1024 * 1024;
      const { feeder, fatal } = await feederFor("moov-end.mp4", { maxBytes: limit });
      const read = await readLoopback(feeder.url);
      const stoppedAt = performance.now();
      const stats = feeder.stats();
      await sleep(300);

      expect(fatal).toHaveLength(1);
      expect(fatal[0]?.code).toBe("SIZE_LIMIT_EXCEEDED");
      expect(read.complete).toBe(false);
      expect(read.body.length).toBeLessThanOrEqual(limit);
      // Split before the cap: the fan-out's bytes were counted as well as the relay's.
      expect(stats.mode).toBe("parallel");
      expect(stats.deliveredBytes).toBeGreaterThan(limit);
      expect(open).toBe(0);
      expect(seen.filter((entry) => entry.at > stoppedAt)).toEqual([]);
    },
    SLOW,
  );

  test(
    "a cancel stops the relay and every ranged fetch, and nothing is fetched after it",
    async () => {
      behaviour.perConnectionBps = 1_000_000;
      const controller = new AbortController();
      const { feeder } = await feederFor("moov-end.mp4", { signal: controller.signal });
      const reading = readLoopback(feeder.url);
      await sleep(500);
      expect(feeder.stats().mode).toBe("parallel");
      expect(open).toBe(4);
      controller.abort();
      const canceledAt = performance.now();
      const read = await reading;
      await sleep(300);

      expect(read.complete).toBe(false);
      expect(open).toBe(0);
      expect(seen.filter((entry) => entry.at > canceledAt)).toEqual([]);
    },
    SLOW,
  );

  test(
    "every fetch, relayed and ranged, goes through the proxy with the replayed headers",
    async () => {
      behaviour.perConnectionBps = 2_000_000;
      const proxy = await startProxy("502 Bad Gateway");
      try {
        const { feeder } = await feederFor("moov-end.mp4", {
          route: { kind: "proxy", url: new URL(proxy.url) },
        });
        const read = await readLoopback(feeder.url);
        feeder.close();
        expect(read.body.equals(files["moov-end.mp4"] as Buffer)).toBe(true);
        expect(feeder.stats().mode).toBe("parallel");
        expect(seen.filter((entry) => isFanOut(entry.range)).length).toBeGreaterThan(4);
        // Each request the origin saw came through the proxy, in absolute form.
        expect(proxy.forwarded).toHaveLength(seen.length);
        for (const target of proxy.forwarded) expect(target).toBe(`${originUrl}/moov-end.mp4`);
        for (const entry of seen) {
          expect(entry.referer).toBe(CONTEXT.headers["Referer"]);
          expect(entry.cookie).toBe(CONTEXT.headers["Cookie"]);
        }
      } finally {
        await proxy.close();
      }
    },
    SLOW,
  );

  test("a proxy's refusal reaches ffmpeg in the proxy's own words, and nothing goes around it", async () => {
    const refusal = "502 TLS certificate verification failed (CERT_HAS_EXPIRED)";
    const proxy = await startProxy(refusal);
    try {
      const { feeder } = await feederFor("moov-end.mp4", {
        url: `https://127.0.0.1:${new URL(originUrl).port}/moov-end.mp4`,
        route: { kind: "proxy", url: new URL(proxy.url) },
      });
      const read = await readLoopback(feeder.url);
      feeder.close();
      // What ffmpeg logs as `HTTP error 502 …`, which the runner reads as a
      // certificate failure, as it did from the proxy's own answer.
      expect(`${read.status} ${read.statusMessage}`).toBe(refusal);
      expect(seen).toEqual([]);
    } finally {
      await proxy.close();
    }
  });

  test("the loopback answers its own path only, and only GET", async () => {
    const { feeder } = await feederFor("moov-end.mp4");
    try {
      const other = new URL(feeder.url);
      other.pathname = "/elsewhere";
      expect((await readLoopback(other.href)).status).toBe(404);
      const posted = await new Promise<number>((resolve) => {
        const request = http.request(feeder.url, { method: "POST", agent: false }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.end();
      });
      expect(posted).toBe(405);
      expect(new URL(feeder.url).hostname).toBe("127.0.0.1");
      expect(seen).toEqual([]);
    } finally {
      feeder.close();
    }
  });
});

describe("dl-98: ffmpeg reads the loopback, and only the feeder meets the proxy", () => {
  test(
    "with the egress proxy configured, ffmpeg's own request never reaches it",
    async () => {
      behaviour.perConnectionBps = 2_000_000;
      const proxy = await startProxy("502 Bad Gateway");
      try {
        const ran = await run(
          engineWith({ proxyUrl: proxy.url }),
          variant("moov-end.mp4", { durationSec: 0.5 }),
        );
        expect(counted().fanOut).toBeGreaterThan(4);
        expect(await packetDigests(ran.file)).toEqual(await reference("moov-end.mp4"));
        // The probe and every fetch, and nothing else: no loopback address.
        expect(proxy.forwarded.length).toBeGreaterThan(5);
        for (const target of proxy.forwarded) expect(target).toBe(`${originUrl}/moov-end.mp4`);
      } finally {
        await proxy.close();
      }
    },
    SLOW,
  );
});

describe("dl-98: a fallback and a relay it cannot resume", () => {
  test(
    "a second read relaying a whole-file 200 is left to finish when the split falls back",
    async () => {
      // ffmpeg can hold two loopback connections at once (a seek opens the new
      // one before it closes the old). Here the second asked for no range, so
      // its relay is a `200` of unknown end, which no continuation could resume.
      behaviour.perConnectionBps = 2_000_000;
      behaviour.refuse = "429";
      const { feeder } = await feederFor("moov-end.mp4");
      const whole = readLoopback(feeder.url, { range: null });
      const ranged = readLoopback(feeder.url);
      const [first, second] = await Promise.all([whole, ranged]);
      const stats = feeder.stats();
      feeder.close();

      expect(stats.refusal?.kind).toBe("status");
      expect(first.status).toBe(200);
      expect(first.complete).toBe(true);
      expect(first.body.equals(files["moov-end.mp4"] as Buffer)).toBe(true);
      expect(second.complete).toBe(true);
      expect(second.body.equals(files["moov-end.mp4"] as Buffer)).toBe(true);
    },
    SLOW,
  );
});

/**
 * A raw origin for answers `http.ServerResponse` will not write: it answers the
 * seek probe honestly and every other request with `answer`, then closes.
 */
async function startRawOrigin(
  answer: string,
  holdOpen = false,
): Promise<{ url: string; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    let head = "";
    socket.on("data", (data: Buffer) => {
      head += data.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      if (/range: bytes=1-1\r\n/iu.test(head)) {
        socket.end(
          "HTTP/1.1 206 Partial Content\r\ncontent-range: bytes 1-1/5000000\r\ncontent-length: 1\r\n\r\nx",
        );
      } else if (holdOpen) socket.write(answer);
      else socket.end(answer);
      head = "";
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/clip.mp4`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("dl-98 round 1: what gate 1 found", () => {
  test.each([
    ["status 099", "HTTP/1.1 099 Odd\r\ncontent-length: 0\r\n\r\n", 502, "Bad Gateway"],
    ["status 000", "HTTP/1.1 000 Zero\r\ncontent-length: 0\r\n\r\n", 502, "Bad Gateway"],
    [
      "a control character in the reason phrase",
      "HTTP/1.1 404 Not\x01Found\r\ncontent-length: 0\r\n\r\n",
      404,
      "",
    ],
  ])(
    "F1: an origin answering with %s is told to ffmpeg as a status, and the process lives",
    async (_name, answer, status, message) => {
      const raw = await startRawOrigin(answer);
      try {
        const { feeder } = await feederFor("unused", { url: raw.url });
        const read = await readLoopback(feeder.url);
        feeder.close();
        // Before the fix, `writeHead` threw inside an unobserved `.then`: an
        // unhandled rejection, which vitest fails the run on, and the API dies of.
        expect(`${read.status} ${read.statusMessage}`).toBe(`${status} ${message}`);
      } finally {
        await raw.close();
      }
    },
  );

  test("F1: a 101 the client never hands back is ended by the idle bound, as a timeout", async () => {
    const raw = await startRawOrigin(
      "HTTP/1.1 101 Switching Protocols\r\nupgrade: x\r\nconnection: upgrade\r\n\r\n",
      true,
    );
    try {
      const { feeder } = await feederFor("unused", {
        url: raw.url,
        settings: { ...PARALLEL_RANGE_DEFAULTS, ...FAST_SPLIT, idleMs: 300 },
      });
      const started = performance.now();
      const read = await readLoopback(feeder.url);
      feeder.close();
      expect(`${read.status} ${read.statusMessage}`).toBe("504 Connection timed out");
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      await raw.close();
    }
  });

  test("F7: a request target the loopback cannot parse is a 404, not a crash", async () => {
    const { feeder } = await feederFor("moov-end.mp4");
    try {
      const reply = await new Promise<string>((resolve) => {
        const socket = net.connect(Number(new URL(feeder.url).port), "127.0.0.1", () => {
          socket.write("GET //[ HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n");
        });
        let got = "";
        socket.on("data", (data: Buffer) => (got += data.toString("latin1")));
        socket.on("close", () => resolve(got.split("\r\n")[0] ?? ""));
        socket.on("error", () => resolve("socket error"));
      });
      expect(reply).toBe("HTTP/1.1 404 Not Found");
    } finally {
      feeder.close();
    }
  });

  test(
    "F2: a second request is answered at once while the first, split, is not being read",
    async () => {
      // ffmpeg's seek: a new connection opened before the old one is closed.
      const body = Buffer.alloc(48 * 1024 * 1024);
      for (let index = 0; index < body.length; index += 4) body.writeUInt32BE(index, index);
      files["forty-eight.bin"] = body;
      behaviour.perConnectionBps = 20_000_000;
      const { feeder } = await feederFor("forty-eight.bin", {
        settings: { ...PARALLEL_RANGE_DEFAULTS, chunkBytes: 2 * 1024 * 1024, measureMs: 100 },
      });
      const first = await new Promise<http.IncomingMessage>((resolve) => {
        http.get(feeder.url, { headers: { range: "bytes=0-" }, agent: false }, resolve);
      });
      let read = 0;
      first.on("data", (chunk: Buffer) => {
        read += chunk.length;
        if (read >= 8 * 1024 * 1024) first.pause();
      });
      await sleep(2_500);
      expect(feeder.stats().mode).toBe("parallel");

      const seekTo = Math.floor(body.length * 0.8);
      const started = performance.now();
      const second = await new Promise<{ status: number; firstByteMs: number; bytes: Buffer }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("no answer within 10 s")), 10_000);
          http
            .get(
              feeder.url,
              { headers: { range: `bytes=${seekTo}-` }, agent: false },
              (response) => {
                const chunks: Buffer[] = [];
                let firstByteMs = -1;
                response.on("data", (chunk: Buffer) => {
                  if (firstByteMs < 0) firstByteMs = performance.now() - started;
                  chunks.push(chunk);
                });
                response.once("end", () => {
                  clearTimeout(timer);
                  resolve({
                    status: response.statusCode ?? 0,
                    firstByteMs,
                    bytes: Buffer.concat(chunks),
                  });
                });
              },
            )
            .on("error", reject);
        },
      );
      first.destroy();
      const stats = feeder.stats();
      feeder.close();

      expect(second.status).toBe(206);
      expect(second.firstByteMs).toBeLessThan(2_000);
      expect(second.bytes.equals(body.subarray(seekTo))).toBe(true);
      expect(stats.maxHeldBytes).toBeLessThanOrEqual(4 * 2 * 1024 * 1024);
    },
    SLOW,
  );

  test(
    "F2: a fan-out fetch that sends its headers and then nothing falls back, and the job completes",
    async () => {
      const expected = await reference("faststart.mp4");
      behaviour.perConnectionBps = 2_000_000;
      behaviour.stallFirstFanOut = true;
      const started = performance.now();
      const ran = await run(
        engineWith({ parallelRanges: { ...FAST_SPLIT, idleMs: 500 } }),
        variant("faststart.mp4", { durationSec: 0.5 }),
      );
      // Before the fix it waited on ffmpeg's 30 s read timeout, then on a
      // reconnect the slots starved: TIMEOUT at the stage limit.
      expect(performance.now() - started).toBeLessThan(15_000);
      expect(stalled).toHaveLength(1);
      expect(await packetDigests(ran.file)).toEqual(expected);
    },
    SLOW,
  );

  test.each([64 * 1024, 128 * 1024])(
    "F3: an origin that writes %i bytes at a time is measured, and splits",
    async (slice) => {
      // 2 MB/s a connection against about 8 MB/s of media. With 64 KiB writes
      // every chunk filled the loopback's write buffer, the pause discarded the
      // interval, and the meter never reached its window: no split.
      behaviour.perConnectionBps = 2_000_000;
      behaviour.slice = slice;
      await run(engineWith(), variant("moov-end.mp4", { durationSec: 0.5 }));
      expect(counted().fanOut).toBeGreaterThan(4);
    },
    SLOW,
  );

  test(
    "F4: a source the probe could not time, but ffmpeg can, is split (the owner's reading of Decision 3)",
    async () => {
      // dl-96's shape: the size known, the duration not. ffmpeg's own Duration
      // line times it; with the duration taken from the probe alone this stays
      // on one connection.
      behaviour.perConnectionBps = 300_000;
      await run(engineWith(), variant("moov-end.mp4", { durationSec: undefined }));
      expect(counted().fanOut).toBeGreaterThan(4);
    },
    SLOW,
  );

  test("F5: SINGLE_CONNECTION_HOSTS reaches the engine's config from the environment", () => {
    const config = loadEngineConfig(
      { ffmpegPath: "ffmpeg" },
      { SINGLE_CONNECTION_HOSTS: " cdn.example.com, .other.org ,, " },
    );
    expect(config.singleConnectionHosts).toEqual(["cdn.example.com", ".other.org"]);
    expect(loadEngineConfig({ ffmpegPath: "ffmpeg" }, {}).singleConnectionHosts).toEqual([]);
  });
});
