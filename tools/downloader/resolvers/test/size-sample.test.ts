import { readFileSync } from "node:fs";
import type { MediaVariant } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { parseDash } from "../src/manifest/dash.ts";
import { listMediaSegments, parseHls } from "../src/manifest/hls.ts";
import { fragmentSegments, mapYtDlpInfo } from "../src/resolvers/ytdlp.ts";
import type { YtDlpInfo } from "../src/resolvers/ytdlp.ts";
import type { SizeProbe } from "../src/size-sample.ts";
import { measureVariantSizes, spreadIndices } from "../src/size-sample.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/manifests/${name}`, import.meta.url), "utf8");
}

const MPD_BASE = "https://media.example.org/mpd/sintel.mpd";
const HLS_BASE = "https://cdn.example.com/hls/2026/master.m3u8";

const SINTEL_VIDEO_1250K = "https://media.example.org/assets/sintel/sintel_1280x544_1250k.mp4";
const SINTEL_AUDIO = "https://media.example.org/assets/sintel/sintel_audio_128k.m4a";
const V9_PLAYLIST = "https://cdn.example.com/hls/2026/v9/prog_index.m3u8";

/**
 * A `SizeProbe` that answers from tables and records what it was asked. The
 * request log is the only way to hold the sampler to its budget, and the whole
 * point of the injected shape is that no test here opens a socket.
 */
function stubProbe(
  lengths: Record<string, number>,
  bodies: Record<string, string> = {},
): SizeProbe & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async contentLength(url: string): Promise<number | undefined> {
      calls.push(`LEN ${url}`);
      return lengths[url];
    },
    async text(url: string): Promise<string | undefined> {
      calls.push(`TXT ${url}`);
      return bodies[url];
    },
  };
}

