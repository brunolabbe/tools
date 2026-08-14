import { describe, expect, test } from "vitest";
import type { MediaVariant, RequestContext } from "@downloader/contract";
import {
  buildDurationLimitArgs,
  buildNetworkInputArgs,
  GLOBAL_ARGS,
  PROGRESS_ARGS,
} from "../src/ffmpeg/args.ts";
import {
  buildFetchHeaders,
  buildRequestContextArgs,
  joinHeaderBlob,
  normalizeHeaders,
} from "../src/ffmpeg/headers.ts";
import { buildTaskkillArgs } from "../src/ffmpeg/kill.ts";
import { buildManifestDownloadArgs } from "../src/download/manifest.ts";

const CONTEXT: RequestContext = {
  headers: {
    Referer: "https://site.example/watch/1",
    Origin: "https://site.example",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Cookie: "session=abc123",
  },
};

describe("header normalisation", () => {
  test("lower-cases names and lifts User-Agent out for -user_agent", () => {
    const { headers, userAgent } = normalizeHeaders(CONTEXT.headers);

    expect(headers).toEqual({
      referer: "https://site.example/watch/1",
      origin: "https://site.example",
      cookie: "session=abc123",
    });
    expect(userAgent).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(headers["user-agent"]).toBeUndefined();
  });

  test("drops HTTP/2 pseudo-headers a browser capture carries", () => {
    const { headers } = normalizeHeaders({
      ":authority": "site.example",
      ":method": "GET",
      ":path": "/master.m3u8",
      referer: "https://site.example/",
    });

    expect(Object.keys(headers)).toEqual(["referer"]);
  });

  test("drops Range so a captured player header cannot truncate the download", () => {
    const { headers } = normalizeHeaders({
      Range: "bytes=0-1023",
      Host: "site.example",
      Connection: "keep-alive",
      "If-None-Match": '"abc"',
      Referer: "https://site.example/",
    });

    expect(Object.keys(headers)).toEqual(["referer"]);
  });

  test("strips CR and LF so a header value cannot inject extra headers", () => {
    const { headers } = normalizeHeaders({
      Referer: "https://site.example/\r\nX-Injected: yes",
    });
    const blob = joinHeaderBlob(headers);

    // The injected name folds into the Referer value: one header line, not two.
    expect(headers["referer"]).toBe("https://site.example/X-Injected: yes");
    expect(blob).toBe("referer: https://site.example/X-Injected: yes\r\n");
    expect(blob.split("\r\n").filter((line) => line.length > 0)).toHaveLength(1);
    expect(headers["x-injected"]).toBeUndefined();
  });

  test("joins with CRLF and terminates the final line", () => {
    expect(joinHeaderBlob({ a: "1", b: "2" })).toBe("a: 1\r\nb: 2\r\n");
    expect(joinHeaderBlob({})).toBe("");
  });

  test("buildRequestContextArgs passes the blob as a single argv element", () => {
    const args = buildRequestContextArgs(CONTEXT);

    expect(args[0]).toBe("-headers");
    expect(args[1]).toBe(
      "referer: https://site.example/watch/1\r\norigin: https://site.example\r\ncookie: session=abc123\r\n",
    );
    expect(args[2]).toBe("-user_agent");
    expect(args[3]).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    // Everything is a discrete element; nothing is shell-quoted or joined.
    expect(args.every((arg) => typeof arg === "string")).toBe(true);
  });

  test("buildFetchHeaders keeps User-Agent, since fetch has no separate option", () => {
    expect(buildFetchHeaders(CONTEXT)["user-agent"]).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    expect(buildFetchHeaders(undefined)).toEqual({});
  });
});

describe("input arguments", () => {
  test("a remote input may not reference local files", () => {
    const args = buildNetworkInputArgs("https://cdn.example/master.m3u8", {
      requestContext: CONTEXT,
      hlsAllowAllExtensions: true,
    });

    const whitelist = args[args.indexOf("-protocol_whitelist") + 1];
    expect(whitelist).toBeDefined();
    expect(whitelist).not.toContain("file");
    expect(args).toContain("-allowed_extensions");
    expect(args.at(-2)).toBe("-i");
    expect(args.at(-1)).toBe("https://cdn.example/master.m3u8");
  });

  test("headers precede the -i they apply to", () => {
    const args = buildNetworkInputArgs("https://cdn.example/v.m3u8", { requestContext: CONTEXT });
    expect(args.indexOf("-headers")).toBeLessThan(args.indexOf("-i"));
    expect(args.indexOf("-user_agent")).toBeLessThan(args.indexOf("-i"));
  });

  test("-t is emitted only for a real duration limit", () => {
    expect(buildDurationLimitArgs(30)).toEqual(["-t", "30"]);
    expect(buildDurationLimitArgs(null)).toEqual([]);
    expect(buildDurationLimitArgs(0)).toEqual([]);
    expect(buildDurationLimitArgs(undefined)).toEqual([]);
  });
});

