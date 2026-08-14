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
