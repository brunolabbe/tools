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
  cappedTimeout,
  CONSENT_TEXT,
  CONSENT_TEXT_ANYWHERE,
  CONSENT_WORDING,
  dismissModal,
  provokePlayback,
  readMetadata,
  readSignals,
  SCROLL_SCRIPT,
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

describe("CONSENT_TEXT (dl-82)", () => {
  // Every phrasing the pattern accepted before dl-82, so a widening cannot
  // drop one.
  const KEPT = [
    "Accept",
    "Accept all",
    "Accept cookies",
    "Accept and continue",
    "I accept",
    "Agree",
    "I agree",
    "Allow all",
    "Got it",
    "OK",
    "Okay",
    "Continue",
    "Understood",
    "Alles akzeptieren",
    "Akzeptieren",
    "Zustimmen",
    "Einverstanden",
    "Tout accepter",
    "Accepter",
    "J'accepte",
    "Aceptar",
    "Aceptar todo",
    "Acepto",
    "Aceitar",
    "Accetta",
    "Accetta tutto",
    "Accetto",
    "Akkoord",
    "Godkänn",
    "Zgadzam się",
    "Принять",
  ];

  const ADDED = [
    "Accept & close",
    "Accept all & continue",
    "Accept and close",
    "Agree and continue",
    "Agree & close",
    "Yes, I agree",
    "Yes I agree",
    "I agree.",
    "Allow all cookies",
    "Alle akzeptieren",
    "Akzeptieren und weiter",
    "Ich stimme zu",
    "Tout accepter et fermer",
    "Accepter et continuer",
    "J’accepte",
    "Je suis d'accord",
    "Aceptar y continuar",
    "Estoy de acuerdo",
    "Aceitar tudo",
    "Aceito",
    "Concordo",
    "Accetta tutti",
    "Accetta e chiudi",
    "Accetto e continua",
    "Acconsento",
    "Sono d'accordo",
    "Ho capito",
    "Alles accepteren",
    "Accepteren en doorgaan",
    "Ik ga akkoord",
    "Acceptera alla",
    "Jag godkänner",
    "Akceptuję",
    "Zgadzam się i przechodzę do serwisu",
    "Принять все",
    "Принять и закрыть",
    "Я согласен",
  ];

  // Sentences, pagination and words that mean "go in" rather than "agree":
  // none of these is a consent label, and the first group is what a loose
  // pattern would press on a page that is not a consent wall at all.
  const REFUSED = [
    "Continua",
    "Continue reading",
    "Accept the terms of the offer",
    "I agree with this review",
    "Sono d'accordo con questa recensione",
    "Accetto le condizioni di spedizione",
    "Allow",
    "Yes",
    "Entra",
    "Enter",
    "Accept or decline",
    "Agree and continue to checkout",
    "Ho capito tutto",
    // Each ENDS in a phrasing the pattern knows, so only the start anchor
    // refuses it (dl-82's gate: dropping the `^` passed every other row).
    "Read and continue",
    "Click OK",
    "Premi OK",
    "Please accept",
    "Non accetto",
    "",
  ];

  test.each(KEPT)("still matches %j", (label) => {
    expect(CONSENT_TEXT.test(label)).toBe(true);
  });

  test.each(ADDED)("matches %j", (label) => {
    expect(CONSENT_TEXT.test(label)).toBe(true);
  });

  test.each(REFUSED)("does not match %j", (label) => {
    expect(CONSENT_TEXT.test(label)).toBe(false);
  });

  // The whole-frame reach is the old pattern and only it: a phrasing added by
  // dl-82 is pressed inside a consent container, never anywhere on the page.
  test.each(KEPT)("CONSENT_TEXT_ANYWHERE still matches %j", (label) => {
    expect(CONSENT_TEXT_ANYWHERE.test(label)).toBe(true);
  });

  test.each(ADDED)("CONSENT_TEXT_ANYWHERE does not match %j", (label) => {
    expect(CONSENT_TEXT_ANYWHERE.test(label)).toBe(false);
  });

  // The pagination link "Continua" and the review vote "Sono d'accordo con questa
  // recensione" were pressed in a browser until dl-113 (the dl-82 lookalikes
  // page); the pattern that reaches outside a container refuses every sentence and
  // bare word this one does.
  test.each(REFUSED)("CONSENT_TEXT_ANYWHERE does not match %j either", (label) => {
    expect(CONSENT_TEXT_ANYWHERE.test(label)).toBe(false);
  });
});

