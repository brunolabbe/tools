/**
 * What the press reaches: the age gate's decoys and false candidates, and a click-only player box beside a press that counts (split from browser-resolver.test.ts, dl-117).
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
  describe("a modal over an age gate (dl-48)", () => {
    // Gate round 1's pages, each a static copy of its harness page. With
    // confirmation on, a false candidate is a false press; these pin which ones
    // the owner's decision removed and which it accepted.
    describe("false candidates and the press, as gate round 1 measured them (dl-83)", () => {
      const MASTER = "/media/mse/master.m3u8";

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
            confirming(undefined, AT_ONCE_WAITS),
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
    });
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
    waits: Waits = STREAM_WAITS,
  ): BrowserResolver {
    return resolverWith(hls, emptyMinWaitMs, waits);
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
      const result = await probe(
        "/box-with-control.html?ctl=autoplay",
        streamingWith(undefined, undefined, AT_ONCE_WAITS),
      );

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
    "a Play press in a frame from another site that only isPlayPress counts (an icon button) still holds back the box click, whose centre is that frame",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // The embed asks for its manifest 1.5 s after its Play press, so the
      // shipped floor; a centre click on the wrapper would land on the embed.
      // Its button holds only a glyph, no word PLAY_TEXT matches, so the label
      // path cannot cover for isPlayPress.
      const result = await probe("/box-xo-embed.html", streamingWith(undefined, 9000));

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).not.toContain("/beacon/embed-surface-clicked");
    },
  );

  test(
    "a Play press in a frame from another site that only the label path makes (a text button) still holds back the box click",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // The button is named "Play" and has no id, class or attribute that
      // isPlayPress counts: provokeFrame's labelClicked is the only thing that
      // reports it pressed (dl-123).
      const result = await probe("/box-xo-embed-label.html", streamingWith(undefined, 9000));

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).not.toContain("/beacon/embed-surface-clicked");
    },
  );
});

describe("a player iframe that stays blank until a server tab is pressed (dl-139)", () => {
  function resolverWith(waits: Waits = BASE_WAITS): BrowserResolver {
    return new BrowserResolver({
      pool,
      hlsParser: recordingHlsParser().parser,
      ...waits,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
  }

  test(
    "presses the active tab, and the embed it loads is clicked in its own frame and yields the stream",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // The embed is on the other origin and asks for its manifest only after a
      // click on its `<video>`, which is smaller than the frame, so the click a
      // wrapper's centre would make misses it: the surface click did this.
      const result = await probe("/player-tabs-blank-iframe.html", resolverWith(STREAM_WAITS));

      expect(result.variants[0]?.url).toBe(server.secondaryUrl("/media/related/master.m3u8"));
      expect(server.requests).toContain("/beacon/server-tab-4");
      // Only the active tab; this page loads its iframe on the first press, so
      // it cannot show that the press happens once over both passes. The
      // stays-blank test at the end of this file does.
      expect(server.requests).not.toContain("/beacon/server-tab-6");
    },
  );

  test(
    "a Server 2 link and button on a page with no blank player iframe are not pressed, and it ends NO_MEDIA_FOUND",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      const error = await probeError("/player-tabs-nav-no-iframe.html", resolverWith());

      expectCode(error, "NO_MEDIA_FOUND");
      expect(server.requests).not.toContain("/beacon/server-2-nav");
      expect(server.requests).not.toContain("/beacon/server-2-button");
    },
  );

  test(
    "a blank player iframe with no tab to press (a Server 2 link that leaves the page, a Share button) ends NO_MEDIA_FOUND, pressing neither",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      const error = await probeError("/player-blank-iframe-no-tab.html", resolverWith());

      expectCode(error, "NO_MEDIA_FOUND");
      expect(server.requests).not.toContain("/beacon/server-2-leaves");
      expect(server.requests).not.toContain("/beacon/share");
    },
  );
});

describe("the server-tab press and what it must not set off (dl-139 gate round 1)", () => {
  function resolverWith(): BrowserResolver {
    return new BrowserResolver({
      pool,
      hlsParser: recordingHlsParser().parser,
      ...BASE_WAITS,
      emptyMinWaitMs: NO_EMPTY_FLOOR_MS,
    });
  }

  // Each control reads like a server tab and, pressed, takes the page somewhere:
  // through a link it wraps or sits in, a form it belongs to, or a new window.
  // The fixture records `pressed-<ctl>` when anything is clicked and `left-<ctl>`
  // at the link's or form's own target, so either one reds the row.
  test.each([
    ["a list item whose text is Server 2, wrapping a link", "li-text"],
    ["a role=button wrapper of a Server 2 link", "role-button"],
    ["a list item with data-player around a Next video link", "li-data"],
    ["a Server 2 button inside a link", "link-around"],
    ["a Server 2 button owned by a form it is not inside", "form-outside"],
    ["a Server 2 link that opens a new window", "target-new"],
  ])("does not press %s", { timeout: TEST_TIMEOUT_MS }, async (_name, ctl) => {
    server.requests.length = 0;
    const error = await probeError(`/player-tabs-unsafe-control.html?ctl=${ctl}`, resolverWith());

    expectCode(error, "NO_MEDIA_FOUND");
    expect(server.requests.filter((pathname) => pathname.startsWith("/beacon/"))).toEqual([]);
    // `target=_new` would have opened the page a second time.
    expect(
      server.requests.filter((pathname) => pathname === "/player-tabs-unsafe-control.html"),
    ).toHaveLength(1);
  });

  test(
    "a tab that leaves the player iframe blank is pressed once in the whole probe, over both passes, and the next tab is never tried",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      server.requests.length = 0;
      // Nothing is captured and the iframe is still blank when the second pass
      // starts, so only the once-per-probe flag stands between that pass and a
      // second press of the same active tab.
      const error = await probeError("/player-tabs-stays-blank.html", resolverWith());

      expectCode(error, "NO_MEDIA_FOUND");
      expect(server.requests.filter((pathname) => pathname === "/beacon/tab-1")).toHaveLength(1);
      expect(server.requests).not.toContain("/beacon/tab-2");
    },
  );
});
