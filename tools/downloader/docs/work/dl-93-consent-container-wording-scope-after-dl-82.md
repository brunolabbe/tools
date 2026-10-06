---
id: dl-93
tool: downloader
title: A consent container's wording scope presses two layers it should not and misses six it should
kind: fix
status: ready
milestone: null
depends_on: [dl-82]
difficulty: standard
---

# dl-93 — Consent-container wording scope after dl-82

## Why

dl-82 pressed more consent labels, then scoped the new phrasings to a "consent
container": a semantic dialog, or a `fixed` or `sticky` layer whose **visible
prose** (links and unrendered nodes left out) matches `CONSENT_WORDING`
(`resolvers/src/browser/provoke.ts`). The gate rounds measured the rule against
the real `BrowserResolver` and left two kinds of cost, both accepted by the owner
on 2026-10-06 so that dl-82 could land. This ticket carries them.

`difficulty: standard` is **unconfirmed**. Part 1 below is a regex tweak. Part 2 is
a measured dead end for the cheap approach, and may be `hard` once someone reads
how real CMP layers are shaped.

### 1. Two regressions from `origin/main`

A layer whose prose says "cookie" is believed, wherever the label sits in it.
Base (`056aab7`) pressed neither widened label here:

- **a1, a fixed app root.** The whole app is `position: fixed; inset: 0`, a common
  way to lock scrolling, and its footer says "Questo sito usa i cookie tecnici."
  The root is a container, so the first widened label in it, a newsletter's "Ho
  capito", is pressed in both passes. Fixture `test/fixtures/pages/consent-approot.html`;
  test "a fixed app root whose footer says 'cookie' is a container, so its first
  widened label is pressed". Its page:

  ```html
  <div id="app" style="position:fixed;inset:0;overflow:auto">
    <h1>A</h1>
    <div id="player"></div>
    <div class="newsletter">
      Iscriviti!
      <button type="button" onclick="fetch('/beacon/newsletter-hocapito')">Ho capito</button>
    </div>
    <form onsubmit="event.preventDefault()">
      Do you agree to the rules?
      <button type="submit" onclick="fetch('/beacon/comment-yesiagree')">Yes, I agree</button>
    </form>
    <footer>Questo sito usa i cookie tecnici.</footer>
  </div>
  ```

- **a2, a docked checkout bar.** The bar's own sentence says "Your cart is kept in
  a cookie.", so its submit "Agree and continue" is pressed in both passes.
  Fixture `consent-checkout-docked.html?text=Your%20cart%20is%20kept%20in%20a%20cookie.`;
  test "a docked checkout bar whose prose says 'cookie' is a container, so its
  submit is pressed". Its page:

  ```html
  <form
    onsubmit="event.preventDefault()"
    style="position:fixed;left:0;right:0;bottom:0;background:#ddd;padding:8px"
  >
    Your cart is kept in a cookie.
    <button type="submit" onclick="fetch('/beacon/checkout-submit')">Agree and continue</button>
  </form>
  ```

**A measured dead end: wording near the control.** Gate 4 prototyped requiring the
wording within K ancestors of the control (for a fixed or sticky layer; dialogs
unchanged, the per-ancestor memo off):

