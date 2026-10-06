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
import type { ErrorCode, ProbeResult, ProbeStageEvent, ResolveOptions } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import type { BrowserResolverLogger } from "../../src/resolvers/browser.ts";
import {
  drmHlsParser,
  recordingDashParser,
  recordingHlsParser,
  throwingDashParser,
  throwingHlsParser,
} from "./helpers/fake-parsers.ts";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";
import { PROGRESSIVE_FILE_BYTES, startProgressiveServer } from "./helpers/progressive-server.ts";
import type { ProgressiveServer } from "./helpers/progressive-server.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;
/**
 * The floor the ten no-media tests pass as `emptyMinWaitMs` (dl-80): equal to
 * the resolver's own `MIN_WAIT_MS`, so the extended floor adds nothing and they
 * run for what they did before it existed. Their verdicts come from the page,
 * not from how long the probe waited. A smaller value would not be "off" — it
 * would shorten the wait below the base rule's.
 */
const NO_EMPTY_FLOOR_MS = 1200;

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
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
      });
      const error = await probeError("/no-media.html", resolver);
      // The one verdict that lets the registry fall through to another resolver.
      expectCode(error, "NO_MEDIA_FOUND");
    },
  );

  describe("the surface click chooses the player, not a related-video card (dl-55)", () => {
    test(
      "starts the real player and never reaches the card's own page or stream",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        server.requests.length = 0;
        const result = await probe("/related-card.html", resolver);

        expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
        expect(server.requests).toContain("/media/related/master.m3u8");
        // A click that bubbled through the card's `<a href>` would have left
        // this page entirely; neither the card's target nor its stream is ever
        // requested.
        expect(server.requests).not.toContain("/related-card-target.html");
        expect(server.requests).not.toContain("/media/related-target/master.m3u8");
      },
    );

    test(
      "picks the largest visible candidate, not the first in document order",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        // A first-qualifying (rather than largest) chooser would land the
        // click on the small, listener-less decoy, and the real player would
        // never be clicked at all.
        const result = await probe("/related-card-area.html", resolver);

        expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      },
    );

    test(
      "makes no click, and never navigates, when the only video is a card",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({
          pool,
          quietMs: 1200,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
        });
        server.requests.length = 0;
        const error = await probeError("/related-card-only-linked.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        // Plain absence, not the guard catching a click that navigated: a
        // chooser that fell back to "any video" when none qualified would
        // have clicked the card, bubbled through its `<a href>`, navigated,
        // and requested the target page — none of which may happen.
        expect(error.details?.["reason"]).not.toBe("navigated-away");
        expect(server.requests).not.toContain("/related-card-target.html");
      },
    );
  });

  describe("a navigation away from the landing page fails NO_MEDIA_FOUND (dl-55)", () => {
    test(
      "a same-document navigation (history.pushState) never returns the other page's stream",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({ pool, quietMs: 1200 });
        server.requests.length = 0;
        const error = await probeError("/guard-pushstate.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        expect(error.details?.["reason"]).toBe("navigated-away");
      },
    );

    test(
      "a document navigation (location.assign) never returns the other page's stream",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({ pool, quietMs: 1200 });
        const error = await probeError("/guard-assign.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        expect(error.details?.["reason"]).toBe("navigated-away");
      },
    );

    test(
      "reports the departure to the injected logger, naming the step and both URLs",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const warnings: { message: string; fields: Record<string, unknown> | undefined }[] = [];
        const logger: BrowserResolverLogger = {
          warn: (message, fields) => {
            warnings.push({ message, fields });
          },
        };
        const resolver = new BrowserResolver({ pool, quietMs: 1200, logger });
        await probeError("/guard-assign.html", resolver);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.message).toMatch(/left the landing page/i);
        // The click that starts the navigation runs during provoke-playback,
        // but `framenavigated` fires once the navigation itself completes,
        // which can land either side of the stage boundary.
        expect(["provoke-playback", "network-quiet"]).toContain(warnings[0]?.fields?.["step"]);
        expect(String(warnings[0]?.fields?.["landingUrl"])).toBe(server.url("/guard-assign.html"));
        expect(String(warnings[0]?.fields?.["departedTo"])).toBe(server.url("/mse.html"));
      },
    );

    test(
      "a redirect during load is not a departure, and the page still probes",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-redirect", resolver);
        expect(result.title).toContain("[blob]");
      },
    );

    test(
      "a fragment-only change on play is not a departure, and the page still probes",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-fragment.html", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "a script redirect ~200ms after load is not a departure (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-script-redirect.html", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "a router history.replaceState ~300ms in is not a departure (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-router-rewrite.html?utm_source=newsletter", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "the landing URL is the page reached after a redirect, not the one requested (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // A `landingUrl` wrongly set to the requested URL would flag this
        // target's own fragment-only play as a departure — `/guard-redirect`
        // alone cannot tell the two apart, since nothing navigates again
        // after it (see the Log).
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-redirect-then-fragment", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );
  });

  describe("play-time query rewrites are not a departure, within a narrow exception (dl-55, decision 1)", () => {
    test.each(["t", "start", "autoplay"])(
      "adding ?%s= on play is not a departure",
      { timeout: TEST_TIMEOUT_MS },
      async (param) => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe(`/guard-query.html?rewrite=${param}`, resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "a query key outside the exception is still a departure",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({ pool, quietMs: 1200 });
        const error = await probeError("/guard-query.html?rewrite=other", resolver);
        expectCode(error, "NO_MEDIA_FOUND");
        expect(error.details?.["reason"]).toBe("navigated-away");
      },
    );

    test(
      "a reordered query string is not a departure (dl-55, decision 5)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // No parameter's value changes, only the order the same two appear
        // in — the owner's answer named only t/start/autoplay as allowed to
        // differ and said nothing about order, so this pins the current
        // behaviour (URLSearchParams sorted before comparison) as intended
        // rather than incidental.
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        const result = await probe("/guard-query.html?rewrite=reorder&v=abc&list=PL1", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );
  });

  describe("the cross-origin chooser picks the player, not a JS-click card (dl-55, decision 3)", () => {
    test(
      "starts the real player in a genuinely cross-origin frame, never the card",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        server.requests.length = 0;
        const result = await probe("/cross-origin-card.html", resolver);

        // The player lives in the secondary (cross-origin) frame, so its
        // request is made against that origin, not the primary one.
        expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
        expect(server.requests).toContain("/media/related/master.m3u8");
        // A click that landed on the card would have navigated the subframe
        // to its target — which the top-frame guard cannot even see — so the
        // only proof this never happened is that it was never requested.
        expect(server.requests).not.toContain("/related-card-target.html");
      },
    );
  });

  describe("a modal over an age gate (dl-48)", () => {
    const PROMO_PATH = "/age-gate-promo.html";

    test(
      "closes the modal through its close control and, told to confirm ages, finds the stream",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // The recording parser, as the MSE test uses, so the variant URL is the
        // master the page fetched rather than a rendition parsed out of it.
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          quietMs: 1200,
          confirmAge: true,
        });
        server.requests.length = 0;
        const result = await probe("/age-gate.html", resolver);

        expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
        expect(server.requests).toContain("/beacon/modal-closed");
        expect(server.requests).toContain("/beacon/age-confirmed");
        // A stream reached through the promo's own button would be the wrong
        // stream, and would pass the assertion above.
        expect(server.requests).not.toContain(PROMO_PATH);
      },
    );

    test(
      "meets a modal and a gate that mount after the playback passes are over",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        // A quiet window longer than the delay: the page is otherwise idle, and
        // what is under test is that the wait looks again, not that it lasts.
        const resolver = new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          quietMs: 6000,
          confirmAge: true,
        });
        server.requests.length = 0;
        const result = await probe("/age-gate.html?late=3500", resolver);

        expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
        expect(server.requests).toContain("/beacon/modal-closed");
        expect(server.requests).toContain("/beacon/age-confirmed");
      },
    );

    test(
      "not told to confirm ages, fails AGE_CONFIRMATION_REQUIRED without pressing the gate",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({
          pool,
          quietMs: 1200,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
        });
        server.requests.length = 0;
        const error = await probeError("/age-gate.html", resolver);

        expectCode(error, "AGE_CONFIRMATION_REQUIRED");
        expect(error.details?.["marker"]).toBe("adults only");
        expect(server.requests).toContain("/beacon/modal-closed");
        expect(server.requests).not.toContain("/beacon/age-confirmed");
        expect(server.requests).not.toContain(PROMO_PATH);
        expect(server.requests).not.toContain("/media/mse/master.m3u8");
      },
    );

    test(
      "presses Escape on a dialog it finds no close control in",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
        server.requests.length = 0;
        const result = await probe("/modal-escape.html", resolver);

        expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
        expect(server.requests).toContain("/beacon/modal-escaped");
        expect(server.requests).not.toContain("/modal-escape-promo.html");
      },
    );

    test(
      "a press that leaves the gate standing fails NO_MEDIA_FOUND, not the refusal",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({
          pool,
          quietMs: 1200,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          confirmAge: true,
        });
        server.requests.length = 0;
        const error = await probeError("/age-gate.html?inert", resolver);

        // The server was set to confirm and did: "not set to confirm it" would
        // be false.
        expectCode(error, "NO_MEDIA_FOUND");
        expect(server.requests).toContain("/beacon/age-confirmed");
      },
    );

    test(
      "a fixed root the whole app lives in is not a modal, and its close control is left alone",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({
          pool,
          quietMs: 1200,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
        });
        server.requests.length = 0;
        const error = await probeError("/fixed-shell.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        expect(server.requests).not.toContain("/beacon/shell-closed");
      },
    );

    test(
      "an age link on a page with no adult-content wording is left alone",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const resolver = new BrowserResolver({
          pool,
          quietMs: 1200,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          confirmAge: true,
        });
        server.requests.length = 0;
        const error = await probeError("/age-link.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        expect(server.requests).not.toContain("/beacon/age-link");
      },
    );
  });

  test("reports BOT_CHALLENGE on an interstitial", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({
      pool,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    const error = await probeError("/challenge.html", resolver);
    expectCode(error, "BOT_CHALLENGE");
    expect(error.details?.["status"]).toBe(403);
  });

  test("reports AUTH_REQUIRED behind a login wall", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({
      pool,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    const error = await probeError("/gated", resolver);
    expectCode(error, "AUTH_REQUIRED");
  });

  test("reports GEO_BLOCKED when the region is refused", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({
      pool,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
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

/**
 * The stages the browser tier reports, against a real page (dl-43).
 *
 * The point of running this here rather than with a mocked pool is that every
 * assertion below is only true because a real Chromium got that far: the page
 * was loaded, playback was provoked, the network went quiet and the manifest
 * was fetched and parsed. That is the whole claim the ticket makes — a stage
 * appears because code reached the point that emits it — and it cannot be
 * checked by any test that stands in for the work.
 */
describe("stage narration", () => {
  test(
    "reports each phase it actually reaches, in order, and none it does not",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const seen: ProbeStageEvent[] = [];
      await probe(
        "/mse.html",
        resolver,
        options({
          onStage: (event) => {
            seen.push(event);
          },
        }),
      );

      expect(seen.every((event) => event.resolver === "browser")).toBe(true);
      const stages = seen.map((event) => event.stage);
      expect(stages).toEqual([
        // No `browser-slot`: this pool has a free slot, so nothing waited for
        // one, so nothing said it did.
        "browser-launch",
        "page-load",
        "provoke-playback",
        "network-quiet",
        "settle-requests",
        "manifest-fetch",
        "manifest-parse",
        "measure-variants",
      ]);
    },
  );

  test(
    "a page with nothing playable never claims to have read a manifest",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The three phases after `settle-requests` are conditional on there being
      // something to fetch, parse and weigh. A narration that listed them
      // anyway would be back to describing a script rather than a probe.
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
      });
      const seen: ProbeStageEvent[] = [];
      await expect(
        probe(
          "/no-media.html",
          resolver,
          options({
            onStage: (event) => {
              seen.push(event);
            },
          }),
        ),
      ).rejects.toThrow(AppError);

      const stages = seen.map((event) => event.stage);
      expect(stages).toContain("settle-requests");
      expect(stages).not.toContain("manifest-fetch");
      expect(stages).not.toContain("manifest-parse");
      expect(stages).not.toContain("measure-variants");
    },
  );
});

describe("the surface click reaches a player inside an open shadow root (dl-61)", () => {
  test(
    "starts a shadow-root player when the page is probed directly",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      // The page's only video is inside an open shadow root and starts only
      // on `click`: a chooser that sees light-DOM videos alone never clicks.
      const result = await probe("/shadow-player.html", resolver);

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      expect(server.requests).toContain("/media/related/master.m3u8");
    },
  );

  test(
    "starts a shadow-root player inside a genuinely cross-origin frame",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      // The same page, embedded from the secondary origin: the index branch of
      // `clickChosenVideo`, not the marked-element one.
      const result = await probe("/cross-origin-shadow.html", resolver);

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).toContain("/media/related/master.m3u8");
    },
  );

  test(
    "indexes candidates in the locator's own order, so a cross-origin click lands on the chosen one",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      // The shadow host precedes a small light-DOM decoy. A candidate list in
      // tree order would hand `locator("video").nth()` the player's tree
      // position, which in the locator's order is the decoy.
      const result = await probe("/cross-origin-shadow-order.html", resolver);

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
    },
  );

  test(
    "never clicks a shadow-root card whose host sits inside a link",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      const result = await probe("/shadow-card.html", resolver);

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      expect(server.requests).not.toContain("/related-card-target.html");
    },
  );
});

