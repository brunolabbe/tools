import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AppError } from "@downloader/contract";
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

/**
 * A JSON `null` codec, which is what the **generic** extractor emits — the path
 * taken for every page yt-dlp has no site-specific extractor for, so the common
 * one rather than an exotic one.
 *
 * `generic-null-vcodec.json` is real output, captured from yt-dlp 2025.09.26
 * against a loopback fixture serving `<video src='/clip.mp4'>`, with the host
 * rewritten and the fields the mapper never reads dropped. Kept as a payload
 * rather than hand-written because the value under test is `null` versus an
 * absent key, and a hand-written fixture is exactly where that distinction gets
 * lost.
 *
 * Found while measuring dl-37 and present at `origin/main`: `realCodec` filtered
 * `undefined`, `""` and `"none"` and not `null`, so `null` was the one value
 * that survived as a *real* codec — `hasVideo` went true on it and `codecLabel`
 * then called `.trim()` on `null`. A bare `TypeError`, which reaches a caller as
 * `INTERNAL` / "Something went wrong on our end" and stops the resolver chain,
 * for an ordinary page.
 */
describe("a codec yt-dlp reports as JSON null", () => {
  test("is read as 'not reported' rather than surviving as a codec", () => {
    const probe = mapYtDlpInfo(
      fixture("generic-null-vcodec"),
      "https://vod.example.com/watch",
      "yt-dlp",
      {},
    );

    // Nothing said this format carries video — no codec and no height — so it
    // contributes no variant, exactly as an absent `vcodec` key already did.
    // Before the fix this line threw instead of returning.
    expect(probe.variants).toEqual([]);
  });

  test("still reaches the label path when something else proves there is video", () => {
    // The other half, and the one that isolates the crash from the skip: with a
    // `height` the format *is* usable, so `null` travels all the way into
    // `codecLabel` — the call that threw. The label has to come out naming the
    // resolution and no codec, rather than naming `null` or not existing.
    const info = fixture("generic-null-vcodec");
    const format = info.formats?.[0];
    if (format === undefined) throw new Error("the fixture lost its format");
    format.height = 720;
    format.filesize = 10_000_000;

    const probe = mapYtDlpInfo(info, "https://vod.example.com/watch", "yt-dlp", {});

    expect(probe.variants).toHaveLength(1);
    expect(probe.variants[0]?.hasVideo).toBe(true);
    expect(probe.variants[0]?.videoCodec).toBeUndefined();
    expect(probe.variants[0]?.label).toBe("720p · 9.5 MB");
  });

  test("degrades the whole probe to NO_MEDIA_FOUND, which falls through to the sniffer", () => {
    // The verdict is the part that matters to a caller, and it is the reason
    // this is a defect rather than an untidiness: `NO_MEDIA_FOUND` moves to the
    // next resolver (`registry.ts`), and the `INTERNAL` this used to raise stops
    // the chain — so a page the browser tier would have handled failed outright.
    return expect(
      fakeResolver("generic-null-vcodec").resolve(SOURCE, options()),
    ).rejects.toMatchObject({ code: "NO_MEDIA_FOUND" });
  });
});

