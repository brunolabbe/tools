import { describe, expect, test } from "vitest";
import { parseJobEvent } from "@downloader/contract";
import type { MediaVariant } from "@downloader/contract";
import {
  UNKNOWN,
  formatBytes,
  formatDuration,
  formatEta,
  formatExpiry,
  formatPercent,
  formatRetryAfter,
  formatSpeed,
} from "../src/lib/format.ts";

import { pickDefaultVariantId, sortVariantRows, toVariantRows } from "../src/lib/variants.ts";

const variants: MediaVariant[] = [
  {
    id: "dash-2160p",
    protocol: "dash",
    url: "https://cdn.example.com/v.mpd",
    audioUrl: "https://cdn.example.com/a.mpd",
    hasVideo: true,
    hasAudio: false,
    videoCodec: "hvc1.2.4.L153.B0",
    audioCodec: "mp4a.40.2",
    width: 3840,
    height: 2160,
    bitrateBps: 17_500_000,
    filesizeBytes: 2_808_000_000,
    filesizeIsEstimate: true,
    label: "2160p",
  },
  {
    id: "hls-1080p",
    protocol: "hls",
    url: "https://cdn.example.com/1080.m3u8",
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc1.640028",
    audioCodec: "mp4a.40.2",
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateBps: 6_200_000,
    filesizeBytes: 995_000_000,
    label: "1080p60",
  },
  {
    id: "audio",
    protocol: "progressive",
    url: "https://cdn.example.com/a.m4a",
    hasVideo: false,
    hasAudio: true,
    audioCodec: "mp4a.40.2",
    bitrateBps: 128_000,
    label: "audio",
  },
];

describe("formatting tolerates every nullable field", () => {
  test("nulls render as a dash rather than zero", () => {
    expect(formatBytes(null)).toBe(UNKNOWN);
    expect(formatSpeed(null)).toBe(UNKNOWN);
    expect(formatEta(null)).toBe(UNKNOWN);
    expect(formatDuration(null)).toBe(UNKNOWN);
    expect(formatPercent(null)).toBe(UNKNOWN);
  });

  test("sizes, durations and rates read sensibly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 300)).toBe("300 MB");
    expect(formatDuration(1284)).toBe("21:24");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatEta(45)).toBe("45 s left");
    expect(formatEta(600)).toBe("10 min left");
    expect(formatPercent(100)).toBe("100%");
  });

  test("a retry wait is a phrase, or nothing at all", () => {
    // `null` rather than a dash: the caller renders no line, instead of a line
    // that says the wait is unknown. Nothing is the honest render here.
    expect(formatRetryAfter(null)).toBeNull();
    expect(formatRetryAfter(undefined)).toBeNull();
    expect(formatRetryAfter(0)).toBeNull();
    expect(formatRetryAfter(-5)).toBeNull();
    expect(formatRetryAfter(Number.NaN)).toBeNull();

    expect(formatRetryAfter(20)).toBe("20 s");
    // Rounded up, every time: telling someone to wait 20 s when the server said
    // 20.4 buys them one more refusal.
    expect(formatRetryAfter(20.4)).toBe("21 s");
    expect(formatRetryAfter(59)).toBe("59 s");
    expect(formatRetryAfter(60)).toBe("1 min");
    // Coarse, and deliberately so — the rounding is always in the direction of
    // waiting slightly too long.
    expect(formatRetryAfter(61)).toBe("2 min");
    expect(formatRetryAfter(600)).toBe("10 min");
  });

  test("a retry wait never renders a unit it has outgrown", () => {
    // Each boundary is crossed once, upward, so nothing reads as "60 s" or
    // "60 min" — true, but not what a person writes.
    expect(formatRetryAfter(59.6)).toBe("1 min");
    expect(formatRetryAfter(3599)).toBe("1 h");
    expect(formatRetryAfter(3600)).toBe("1 h");
    // Hours carry their minutes: "2 h" for 3601 s would overstate by an hour.
    expect(formatRetryAfter(3601)).toBe("1 h 1 min");
    expect(formatRetryAfter(7_200)).toBe("2 h");
    expect(formatRetryAfter(9_000)).toBe("2 h 30 min");
  });

  test("an absurd wait is described, never quoted", () => {
    // `retryAfterSec` comes off the network. Unclamped, these rendered as
    // "16666667 min" and as exponential notation — in user-facing copy.
    expect(formatRetryAfter(86_400)).toBe("24 h");
    expect(formatRetryAfter(86_401)).toBe("more than a day");
    expect(formatRetryAfter(1e9)).toBe("more than a day");
    expect(formatRetryAfter(Number.MAX_VALUE)).toBe("more than a day");
    // Whatever comes out, it is never a number in exponential notation.
    for (const absurd of [1e9, 1e21, Number.MAX_VALUE]) {
      expect(formatRetryAfter(absurd)).not.toMatch(/e[+-]/iu);
    }
  });

  test("expiry counts down and then reports expiry", () => {
    const now = Date.parse("2026-08-05T10:00:00.000Z");
    expect(formatExpiry("2026-08-05T15:30:00.000Z", now)).toEqual({
      expired: false,
      label: "expires in 5 h 30 min",
    });
    expect(formatExpiry("2026-08-05T09:59:00.000Z", now).expired).toBe(true);
    expect(formatExpiry("not a date", now).expired).toBe(false);
  });
});

