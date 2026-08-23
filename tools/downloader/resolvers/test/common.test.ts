import { describe, expect, test } from "vitest";
import { subtitleFormat } from "../src/common.ts";

type Format = "vtt" | "srt" | "ttml" | "unknown";

/**
 * Every row of `SUBTITLE_FORMATS`, in each of the three hint shapes its callers
 * build: a bare extension (`hls.ts`), a `mimeType codecs fileUrl` triple
 * (`dash.ts`), and a bare extension or a whole URL (`ytdlp.ts`). The boundary
 * probes are the point of the table — dl-24 was a row that answered `ttml` for
 * anything whose last two letters were `tt`.
 */
const CASES: ReadonlyArray<readonly [string | undefined, Format, string]> = [
  // Row 1 — vtt.
  ["vtt", "vtt", "bare extension, the shape hls.ts passes"],
  ["webvtt", "vtt", "bare codec"],
  ["wvtt", "vtt", "ISO-BMFF sample entry for WebVTT in fragmented mp4"],
  ["text/vtt", "vtt", "mime type"],
  ["text/vtt https://cdn.example.com/s/sub.vtt", "vtt", "dash.ts triple"],
  ["application/mp4 wvtt https://cdn.example.com/s/sub.mp4", "vtt", "dash.ts triple, wvtt"],
  ["application/mp4 webvtt https://cdn.example.com/s/sub.mp4", "vtt", "dash.ts triple, webvtt"],
  ["https://cdn.example.com/s/sub.vtt?token=abc", "vtt", "whole URL, the ytdlp.ts fallback"],
  ["swvtt", "unknown", "boundary: a word character before the w is not a wvtt"],
  ["xvtt", "unknown", "boundary: a word character before vtt is not a vtt"],
  ["vttx", "unknown", "boundary: a word character after vtt is not a vtt"],

  // Row 2 — srt.
  ["srt", "srt", "bare extension, the shape hls.ts passes"],
  ["subrip", "srt", "bare name, matched unanchored on purpose"],
  ["application/x-subrip", "srt", "mime type"],
  ["application/x-subrip https://cdn.example.com/s/sub.srt", "srt", "dash.ts triple"],
  ["xsrt", "unknown", "boundary: a word character before srt is not an srt"],
  ["srtx", "unknown", "boundary: a word character after srt is not an srt"],
  ["text/srt", "srt", "mime type whose subtype ends the hint"],
  ["https://cdn.example.com/s/sub.srt?token=abc", "srt", "whole URL, the ytdlp.ts fallback"],
  // dl-25 — SRT is also a transport protocol, so `srt` is a plausible CDN label
  // and a plausible path segment. None of these four claims a format.
  ["application/mp4 https://srt.cdn.net/sub.mp4", "unknown", "dl-25: srt is a hostname label"],
  ["application/mp4 https://cdn.net/srt/sub.mp4", "unknown", "dl-25: srt is a path segment"],
  ["video/mp4 https://srt-edge.example.com/s/sub.mp4", "unknown", "dl-25: srt prefixes a host"],
  [
    "application/ttml+xml https://srt.cdn.net/sub.ttml",
    "ttml",
    "dl-25: a real ttml track behind an srt-named host; row 2 must not outrank row 3",
  ],

  // Row 3 — ttml, and its aliases.
  ["ttml", "ttml", "bare extension, the shape hls.ts passes"],
  ["application/ttml+xml", "ttml", "mime type"],
  ["application/ttml+xml https://cdn.example.com/s/sub.ttml", "ttml", "dash.ts triple"],
  ["dfxp", "ttml", "bare extension"],
  ["stpp", "ttml", "ISO-BMFF sample entry for TTML in fragmented mp4"],
  ["stpp.ttml.im1t", "ttml", "the codecs= string a real DASH manifest carries"],
  ["application/mp4 stpp https://cdn.example.com/s/sub.mp4", "ttml", "dash.ts triple, stpp"],
  ["tt", "ttml", "bare .tt extension, the shape hls.ts passes"],
  ["https://cdn.example.com/s/sub.tt", "ttml", "whole URL ending in .tt"],
  ["ttx", "unknown", "boundary: tt has to end the hint"],
  ["xtt", "unknown", "boundary: a word character before a trailing tt is not a .tt"],

  // Rows 1 and 3 still read a hostname as a format claim — the defect dl-25
  // fixed in row 2. These four pin the wrong answers rather than the right
  // ones, so that dl-28 has a failing target to flip; row 2's boundary cannot
  // be reused here, because `stpp.ttml.im1t` above needs the dots row 2 now
  // rejects. Do not "fix" these expectations without fixing the code.
  ["application/mp4 https://stpp.cdn.net/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],
  ["application/mp4 https://cdn.net/ttml/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],
  ["application/mp4 https://vtt.cdn.net/sub.mp4", "vtt", "dl-28, wrong: should be unknown"],
  ["application/mp4 https://cdn.net/dfxp/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],

  // No row.
  ["", "unknown", "empty hint"],
  ["application/octet-stream", "unknown", "an unrelated mime type"],
  ["m3u8", "unknown", "hls.ts short-circuits this one before it ever gets here"],
  [undefined, "unknown", "no hint at all"],
];

describe("subtitleFormat", () => {
  for (const [hint, expected, why] of CASES) {
    test(`${hint === undefined ? "undefined" : JSON.stringify(hint)} is ${expected} — ${why}`, () => {
      expect(subtitleFormat(hint)).toBe(expected);
    });
  }

  test("covers every return value the signature admits", () => {
    expect(new Set(CASES.map(([, expected]) => expected))).toEqual(
      new Set(["vtt", "srt", "ttml", "unknown"]),
    );
  });
});
