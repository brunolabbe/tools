/**
 * When the probe stops: the departure guard, the surface click's choice, the cross-origin chooser, the empty media floor, and the quiet wait's minimum (split from browser-resolver.test.ts, dl-117).
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AppError } from "@downloader/contract";
import type * as provoke from "../../src/browser/provoke.ts";
import type { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver, MIN_WAIT_MS } from "../../src/resolvers/browser.ts";
import type { BrowserResolverLogger } from "../../src/resolvers/browser.ts";
import { recordingHlsParser } from "./helpers/fake-parsers.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";
import {
  NO_EMPTY_FLOOR_MS,
  TEST_TIMEOUT_MS,
  closeBrowserHarness,
  expectCode,
  options,
  probes,
  startBrowserHarness,
} from "./helpers/browser-harness.ts";
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

describe("BrowserResolver", () => {
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
    },
  );

  test(
    "a minWaitMs below it is the one the wait is handed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const { handedMs } = await quietWait(STREAM_WAITS.minWaitMs);

      expect(handedMs).toBe(STREAM_WAITS.minWaitMs);
    },
  );
});

/** Elapsed milliseconds since the call, off a clock that follows no one's `date`. */
function startStopwatch(): () => number {
  const startedAt = performance.now();
  return () => performance.now() - startedAt;
}
