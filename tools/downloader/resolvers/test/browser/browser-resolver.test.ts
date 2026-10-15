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
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import type * as provoke from "../../src/browser/provoke.ts";
import { BrowserResolver, MIN_WAIT_MS } from "../../src/resolvers/browser.ts";
import type { BrowserResolverLogger, BrowserResolverOptions } from "../../src/resolvers/browser.ts";
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
import { STREAM_WAITS } from "./helpers/stream-waits.ts";

// Records the `minWaitMs` each quiet wait is handed (dl-115), and changes nothing:
// the default can only be read where the resolver passes it on, and a timing
// bound cannot tell 1200 from a default that merely lands near it.
const quietWaitCalls = vi.hoisted(() => [] as { minWaitMs: number }[]);
vi.mock("../../src/browser/provoke.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof provoke>();
  return {
    ...actual,
    waitForQuiet: (...args: Parameters<typeof actual.waitForQuiet>) => {
      quietWaitCalls.push({ minWaitMs: args[0].minWaitMs });
      return actual.waitForQuiet(...args);
    },
  };
});

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;
/**
 * The floor the no-media tests pass as `emptyMinWaitMs` (dl-80): equal to the
 * resolver's own `MIN_WAIT_MS`, so the extended floor adds nothing and they run
 * for what they did before it existed. Their verdicts come from the page,
 * not from how long the probe waited. A smaller value would not be "off" — it
 * would shorten the wait below the base rule's.
 */
const NO_EMPTY_FLOOR_MS = 1200;
/**
 * The quiet rule a builder uses unless its caller says the test expects a stream
 * (dl-115): only those take `STREAM_WAITS`. A shorter wait in a test that expects
 * no media, or an error, would make it pass more easily. A test that expects a
 * stream and also asserts that something was not pressed or not requested may
 * take it: the presses happen during provocation, before the quiet wait, and the
 * revisits stop at the first hit, so a shorter wait cannot hide one.
 */
type Waits = Pick<BrowserResolverOptions, "quietMs" | "minWaitMs">;
const BASE_WAITS: Waits = { quietMs: 1200 };

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

