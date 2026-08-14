/**
 * End-to-end sniffer tests against locally-served fixture pages.
 *
 * Every page is on 127.0.0.1: real sites change, rate-limit and geo-vary, which
 * makes CI failures meaningless.
 *
 * The definition of done for dl-2 lives in the first test: an MSE page whose
 * `<video>` carries a `blob:` URL, where DOM scraping gets nothing and network
 * capture gets the master playlist.
 */

import { AppError } from "@downloader/contract";
import type { ErrorCode, ProbeResult, ResolveOptions } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import {
  drmHlsParser,
  recordingDashParser,
  recordingHlsParser,
  throwingDashParser,
  throwingHlsParser,
} from "./helpers/fake-parsers.ts";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;

let server: FixtureServer;
let pool: BrowserPool;

beforeAll(async () => {
  server = await startFixtureServer();
  // One pooled Chromium for the whole file, closed in afterAll no matter what
  // happens, so a failing test can never leave an orphan behind.
  pool = new BrowserPool({ maxConcurrent: 1, headless: true });
});

afterAll(async () => {
  await pool.close();
  await server.close();
});

function options(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return {
    timeoutMs: PROBE_TIMEOUT_MS,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function probe(
  pathname: string,
  resolver: BrowserResolver,
  resolveOptions: ResolveOptions = options(),
): Promise<ProbeResult> {
  return await resolver.resolve(new URL(server.url(pathname)), resolveOptions);
}

async function probeError(pathname: string, resolver: BrowserResolver): Promise<AppError> {
  let caught: unknown;
  try {
    await probe(pathname, resolver);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  return caught as AppError;
}

function expectCode(error: AppError, code: ErrorCode): void {
  expect(error.code).toBe(code);
}

describe("BrowserResolver", () => {
  test("is the generic fallback for every http(s) URL", () => {
    const resolver = new BrowserResolver({ pool });
    expect(resolver.name).toBe("browser");
    expect(resolver.priority).toBe(50);
    expect(resolver.canHandle(new URL("https://example.com/watch"))).toBe(true);
    expect(resolver.canHandle(new URL("http://example.com/watch"))).toBe(true);
    expect(resolver.canHandle(new URL("file:///etc/passwd"))).toBe(false);
    expect(resolver.canHandle(new URL("data:text/html,<video>"))).toBe(false);
  });

  test(
    "captures the master playlist behind an MSE blob: player",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/mse.html", resolver);

      // The page reports the scheme of video.src in its title. Proving it was
      // blob: is what makes this the case DOM scraping cannot solve.
      expect(result.title).toContain("[blob]");

      expect(result.variants.length).toBeGreaterThan(0);
      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));

      // The master, not one of the variant playlists it names, and not a segment.
      expect(hls.calls).toHaveLength(1);
      expect(hls.calls[0]?.text).toContain("#EXT-X-STREAM-INF");
      expect(hls.calls[0]?.baseUrl).toBe(server.url("/media/mse/master.m3u8"));
      expect(result.variants).toHaveLength(2);

      expect(result.resolver).toBe("browser");
      expect(result.drm.protected).toBe(false);
      expect(Date.parse(result.probedAt)).toBeGreaterThan(0);
    },
  );

  test(
    "hands back a request context the engine can replay",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/mse.html", resolver);

      const headers = result.requestContext.headers;
      // Missing Referer is the single most common cause of a later 403.
      expect(headers["Referer"]).toBe(server.url("/mse.html"));
      expect(headers["User-Agent"]).toMatch(/Chrome\/\d+/);
      expect(headers["Accept-Language"]).toContain("en");
      // Connection-scoped headers describe the browser's socket, not ours.
      expect(headers["Host"]).toBeUndefined();
      expect(headers["Content-Length"]).toBeUndefined();
      expect(headers["Accept-Encoding"]).toBeUndefined();
    },
  );

  test(
    "sends Accept-Language from the requested locale",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/mse.html", resolver, options({ locale: "fr-CA" }));
      expect(result.requestContext.headers["Accept-Language"]).toContain("fr-CA");
    },
  );

  test(
    "dismisses a consent banner and captures a click-to-play HLS stream",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      // Nothing is fetched until the overlay is gone and the button is clicked,
      // so reaching a variant at all proves both steps ran.
      const result = await probe("/hls.html", resolver);

      expect(result.title).toBe("Quarterly all-hands recording");
      expect(result.thumbnailUrl).toBe(server.url("/media/poster.png"));
      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      expect(result.isLive).toBe(false);
    },
  );

  test(
    "captures a DASH manifest served from an extensionless signed URL",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dash = recordingDashParser();
      const resolver = new BrowserResolver({ pool, dashParser: dash.parser, quietMs: 1200 });
      const result = await probe("/dash.html", resolver);

      // Matched on Content-Type alone — the URL has no extension at all.
      expect(dash.calls).toHaveLength(1);
      expect(dash.calls[0]?.text).toContain("<MPD");
      expect(result.variants[0]?.protocol).toBe("dash");
      expect(result.variants[0]?.url).toContain("/media/dash/stream?token=");
      expect(result.durationSec).toBe(630);
      // `expires` in the signed query is surfaced so the caller can re-probe.
      expect(result.requestContext.expiresAt).toBe("2100-01-01T00:00:00.000Z");
    },
  );

  test(
    "captures a stream from a same-origin iframe embed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/iframe-parent.html", resolver);

      expect(result.title).toBe("Conference talk — embedded player");
      expect(result.variants[0]?.url).toBe(server.url("/media/embed/master.m3u8"));
    },
  );

  test(
    "falls back to an opaque variant when the parser throws",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({
        pool,
        hlsParser: throwingHlsParser,
        dashParser: throwingDashParser,
        quietMs: 1200,
      });
      const result = await probe("/mse.html", resolver);

      // A parser that cannot cope must degrade the answer, not fail the probe:
      // ffmpeg reads the playlist itself.
      expect(result.variants).toHaveLength(1);
      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
      expect(result.variants[0]?.label).toContain("HLS");
    },
  );

  test("works with the real parsers wired in", { timeout: TEST_TIMEOUT_MS }, async () => {
    // No injection: whatever dl-1 has landed is exercised for real.
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    const result = await probe("/mse.html", resolver);
    expect(result.variants.length).toBeGreaterThan(0);
    expect(result.variants[0]?.protocol).toBe("hls");
  });

  test(
    "stops with DRM_PROTECTED when the page negotiates EME",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const error = await probeError("/drm.html", resolver);

      expectCode(error, "DRM_PROTECTED");
      expect(error.retryable).toBe(false);
      expect(error.details?.["systems"]).toEqual(["widevine"]);
      expect(String(error.details?.["evidence"])).toContain("com.widevine.alpha");
    },
  );

  test(
    "treats a manifest-level DRM verdict as terminal too",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({ pool, hlsParser: drmHlsParser, quietMs: 1200 });
      const error = await probeError("/mse.html", resolver);
      expectCode(error, "DRM_PROTECTED");
      expect(error.details?.["systems"]).toEqual(["fairplay"]);
    },
  );

  test(
    "reports NO_MEDIA_FOUND when the page has no video",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({ pool, quietMs: 1200 });
      const error = await probeError("/no-media.html", resolver);
      // The one verdict that lets the registry fall through to another resolver.
      expectCode(error, "NO_MEDIA_FOUND");
    },
  );

  test("reports BOT_CHALLENGE on an interstitial", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    const error = await probeError("/challenge.html", resolver);
    expectCode(error, "BOT_CHALLENGE");
    expect(error.details?.["status"]).toBe(403);
  });

  test("reports AUTH_REQUIRED behind a login wall", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    const error = await probeError("/gated", resolver);
    expectCode(error, "AUTH_REQUIRED");
  });

  test("reports GEO_BLOCKED when the region is refused", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    const error = await probeError("/geo.html", resolver);
    expectCode(error, "GEO_BLOCKED");
  });

  test("reports UNREACHABLE when navigation fails", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    let caught: unknown;
    try {
      // Reserved TLD: guaranteed not to resolve, and no live host is contacted.
      await resolver.resolve(new URL("http://no-such-host.invalid/watch"), options());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expectCode(caught as AppError, "UNREACHABLE");
  });

  test("honours an already-aborted signal", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({ pool });
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      await probe("/mse.html", resolver, options({ signal: controller.signal }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expectCode(caught as AppError, "CANCELED");
  });

  test("a signal aborted by the time budget is still a TIMEOUT", async () => {
    const resolver = new BrowserResolver({ pool });
    let caught: unknown;
    try {
      await probe("/mse.html", resolver, options({ signal: AbortSignal.timeout(0) }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expectCode(caught as AppError, "TIMEOUT");
  });

  test("dispose() is safe when the pool was never used", async () => {
    const resolver = new BrowserResolver({ maxConcurrentBrowsers: 1 });
    await expect(resolver.dispose()).resolves.toBeUndefined();
  });
});