function byId(variants: readonly MediaVariant[], id: string): MediaVariant {
  const found = variants.find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no variant ${id}`);
  return found;
}

function within(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) / expected <= tolerance;
}

const dashVariants = parseDash(fixture("dash-ondemand-baseurl.mpd"), MPD_BASE).variants;
const hlsVariants = parseHls(fixture("hls-master-multibitrate.m3u8"), HLS_BASE).variants;
const MEDIA_PLAYLIST = fixture("hls-media-aes128.m3u8");

/**
 * The encode `hls-media-vbr.m3u8` stands for: a capped-VBR profile whose 6 s
 * segments range from 2.42 MB to 6.08 MB. Nothing reads these bytes off the
 * playlist — they are what the test pretends the CDN would answer.
 */
function segmentBytes(index: number): number {
  return Math.round(
    700_000 *
      (1 +
        0.3 * Math.sin((2 * Math.PI * index) / 17) +
        0.15 * Math.cos((2 * Math.PI * index) / 7)) *
      6,
  );
}

describe("listMediaSegments", () => {
  test("pairs each EXTINF with the URI line under it, resolved against the playlist", () => {
    const segments = listMediaSegments(MEDIA_PLAYLIST, V9_PLAYLIST);
    expect(segments).toHaveLength(6);
    expect(segments[0]).toEqual({
      url: "https://cdn.example.com/hls/2026/v9/segment-000.ts",
      durationSec: 9.97667,
    });
    expect(segments[5]?.durationSec).toBe(6.67333);
  });

  test("an EXT-X-MAP init segment is a tag attribute, so it is never taken for media", () => {
    const withInit = MEDIA_PLAYLIST.replace(
      "#EXTINF:9.97667,\nsegment-000.ts",
      '#EXT-X-MAP:URI="init.mp4"\n#EXTINF:9.97667,\nsegment-000.ts',
    );
    const segments = listMediaSegments(withInit, V9_PLAYLIST);
    expect(segments).toHaveLength(6);
    expect(segments.some((segment) => segment.url.includes("init.mp4"))).toBe(false);
  });

  test("a byte-range playlist yields nothing rather than one URL counted six times", () => {
    const ranged = MEDIA_PLAYLIST.replaceAll(
      /#EXTINF:([\d.]+),\nsegment-\d+\.ts/g,
      "#EXTINF:$1,\n#EXT-X-BYTERANGE:187500@0\nwhole.ts",
    );
    expect(listMediaSegments(ranged, V9_PLAYLIST)).toEqual([]);
  });

  test("a master playlist has no EXTINF, so it lists no segments", () => {
    expect(listMediaSegments(fixture("hls-master-multibitrate.m3u8"), HLS_BASE)).toEqual([]);
  });
});

describe("spreadIndices", () => {
  test("places samples by a low-discrepancy sequence, not at a fixed stride", () => {
    const picked = spreadIndices(60, 8);
    expect(picked).toEqual([7, 12, 21, 30, 35, 44, 49, 58]);

    // The property that matters is that no single stride describes them: an
    // even stride is what aliases against periodic content.
    const gaps = picked.slice(1).map((index, i) => index - (picked[i] ?? 0));
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  test("stays inside the playlist and never repeats a segment", () => {
    for (const count of [1, 2, 5, 13, 60, 901]) {
      const picked = spreadIndices(count, 8);
      expect(new Set(picked).size).toBe(picked.length);
      expect(picked.every((index) => index >= 0 && index < count)).toBe(true);
    }
  });

  test("takes everything it has when the run is shorter than the sample", () => {
    expect(spreadIndices(2, 8)).toEqual([0, 1]);
    expect(spreadIndices(0, 8)).toEqual([]);
  });
});

describe("a DASH ladder whose declared bandwidth is a ceiling", () => {
  // The fixture declares 1 254 758 bps of video and 127 236 of audio over
  // 596.46 s, so the parser's estimate for the top rung is 103 038 018 bytes.
  // These are what the encoder actually produced — the numbers a HEAD would
  // return — and they are 62% and 65% of what each rung declares.
  const TRUE_VIDEO_1250K = 55_000_000;
  const TRUE_AUDIO = 9_000_000;
  const TRUE_625K_TOTAL = 36_600_000;

  const probe = stubProbe({
    [SINTEL_VIDEO_1250K]: TRUE_VIDEO_1250K,
    [SINTEL_AUDIO]: TRUE_AUDIO,
  });
  const sampled = measureVariantSizes(dashVariants, probe, { durationSec: 596.46 });

  test("the rung it weighed is exact, and drops the ~ that said otherwise", async () => {
    const top = byId(await sampled, "dash-1");
    expect(top.filesizeBytes).toBe(TRUE_VIDEO_1250K + TRUE_AUDIO);
    expect(top.filesizeIsEstimate).toBe(false);
    expect(top.label).toBe("544p · H.264 + AAC · 61 MB");
    expect(top.label).not.toContain("~");
  });

  test("a rung it did not weigh lands within 10% of its own true size", async () => {
    const measured = await sampled;
    const declared = byId(dashVariants, "dash-2").filesizeBytes ?? 0;
    const corrected = byId(measured, "dash-2").filesizeBytes ?? 0;

    // What the ticket reproduces: the declaration is 54% over the truth.
    expect(within(declared, TRUE_625K_TOTAL, 0.1)).toBe(false);
    expect(declared / TRUE_625K_TOTAL).toBeGreaterThan(1.5);
    // What this ticket buys: one rung's measurement calibrates the other.
    expect(within(corrected, TRUE_625K_TOTAL, 0.1)).toBe(true);
    expect(byId(measured, "dash-2").filesizeIsEstimate).toBe(true);
    expect(byId(measured, "dash-2").label).toContain("~");
  });

  test("it weighs both halves of a split rendition, and only those", async () => {
    await sampled;
    expect(probe.calls).toEqual([`LEN ${SINTEL_VIDEO_1250K}`, `LEN ${SINTEL_AUDIO}`]);
  });
});

describe("an HLS master, which carries no size and no duration at all", () => {
  /**
   * `hls-media-vbr.m3u8` is 60 segments of 6 s. The bytes below are the encode
   * this test pretends the CDN is serving — a capped-VBR profile whose segments
   * range from 2.42 MB to 6.08 MB, a 2.5x spread. A uniform fixture would make
   * the accuracy claim below unfalsifiable, which is what gate 1 found.
   */
  const VBR_PLAYLIST = fixture("hls-media-vbr.m3u8");
  const V9_VBR = V9_PLAYLIST;
  const segments = listMediaSegments(VBR_PLAYLIST, V9_VBR);
  const segmentLengths: Record<string, number> = {};
  segments.forEach((segment, index) => {
    segmentLengths[segment.url] = segmentBytes(index);
  });
  const TRUE_TOTAL = segments.reduce((total, _segment, index) => total + segmentBytes(index), 0);

  const probe = stubProbe(segmentLengths, { [V9_VBR]: VBR_PLAYLIST });
  const sampled = measureVariantSizes(hlsVariants, probe, {});

  test("every rung of the ladder gains a size it never had before", async () => {
    const measured = await sampled;
    expect(hlsVariants.every((variant) => variant.filesizeBytes === undefined)).toBe(true);
    expect(measured.every((variant) => (variant.filesizeBytes ?? 0) > 0)).toBe(true);
    expect(measured.every((variant) => variant.filesizeIsEstimate === true)).toBe(true);
  });

  test("the rung it sampled lands within 10% of what that playlist really weighs", async () => {
    const measured = byId(await sampled, "hls-1").filesizeBytes ?? 0;
    expect(within(measured, TRUE_TOTAL, 0.1)).toBe(true);
    // Eight low-discrepancy samples of a 2.5x segment spread: 0.2% here. Three
    // evenly spaced ones were 29% low on this same profile, which is what put
    // the sample count and the placement rule where they are.
    expect(within(measured, TRUE_TOTAL, 0.01)).toBe(true);
  });

  test("the rest of the ladder is scaled by declared bitrate, keeping its order", async () => {
    const measured = await sampled;
    const sizes = measured.map((variant) => variant.filesizeBytes ?? 0);
    expect(sizes).toEqual(sizes.toSorted((a, b) => b - a));
    expect(byId(measured, "hls-4").filesizeBytes).toBeLessThan(
      byId(measured, "hls-1").filesizeBytes ?? 0,
    );
  });

  test("one playlist and eight segments, whatever the size of the ladder", async () => {
    await sampled;
    expect(probe.calls).toHaveLength(9);
    expect(probe.calls.filter((call) => call.startsWith("TXT"))).toHaveLength(1);
    expect(probe.calls[0]).toBe(`TXT ${V9_VBR}`);
  });
});

describe("a rendition whose audio is a second playlist", () => {
  const splitVariants = parseHls(fixture("hls-master-split-audio.m3u8"), HLS_BASE).variants;
  const VIDEO = "https://cdn.example.com/hls/2026/video/1080p/playlist.m3u8";
  const AUDIO = "https://cdn.example.com/hls/2026/audio/en/384k/playlist.m3u8";

  test("weighs both playlists, and that is the ceiling the budget describes", async () => {
    const lengths: Record<string, number> = {};
    for (const [base, perSecond] of [
      [VIDEO, 500_000],
      [AUDIO, 48_000],
    ] as const) {
      for (const segment of listMediaSegments(MEDIA_PLAYLIST, base)) {
        lengths[segment.url] = Math.round(segment.durationSec * perSecond);
      }
    }
    const probe = stubProbe(lengths, { [VIDEO]: MEDIA_PLAYLIST, [AUDIO]: MEDIA_PLAYLIST });

    const measured = await measureVariantSizes(splitVariants, probe, {});

    // Both halves weighed: 548 000 B/s against 531 250 declared, a factor of
    // 1.03. Weighing the video alone would have said 0.94 and understated
    // every rung by the audio's share.
    expect(byId(measured, "hls-2").filesizeBytes).toBeGreaterThan(0);
    // Two playlist bodies and two runs of segment reads, each capped at 8.
    expect(probe.calls.filter((call) => call.startsWith("TXT"))).toHaveLength(2);
    expect(probe.calls.length).toBeLessThanOrEqual(18);
    expect(probe.calls).toHaveLength(14);
  });
});

describe("every way a measurement can fail leaves the declaration alone", () => {
  const full = { [SINTEL_VIDEO_1250K]: 55_000_000, [SINTEL_AUDIO]: 9_000_000 };

  test("the probe throws", async () => {
    const probe: SizeProbe = {
      async contentLength(): Promise<number | undefined> {
        throw new Error("ECONNRESET");
      },
      async text(): Promise<string | undefined> {
        throw new Error("ECONNRESET");
      },
    };
    expect(await measureVariantSizes(dashVariants, probe, { durationSec: 596.46 })).toEqual(
      dashVariants,
    );
  });

  test("the server will not give a Content-Length", async () => {
    expect(await measureVariantSizes(dashVariants, stubProbe({}), { durationSec: 596.46 })).toEqual(
      dashVariants,
    );
  });

  test("only half a split rendition can be weighed", async () => {
    const half = stubProbe({ [SINTEL_VIDEO_1250K]: 55_000_000 });
    expect(await measureVariantSizes(dashVariants, half, { durationSec: 596.46 })).toEqual(
      dashVariants,
    );
  });

  test("the source is live, so its duration is not a length", async () => {
    const probe = stubProbe(full);
    expect(
      await measureVariantSizes(dashVariants, probe, { durationSec: 596.46, isLive: true }),
    ).toEqual(dashVariants);
    expect(probe.calls).toEqual([]);
  });

  test("nothing anywhere knows how long it plays", async () => {
    const undated = dashVariants.map((variant) => {
      const { durationSec: _drop, ...rest } = variant;
      return rest;
    });
    expect(await measureVariantSizes(undated, stubProbe(full), {})).toEqual(undated);
  });

  test("the ratio is not plausible, and is discarded rather than clamped", async () => {
    const absurd = stubProbe({
      [SINTEL_VIDEO_1250K]: 55_000_000_000,
      [SINTEL_AUDIO]: 9_000_000,
    });
    expect(await measureVariantSizes(dashVariants, absurd, { durationSec: 596.46 })).toEqual(
      dashVariants,
    );
  });

  test("too few segments answered to be a bitrate", async () => {
    const oneSegment = stubProbe(
      { "https://cdn.example.com/hls/2026/v9/segment-003.ts": 6_983_669 },
      { [V9_PLAYLIST]: MEDIA_PLAYLIST },
    );
    expect(await measureVariantSizes(hlsVariants, oneSegment, {})).toEqual(hlsVariants);
  });

  test("the caller has already given up", async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = stubProbe(full);
    expect(
      await measureVariantSizes(dashVariants, probe, {
        durationSec: 596.46,
        signal: controller.signal,
      }),
    ).toEqual(dashVariants);
    expect(probe.calls).toEqual([]);
  });

  test("a templated MPD names no segment we could weigh", async () => {
    const templated = parseDash(fixture("dash-number-template.mpd"), MPD_BASE).variants;
    const probe = stubProbe({});
    expect(await measureVariantSizes(templated, probe, {})).toEqual(templated);
    expect(probe.calls).toEqual([]);
  });
});

describe("the label is rebuilt, not patched", () => {
  /** A measurement equal to the declaration: every size is its own, so every label must be too. */
  test("a DASH variant rescaled by exactly 1 keeps its label byte for byte", async () => {
    const declared = byId(dashVariants, "dash-1").filesizeBytes ?? 0;
    const probe = stubProbe({
      [SINTEL_VIDEO_1250K]: declared - 9_038_018,
      [SINTEL_AUDIO]: 9_038_018,
    });
    const measured = await measureVariantSizes(dashVariants, probe, { durationSec: 596.46 });

    expect(byId(measured, "dash-2").filesizeBytes).toBe(byId(dashVariants, "dash-2").filesizeBytes);
    expect(byId(measured, "dash-2").label).toBe(byId(dashVariants, "dash-2").label);
    // The weighed rung keeps every part but the tilde, which it has earned.
    expect(byId(measured, "dash-1").label).toBe(
      byId(dashVariants, "dash-1").label.replace("~", ""),
    );
  });

  test("the DASH audio-only producer round-trips too, which is where it could not", async () => {
    // `dash.ts` used to hand `buildLabel` an already-humanised codec while
    // storing the raw one, so this label was the one shape `withSize` could not
    // reproduce from the variant. Gate 1, finding C.
    const audioOnly = parseDash(fixture("dash-audio-only.mpd"), MPD_BASE).variants;
    const top = byId(audioOnly, "dash-a-hi");
    expect(top.label).toBe("Audio only · AAC · ~38.7 MB");

    const probe = stubProbe({
      "https://media.example.org/podcast/episode-128k.m4a": top.filesizeBytes ?? 0,
    });
    const measured = await measureVariantSizes(audioOnly, probe, {});

    expect(byId(measured, "dash-a-hi").label).toBe("Audio only · AAC · 38.7 MB");
    expect(byId(measured, "dash-a-lo").filesizeBytes).toBe(
      byId(audioOnly, "dash-a-lo").filesizeBytes,
    );
    expect(byId(measured, "dash-a-lo").label).toBe(byId(audioOnly, "dash-a-lo").label);
  });

  test("a yt-dlp variant rescaled by exactly 1 keeps its label byte for byte", async () => {
    const info: YtDlpInfo = {
      title: "A split rendition",
      duration: 100,
      formats: [
        {
          format_id: "137",
          url: "https://cdn.example.net/v/137.mp4",
          protocol: "https",
          vcodec: "avc1.640028",
          acodec: "none",
          height: 1080,
          width: 1920,
          tbr: 4000,
        },
        {
          format_id: "136",
          url: "https://cdn.example.net/v/136.mp4",
          protocol: "https",
          vcodec: "avc1.4d401f",
          acodec: "none",
          height: 720,
          width: 1280,
          tbr: 2000,
        },
        {
          format_id: "140",
          url: "https://cdn.example.net/a/140.m4a",
          protocol: "https",
          vcodec: "none",
          acodec: "mp4a.40.2",
          abr: 128,
        },
      ],
    };
    const parsed = mapYtDlpInfo(info, "https://example.net/watch", "yt-dlp", {}).variants;
    // 4000 kbps + 128 kbps over 100 s, split the way the resolver paired them.
    const probe = stubProbe({
      "https://cdn.example.net/v/137.mp4": (4000 * 1000 * 100) / 8,
      "https://cdn.example.net/a/140.m4a": (128 * 1000 * 100) / 8,
    });
    const measured = await measureVariantSizes(parsed, probe, { durationSec: 100 });

    const before = byId(parsed, "136");
    const after = byId(measured, "136");
    expect(after.filesizeBytes).toBe(before.filesizeBytes);
    expect(after.label).toBe(before.label);
  });
});

describe("fragmentSegments", () => {
  const info: YtDlpInfo = {
    formats: [
      {
        format_id: "dash-video",
        url: "https://cdn.example.net/dash/video.mpd",
        protocol: "http_dash_segments",
        fragment_base_url: "https://cdn.example.net/dash/",
        fragments: [
          { path: "v-1.m4s", duration: 4 },
          { path: "v-2.m4s", duration: 4 },
          { url: "https://other.example.net/v-3.m4s", duration: 2 },
          { path: "v-4.m4s" },
        ],
      },
      {
        format_id: "progressive",
        url: "https://cdn.example.net/file.mp4",
        protocol: "https",
      },
    ],
  };

  test("keys segments by the format URL, resolving each path against its base", () => {
    const segments = fragmentSegments(info).get("https://cdn.example.net/dash/video.mpd");
    expect(segments).toEqual([
      { url: "https://cdn.example.net/dash/v-1.m4s", durationSec: 4 },
      { url: "https://cdn.example.net/dash/v-2.m4s", durationSec: 4 },
      { url: "https://other.example.net/v-3.m4s", durationSec: 2 },
    ]);
  });

  test("a fragment with no duration weighs nothing, and a format with no fragments is absent", () => {
    const map = fragmentSegments(info);
    expect(map.has("https://cdn.example.net/file.mp4")).toBe(false);
    expect(map.get("https://cdn.example.net/dash/video.mpd")).toHaveLength(3);
  });

  test("segments a caller supplies are weighed without fetching a playlist", async () => {
    const variants: MediaVariant[] = [
      {
        id: "dash-video",
        protocol: "dash",
        url: "https://cdn.example.net/dash/video.mpd",
        hasVideo: true,
        hasAudio: true,
        label: "1080p",
        height: 1080,
        bitrateBps: 4_000_000,
        durationSec: 100,
      },
    ];
    const probe = stubProbe({
      "https://cdn.example.net/dash/v-1.m4s": 1_500_000,
      "https://cdn.example.net/dash/v-2.m4s": 1_500_000,
      "https://other.example.net/v-3.m4s": 750_000,
    });
    const measured = await measureVariantSizes(variants, probe, {
      segmentsByUrl: fragmentSegments(info),
    });

    // 3.75 MB over 10 s of the 100 s rendition, against 500 000 B/s declared.
    expect(measured[0]?.filesizeBytes).toBe(37_500_000);
    expect(measured[0]?.filesizeIsEstimate).toBe(true);
    expect(probe.calls.some((call) => call.startsWith("TXT"))).toBe(false);
  });
});