describe("PLAY_SCRIPT reaches a shadow-root player that only starts on play() (dl-68)", () => {
  test(
    "starts a shadow-root player with no click listener at all",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      // The page's only video is inside an open shadow root and starts only
      // when something calls `.play()` on it: a chooser that stops at the
      // shadow boundary never finds it to call `.play()` on, so the `play`
      // listener never fires and `start()` never runs (dl-61's gate).
      const result = await probe("/shadow-player-play-only.html", resolver);

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      expect(server.requests).toContain("/media/related/master.m3u8");
    },
  );
});

describe("a progressive file is not demoted to a segment (dl-78)", () => {
  let files: ProgressiveServer;

  beforeAll(async () => {
    files = await startProgressiveServer();
  });

  afterAll(async () => {
    await files.close();
  });

  async function probeFile(pathname: string): Promise<ProbeResult> {
    const resolver = new BrowserResolver({ pool, quietMs: 1200 });
    return await resolver.resolve(new URL(files.url(pathname)), options());
  }

  test(
    "a whole file with a resolution suffix in its name is offered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probeFile("/named.html");

      expect(result.variants[0]?.protocol).toBe("progressive");
      expect(result.variants[0]?.url).toBe(files.url("/media/clip-720.mp4"));
      expect(result.variants[0]?.filesizeBytes).toBe(PROGRESSIVE_FILE_BYTES);
    },
  );

  test(
    "a file whose server answers every Range request with a short 206 is offered at its real size",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      files.requests.length = 0;
      const result = await probeFile("/ranged.html");

      // The browser really was given chunks, or this proves nothing.
      expect(files.requests.some((entry) => entry.range !== undefined)).toBe(true);
      expect(result.variants[0]?.protocol).toBe("progressive");
      expect(result.variants[0]?.url).toBe(files.url("/media/lecture.mp4"));
      // The total from Content-Range, not the 256 KB the 206 carried.
      expect(result.variants[0]?.filesizeBytes).toBe(PROGRESSIVE_FILE_BYTES);
    },
  );
});