async function probeError(
  pathname: string,
  resolver: BrowserResolver,
  resolveOptions: ResolveOptions = options(),
): Promise<AppError> {
  let caught: unknown;
  try {
    await probe(pathname, resolver, resolveOptions);
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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

      // The request context the engine replays: the same probe of the same page,
      // once its own test (dl-113).
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
    "dismisses a consent banner and captures a click-to-play HLS stream",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
      const resolver = new BrowserResolver({ pool, dashParser: dash.parser, ...STREAM_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
        ...STREAM_WAITS,
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
    const resolver = new BrowserResolver({ pool, ...STREAM_WAITS });
    // The one probe that asks for a locale (dl-113): the default-locale probe
    // above only shows "en", which a fr-CA header also contains.
    const result = await probe("/mse.html", resolver, options({ locale: "fr-CA" }));
    expect(result.variants.length).toBeGreaterThan(0);
    expect(result.variants[0]?.protocol).toBe("hls");
    expect(result.requestContext.headers["Accept-Language"]).toContain("fr-CA");
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

  describe("the surface click chooses the player, not a related-video card (dl-55)", () => {
    test(
      "starts the real player and never reaches the card's own page or stream",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
      "a document navigation (location.assign) never returns the other page's stream, and is reported to the injected logger, naming the step and both URLs",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const warnings: { message: string; fields: Record<string, unknown> | undefined }[] = [];
        const logger: BrowserResolverLogger = {
          warn: (message, fields) => {
            warnings.push({ message, fields });
          },
        };
        const resolver = new BrowserResolver({ pool, quietMs: 1200, logger });
        const error = await probeError("/guard-assign.html", resolver);

        expectCode(error, "NO_MEDIA_FOUND");
        expect(error.details?.["reason"]).toBe("navigated-away");

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
      "a fragment-only change on play is not a departure, and the page still probes",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
        const result = await probe("/guard-fragment.html", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "a script redirect ~200ms after load is not a departure (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
        const result = await probe("/guard-script-redirect.html", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "a router history.replaceState ~300ms in is not a departure (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
        const result = await probe("/guard-router-rewrite.html?utm_source=newsletter", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );

    test(
      "the landing URL is the page reached after a redirect, not the one requested (dl-55, decision 2)",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        // This is also a plain redirect during load, which once had a probe of its
        // own (`/guard-redirect`, dl-113): a 302 that must not read as a departure
        // and must still finish probing. The fragment-only test above stays apart,
        // so a failure there names the fragment.
        // A `landingUrl` wrongly set to the requested URL would flag this
        // target's own fragment-only play as a departure — `/guard-redirect`
        // alone cannot tell the two apart, since nothing navigates again
        // after it (see the Log).
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
        const result = await probe("/guard-redirect-then-fragment", resolver);
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      },
    );
  });

  describe("play-time query rewrites are not a departure, within a narrow exception (dl-55, decision 1)", () => {
    // The rule is `sameDocument`, and `same-document.test.ts` tables it: `start`,
    // `autoplay`, another key and a reordered query were rows here until dl-114.
    // One row stays as the proof the guard is wired to it.
    test("adding ?t= on play is not a departure", { timeout: TEST_TIMEOUT_MS }, async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      const result = await probe("/guard-query.html?rewrite=t", resolver);
      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
    });
  });

  describe("the cross-origin chooser picks the player, not a JS-click card (dl-55, decision 3)", () => {
    test(
      "starts the real player in a genuinely cross-origin frame, never the card",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
          ...STREAM_WAITS,
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
        const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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

        // The server was set to confirm and did: "the server did not confirm
        // it" would be false.
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

    describe("recognised by its structure, pressed strictly (dl-83)", () => {
      const GATE = "/age-gate-overlay.html";
      const MASTER = "/media/mse/master.m3u8";

      function confirming(waits: Waits = BASE_WAITS): BrowserResolver {
        const hls = recordingHlsParser();
        return new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          ...waits,
          confirmAge: true,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
        });
      }

      test(
        "an Italian gate in a fixed layer, not told to confirm, fails AGE_CONFIRMATION_REQUIRED",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          const resolver = new BrowserResolver({
            pool,
            quietMs: 1200,
            emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          });
          server.requests.length = 0;
          const error = await probeError(GATE, resolver);

          expectCode(error, "AGE_CONFIRMATION_REQUIRED");
          // No AGE_MARKERS phrase on the page, and the code needs none.
          expect(error.details?.["marker"]).toBeUndefined();
          expect(server.requests).not.toContain("/beacon/age-confirmed");
        },
      );

      test(
        "an Italian gate in a fixed layer, told to confirm, yields its stream",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const result = await probe(GATE, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-confirmed");
        },
      );

      test.each([
        ["an exit link to another origin", "exit=link"],
        ["a same-origin exit button with a script handler", "exit=button"],
        ["an off-site exit in a language with no negation list", "exit=foreign"],
      ])(
        "a two-button gate with %s presses the entry and never the exit",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, query) => {
          server.requests.length = 0;
          const result = await probe(`${GATE}?${query}`, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-confirmed");
          expect(server.requests).not.toContain("/beacon/age-exit");
        },
      );

      test(
        "two candidates still standing after the choice presses nothing and fails AGE_CONFIRMATION_REQUIRED",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const error = await probeError(`${GATE}?second`, confirming());

          // Told to confirm, and still the refusal: saying why beats guessing.
          expectCode(error, "AGE_CONFIRMATION_REQUIRED");
          // The setting was on here, so a message about what the server is "set"
          // to do would be false (dl-94).
          expect(error.message).not.toMatch(/not set/i);
          expect(server.requests).not.toContain("/beacon/age-confirmed");
          expect(server.requests).not.toContain("/beacon/age-confirmed-2");
          expect(server.requests).not.toContain(MASTER);
        },
      );

      test(
        "a gate whose layer lives in an open shadow root is recognised",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          const resolver = new BrowserResolver({
            pool,
            quietMs: 1200,
            emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          });
          server.requests.length = 0;
          const error = await probeError(`${GATE}?shadow`, resolver);

          expectCode(error, "AGE_CONFIRMATION_REQUIRED");
          expect(server.requests).not.toContain("/beacon/age-confirmed");
        },
      );

      test(
        "a gate whose layer lives in an open shadow root, told to confirm, yields its stream",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const result = await probe(`${GATE}?shadow`, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-confirmed");
        },
      );

      test(
        "presses the control it recognised, not an AGE_GATE_TEXT decoy earlier in the DOM",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const result = await probe(`${GATE}?decoy`, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-confirmed");
          expect(server.requests).not.toContain("/beacon/age-decoy");
        },
      );
    });

    // Gate round 1's pages, each a static copy of its harness page. With
    // confirmation on, a false candidate is a false press; these pin which ones
    // the owner's decision removed and which it accepted.
    describe("false candidates and the press, as gate round 1 measured them (dl-83)", () => {
      const MASTER = "/media/mse/master.m3u8";
      // What a click behind a cover that never clears may wait (dl-118).
      const BLOCKED_CLICK_MS = 300;

      function confirming(clickTimeoutMs?: number, waits: Waits = BASE_WAITS): BrowserResolver {
        const hls = recordingHlsParser();
        return new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          ...waits,
          confirmAge: true,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          ...(clickTimeoutMs === undefined ? {} : { clickTimeoutMs }),
        });
      }

      function beacons(): string[] {
        return server.requests.filter((pathname) => pathname.startsWith("/beacon/"));
      }

      test.each([
        ["a fixed app shell's 18+ nav link", "/age-false-shell-link.html", "/beacon/nav-18"],
        ["a fixed app shell's 21 Savage link", "/age-false-shell-21-savage.html", "/beacon/artist"],
        [
          "a full-viewport promo's Over 18? link",
          "/age-false-shop-interstitial.html",
          "/beacon/buy",
        ],
        ["a promo dialog's Over 18? link", "/age-false-shop-dialog.html", "/beacon/buy"],
        ["a pricing dialog's 21-day trial link", "/age-false-pricing-21-day.html", "/beacon/trial"],
      ])(
        "never presses %s, which would leave the document, and finds the stream",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname, pressed) => {
          server.requests.length = 0;
          const result = await probe(pathname, confirming(undefined, STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).not.toContain(pressed);
        },
      );

      test.each([
        ["a bottom shop banner", "/age-false-shop-bottom-banner.html"],
        ["a plain 21 Savage page", "/age-false-21-savage-plain.html"],
        ["a Save 18% pricing modal", "/age-false-pricing-save-18.html"],
        ["a sign-up form with an age select", "/age-false-signup-select.html"],
      ])(
        "presses nothing on %s, and finds the stream",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname) => {
          server.requests.length = 0;
          const result = await probe(pathname, confirming(undefined, STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(beacons()).toEqual([]);
        },
      );

      // Told to confirm, because with confirmation off nothing is ever pressed:
      // that row (dl-113) proved nothing the age-gate tests above do not.
      test(
        "sign-up chips whose one age candidate is negated press nothing and report AGE_CONFIRMATION_REQUIRED",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          const resolver = new BrowserResolver({
            pool,
            quietMs: 1200,
            confirmAge: true,
            emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
          });
          server.requests.length = 0;
          const error = await probeError("/age-false-signup-chips.html", resolver);

          expectCode(error, "AGE_CONFIRMATION_REQUIRED");
          expect(beacons()).toEqual([]);
        },
      );

      test(
        "dl-48's inline gate beside a cookie sheet presses the gate, never the sheet's 18 partners button",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const result = await probe(
            "/age-inline-gate-plus-cookie.html",
            confirming(undefined, STREAM_WAITS),
          );

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-confirmed");
          expect(server.requests).not.toContain("/beacon/view-partners");
        },
      );

      // Accepted residue (the owner, 2026-10-06): a lone false candidate that is
      // a button, not a link, is still pressed. Pinned so a change to it is seen.
      test(
        "accepted residue: a sign-up layer's Age: 18 button is pressed, and the stream is still found",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const result = await probe(
            "/age-false-signup-age-button.html",
            confirming(undefined, STREAM_WAITS),
          );

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain("/beacon/age-dropdown");
        },
      );

      test(
        "accepted residue: a shell's 18+ button that pushes a route is pressed, and the probe reports the departure",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const error = await probeError("/age-false-shell-pushstate.html", confirming());

          expectCode(error, "NO_MEDIA_FOUND");
          expect(error.details?.["reason"]).toBe("navigated-away");
          expect(server.requests).toContain("/beacon/nav-18");
        },
      );

      test.each([
        [
          "a cookie sheet's View our 18 partners, closable panel",
          "/age-false-cookie-sheet-closable.html",
          "/beacon/view-partners",
        ],
        [
          "a cookie sheet's View our 18 partners, sticky panel",
          "/age-false-cookie-sheet-sticky.html",
          "/beacon/view-partners",
        ],
        ["a shell's 18+ menu button", "/age-false-shell-menu-button.html", "/beacon/nav-18"],
      ])(
        "accepted residue: %s is pressed where play is a click, and nothing plays",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname, pressed) => {
          server.requests.length = 0;
          // The cover these pages put up stays up, so every play and consent click
          // is retried until its timeout, 8 to 10 s a row at 2000 ms (dl-118).
          const error = await probeError(pathname, confirming(BLOCKED_CLICK_MS));

          expectCode(error, "NO_MEDIA_FOUND");
          expect(server.requests).toContain(pressed);
          expect(server.requests).not.toContain("/beacon/play");
        },
      );
    });

    // Gate round 2's pages, each a static copy of its harness page: real gates
    // built as links, and the reach of the dl-48 preference.
    describe("gates built as links, and the dl-48 preference, as gate round 2 measured them (dl-83)", () => {
      const MASTER = "/media/mse/master.m3u8";

      function confirming(waits: Waits = BASE_WAITS): BrowserResolver {
        const hls = recordingHlsParser();
        return new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          ...waits,
          confirmAge: true,
          emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
        });
      }

      function beacons(): string[] {
        return server.requests.filter((pathname) => pathname.startsWith("/beacon/"));
      }

      // dl-48's label: exempt from the same-origin half of the leaving rule, so
      // each is pressed as at base, and each stays on the page.
      test.each([
        ["whose script cancels it", "/age-link-prevent-L.html", "/beacon/age-confirmed"],
        [
          "to a route that sets a cookie and redirects back",
          "/age-link-redirect-L.html",
          "/beacon/player-after-cookie",
        ],
        ["that opens a new tab", "/age-link-blank-L.html", "/beacon/age-confirmed"],
        ["to a play-time query key", "/age-link-ptk-L.html", "/beacon/player-after-cookie"],
      ])(
        "a dl-48 gate built as a link %s is pressed, and yields its stream",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname, shown) => {
          server.requests.length = 0;
          const result = await probe(pathname, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain(shown);
        },
      );

      // The structural twins: their hrefs name another path, so the press
      // declines them — the accepted cost of the owner's decision. Base never
      // recognised them.
      test.each([
        ["whose script cancels it", "/age-link-prevent-S.html"],
        ["to a route that sets a cookie and redirects back", "/age-link-redirect-S.html"],
        ["that opens a new tab", "/age-link-blank-S.html"],
      ])(
        "accepted cost: a structural-only gate built as a link %s is declined",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname) => {
          server.requests.length = 0;
          const error = await probeError(pathname, confirming());

          expectCode(error, "AGE_CONFIRMATION_REQUIRED");
          expect(beacons()).toEqual([]);
        },
      );

      test.each([
        ["to a play-time query key", "/age-link-ptk-S.html", "/beacon/player-after-cookie"],
        ["to a fragment", "/age-link-hash-S.html", "/beacon/age-confirmed"],
      ])(
        "a structural gate built as a link %s, which the guard calls the same page, is pressed",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname, shown) => {
          server.requests.length = 0;
          const result = await probe(pathname, confirming(STREAM_WAITS));

          expect(result.variants[0]?.url).toBe(server.url(MASTER));
          expect(server.requests).toContain(shown);
        },
      );

      // The preference's reach (gate round 2, low): a dl-48 label elsewhere on
      // the page beats a real structural gate that blocks nothing. Pinned as
      // it stands; base pressed the decoy six times on each.
      test.each([
        ["an English sheet", "/age-tiebreak-sheet-en.html"],
        ["an Italian sheet", "/age-tiebreak-sheet-it.html"],
        ["an Italian card below the coverage threshold", "/age-tiebreak-card-it.html"],
      ])(
        "accepted reach: beside %s, a dl-48 decoy link is pressed once and nothing plays",
        { timeout: TEST_TIMEOUT_MS },
        async (_name, pathname) => {
          server.requests.length = 0;
          const error = await probeError(pathname, confirming());

          expectCode(error, "NO_MEDIA_FOUND");
          expect(beacons()).toEqual(["/beacon/footer-decoy"]);
        },
      );

      test(
        "accepted reach: a dl-48 decoy that is a link to another page is pressed, and the probe reports the departure",
        { timeout: TEST_TIMEOUT_MS },
        async () => {
          server.requests.length = 0;
          const error = await probeError("/age-tiebreak-sheet-leaving-decoy.html", confirming());

          expectCode(error, "NO_MEDIA_FOUND");
          expect(error.details?.["reason"]).toBe("navigated-away");
          expect(server.requests).toContain("/beacon/footer-decoy");
        },
      );
    });
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

  // GEO_BLOCKED, a page that says the programme is not available in your country,
  // was a probe of `/geo.html` here until dl-113: `provoke.test.ts` reads that
  // page's signals and classifies them, and `capture-rules.test.ts` pins the
  // wording.

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
      // The shipped 9 s floor, because this is also the probe of a page whose media
      // arrives early (the dl-80 test of that name, merged here by dl-113): it
      // must still use the standard quiet timeout, not the empty floor.
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        ...STREAM_WAITS,
        emptyMinWaitMs: 9000,
      });
      const seen: ProbeStageEvent[] = [];
      const startTime = Date.now();
      const result = await probe(
        "/mse.html",
        resolver,
        options({
          onStage: (event) => {
            seen.push(event);
          },
        }),
      );
      const elapsedMs = Date.now() - startTime;

      // Should have found media
      expect(result.variants.length).toBeGreaterThan(0);

      // Should have finished well before the 9 second floor, since it captures
      // media immediately. The ceiling sits between what it must rule out (a
      // floor applied anyway ends at or after 9000 ms) and a slow Windows
      // runner, which took 4470 ms here against a usual 2.8 s (dl-95).
      expect(elapsedMs).toBeLessThan(7000);

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
      //
      // Also the page with no video that reports NO_MEDIA_FOUND, the one verdict
      // that lets the registry fall through to another resolver, and the probe
      // that overrides the empty floor (both merged here by dl-113). A floor of
      // 500 ms is below the base rule's 1200 ms, so an override that was ignored
      // would wait the shipped 9000 ms.
      const resolver = new BrowserResolver({
        pool,
        quietMs: 1200,
        emptyMinWaitMs: 500,
      });
      const seen: ProbeStageEvent[] = [];
      const startTime = Date.now();
      const error = await probeError(
        "/no-media.html",
        resolver,
        options({
          timeoutMs: 15_000,
          onStage: (event) => {
            seen.push(event);
          },
        }),
      );
      const elapsedMs = Date.now() - startTime;

      expectCode(error, "NO_MEDIA_FOUND");
      // With a 500 ms floor and 1200 ms quiet timeout, NO_MEDIA_FOUND arrives
      // in about 2.1 s. An ignored override would wait the default 9000 ms
      // floor, so the ceiling only has to stay clear of that; 3000 ms did not
      // survive a slow Windows runner, which took 3257 ms (dl-95).
      expect(elapsedMs).toBeLessThan(7000);

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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      server.requests.length = 0;
      // The page's only video is inside an open shadow root and starts only
      // on `click`: a chooser that sees light-DOM videos alone never clicks.
      const result = await probe("/shadow-player.html", resolver);

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      expect(server.requests).toContain("/media/related/master.m3u8");
    },
  );

  test(
    "indexes candidates in the locator's own order, so a cross-origin click lands on the chosen one",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      server.requests.length = 0;
      // The same shadow-root player as above, embedded from the secondary origin:
      // the index branch of `clickChosenVideo`, not the marked-element one. A
      // test of that branch with a single video (dl-61's, removed by dl-113)
      // proved only that a shadow-root player in a cross-origin frame starts at
      // all, which this one cannot pass without.
      // The shadow host precedes a small light-DOM decoy. A candidate list in
      // tree order would hand `locator("video").nth()` the player's tree
      // position, which in the locator's order is the decoy.
      const result = await probe("/cross-origin-shadow-order.html", resolver);

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).toContain("/media/related/master.m3u8");
    },
  );

  test(
    "never clicks a shadow-root card whose host sits inside a link",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
    const resolver = new BrowserResolver({ pool, ...STREAM_WAITS });
    return await resolver.resolve(new URL(files.url(pathname)), options());
  }

  // The whole file with a resolution suffix in its name, and no ranged answer,
  // is pinned without a browser (dl-113): "a numeric id or a resolution suffix
  // does not classify a request as a segment" and "keeps a lone numbered file"
  // in `capture-rules.test.ts`.
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      const result = await probe("/untyped-hls-text.html", resolver);

      expect(result.variants[0]?.protocol).toBe("hls");
      expect(result.variants[0]?.url).toBe(server.url("/api/playlist?id=1"));
      expect(hls.calls[0]?.text.startsWith("#EXTM3U")).toBe(true);
    },
  );

  // An octet-stream playlist and a text/plain DASH manifest took the same path
  // through the same sniff (dl-113): `isSniffable` and `sniffManifestKind` in
  // `sniff.test.ts` pin the two types and the two kinds without a browser.
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
  // A page that requested no segments carries no such reason: "adds nothing when
  // no segment was seen" in `sniff.test.ts` (dl-113).
});

