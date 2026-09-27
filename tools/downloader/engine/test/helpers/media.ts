/**
 * Media fixtures and read-back for the streaming suites (dl-53).
 *
 * Every fixture is generated here with the same ffmpeg the engine runs, so a
 * stream is a real one — real segments, a real MPD, a real `moov`-at-the-end
 * MP4 — and every result is read back by `ffprobe` rather than trusted from
 * the arguments that produced it.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveFfmpegPath } from "../../src/config.ts";

export const FFMPEG = resolveFfmpegPath();

/**
 * `ffprobe` beside the ffmpeg in use, then on `PATH`. The distribution package
 * CI installs ships both; `ffmpeg-static` ships only ffmpeg, which is why
 * `probeMedia` can fall back to reading `ffmpeg -i` instead.
 */
export const FFPROBE = ((): string => {
  const sibling = path.join(
    path.dirname(FFMPEG),
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
  return existsSync(sibling) ? sibling : "ffprobe";
})();

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
}

function run(binary: string, args: readonly string[], cwd?: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(cwd === undefined ? {} : { cwd }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve({ code: null, stdout, stderr, missing: true });
      else reject(error);
    });
    child.once("close", (code) => {
      resolve({ code, stdout, stderr, missing: false });
    });
  });
}

async function ffmpeg(args: readonly string[], cwd?: string): Promise<void> {
  const result = await run(
    FFMPEG,
    ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args],
    cwd,
  );
  if (result.code !== 0)
    throw new Error(`ffmpeg exited ${result.code}: ${result.stderr.slice(-2000)}`);
}

const SOURCES = (seconds: number): string[] => [
  "-f",
  "lavfi",
  "-i",
  `testsrc=size=320x240:rate=15:duration=${seconds}`,
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
];

const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "15"];
const AAC = ["-c:a", "aac", "-b:a", "64k"];