describe("a manifest served with no recognisable type or extension (dl-79)", () => {
  test(
    "an HLS playlist served as text/plain from an extensionless route is an hls outcome",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/untyped-hls-text.html", resolver);

      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/api/playlist?id=1"));
      expect(hls.calls[0]?.text.startsWith("#EXTM3U")).toBe(true);
    },
  );

  test(
    "an HLS playlist served as application/octet-stream is an hls outcome",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      const result = await probe("/untyped-hls-octet.html", resolver);

      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/api/playlist?id=3"));
    },
  );

  test(
    "a DASH manifest served as text/plain is a dash outcome",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dash = recordingDashParser();
      const resolver = new BrowserResolver({ pool, dashParser: dash.parser, quietMs: 1200 });
      const result = await probe("/untyped-dash-text.html", resolver);

      expect(result.variants[0]?.protocol).toBe("dash");
      expect(result.variants[0]?.url).toBe(server.url("/api/manifest?id=1"));
      expect(dash.calls[0]?.text).toContain("<MPD");
    },
  );

  test(
    "a probe that saw only segments says so in the error's reason",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
      });
      // The playlist route answers with text that is not a manifest, so the
      // segments the page then fetches are all there is.
      const error = await probeError("/untyped-segments-only.html", resolver);

      expectCode(error, "NO_MEDIA_FOUND");
      expect(error.details?.["reason"]).toBe("segments-without-manifest");
      expect(error.details?.["segmentCount"]).toBe(2);
    },
  );

  test(
    "a page that requested no segments carries no such reason",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
      });
      const error = await probeError("/untyped-no-segments.html", resolver);

      expectCode(error, "NO_MEDIA_FOUND");
      expect(error.details?.["reason"]).toBeUndefined();
    },
  );
});