describe("variant rows", () => {
  test("mark estimates, separate audio, and audio-only renditions", () => {
    const rows = toVariantRows(variants);
    const dash = rows[0]!;
    expect(dash.sizeIsEstimate).toBe(true);
    expect(dash.needsMux).toBe(true);
    expect(dash.hasAudio).toBe(true);
    expect(dash.videoCodec).toBe("HEVC");
    expect(rows[1]!.sizeIsEstimate).toBe(false);
    expect(rows[2]!.resolution).toBe("audio only");
  });

  test("sort video first, by height then bitrate", () => {
    const ids = sortVariantRows(toVariantRows(variants)).map((row) => row.id);
    expect(ids).toEqual(["dash-2160p", "hls-1080p", "audio"]);
  });

  test("default selection prefers a rendition that already carries audio", () => {
    // 2160p is higher quality but needs a mux; 1080p60 is the safer default.
    expect(pickDefaultVariantId(variants)).toBe("hls-1080p");
    expect(pickDefaultVariantId([])).toBeNull();
  });
});

describe("SSE frame parsing", () => {
  test("accepts a well-formed frame", () => {
    const frame = JSON.stringify({
      type: "status",
      jobId: "job-1",
      status: "downloading",
      at: "2026-08-05T10:00:00.000Z",
    });
    expect(parseJobEvent(frame)?.type).toBe("status");
  });

  test("rejects malformed, unknown and under-specified frames", () => {
    expect(parseJobEvent("{")).toBeNull();
    expect(parseJobEvent(JSON.stringify({ type: "nope", at: "x" }))).toBeNull();
    expect(
      parseJobEvent(JSON.stringify({ type: "status", jobId: "j", status: "flying", at: "x" })),
    ).toBeNull();
    expect(
      parseJobEvent(
        JSON.stringify({
          type: "failed",
          jobId: "j",
          error: { code: "NOPE", message: "", retryable: false },
          at: "x",
        }),
      ),
    ).toBeNull();
    expect(parseJobEvent(JSON.stringify({ type: "heartbeat" }))).toBeNull();
  });

  test("a heartbeat needs no job id", () => {
    expect(
      parseJobEvent(JSON.stringify({ type: "heartbeat", at: "2026-08-05T10:00:00.000Z" })),
    ).toEqual({
      type: "heartbeat",
      at: "2026-08-05T10:00:00.000Z",
    });
  });
});