| Row                         | built (dl-82) | K = 1 (the control's parent) | K = 3         |
| --------------------------- | ------------- | ---------------------------- | ------------- |
| a1 app root, footer prose   | newsletter x2 | **nothing**                  | newsletter x2 |
| a2 checkout, prose "cookie" | submit x2     | submit x2                    | submit x2     |
| r9 CMP shape (below)        | stream        | **`NO_MEDIA_FOUND`**         | stream        |

Distance cannot tell a1 from r9: a reach that excludes the app root's footer also
excludes a CMP's separate text block. a2 is out of reach at every K, because its
wording is the submit's own sibling text. Do not re-try this. A working version
needs something else, for example structural knowledge of CMP markup, or a signal
that is not the layer's wording at all.

### 2. Six lost gains, not regressions

The round-2 rule (`textContent`, substring) resolved these; the stricter rule that
fixed the false presses (a3, a4, a5 in dl-82's Log) no longer does, and base never
did. So they are recall dl-82 gave up, not defects. Every bar is `position: fixed`,
labelled only with a phrasing dl-82 added, and pressing it mounts the player:

| Row | The bar's inner HTML                                                                                              | Pressed after dl-82 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------- |
| r1  | `Read our <a href="#c">cookie policy</a>. <button>Ho capito</button>`                                             | no                  |
| r1b | `We use <a href="#c">cookies</a> to improve the site. <button>Accetto e continua</button>`                        | no                  |
| r2b | `Leggi la <span role="link" tabindex="0">cookie policy</span>. <button>Ho capito</button>`                        | no                  |
| r5b | `<span id="t" style="visibility:hidden">We use cookies.</span> <button>Ho capito</button>`, the span shown at 6 s | no                  |
| r7  | `Wir verwenden Statistikcookies und Marketingcookies. <button>Ich stimme zu</button>`                             | no                  |
| r8  | `Läs mer om kakorna på sajten. <button>Jag godkänner</button>`                                                    | no                  |

The wrapper for each, and the control's script, as gate 4 ran them:

```html
<div
  id="bar"
  style="position:fixed;left:0;right:0;bottom:0;z-index:10;padding:12px;background:#eee"
>
  …inner HTML…
</div>
```

where the button is
`<button type="button" onclick="fetch('/beacon/consent-accepted');document.getElementById('bar').remove();mountPlayer()">LABEL</button>`
and `mountPlayer()` fetches `/media/mse/master.m3u8`, its variant and segments, and
mounts a `<video>` with a `MediaSource` (see `consent-label.html`). r5b hides the
text with `visibility:hidden` and shows it from `setTimeout(…, 6000)`, after both
provocation passes.

Rows that **must keep resolving** (all stream at dl-82's head, none at base):

| Row | The bar's inner HTML                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| r3  | `Cookie-Einstellungen <button>Ich stimme zu</button>`                                                                                               |
| r3b | `We use cookies. <button>Ho capito</button>`                                                                                                        |
| r4  | `Ta strona używa plików cookie. <button>Akceptuję</button>`                                                                                         |
| r5  | `We use cookies. <button>Ho capito</button>`, the whole bar `visibility:hidden` until 1.2 s                                                         |
| r6  | `Wir verwenden Cookies. <button>Ich stimme zu</button>`                                                                                             |
| r9  | `<div class="text"><p>We use cookies to personalise content.</p></div><div class="buttons"><div class="row"><button>Ho capito</button></div></div>` |

And r2, wording only in `aria-label="Cookie consent"` on the bar with the sentence
"Your choices matter to us.", is `NO_MEDIA_FOUND` at base, at dl-82's head and at
its earlier head; it is not a regression and not a gain.

## Build

1. **Reproduce first**: copy the pages above into `resolvers/test/fixtures/pages/`
   (a1 and a2 already are, from dl-82; the bars are one fixture with `?inner=` or
   one file each) and record, for each row, whether the label is pressed at
   `origin/main`. Expect the table's column.
2. **The compound words (r7, r8).** `cookie` needs no word start, because no
   ordinary word contains it: take it outside the `(?<!\p{L})` lookbehind, so
   "Statistikcookies" and "Marketingcookies" match. "kakorna" and "kakorn" are the
   Swedish definite forms: `kakor(?:na|n)?(?!\p{L})`. Gate 4's claim that each is
   one regex alternative is **unmeasured**; check it, and that "pannkakor",
   "sockerkakor", "consente" and the other dl-82 `SILENT` rows still do not match.
3. **Wording that sits only in a link or a hidden node (r1, r1b, r2b, r5b).** This
   is the price of dl-82's a3 fix: a "Cookie policy" nav link in a sticky header
   must not make it a container, while "We use `<a>`cookies`</a>` …" is a consent
   sentence. Decide, with a measurement, whether any signal tells them apart (a
   link inside a sentence rather than a nav list; text hidden at probe time but
   shown later) or whether they stay lost. Do not weaken a3, a3b or a3c, which
   are tests in dl-82.
4. **a1 and a2.** Find a signal that separates a1 (an app root) from r9 (a CMP's
   split text and button blocks) and that reaches a2, or record that none exists
   and leave them as accepted costs. If a signal needs the owner's choice between
   materially different behaviours, stop and file the options.

## Done when

- Each row in the two "must" tables above has a test whose expectation is its
  stated outcome, and **r3, r3b, r4, r5, r6, r9 and dl-82's a3, a3b, a3c, a4, a5
  still pass unchanged**.
- r7 and r8 are pressed (stream), with the `SILENT` rows still silent.
- r1, r1b, r2b and r5b are either pressed, or the Log says in a measured sentence
  why not.
- a1 and a2 either press nothing, or the Log records the signal that was tried and
  why it failed.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

2026-10-06, filed with dl-82's landing, from gate 4's measurements: dl-82's Log
(gate rounds 2 and 3) and Review (gates 3 and 4). The near-control prototype and
the recall table are gate 4's, taken from its `proto.mjs` and `recall.mjs`; I have
not reproduced them. The pages above are copied from `recall.mjs` and gate 3's
`cases.mjs`.
