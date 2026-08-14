import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FfmpegProgressParser, RateTracker, toJobProgress } from "../src/ffmpeg/progress.ts";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "ffmpeg-progress.txt",
);

async function transcript(): Promise<string> {
  return fs.readFile(FIXTURE, "utf8");
}

describe("FfmpegProgressParser", () => {
  test("parses a recorded -progress transcript into one snapshot per block", async () => {
    const parser = new FfmpegProgressParser();
    const snapshots = parser.push(await transcript());

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]?.done).toBe(false);
    expect(snapshots[2]?.done).toBe(true);

    expect(snapshots[1]).toMatchObject({
      outTimeUs: 1_868_000,
      totalSize: 262_144,
      speed: 1.87,
      frame: 45,
      done: false,
    });
    expect(snapshots[1]?.bitrateBps).toBeCloseTo(1_122_900, 0);
  });

  test("treats N/A as unknown rather than zero", async () => {
    const parser = new FfmpegProgressParser();
    const [first] = parser.push(await transcript());

    expect(first?.outTimeUs).toBeNull();
    expect(first?.totalSize).toBeNull();
    expect(first?.speed).toBeNull();
    expect(first?.bitrateBps).toBeNull();
  });

  test("tolerates chunk boundaries falling mid-line", async () => {
    const text = await transcript();
    const whole = new FfmpegProgressParser().push(text);

    const split = new FfmpegProgressParser();
    const collected = [];
    for (let index = 0; index < text.length; index += 7) {
      collected.push(...split.push(text.slice(index, index + 7)));
    }

    expect(collected).toEqual(whole);
  });

  test("flush() surfaces a block the process died before finishing", () => {
    const parser = new FfmpegProgressParser();
    expect(parser.push("total_size=1024\nout_time_us=500000\n")).toEqual([]);

    const flushed = parser.flush();
    expect(flushed?.totalSize).toBe(1024);
    expect(flushed?.done).toBe(false);
    expect(parser.flush()).toBeNull();
  });
});

describe("toJobProgress", () => {
  const snapshot = {
    outTimeUs: 3_000_000,
    totalSize: 500_000,
    speed: 2,
    bitrateBps: null,
    frame: null,
    fps: null,
    dupFrames: null,
    dropFrames: null,
    done: false,
  };

  test("computes percent and eta from a known duration", () => {
    const progress = toJobProgress(snapshot, {
      stage: "downloading",
      durationSec: 12,
      totalBytes: null,
      speedBps: 1000,
    });

    expect(progress.percent).toBeCloseTo(25, 6);
    expect(progress.processedSec).toBe(3);
    expect(progress.etaSec).toBeCloseTo(4.5, 6);
    expect(progress.downloadedBytes).toBe(500_000);
    expect(progress.speedBps).toBe(1000);
  });

  test("reports percent null when the duration is unknown — never a fake number", () => {
    const progress = toJobProgress(snapshot, {
      stage: "downloading",
      durationSec: null,
      totalBytes: null,
      speedBps: null,
    });

    expect(progress.percent).toBeNull();
    expect(progress.etaSec).toBeNull();
    expect(progress.totalBytes).toBeNull();
    // Media time is still known and is honest information.
    expect(progress.processedSec).toBe(3);
  });

  test("clamps percent to 100 when ffmpeg overshoots the declared duration", () => {
    const progress = toJobProgress(
      { ...snapshot, outTimeUs: 20_000_000 },
      {
        stage: "downloading",
        durationSec: 12,
        totalBytes: null,
        speedBps: null,
      },
    );

    expect(progress.percent).toBe(100);
  });
});

describe("RateTracker", () => {
  test("reports a trailing-window rate, not a cumulative average", () => {
    const tracker = new RateTracker(5000);
    tracker.record(0, 0);
    tracker.record(1_000_000, 1000);
    expect(tracker.bytesPerSecond()).toBeCloseTo(1_000_000, 6);

    // A long stall drops the rate instead of preserving the earlier average.
    tracker.record(1_000_000, 11_000);
    expect(tracker.bytesPerSecond() ?? Infinity).toBeLessThan(200_000);
  });

  test("returns null until two samples span real time", () => {
    const tracker = new RateTracker();
    expect(tracker.bytesPerSecond()).toBeNull();
    tracker.record(100, 500);
    expect(tracker.bytesPerSecond()).toBeNull();
  });
});