const HLS_VARIANT: MediaVariant = {
  id: "v0",
  protocol: "hls",
  url: "https://cdn.example/master.m3u8",
  hasVideo: true,
  hasAudio: true,
  videoCodec: "avc1.640028",
  audioCodec: "mp4a.40.2",
  label: "1080p",
};

function hlsArgs(overrides: Record<string, unknown> = {}): string[] {
  return buildManifestDownloadArgs({
    url: HLS_VARIANT.url,
    destPath: "/storage/tmp/j/media.mp4",
    container: "mp4",
    protocol: "hls",
    requestContext: CONTEXT,
    hasVideo: true,
    hasAudio: true,
    videoCodec: HLS_VARIANT.videoCodec,
    audioCodec: HLS_VARIANT.audioCodec,
    ffmpegPath: "/bin/ffmpeg",
    ...overrides,
  }).args;
}

describe("manifest download arguments", () => {
  test("carries the non-obvious flags the analysis calls out", () => {
    const args = hlsArgs();

    expect(args.slice(0, GLOBAL_ARGS.length)).toEqual([...GLOBAL_ARGS]);
    for (const arg of PROGRESS_ARGS) expect(args).toContain(arg);

    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args[args.indexOf("-bsf:a") + 1]).toBe("aac_adtstoasc");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args.at(-1)).toBe("/storage/tmp/j/media.mp4");
  });

  test("maps one video and one audio stream explicitly", () => {
    const args = hlsArgs();
    const maps = args.filter((arg, index) => args[index - 1] === "-map");
    expect(maps).toEqual(["0:v:0?", "0:a:0?"]);
  });

  test("a separate audio rendition becomes a second input with its own headers", () => {
    const args = hlsArgs({ audioUrl: "https://cdn.example/audio.m3u8" });

    expect(args.filter((arg) => arg === "-i")).toHaveLength(2);
    // Segments are gated too — the context is replayed for the audio input.
    expect(args.filter((arg) => arg === "-headers")).toHaveLength(2);
    expect(args.filter((arg) => arg === "-user_agent")).toHaveLength(2);

    const maps = args.filter((arg, index) => args[index - 1] === "-map");
    expect(maps).toEqual(["0:v:0?", "1:a:0?"]);
  });

  test("a live source is bounded with -t", () => {
    const args = hlsArgs({ liveDurationSec: 45 });
    expect(args[args.indexOf("-t") + 1]).toBe("45");
  });

  test("DASH does not get the ADTS bitstream filter", () => {
    const args = buildManifestDownloadArgs({
      url: "https://cdn.example/manifest.mpd",
      audioUrl: "https://cdn.example/audio.mpd",
      destPath: "/storage/tmp/j/media.mp4",
      container: "mp4",
      protocol: "dash",
      requestContext: CONTEXT,
      hasVideo: true,
      hasAudio: true,
      ffmpegPath: "/bin/ffmpeg",
    }).args;

    expect(args).not.toContain("-bsf:a");
    expect(args).not.toContain("-allowed_extensions");
  });

  test("audio-only with a separate rendition never opens the video manifest", () => {
    const args = hlsArgs({ audioUrl: "https://cdn.example/audio.m3u8", audioOnly: true });

    expect(args.filter((arg) => arg === "-i")).toHaveLength(1);
    expect(args).toContain("https://cdn.example/audio.m3u8");
    expect(args).not.toContain(HLS_VARIANT.url);
  });

  test("no argument is a joined command line", () => {
    for (const arg of hlsArgs()) {
      expect(arg.includes(" -")).toBe(false);
    }
  });
});

describe("process-tree kill", () => {
  test("taskkill gets /T and /F so children die with the parent", () => {
    expect(buildTaskkillArgs(4242)).toEqual(["/PID", "4242", "/T", "/F"]);
  });
});