/** `index.m3u8` of MPEG-TS segments (2 s unless told), plus a `master.m3u8` naming it. */
export async function generateHls(dir: string, seconds: number, segmentSeconds = 2): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await ffmpeg([
    ...SOURCES(seconds),
    ...H264,
    ...AAC,
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(dir, "seg%03d.ts"),
    path.join(dir, "index.m3u8"),
  ]);
  await fs.writeFile(
    path.join(dir, "master.m3u8"),
    [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240,CODECS="avc1.42c01e,mp4a.40.2"',
      "index.m3u8",
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * `manifest.mpd` with video and audio in **separate adaptation sets** — the
 * shape where a missing `-map` silently loses the sound — and fragmented-MP4
 * segments on a template.
 *
 * **Generated from inside the directory, with a bare manifest name.** Given an
 * absolute `…\manifest.mpd`, the Windows build writes its segments somewhere
 * other than the directory the manifest sits in, so the origin answers the
 * MPD's own names with 404 and the stream fails before its first byte: a 502 in
 * every DASH case on CI's Windows leg (run 36333161971), the same fault
 * `preview-frame.test.ts` met in run 35404674345. The files the MPD names are
 * then checked for, so a muxer that writes elsewhere fails here, by name,
 * rather than later as an unexplained status.
 */
export async function generateDash(dir: string, seconds: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await ffmpeg(
    [
      ...SOURCES(seconds),
      "-map",
      "0:v",
      "-map",
      "1:a",
      ...H264,
      ...AAC,
      "-f",
      "dash",
      "-seg_duration",
      "2",
      "-use_template",
      "1",
      "-use_timeline",
      "1",
      "-adaptation_sets",
      "id=0,streams=v id=1,streams=a",
      "manifest.mpd",
    ],
    dir,
  );

  const mpd = await fs.readFile(path.join(dir, "manifest.mpd"), "utf8");
  const present = await fs.readdir(dir);
  const templates = [...mpd.matchAll(/(?:initialization|media)="(?<name>[^"]+)"/gu)].map(
    (match) => match.groups?.["name"] ?? "",
  );
  // Each adaptation set carries its own copy of the template; one name each.
  const named = templates.flatMap((template) =>
    ["0", "1"].map((id) =>
      template.replaceAll("$RepresentationID$", id).replace(/\$Number%05d\$/u, "00001"),
    ),
  );
  const missing = [...new Set(named)].filter((name) => !present.includes(name));
  if (templates.length === 0 || missing.length > 0) {
    throw new Error(
      `the generated MPD names ${missing.join(", ") || "no segment"}, which ${dir} does not hold. ` +
        `It holds: ${present.join(", ")}`,
    );
  }
}

/**
 * Plain MP4s. `moov-end.mp4` is ffmpeg's default layout, index last, which a
 * pipe cannot demux; `faststart.mp4` has it first. `video-only.mp4` and
 * `audio-only.m4a` are the two halves a DASH variant with an `audioUrl` names.
 */
export async function generateProgressive(dir: string, seconds: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const muxed = path.join(dir, "moov-end.mp4");
  await ffmpeg([...SOURCES(seconds), ...H264, ...AAC, "-shortest", muxed]);
  await ffmpeg([
    "-i",
    muxed,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    path.join(dir, "faststart.mp4"),
  ]);
  await ffmpeg(["-i", muxed, "-map", "0:v", "-c", "copy", path.join(dir, "video-only.mp4")]);
  await ffmpeg(["-i", muxed, "-map", "0:a", "-c", "copy", path.join(dir, "audio-only.m4a")]);
}

export const SUBTITLE_VTT = [
  "WEBVTT",
  "",
  "00:00:00.500 --> 00:00:01.500",
  "First cue",
  "",
  "00:00:02.000 --> 00:00:03.000",
  "Second cue",
  "",
].join("\n");

export interface ProbedStream {
  kind: string;
  codec: string;
}

export interface ProbedMedia {
  formatName: string;
  durationSec: number | null;
  streams: ProbedStream[];
  /** Which tool answered, so a fallback run is visible in a failure. */
  reader: "ffprobe" | "ffmpeg -i";
}

/** What a player would find in `file`: its container, its streams and its duration. */
export async function probeMedia(file: string): Promise<ProbedMedia> {
  const probed = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,codec_name",
    "-of",
    "json",
    file,
  ]);
  if (!probed.missing) {
    if (probed.code !== 0) throw new Error(`ffprobe exited ${probed.code}: ${probed.stderr}`);
    const parsed = JSON.parse(probed.stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: { codec_type?: string; codec_name?: string }[];
    };
    const duration = Number(parsed.format?.duration);
    return {
      formatName: parsed.format?.format_name ?? "",
      durationSec: Number.isFinite(duration) ? duration : null,
      streams: (parsed.streams ?? []).map((stream) => ({
        kind: stream.codec_type ?? "",
        codec: stream.codec_name ?? "",
      })),
      reader: "ffprobe",
    };
  }

  // `-i` alone exits 1 by design; the description on stderr is the answer.
  const described = await run(FFMPEG, ["-hide_banner", "-nostdin", "-i", file]);
  const match = /Duration: (\d+):(\d+):([\d.]+)/u.exec(described.stderr);
  const format = /Input #0, ([^,]+(?:,[^,]+)*?), from/u.exec(described.stderr);
  return {
    formatName: format?.[1] ?? "",
    durationSec:
      match === null ? null : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]),
    streams: [
      ...described.stderr.matchAll(/Stream #\d+:\d+.*?: (Video|Audio|Subtitle): (\w+)/gu),
    ].map((entry) => ({ kind: (entry[1] ?? "").toLowerCase(), codec: entry[2] ?? "" })),
    reader: "ffmpeg -i",
  };
}

/** Top-level MP4 box names in file order. */
export async function topLevelBoxes(file: string): Promise<string[]> {
  const buffer = await fs.readFile(file);
  const names: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const name = buffer.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize) break;
    names.push(name);
    offset += size;
  }
  return names;
}

/** Every path under `root`, relative and sorted; empty when `root` does not exist. */
export async function listTree(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true }).catch(() => [] as string[]);
  return entries.map(String).toSorted();
}