describe("a consent dialog whose button no vendor selector matches (dl-82)", () => {
  // One phrasing the text fallback did not know on `origin/main`, pressed by its
  // label alone, so reaching the stream proves the label matched. The other seven
  // of the ticket's eight (a control the fallback already pressed, and one per
  // language) are anchored strings in `CONSENT_TEXT`'s KEPT and ADDED lists in
  // `provoke.test.ts`: the button is found by that same pattern, so what a
  // browser adds is the apostrophe in the accessible name, which this one carries
  // (dl-113). The pagination link and vote button that merely start like a label
  // ("Continua", "Sono d'accordo con questa recensione") are REFUSED rows there,
  // for `CONSENT_TEXT` and for `CONSENT_TEXT_ANYWHERE`, the pattern that reaches
  // outside a container.
  test(
    'presses "Sono d\'accordo" and finds the stream behind it',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      server.requests.length = 0;
      const result = await probe(
        `/consent-label.html?label=${encodeURIComponent("Sono d'accordo")}`,
        resolver,
      );

      expect(server.requests).toContain("/beacon/consent-accepted");
      expect(result.variants[0]?.url).toBe(server.url("/media/mse/master.m3u8"));
    },
  );
});

describe("the widened consent labels are pressed only inside a consent container (dl-82 gate 1)", () => {
  // Gate 1's first finding was a newsletter's "Ho capito" ahead of a consent
  // dialog labelled "Accetta", a label the tier pressed before dl-82: a
  // whole-frame match took the newsletter first, so the consent button was never
  // reached (behind an overlay the press timed out, beside a bar it landed). Its
  // two pages (a full-viewport overlay and a bottom bar) were probed here until
  // dl-113; "reaches a bottom consent bar past a sticky header's notice" in the
  // gate 2 block below is the same finding, a notice ahead of a bar, and it fails
  // on the same fault, a widened label pressed anywhere in the frame.

  // Controls in the page's own flow whose whole label is a phrasing dl-82 added.
  // Two were submit buttons, which act on the page when pressed. The checkout form
  // stays; the newsletter's dismiss button is the "Ho capito" row of the gate 2
  // block, and a comment form's and a review's vote buttons were the same press
  // by the same whole-frame match, pinned by the "CONSENT_TEXT_ANYWHERE does not
  // match" rows over "Yes, I agree" and "Sono d'accordo" in `provoke.test.ts`
  // (dl-113).
  test("does not press a checkout form's submit button", { timeout: TEST_TIMEOUT_MS }, async () => {
    const resolver = new BrowserResolver({
      pool,
      quietMs: 1200,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
    server.requests.length = 0;
    const error = await probeError("/consent-falsepress-checkout.html", resolver);

    expectCode(error, "NO_MEDIA_FOUND");
    expect(server.requests).not.toContain("/beacon/terms-submit");
  });

  test(
    "still presses an old label on a cookie strip that is neither a dialog nor a fixed layer",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
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
    waits: Waits = BASE_WAITS,
  ): Promise<{ outcome: ProbeResult | AppError; requests: string[] }> {
    const hls = recordingHlsParser();
    const resolver = new BrowserResolver({
      pool,
      hlsParser: hls.parser,
      ...waits,
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

  // Row (i): a strip in the page's own flow. Unchanged from base, which never
  // pressed "Ho capito" there. The strip's "Accetto e continua" is the label's
  // CONSENT_TEXT_ANYWHERE row in `provoke.test.ts`, and its "Accetta", which
  // base did press, is the cookie strip in the gate 1 block above (dl-113).
  test(
    'an in-flow strip labelled "Ho capito" is not pressed',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press(
        `/consent-flow-strip.html?label=${encodeURIComponent("Ho capito")}`,
      );

      expect(requests).not.toContain("/beacon/strip-accepted");
      expectCode(outcome as AppError, "NO_MEDIA_FOUND");
    },
  );

  // Row (ii) was a checkout bar docked to the viewport, fixed or sticky, with a
  // submit button, probed here until dl-113. Its bar was a `<form>`, which the
  // form rule excludes before the bar's wording is read, so the row never tested
  // the wording rule it was named for (the mutation is in the Log). A docked bar
  // that is no form is `consent-scope.test.ts` c1.
  //
  // Row (iii) was a sticky header's notice. "Ho capito" is new and is left alone
  // (c7 there, without a browser-resolver probe); "OK" is a label the old pattern
  // pressed anywhere, and still is: the cookie strip in the gate 1 block above is
  // the same whole-frame press.

  // Row (iii-b): the header's notice sits ahead of a bottom consent bar.
  test(
    "reaches a bottom consent bar past a sticky header's notice",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press("/consent-header-then-bar.html", STREAM_WAITS);

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
      const { outcome, requests } = await press("/consent-order-dialog.html", STREAM_WAITS);

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
      const { outcome, requests } = await press("/consent-xo-dialog.html", STREAM_WAITS);

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
  // fixed consent bar whose text names neither cookies nor consent, labelled with
  // a phrasing dl-82 added, is not pressed. The same bar labelled "Accetta", which
  // base pressed and the whole-frame match still does, was this block's second
  // row until dl-113: it is the cookie strip's press again.
  test(
    'a fixed bar that never says cookie or consent, labelled "Ho capito", is not pressed',
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { outcome, requests } = await press(
        `/consent-bar-nowording.html?label=${encodeURIComponent("Ho capito")}`,
      );

      expect(requests).not.toContain("/beacon/bar-accepted");
      expectCode(outcome as AppError, "NO_MEDIA_FOUND");
    },
  );
});

// Gate 3 of dl-82 (the wording that makes a layer a consent container is read from
// its visible prose, by word) had seven probes here until dl-113. Each is pinned
// where it needs no resolver, and the gate's finding and the owner's decision of
// 2026-10-10 that flipped a1 and a2 are named on the surviving row:
//
// - a3, a sticky header with a cookie link in its nav, shown or in a hidden menu,
//   and a3c, the same header ahead of a bottom bar: `consent-scope.test.ts` c7 and
//   r1..r2b (a link's text is not prose), and the gate 2 block above for the bar.
//   The hidden-menu row never read a node's visibility: its hidden node is an
//   `<a>`, which the link check excludes first.
// - a4, Italian "consente", and a5, Swedish "pannkakor": the "does not speak of
//   consent" rows of `CONSENT_WORDING` in `provoke.test.ts`. The first probed
//   the docked checkout `<form>`, which the form rule excludes before its wording
//   is read.
// - a1 and a2, flipped by dl-93 to "press nothing" by the owner's decision: c13
//   and c14 in `consent-scope.test.ts`. A fixed root whose footer only links a
//   cookie policy always held an `<h1>`, so the page-content rule decided first;
//   c4 and c15 pin the link and the script text.

describe("Empty media floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80)", () => {
  test(
    "captures an HLS player that attaches after 6 seconds with extended floor",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({
        pool,
        hlsParser: hls.parser,
        ...STREAM_WAITS,
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

// A master served from a route with no extension outranks the variant it names,
// even when that variant is called index.m3u8 (dl-92): this was a probe of
// `/extensionless-master.html` until dl-113. The ranking is "an extensionless
// route that names a master, requested first, beats a later variant named
// index.m3u8" in `capture-rules.test.ts`, and the arrival order that ranking reads
// is numbered by the collector, which "a slowly-read untyped master ranks above
// the typed variant it names" in `sniff.test.ts` pins.

describe("a player that waits for the visitor's first input (dl-81)", () => {
  /**
   * The quiet floor is switched to the base rule's here: every page below
   * mounts or starts its player during provocation, so the extended floor only
   * adds the time a failing case spends before it ends `NO_MEDIA_FOUND`. A page
   * whose manifest is requested seconds after the press needs the real floor
   * (`emptyMinWaitMs`), or the wait ends before the request is made.
   */
  function resolverWith(
    hls = recordingHlsParser(),
    emptyMinWaitMs = NO_EMPTY_FLOOR_MS,
    waits: Waits = BASE_WAITS,
  ): BrowserResolver {
    return new BrowserResolver({ pool, hlsParser: hls.parser, ...waits, emptyMinWaitMs });
  }

  /** The same resolver for a page that must yield a stream, so it may wait less (dl-115). */
  function streamingWith(
    hls = recordingHlsParser(),
    emptyMinWaitMs = NO_EMPTY_FLOOR_MS,
  ): BrowserResolver {
    return resolverWith(hls, emptyMinWaitMs, STREAM_WAITS);
  }

  // Not `pointermove`: headless Chromium sends one at (0,0) while a page loads,
  // so a page gated on it mounts with no help from the tier and a test of it
  // passes at base by timing (the gate's measurement). The tier sends no
  // pointer movement at all; see `input-gated-player.html`.
  test(
    "a player injected on the first wheel is reached from a bare poster",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // `<div><img></div>`: no `<video>`, no label, nothing to click. Until an
      // input arrives the page asks for no media at all.
      const result = await probe("/input-gated-player.html?on=wheel", streamingWith());

      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
      expect(server.requests).toContain("/media/hls/master.m3u8");
    },
  );

  // The resolver-level proof of choosing the largest candidate to scroll to (a
  // first-match scroll failed it, gate 1) was a probe of `/player-nav-first.html`
  // until dl-113. "brings the large shell into view, not the small nav bar that
  // comes first" in `provoke.test.ts` runs `SCROLL_SCRIPT` on a page where the
  // shell is below the fold and reads where it ended up, without the settle and
  // the quiet wait around it.

  // The only candidate is a 300x50 header, and the page mounts its player at
  // `scrollY >= 300`. Where the header sits decides how far centring it moves
  // the page (nothing at the top; about 140 px a little below the middle), and
  // the 400 px nudge has to follow either way, on a page that scrolls smoothly
  // too, where the centre click must not aim at the header and cancel it
  // (gate 2: the first two lost to a "nudge only when nothing moved" rule).
  test.each([
    ["at the top", "/player-header-nudge.html"],
    ["just below the middle", "/player-header-nudge.html?top=500"],
    ["at the top of a smooth-scrolling page", "/player-header-nudge.html?smooth=1"],
    ["below the middle of a smooth-scrolling page", "/player-header-nudge.html?top=500&smooth=1"],
  ])(
    "nudges the page 400 px after centring a small header, for a player that mounts on scroll: %s",
    { timeout: TEST_TIMEOUT_MS },
    async (_name, pathname) => {
      server.requests.length = 0;
      const result = await probe(pathname, streamingWith());

      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
    },
  );

  test(
    "clicks the middle of the largest player-ish box when no <video> was clicked",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // No `<video>`, no play-ish selector or text, no link: the box itself is
      // the only thing a person could press.
      const result = await probe("/player-box-click-only.html", streamingWith());

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
    },
  );

  test.each([
    ["a box inside a link", "/player-box-in-link.html"],
    ["a link under the middle of the largest box", "/player-box-link-centre.html"],
  ])(
    "never presses a link through the centre click: %s",
    { timeout: TEST_TIMEOUT_MS },
    async (_name, pathname) => {
      server.requests.length = 0;
      const error = await probeError(pathname, resolverWith());

      // Plain absence, not the departure guard catching a click that navigated.
      expectCode(error, "NO_MEDIA_FOUND");
      expect(error.details?.["reason"]).not.toBe("navigated-away");
      expect(server.requests).not.toContain("/related-card-target.html");
    },
  );

  test(
    "leaves a page-sized layout wrapper alone, whatever sits in its middle",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      await probeError("/player-box-wrapper.html", resolverWith());

      expect(server.requests).not.toContain("/beacon/wrapper-centre");
    },
  );

  describe("what the centre click must not reach (gate 1, owner's decision 1)", () => {
    // The press starts the player and the manifest is requested `delay` ms
    // later, as a real player does after loading a script or calling an API:
    // at 0 ms a stream is already captured when the click would be made, and at
    // 300 ms to 3 s it is not, so only the press itself can say a player was
    // started (gate 2, owner's decision 2026-10-07). At base all of these
    // returned the real stream; before the fix all but 0 ms navigated away.
    test.each([0, 300, 1500, 3000])(
      "is skipped once a play control was pressed, whether the manifest is requested after %i ms or not",
      { timeout: TEST_TIMEOUT_MS },
      async (delay) => {
        server.requests.length = 0;
        const result = await probe(
          `/player-poster-related-grid.html?delay=${String(delay)}`,
          // The shipped floor (`EMPTY_MIN_WAIT_MS`, 9 s), which a request at 3 s needs.
          streamingWith(undefined, 9000),
        );

        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
        expect(server.requests).not.toContain("/beacon/card-clicked");
      },
    );

    test(
      "is skipped once a stream is captured, though nothing was pressed",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const result = await probe("/player-autostart-related-grid.html", streamingWith());

        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
        expect(server.requests).not.toContain("/beacon/card-clicked");
      },
    );

    test(
      "never aims at a header bar: a box under 200x120 is not a player",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const error = await probeError("/player-header-only.html", resolverWith());

        expectCode(error, "NO_MEDIA_FOUND");
        expect(server.requests).not.toContain("/beacon/header-clicked");
      },
    );

    test(
      "never presses a form's button, which would post",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const error = await probeError("/player-box-form.html", resolverWith());

        expectCode(error, "NO_MEDIA_FOUND");
        expect(server.requests).not.toContain("/beacon/form-submitted");
      },
    );

    test(
      "never clicks a frame: a billboard larger than the page's own box is not pressed",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const result = await probe("/player-box-billboard.html", streamingWith());

        expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
        expect(server.requests).not.toContain("/beacon/billboard-clicked");
        expect(server.requests).not.toContain("/advertiser.html");
      },
    );

    test(
      "leaves a box alone when an ad frame covers its centre",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const error = await probeError("/player-box-interstitial.html", resolverWith());

        expectCode(error, "NO_MEDIA_FOUND");
        expect(error.details?.["reason"]).not.toBe("navigated-away");
        expect(server.requests).not.toContain("/advertiser.html");
      },
    );
  });

  test(
    "sends no pointer movement, so hover previews on related cards are not entered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // The page's own player waits for a keydown, which the tier never sends;
      // a pointer sweep entered the cards and returned a preview clip.
      const error = await probeError("/hover-previews-keydown-player.html", resolverWith());

      expectCode(error, "NO_MEDIA_FOUND");
      expect(server.requests.filter((pathname) => pathname.startsWith("/preview-"))).toEqual([]);
    },
  );

  describe("in a frame from another site", () => {
    test(
      "a scroll run there starts a player that mounts only when scrolled into view",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const result = await probe("/cross-origin-scroll-player.html", streamingWith());

        expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
        expect(server.requests).toContain("/media/related/master.m3u8");
      },
    );

    test(
      "a scripted play() run there starts a player that listens for nothing else",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const result = await probe("/cross-origin-play-only.html", streamingWith());

        expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
        expect(server.requests).toContain("/media/related/master.m3u8");
      },
    );

    test(
      "a scripted play() run there does not play an ad once the page's own stream is captured",
      { timeout: TEST_TIMEOUT_MS },
      async () => {
        server.requests.length = 0;
        const result = await probe("/ad-frame-with-real-hls.html", streamingWith());

        // Adaptive outranks nothing here: both are HLS masters, so what decides
        // is which was requested, and the ad's is never asked for.
        expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
        expect(server.requests).not.toContain("/beacon/ad-played");
      },
    );
  });
});