describe("the spawn path", () => {
  test("resolves a probe from the process output", async () => {
    const probe = await fakeResolver("youtube-like").resolve(SOURCE, options());
    expect(probe.resolver).toBe("yt-dlp");
    expect(probe.sourceUrl).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(probe.variants.length).toBeGreaterThan(0);
  });

  test("the proxy it is given reaches the process as --proxy", async () => {
    // Since dl-12 that proxy is the API's guarded loopback one, and it is the
    // only thing standing between this subprocess and an unchecked socket. The
    // fake binary reports its own arguments as the title.
    const probe = await fakeResolver("echo-args").resolve(
      SOURCE,
      options({ proxyUrl: "http://127.0.0.1:45999" }),
    );

    expect(probe.title).toContain("--proxy http://127.0.0.1:45999");
  });

  test("an empty proxy is not passed at all", async () => {
    const probe = await fakeResolver("echo-args").resolve(SOURCE, options({ proxyUrl: "" }));

    expect(probe.title).not.toContain("--proxy");
  });

  /**
   * dl-37: behind a proxy that terminates TLS, yt-dlp has to be told to trust
   * the leaf that proxy mints, and doing so takes two things rather than one.
   *
   * Measured with the real 2025.09.26 binary against a self-signed loopback
   * origin, all four states: `SSL_CERT_FILE` alone fails, `REQUESTS_CA_BUNDLE`
   * fails, `CURL_CA_BUNDLE` fails, and only `SSL_CERT_FILE` **with**
   * `--compat-options no-certifi` verifies — because the PyInstaller build
   * carries its own `certifi` and prefers it. Half of this pair is the exact
   * shape of a fix that looks applied and does nothing.
   */
  test("a terminating proxy's trust bundle reaches the process as both halves", async () => {
    const resolver = new YtDlpResolver({
      binaryPath: process.execPath,
      binaryArgs: [FAKE_BINARY, "echo-args"],
      proxyTrustBundlePath: "/tmp/egress-trust-bundle.pem",
    });

    const probe = await resolver.resolve(SOURCE, options({ proxyUrl: "http://127.0.0.1:45999" }));

    expect(probe.title).toContain("--compat-options no-certifi");
    expect(probe.title).toContain("SSL_CERT_FILE=/tmp/egress-trust-bundle.pem");
  });

  test("and not at all when there is no proxy to be trusting a leaf from", async () => {
    // Without a proxy yt-dlp meets real origins, and replacing its trust store
    // with a bundle whose point is one locally-minted root is a way to fail
    // closed on everything. Both halves have to be absent, not just the flag.
    const resolver = new YtDlpResolver({
      binaryPath: process.execPath,
      binaryArgs: [FAKE_BINARY, "echo-args"],
      proxyTrustBundlePath: "/tmp/egress-trust-bundle.pem",
    });

    const probe = await resolver.resolve(SOURCE, options());

    expect(probe.title).not.toContain("no-certifi");
    // The fixture appends the variable unconditionally, so an empty tail is
    // "the child inherited this process's environment and nothing was added".
    expect(probe.title).toMatch(/SSL_CERT_FILE=$/u);
  });

  test("without the option nothing about the child's environment changes", async () => {
    const probe = await fakeResolver("echo-args").resolve(
      SOURCE,
      options({ proxyUrl: "http://127.0.0.1:45999" }),
    );

    expect(probe.title).not.toContain("no-certifi");
    expect(probe.title).toMatch(/SSL_CERT_FILE=$/u);
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

  // dl-34. The whole point of the ticket: this stderr used to take the
  // `NO_MEDIA_FOUND` default, so an operator on a private-root deployment was
  // told "No downloadable video stream was found on that page" for a trust
  // problem — a sentence that points at the source and hides the setting.
  describe("a refused certificate", () => {
    test("is TLS_VERIFICATION_FAILED, not the NO_MEDIA_FOUND default", async () => {
      const error = (await fakeResolver("tls")
        .resolve(SOURCE, options())
        .catch((caught: unknown) => caught)) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      expect(error.code).not.toBe("NO_MEDIA_FOUND");
    });

    // That this *stops the chain* — the behaviour change on top of the copy
    // change — is proven in `registry.test.ts`, where a second tier exists to
    // observe not being called. Asserting `retryable === false` here would look
    // like that proof and would not be one: `NO_MEDIA_FOUND` is not retryable
    // either, so the assertion passes with the fix reverted.

    test("names the setting for the operator, and not for the client", async () => {
      const error = (await fakeResolver("tls")
        .resolve(SOURCE, options())
        .catch((caught: unknown) => caught)) as AppError;
      expect(error.details?.["hint"]).toContain("EGRESS_CA_FILE");
      expect(error.details?.["reason"]).toBe("certificate_verify_failed");
      // `hint` is absent from `http-errors.ts`'s CLIENT_SAFE_DETAIL_KEYS, so it
      // reaches the log and not the page. The user-facing half is the finished
      // copy the web app already has for this code.
      expect(error.message).not.toContain("EGRESS_CA_FILE");
    });

    test("is recognised in libcurl's wording too", async () => {
      await expect(fakeResolver("tls-curl").resolve(SOURCE, options())).rejects.toMatchObject({
        code: "TLS_VERIFICATION_FAILED",
      });
    });

    // Gate finding on dl-34. "unable to get local issuer certificate" is
    // Python's message for an *incomplete chain*, not for an untrusted root —
    // and it is ambiguous between a private-root deployment and an ordinary
    // public-site misconfiguration a browser tier frequently repairs itself
    // (AIA chasing). It must degrade exactly as it did before this ticket,
    // not hard-stop the chain on a diagnosis this tier cannot actually make.
    test("an incomplete chain is left as NO_MEDIA_FOUND, not hard-stopped", async () => {
      await expect(
        fakeResolver("tls-incomplete-chain").resolve(SOURCE, options()),
      ).rejects.toMatchObject({ code: "NO_MEDIA_FOUND" });
    });

    test("outranks the looser source-fact matches in the same stderr", async () => {
      // `drm`, `sign in` and `in your country` are substring matches on the
      // same buffer. A handshake that failed means yt-dlp never read the page,
      // so none of them can be a fact about the source — which is why the
      // certificate branch runs first.
      await expect(fakeResolver("tls-and-drm").resolve(SOURCE, options())).rejects.toMatchObject({
        code: "TLS_VERIFICATION_FAILED",
      });
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

function mediaPlaylist(): string {
  return readFileSync(
    new URL("./fixtures/manifests/hls-media-aes128.m3u8", import.meta.url),
    "utf8",
  );
}

describe("weighing a rendition (dl-30)", () => {
  const MANIFEST =
    "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1772294400/itag/96/index.m3u8";

  test("with no fetch injected nothing is weighed and nothing changes", async () => {
    const probe = await fakeResolver("youtube-like").resolve(SOURCE, options());
    const muxed = probe.variants.find((variant) => variant.id === "96");

    // `tbr` x duration, exactly as it was before this ticket: 4 666.503 kbps
    // over 635 s. No fetch exists, so no request could have been made.
    expect(muxed?.filesizeBytes).toBe(Math.round((4666.503 * 1000 * 635) / 8));
    expect(muxed?.filesizeIsEstimate).toBe(true);
  });

  test("with a fetch injected the top rung is sampled and the ladder rescaled", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "HEAD") {
        // 700 000 bytes for each second of the 9.97667 s segment.
        return await Promise.resolve(
          new Response(null, { headers: { "content-length": "6983669" } }),
        );
      }
      return await Promise.resolve(new Response(mediaPlaylist()));
    };

    const resolver = new YtDlpResolver({
      binaryPath: process.execPath,
      binaryArgs: [FAKE_BINARY, "youtube-like"],
      fetch: fetchImpl,
    });
    const probe = await resolver.resolve(SOURCE, options());
    const muxed = probe.variants.find((variant) => variant.id === "96");

    // 700 000 B/s measured against 583 312 B/s declared is a factor of 1.2, so
    // this fixture's declaration understates rather than overstates — the
    // correction has to work in both directions or it is a fudge.
    const declared = Math.round((4666.503 * 1000 * 635) / 8);
    expect(muxed?.filesizeBytes).toBeGreaterThan(declared);
    expect(muxed?.filesizeIsEstimate).toBe(true);

    // A format yt-dlp measured itself is left alone: 137 carries a real
    // `filesize`, which beats anything we could infer from another rung.
    const measuredByYtDlp = probe.variants.find((variant) => variant.id === "137");
    expect(measuredByYtDlp?.filesizeBytes).toBe(349605888 + 11238910);
    expect(measuredByYtDlp?.filesizeIsEstimate).toBe(false);

    expect(calls[0]).toBe(`GET ${MANIFEST}`);
    // The playlist, then one HEAD per segment: six here, under the cap of eight.
    expect(calls).toHaveLength(7);
  });
});
