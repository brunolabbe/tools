/**
 * dl-98: parallel ranged reads for a progressive source throttled per connection.
 *
 * The speed-up, the 3x floor, the cancel and the egress proxy (split by dl-129; the
 * origin and its helpers are `helpers/parallel-ranges-fixture.ts`, which also
 * carries the account of how the fixture counts what it is asked).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { hostListed } from "../src/download/parallel-ranges.ts";
import { packetDigests } from "./helpers/media.ts";
import {
  behaviour,
  CONTEXT,
  counted,
  engineWith,
  maxOpen,
  open,
  originUrl,
  reference,
  resetAfterEach,
  resetCounts,
  run,
  seen,
  sleep,
  SLOW,
  SLOW_AGAINST_HALF_A_SECOND,
  startOrigin,
  startProxy,
  stopOrigin,
  variant,
} from "./helpers/parallel-ranges-fixture.ts";

beforeAll(startOrigin, SLOW);

afterAll(stopOrigin);

afterEach(resetAfterEach);

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
      // 3x is dl-98's bar, and a quiet machine clears it with room: 3.28 to 3.49
      // over 60 Windows runs of this test alone, 3.45 on Linux. On `windows-latest`
      // the four-connection run alone slows by 150 to 405 ms beside the rest of
      // the suite (its `singleMs` is a paced transfer and does not move), which
      // put 8 of 16 whole-suite runs at 2.95 to 3.21 and the CI leg at
      // 2.91 to 3.00 (dl-121). So Windows asserts 2.5: 0.41 below the lowest
      // ratio recorded there, and far above the 0.999 of a run that never splits.
      // Linux keeps 3: 40 whole-project runs on 12 cores with 11 workers, 20
      // before dl-117's split and 20 after, measured 3.40 to 3.50 with none
      // under 3, the four-connection run at most about 70 ms slower than this
      // test alone (dl-127). The one 2.97 in dl-117's runs is unexplained.
      const floor = process.platform === "win32" ? 2.5 : 3;
      expect(single.ms / split.ms, timing).toBeGreaterThanOrEqual(floor);
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
      behaviour.perConnectionBps = SLOW_AGAINST_HALF_A_SECOND;
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
      behaviour.perConnectionBps = SLOW_AGAINST_HALF_A_SECOND;
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
      behaviour.perConnectionBps = SLOW_AGAINST_HALF_A_SECOND;
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

describe("dl-98: cancelling a split job", () => {
  test(
    "a cancel after the first byte closes every origin connection and opens no more",
    async () => {
      behaviour.perConnectionBps = 500_000;
      const controller = new AbortController();
      // A kill grace of 300 ms (dl-116): ffmpeg reading a throttled loopback is
      // killed on the grace's SIGKILL, which at the default 3 s was most of this
      // test's time and none of what it proves.
      const media = await engineWith({ killGraceMs: 300 }).stream({
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
      // This test has no feeder to count requests on, so it measures in time: from
      // 100 ms after the abort, taken now and not after `media.done`, which
      // settles a kill grace later (3 s in production, 0.3 s above) and would
      // blind everything before it (dl-106). A
      // fetch the feeder had written to a socket in the turn of the abort reaches
      // the origin a few ms later (3 ms on Linux) and is closed on arrival.
      const measuredFrom = performance.now() + 100;
      await expect(media.done).rejects.toMatchObject({ code: "JOB_CANCELED" });
      await sleep(500);
      expect(open).toBe(0);
      expect(seen.filter((entry) => entry.at > measuredFrom)).toEqual([]);
    },
    SLOW,
  );
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
