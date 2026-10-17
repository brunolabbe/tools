/**
 * Labelled controls: the age gate's links, and consent buttons in a dialog, a bar and a fixed layer (split from browser-resolver.test.ts, dl-117).
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
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

describe("BrowserResolver", () => {
  describe("a modal over an age gate (dl-48)", () => {
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