describe("a consent dialog whose button no vendor selector matches (dl-82)", () => {
  // Phrasings the text fallback did not know on `origin/main`, one per language
  // the ticket names. The button is pressed by its label alone, so reaching the
  // stream proves the label matched.
  const LABELS = [
    // A control: a phrasing `origin/main` already pressed, so a failure of the
    // fixture itself cannot pass for a failure of the pattern.
    "Accept all",
    "Accetto e continua",
    "Acconsento",
    "Sono d'accordo",
    "Ho capito",
    "Agree and continue",
    "Accept & close",
    "Yes, I agree",
  ];

  test.each(LABELS)(
    "presses %j and finds the stream behind it",
    { timeout: TEST_TIMEOUT_MS },
    async (label) => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      const result = await probe(
        `/consent-label.html?label=${encodeURIComponent(label)}`,
        resolver,
      );

      expect(server.requests).toContain("/beacon/consent-accepted");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
    },
  );

  test(
    "presses neither a pagination link nor a vote button that merely starts like a consent label",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
      });
      server.requests.length = 0;
      const error = await probeError("/consent-lookalikes.html", resolver);

      expectCode(error, "NO_MEDIA_FOUND");
      // `Continua` is a bare word and stays unlisted; the vote button's label
      // is a sentence, which the anchored pattern must keep refusing.
      expect(server.requests).not.toContain("/beacon/consent-continua");
      expect(server.requests).not.toContain("/beacon/consent-vote");
    },
  );
});

