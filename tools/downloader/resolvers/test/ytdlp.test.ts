import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResolveOptions } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { mapProtocol, mapYtDlpInfo, YtDlpResolver } from "../src/resolvers/ytdlp.ts";
import type { YtDlpInfo } from "../src/resolvers/ytdlp.ts";

const FAKE_BINARY = fileURLToPath(new URL("./fixtures/ytdlp/fake-ytdlp.mjs", import.meta.url));

function fixture(name: string): YtDlpInfo {
  const raw = readFileSync(new URL(`./fixtures/ytdlp/${name}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as YtDlpInfo;
}

/** Runs the real spawn path against a stand-in binary; `mode` selects its behaviour. */
function fakeResolver(mode: string): YtDlpResolver {
  return new YtDlpResolver({ binaryPath: process.execPath, binaryArgs: [FAKE_BINARY, mode] });
}

function options(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return { timeoutMs: 20_000, signal: new AbortController().signal, ...overrides };
}

const SOURCE = new URL("https://www.youtube.com/watch?v=aqz-KE-bpKQ");

describe("availability", () => {
  test("a missing binary makes canHandle false rather than throwing", () => {
    const resolver = new YtDlpResolver({ binaryPath: "yt-dlp-definitely-not-installed" });
    expect(resolver.available).toBe(false);
    expect(resolver.canHandle(SOURCE)).toBe(false);
  });

  test("ENABLE_YTDLP_RESOLVER=false behaves exactly like a missing binary", () => {
    const resolver = new YtDlpResolver({
      binaryPath: process.execPath,
      env: { ENABLE_YTDLP_RESOLVER: "false" },
    });
    expect(resolver.available).toBe(false);
    expect(resolver.canHandle(SOURCE)).toBe(false);
  });

  test("an existing binary handles http(s) only, at priority 20", () => {
    const resolver = fakeResolver("youtube-like");
    expect(resolver.available).toBe(true);
    expect(resolver.priority).toBe(20);
    expect(resolver.canHandle(SOURCE)).toBe(true);
    expect(resolver.canHandle(new URL("file:///c:/video.mp4"))).toBe(false);
  });
});

describe("protocol mapping", () => {
  test("maps yt-dlp protocol strings onto the shared taxonomy", () => {
    expect(mapProtocol("m3u8_native")).toBe("hls");
    expect(mapProtocol("m3u8")).toBe("hls");
    expect(mapProtocol("http_dash_segments")).toBe("dash");
    expect(mapProtocol("https")).toBe("progressive");
    expect(mapProtocol("http")).toBe("progressive");
    expect(mapProtocol("rtmp")).toBe("other");
    expect(mapProtocol(undefined)).toBe("other");
  });
});

describe("format mapping", () => {
  const probe = mapYtDlpInfo(fixture("youtube-like"), SOURCE.href, "yt-dlp", {});

  test("skips storyboards and keeps every real rendition", () => {
    expect(probe.variants.map((variant) => variant.id)).not.toContain("sb0");
    expect(probe.variants).toHaveLength(6);
    expect(probe.title).toContain("Big Buck Bunny");
    expect(probe.durationSec).toBe(635);
    expect(probe.thumbnailUrl).toContain("maxresdefault");
    expect(probe.isLive).toBe(false);
  });

  test('"none" means the stream is absent, not a codec called none', () => {
    const audioOnly = probe.variants.find((variant) => variant.id === "140");
    expect(audioOnly?.hasVideo).toBe(false);
    expect(audioOnly?.videoCodec).toBeUndefined();
    expect(audioOnly?.audioCodec).toBe("mp4a.40.2");
    expect(audioOnly?.label).toBe("Audio only · AAC · 9.8 MB");
  });

  test("pairs a video-only format with the best audio-only format", () => {
    const videoOnly = probe.variants.find((variant) => variant.id === "137");
    expect(videoOnly?.hasVideo).toBe(true);
    expect(videoOnly?.hasAudio).toBe(true);
    // 251 (opus, 141.63 kbps) beats 140 (aac, 129.48 kbps).
    expect(videoOnly?.audioUrl).toContain("itag=251");
    expect(videoOnly?.audioCodec).toBe("opus");
    expect(videoOnly?.label).toBe("1080p60 · H.264 + Opus · 344 MB");
  });

  test("a muxed format is left alone", () => {
    const muxed = probe.variants.find((variant) => variant.id === "18");
    expect(muxed?.audioUrl).toBeUndefined();
    expect(muxed?.videoCodec).toBe("avc1.42001E");
    expect(muxed?.audioCodec).toBe("mp4a.40.2");
  });

  test("filesize versus filesize_approx sets filesizeIsEstimate", () => {
    expect(probe.variants.find((variant) => variant.id === "137")).toMatchObject({
      filesizeBytes: 349_605_888 + 11_238_910,
      filesizeIsEstimate: false,
    });
    expect(probe.variants.find((variant) => variant.id === "248")).toMatchObject({
      filesizeIsEstimate: true,
    });
  });

  test("maps the per-format protocol", () => {
    expect(probe.variants.find((variant) => variant.id === "96")?.protocol).toBe("hls");
    expect(probe.variants.find((variant) => variant.id === "137")?.protocol).toBe("progressive");
  });

  test("orders variants best-first", () => {
    expect(probe.variants[0]?.height).toBe(1080);
    expect(probe.variants.at(-1)?.hasVideo).toBe(false);
  });

  test("copies http_headers into the request context", () => {
    expect(probe.requestContext.headers["User-Agent"]).toContain("Chrome/131");
    expect(probe.requestContext.headers["Referer"]).toBe("https://www.youtube.com/");
  });

  test("caller cookies and locale are merged into the request context", () => {
    const withSession = mapYtDlpInfo(fixture("youtube-like"), SOURCE.href, "yt-dlp", {
      cookieHeader: "SID=xyz",
      locale: "de-DE",
    });
    expect(withSession.requestContext.headers["Cookie"]).toBe("SID=xyz");
    expect(withSession.requestContext.headers["Accept-Language"]).toBe("de-DE");
  });

  test("separates real subtitles from automatic captions", () => {
    const manual = probe.subtitles.filter((track) => !track.autoGenerated);
    const auto = probe.subtitles.filter((track) => track.autoGenerated);
    expect(manual.map((track) => track.language)).toEqual(["en", "fr"]);
    expect(auto.map((track) => track.language)).toEqual(["en", "es"]);
    expect(manual[0]).toMatchObject({ id: "sub-en", format: "vtt" });
    expect(auto[0]).toMatchObject({ id: "auto-en", format: "vtt", autoGenerated: true });
    // One track per language: the srv3 serialisation of English is dropped.
    expect(probe.subtitles).toHaveLength(4);
  });

  test("has_drm on every format is reported as DRM", () => {
    const drm = mapYtDlpInfo(fixture("drm-only"), "https://vod.example.com/watch/x", "yt-dlp", {});
    expect(drm.drm.protected).toBe(true);
    expect(drm.drm.evidence).toContain("has_drm");
  });
});

describe("the spawn path", () => {
  test("resolves a probe from the process output", async () => {
    const probe = await fakeResolver("youtube-like").resolve(SOURCE, options());
    expect(probe.resolver).toBe("yt-dlp");
    expect(probe.sourceUrl).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(probe.variants.length).toBeGreaterThan(0);
  });

  test("an unsupported URL falls through with NO_MEDIA_FOUND", async () => {
    await expect(fakeResolver("unsupported").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "NO_MEDIA_FOUND",
    });
  });

  test("unreadable output falls through rather than failing the request", async () => {
    await expect(fakeResolver("garbage").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "NO_MEDIA_FOUND",
    });
  });

  test("a DRM-protected source stops the chain", async () => {
    await expect(fakeResolver("drm").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "DRM_PROTECTED",
    });
  });

  test("a DRM-only format list stops the chain", async () => {
    await expect(fakeResolver("drm-only").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "DRM_PROTECTED",
    });
  });

  test("a login wall is AUTH_REQUIRED", async () => {
    await expect(fakeResolver("login").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  test("a region block is GEO_BLOCKED", async () => {
    await expect(fakeResolver("geo").resolve(SOURCE, options())).rejects.toMatchObject({
      code: "GEO_BLOCKED",
    });
  });

  test("an abort kills the process instead of hanging", async () => {
    const controller = new AbortController();
    const pending = fakeResolver("hang").resolve(SOURCE, options({ signal: controller.signal }));
    setTimeout(() => {
      controller.abort();
    }, 150);
    await expect(pending).rejects.toThrow();
  });
});
