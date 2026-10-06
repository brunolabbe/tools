// oxlint-disable no-await-in-loop -- every loop here drives one browser through
// a sequence of interactions. Each step changes the page the next step reads, so
// running them concurrently would race the very state they depend on.

/**
 * Making the player start.
 *
 * Nothing is captured until the page actually asks for media, and most pages
 * will not until a modal and a consent banner are gone and something has been
 * clicked. Some also stand an age confirmation where the player mounts. Every
 * step here is best-effort: a selector that does not exist is the normal case,
 * never an error.
 *
 * In-page code is written as strings because this package compiles as Node code
 * with no DOM lib. Values interpolated into a script are JSON-encoded.
 */

import type { Frame, Locator, Page } from "playwright";
import { budget, remaining, sleep, throwIfAborted } from "./abort.ts";
import { AGE_MARKERS } from "./classify.ts";
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

/**
 * Text-matched fallback in the languages we see most often, with one or more
 * entries per language so a gap is one more alternative and the whole stays one
 * anchored pattern (`AGE_GATE_TEXT`'s rule: an alternative, not a new branch).
 *
 * **A label, never a sentence, and never a generic word.** The pattern is
 * anchored at both ends, so a sentence containing "agree" is not a button. The
 * only generic bare words are the English "continue" and "ok" that were here first;
 * nothing new may be that generic, because the revisits skip consent text
 * precisely since a page repeats such words (see `revisitOverlays`), and the
 * same words as pagination or a vote button are what an unanchored match would
 * press (dl-82). No "enter the site" label either: on a gated page that is an
 * age or terms attestation, which belongs to the age gate, not to consent.
 *
 * **This pattern is matched only inside a consent container** (a dialog, or a
 * fixed or sticky layer — `dismissConsent`), never across the whole frame. The
 * acknowledgement phrasings it added ("Ho capito", "Yes, I agree", "Agree and
 * continue", "Sono d'accordo") are also the labels of a newsletter's dismiss
 * button, a comment form's submit and a review vote, and a whole-frame match
 * pressed those, in DOM order, ahead of the real consent dialog (dl-82's gate).
 * What `CONSENT_TEXT_ANYWHERE` held before keeps its old reach.
 *
 * `&` and "and" both join a verb to its follow-up in English; the other
 * languages carry their own conjunction in the entry. The apostrophe is
 * either, since a CMS often emits the typographic one.
 */
const APOS = "['’]";
const CONSENT_PHRASES: readonly string[] = [
  // English
  String.raw`(?:accept(?: all)?(?: cookies)?|allow all(?: cookies)?)(?: (?:and|&) (?:continue|close))?`,
  String.raw`i accept`,
  String.raw`(?:yes,? )?(?:i )?agree(?: (?:and|&) (?:continue|close))?`,
  String.raw`got it|ok|okay|continue|understood`,
  // German
  String.raw`(?:(?:alles|alle(?: cookies)?) )?akzeptieren(?: und (?:weiter|schließen))?|ich akzeptiere`,
  String.raw`zustimmen(?: und (?:weiter|schließen))?|ich stimme zu|einverstanden`,
  // French
  String.raw`(?:tout accepter|accepter(?: tout| les cookies)?)(?: et (?:continuer|fermer))?`,
  String.raw`j${APOS}accepte|je suis d${APOS}accord`,
  // Spanish
  String.raw`aceptar(?: todo| todas| cookies)?(?: y (?:continuar|cerrar|seguir))?`,
  String.raw`acepto|estoy de acuerdo`,
  // Portuguese
  String.raw`aceitar(?: tudo| todos)?(?: e (?:continuar|fechar|prosseguir))?`,
  String.raw`aceito|concordo`,
  // Italian
  String.raw`accetta(?: tutto| tutti)?(?: e (?:continua|chiudi|prosegui))?`,
  String.raw`accetto(?: e continua)?|acconsento(?: e continua)?|sono d${APOS}accordo|ho capito`,
  // Dutch
  String.raw`(?:accepteer(?: alles)?|(?:alles )?accepteren)(?: en (?:doorgaan|sluiten))?`,
  String.raw`akkoord|ga akkoord|ik ga akkoord|ik accepteer`,
  // Swedish
  String.raw`godkänn(?: alla)?(?: och fortsätt)?|acceptera(?: alla)?|jag godkänner|jag accepterar`,
  // Polish
  String.raw`zgadzam się(?: i przechodzę do serwisu)?|akceptuję(?: wszystko)?|zaakceptuj(?: wszystko)?`,
  // Russian
  String.raw`принять(?: все| и (?:продолжить|закрыть))?|(?:я )?согласен|(?:я )?согласна|понятно`,
];

export const CONSENT_TEXT = new RegExp(`^\\s*(?:${CONSENT_PHRASES.join("|")})\\s*[.!]?\\s*$`, "i");

/**
 * The exact pattern the whole frame was searched with before dl-82, kept
 * verbatim and kept at its old reach: a cookie strip that is neither a dialog
 * nor a fixed layer still gets its "Accept" pressed, as it always did. Nothing
 * is added here; a new phrasing goes in `CONSENT_PHRASES` and so is pressed only
 * inside a consent container. Every phrasing here is also in `CONSENT_TEXT`
 * (pinned by a test), so the container pass can never press less than this.
 */