describe("the widened consent labels are pressed only inside a consent container (dl-82 gate 1)", () => {
  // A newsletter's "Ho capito" ahead of a consent dialog labelled "Accetta", a
  // label the tier pressed before dl-82. A whole-frame match took the newsletter
  // first: behind the overlay the press timed out, beside the bar it landed, and
  // either way the consent button was never reached.
  test.each([
    ["a full-viewport overlay", "/consent-order-overlay.html"],
    ["a bottom bar", "/consent-order-bar.html"],
  ])(
    "finds the stream behind %s and leaves the newsletter alone",
    { timeout: TEST_TIMEOUT_MS },
    async (_name, pathname) => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      const result = await probe(pathname, resolver);

      expect(server.requests).toContain("/beacon/consent-accepted");
      expect(server.requests).not.toContain("/beacon/newsletter-hocapito");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
    },
  );

  // Controls in the page's own flow whose whole label is a phrasing dl-82 added.
  // Two are submit buttons, which act on the page when pressed.
  test.each([
    ["a newsletter's dismiss button", "/consent-falsepress-newsletter.html", "newsletter-hocapito"],
    ["a checkout form's submit button", "/consent-falsepress-checkout.html", "terms-submit"],
    ["a comment form's submit button", "/consent-falsepress-comment.html", "comment-yesiagree"],
    ["a review's vote button", "/consent-falsepress-vote.html", "review-vote"],
  ])("does not press %s", { timeout: TEST_TIMEOUT_MS }, async (_name, pathname, beacon) => {
    const resolver = new BrowserResolver({
      pool,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    server.requests.length = 0;
    const error = await probeError(pathname, resolver);

    expectCode(error, "NO_MEDIA_FOUND");
    expect(server.requests).not.toContain(`/beacon/${beacon}`);
  });

  test(
    "still presses an old label on a cookie strip that is neither a dialog nor a fixed layer",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      const result = await probe("/consent-inline-strip.html", resolver);

      expect(server.requests).toContain("/beacon/strip-accepted");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
    },
  );
});

