---
id: dl-93
tool: downloader
title: A consent container's wording scope presses two layers it should not and misses six it should
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-10 · `7709411e..a7f47bd2` · Opus 5.5, depth full

| Done when                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every row of both tables has a test with its stated outcome; r3, r3b, r4, r5, r6, r9 and dl-82's a3, a3b, a3c, a4, a5 pass unchanged | `resolvers/test/browser/consent-scope.test.ts` › "%s (%s) is pressed and its stream found" (r1, r1b, r2b, r3..r9) and "%s (%s) is not pressed" (r2, r5b) ✓. The r rows also pass with `provoke.ts` at base (11 of 16; the 5 red are r1, r1b, r2b, r7, r8), so their outcome is unchanged. `git diff 7709411e a7f47bd2 --name-only` touches neither `browser-resolver.test.ts` nor a dl-82 fixture, and `-t consent` there runs 38 of 38 green ✓ |
| r7 and r8 pressed, `SILENT` rows still silent                                                                                        | `consent-scope.test.ts` › "r7 (…) is pressed and its stream found", "r8 (…)"; `provoke.test.ts` › "does not speak of consent: %j" ✓. Positive control: base `CONSENT_WORDING` alone turns r7 and r8 red (2 failed of 8 run)                                                                                                                                                                                                                     |
| r1, r1b, r2b and r5b pressed, or the Log says why not in a measured sentence                                                         | `consent-scope.test.ts` › r1, r1b, r2b pressed; r5b › "is not pressed", with the Log's sentence ✓ as written. The signal that presses them also presses eight layers base did not (finding 1)                                                                                                                                                                                                                                                   |
| a1 and a2 press nothing, or the Log records the signal tried and why it failed                                                       | **unproven (open decision)**: Build step 4 says to stop and file the options when a signal needs the owner's choice; this line has no arm for a signal that works at a cost. No test on the branch asserts the opposite: dl-82's a1 and a2 tests assert a press, which contradicts the first arm only. Measurement of the options below                                                                                                         |
| `npm run check` and `npm test -- --project downloader` pass                                                                          | CI `check` and `test (ubuntu-latest)` green on `a7f47bd2`; local `npm run check` exit 0 ✓                                                                                                                                                                                                                                                                                                                                                       |

- **high** · the link-in-a-sentence signal in `MARK_CONSENT_ZONES_SCRIPT` (`sentenceLink`, `prose`) makes a layer a container whenever the link's parent holds two words of text and any visible non-submit control. The layer is what gets marked, so the press can land on any widened label in it, a submit included. It also makes this paragraph of `clickConsentText`'s JSDoc false: "a docked checkout bar whose prose says nothing of consent is not a container, so its … 'Agree and continue' [is] not pressed, even when it links a cookie policy". Pages of the gate's own, through the real `BrowserResolver`, counting a `/beacon/bad` press per run (two passes):

  | Page (fixed or sticky layer)                                                                                                                           | base | head |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- |
  | c1 SPA checkout, no form: "By placing your order you agree to our `<a>`terms`</a>` and `<a>`cookie policy`</a>`." + `type=button` "Agree and continue" | 0    | 2    |
  | c2 `<form>` bar: "By ordering you accept our terms and `<a>`cookie policy`</a>`." + `type=button` "Back" + **submit** "Agree and continue"             | 0    | 2    |
  | c4 newsletter popup, no dialog role: "Iscriviti alla newsletter. Leggi la `<a>`cookie policy`</a>`." + "Ho capito"                                     | 0    | 2    |
  | c5 footer: "© 2026 Acme Inc. All rights reserved. `<a>`Privacy`</a>` · `<a>`Cookie settings`</a>`" + "Back to top", and a notice div "… Ho capito"     | 0    | 2    |
  | c7 sticky header `<nav>`: "Quick links: `<a>`Home`</a>` · `<a>`Shop`</a>` · `<a>`Cookie settings`</a>`" + "Search", and a notice "… Ho capito"         | 0    | 2    |
  | c10 the c1 sentence + a **submit** bound by `form="f"` to a form elsewhere                                                                             | 0    | 2    |
  | c3 (control) c2 without "Back", the submit untyped                                                                                                     | 0    | 0    |
  | c6 (control) c5 with the links in a `<ul>`                                                                                                             | 0    | 0    |

  c2, c5, c7 and c10 press a label other than the control beside the link; c2 and c10 press a submit. c1 and c4 have r1's shape, so no local signal separates them from r1 and r1b. **Open decision**: (a) **recommended**: withdraw the link signal, keep r1, r1b and r2b as lost, and record c1 and c4 as the measured reason under Done when 3's second arm. That is dl-82's stated rule: a missed consent layer costs nothing, a pressed submit costs. (b) Narrow the signal: the pressed control must be a child of the link's own parent, and that parent holds no form-associated control (`button.form`). That would remove c2, c5, c7 and c10 (unmeasured) but keeps c1 and c4 as costs for the owner to accept, and the JSDoc paragraph would need rewriting.