describe("CONSENT_WORDING (dl-82 gate 2)", () => {
  // What a consent layer says, one line per language the labels cover.
  const SPEAKS = [
    "We use cookies to improve your experience.",
    "By continuing you give your consent.",
    "Diese Website verwendet Cookie-Einstellungen.",
    "Bitte geben Sie Ihre Einwilligung.",
    "Ce site utilise des témoins de connexion.",
    "Nous avons besoin de votre consentement.",
    "Usamos cookies. Necesitamos su consentimiento.",
    "Usamos cookies e pedimos o seu consentimento.",
    "Usiamo i cookie. Serve il tuo consenso.",
    "We gebruiken cookies. Geef toestemming.",
    "Vi använder kakor och behöver ditt samtycke.",
    "Ta strona używa ciasteczek.",
    "Prosimy o zgodę na przetwarzanie danych.",
    "Мы используем куки.",
    "Нам нужно согласие на обработку данных.",
    "Compliant with GDPR.",
    // dl-82 gate 3: a word start and a word end, so these still match.
    "Cookies",
    "Cookie-Banner",
    "We store your consents.",
    "Nous utilisons des fichiers témoins de connexion.",
    "Kakor",
    "Использует куки!",
    // dl-93: "cookie" needs no word start, because German and Swedish compound it.
    "Wir verwenden Statistikcookies und Marketingcookies.",
    "Läs mer om kakorna på sajten.",
    // The wordings of consent-scope's r4 and r6 rows (dl-113). r3, r7 and r8 are
    // "Cookie-Einstellungen", "Statistikcookies" and "kakorna" above; these two were
    // the ones no row here carried.
    "Ta strona używa plików cookie.",
    "Wir verwenden Cookies.",
    "Vi använder kakorn.",
    // dl-93, at landing (gate 2): the compounds a7f47bd2's bare "cookie" matched
    // and the first named list did not.
    "Wir nutzen Präferenzcookies.",
    "Komfortcookies erlauben",
    "Wir verwenden nur Sitzungscookies.",
    "Leistungscookies zulassen",
    "Performancecookies zulassen",
    "Targetingcookies zulassen",
    "Wir nutzen Sessioncookies.",
    "Erstanbietercookies",
    "Wij plaatsen advertentiecookies.",
  ];

  // What a docked bar, a header notice or a form says instead. These are the
  // pages dl-82's gate pressed a submit or a notice on.
  const SILENT = [
    "By ordering you accept our terms.",
    "Nuove condizioni di spedizione.",
    "Shipping changed.",
    "Do you agree to the community rules?",
    "Iscriviti alla newsletter per ricevere le offerte.",
    "Home",
    "",
    // dl-82 gate 3: ordinary words that merely begin like a consent word. The
    // gate's a4 (Italian "consente", in a docked checkout bar) and a5 (Swedish
    // "pannkakor", in a sticky header's note) were also probed in a browser until
    // dl-113; their fixture sentences are these two rows.
    "Il pagamento sicuro consente di ordinare.",
    "Il pagamento è consentito.",
    "I partner consentono l'ordine.",
    "Veckans recept: pannkakor.",
    "Sockerkakor till kaffet.",
    // dl-93 gate 1: "cookie" inside an ordinary word is food, a product or a URL.
    "Schokocookies backen: das beste Rezept.",
    "Haferflockencookies ohne Zucker",
    "Recept voor chocoladecookies.",
    "Chokladcookies med havre.",
    "Supercookie Box, 12 pieces",
    "#sugarcookie season",
    "Visit thecookiejar.example",
    "3 Schokocookies im Warenkorb.",
    // dl-93: the Swedish definite forms keep the word start.
    "Pannkakorna är klara.",
    "Sockerkakorna står på bordet.",
    "Les témoins de l'accident.",
    "Кукиш",
    // Accepted, not wished for: a bare privacy notice is not recognised, so its
    // new-only label falls through to the old pattern (the decision's cost).
    "We value your privacy.",
    "By ordering you accept our terms and privacy policy.",
  ];

  test.each(SPEAKS)("speaks of consent: %j", (text) => {
    expect(CONSENT_WORDING.test(text)).toBe(true);
  });

  test.each(SILENT)("does not speak of consent: %j", (text) => {
    expect(CONSENT_WORDING.test(text)).toBe(false);
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

describe("the input pass sends no key but the existing Escape (dl-81)", () => {
  /** Every `keydown` the page saw, in order, whoever sent it. */
  async function keysPressedDuringProvocation(pathname: string): Promise<string[]> {
    return await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
      const context = await browser.newContext();
      try {
        await context.addInitScript({
          content: `window.__keys = [];
            window.addEventListener('keydown', function (e) { window.__keys.push(e.key); }, true);`,
        });
        const page = await context.newPage();
        await page.goto(server.url(pathname), { waitUntil: "domcontentloaded" });
        await provokePlayback(page, {
          deadline: Date.now() + 15_000,
          signal: new AbortController().signal,
          confirmAge: false,
        });
        return await page.evaluate<string[]>("window.__keys");
      } finally {
        await context.close();
      }
    });
  }

  // Enter or Space on a focused element can submit a form or follow a link.
  test("a page with nothing to dismiss receives no key at all", async () => {
    expect(await keysPressedDuringProvocation("/input-gated-player.html")).toEqual([]);
  });

  test("a dialog with no close control still earns its Escape, and nothing beside it", async () => {
    const keys = await keysPressedDuringProvocation("/modal-escape.html");

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key === "Escape")).toBe(true);
  });
});

