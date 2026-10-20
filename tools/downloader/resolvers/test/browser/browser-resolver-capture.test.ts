/**
 * Captured streams and the probe's own answers, the stage narration, the shadow-root and frame surface click, and the progressive, manifest and abandoned-body cases (split from browser-resolver.test.ts, dl-117). The first test is the definition of done for dl-2: an MSE page whose `<video>` carries a `blob:` URL, where DOM scraping gets nothing and network capture gets the master playlist.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@downloader/contract";
import type { ProbeResult, ProbeStageEvent } from "@downloader/contract";
import type { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import {
  drmHlsParser,
  recordingDashParser,
  recordingHlsParser,
  throwingDashParser,
  throwingHlsParser,
} from "./helpers/fake-parsers.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";
import { PROGRESSIVE_FILE_BYTES, startProgressiveServer } from "./helpers/progressive-server.ts";
import type { ProgressiveServer } from "./helpers/progressive-server.ts";
import {
  NO_EMPTY_FLOOR_MS,
  TEST_TIMEOUT_MS,
  closeBrowserHarness,
  expectCode,
  options,
  probes,
  startBrowserHarness,
} from "./helpers/browser-harness.ts";
import { AT_ONCE_WAITS, STREAM_WAITS } from "./helpers/stream-waits.ts";

let server: FixtureServer;
let pool: BrowserPool;

beforeAll(async () => {
  ({ server, pool } = await startBrowserHarness());
});

afterAll(async () => {
  await closeBrowserHarness({ server, pool });
});

const { probe, probeError } = probes(() => server);

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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, dashParser: dash.parser, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
        ...AT_ONCE_WAITS,
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
    const resolver = new BrowserResolver({ pool, ...AT_ONCE_WAITS });
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
        ...AT_ONCE_WAITS,
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
    const resolver = new BrowserResolver({ pool, ...AT_ONCE_WAITS });
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
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, ...AT_ONCE_WAITS });
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
