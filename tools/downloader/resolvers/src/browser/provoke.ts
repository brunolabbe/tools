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

import type { Frame, Page } from "playwright";
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

/** Text-matched fallback in the languages we see most often. */
const CONSENT_TEXT =
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
 *
 * **No longer the only way a gate is recognised** (dl-83): `AGE_CANDIDATES_FN`
 * recognises one by its structure in any language, and keeps this pattern as
 * a second, sufficient path so nothing dl-48 recognised is lost. A phrasing
 * this misses is no longer a reason to extend it.
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
 * An age, as a whole number in a label or a layer's text: `18` or `21`,
 * optionally followed by `+` (dl-83). Whole means not part of a longer number
 * (`2018`, `1.18`, `21:00`), not a price (`€18`), not a percentage (`18%`, the
 * promo's "Get 18% off") and not glued to a word (`18h`). Language-independent
 * on purpose: the label around it is whatever the site wrote.
 */
export const AGE_NUMBER =
  /(?<![\p{L}\p{N}\p{Sc}]|\p{N}[.,:/-])(?:18|21)\+?(?![\p{L}\p{N}%°]|[.,:/-]\p{N})/u;

/**
 * Words that turn an age label into its opposite — the "I am under 18, leave"
 * button beside the entry — per language `AGE_GATE_TEXT` lists (dl-83). A
 * closed list, matched as whole words of the lowercased label.
 *
 * **Negation and under-age words only, never "leave" or "exit".** An exit
 * control that names no age is not a candidate to begin with, and one that
 * does nearly always says "under" or "not" as well. A gate in a language with
 * no entry here still has the origin rule (`AGE_CHOOSE_FN`) and, failing that,
 * presses nothing.
 */
export const AGE_NEGATIONS: readonly string[] = [
  // English
  "not",
  "no",
  "under",
  "younger",
  "below",
  "less",
  "minor",
  // Russian
  "не",
  "нет",
  "младше",
  "меньше",
  "менее",
  "несовершеннолетний",
  // German
  "nicht",
  "nein",
  "kein",
  "keine",
  "unter",
  "jünger",
  "minderjährig",
  // French
  "non",
  "ne",
  "pas",
  "moins",
  "mineur",
  "mineure",
  // Spanish (and Italian/Spanish "no", above)
  "menos",
  "menor",
  // Italian
  "meno",
  "sotto",
  "minorenne",
  // Portuguese
  "não",
  "nao",
  // Dutch
  "niet",
  "nee",
  "geen",
  "jonger",
  "onder",
  "minderjarig",
  // Swedish
  "inte",
  "ej",
  "nej",
  "yngre",
  "minderårig",
  // Polish
  "nie",
  "poniżej",
  "mniej",
  "niepełnoletni",
];

/**
 * The longest label a structural candidate may carry, in words (dl-83). The
 * longest attestation phrased as a control that the brief and dl-48 collected
 * runs to ten — "I confirm that I am 18 years of age or older" — and the
 * Italian "Ho 18 anni o più - Entra" is six. Past ten a label reads as a
 * sentence, or a card's whole caption, rather than a control. The cap is a weak
 * filter on purpose: the blocking layer and its own text carry the weight.
 */
const AGE_LABEL_MAX_WORDS = 10;

/**
 * The share of the viewport a positioned layer must cover to count as blocking
 * the page (dl-83): more than half, which is what "most" means, and well below
 * the full-viewport backdrop every gate seen so far used. A fixed header or a
 * cookie strip covers far less. A gate drawn as a small centred card with a
 * sibling backdrop, rather than a child of one, falls below it — and is
 * recognised only through dialog semantics or dl-48's label-and-marker path.
 */
const AGE_LAYER_MIN_COVER = 0.5;

/** Marks the age-gate control `AGE_CHOOSE_FN` chose, so the click goes through the locator API. */
const AGE_MARK = "data-downloader-age";

const AGE_CONTROLS = 'button, a, [role="button"], input[type="button"], input[type="submit"]';

/**
 * The query keys a play-time rewrite may add, change or remove without leaving
 * the page: the departure guard's exception (`PLAY_TIME_QUERY_EXCEPTIONS` in
 * `resolvers/browser.ts`, dl-55 decision 1, where the reasoning lives). Kept
 * here, and read from here by the guard, because `AGE_CHOOSE_FN` asks the same
 * question of a link before it is pressed (dl-83, gate round 2), and the two
 * must not disagree about what leaving is.
 */
export const PLAY_TIME_QUERY_KEYS: readonly string[] = ["t", "start", "autoplay"];

/**
 * Every control that could be an age self-confirmation, as `{ el, name,
 * legacy, blocking }` (dl-83). Recognition is broad, because a false one with
 * confirmation off costs a wrong message and nothing clicked. Two paths, either
 * sufficient:
 *
 * - **Structural, any language.** A visible control whose label has at most
 *   `AGE_LABEL_MAX_WORDS` words and an `AGE_NUMBER`, inside a layer — the
 *   nearest ancestor that is a visible `SEMANTIC_DIALOG` of any size, or is
 *   fixed or absolutely positioned and covers `AGE_LAYER_MIN_COVER` of the
 *   viewport — whose own text, **controls excluded**, mentions the number too
 *   or carries an `AGE_MARKERS` phrase. Controls are excluded because the label
 *   is inside the layer: counting it would make the layer vouch for every label
 *   in it.
 * - **dl-48's, kept whole** (`legacy`). A visible control whose label matches
 *   `AGE_GATE_TEXT`, on a page carrying an `AGE_MARKERS` phrase.
 *
 * `blocking` says the control's layer covers `AGE_LAYER_MIN_COVER` of the
 * viewport — a small dialog is a layer for recognition, but blocks nothing
 * (gate round 1: a 120 px cookie sheet). The labels are tested before the
 * ancestor walk, which only the few controls that pass them pay for.
 *
 * Controls are found with `ALL_MEDIA_FN`'s shadow-piercing walk, and ancestors
 * are climbed across shadow boundaries, so a gate in an open shadow root is
 * found the way a shadow-root player is (dl-61, dl-69). When a candidate and
 * one of its own descendants both qualify — a `<button>` inside an `<a>` — only
 * the innermost is kept: they are one control, and two would read as two.
 */
const AGE_CANDIDATES_FN = `function () {
  var label = new RegExp(${JSON.stringify(AGE_GATE_TEXT.source)}, ${JSON.stringify(AGE_GATE_TEXT.flags)});
  var age = new RegExp(${JSON.stringify(AGE_NUMBER.source)}, ${JSON.stringify(AGE_NUMBER.flags)});
  var markers = ${JSON.stringify(AGE_MARKERS)};
  var semantic = ${JSON.stringify(SEMANTIC_DIALOG)};
  var controlSelector = ${JSON.stringify(AGE_CONTROLS)};
  var up = function (node) {
    if (node.parentElement) return node.parentElement;
    var parent = node.parentNode;
    return parent && parent.host ? parent.host : null;
  };
  var shown = function (el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  var marked = function (text) {
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1) return true;
    }
    return false;
  };
  var words = function (text) {
    return text.split(/\\s+/).filter(function (w) { return /[\\p{L}\\p{N}]/u.test(w); }).length;
  };
  var viewport = window.innerWidth * window.innerHeight;
  var covers = function (node) {
    var rect = node.getBoundingClientRect();
    var w = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    var h = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return viewport > 0 && (w * h) / viewport >= ${AGE_LAYER_MIN_COVER};
  };
  var isLayer = function (node) {
    if (node.matches(semantic)) return shown(node);
    var position = getComputedStyle(node).position;
    if (position !== 'fixed' && position !== 'absolute') return false;
    return covers(node);
  };
  var layerOf = function (el) {
    for (var node = up(el); node; node = up(node)) {
      if (node === document.body || node === document.documentElement) return null;
      if (isLayer(node)) return node;
    }
    return null;
  };
  var ownText = function (layer) {
    var parts = [];
    var walk = function (node) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          parts.push(child.nodeValue);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (/^(?:SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(child.tagName)) continue;
        if (child.matches(controlSelector) || child.matches('input, select, textarea')) continue;
        if (getComputedStyle(child).display === 'none') continue;
        if (child.shadowRoot) walk(child.shadowRoot);
        walk(child);
      }
    };
    if (layer.shadowRoot) walk(layer.shadowRoot);
    walk(layer);
    return parts.join(' ').toLowerCase();
  };
  var body = document.body;
  var pageMarked = marked(body ? (body.innerText || body.textContent || '').toLowerCase() : '');
  var controls = (${ALL_MEDIA_FN})(controlSelector);
  var found = [];
  for (var i = 0; i < controls.length; i++) {
    var el = controls[i];
    var name = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim();
    if (!name) continue;
    // The label first: it rules out nearly every control on a page, and the
    // ancestor walk below is the expensive part (gate round 1, low).
    var legacy = pageMarked && label.test(name);
    var ageLabel = age.test(name) && words(name) <= ${AGE_LABEL_MAX_WORDS};
    if (!legacy && !ageLabel) continue;
    if (!shown(el)) continue;
    var layer = layerOf(el);
    var structural = false;
    if (layer && ageLabel) {
      var text = ownText(layer);
      structural = age.test(text) || marked(text);
    }
    if (structural || legacy) {
      found.push({ el: el, name: name, legacy: legacy, blocking: !!layer && covers(layer) });
    }
  }
  var inside = function (outer, inner) {
    for (var node = up(inner); node; node = up(node)) if (node === outer) return true;
    return false;
  };
  return found.filter(function (candidate) {
    return !found.some(function (other) { return other !== candidate && inside(candidate.el, other.el); });
  });
}`;

/**
 * The one candidate to press, or `null` (dl-83). The press is strict, because
 * a false one clicks something on the user's behalf. Two filters drop the
 * candidates that must never be pressed, and only then do two preferences
 * choose among the rest (gate round 2: a preference applied first could drop
 * the real gate in favour of a candidate a filter then removed, leaving
 * nothing):
 *
 * 1. **A label carrying an `AGE_NEGATIONS` word goes** — the under-age exit.
 * 2. **A link that would leave goes**, the control itself or its nearest
 *    `a[href]` ancestor. For every candidate, a link to another http(s) origin,
 *    as at base. For a structural candidate in the top frame, also a link to
 *    another path, or to a query differing in more than `PLAY_TIME_QUERY_KEYS`,
 *    on this origin — what the departure guard counts as leaving, so a press
 *    it would turn into `NO_MEDIA_FOUND` is not made (gate round 1). **dl-48's
 *    candidates are exempt from that same-origin half** (gate round 2, the
 *    owner's decision, 2026-10-06): a real gate is often a link whose script
 *    cancels it, a link to a route that sets a cookie and redirects back, or a
 *    `target="_blank"` link, and none of those leaves the page although its
 *    href names another path. dl-48 pressed them and they worked. The cost,
 *    accepted: a structural-only gate built that way is not pressed; base never
 *    recognised one. A `javascript:` or fragment href stays. So does a link in
 *    a same-origin frame, which usually navigates only the frame — but not
 *    always: one with `target="_top"` or `_parent` navigates the page, the
 *    guard reports the departure, and that is unchanged from base (gate round
 *    2, low).
 * 3. **When any candidate left sits in a blocking layer, every other goes.** A
 *    layer over most of the page intercepts the pointer, so a person could not
 *    press a control under it either, and the control that put the layer up is
 *    the one inside it. This is what keeps an `AGE_GATE_TEXT` decoy earlier in
 *    the DOM from being pressed in the overlay's place. Only a layer that
 *    covers `AGE_LAYER_MIN_COVER` counts: a cookie sheet along the bottom
 *    intercepts nothing (gate round 1).
 * 4. **Otherwise, when any candidate left is dl-48's (`legacy`), the
 *    structural ones go** — they sit in no layer or in one that blocks nothing,
 *    and the label-and-marker rule is the one dl-48 already pressed. This keeps
 *    a cookie sheet's "View our 18 partners" from being pressed in place of an
 *    inline "I am 18 or older" gate (gate round 1, the owner's decision). Its
 *    reach, accepted with it: a dl-48 label elsewhere on the page also beats a
 *    real structural gate in a sheet or a small card (gate round 2, low).
 *
 * Exactly one left is pressed; none or several, nothing is, and the probe says
 * why (`AGE_CONFIRMATION_REQUIRED`) rather than guessing. The rules apply to a
 * lone candidate too: a gate whose only age-bearing control is the exit must
 * not have it pressed for want of a second. A button whose script routes away
 * is not caught by any of them, and is a known residue.
 */
const AGE_CHOOSE_FN = `function (candidates) {
  var negations = ${JSON.stringify(AGE_NEGATIONS)};
  var up = function (node) {
    if (node.parentElement) return node.parentElement;
    var parent = node.parentNode;
    return parent && parent.host ? parent.host : null;
  };
  var negated = function (name) {
    var tokens = name.toLowerCase().split(/[^\\p{L}\\p{N}]+/u);
    for (var i = 0; i < tokens.length; i++) {
      if (negations.indexOf(tokens[i]) !== -1) return true;
    }
    return false;
  };
  var playTime = ${JSON.stringify(PLAY_TIME_QUERY_KEYS)};
  var query = function (search) {
    var params = new URLSearchParams(search);
    for (var i = 0; i < playTime.length; i++) params.delete(playTime[i]);
    params.sort();
    return params.toString();
  };
  var leaves = function (el, legacy) {
    for (var node = el; node; node = up(node)) {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        var target;
        try {
          target = new URL(node.getAttribute('href'), location.href);
        } catch {
          return false;
        }
        if (!/^https?:$/.test(target.protocol)) return false;
        if (target.origin !== location.origin) return true;
        if (legacy || window !== window.top) return false;
        return target.pathname !== location.pathname || query(target.search) !== query(location.search);
      }
    }
    return false;
  };
  var list = candidates.filter(function (c) { return !negated(c.name) && !leaves(c.el, c.legacy); });
  if (list.some(function (c) { return c.blocking; })) {
    list = list.filter(function (c) { return c.blocking; });
  } else if (list.some(function (c) { return c.legacy; })) {
    list = list.filter(function (c) { return c.legacy; });
  }
  return list.length === 1 ? list[0].el : null;
}`;

/**
 * Set on a document's `window` once a press there has landed (dl-83). **One
 * press per document**: the attestation is made once, as a person makes it,
 * and a second press is never of the gate that was recognised — it is of
 * whatever still matches once that gate is gone. dl-83's decoy reproduction is
 * the case: an "I am 18 or older" control in a header above the layer, which a
 * later pass found and pressed after the layer's own entry had worked. A new
 * document (a navigation) starts without it.
 */
const AGE_PRESSED = "__downloaderAgePressed";

/**
 * `ageGate`: a gate is recognised. `ageGatePressable`: a press was made in this
 * document, or `AGE_CHOOSE_FN` would make one. Read together at the end of a
 * probe, they tell a press that was made and did not work from one that was
 * declined (dl-83).
 */
const AGE_GATE_STATE_FN = `(function () {
  var candidates = (${AGE_CANDIDATES_FN})();
  return {
    ageGate: candidates.length > 0,
    ageGatePressable:
      candidates.length > 0 && (window[${JSON.stringify(AGE_PRESSED)}] === true || (${AGE_CHOOSE_FN})(candidates) !== null),
  };
})`;

/**
 * Marks the control `AGE_CHOOSE_FN` chose. Returns `marked`, `declined`
 * (candidates, none chosen), `pressed` (this document already had its press) or
 * `none`.
 */
const MARK_AGE_SCRIPT = `(() => {
  if (window[${JSON.stringify(AGE_PRESSED)}] === true) return 'pressed';
  var candidates = (${AGE_CANDIDATES_FN})();
  if (candidates.length === 0) return 'none';
  var chosen = (${AGE_CHOOSE_FN})(candidates);
  if (!chosen) return 'declined';
  chosen.setAttribute(${JSON.stringify(AGE_MARK)}, '');
  return 'marked';
})()`;

const AGE_PRESSED_SCRIPT = `(() => {
  try {
    Object.defineProperty(window, ${JSON.stringify(AGE_PRESSED)}, { value: true, configurable: true });
  } catch {}
})()`;

// The mark may sit in a shadow root that `document.querySelectorAll` cannot see into.
const UNMARK_AGE_SCRIPT = `(() => {
  var marked = (${ALL_MEDIA_FN})('[${AGE_MARK}]');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(${JSON.stringify(AGE_MARK)});
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
  var age = (${AGE_GATE_STATE_FN})();
  return {
    title: document.title || '',
    bodyText: text.slice(0, 4000),
    html: root ? root.outerHTML.slice(0, 8000) : '',
    hasPasswordInput: !!document.querySelector('input[type="password"]'),
    hasPlayerElement: (${ALL_MEDIA_FN})('video, audio, iframe[src], [class*="player"], [id*="player"]').length > 0,
    ageGate: age.ageGate,
    ageGatePressable: age.ageGatePressable,
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
  /**
   * The recognised gate has exactly one control the press would choose. False
   * with `ageGate` true is a press that was declined, not one that failed.
   */
  ageGatePressable: boolean;
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
 *
 * **The element pressed is the element recognised** (dl-83): `MARK_AGE_SCRIPT`
 * recognises, chooses and marks in one evaluation, and the click goes to the
 * mark. A second search by label — what this did before — clicked whichever
 * match came first in the DOM, recognised or not. A declined choice presses
 * nothing; `readSignals` reports it, and the probe says why. A document gets
 * one press (`AGE_PRESSED`), recorded only once the click has landed, so a
 * press a promo intercepted is still tried on the next pass.
 */
async function confirmAgeGate(frame: Frame, timeoutMs: number): Promise<boolean> {
  let found = "none";
  try {
    found = await frame.evaluate<string>(MARK_AGE_SCRIPT);
  } catch {
    return false;
  }
  if (found !== "marked") return false;
  try {
    await frame.locator(`[${AGE_MARK}]`).first().click({ timeout: timeoutMs });
    try {
      await frame.evaluate(AGE_PRESSED_SCRIPT);
    } catch {
      // The press navigated the frame: a new document, which starts unpressed.
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      await frame.evaluate(UNMARK_AGE_SCRIPT);
    } catch {
      // The press removed the frame's document, or navigated it.
    }
  }
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
  await dismissConsent(frame, 2000);

  // Recognising a gate needs the layer around a control or the page's wording
  // as well as the control's label, so it is only tried where script runs. The player mounts after the press,
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
      ageGatePressable: false,
    };
  }
}