describe("SCROLL_SCRIPT targets the largest candidate (dl-81)", () => {
  test("brings the large shell into view, not the small nav bar that comes first", async () => {
    const placement = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/player-scroll-target.html"), {
            waitUntil: "domcontentloaded",
          });
          await page.evaluate<boolean>(SCROLL_SCRIPT);
          return await page.evaluate<{ top: number; bottom: number; height: number }>(
            `(() => {
              var rect = document.getElementById('player-main').getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
            })()`,
          );
        } finally {
          await context.close();
        }
      },
    );

    // The first match, a 400x60 nav bar already in view, would scroll nowhere
    // and leave the shell about 4000 px below the viewport.
    expect(placement.top).toBeLessThan(placement.height);
    expect(placement.bottom).toBeGreaterThan(0);
  });

  // Gate 1's page, once probed through the whole resolver (dl-113): the first
  // match is a 300x250 ad iframe and a nav bar, both already in view, and the real
  // shell, the largest candidate, sits 3000 px down.
  test("brings the large shell into view, not the ad iframe and nav bar above the fold", async () => {
    const placement = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url("/player-nav-first.html"), {
            waitUntil: "domcontentloaded",
          });
          await page.evaluate<boolean>(SCROLL_SCRIPT);
          return await page.evaluate<{ top: number; bottom: number; height: number }>(
            `(() => {
              var rect = document.querySelector('.player-shell').getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
            })()`,
          );
        } finally {
          await context.close();
        }
      },
    );

    expect(placement.top).toBeLessThan(placement.height);
    expect(placement.bottom).toBeGreaterThan(0);
  });
});

describe("a page that refuses the visitor's region is GEO_BLOCKED (dl-113)", () => {
  // `capture-rules.test.ts` pins the wording against a hand-made signals object;
  // this reads the signals off the page, which is what the resolver-level probe of
  // the same page added, without launching the whole probe.
  test("reads the refusal off the page and classifies it", async () => {
    const verdict = await pool.withBrowser(
      { signal: new AbortController().signal },
      async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const url = server.url("/geo.html");
          await page.goto(url, { waitUntil: "domcontentloaded" });
          return classifyFailure({
            ...(await readSignals(page)),
            finalUrl: url,
            status: 200,
            quietReached: true,
          });
        } finally {
          await context.close();
        }
      },
    );

    expect(verdict.code).toBe("GEO_BLOCKED");
  });
});

