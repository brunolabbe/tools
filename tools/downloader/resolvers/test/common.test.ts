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
