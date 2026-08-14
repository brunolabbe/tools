// oxlint-disable no-await-in-loop -- every loop here drives one browser through
// a sequence of interactions. Each step changes the page the next step reads, so
// running them concurrently would race the very state they depend on.

/**
 * Making the player start.
 *
 * Nothing is captured until the page actually asks for media, and most pages
 * will not until a consent banner is gone and something has been clicked. Every
 * step here is best-effort: a selector that does not exist is the normal case,
 * never an error.
 *
 * In-page code is written as strings because this package compiles as Node code
 * with no DOM lib. Values interpolated into a script are JSON-encoded.
 */

import type { Frame, Page } from "playwright";
import { budget, remaining, sleep, throwIfAborted } from "./abort.ts";
import type { HitCollector } from "./intercept.ts";

/** Vendor-specific accept buttons, most-common first. */
const CONSENT_SELECTORS: readonly string[] = [
  "#onetrust-accept-btn-handler",
  "button#didomi-notice-agree-button",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button[data-testid='uc-accept-all-button']",
  "button[mode='primary'].qc-cmp2-button",
  ".fc-cta-consent",
  ".cc-btn.cc-allow",
  "button[aria-label='Accept all']",
  "button[aria-label='Accept cookies']",
  "[id*='accept-cookie' i]",
  "[class*='accept-cookie' i]",
  "[id*='cookie'] button[id*='accept' i]",
];