describe("a fixed or sticky layer is a consent container only when it speaks of consent (dl-82 gate 2)", () => {
  const MASTER = "/media/mse/master.m3u8";

  async function press(
    pathname: string,
  ): Promise<{ outcome: ProbeResult | AppError; requests: string[] }> {
    const hls = recordingHlsParser();
    const resolver = new BrowserResolver({
      pool,
      hlsParser: hls.parser,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    server.requests.length = 0;
    let outcome: ProbeResult | AppError;
    try {
      outcome = await probe(pathname, resolver);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      outcome = error as AppError;
    }
    return { outcome, requests: [...server.requests] };
  }

  // Row (i): a strip in the page's own flow. Unchanged from base, which pressed
  // "Accetta" there and never pressed the other two.
  test.each([
    ["Ho capito", false],
    ["Accetto e continua", false],
    ["Accetta", true],
  ])(
    "an in-flow strip labelled %j is pressed: %j",
    { timeout: TEST_TIMEOUT_MS },
    async (label, pressed) => {
      const { outcome, requests } = await press(
        `/consent-flow-strip.html?label=${encodeURIComponent(label)}`,
      );
      if (pressed) {
        expect(requests).toContain("/beacon/strip-accepted");
        expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
      } else {
        expect(requests).not.toContain("/beacon/strip-accepted");
        expectCode(outcome as AppError, "NO_MEDIA_FOUND");
      }
    },
  );

  // Row (ii): a checkout bar docked to the viewport, with a submit button.
  test.each([
    ["fixed", "/consent-checkout-docked.html"],
    ["sticky", "/consent-checkout-docked.html?sticky"],
  ])(
    "does not press the submit button of a %s checkout bar that says nothing of consent",
    { timeout: TEST_TIMEOUT_MS },
    async (_name, pathname) => {
      const { outcome, requests } = await press(pathname);

      expect(requests).not.toContain("/beacon/checkout-submit");
      expectCode(outcome as AppError, "NO_MEDIA_FOUND");
    },
  );

  // Row (iii): a sticky header's notice. "Ho capito" is new and is left alone;
  // "OK" is a label the old pattern pressed anywhere, and still is.
  test(
    "does not press a sticky header's notice labelled with a dl-82 phrasing",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { requests } = await press("/consent-header-notice.html");

      expect(requests).not.toContain("/beacon/header-notice");
    },
  );

  test(
    "still presses a sticky header's notice labelled with an old phrasing, as before dl-82",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { requests } = await press("/consent-header-notice.html?label=OK");

      expect(requests).toContain("/beacon/header-notice");
    },
  );

  // Row (iii-b): the header's notice sits ahead of a bottom consent bar.
  test(
    "reaches a bottom consent bar past a sticky header's notice",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press("/consent-header-then-bar.html");

      expect(requests).toContain("/beacon/consent-accepted");
      expect(requests).not.toContain("/beacon/header-notice");
      expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
    },
  );

  // A layer that speaks of consent is tried before a bare dialog.
  test(
    "presses a consent bar before a newsletter dialog that comes first in the document",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press("/consent-order-dialog.html");

      const consentAt = requests.indexOf("/beacon/consent-accepted");
      const newsletterAt = requests.indexOf("/beacon/newsletter-hocapito");
      expect(consentAt).toBeGreaterThanOrEqual(0);
      // A dialog is a container whatever it says, so once the consent bar is
      // gone the second pass may still press the newsletter's "Ho capito"; what
      // is pinned is the order, which document order alone would reverse.
      if (newsletterAt >= 0) expect(newsletterAt).toBeGreaterThan(consentAt);
      expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
    },
  );

  // Row (iv): a frame where no script runs, so only dialog semantics scope it.
  test(
    "presses a widened label inside a role=dialog in a cross-origin frame",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press("/consent-xo-dialog.html");

      expect(requests).toContain("/beacon/xo-accepted");
      expect((outcome as ProbeResult).variants[0]?.url).toBe(server.secondaryUrl(MASTER));
    },
  );

  test(
    "leaves a widened label alone in a cross-origin fixed layer with no dialog role",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press("/consent-xo-nodialog.html");

      expect(requests).not.toContain("/beacon/xo-accepted");
      expectCode(outcome as AppError, "NO_MEDIA_FOUND");
    },
  );

  // What the consent-wording rule gives up, pinned as accepted behaviour: a
  // fixed consent bar whose text names neither cookies nor consent.
  test.each([
    ["Ho capito", false],
    ["Accetta", true],
  ])(
    "a fixed bar that never says cookie or consent, labelled %j, is pressed: %j",
    { timeout: TEST_TIMEOUT_MS },
    async (label, pressed) => {
      const { outcome, requests } = await press(
        `/consent-bar-nowording.html?label=${encodeURIComponent(label)}`,
      );
      if (pressed) {
        expect(requests).toContain("/beacon/bar-accepted");
        expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
      } else {
        expect(requests).not.toContain("/beacon/bar-accepted");
        expectCode(outcome as AppError, "NO_MEDIA_FOUND");
      }
    },
  );
});

