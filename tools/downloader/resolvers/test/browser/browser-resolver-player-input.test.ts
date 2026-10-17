/**
 * A player that waits for the visitor's first input, and the centre click it must not reach (split from browser-resolver.test.ts, dl-117).
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import { recordingHlsParser } from "./helpers/fake-parsers.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";
import {
  BASE_WAITS,
  NO_EMPTY_FLOOR_MS,
  TEST_TIMEOUT_MS,
  closeBrowserHarness,
  expectCode,
  probes,
  startBrowserHarness,
} from "./helpers/browser-harness.ts";
import type { Waits } from "./helpers/browser-harness.ts";
import { STREAM_WAITS } from "./helpers/stream-waits.ts";

let server: FixtureServer;
let pool: BrowserPool;

beforeAll(async () => {
  ({ server, pool } = await startBrowserHarness());
});

afterAll(async () => {
  await closeBrowserHarness({ server, pool });
});

const { probe, probeError } = probes(() => server);

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