/** Text-matched fallback in the languages we see most often. */
const CONSENT_TEXT =
  /^\s*(?:accept(?: all| cookies| and continue)?|i accept|agree|i agree|allow all|got it|ok|okay|continue|understood|alles akzeptieren|akzeptieren|zustimmen|einverstanden|tout accepter|accepter|j'accepte|aceptar( todo)?|acepto|aceitar|accetta(?: tutto)?|accetto|akkoord|godkänn|zgadzam się|принять)\s*$/i;

const PLAY_SELECTORS: readonly string[] = [
  "button[aria-label*='play' i]",
  "[role='button'][aria-label*='play' i]",
  "button[title*='play' i]",
  ".vjs-big-play-button",
  ".ytp-large-play-button",
  ".jw-icon-display",
  ".plyr__control--overlaid",
  "[data-testid*='play' i]",
  "[class*='play-button' i]",
  "[class*='play-btn' i]",
  "[id*='play-button' i]",
  "button#play",
  "#play",
];

const PLAY_TEXT =
  /^\s*(?:play|watch|watch now|start|play video|lecture|abspielen|reproducir|riproduci|afspelen)\s*$/i;

const SCROLL_SCRIPT = `(() => {
  var el = document.querySelector('video, iframe, [class*="player"], [id*="player"]');
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  try { window.scrollBy(0, 400); } catch {}
  return !!el;
})()`;

/**
 * Muted + playsinline first: an unmuted autoplay attempt is rejected outright by
 * the autoplay policy on any build where our launch flag did not apply.
 */
const PLAY_SCRIPT = `(() => {
  var videos = Array.prototype.slice.call(document.querySelectorAll('video, audio'));
  var attempted = 0;
  for (var i = 0; i < videos.length; i++) {
    var media = videos[i];
    try {
      media.muted = true;
      media.setAttribute('playsinline', '');
      media.autoplay = true;
      if (media.load && media.readyState === 0 && media.currentSrc) media.load();
      var promise = media.play();
      if (promise && typeof promise.catch === 'function') promise.catch(function () {});
      attempted++;
    } catch {}
  }
  return attempted;
})()`;

const METADATA_SCRIPT = `(() => {
  var attr = function (selector, name) {
    var el = document.querySelector(selector);
    var value = el ? el.getAttribute(name) : null;
    return value && value.trim() ? value.trim() : null;
  };
  var media = document.querySelector('video, audio');
  var duration = media && isFinite(media.duration) && media.duration > 0 ? media.duration : null;
  return {
    ogTitle: attr('meta[property="og:title"]', 'content')
      || attr('meta[name="og:title"]', 'content')
      || attr('meta[name="twitter:title"]', 'content'),
    ogImage: attr('meta[property="og:image"]', 'content')
      || attr('meta[property="og:image:url"]', 'content')
      || attr('meta[name="twitter:image"]', 'content'),
    docTitle: document.title ? document.title.trim() : null,
    durationSec: duration,
  };
})()`;

const SIGNALS_SCRIPT = `(() => {
  var body = document.body;
  var text = body ? (body.innerText || body.textContent || '') : '';
  var root = document.documentElement;
  return {
    title: document.title || '',
    bodyText: text.slice(0, 4000),
    html: root ? root.outerHTML.slice(0, 8000) : '',
    hasPasswordInput: !!document.querySelector('input[type="password"]'),
    hasPlayerElement: !!document.querySelector('video, audio, iframe[src], [class*="player"], [id*="player"]'),
  };
})()`;

export interface PageMetadata {
  ogTitle: string | null;
  ogImage: string | null;
  docTitle: string | null;
  durationSec: number | null;
}

export interface RawPageSignals {
  title: string;
  bodyText: string;
  html: string;
  hasPasswordInput: boolean;
  hasPlayerElement: boolean;
}

function originOf(raw: string): string | undefined {
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

/**
 * Frames we are willing to run script in. Cross-origin embeds still get clicked
 * through the locator API — that goes through the browser, not an evaluation
 * context, so it does not need same-origin access.
 */
function isScriptableFrame(frame: Frame, pageOrigin: string | undefined): boolean {
  const url = frame.url();
  if (url === "" || url === "about:blank" || url.startsWith("about:srcdoc")) return true;
  return originOf(url) === pageOrigin;
}

/**
 * The selector list is compiled into one `:visible` query rather than probed
 * entry by entry: a probe is a round trip to the browser, and forty of them per
 * frame turns a 12-second probe into a 30-second one.
 */
function visibleQuery(selectors: readonly string[]): string {
  return selectors.map((selector) => `${selector}:visible`).join(", ");
}

async function clickVisible(
  frame: Frame,
  selectors: readonly string[],
  options: { timeoutMs: number; max: number },
): Promise<number> {
  let clicked = 0;
  try {
    const locator = frame.locator(visibleQuery(selectors));
    const count = Math.min(await locator.count(), options.max);
    for (let index = 0; index < count; index++) {
      try {
        await locator.nth(index).click({ timeout: options.timeoutMs });
        clicked += 1;
      } catch {
        // Covered by an overlay, detached, or simply not clickable. Normal.
      }
    }
  } catch {
    // Frame detached mid-query.
  }
  return clicked;
}

async function clickByText(frame: Frame, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  for (const role of ["button", "link"] as const) {
    try {
      const locator = frame.getByRole(role, { name: pattern }).first();
      if (!(await locator.isVisible({ timeout: 150 }))) continue;
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch {
      // No such control in this frame.
    }
  }
  return false;
}

export async function dismissConsent(frame: Frame, timeoutMs: number): Promise<number> {
  // One banner per page: clicking a second "accept" is as likely to re-open the
  // preferences dialog as to close anything.
  const clicked = await clickVisible(frame, CONSENT_SELECTORS, { timeoutMs, max: 1 });
  if (clicked === 0 && (await clickByText(frame, CONSENT_TEXT, timeoutMs))) return 1;
  return clicked;
}

async function provokeFrame(frame: Frame, pageOrigin: string | undefined): Promise<void> {
  await dismissConsent(frame, 2000);

  if (isScriptableFrame(frame, pageOrigin)) {
    try {
      await frame.evaluate<boolean>(SCROLL_SCRIPT);
    } catch {
      // Frame navigated away mid-probe.
    }
  }

  await clickVisible(frame, PLAY_SELECTORS, { timeoutMs: 2000, max: 3 });
  await clickByText(frame, PLAY_TEXT, 2000);

  // Clicking the video surface itself is what a person would do when the player
  // has no visible chrome.
  try {
    const video = frame.locator("video").first();
    if (await video.isVisible({ timeout: 150 })) {
      await video.click({ timeout: 1500, force: true, position: { x: 5, y: 5 } });
    }
  } catch {
    // No video element yet, or it is not clickable.
  }

  if (isScriptableFrame(frame, pageOrigin)) {
    try {
      await frame.evaluate<number>(PLAY_SCRIPT);
    } catch {
      // Same as above: never fatal.
    }
  }
}

/**
 * Two passes: players are frequently lazy-mounted, and the frame that holds the
 * real player often only exists after the consent banner is gone.
 */
export async function provokePlayback(
  page: Page,
  options: { deadline: number; signal: AbortSignal },
): Promise<void> {
  const pageOrigin = originOf(page.url());
  for (let pass = 0; pass < 2; pass++) {
    throwIfAborted(options.signal);
    if (remaining(options.deadline) < 2000) return;

    const frames = page.frames();
    for (const frame of frames) {
      if (remaining(options.deadline) < 1500) return;
      try {
        await provokeFrame(frame, pageOrigin);
      } catch {
        // A frame can detach at any moment; the others still deserve a try.
      }
    }
    if (pass === 0) await sleep(budget(options.deadline, 900), options.signal);
  }
}

/**
 * Waits for the network to go quiet, so late-arriving variant playlists are not
 * missed. Returns false when the deadline arrived first — that distinction is
 * what separates `TIMEOUT` from `NO_MEDIA_FOUND`.
 */
export async function waitForQuiet(options: {
  collector: HitCollector;
  deadline: number;
  quietMs: number;
  minWaitMs: number;
  signal: AbortSignal;
  stop?: () => boolean;
}): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    throwIfAborted(options.signal);
    if (options.stop?.()) return true;
    const idleFor = Date.now() - options.collector.lastActivityAt;
    const waitedFor = Date.now() - startedAt;
    if (waitedFor >= options.minWaitMs && idleFor >= options.quietMs) return true;
    if (remaining(options.deadline) <= 0) return false;
    await sleep(Math.min(200, remaining(options.deadline)), options.signal);
  }
}

export async function readMetadata(page: Page): Promise<PageMetadata> {
  try {
    return await page.evaluate<PageMetadata>(METADATA_SCRIPT);
  } catch {
    return { ogTitle: null, ogImage: null, docTitle: null, durationSec: null };
  }
}

export async function readSignals(page: Page): Promise<RawPageSignals> {
  try {
    return await page.evaluate<RawPageSignals>(SIGNALS_SCRIPT);
  } catch {
    return { title: "", bodyText: "", html: "", hasPasswordInput: false, hasPlayerElement: false };
  }
}
