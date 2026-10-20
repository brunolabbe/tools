/**
 * dl-98: the feeder's own limits, what gate 2 found, and dl-108's connection count
 * (split from parallel-ranges.test.ts, dl-129; the fixture is
 * `helpers/parallel-ranges-fixture.ts`).
 */

import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { AppError } from "@downloader/contract";
import { PARALLEL_RANGE_DEFAULTS } from "../src/download/parallel-ranges.ts";
import type { FeederStats, RangeFeeder } from "../src/download/parallel-ranges.ts";
import {
  behaviour,
  CONTEXT,
  counted,
  engineWith,
  expectNothingOpenedSince,
  FAST_SPLIT,
  feederFor,
  files,
  isFanOut,
  open,
  originUrl,
  readLoopback,
  resetAfterEach,
  runSampling,
  seen,
  sleep,
  SLOW,
  startOrigin,
  startProxy,
  stopOrigin,
  until,
  variant,
} from "./helpers/parallel-ranges-fixture.ts";

beforeAll(startOrigin, SLOW);

afterAll(stopOrigin);

afterEach(resetAfterEach);

describe("dl-98: the feeder's own limits", () => {
  test(
    "bytes held ahead never exceed 4 x 4 MB, measured at the defaults with ffmpeg not reading",
    async () => {
      // 40 MB of bytes that differ, so a misplaced chunk cannot compare equal.
      const body = Buffer.alloc(40 * 1024 * 1024);
      for (let index = 0; index < body.length; index += 4) body.writeUInt32BE(index, index);
      files["forty.bin"] = body;
      // A throttle well under what this process can copy, which 40 MB/s is not:
      // that was only ever the rate asked for. The fixture's sleep per slice
      // delivered 13 MB/s on Linux and 1.4 on Windows. Delivered in full (dl-106)
      // the 2 MB the reader takes before it pauses went by in under the 50 ms
      // window, so the split waited for the pause to end, and 4 connections
      // were not 1.5x one that was already limited by the CPU, so it fell back.
      behaviour.perConnectionBps = 10_000_000;
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
      const fatal: AppError[] = [];
      let requestsAtStop = -1;
      let running: RangeFeeder | null = null;
      const { feeder } = await feederFor("moov-end.mp4", {
        maxBytes: limit,
        onFatal: (error) => {
          requestsAtStop = running?.stats().originRequests ?? -1;
          fatal.push(error);
        },
      });
      running = feeder;
      const read = await readLoopback(feeder.url);
      const stats = feeder.stats();
      const measuredFrom = performance.now() + 100;
      await sleep(400);

      expect(fatal).toHaveLength(1);
      expect(fatal[0]?.code).toBe("SIZE_LIMIT_EXCEEDED");
      expect(read.complete).toBe(false);
      expect(read.body.length).toBeLessThanOrEqual(limit);
      // Split before the cap: the fan-out's bytes were counted as well as the relay's.
      expect(stats.mode).toBe("parallel");
      expect(stats.deliveredBytes).toBeGreaterThan(limit);
      expect(open).toBe(0);
      expectNothingOpenedSince(feeder, requestsAtStop);
      // The feeder began 5 and the origin saw 4: one was aborted before it
      // connected, so a count cannot tell a late request from that slack. This
      // test also looks in time, from 100 ms after the stop (dl-106).
      expect(seen.filter((entry) => entry.at > measuredFrom)).toEqual([]);
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
      // Four origin connections open at the moment of the cancel, waited for
      // rather than sampled: a chunk fetched and not yet handed over holds a
      // slot with no connection open, so any one instant can show three
      // (gate 2's item 4, on Windows at 500 ms).
      await until(
        () => feeder.stats().mode === "parallel" && open === 4,
        10_000,
        () => JSON.stringify({ open, stats: feeder.stats() }),
      );
      // Read before the abort: close() runs inside it, and a request it began
      // would otherwise be in the count it is compared against.
      const requestsAtStop = feeder.stats().originRequests;
      controller.abort();
      const read = await reading;
      await sleep(300);

      expect(read.complete).toBe(false);
      expect(open).toBe(0);
      expectNothingOpenedSince(feeder, requestsAtStop);
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

describe("dl-98 round 2: what gate 2 found", () => {
  /**
   * Gate 2's `stuckpause.mts`, shortened. A reads 200 KB and stops, so the
   * loopback's buffers fill and the feeder pauses A's origin; then B reads
   * from another offset at full speed. B's origin is 4 MB/s against 20 MB/s
   * of media, so B is slow and should be split.
   *
   * A's origin is not throttled (dl-120). Its pause has to engage inside the
   * 2 s window, or the meter closes the window on A alone and splits before B
   * exists. What the pause waits on is the loopback: the kernel's socket
   * buffers between the feeder and a stopped A take several megabytes before
   * the feeder's writes block, and no Node API sizes them. On Linux, with A
   * unthrottled, they took 7.5 to 10.45 MB (dl-120's builder, 23 busy loops
   * on the test's core) and 6.3 to 10.45 MB (its gate 2, 11 and 23 loops).
   * Throttled, that fill cost the window whatever rate the fixture managed to
   * deliver in a starved process, and a run split whenever it delivered too
   * little. Unthrottled, A fills them at the socket's own speed. Its bytes
   * still count, and they raise the rate the meter judges, but B at 4 MB/s
   * keeps it far below the media's 20. At the split, with 23 busy loops, the
   * builder measured 4.4 to 7.5 MB/s and gate 2 measured 5.8 to 8.6.
   */
  // oxlint-disable-next-line consistent-function-scoping -- read beside the two F9 tests it serves
  async function pausedThenRead(closeA: boolean): Promise<{ splitAfterMs: number | null }> {
    const size = 60_000_000;
    files["stuck.bin"] = Buffer.alloc(size, 9);
    // The fixture takes the rate when a request arrives: A's is unthrottled.
    behaviour.perConnectionBps = null;
    const { feeder } = await feederFor("stuck.bin", {
      settings: { ...PARALLEL_RANGE_DEFAULTS, chunkBytes: 1024 * 1024, measureMs: 2_000 },
      durationSec: () => size / 20_000_000,
    });
    let aBytes = 0;
    const startedA = performance.now();
    const a = await new Promise<http.IncomingMessage>((resolve) => {
      http.get(feeder.url, { headers: { range: "bytes=0-" }, agent: false }, (response) => {
        response.on("data", (chunk: Buffer) => {
          aBytes += chunk.length;
          if (aBytes >= 200_000) response.pause();
        });
        resolve(response);
      });
    });
    // What this poll establishes is that the loopback has stopped taking A's bytes
    // (dl-129, in place of a fixed 4 s): A was given its 200 KB, and what the
    // feeder has delivered then stays put for 400 ms. It does not prove that the
    // pause engaged: delivered bytes also plateau once the loopback is full when
    // nothing paused the origin. Waited for no less than the 2 s window plus 0.3 s,
    // as the fixed sleep outlasted it: a meter that counted A's paused time would
    // have closed its window and split by then, and the assertion below is what
    // says it did not.
    let delivered = -1;
    let stableSince = performance.now();
    await until(
      () => {
        const now = performance.now();
        const bytes = feeder.stats().deliveredBytes;
        if (bytes !== delivered) {
          delivered = bytes;
          stableSince = now;
        }
        return aBytes >= 200_000 && now - stableSince >= 400 && now - startedA >= 2_300;
      },
      4_000,
      () => JSON.stringify({ aBytes, ...feeder.stats() }),
    );
    expect(feeder.stats().mode).toBe("single");
    if (closeA) a.destroy();
    await sleep(300);

    behaviour.perConnectionBps = 4_000_000;
    const started = performance.now();
    let splitAfterMs: number | null = null;
    const b = http.get(feeder.url, { headers: { range: "bytes=30000000-" }, agent: false });
    b.on("response", (response) => response.resume());
    b.on("error", () => undefined);
    try {
      await until(
        () => feeder.stats().mode !== "single",
        6_000,
        () => JSON.stringify(feeder.stats()),
      );
      splitAfterMs = performance.now() - started;
    } catch {
      splitAfterMs = null;
    } finally {
      b.destroy();
      a.destroy();
    }
    return { splitAfterMs };
  }

  test(
    "F9: a paused request ffmpeg closed does not keep the meter paused for the next one",
    async () => {
      const { splitAfterMs } = await pausedThenRead(true);
      // Before the fix the meter stayed paused for good, and B never split.
      expect(splitAfterMs).not.toBeNull();
      expect(splitAfterMs).toBeLessThan(4_500);
    },
    SLOW,
  );

  test(
    "F9: a paused request left open does not stop the meter for one that is reading",
    async () => {
      const { splitAfterMs } = await pausedThenRead(false);
      expect(splitAfterMs).not.toBeNull();
      expect(splitAfterMs).toBeLessThan(4_500);
    },
    SLOW,
  );

  test(
    "F10: a relay answered later than the idle bound is not cut: its wait is ffmpeg's",
    async () => {
      // The owner's answer: the bound is the chunk fetches' and the
      // continuation's. Gate 2: an origin whose first answer took 25 s failed
      // at the 20 s bound behind the feeder, and finished direct.
      behaviour.relayHeaderDelayMs = 1_000;
      const { feeder } = await feederFor("moov-end.mp4", {
        settings: { ...PARALLEL_RANGE_DEFAULTS, ...FAST_SPLIT, idleMs: 300 },
        durationSec: () => 1_000,
      });
      const read = await readLoopback(feeder.url);
      expect(read.status).toBe(206);
      expect(read.complete).toBe(true);
      expect(read.body.equals(files["moov-end.mp4"] as Buffer)).toBe(true);
    },
    SLOW,
  );
});

describe("dl-98 round 2: a request that goes away is no longer measured", () => {
  test(
    "F9: a request ffmpeg closed while it was reading does not count a later pause as the origin's time",
    async () => {
      // A reads and is closed while it is still reading. B reads 200 KB and
      // stops for 2 s, so the feeder pauses its origin, then reads on. Were A
      // still counted as reading, B's pause would be charged to the origin, its
      // rate would read low, and a fast origin would be split. The arithmetic is
      // `parallel-ranges-meter.test.ts`'s; this test is that the feeder releases
      // A when its request closes, and it is scaled to be quick (dl-114).
      //
      // **B is not throttled** (the same remedy as `pausedThenRead`, dl-120),
      // and the media is 10 MB/s. Throttled at 4 MB/s, the loopback's fill
      // (5.2 to 7.8 MB, so 1.3 to 2 s) outlasts a 1 s window: the meter judged B
      // fast before the pause began, and with a closed reader kept as a member
      // this test still passed, 3 of 3 (measured, dl-114). Unthrottled, the fill takes the socket's
      // own speed, and what the pause charged to the origin is the fill over the
      // pause, at most 10.45 MB over 2 s, about 5.2 MB/s. That sits below the
      // media's 10 MB/s and far below what B reads at when the pause is
      // subtracted, so the two cases are told apart with margin on both sides:
      // with a closed reader kept as a member, 12 of 12 runs split (23 busy loops
      // pinned to the test's core, and 24 spread over the cores); with `release`
      // as shipped, 12 of 12 stayed on one connection. At 6 MB/s of media, one of
      // the 12 loaded runs with the bug missed it.
      const size = 80_000_000;
      files["released.bin"] = Buffer.alloc(size, 7);
      // A is throttled so it is still reading when it is closed; the fixture
      // takes the rate when a request arrives, so B's is set after A's.
      behaviour.perConnectionBps = 4_000_000;
      const { feeder } = await feederFor("released.bin", {
        settings: { ...PARALLEL_RANGE_DEFAULTS, chunkBytes: 1024 * 1024, measureMs: 1_000 },
        durationSec: () => size / 10_000_000,
      });
      const a = http.get(feeder.url, { headers: { range: "bytes=0-" }, agent: false });
      a.on("response", (response) => response.resume());
      a.on("error", () => undefined);
      await sleep(500);
      a.destroy();

      behaviour.perConnectionBps = null;
      let bBytes = 0;
      const b = http.get(feeder.url, { headers: { range: "bytes=20000000-" }, agent: false });
      b.on("error", () => undefined);
      b.on("response", (response) => {
        response.on("data", (chunk: Buffer) => {
          bBytes += chunk.length;
          if (bBytes >= 200_000 && bBytes - chunk.length < 200_000) {
            response.pause();
            setTimeout(() => response.resume(), 2_000);
          }
        });
      });
      await sleep(3_000);
      const stats = feeder.stats();
      b.destroy();
      expect(stats.mode, JSON.stringify(stats)).toBe("single");
      expect(bBytes).toBeGreaterThan(10_000_000);
    },
    SLOW,
  );
});

describe("dl-108: the job's progress says how many connections reach the origin", () => {
  test(
    "a job the feeder splits reports 2 or more connections, and never more than it allows",
    async () => {
      behaviour.perConnectionBps = 500_000;
      const samples = await runSampling(engineWith(), variant("moov-end.mp4"));
      expect(counted().fanOut).toBeGreaterThan(4);
      const most = Math.max(...samples.map((value) => value ?? 0));
      // "Ever reached", not the value at an instant: a tick lands where it lands.
      expect(most, JSON.stringify(samples)).toBeGreaterThanOrEqual(2);
      // Four connections is the most the settings allow.
      expect(most, JSON.stringify(samples)).toBeLessThanOrEqual(4);
      expect(samples.every((value) => value !== null)).toBe(true);
    },
    SLOW,
  );

  test(
    "a fast origin never reports more than one connection, and never null",
    async () => {
      behaviour.perConnectionBps = 4_000_000;
      const samples = await runSampling(engineWith(), variant("faststart.mp4"));
      expect(counted().fanOut).toBe(0);
      expect(samples.length).toBeGreaterThan(0);
      for (const value of samples) {
        expect(value, JSON.stringify(samples)).not.toBeNull();
        expect(value, JSON.stringify(samples)).toBeLessThanOrEqual(1);
      }
      // Not "always 1": the closing tick comes after the relay has ended, which
      // is a true 0. But the relay is counted while it reads: an engine that
      // reported 0 throughout, or a feeder that did not count relays, fails here.
      expect(
        samples.some((value) => value === 1),
        JSON.stringify(samples),
      ).toBe(true);
    },
    SLOW,
  );

  test(
    "a host listed as single-connection has no feeder, so the count is null throughout",
    async () => {
      behaviour.perConnectionBps = 4_000_000;
      const samples = await runSampling(
        engineWith({ singleConnectionHosts: ["127.0.0.1"] }),
        variant("faststart.mp4"),
      );
      expect(counted().fanOut).toBe(0);
      expect(samples.length).toBeGreaterThan(0);
      expect(
        samples.every((value) => value === null),
        JSON.stringify(samples),
      ).toBe(true);
    },
    SLOW,
  );

  test(
    "the feeder counts its relay as one open connection, and none once the relay has ended",
    async () => {
      // No duration, so it never judges a split: this is the relay alone.
      const { feeder } = await feederFor("faststart.mp4", { durationSec: () => null });
      expect(feeder.stats().openFetches).toBe(0);
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        http
          .get(feeder.url, { headers: { range: "bytes=0-" }, agent: false }, resolve)
          .on("error", reject);
      });
      expect(feeder.stats().openFetches).toBe(1);
      await new Promise<void>((resolve) => {
        response.on("end", resolve);
        response.resume();
      });
      await until(
        () => feeder.stats().openFetches === 0,
        5_000,
        () => JSON.stringify(feeder.stats()),
      );
    },
    SLOW,
  );
});