describe("the wording that makes a layer a consent container is read from its visible prose, by word (dl-82 gate 3)", () => {
  const MASTER = "/media/mse/master.m3u8";

  async function visit(
    pathname: string,
  ): Promise<{ outcome: ProbeResult | AppError; requests: string[] }> {
    const hls = recordingHlsParser();
    const resolver = new BrowserResolver({
      pool,
      hlsParser: hls.parser,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    server.requests.length = 0;
    let outcome: ProbeResult | AppError;
    try {
      outcome = await probe(pathname, resolver);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      outcome = error as AppError;
    }
    return { outcome, requests: [...server.requests] };
  }

  // A cookie link, shown or in a hidden menu, is not prose. Both pages equal
  // base here: the header's "Ho capito" is not pressed.
  test.each([
    ["a visible", "link"],
    ["a display:none", "hidden"],
  ])(
    "a sticky header with %s cookie link in its nav is not a container",
    { timeout: TEST_TIMEOUT_MS },
    async (_name, menu) => {
      const { requests } = await visit(`/consent-header-notice.html?menu=${menu}`);

      expect(requests).not.toContain("/beacon/header-notice");
    },
  );

  // Gate 3's a3c: the same header ahead of a bottom consent bar. Base found the
  // stream; so must this.
  test(
    "reaches a bottom consent bar past a sticky header that links a cookie policy",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await visit("/consent-header-then-bar.html?menu=link");

      expect(requests).toContain("/beacon/consent-accepted");
      expect(requests).not.toContain("/beacon/header-notice");
      expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
    },
  );

  // Gate 3's a4 and a5: a word that merely begins like a consent word.
  test(
    "does not press a checkout submit in a bar whose prose says Italian 'consente' (allows)",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const text = encodeURIComponent("Il pagamento sicuro consente di ordinare in un clic.");
      const label = encodeURIComponent("Accetto e continua");
      const { requests } = await visit(`/consent-checkout-docked.html?text=${text}&label=${label}`);

      expect(requests).not.toContain("/beacon/checkout-submit");
    },
  );

  test(
    "does not press a sticky header's notice whose prose says Swedish 'pannkakor' (pancakes)",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const note = encodeURIComponent("Veckans recept: pannkakor.");
      const label = encodeURIComponent("Acceptera alla");
      const { requests } = await visit(`/consent-header-notice.html?note=${note}&label=${label}`);

      expect(requests).not.toContain("/beacon/header-notice");
    },
  );

  // What visible prose does not close, pinned as accepted. Both differ from base,
  // which pressed neither widened label.
  test(
    "a fixed app root whose footer says 'cookie' is a container, so its first widened label is pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { requests } = await visit("/consent-approot.html");

      expect(requests).toContain("/beacon/newsletter-hocapito");
    },
  );

  test(
    "a fixed app root whose footer only links a cookie policy is not a container",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { requests } = await visit("/consent-approot.html?footer=link");

      expect(requests).not.toContain("/beacon/newsletter-hocapito");
    },
  );

  test(
    "a docked checkout bar whose prose says 'cookie' is a container, so its submit is pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const text = encodeURIComponent("Your cart is kept in a cookie.");
      const { requests } = await visit(`/consent-checkout-docked.html?text=${text}`);

      expect(requests).toContain("/beacon/checkout-submit");
    },
  );
});

