/**
 * dl-98: a host that refuses parallel ranges, a fallback, and what gate 1 found
 * (split from parallel-ranges.test.ts, dl-129; the fixture is
 * `helpers/parallel-ranges-fixture.ts`).
 */

import http from "node:http";
import net from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { loadEngineConfig } from "../src/config.ts";
import { PARALLEL_RANGE_DEFAULTS } from "../src/download/parallel-ranges.ts";
import { packetDigests } from "./helpers/media.ts";
import {
  behaviour,
  counted,
  engineWith,
  FAST_SPLIT,
  feederFor,
  files,
  isFanOut,
  readLoopback,
  reference,
  resetAfterEach,
  resetCounts,
  run,
  seen,
  SLOW,
  SLOW_AGAINST_HALF_A_SECOND,
  stalled,
  startOrigin,
  stopOrigin,
  until,
  variant,
} from "./helpers/parallel-ranges-fixture.ts";
import type { Behaviour } from "./helpers/parallel-ranges-fixture.ts";

beforeAll(startOrigin, SLOW);

afterAll(stopOrigin);

afterEach(resetAfterEach);

describe("dl-98: a host that refuses parallel ranges", () => {
  const kinds: { kind: string; set: (b: Behaviour) => void }[] = [
    // 403 and 503 are in dl-98's Decision 5 beside 429 and go through the same
    // `REFUSAL_STATUSES` check, so their rows were replaced by the unit test
    // below, on the owner's answer of 2026-10-12 (dl-112): 429 stays the
    // end-to-end row for the set.
    { kind: "a 429", set: (b) => (b.refuse = "429") },
    { kind: "a reset", set: (b) => (b.refuse = "reset") },
    { kind: "a 200 to a range request", set: (b) => (b.refuse = "200") },
    {
      kind: "no speed-up at 4 (a per-client throttle)",
      set: (b) => {
        b.perConnectionBps = null;
        b.sharedBps = SLOW_AGAINST_HALF_A_SECOND;
      },
    },
  ];

  test.each(kinds)(
    "$kind: the job completes on one connection, identical in media, and the next job opens one",
    async ({ set }) => {
      const expected = await reference("faststart.mp4");
      behaviour.perConnectionBps = SLOW_AGAINST_HALF_A_SECOND;
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

  // Each status Decision 5 names is remembered as a refusal, at the feeder, where
  // `onRefused` is called with the kind. The set is `REFUSAL_STATUSES`; a status
  // removed from it is a row that goes red here. The end-to-end rows above
  // keep 429, the one that proves the fallback and the memory for the set.
  test.each(["403", "429", "503"] as const)(
    "a %s on a fan-out fetch is reported to onRefused as a status refusal",
    async (status) => {
      behaviour.perConnectionBps = SLOW_AGAINST_HALF_A_SECOND;
      behaviour.refuse = status;
      const { feeder, fatal, refused } = await feederFor("faststart.mp4");
      // The loopback is read the way ffmpeg reads it: without a reader nothing
      // is fetched. Closing the feeder ends the read, so it is not awaited to the end.
      const read = readLoopback(feeder.url);
      await until(
        () => refused.length > 0,
        5_000,
        () => `no refusal reported; origin saw ${JSON.stringify(seen.map((entry) => entry.range))}`,
      );
      feeder.close();
      await read;

      expect(refused).toEqual([{ host: "127.0.0.1", kind: "status" }]);
      expect(fatal).toEqual([]);
      expect(seen.some((entry) => entry.refused)).toBe(true);
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
): Promise<{ url: string; open(): number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
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
    open: () => sockets.size,
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

  test("F1: a 101 on a relay is left to ffmpeg's own timeout, and going away closes it", async () => {
    const raw = await startRawOrigin(
      "HTTP/1.1 101 Switching Protocols\r\nupgrade: x\r\nconnection: upgrade\r\n\r\n",
      true,
    );
    try {
      // The owner's answer to gate 2's F10: the idle bound is the chunk fetches'
      // alone, and a relay's wait is ffmpeg's own 30 s, as it is without the feeder.
      const { feeder } = await feederFor("unused", {
        url: raw.url,
        settings: { ...PARALLEL_RANGE_DEFAULTS, ...FAST_SPLIT, idleMs: 300 },
      });
      const outcome = await new Promise<string>((resolve) => {
        const request = http.get(
          feeder.url,
          { headers: { range: "bytes=0-" }, agent: false },
          (response) => resolve(`answered ${response.statusCode ?? 0}`),
        );
        request.on("error", () => resolve("gave up"));
        // ffmpeg's read timeout, shortened: the reader goes away.
        setTimeout(() => request.destroy(), 1_000);
      });
      expect(outcome).toBe("gave up");
      // And its going away is what closes the origin's connection.
      await until(
        () => raw.open() === 0,
        2_000,
        () => `origin sockets open: ${raw.open()}`,
      );
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
      const chunkSize = 2 * 1024 * 1024;
      const { feeder } = await feederFor("forty-eight.bin", {
        // The speed-up judge is not what this tests, and its 100 ms window is
        // the one way a healthy origin can drop the split: off.
        settings: {
          ...PARALLEL_RANGE_DEFAULTS,
          chunkBytes: chunkSize,
          measureMs: 100,
          speedupFloor: 0,
        },
      });
      const first = await new Promise<http.IncomingMessage>((resolve) => {
        http.get(feeder.url, { headers: { range: "bytes=0-" }, agent: false }, resolve);
      });
      let read = 0;
      first.on("data", (chunk: Buffer) => {
        read += chunk.length;
        if (read >= 8 * 1024 * 1024) first.pause();
      });
      // Waited for, not sampled at 2.5 s: split, the first reader stopped, and
      // its lookahead holding three chunks besides the one it is handing over.
      await until(
        () =>
          feeder.stats().mode === "parallel" &&
          read >= 8 * 1024 * 1024 &&
          feeder.stats().maxHeldBytes >= 3 * chunkSize,
        15_000,
        () => JSON.stringify({ read, stats: feeder.stats() }),
      );

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
      expect(stats.maxHeldBytes).toBeLessThanOrEqual(4 * chunkSize);
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
