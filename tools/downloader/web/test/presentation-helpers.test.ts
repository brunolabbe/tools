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

import {
  pickDefaultVariantId,
  sortVariantRows,
  toDisplayRows,
  toVariantRows,
} from "../src/lib/variants.ts";
import { parsedVariants } from "./fixtures.ts";

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
    // `hasAudio: false` on the variant, but a separate audio rendition to mux
    // in — the row reports what the user will get, which is sound.
    expect(dash.audio).toBe("present");
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

/**
 * dl-40: rows that read identically because what separates them is off-screen.
 *
 * Every list here is what a real resolver produced from a real source — see
 * `parsedVariants` in `fixtures.ts` — because the defect is a property of what
 * sites publish, and a hand-built list of near-identical literals would only
 * prove that the author can write near-identical literals.
 *
 * The shapes pull in different directions on purpose. Two of them must *not*
 * collapse: a language ladder and a two-profile rung are real choices wearing
 * identical rows, and losing one of those is a worse defect than the one being
 * fixed.
 *
 * The reported video reached the picker as twenty rows through two layers. The
 * yt-dlp tier drops its half (`ytdlp.test.ts`); what is left here is the
 * manifest's own — each rung declared once per CDN mirror, with the mirror
 * count varied per rung so nothing can assume it.
 */
describe("renditions that differ only in what the table cannot show (dl-40)", () => {
  test("mirrors of a rendition collapse to one row, whatever the mirror count", () => {
    const declared = parsedVariants("manifests/hls-master-redundant-mirrors");
    expect(declared).toHaveLength(10);

    const { rows, collapsed, showLanguage } = toDisplayRows(declared);
    expect(rows.map((row) => row.quality)).toEqual([
      "1280×720",
      "848×480",
      "640×360",
      "424×240",
      "256×144",
    ]);
    // 3 + 2 + 2 + 1 + 2 declared, five rows kept. The rung with a single mirror
    // has to survive untouched, and the one with three has to lose two.
    expect(collapsed).toBe(5);
    // Nothing declared a language, so a column of five empty cells would be
    // worse than no column.
    expect(showLanguage).toBe(false);
  });

  test("the row that survives a collapse is one the manifest declared", () => {
    const declared = parsedVariants("manifests/hls-master-redundant-mirrors");
    const byId = new Map(declared.map((item) => [item.id, item]));
    const { rows } = toDisplayRows(declared);

    // Each surviving row still names a real variant — the download would
    // otherwise be pointed at an id nothing in the probe answers to.
    const urls = rows.map((row) => byId.get(row.id)?.url);
    expect(urls.every((url) => url !== undefined)).toBe(true);
    expect(new Set(urls).size).toBe(rows.length);
    // And specifically the first the manifest declared for that rung, which is
    // its primary rather than one of the mirrors — asserted against the
    // fixture's own text so it cannot agree with a bug in the parser.
    const first = new Map<number, string>();
    for (const item of declared) {
      if (!first.has(item.height ?? 0)) first.set(item.height ?? 0, item.url);
    }
    for (const row of rows) expect(byId.get(row.id)?.url).toBe(first.get(row.height));
    // Which in that fixture is the first host, on every rung including the one
    // that has no mirror at all.
    expect(urls.map((url) => new URL(url ?? "").host)).toEqual(
      Array.from({ length: 5 }, () => "vod-a.cdn.example"),
    );
  });

  test("the picker's collapse and the tier's dedup are different jobs", () => {
    // The reported video needed both. This is the tier's output — duplicates
    // already dropped, mirrors still present — and it is still ten rows' worth
    // of variants until the picker collapses them to five.
    const fromTier = parsedVariants("ytdlp/balancer-duplicate-ladder");
    expect(fromTier).toHaveLength(10);

    const { rows, collapsed } = toDisplayRows(fromTier);
    expect(rows).toHaveLength(5);
    expect(collapsed).toBe(5);
    expect(rows.map((row) => row.quality)).toEqual([
      "1280×720",
      "848×480",
      "640×360",
      "424×240",
      "256×144",
    ]);
    // The reported video's own ladder, so the bitrates are the ones in the
    // screenshot that opened this ticket.
    expect(rows.map((row) => row.bitrate)).toEqual([
      "1.3 Mbps",
      "678 kbps",
      "557 kbps",
      "353 kbps",
      "209 kbps",
    ]);
  });

  test("the default selection is never a row that was collapsed away", () => {
    const declared = parsedVariants("manifests/hls-master-redundant-mirrors");
    const { rows } = toDisplayRows(declared);
    const chosen = pickDefaultVariantId(declared);

    expect(chosen).not.toBeNull();
    expect(rows.map((row) => row.id)).toContain(chosen);
  });

  test("a per-language ladder keeps every row and says which is which", () => {
    const declared = parsedVariants("manifests/hls-master-per-language-ladder");
    const { rows, collapsed, showLanguage } = toDisplayRows(declared);

    expect(collapsed).toBe(0);
    expect(showLanguage).toBe(true);
    expect(rows.map((row) => [row.quality, row.language])).toEqual([
      ["1280×720", "eng"],
      ["1280×720", "fra"],
      ["640×360", "eng"],
      ["640×360", "fra"],
    ]);
  });

  test("two profiles of one rung stop rendering as the same H.264", () => {
    const declared = parsedVariants("manifests/hls-master-two-profiles");
    const { rows, collapsed } = toDisplayRows(declared);

    // Both rows survive, and the codec cell is what tells them apart. Without
    // this, the pair is indistinguishable and the collapse would eat a real
    // rendition — which is why the codec check is a precondition of collapsing
    // at all, not a separate nicety.
    expect(collapsed).toBe(0);
    expect(rows.map((row) => [row.quality, row.videoCodec])).toEqual([
      ["1280×720", "avc1.64001f"],
      ["1280×720", "avc1.42c01f"],
      ["640×360", "H.264"],
    ]);
  });

  test("an ordinary ladder renders exactly as it did before any of this", () => {
    // The regression that matters. A one-variant fixture would pass against an
    // implementation that collapsed everything, so this is a real five-rung
    // ladder — Apple's, with two 1080p rungs that differ only in bitrate and
    // must therefore both survive.
    const declared = parsedVariants("manifests/hls-master-multibitrate");
    const { rows, collapsed, showLanguage } = toDisplayRows(declared);

    expect(collapsed).toBe(0);
    expect(showLanguage).toBe(false);
    expect(rows).toEqual(sortVariantRows(toVariantRows(declared)));
    expect(rows.map((row) => [row.quality, row.videoCodec, row.bitrate])).toEqual([
      ["1920×1080", "H.264", "7.7 Mbps"],
      ["1920×1080", "H.264", "6.0 Mbps"],
      ["960×540", "H.264", "2.2 Mbps"],
      ["640×360", "H.264", "1.3 Mbps"],
      ["480×270", "H.264", "901 kbps"],
    ]);
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
