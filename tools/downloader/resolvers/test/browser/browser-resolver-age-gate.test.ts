/**
 * The age gate: pressed when it is the gate, refused when it is not, and recognised by its structure (split from browser-resolver.test.ts, dl-117).
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

describe("BrowserResolver", () => {
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
  });
});