describe("clickTimeoutMs caps the clicks a covering layer blocks (dl-118, dl-122)", () => {
  // Each page puts a cover up that stays up, so each consent and play click is
  // retried until its timeout. Uncapped that is 2000 ms a click.
  //
  // The check is the mechanism, not the clock (dl-122): every click that was
  // rejected was given the cap as its timeout. A wall-clock ceiling on the menu
  // row failed on a Windows runner twice (dl-119: 3584 ms against 3000; dl-122:
  // 4286 ms against 4000) while the two cookie rows beside it read normal, and
  // at 4.3 s it was only 1.2 s under the one-site regression (5.5 s), so a
  // reading that slow no longer showed the cap working. The click's timeout does
  // not depend on the runner.
  //
  // The observation point is `Locator.click`, wrapped on the prototype
  // Playwright's client gives every locator. That class is internal, not
  // documented API: if a Playwright upgrade moves it, the `typeof` check below
  // and the empty-list companion fail the row rather than letting it pass.
  //
  // What it does not cover: a wait that is not a click's timeout. The cookie rows
  // keep their wall-clock ceiling for that reason (capped 2.1 to 2.5 s; the
  // consent click uncapped is 3.9 to 4.5 s, so 3200 ms sits near the middle).
  // The menu row has none: its play clicks are the only blocked ones, and they
  // are click timeouts.
  //
  // Clicks are told apart by outcome, not by value. The age-gate press and the
  // video clicks legitimately carry 2000 and 1500 and succeed; only a click that
  // rejected waited out its whole timeout, so only those must carry the cap. The
  // count of rejected clicks varies with timing (four on the menu page, five on a
  // cookie sheet), so the companion asks for at least one, not an exact number.
  const CAP_MS = 200;
  const COOKIE_CEILING_MS = 3200;

  interface RecordedClick {
    timeout: unknown;
    rejected: boolean;
  }
  type ClickFn = (this: unknown, options?: { timeout?: unknown }) => Promise<unknown>;

  // Array rows with %s, not objects with $name: Vitest quotes a `$` value and cuts
  // it at 40 characters, which gave the two cookie rows one title. The ceiling is
  // the fourth element, so no placeholder reads it (a %d took the wrong argument
  // in dl-118 and printed NaN). A null ceiling is the menu row's: no clock.
  test.each([
    ["a shell's 18+ menu button", "/age-false-shell-menu-button.html", "/beacon/nav-18", null],
    [
      "a cookie sheet's View our 18 partners, closable panel",
      "/age-false-cookie-sheet-closable.html",
      "/beacon/view-partners",
      COOKIE_CEILING_MS,
    ],
    [
      "a cookie sheet's View our 18 partners, sticky panel",
      "/age-false-cookie-sheet-sticky.html",
      "/beacon/view-partners",
      COOKIE_CEILING_MS,
    ],
  ])(
    "%s: the blocked clicks are given the cap, not 2000 ms",
    async (_name, pathname, pressed, ceilingMs) => {
      server.requests.length = 0;
      const clicks: RecordedClick[] = [];
      let elapsedMs = Number.NaN;
      await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(server.url(pathname), { waitUntil: "domcontentloaded" });
          const proto: { click?: ClickFn } = Object.getPrototypeOf(page.locator("body"));
          const original = proto.click;
          expect(typeof original).toBe("function");
          if (original === undefined) return;
          // Wrapped by hand and put back in `finally`, not `vi.spyOn`: this block
          // owns no `vi`, and the prototype is shared by every later test.
          proto.click = async function (this: unknown, options?: { timeout?: unknown }) {
            const record: RecordedClick = { timeout: options?.timeout, rejected: false };
            clicks.push(record);
            try {
              return await original.call(this, options);
            } catch (error) {
              record.rejected = true;
              throw error;
            }
          };
          try {
            const startedAt = Date.now();
            await provokePlayback(page, {
              deadline: Date.now() + 15_000,
              signal: new AbortController().signal,
              confirmAge: true,
              clickTimeoutMs: CAP_MS,
            });
            elapsedMs = Date.now() - startedAt;
          } finally {
            proto.click = original;
          }
        } finally {
          await context.close();
        }
      });

      // The press landed, which is what opened the cover.
      expect(server.requests).toContain(pressed);
      expect(server.requests).not.toContain("/beacon/play");

      // The companion that fails on empty: with no rejected click the check below
      // is vacuous, which is also what a moved prototype would look like.
      const rejected = clicks.filter((click) => click.rejected);
      expect(rejected.length).toBeGreaterThan(0);
      // Every click that waited out its timeout was given the cap. A site that
      // lost the cap shows here as a click at 2000, and this names it.
      expect(rejected.filter((click) => click.timeout !== CAP_MS)).toEqual([]);

      if (ceilingMs !== null) expect(elapsedMs).toBeLessThan(ceilingMs);
    },
  );
});

describe("cappedTimeout (dl-118)", () => {
  // The cap only lowers a wait. Playwright reads a timeout of 0 or NaN as "no
  // timeout", so a cap of either passed through would lift the bound instead.
  test.each([
    { name: "unset", cap: undefined, expected: 2000 },
    { name: "300", cap: 300, expected: 300 },
    { name: "5000, above the wait", cap: 5000, expected: 2000 },
    { name: "0", cap: 0, expected: 2000 },
    { name: "NaN", cap: Number.NaN, expected: 2000 },
    { name: "negative", cap: -1, expected: 2000 },
    { name: "Infinity", cap: Number.POSITIVE_INFINITY, expected: 2000 },
  ])("a cap of $name leaves a 2000 ms wait at $expected ms", ({ cap, expected }) => {
    expect(cappedTimeout(2000, cap)).toBe(expected);
  });
});