describe("a click-only player box beside a press that did not start a player (dl-100)", () => {
  // A box that only its own click starts, and one control beside it that does
  // nothing to the player. Whether the box is then clicked is what is measured:
  // the control's beacon says it was pressed, the box's that it was clicked.
  function resolverWith(
    hls = recordingHlsParser(),
    emptyMinWaitMs = NO_EMPTY_FLOOR_MS,
    waits: Waits = BASE_WAITS,
  ): BrowserResolver {
    return new BrowserResolver({ pool, hlsParser: hls.parser, ...waits, emptyMinWaitMs });
  }

  /** The same resolver for a page that must yield a stream, so it may wait less (dl-115). */
  function streamingWith(
    hls = recordingHlsParser(),
    emptyMinWaitMs = NO_EMPTY_FLOOR_MS,
  ): BrowserResolver {
    return resolverWith(hls, emptyMinWaitMs, STREAM_WAITS);
  }

  // `ctl=none`, no control at all, was the first row here until dl-113: every row
  // below asserts the same box-clicked beacon and the same stream.

  // Pressed as before; not counted as a player having started, because
  // "Autoplay" and "display" do not start a word with "play". The attribute rule
  // is `attributesMarkPlayPress`, tabled in `play-press.test.ts`: the other
  // `ctl=` rows that stood here (display, autoplay-cls, autoplay-id,
  // autoplay-camel, display-cls) were rows of that table until dl-114. This one
  // stays as the browser-level proof that a press which does not count is made
  // and does not hold back the box click.
  test(
    "ctl=autoplay (a toggle labelled Autoplay) is pressed but does not hold back the box click",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      const result = await probe("/box-with-control.html?ctl=autoplay", streamingWith());

      expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
      expect(server.requests).toContain("/beacon/control-autoplay");
      expect(server.requests).toContain("/beacon/box-clicked");
    },
  );

  // What a press that counts still does. The rule that decides which presses
  // count is tabled in `play-press.test.ts`; the rows kept here are the ones that
  // reach the browser by another road. `jw` proves the library-class branch,
  // since `jw-icon-display` holds no "play" at all. `watch` and `xo` ("Watch
  // now", in a frame) carry no attribute mark, so they take the visible-text path
  // and neither reaches the attribute rule; a frame alone would not keep them out,
  // since the selector press runs in every frame.
  // `testid-word`, `class-btn`, `id-button`, `id-play` and `carousel` stood here
  // until dl-114.
  test.each([
    ["jw", "/box-with-control.html?ctl=jw", "/beacon/control-jw"],
    ["watch", "/box-with-control.html?ctl=watch", "/beacon/control-watch"],
    ["xo", "/box-xo-cta.html", "/beacon/cta-pressed"],
  ])(
    "ctl=%s is a press that counts, so the box is not clicked",
    { timeout: TEST_TIMEOUT_MS },
    async (_ctl, pathname, beacon) => {
      server.requests.length = 0;
      const error = await probeError(pathname, resolverWith());

      expectCode(error, "NO_MEDIA_FOUND");
      expect(server.requests).toContain(beacon);
      expect(server.requests).not.toContain("/beacon/box-clicked");
    },
  );

  test(
    "a Play press in a frame from another site still holds back the box click, whose centre is that frame",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // The embed asks for its manifest 1.5 s after its Play press, so the
      // shipped floor; a centre click on the wrapper would land on the embed.
      const result = await probe("/box-xo-embed.html", streamingWith(undefined, 9000));

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).not.toContain("/beacon/embed-surface-clicked");
    },
  );
});