- **med** · no `Done when` line depends on it (the `SILENT` rows stay silent) · `CONSENT_WORDING`'s new JSDoc says "no ordinary word contains" "cookie". That is false: "Schokocookies", "Haferflockencookies", Dutch "chocoladecookies", Swedish "Chokladcookies", "Supercookie", "#sugarcookie" and "thecookiejar" all match at head and not at base (12 deltas in 39 strings, `regex.mts`). On a page: c8, a fixed app root titled "Schokocookies backen" with a newsletter "Ich stimme zu", is pressed 0 → 2. c9, a docked cart bar "3 Schokocookies im Warenkorb." with a **submit** "Zustimmen und weiter", is pressed 0 → 2. The premise is the brief's own (Build step 2). **Open decision**: (a) **recommended**: keep the word start and add the consent compounds by name, for example `(?:statistik|marketing|tracking|analyse|funktions|drittanbieter|werbe)?cookie`, to keep r7 and silence food compounds, at the cost of unlisted compounds; or (b) keep the substring, correct the comment and the brief, and pin c9's shape as an accepted cost the way a2 is.
- **med** · Done when 4 depends on it · the open decision on a1 and a2, measured. Each option was applied to `tier()` exactly as the Log describes, then run against `consent-scope.test.ts` and `provoke.test.ts` (230 of 230 under every option), `browser-resolver.test.ts -t consent`, and four pages of the gate's own:

  |                                                                                      | opt 1 (head) | opt 2 landmarks | opt 3 form | opt 4 both |
  | ------------------------------------------------------------------------------------ | ------------ | --------------- | ---------- | ---------- |
  | dl-82 tests flipped (of 38)                                                          | 0            | a1              | a2         | a1, a2     |
  | c11 a2 with the `<form>` inside the fixed div: submit pressed                        | yes          | yes             | **yes**    | **yes**    |
  | c12 a1 with an `h2` and no `h1`: newsletter pressed                                  | yes          | **yes**         | yes        | **yes**    |
  | c13 a consent notice in the flow of a fixed root that holds an `h1`: consent pressed | yes          | **no**          | yes        | **no**     |
  | c14 a fixed consent bar that is itself a `<form>`: consent pressed                   | yes          | yes             | **no**     | **no**     |

  The Log's test flips are confirmed. Its stated costs and fixes are not whole. Option 3 fixes a2's exact shape only (c11 still presses a submit), and option 2 fixes a1 only when the root holds a landmark (c12). Option 2's cost is wider than "a consent layer with an `h1` title": a consent notice in the flow of any fixed or sticky root holding content loses its dl-82 phrasings (c13). This goes to the owner with the question.

