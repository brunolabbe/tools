/**
 * `readMetadata`'s duration fallback, against a real page (dl-55).
 *
 * The end-to-end sniffer tests in `browser-resolver.test.ts` cannot isolate
 * this: a parsed HLS/DASH manifest supplies `ProbeOutcome.durationSec` first,
 * which always wins over `readMetadata`'s fallback in a full probe. This file
 * drives `readMetadata` directly against a page with no manifest at all, so
 * the fallback itself is what is under test.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { classifyFailure } from "../../src/browser/classify.ts";
import { BrowserPool } from "../../src/browser/pool.ts";
import { dismissModal, readMetadata, readSignals } from "../../src/browser/provoke.ts";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";

let server: FixtureServer;
let pool: BrowserPool;

beforeAll(async () => {
  server = await startFixtureServer();
  pool = new BrowserPool({ maxConcurrent: 1, headless: true });
});

afterAll(async () => {
  await pool.close();
  await server.close();
});

describe("readMetadata's duration fallback (dl-55)", () => {
  test("reads the chosen player's duration, not a related card's", async () => {
    const durationSec = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/duration-chooser.html"), {
            waitUntil: "domcontentloaded",
          });
          return (await readMetadata(page)).durationSec;
        } finally {
          await context.close();
        }
      },
    );

    // The card's own `duration` (30) would win under a first-match chooser;
    // the real player's (942) is the one `CHOOSE_VIDEO_FN` must pick, because
    // the card sits inside an `a[href]`.
    expect(durationSec).toBe(942);
  });
});

describe("readMetadata's audio fallback reaches a shadow root (dl-68)", () => {
  test("reads a shadow-root <audio>'s duration when there is no video at all", async () => {
    const durationSec = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/shadow-audio-duration.html"), {
            waitUntil: "domcontentloaded",
          });
          return (await readMetadata(page)).durationSec;
        } finally {
          await context.close();
        }
      },
    );

    // No `<video>` on the page, so `CHOOSE_VIDEO_FN` returns null and
    // `document.querySelector('audio')` would find nothing — the shadow-root
    // `<audio>` is only reachable through the same shadow-piercing walk.
    expect(durationSec).toBe(217);
  });
});

describe("hasPlayerElement reaches a shadow root (dl-69)", () => {
  test("a password field does not stop the chain when the real player is in an open shadow root", async () => {
    const { signals, verdict } = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const url = server.url("/password-shadow-player.html");
          await page.goto(url, { waitUntil: "domcontentloaded" });
          const readSignalsResult = await readSignals(page);
          return {
            signals: readSignalsResult,
            verdict: classifyFailure({
              ...readSignalsResult,
              finalUrl: url,
              status: 200,
              quietReached: true,
            }),
          };
        } finally {
          await context.close();
        }
      },
    );

    // `document.querySelector` would miss the shadow-root `<video>` and
    // `classifyFailure` would call this AUTH_REQUIRED (`reason: "login-form"`),
    // which stops the resolver chain outright — the wrong answer for a page
    // that also carries a real player, just not in the light DOM.
    expect(signals.hasPlayerElement).toBe(true);
    expect(verdict.code).not.toBe("AUTH_REQUIRED");
  });
});

describe("dismissModal's close-layer guard reaches a shadow root (dl-69)", () => {
  test("leaves a dialog alone when its only video is in an open shadow root", async () => {
    const clicked = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/modal-shadow-player.html"), {
            waitUntil: "domcontentloaded",
          });
          return await dismissModal(page.mainFrame(), { timeoutMs: 1500, scriptable: true });
        } finally {
          await context.close();
        }
      },
    );

    // `container.querySelector('video')` would miss the shadow-root video,
    // the guard would not fire, and the close button would be pressed —
    // dismissing the lightbox that holds the real player (dl-69's Why).
    expect(clicked).toBe(0);
  });
});