describe("the empty floor is measured on a clock the system cannot step (dl-105)", () => {
  test(
    "a wall clock stepped back before the wait does not read as a floor that returned early",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // dl-90's preflight failed dl-80's floor test with `expected 8577 to be
      // greater than or equal to 9000` while vitest timed the same test at
      // 10606 ms: the test's own clock lost two seconds that the wait, which
      // starts counting after page load, never lost. Date.now follows the
      // system clock, which this sandbox steps; the wait did what it should.
      // The step is made here instead of waited for, at the one point that
      // matters: after the test took its start, before the wait takes its own.
      // That is the `page-load` stage, before navigation. Stepping at
      // `network-quiet` instead would land after the page's last request, so
      // the collector's activity stamp would sit ahead of the stepped clock and
      // the wait would stall on its quiet gate for the step plus quietMs,
      // passing the floor assertion with the floor deleted (gate 1 of dl-105).
      //
      // This is also the empty-floor-and-deadline probe of the dl-80 block, merged
      // here by dl-113: a page with no media waits at least its floor and ends no
      // later than the wait's own deadline. The wait is timed from the
      // `network-quiet` stage, which is emitted immediately before it starts, to
      // `settle-requests`, which follows it. The gate of dl-105 left one low finding
      // open: this test's own floor was timed from before the page loaded, so it
      // could not tell the wait's length from a slow load. A 3000 ms floor
      // replaces that probe's 9000 ms; a floor ignored ends the wait at its quiet
      // gate, about 1200 ms.
      const floorMs = 3000;
      const stepBackMs = 5000;
      const timeoutMs = 20_000;
      // The wait's deadline is the budget less the resolver's 4 s teardown reserve
      // (`TEARDOWN_RESERVE_MS`, not exported), and a budget under floor plus page
      // load ends TIMEOUT instead, which the last test of the dl-80 block pins.
      const teardownReserveMs = 4000;
      const realNow = Date.now.bind(Date);
      let skewMs = 0;
      const wallClock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skewMs);

      try {
        const hls = recordingHlsParser();
        const resolver = new BrowserResolver({
          pool,
          hlsParser: hls.parser,
          quietMs: 1200,
          emptyMinWaitMs: floorMs,
        });
        const wallStart = Date.now();
        let waitStopwatch: (() => number) | undefined;
        let waitedMs: number | undefined;

        let caught: unknown;
        try {
          await resolver.resolve(
            new URL(server.url("/no-media.html")),
            options({
              timeoutMs,
              onStage: (event) => {
                if (event.stage === "page-load") skewMs = -stepBackMs;
                if (event.stage === "network-quiet") waitStopwatch = startStopwatch();
                if (event.stage === "settle-requests") waitedMs = waitStopwatch?.();
              },
            }),
          );
        } catch (error) {
          caught = error;
        }

        const wallElapsedMs = Date.now() - wallStart;
        expectCode(caught as AppError, "NO_MEDIA_FOUND");

        // The step took: the clock the old assertion read lost the five
        // seconds. Without this the test could not tell a fixed measurement
        // from a step that never happened.
        expect(wallElapsedMs).toBeLessThan(floorMs);
        // The clock that cannot be stepped saw the whole wait, and the wait lasted
        // at least the floor.
        expect(waitedMs).toBeDefined();
        expect(waitedMs ?? 0).toBeGreaterThanOrEqual(floorMs);
        // And no later than the wait's real deadline. This bound alone cannot
        // see a floor that ignores the deadline (the floor ends first here); the
        // last test of the dl-80 block and `wait-for-quiet.test.ts`, where the
        // deadline arrives first, carry that clause.
        expect(waitedMs ?? Infinity).toBeLessThan(timeoutMs - teardownReserveMs);
      } finally {
        wallClock.mockRestore();
      }
    },
  );
});

