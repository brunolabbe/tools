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
import {
  dismissModal,
  provokePlayback,
  readMetadata,
  readSignals,
} from "../../src/browser/provoke.ts";
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
    // `classify.ts`'s own doc: only `NO_MEDIA_FOUND` falls through to the next
    // resolver tier, so that is the one non-`AUTH_REQUIRED` verdict this test
    // may accept — `not.toBe("AUTH_REQUIRED")` alone would also pass for
    // another chain-stopping code (gate round 1, low).
    expect(signals.hasPlayerElement).toBe(true);
    expect(verdict.code).toBe("NO_MEDIA_FOUND");
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

  test("leaves a dialog alone when the dialog itself is the shadow host of its video", async () => {
    const clicked = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/modal-is-shadow-host.html"), {
            waitUntil: "domcontentloaded",
          });
          return await dismissModal(page.mainFrame(), { timeoutMs: 1500, scriptable: true });
        } finally {
          await context.close();
        }
      },
    );

    // `ALL_MEDIA_FN` walked only `container`'s descendants, never
    // `container.shadowRoot` itself — so a custom-element lightbox whose
    // `role="dialog"` element is itself the shadow host (a `<slot>`
    // projecting the light-DOM close button, the video a pure shadow child)
    // was missed and its close control pressed (gate round 1, med 1).
    expect(clicked).toBe(0);
  });

  test("still closes a dialog whose only video is an unrelated shadow root elsewhere on the page", async () => {
    const clicked = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/modal-shadow-video-outside.html"), {
            waitUntil: "domcontentloaded",
          });
          return await dismissModal(page.mainFrame(), { timeoutMs: 1500, scriptable: true });
        } finally {
          await context.close();
        }
      },
    );

    // A shadow-root video with nothing to do with the dialog must never
    // excuse the dialog's own close control from being pressed (gate round
    // 1, med 1's scope check).
    expect(clicked).toBe(1);
  });
});

describe("SCROLL_SCRIPT reaches a shadow root, for a player that mounts lazily on scroll (dl-69 gate round 1, med 2)", () => {
  test("requests the manifest once the off-screen shadow-root shell scrolls into view", async () => {
    server.requests.length = 0;
    await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(server.url("/shadow-player-lazy-mount.html"), {
          waitUntil: "domcontentloaded",
        });
        await provokePlayback(page, {
          deadline: Date.now() + 15_000,
          signal: new AbortController().signal,
          confirmAge: false,
        });
      } finally {
        await context.close();
      }
    });

    // `document.querySelector` never finds the shell (it lives in an open
    // shadow root), so the old `SCROLL_SCRIPT` never scrolled to it and the
    // page's own `IntersectionObserver` never fired: no scroll, no manifest
    // request. The shadow-piercing walk matches on the shell's own
    // `player-shell` class and scrolls to it, which is what triggers the
    // fetch below.
    expect(server.requests).toContain("/media/related/master.m3u8");
  });
});

describe("an age gate is recognised by its structure, and only that (dl-83)", () => {
  async function ageGateAt(pathname: string): Promise<boolean> {
    return await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(server.url(pathname), { waitUntil: "domcontentloaded" });
        return (await readSignals(page)).ageGate;
      } finally {
        await context.close();
      }
    });
  }

  // The positive control: without it, a `readSignals` that always answered
  // false would pass every negative below.
  test("recognises the Italian gate in a fixed layer", async () => {
    expect(await ageGateAt("/age-gate-overlay.html")).toBe(true);
  });

  test.each([
    ["an 18+ category link in a fixed nav bar", "/age-negative-nav.html"],
    ["a Top 21 heading in a modal", "/age-negative-top21.html"],
    ["a cookie dialog that mentions 18 partners", "/age-negative-cookie.html"],
    ["a promo modal with a Get 18% off button", "/age-negative-promo.html"],
    ["a full-screen menu whose only 18 is its own 18+ link", "/age-negative-menu.html"],
  ])("%s is no gate", async (_name, pathname) => {
    expect(await ageGateAt(pathname)).toBe(false);
  });
});