export const CONSENT_TEXT_ANYWHERE =
  /^\s*(?:accept(?: all| cookies| and continue)?|i accept|agree|i agree|allow all|got it|ok|okay|continue|understood|alles akzeptieren|akzeptieren|zustimmen|einverstanden|tout accepter|accepter|j'accepte|aceptar( todo)?|acepto|aceitar|accetta(?: tutto)?|accetto|akkoord|godkänn|zgadzam się|принять)\s*$/i;

/**
 * A close control's accessible name: a close verb, optionally followed by a
 * word naming an overlay ("Close popup"). Only such a word — the verb followed
 * by anything at all also matched "Close account" (dl-48's gate). Anchored at the start so a sentence containing the
 * word is not a control. Never a call to action — a promo's primary button
 * starts or navigates to other content, and a stream reached through it is the
 * wrong stream (dl-48).
 */
export const CLOSE_TEXT =
  /^\s*(?:[×✕✖x]|close|dismiss|no,? thanks|not now|schließen|fermer|cerrar|chiudi|fechar|sluiten|stäng|zamknij|закрыть|скрыть)(?:\s+(?:the\s+)?(?:popup|pop-up|dialog|modal|banner|window|overlay|offer|ad|advert|advertisement|message|notification|попап|окно|баннер|рекламу|уведомление))?\s*$/i;

/**
 * A control whose label states the viewer is over an age. Anchored, like
 * `CONSENT_TEXT`, so a sentence in the page body is not a label; and a label
 * alone is not a gate — see `AGE_MARKERS`. Each new phrasing is one more
 * alternative, not a new branch.
 */
export const AGE_GATE_TEXT =
  /^\s*(?:(?:yes|да|ja|oui|sí|si|sì|sim|tak)[,.!]?\s+)?(?:i(?:'|’)?m|i am|мне(?:\s+уже)?(?:\s+есть)?|ich bin|j'ai|tengo|ho|tenho|ik ben|jag är|mam(?:\s+ukończone)?)\s+(?:(?:over|at least|older than|больше|über|mindestens|plus de|más de|più di|mais de|ouder dan|över)\s+)?(?:18|21)\s*\+?(?:\s*(?:years(?: old)?|or (?:older|over)|лет|года?|jahre(?: alt)?|oder älter|ans(?: ou plus)?|años(?: o más)?|anni|anos(?: ou mais)?|jaar(?: of ouder)?|år|lat))?\s*[.!]?\s*$/i;

/** Marks the close control `MARK_CLOSE_SCRIPT` chose, so the click goes through the locator API. */
const CLOSE_MARK = "data-downloader-close";

const SEMANTIC_DIALOG = "[role='dialog'], [role='alertdialog'], [aria-modal='true'], dialog[open]";

/**
 * Every element matching `selector` under `root` (default `document`), open
 * shadow roots included, in **Playwright's own locator match order for a single-type
 * selector** (dl-61) — `'video'` or `'audio'` alone, not a comma list.
 *
 * `root.querySelectorAll(selector)` stops at a shadow root, and a custom
 * `<video-player>` web component keeps its player in one; the locator API
 * this chooser replaced pierced open roots by default. Closed roots are
 * invisible to both, so there is nothing to match there.
 *
 * The order is not tree order, and for a `'video'` selector it has to match
 * the locator's: the cross-origin branch of `clickChosenVideo` clicks
 * `frame.locator("video").nth(index)` with an index into that list.
 * Measured against Playwright 1.62's CSS engine, which takes one root's own
 * `querySelectorAll` matches first and only then descends into the shadow
 * roots of that root's elements, in document order, recursively — for light
 * `L1`, host `h1` (shadow `S1a`, nested host `N1`, `S1b`), light `L2`, the
 * locator yields `L1 L2 S1a S1b N1`, where tree order would be
 * `L1 S1a N1 S1b L2`. This walk reproduces the former.
 *
 * **A comma selector does not carry that guarantee** (dl-68's gate, measured
 * against Playwright 1.62.1): the walk still takes a root's own matches
 * first — `querySelectorAll('video, audio')`, tags mixed in tree order —
 * before descending into that root's shadow roots, but the locator for a
 * comma list instead returns plain tree order across shadow boundaries, the
 * order a tree-order walk would give. `PLAY_SCRIPT` and `METADATA_SCRIPT`'s
 * audio fallback (dl-68) only ever use the returned list itself (call
 * `.play()` on everything, or take index `0`), never an index handed to a
 * locator, so the divergence is harmless today. A future caller that indexes
 * `ALL_MEDIA_FN('video, audio')` against a locator would misalign.
 *
 * Takes a selector rather than being hardcoded to `'video'` so `PLAY_SCRIPT`
 * and `METADATA_SCRIPT`'s audio fallback (dl-68) can reuse the identical walk
 * for `'video, audio'` and `'audio'` — a second walk that could drift apart
 * from this one is what dl-55's `CHOOSE_VIDEO_INDEX_FN` split exists to
 * prevent.
 *
 * **Takes an optional `root` too** (dl-69), defaulting to `document` at every
 * call site that already existed — `CHOOSE_VIDEO_FN`, `CHOOSE_VIDEO_INDEX_SCRIPT`,
 * `UNMARK_VIDEO_SCRIPT`, `PLAY_SCRIPT` and `METADATA_SCRIPT`'s audio fallback
 * all still pass none. `SCROLL_SCRIPT` and `SIGNALS_SCRIPT`'s
 * `hasPlayerElement` are dl-69's own new callers, and pass none too.
 * `MARK_CLOSE_SCRIPT`'s close-layer guard is the one caller that needs a
 * narrower start: it has to walk `container`, the layer under
 * consideration, not the whole document — a shadow-root video belonging to
 * some other part of the page must never excuse *this* layer's close
 * control from being pressed.
 *
 * **`walk`'s own recursion never revisits its starting node** (gate round 1,
 * med 1): it queries `node`'s descendants and descends into *their* shadow
 * roots, but a node passed in as `root` is never itself one of those
 * descendants. A custom-element lightbox where the `role="dialog"` element
 * is itself the shadow host of its `<video>` (a `<slot>` projecting the
 * light-DOM close button) made `container` exactly such a node, and the
 * guard above missed it. `root.shadowRoot` is checked once, separately from
 * `walk`, to cover it.
 */
const ALL_MEDIA_FN = `function (selector, root) {
  var out = [];
  var walk = function (node) {
    var matches = node.querySelectorAll(selector);
    for (var i = 0; i < matches.length; i++) out.push(matches[i]);
    var all = node.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      if (all[j].shadowRoot) walk(all[j].shadowRoot);
    }
  };
  var start = root || document;
  walk(start);
  if (start.shadowRoot) walk(start.shadowRoot);
  return out;
}`;

/**
 * Finds the layer that intercepts clicks and marks its close control.
 *
 * **The layer is whatever covers the centre of the viewport**, climbing to the
 * nearest ancestor that is a dialog or `position: fixed`. Dialog semantics alone
 * are not enough: the page dl-48 reproduced had none, only a fixed layer, and
 * two other fixed layers with close buttons of their own (a toast, a banner) —
 * so "the first close control on the page" would have spent the pass on the
 * wrong one. A visible semantic dialog is the fallback when nothing covers the
 * centre.
 *
 * **A fixed layer counts only when it covers something**: page content under
 * the centre point that is neither inside the layer nor one of its ancestors.
 * An app whose whole root is `position: fixed`, a common way to lock scrolling,
 * covers the centre too, with nothing under it; without this its "Close menu"
 * was pressed (dl-48's gate).
 *
 * A layer holding a `<video>` is left alone: sites open their player in a
 * lightbox, and closing that closes the thing this tier exists to watch. The
 * check is shadow-piercing (dl-69, `ALL_MEDIA_FN` scoped to `container`): a
 * player component that keeps its `<video>` in an open shadow root is still
 * "holding" one, whether that root sits on a descendant of `container` or,
 * a custom-element lightbox's own shape, on `container` itself (gate round
 * 1, med 1) — either way the layer around it still gets left alone. A
 * *closed* shadow root is invisible to this check the same way it is to the
 * chooser (`ALL_MEDIA_FN`'s own docstring); there is nothing to query, so a
 * closed-root player still loses its lightbox (gate round 1, low; not
 * fixable here).
 *
 * Returns `marked`, `dialog` (a semantic dialog with no close control this
 * recognises, which earns an Escape), or `none`.
 */
const MARK_CLOSE_SCRIPT = `(() => {
  var close = new RegExp(${JSON.stringify(CLOSE_TEXT.source)}, ${JSON.stringify(CLOSE_TEXT.flags)});
  var semantic = ${JSON.stringify(SEMANTIC_DIALOG)};
  var shown = function (el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  var container = null;
  var stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  var node = stack[0];
  for (; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.matches(semantic) || getComputedStyle(node).position === 'fixed') {
      container = node;
      break;
    }
  }
  if (container) {
    var covers = false;
    for (var k = 0; k < stack.length; k++) {
      var under = stack[k];
      if (under === document.body || under === document.documentElement) continue;
      if (!container.contains(under) && !under.contains(container)) {
        covers = true;
        break;
      }
    }
    if (!covers) container = null;
  }
  if (!container) {
    var dialogs = document.querySelectorAll(semantic);
    for (var i = 0; i < dialogs.length; i++) {
      if (shown(dialogs[i])) {
        container = dialogs[i];
        break;
      }
    }
  }
  if (!container || (${ALL_MEDIA_FN})('video', container).length > 0) return 'none';
  var controls = container.querySelectorAll('button, a, [role="button"], [aria-label], [title]');
  for (var j = 0; j < controls.length; j++) {
    var el = controls[j];
    if (!shown(el)) continue;
    var name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim();
    if (close.test(name)) {
      el.setAttribute(${JSON.stringify(CLOSE_MARK)}, '');
      return 'marked';
    }
  }
  return container.matches(semantic) ? 'dialog' : 'none';
})()`;

const UNMARK_CLOSE_SCRIPT = `(() => {
  var marked = document.querySelectorAll('[${CLOSE_MARK}]');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(${JSON.stringify(CLOSE_MARK)});
})()`;

/** Marks the element `CHOOSE_VIDEO_SCRIPT` chose, so the click goes through the locator API. */
const VIDEO_MARK = "data-downloader-video";

/**
 * Scans a list of `<video>` elements and returns the index of the one a
 * person would call "the player": visible, no `a[href]` or `[role='link']`
 * ancestor, and — among those — the largest rendered area. `-1` when none
 * qualify.
 *
 * **A `<video>` inside a link is a card, never the player.** dl-55's page put
 * a muted hover-preview `<video>` inside a related-video link, first in
 * document order and ahead of the real player; a first-match chooser picked
 * it, and a click there navigated the tab to the card's own page.
 *
 * Takes the candidate list as a parameter rather than querying the document
 * itself, so the identical rule runs two ways without drifting apart: as the
 * body of `CHOOSE_VIDEO_FN` below, and as `CHOOSE_VIDEO_INDEX_SCRIPT`, run
 * through `frame.evaluate` regardless of frame origin (dl-55, decision 3) —
 * both wrap this same function around one `ALL_MEDIA_FN('video')` call; only what the
 * caller does with the result differs.
 *
 * **The link check crosses shadow boundaries** (dl-61): once shadow-root
 * videos are candidates, a card component rendered inside an `<a href>` in the
 * light DOM holds its `<video>` in a shadow root whose `parentElement` chain
 * stops at the root. A composed `click` still bubbles to that link, so the
 * walk steps from a shadow root to its host.
 */
const CHOOSE_VIDEO_INDEX_FN = `function (videos) {
  var best = -1;
  var bestArea = 0;
  var up = function (node) {
    if (node.parentElement) return node.parentElement;
    var parent = node.parentNode;
    return parent && parent.host ? parent.host : null;
  };
  for (var i = 0; i < videos.length; i++) {
    var el = videos[i];
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    var style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    var linked = false;
    for (var node = up(el); node; node = up(node)) {
      var role = node.getAttribute ? node.getAttribute('role') : null;
      if ((node.tagName === 'A' && node.hasAttribute('href')) || role === 'link') {
        linked = true;
        break;
      }
    }
    if (linked) continue;
    var area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  }
  return best;
}`;

/**
 * The chosen element itself, in-page: `ALL_MEDIA_FN('video')`'s candidates fed through `CHOOSE_VIDEO_INDEX_FN`. Shared between the surface click
 * (`CHOOSE_VIDEO_SCRIPT`) and `METADATA_SCRIPT`'s duration fallback, so the
 * two cannot independently drift.
 *
 * One evaluation, no round trip per candidate — `visibleQuery`'s comment
 * explains what probing elements one at a time costs a deadline shared by
 * four provocation steps.
 */
const CHOOSE_VIDEO_FN = `(function () {
  var chooseIndex = ${CHOOSE_VIDEO_INDEX_FN};
  var videos = (${ALL_MEDIA_FN})('video');
  var index = chooseIndex(videos);
  return index === -1 ? null : videos[index];
})`;

/**
 * Runs `CHOOSE_VIDEO_INDEX_FN` against `ALL_MEDIA_FN('video')`'s candidates and
 * returns the chosen index (or `-1`), as a full script rather than a bare
 * function — the index, not the element, is what a caller outside this file's
 * own evaluation can use, since a raw DOM node cannot cross that boundary.
 * Used by `clickChosenVideo`'s cross-origin branch (dl-55, decision 3).
 */
const CHOOSE_VIDEO_INDEX_SCRIPT = `(() => {
  var chooseIndex = ${CHOOSE_VIDEO_INDEX_FN};
  return chooseIndex((${ALL_MEDIA_FN})('video'));
})()`;

/** Marks the chosen element (if any) with `VIDEO_MARK`, so the caller can click it through the locator API. */
const CHOOSE_VIDEO_SCRIPT = `(() => {
  var choose = ${CHOOSE_VIDEO_FN};
  var best = choose();
  if (!best) return false;
  best.setAttribute(${JSON.stringify(VIDEO_MARK)}, '');
  return true;
})()`;

// The mark is only ever set on a candidate, and a candidate may sit in a shadow
// root that `document.querySelectorAll` cannot see into (dl-61).
const UNMARK_VIDEO_SCRIPT = `(() => {
  var marked = (${ALL_MEDIA_FN})('video');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(${JSON.stringify(VIDEO_MARK)});
})()`;

/**
 * True when a control carries an `AGE_GATE_TEXT` label **and** the page carries
 * an `AGE_MARKERS` phrase. Both, because an "I am 18" link in the footer of a
 * page with nothing age-restricted on it is not a gate.
 */
const AGE_GATE_SCRIPT = `(() => {
  var label = new RegExp(${JSON.stringify(AGE_GATE_TEXT.source)}, ${JSON.stringify(AGE_GATE_TEXT.flags)});
  var markers = ${JSON.stringify(AGE_MARKERS)};
  var body = document.body;
  var text = body ? (body.innerText || body.textContent || '').toLowerCase() : '';
  var marked = false;
  for (var i = 0; i < markers.length; i++) {
    if (text.indexOf(markers[i]) !== -1) {
      marked = true;
      break;
    }
  }
  if (!marked) return false;
  var controls = document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
  for (var j = 0; j < controls.length; j++) {
    var el = controls[j];
    var name = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim();
    if (!label.test(name)) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
})()`;

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

/**
 * Shadow-piercing since dl-69, which also measured what the gap was worth,
 * in two directions.
 *
 * **Cosmetic for the click itself.** Playwright's own click action scrolls
 * its own target into view before clicking it regardless of `force` (a step
 * separate from the actionability checks `force` skips), so
 * `clickChosenVideo`'s click on a shadow-root player already landed with no
 * help from this scroll at all — reproduced against a click-only shadow-root
 * player pushed 6000px below the initial viewport, where the light-DOM-only
 * selector (before this fix) never found anything to scroll to and the click
 * still started the stream.
 *
 * **Load-bearing for a lazily-mounted player** (gate round 1, med 2): a
 * shell that requests its manifest only once an `IntersectionObserver`
 * reports it visible, the shape a real lazy-mount library uses, and named
 * with a `player`-ish class the way a real component would be. With the
 * shell 6000px down and inside an open shadow root, the light-DOM-only
 * selector never matched it, the page never scrolled, the observer never
 * fired and the manifest was never requested; the shadow-piercing selector
 * matches the shell on its class name alone (no `<video>` has mounted yet)
 * and scrolls to it, which is what triggers the fetch.
 */
const SCROLL_SCRIPT = `(() => {
  var el = (${ALL_MEDIA_FN})('video, iframe, [class*="player"], [id*="player"]')[0];
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  try { window.scrollBy(0, 400); } catch {}
  return !!el;
})()`;

/**
 * Muted + playsinline first: an unmuted autoplay attempt is rejected outright by
 * the autoplay policy on any build where our launch flag did not apply.
 *
 * Candidates come from `ALL_MEDIA_FN('video, audio')` (dl-68), not a plain
 * `document.querySelectorAll`, so a player that starts on `.play()` rather
 * than a `click` and lives inside an open shadow root is still reached — the
 * same walk `CHOOSE_VIDEO_FN` uses for the surface click.
 */
const PLAY_SCRIPT = `(() => {
  var videos = (${ALL_MEDIA_FN})('video, audio');
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
  // dl-55: the same chooser the surface click uses, so a related-video card's
  // duration is never reported as the page's own. Audio is not a video and has
  // no link-card trap, so it stays a plain fallback — but the fallback still
  // has to pierce shadow roots the same way (dl-68), or a shadow-root audio
  // element never contributes a duration.
  var chooseVideo = ${CHOOSE_VIDEO_FN};
  var media = chooseVideo() || (${ALL_MEDIA_FN})('audio')[0] || null;
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

// `hasPlayerElement` feeds `classify.ts`'s `loginForm` test (`hasPasswordInput
// && !hasPlayerElement`), and has to be shadow-piercing for the same reason
// `CHOOSE_VIDEO_FN` is (dl-61, dl-68): a page with an unrelated password field
// and a real player hidden in an open shadow root is not a login wall
// (dl-69's reproduction — `document.querySelector` missed the shadow-root
// video and the page was misclassified `AUTH_REQUIRED`).
//
// A *closed* shadow root inherits the same blind spot `ALL_MEDIA_FN`'s own
// docstring names for the chooser: invisible to page script, so a
// closed-root player still reads `hasPlayerElement: false` and a page
// carrying one alongside an unrelated password field is still misclassified
// (gate round 1, low; not fixable here — there is nothing to query).
const SIGNALS_SCRIPT = `(() => {
  var body = document.body;
  var text = body ? (body.innerText || body.textContent || '') : '';
  var root = document.documentElement;
  return {
    title: document.title || '',
    bodyText: text.slice(0, 4000),
    html: root ? root.outerHTML.slice(0, 8000) : '',
    hasPasswordInput: !!document.querySelector('input[type="password"]'),
    hasPlayerElement: (${ALL_MEDIA_FN})('video, audio, iframe[src], [class*="player"], [id*="player"]').length > 0,
    ageGate: ${AGE_GATE_SCRIPT},
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
  ageGate: boolean;
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

/** Marks a consent container, so the text match is scoped to it through the locator API (dl-82). */
const CONSENT_ZONE_MARK = "data-downloader-consent-zone";

/** The two values `CONSENT_ZONE_MARK` takes: a layer that speaks of consent, and a bare dialog. */
const ZONE_CONSENT = "consent";
const ZONE_DIALOG = "dialog";

/**
 * What a consent layer says about itself, by language: the cookie or the
 * consent it asks for. A fixed or sticky layer is a consent container only when
 * its text carries one of these (dl-82's gate 2); a semantic dialog is one
 * regardless.
 *
 * Why the wording: "fixed or sticky" alone takes in a sticky site header with a
 * "Ho capito" notice in it and a docked checkout bar with a submit button,
 * neither of which is consent, and the header sits ahead of a bottom consent bar
 * in the document. "Accept", "agree" and "continue" are not on the list on
 * purpose: they are the labels being matched, and a checkout bar says "accept our
 * terms". Nor is "privacy": a checkout bar links its privacy policy as readily
 * as a consent bar does, and a missed consent layer costs nothing (the old
 * pattern still reaches it, as it did before dl-82) where a pressed submit does.
 *
 * Substrings, not words, so "cookies", "Cookie-Einstellungen" and
 * "consentement" match; `\b` is not used because it does not see Cyrillic.
 */
export const CONSENT_WORDING =
  /cookie|ciasteczk|ciasteczek|kakor|куки|témoins|consent|consenso|einwilligung|toestemming|samtycke|zgod[ęy] na|согласи[ея] на|\bgdpr\b|\brodo\b/i;

/**
 * Marks the nearest consent container of every link and button: an ancestor
 * that is a semantic dialog, or is `fixed` or `sticky` **and** speaks of consent
 * (`CONSENT_WORDING`). Each mark's value says which, so a layer that speaks of
 * consent is tried before a bare dialog. A cookie wall is far more often a layer
 * than a block in the page's flow, and a newsletter, a checkout form and a review
 * list are in the flow. One walk per control, memoised per ancestor, so a page
 * with thousands of links costs one style read per distinct ancestor. Open shadow
 * roots are not entered: a control inside one is outside every zone, and the
 * old whole-frame match still reaches it.
 */
const MARK_CONSENT_ZONES_SCRIPT = `(() => {
  var semantic = ${JSON.stringify(SEMANTIC_DIALOG)};
  var wording = new RegExp(${JSON.stringify(CONSENT_WORDING.source)}, ${JSON.stringify(CONSENT_WORDING.flags)});
  var zoneOf = new Map();
  var tierOf = new Map();
  // The mark a layer earns, or null when it is not a consent container.
  var tier = function (n) {
    if (wording.test(n.textContent || '')) return ${JSON.stringify(ZONE_CONSENT)};
    return n.matches(semantic) ? ${JSON.stringify(ZONE_DIALOG)} : null;
  };
  var find = function (el) {
    var chain = [];
    var found = null;
    for (var n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (zoneOf.has(n)) {
        found = zoneOf.get(n);
        break;
      }
      chain.push(n);
      var position = getComputedStyle(n).position;
      if (n.matches(semantic) || position === 'fixed' || position === 'sticky') {
        var earned = tier(n);
        if (earned !== null) {
          tierOf.set(n, earned);
          found = n;
          break;
        }
      }
    }
    for (var i = 0; i < chain.length; i++) zoneOf.set(chain[i], found);
    return found;
  };
  var marked = 0;
  var controls = document.querySelectorAll('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]');
  for (var j = 0; j < controls.length; j++) {
    var zone = find(controls[j]);
    if (zone && !zone.hasAttribute(${JSON.stringify(CONSENT_ZONE_MARK)})) {
      zone.setAttribute(${JSON.stringify(CONSENT_ZONE_MARK)}, tierOf.get(zone));
      marked += 1;
    }
  }
  return marked;
})()`;

const UNMARK_CONSENT_ZONES_SCRIPT = `(() => {
  var marked = document.querySelectorAll('[${CONSENT_ZONE_MARK}]');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(${JSON.stringify(CONSENT_ZONE_MARK)});
})()`;

/**
 * Presses a button or link whose whole label is a `pattern` match, among the
 * descendants of `scope`.
 */
async function clickByTextIn(scope: Locator, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  for (const role of ["button", "link"] as const) {
    try {
      const locator = scope.getByRole(role, { name: pattern }).first();
      if (!(await locator.isVisible({ timeout: 150 }))) continue;
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch {
      // No such control in this scope.
    }
  }
  return false;
}

/**
 * The text-matched consent step, in two reaches (dl-82).
 *
 * **Inside a consent container, the full `CONSENT_TEXT`**: a semantic dialog,
 * or a fixed or sticky layer **whose text speaks of consent**
 * (`CONSENT_WORDING`), found by script in a frame that allows it and by dialog
 * semantics alone in one that does not. A layer that speaks of consent is tried
 * before a dialog that does not, so a consent layer wins over an earlier
 * newsletter dialog; and a sticky header or a docked checkout bar, which do not
 * speak of consent, are not containers at all, so their "Ho capito" and "Agree
 * and continue" are not pressed.
 *
 * **Anywhere in the frame, only `CONSENT_TEXT_ANYWHERE`**, what the frame was
 * searched for before this change. A widened phrasing outside a container is
 * not a consent button: a newsletter's "Ho capito", a checkout form's "Agree
 * and continue", a comment form's "Yes, I agree" and a review vote's "Sono
 * d'accordo" are all pressed by a whole-frame match, and the checkout and the
 * comment are submit buttons.
 *
 * **What this gives up, on purpose:** a consent strip that is not a dialog and
 * whose text has no `CONSENT_WORDING` (it says "We value your privacy" and
 * nothing of cookies), labelled with a phrasing newer than this change, is not
 * pressed; it falls through to the old pattern, which is where it stood before.
 * Likewise a layer that does speak of consent is believed: a docked checkout bar
 * that mentions cookies would have its "Agree and continue" pressed. Another
 * language's wording is one more `CONSENT_WORDING` alternative; a label the old
 * pattern never knew is one more `CONSENT_PHRASES` entry, not a wider reach.
 */
async function clickConsentText(
  frame: Frame,
  scriptable: boolean,
  timeoutMs: number,
): Promise<boolean> {
  if (scriptable) {
    let marked = 0;
    try {
      marked = await frame.evaluate<number>(MARK_CONSENT_ZONES_SCRIPT);
      for (const tier of [ZONE_CONSENT, ZONE_DIALOG]) {
        if (marked === 0) break;
        const zones = frame.locator(`[${CONSENT_ZONE_MARK}="${tier}"]`);
        if (await clickByTextIn(zones, CONSENT_TEXT, timeoutMs)) return true;
      }
    } catch {
      // Frame navigated away mid-probe.
    } finally {
      if (marked > 0) {
        try {
          await frame.evaluate(UNMARK_CONSENT_ZONES_SCRIPT);
        } catch {
          // The press removed the frame's document, or navigated it.
        }
      }
    }
  } else {
    const dialogs = frame.locator(visibleQuery(SEMANTIC_DIALOG.split(", ")));
    if (await clickByTextIn(dialogs, CONSENT_TEXT, timeoutMs)) return true;
  }
  return await clickByText(frame, CONSENT_TEXT_ANYWHERE, timeoutMs);
}

export async function dismissConsent(
  frame: Frame,
  timeoutMs: number,
  scriptable: boolean,
): Promise<number> {
  // One banner per page: clicking a second "accept" is as likely to re-open the
  // preferences dialog as to close anything.
  const clicked = await clickVisible(frame, CONSENT_SELECTORS, { timeoutMs, max: 1 });
  if (clicked === 0 && (await clickConsentText(frame, scriptable, timeoutMs))) return 1;
  return clicked;
}

/**
 * Closes the layer over the page, through its close control or Escape. First in
 * `provokeFrame`, because a modal intercepts every later click: in dl-48's
 * reproduction, pressing the age confirmation with the modal open timed out.
 *
 * At most one per pass, the restraint `dismissConsent` argues: a second close
 * click can as easily open something as close it.
 */
export async function dismissModal(
  frame: Frame,
  options: { timeoutMs: number; scriptable: boolean },
): Promise<number> {
  if (options.scriptable) {
    let found = "none";
    try {
      found = await frame.evaluate<string>(MARK_CLOSE_SCRIPT);
    } catch {
      return 0;
    }
    if (found === "marked") {
      try {
        await frame.locator(`[${CLOSE_MARK}]`).first().click({ timeout: options.timeoutMs });
        return 1;
      } catch {
        return 0;
      } finally {
        try {
          await frame.evaluate(UNMARK_CLOSE_SCRIPT);
        } catch {
          // The close removed the frame's document, or navigated it.
        }
      }
    }
    if (found !== "dialog") return 0;
  } else {
    // No script in a cross-origin frame, so only what the locator API can see:
    // a dialog by its semantics, and a close control by its accessible name.
    try {
      const dialog = frame.locator(visibleQuery(SEMANTIC_DIALOG.split(", "))).first();
      if (!(await dialog.isVisible())) return 0;
      const control = dialog.getByRole("button", { name: CLOSE_TEXT }).first();
      if (await control.isVisible()) {
        await control.click({ timeout: options.timeoutMs });
        return 1;
      }
    } catch {
      return 0;
    }
  }

  // A dialog with no close control this recognises. Escape is what a person
  // would try next, and it never presses the dialog's primary action.
  try {
    await frame.page().keyboard.press("Escape");
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Presses a recognised age confirmation. The caller decides whether to call it
 * at all — that is the operator's `confirmAge`, never this function's.
 */
async function confirmAgeGate(frame: Frame, timeoutMs: number): Promise<boolean> {
  try {
    if (!(await frame.evaluate<boolean>(AGE_GATE_SCRIPT))) return false;
  } catch {
    return false;
  }
  return await clickByText(frame, AGE_GATE_TEXT, timeoutMs);
}

/**
 * Clicks the chosen player video, never the first `<video>` in the document
 * (dl-55). The rule is identical in every frame: visible, no link ancestor,
 * largest area — `CHOOSE_VIDEO_INDEX_FN`, run two ways.
 *
 * In a scriptable frame the choice is made once, in-page, by
 * `CHOOSE_VIDEO_FN`, and only the marked element is clicked, through the
 * locator API. Elsewhere, `isScriptableFrame`'s policy of not running script
 * still applies to every *other* evaluation this file does — `SCROLL_SCRIPT`,
 * `PLAY_SCRIPT`, `dismissModal`'s scripted path — but not to this one narrow
 * case (dl-55, decision 3): `frame.evaluate(CHOOSE_VIDEO_INDEX_SCRIPT)` reads
 * element geometry and ancestry back as a plain index, mutates nothing, and
 * costs one round trip regardless of frame origin, the same as the marked
 * click does in a scriptable frame — `Locator.evaluateAll` was tried first and
 * silently returned nothing for a string page function against a cross-origin
 * frame in this Playwright version, which is why this is `frame.evaluate`, not
 * a locator call. A page whose real player lives alone in a cross-origin
 * frame, next to a same-page related-video card wired by a JS `onclick` rather
 * than an `<a href>`, needs the largest-area rule to reach it; a
 * first-in-document-order fallback could not tell the two apart.
 *
 * `force` is kept, and still with the same near-corner `position`: a
 * legitimate layer can still sit visually over the player itself — a custom
 * controls bar, a click-to-unmute scrim — and the chooser already keeps a
 * related-video card from ever being the *target*, which is what made `force`
 * dangerous before. It no longer risks a click landing on unrelated content.
 */
async function clickChosenVideo(frame: Frame, scriptable: boolean): Promise<void> {
  if (scriptable) {
    let marked = false;
    try {
      marked = await frame.evaluate<boolean>(CHOOSE_VIDEO_SCRIPT);
      if (!marked) return;
      await frame
        .locator(`[${VIDEO_MARK}]`)
        .first()
        .click({ timeout: 1500, force: true, position: { x: 5, y: 5 } });
    } catch {
      // No qualifying video, or it went away before the click landed.
    } finally {
      if (marked) {
        try {
          await frame.evaluate(UNMARK_VIDEO_SCRIPT);
        } catch {
          // The click removed the frame's document, or navigated it.
        }
      }
    }
    return;
  }

  try {
    const index = await frame.evaluate<number>(CHOOSE_VIDEO_INDEX_SCRIPT);
    if (index < 0) return;
    const video = frame.locator("video").nth(index);
    if (await video.isVisible({ timeout: 150 })) {
      await video.click({ timeout: 1500, force: true, position: { x: 5, y: 5 } });
    }
  } catch {
    // No qualifying video, or it is not clickable.
  }
}

async function provokeFrame(
  frame: Frame,
  pageOrigin: string | undefined,
  confirmAge: boolean,
): Promise<void> {
  const scriptable = isScriptableFrame(frame, pageOrigin);
  await dismissModal(frame, { timeoutMs: 1500, scriptable });
  await dismissConsent(frame, 2000, scriptable);

  // Recognising a gate needs the page's wording as well as the control's label,
  // so it is only tried where script runs. The player mounts after the press,
  // which is why playback provocation still follows it.
  if (confirmAge && scriptable) await confirmAgeGate(frame, 2000);

  if (scriptable) {
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
  await clickChosenVideo(frame, scriptable);

  if (scriptable) {
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
  options: { deadline: number; signal: AbortSignal; confirmAge: boolean },
): Promise<void> {
  const pageOrigin = originOf(page.url());
  for (let pass = 0; pass < 2; pass++) {
    throwIfAborted(options.signal);
    if (remaining(options.deadline) < 2000) return;

    const frames = page.frames();
    for (const frame of frames) {
      if (remaining(options.deadline) < 1500) return;
      try {
        await provokeFrame(frame, pageOrigin, options.confirmAge);
      } catch {
        // A frame can detach at any moment; the others still deserve a try.
      }
    }
    if (pass === 0) await sleep(budget(options.deadline, 900), options.signal);
  }
}

/**
 * The overlay steps again, for a layer that mounts after `provokePlayback` has
 * finished. dl-48's page put its modal and its age gate up about 3.4 s after
 * `DOMContentLoaded`, when both passes were long over — and a press then
 * produced a playlist 0.2 s later.
 *
 * **Only the modal and the gate, never the play clicks or the consent text.**
 * Pressing play again on a player that is about to request can pause it, and
 * `CONSENT_TEXT` matches words like "continue" that a page repeats elsewhere;
 * each was bounded by the two passes, and a loop would unbound it.
 */
export async function revisitOverlays(
  page: Page,
  options: { deadline: number; confirmAge: boolean },
): Promise<void> {
  const pageOrigin = originOf(page.url());
  for (const frame of page.frames()) {
    if (remaining(options.deadline) < 1500) return;
    try {
      const scriptable = isScriptableFrame(frame, pageOrigin);
      await dismissModal(frame, { timeoutMs: 1500, scriptable });
      if (options.confirmAge && scriptable) await confirmAgeGate(frame, 2000);
    } catch {
      // Detached mid-visit; the next visit, or the next frame, still gets a try.
    }
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
  /**
   * Run on every tick before quiet is judged. The caller owns its cadence and
   * its cap; whatever it provokes counts as activity, as it should.
   */
  revisit?: () => Promise<void>;
}): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    throwIfAborted(options.signal);
    if (options.stop?.()) return true;
    await options.revisit?.();
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
    return {
      title: "",
      bodyText: "",
      html: "",
      hasPasswordInput: false,
      hasPlayerElement: false,
      ageGate: false,
    };
  }
}
