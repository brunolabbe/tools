import { describe, expect, test } from "vitest";
import { subtitleFormat } from "../src/common.ts";

type Format = "vtt" | "srt" | "ttml" | "unknown";

/**
 * Every row of `SUBTITLE_FORMATS`, in each of the three hint shapes its callers
 * build: a bare extension (`hls.ts`), a `mimeType codecs fileUrl` triple
 * (`dash.ts`), and a bare extension or a whole URL (`ytdlp.ts`). The boundary
 * probes are the point of the table — dl-24 was a row that answered `ttml` for
 * anything whose last two letters were `tt`, and dl-25 was two rows that read
 * a CDN hostname as a format claim.
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
  ["text/vtt; charset=utf-8", "vtt", "mime type with a parameter after it"],
  ['application/mp4; codecs="wvtt"', "vtt", "codecs in a quoted mime parameter"],
  // dl-25 — row 1 takes the same boundary as row 2. `vtt` is as plausible a CDN
  // label as `srt`, and it is the more damaging of the two: `vtt` passes the
  // engine's SUBTITLE_FORMATS_FFMPEG_READS gate, so a wrong answer here is a
  // wrong download rather than a dropped track.
  ["application/mp4 https://vtt.cdn.net/sub.mp4", "unknown", "dl-25: vtt is a hostname label"],
  ["application/mp4 https://cdn.net/vtt/sub.mp4", "unknown", "dl-25: vtt is a path segment"],
  [
    "video/mp4 https://webvtt-edge.example.com/s/sub.mp4",
    "unknown",
    "dl-25: webvtt prefixes a host",
  ],
  [
    "https://www.youtube.com/api/timedtext?lang=en&fmt=vtt",
    "vtt",
    "dl-25: the boundary must not cost the query-string claim ytdlp.ts relies on",
  ],

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

  // Row 3 still reads a hostname as a format claim — the defect dl-25 fixed in
  // rows 1 and 2. These three pin the wrong answers rather than the right ones,
  // so that dl-28 has a failing target to flip. Row 3 cannot borrow dl-25's
  // boundary: `stpp.ttml.im1t` above is a real codecs string and needs the dots
  // that boundary rejects. Do not "fix" these expectations without fixing the
  // code.
  ["application/mp4 https://stpp.cdn.net/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],
  ["application/mp4 https://cdn.net/ttml/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],
  ["application/mp4 https://cdn.net/dfxp/sub.mp4", "ttml", "dl-28, wrong: should be unknown"],

  // dl-25 bought its hostname boundary at a price, and this is the price. The
  // lookahead `(?![\w./-])` rejects a real extension followed by `/`, `.`, `-`
  // or a word character, so these three genuine tracks are now `unknown`. It
  // only bites a hint with no mime type and no codec: prefix any of them with
  // `text/srt` or `application/x-subrip` and they answer `srt` again, which is
  // why dash.ts and hls.ts cannot reach it and only ytdlp.ts can. Pinned so
  // that re-widening the boundary is a decision and not an accident.
  ["https://cdn.example.com/s/sub.srt/download", "unknown", "dl-25 cost: extension not last"],
  ["https://cdn.example.com/s/sub.srt.gz", "unknown", "dl-25 cost: a suffix after the extension"],
  [
    "text/srt https://cdn.example.com/s/sub.srt/download",
    "srt",
    "dl-25 cost is recovered by any mime type in front",
  ],

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