describe("Empty media floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80)", () => {
  test(
    "captures an HLS player that attaches after 6 seconds with extended floor",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        quietMs: 1200,
        emptyMinWaitMs: 9000,
      });
      const startTime = Date.now();
      const result = await probe("/delayed-player.html", resolver);
      const elapsedMs = Date.now() - startTime;

      // The fixture's player starts at 6 seconds, so we expect to see it
      expect(result.variants.length).toBeGreaterThan(0);
      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.resolver).toBe("browser");
      // The page's manifest was served and read, not an opaque variant of a
      // URL that 404'd: any `.m3u8` the page asked for would pass the lines above.
      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      expect(hls.calls.length).toBeGreaterThan(0);

      // The extended floor did not delay the result unnecessarily —
      // we got the result shortly after the player attached (6 s + ~1-2 s for quiet)
      // rather than waiting the full 9 seconds.
      expect(elapsedMs).toBeLessThan(9500);
    },
  );

  test(
    "a page with no media respects the empty floor and the deadline",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // Use a manifest-less page with a short timeout to test the floor behavior
      const hls = recordingHlsParser();
      // Room for the floor: the wait's own deadline is the budget less the
      // resolver's 4 s teardown reserve (`TEARDOWN_RESERVE_MS`, not exported),
      // and a budget under floor plus page load ends TIMEOUT instead, which the
      // test after this one pins.
      const shortTimeoutMs = 20_000;
      const teardownReserveMs = 4000;
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        quietMs: 1200,
        emptyMinWaitMs: 9000,
      });
      const startTime = Date.now();

      let caught: unknown;
      try {
        await resolver.resolve(
          new URL(server.url("/no-media.html")),
          options({ timeoutMs: shortTimeoutMs }),
        );
      } catch (error) {
        caught = error;
      }

      const elapsedMs = Date.now() - startTime;
      expect(caught).toBeInstanceOf(AppError);
      const error = caught as AppError;
      expectCode(error, "NO_MEDIA_FOUND");

      // Should have waited at least the floor (9000 ms)
      expect(elapsedMs).toBeGreaterThanOrEqual(9000);
      // And no later than the wait's real deadline. This bound alone cannot
      // see a floor that ignores the deadline (the floor ends first here); the
      // last test in this block and `wait-for-quiet.test.ts`, where the deadline
      // arrives first, carry that clause.
      expect(elapsedMs).toBeLessThan(shortTimeoutMs - teardownReserveMs);
    },
  );

  test(
    "a page whose media arrives early still uses the standard quiet timeout",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The mse.html page loads media immediately, so it should not wait
      // the full empty floor — just the standard quiet timeout
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        quietMs: 1200,
        emptyMinWaitMs: 9000,
      });
      const startTime = Date.now();
      const result = await probe("/mse.html", resolver);
      const elapsedMs = Date.now() - startTime;

      // Should have found media
      expect(result.variants.length).toBeGreaterThan(0);

      // Should have finished well before the 9 second floor,
      // since it captures media immediately
      expect(elapsedMs).toBeLessThan(5000);
    },
  );

  test(
    "the empty floor is overridable to allow tests to run quickly",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // For tests expecting NO_MEDIA_FOUND, set emptyMinWaitMs to a short value
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        quietMs: 1200,
        emptyMinWaitMs: 500, // Override to a short value for testing
      });
      const startTime = Date.now();

      let caught: unknown;
      try {
        await resolver.resolve(
          new URL(server.url("/no-media.html")),
          options({ timeoutMs: 15000 }),
        );
      } catch (error) {
        caught = error;
      }

      const elapsedMs = Date.now() - startTime;
      expect(caught).toBeInstanceOf(AppError);
      const error = caught as AppError;
      expectCode(error, "NO_MEDIA_FOUND");

      // With a 500 ms floor and 1200 ms quiet timeout,
      // should see NO_MEDIA_FOUND in roughly 1.7 seconds
      expect(elapsedMs).toBeLessThan(3000);
    },
  );

  test(
    "a budget shorter than the floor plus page load ends TIMEOUT, at the deadline, not NO_MEDIA_FOUND past it",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The owner's decision for dl-80 (2026-10-06): the deadline wins over the
      // floor, and the registry's existing meaning of TIMEOUT ("the deadline
      // arrived before quiet") stands. Pinned here so a floor that ignores the
      // deadline fails loudly; it ended NO_MEDIA_FOUND at 10.6 s of an 8 s budget.
      const hls = recordingHlsParser();
      const timeoutMs = 8000;
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        quietMs: 1200,
        emptyMinWaitMs: 9000,
      });
      const startTime = Date.now();

      let caught: unknown;
      try {
        await resolver.resolve(new URL(server.url("/no-media.html")), options({ timeoutMs }));
      } catch (error) {
        caught = error;
      }

      const elapsedMs = Date.now() - startTime;
      expect(caught).toBeInstanceOf(AppError);
      expectCode(caught as AppError, "TIMEOUT");
      // Ended by the deadline, not by waiting out the 9 s floor.
      expect(elapsedMs).toBeLessThan(timeoutMs);
    },
  );
});