describe("a page that abandons a fetched playlist (dl-111)", () => {
  test(
    "a body the page never reads is abandoned at settle()'s cap, and the probe still answers",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // No other test that drives Chromium reaches `settle()`'s cap: dl-111
      // planted a throw there, and only this test and two `sniff.test.ts`
      // rows, which use fake responses, failed. It asserts the answer and no
      // timing: `sniff.test.ts` pins the cap without a browser, and a
      // duration here would measure the machine.
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...STREAM_WAITS });
      const result = await probe("/abandoned-body.html", resolver);

      expect(result.variants[0]?.url).toBe(server.url("/media/hls/master.m3u8"));
    },
  );
});

describe("the quiet wait's minimum can be set, and defaults to 1200 ms (dl-115)", () => {
  /**
   * How long the quiet wait lasted on a page whose stream is captured before it
   * begins. The wait is timed from the `network-quiet` stage to the
   * `settle-requests` one that follows it, as the dl-105 test does, so page load
   * and provocation are outside it. `quietMs` is small so that only the minimum
   * can hold the wait: the page's last request is a second old by then.
   */
  async function quietWait(
    minWaitMs: number | undefined,
  ): Promise<{ waitedMs: number; handedMs: number | undefined }> {
    const resolver = new BrowserResolver({
      pool,
      hlsParser: recordingHlsParser().parser,
      quietMs: 200,
      ...(minWaitMs === undefined ? {} : { minWaitMs }),
    });
    let stopwatch: (() => number) | undefined;
    let waitedMs: number | undefined;
    quietWaitCalls.length = 0;
    await probe(
      "/mse.html",
      resolver,
      options({
        onStage: (event) => {
          if (event.stage === "network-quiet") stopwatch = startStopwatch();
          if (event.stage === "settle-requests") waitedMs = stopwatch?.();
        },
      }),
    );
    expect(waitedMs).toBeDefined();
    expect(quietWaitCalls).toHaveLength(1);
    return { waitedMs: waitedMs ?? Number.NaN, handedMs: quietWaitCalls[0]?.minWaitMs };
  }

  test("the default is 1200 ms", () => {
    expect(MIN_WAIT_MS).toBe(1200);
  });

  test(
    "a resolver given no minWaitMs hands the wait MIN_WAIT_MS, and holds it that long",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { waitedMs, handedMs } = await quietWait(undefined);

      // Exactly the constant: a default that skips it, 2400 say, fails here and
      // not on a timing bound a slow runner could cross.
      expect(handedMs).toBe(MIN_WAIT_MS);
      expect(waitedMs).toBeGreaterThanOrEqual(MIN_WAIT_MS);
      // Not the 9 s floor of a probe that captured nothing, which would pass the
      // line above for the wrong reason.
      expect(waitedMs).toBeLessThan(MIN_WAIT_MS + 2000);
    },
  );

  test("a minWaitMs below it shortens the wait", { timeout: TEST_TIMEOUT_MS }, async () => {
    const { waitedMs, handedMs } = await quietWait(STREAM_WAITS.minWaitMs);

    expect(handedMs).toBe(STREAM_WAITS.minWaitMs);
    expect(waitedMs).toBeLessThan(MIN_WAIT_MS);
  });
});

/** Elapsed milliseconds since the call, off a clock that follows no one's `date`. */
function startStopwatch(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}
