import { describe, expect, test } from "vitest";
import {
  buildInputMaps,
  buildOutputArgs,
  containerSupports,
  formatMapArg,
  normalizeCodecName,
} from "../src/mux.ts";
import type { StreamMap } from "../src/mux.ts";

const AV_MAPS: StreamMap[] = [
  { inputIndex: 0, kind: "video", streamIndex: 0 },
  { inputIndex: 1, kind: "audio", streamIndex: 0 },
];

describe("codec identification", () => {
  test("normalises RFC 6381 identifiers to ffmpeg names", () => {
    expect(normalizeCodecName("avc1.640028")).toBe("h264");
    expect(normalizeCodecName("mp4a.40.2")).toBe("aac");
    expect(normalizeCodecName("hvc1.2.4.L153.B0")).toBe("hevc");
    expect(normalizeCodecName("av01.0.05M.08")).toBe("av1");
    expect(normalizeCodecName("vp09.00.10.08")).toBe("vp9");
  });

  test('treats absent, empty and yt-dlp\'s "none" as unknown', () => {
    expect(normalizeCodecName(undefined)).toBeNull();
    expect(normalizeCodecName("")).toBeNull();
    expect(normalizeCodecName("none")).toBeNull();
  });

  test("an unknown codec is assumed copyable rather than transcoded on a guess", () => {
    expect(containerSupports("mp4", "video", undefined)).toBe(true);
    expect(containerSupports("mp4", "video", "avc1.640028")).toBe(true);
    expect(containerSupports("webm", "video", "avc1.640028")).toBe(false);
    // Matroska carries anything.
    expect(containerSupports("mkv", "audio", "ac3")).toBe(true);
  });
});

describe("stream mapping", () => {
  test("formats selectors, including the optional marker", () => {
    expect(formatMapArg({ inputIndex: 0, kind: "video", streamIndex: 0 })).toBe("0:v:0");
    expect(formatMapArg({ inputIndex: 1, kind: "audio" })).toBe("1:a");
    expect(formatMapArg({ inputIndex: 2, kind: "subtitle", streamIndex: 1, optional: true })).toBe(
      "2:s:1?",
    );
  });

  test("an unverified stream is mapped optionally, a claimed one is not", () => {
    // dl-42. `-map 0:a:0` against a file with no audio track is
    // `Stream map '0:a:0' matches no streams` and exit 234, so a tier that
    // never inspected the file must say so here and get the `?`.
    const claimed = buildInputMaps({ path: "/tmp/media.mp4", take: ["video", "audio"] }, 0);
    expect(claimed.map(formatMapArg)).toEqual(["0:v:0", "0:a:0"]);

    const unverified = buildInputMaps(
      { path: "/tmp/media.mp4", take: ["video", "audio"], unverified: ["audio"] },
      0,
    );
    expect(unverified.map(formatMapArg)).toEqual(["0:v:0", "0:a:0?"]);

    // Subtitles keep their `?` without being listed, as they always have.
    const subtitles = buildInputMaps({ path: "/tmp/subs.vtt", take: ["subtitle"] }, 1);
    expect(subtitles.map(formatMapArg)).toEqual(["1:s:0?"]);
  });
});

describe("buildOutputArgs", () => {
  test("stream-copies by default and never re-encodes a supported codec", () => {
    const { args, transcodes } = buildOutputArgs({
      container: "mp4",
      maps: AV_MAPS,
      videoCodec: "avc1.640028",
      audioCodec: "mp4a.40.2",
    });

    expect(transcodes).toEqual([]);
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args).not.toContain("-c:v");
    expect(args).not.toContain("-c:a");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  test("transcodes — and reports it — only when the container cannot hold the codec", () => {
    const { args, transcodes } = buildOutputArgs({
      container: "webm",
      maps: AV_MAPS,
      videoCodec: "avc1.640028",
      audioCodec: "mp4a.40.2",
    });

    expect(args[args.indexOf("-c:v") + 1]).toBe("libvpx-vp9");
    expect(args[args.indexOf("-c:a") + 1]).toBe("libopus");
    expect(transcodes.map((notice) => notice.kind).toSorted()).toEqual(["audio", "video"]);
    expect(transcodes[0]?.from).toBe("h264");
  });

  test("embeds subtitles as soft tracks with language metadata, never burned in", () => {
    const { args } = buildOutputArgs({
      container: "mp4",
      maps: [...AV_MAPS, { inputIndex: 2, kind: "subtitle", streamIndex: 0, optional: true }],
      videoCodec: "h264",
      audioCodec: "aac",
      subtitleLanguages: ["fr-CA"],
    });

    expect(args[args.indexOf("-c:s") + 1]).toBe("mov_text");
    expect(args).toContain("-metadata:s:s:0");
    expect(args[args.indexOf("-metadata:s:s:0") + 1]).toBe("language=fr-CA");
    // Burn-in would show up as a filter; there must not be one.
    expect(args).not.toContain("-vf");
    expect(args).not.toContain("-filter_complex");
  });

  test("audioOnly drops the video maps entirely", () => {
    const { args } = buildOutputArgs({
      container: "mp4",
      maps: AV_MAPS,
      audioOnly: true,
      audioCodec: "aac",
    });

    const maps = args.filter((arg, index) => args[index - 1] === "-map");
    expect(maps).toEqual(["1:a:0"]);
  });

  test("applies aac_adtstoasc for a possible MPEG-TS source and skips it for fMP4", () => {
    const ts = buildOutputArgs({
      container: "mp4",
      maps: AV_MAPS,
      audioCodec: "aac",
      sourceMayBeMpegTs: true,
    });
    expect(ts.args[ts.args.indexOf("-bsf:a") + 1]).toBe("aac_adtstoasc");

    const fmp4 = buildOutputArgs({
      container: "mp4",
      maps: AV_MAPS,
      audioCodec: "aac",
      sourceMayBeMpegTs: false,
    });
    expect(fmp4.args).not.toContain("-bsf:a");
  });

  test("faststart is an MP4-only concern", () => {
    const { args } = buildOutputArgs({ container: "mkv", maps: AV_MAPS });
    expect(args).not.toContain("-movflags");
  });
});