- **low** · the Log calls `ciasteczk` and `ciasteczek` redundant because "the first is a prefix of the second". It is not: `ciasteczk` vs `ciasteczek` differ at the ninth letter. "ciasteczek" (genitive plural) matches only through its own alternative, so the next reader would lose recall acting on it.
- **low** · the Log's r5b sentence calls counting hidden text "a3b's regression (a hidden menu)". a3b is `display:none`; r5b is `visibility:hidden`. Whether that distinction separates them is unmeasured: a reading, not a measurement.
- **dropped** · `SENTENCE_WORD` is compiled with `g`, which suggested a `lastIndex` leak. The script uses it only through `String.prototype.match`, which resets `lastIndex`. Not a defect.
- **findings** · the hunt returned 6; 5 carried, 1 dropped.
- Merge with `origin/dl-90-sniff-moov-for-chunk-streams` (`020b5dfc`): `git merge-tree --write-tree` is clean (exit 0). PR #413 CI: every check passes on `a7f47bd2`.
- Invariants: none touched. No cross-tool import, no new error code, no spawn, no URL logging, no contract edit. The new spec is under the registered `resolvers` package. Style checked.
- NFR: security n/a · performance ✓ (one extra pass over a layer's consent-worded links) · reliability: findings 1 and 2 · maintainability: finding 1's JSDoc paragraph is now false.

## Log

2026-10-06, filed with dl-82's landing, from gate 4's measurements: dl-82's Log
(gate rounds 2 and 3) and Review (gates 3 and 4). The near-control prototype and
the recall table are gate 4's, taken from its `proto.mjs` and `recall.mjs`; I have
not reproduced them. The pages above are copied from `recall.mjs` and gate 3's
`cases.mjs`.

2026-10-10, built steps 1 to 3; **step 4 stopped on an open decision** (a1 and a2,
below). Model: Sonnet 5.5. Rows are in `test/fixtures/pages/consent-bar-rows.html`
(`?row=`) and `test/browser/consent-scope.test.ts`, a spec file of its own so it
runs alone and shares nothing with `browser-resolver.test.ts`.

**Step 1, baseline at `origin/main` (7709411e)**, `npx vitest run
tools/downloader/resolvers/test/browser/consent-scope.test.ts --project
downloader`, the table's column reproduced exactly: r3, r3b, r4, r5, r6, r9
pressed (stream); r7 and r8 `× … expected ['/consent-bar-rows.html'] to include
'/beacon/consent-accepted'`; r1, r1b, r2, r2b, r5b not pressed
(`NO_MEDIA_FOUND`). a1 and a2 are dl-82's own tests and were green.

**Step 2, compound words (r7, r8): done.** `CONSENT_WORDING` is now
`/cookie|(?<!\p{L})(?:…|kakor(?:na|n)?(?!\p{L})|…)/iu`. Gate 4's claim holds: each
is one alternative. Measured with the real constant: "Statistikcookies",
"Marketingcookies", "kakorna", "kakorn", "Kakor" match; "pannkakor",
"Veckans recept: pannkakor.", "Sockerkakor till kaffet.", "sockerkakorna",
"Il pagamento sicuro consente di ordinare.", "consentito", "consentono",
"Les témoins de l'accident.", "Кукиш" and "By ordering you accept our terms and
privacy policy." do not. The SILENT rows stay silent
(`provoke.test.ts`, 214 of 214). r7 and r8 now stream.

**Step 3, wording in a link or a hidden node.** A link's text now counts when it
speaks of consent **and** sits in a sentence beside a button: the link's parent
holds at least two words of its own text and a visible sibling button that is not
a submit (`type="button"`, or a button outside any form, or `role="button"`, or
`input[type=button]`). r1, r1b and r2b now stream. The signal separates them from
dl-82's a3, a3b and a3c because a nav list has neither the words round the link
nor a button beside it. Measured, as "not pressed" rows that must stay so: n1 (a
checkout form: "By ordering you accept our terms and `<a>`cookie policy`</a>`."
then a submit "Agree and continue"), n2 (`<nav><a>Cookie policy</a></nav>` ahead
of a notice in another block) and n3 (the link's sentence in one block, the
button in another). The submit exclusion is load-bearing: with it removed, n1
fails (`× n1 … is not pressed`, 1 failed of 3), and with it restored all 16 of
`consent-scope.test.ts` pass. Still lost, on purpose: **r5b**, whose sentence is
`visibility:hidden` through both provocation passes and shown at 6 s, so nothing
readable at probe time says "cookies"; counting hidden text is a3b's regression
(a hidden menu). **r2**, whose only wording is an `aria-label`, is
`NO_MEDIA_FOUND` as the ticket says. **n3-shaped consent** (the sentence's link
in its own block, the button in another) stays lost too, the price of keeping
the link signal local to one block. Run with dl-82's tests: `npx vitest run
tools/downloader/resolvers/test/browser/browser-resolver.test.ts --project
downloader -t consent` gave 38 passed, 124 skipped of 162, a3, a3b, a3c, a4 and a5
among them.

**Step 4, a1 and a2: open decision, nothing implemented.** Distance is the
ticket's dead end and I did not retry it. Two signals separate them, and I
prototyped both together (not committed) in `tier()`: a layer that holds
`h1, main, article, video, audio, [role="main"]`, or that is itself a `<form>`, is
a container only if it is a semantic dialog. Measured with the same spec files:
`consent-scope.test.ts` and `browser-resolver.test.ts -t "consent|dl-93"` gave
**52 passed, 2 failed, 124 skipped of 178**; the two failures are exactly dl-82's
pinned a1 ("a fixed app root whose footer says 'cookie' is a container, so its
first widened label is pressed") and a2 ("a docked checkout bar whose prose says
'cookie' is a container, so its submit is pressed"), i.e. both now press nothing.
r3, r3b, r4, r5, r6, r7, r8, r9, r1, r1b, r2b and every other dl-82 consent test
still pass. A feature survey of every fixed or sticky layer on the consent
fixtures (`proto.mts`, scratch): only a1 has `landmarks: 1` (its `h1`); only a1
and a2 have a form; r9 and the other CMP-shaped fixtures have none of either.
a1 and r9 are the same shape (a container whose children are a text block and a
control block), so only content can tell them apart, not structure. **Unmeasured:**
how many real consent layers hold an h1 or are a form. Two open-source CMPs read
by `WebFetch` (orestbida/cookieconsent `consentModal.js`, klaro
`consent-notice.jsx`) use an `h2`, no `<form>` and no `type="submit"`; that is two
of an unknown population, not a rate.

Options (the choice is the owner's: each trades recall on layers I cannot count
against a press the repo already calls a defect):

1. **Leave a1 and a2 as accepted costs** (no code). Cost: none new; a fixed app
   root whose footer says "cookie" keeps pressing its first widened label, and a
   docked checkout bar that says "cookie" keeps its submit pressed.
2. **Content landmarks only** (a layer holding `h1, main, article, video, audio,
[role="main"]` is no container unless a dialog). Fixes a1, not a2. Cost: a
   consent layer with an `h1` title loses its dl-82 phrasings, falling to the old
   pattern as before dl-82.
3. **A layer that is itself a `<form>` is no container unless a dialog.** Fixes
   a2, not a1. Cost: a form-based consent bar loses its dl-82 phrasings.
4. **Both** (the prototype above). Fixes both; costs both of the above; the two
   dl-82 tests flip to "not pressed" and their comments change.

**Recommendation: 4.** dl-82's own rule is that a missed consent layer costs
nothing (the old pattern still reaches "Accept", "OK" and the rest, as it did
before dl-82) where a pressed newsletter or submit costs a wrong action, and the
two open-source CMPs sampled pay neither cost. If the owner would rather not
trade on a sample of two, option 1 is the safe default and nothing here needs
undoing.

Fold-in: nothing free came out of this work. `ciasteczk` and `ciasteczek` in
`CONSENT_WORDING` are redundant (the first is a prefix of the second) and I left
both: removing one is a reading of dl-82's list, not a consequence of this change.

What the brief had wrong: nothing in the tables; every column reproduced. The
"Done when" line "a1 and a2 either press nothing, or the Log records the signal
that was tried and why it failed" has a third case here: the signal works, and
what it costs is the owner's to weigh, so neither arm is met yet.

2026-10-10, **gate 1 round and the owner's answers** (gate 1 failed `a7f47bd2`:
one high, two med, two low). The entry above is superseded where it says the link
signal is built, that "cookie" needs no word start, that `ciasteczk` is redundant
and that step 4 is open.

**Owner answers, 2026-10-10, each relayed by the
coordinator:**

1. _What happens to the link-in-a-sentence rule?_ Options: "Withdraw it; r1, r1b
   and r2b stay lost" (the gate's (a), recommended by the gate); "Narrow it" (the
   gate's (b), unmeasured). **Chosen: withdraw.**
2. _How should the wording match?_ Options: "Keep the word start; list consent
   compounds by name" (the gate's (a), recommended); "Match inside words; accept
   the cost". **Chosen: keep the word start and list the compounds.**
3. _Which rule for a1 and a2?_ Options: both rules (the builder's recommendation);
   leave both as accepted costs; the `h1`/`main` rule only; the form rule only,
   with the gate's measurement of each. **Chosen: both rules**, knowingly over the
   gate's wider costs.

**Finding 1 (high), reproduced and fixed by withdrawing the signal.** The gate's
pages through the real `BrowserResolver`, a press counted as `/beacon/bad`:
`GATE head c1: bad=2`, `c2`, `c4`, `c5`, `c7`, `c10` all `bad=2` at `a7f47bd2`,
0 at base (gate 1's report table: c1, c2, c4, c5, c7 and c10 are 0 on base and 2
on head, the controls c3 and c6 are 0 and 0; "10 of 10 run each time"). Reproduced on the pushed head: against the
old `provoke.ts` the new spec fails `× c1 … presses nothing`, `c2`, `c4`, `c5`,
`c7`, `c10` (and `c8`, `c9`, below). With the signal taken out all of them press
nothing, `c3` and `c6` still do (the controls). `clickConsentText`'s JSDoc paragraph
the gate showed false is true again ("not pressed, even when it links a cookie
policy"); the paragraph I had added about links is gone. **r1, r1b and r2b are
lost**, and the measured reason is the gate's **c1** (an SPA checkout bar, "By
placing your order you agree to our `<a>`terms`</a>` and `<a>`cookie policy`</a>`."
beside a `type=button` "Agree and continue") and **c4** (a newsletter popup,
"Iscriviti alla newsletter. Leggi la `<a>`cookie policy`</a>`." beside "Ho
capito"): both have r1's exact shape and both went 0 to 2 presses of a wrong
control, so no local signal separates them from r1 and r1b. **r5b** is lost
because its sentence is `visibility:hidden` through both provocation passes and is
shown at 6 s, so nothing readable at probe time says "cookies". The earlier
sentence that this is "a3b's regression" was a reading: a3b is `display:none` and
r5b is `visibility:hidden`, and whether that difference would separate them is
**unmeasured**. **r2** (wording only in `aria-label`) is `NO_MEDIA_FOUND` at base
and still. Done when 3's second arm is therefore met for r1, r1b, r2b and r5b by
this paragraph. The gate's c1 to c10 pages are `consent-scope-cases.html`
(`?case=`), tested in `consent-scope.test.ts` as "layers that base left alone are
still left alone": each presses nothing.

**Finding 2 (med), reproduced and fixed.** Gate 1's comparison of the base and
head constants reported "12 of 39 sample strings differ between base and head",
among them "Schokocookies", "chocoladecookies" and "Chokladcookies". Reproduced as `provoke.test.ts` `SILENT` rows
"Schokocookies backen…", "Haferflockencookies…", "chocoladecookies",
"Chokladcookies", "Supercookie", "#sugarcookie", "thecookiejar" and "3
Schokocookies im Warenkorb.", which fail at `a7f47bd2` and pass now; c8 and c9 are
`bad=2` at the old head and 0 now. The word start is back and the consent
compounds are named: `(?:statistik|marketing|tracking|analyse|funktions|werbe|drittanbieter)?cookie`.
r7 ("Statistikcookies", "Marketingcookies") and r8 ("kakorna") still press. The
cost, as the gate said: a consent compound nobody listed ("Komfortcookies") is a
missed layer, fixed by one more name. The comment that said no ordinary word
contains "cookie" is replaced by one that says what the list is for.

**Finding 3 (Build step 4), option 4 built.** In `tier()`, a fixed or sticky layer
that holds `h1, main, article, video, audio, [role="main"]`, or that is itself a
`<form>`, is a container only if it is a semantic dialog. dl-82's a1 and a2 tests
in `browser-resolver.test.ts` are **flipped by the owner's decision** to assert
that nothing is pressed (named "flipped from dl-82's a1" and "a2" in each test
and commented there). Pinned in `consent-scope.test.ts`, with the gate's pages:

| Case                                                    | What option 4 does       | Status                        |
| ------------------------------------------------------- | ------------------------ | ----------------------------- |
| c11 a2 with the `<form>` inside the fixed div           | submit still pressed     | accepted cost: not reached    |
| c12 a1 with an `h2` and no `h1`                         | newsletter still pressed | accepted cost: not reached    |
| c13 a consent notice in a fixed root that holds an `h1` | no longer pressed        | accepted cost: a consent miss |
| c14 a fixed consent bar that is itself a `<form>`       | no longer pressed        | accepted cost: a consent miss |

A missed consent layer costs nothing in the sense dl-82 uses (the old pattern
still reaches "Accept" and the rest); c11 and c12 are the presses the rule does
not stop.

**Lows.** `ciasteczk` and `ciasteczek` are **not** redundant, as the gate said:
they differ at the ninth letter, and "ciasteczek" (genitive plural) matches only
through its own alternative. The sentence calling them redundant in the earlier
entry is withdrawn and both stay. The r5b wording is corrected above.

**Dropped by the gate:** `SENTENCE_WORD`'s `g` flag was never a defect, and the
constant is gone with the signal.

2026-10-10, **fixed at landing, by the owner's choice** (asked: "What should the
lander do, with no re-gate?"; chosen: "Add the nine prefixes and inline the Log's
evidence"). Gate 2 passed `b24e9cd0`, recorded two new lows and dropped one attack as a cost
the owner had chosen; this landing pays down the dropped attack and the second low,
and leaves the first low recorded.

1. _The named list missed consent compounds that `a7f47bd2` matched_ (gate 2's
   dropped attack: it called this the cost the owner chose, and the owner chose
   to pay it down). `präferenz`, `komfort`, `sitzungs`, `leistungs`,
   `performance`, `targeting`, `session`, `erstanbieter` and `advertentie` are
   added to the prefix list in `CONSENT_WORDING`, with one `SPEAKS` row each at
   the end of the compound rows in `provoke.test.ts`. The regex's comment names
   no list, only "one more name here", so it needed no edit. Before the regex
   change, `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts`:
   `Tests  9 failed | 222 passed (231)`, the nine new rows (`× speaks of consent:
"Wir nutzen Präferenzcookies."` … `"Wij plaatsen advertentiecookies."`).
   After it: `Test Files  1 passed (1)`, `Tests  231 passed (231)`, which
   includes all 26 `SILENT` rows. Gate 2's regex comparison, run from this
   worktree against the new constant: every one of the nine strings reads
   `head=1` (`base=0 g1=1 head=1`), the 23 `S` rows and the three food rows
   "Schokocookies backen: das beste Rezept.", "Supercookie Box, 12 pieces" and
   "Recept voor chocoladecookies." read `head=0`: 26 of 26 silent. Not covered,
   as before: Dutch "analytischecookies" (`g1=1 head=0`) and Swedish
   "spårningskakor" (`g1=0 head=0`).
2. _The Log cited the gate's scratch files_ (gate 2's second new low). The two
   citations, to gate 1's `cases-head.log` and `regex.mts`, are replaced above by the
   gate 1 report's own quoted lines. The builder's `proto.mts (scratch)` in the
   build entry is unchanged: it is marked as scratch there, and the gate did not
   cite it.

**Recorded, not fixed** (gate 2's first new low, accepted as a cost): promotional
"Werbecookies mit Ihrem Logo bedrucken lassen." and "Marketingcookies als
Give-away, 100 Stück" match the named list (gate 2's regex comparison, run here: `base=0 g1=1 head=1` for both). A
bakery's give-away copy that uses those two words as a compound is read as a
consent layer, on the regex alone; no page was measured.
