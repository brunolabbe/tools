---
id: dl-82
tool: downloader
title: A consent button is pressed only when its label is one of a narrow list of exact phrasings
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-82 — Consent buttons match a narrow list of labels

## Why

When no vendor selector in `CONSENT_SELECTORS` matches, the browser tier
dismisses a consent wall by clicking a control whose whole label matches
`CONSENT_TEXT` (`resolvers/src/browser/provoke.ts`). The pattern is anchored at
both ends, which is deliberate: a sentence that contains "accept" isn't a
button. But each language has only one to three phrasings. In Italian, for
example, "Accetta", "Accetta tutto" and "Accetto" match, while "Accetto e
continua", "Acconsento", "Sono d'accordo" and "Ho capito" don't. English misses
"Accept & close", "Agree and continue" and "Yes, I agree", and the other listed
languages have gaps of the same kind. A wall left standing keeps the player
from loading, so the probe ends in `NO_MEDIA_FOUND`.

Consent text is tried only in the two provocation passes. The late revisits
skip it on purpose, because `CONSENT_TEXT` matches words like "continue" that a
page repeats elsewhere (the docstring above the revisit). Widening the pattern
widens that risk, which is why this is a ticket and not a one-line edit.

The owner reported a page whose consent dialog is in Italian, 2026-10-06; the
page itself is out of scope and recorded nowhere. **Not yet reproduced** with a
fixture: building one is the first step.

## Build

1. **Reproduce first**: fixture pages in `resolvers/test/browser/` whose player
   loads only after a consent dialog is accepted, labelled "Accetto e continua",
   "Acconsento", "Agree and continue" and "Accept & close". Record what
   `origin/main` returns for each.
2. Extend `CONSENT_TEXT` per language that is already listed: accept-all, the
   accept-and-continue and accept-and-close forms, and agree / I agree / yes, I
   agree, allowing `&` or `and` and an optional trailing punctuation mark. Keep
   it anchored, and keep each new phrasing an alternative rather than a new
   branch, as `AGE_GATE_TEXT`'s docstring asks.
3. **Bare "continue" and "ok" stay as they are, and nothing new may be that
   generic.** Add a negative test: a page with a "Continua" pagination link
   and a "Sono d'accordo" sentence in body text clicks neither.
4. Don't add an Italian "Entra" or any other "enter the site" label. On a gated
   page that's an age or terms attestation, which belongs to dl-83 behind the
   operator's `ENABLE_AGE_CONFIRMATION`, not to consent.

## Done when

- Each step-1 fixture yields its stream.
- The negative test from step 3 passes: neither control is clicked.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: CONCERNS** — 2026-10-06 · `056aab7..2557198` · Opus 5.5, depth standard (full gate)

| Done when                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each step-1 fixture yields its stream                       | `resolvers/test/browser/browser-resolver.test.ts` › "presses %j and finds the stream behind it" for "Accetto e continua", "Acconsento", "Agree and continue", "Accept & close" (plus three more and an "Accept all" control) ✓ — asserts the `/beacon/consent-accepted` request and `variants[0].url` is the master; red at base: 7 of 9 fail with `provoke.ts` at `056aab7`, green at head |
| Negative test from step 3: neither control is clicked       | `browser-resolver.test.ts` › "presses neither a pagination link nor a vote button that merely starts like a consent label" ✓ — asserts neither `/beacon/consent-continua` nor `/beacon/consent-vote` was requested; goes red when a bare `continua` is planted                                                                                                                              |
| `npm run check` and `npm test -- --project downloader` pass | **verified** — check exit 0; downloader project 1680 passed, 2 skipped of 1682, 97 files passed, 1 skipped; no test line deleted (`git diff --numstat`: 0 deletions under `test/`); all 11 PR checks green on `2557198`                                                                                                                                                                     |

- **med** · open decision · no `Done when` line depends on it · **The widened
  labels are pressed anywhere in any frame, and a false press also steals the
  single consent press, so pages `origin/main` resolved now fail.**
  `clickByText` in `resolvers/src/browser/provoke.ts` runs
  `frame.getByRole(role, { name: CONSENT_TEXT }).first()` over the whole frame:
  no dialog or overlay scope, and `.first()` is DOM order, where a consent
  dialog usually comes last. Premise: a real `BrowserResolver` (built `dist`,
  `quietMs: 1200`) against pages served from loopback, each control reporting
  its click to a `/beacon/` path. Script:
  `node <scratch>/falsepress.mjs`. Head `2557198`:
  ```
  /newsletter-hocapito.html -> error NO_MEDIA_FOUND | beacons: ["/beacon/newsletter-hocapito","/beacon/newsletter-hocapito"]
  /terms-checkbox.html -> error NO_MEDIA_FOUND | beacons: []
  /terms-button.html -> error NO_MEDIA_FOUND | beacons: ["/beacon/terms-submit","/beacon/terms-submit"]
  /comment-yesiagree.html -> error NO_MEDIA_FOUND | beacons: ["/beacon/comment-yesiagree","/beacon/comment-yesiagree"]
  /review-vote.html -> error NO_MEDIA_FOUND | beacons: ["/beacon/review-vote","/beacon/review-vote"]
  /order-overlay.html -> error NO_MEDIA_FOUND | beacons: []
  /order-bar.html -> error NO_MEDIA_FOUND | beacons: ["/beacon/newsletter-hocapito","/beacon/newsletter-hocapito"]
  /control-accetta.html -> stream /media/mse/v1080.m3u8 | beacons: ["/beacon/consent-accepted"]
  ```
  Same script, `provoke.ts` at `056aab7` rebuilt (dist grep: `acconsento` 0):
  every false-press page `beacons: []`, and
  `/order-overlay.html -> stream` and `/order-bar.html -> stream`, each with
  `["/beacon/consent-accepted"]`. So: a newsletter "Ho capito", a checkout
  `<button type=submit>` "Agree and continue", a comment form's "Yes, I agree"
  and a review vote "Sono d'accordo" are each pressed in both passes. Worse,
  with a newsletter "Ho capito" ahead of a consent dialog labelled "Accetta" —
  a label `origin/main` already pressed — head returns `NO_MEDIA_FOUND`,
  where base returned the stream. With a full-viewport overlay the press on
  the covered newsletter button times out, and with a bottom bar it lands on
  the newsletter instead, so the consent button is never reached. A terms
  checkbox is not pressed (role `checkbox`). The class is older than this
  branch (an English "Got it" or "OK" was already pressed anywhere), but the
  branch extends it to acknowledgement phrasings in eight languages. The Log's
  "What the brief had wrong: nothing material" misses this, and so does the
  brief, which weighs the widening only against the revisits. Graded med
  under the table: a defect behind a condition that will occur, with no
  acceptance line wrong. **Options:** (a) **recommended**: scope the text
  fallback to a consent container (`[role=dialog]`, `[aria-modal=true]`, or a
  fixed-position ancestor), or at least try dialog-scoped matches before the
  whole frame; add `order-bar`/`order-overlay`-style fixtures as the proof.
  (b) Drop the acknowledgement phrasings that collide with ordinary controls
  ("Ho capito", "Понятно", "Yes, I agree", bare "Sono d'accordo", "agree and
  continue"). That is cheaper, but it refuses labels the brief asked for, and
  it leaves the old "Got it"/"OK" exposure as it was. (c) Land as is and file
  the scoping as a ticket.
- **med** · no `Done when` line depends on it · **The start anchor has no
  test.** Mutation: `new RegExp(\`^\\s*(?:`→`new RegExp(\`\\s*(?:`in`provoke.ts`, then
`npx vitest run …/provoke.test.ts …/browser-resolver.test.ts -t "dl-82"`→`Tests 91 passed | 57 skipped (148)`. Every `REFUSED`entry and the
look-alike fixture start with a consent phrasing, so none ends with one.
"Read and continue" or "Click OK" would pass unnoticed. Dropping the end
anchor fails 9, and an ungrouped alternation fails 8, so those are guarded.
The Log's "With the anchors removed … fails" holds only for the end anchor.
Fix: add a`REFUSED` entry that ends in a phrasing (e.g. "Read and
  continue", "Premi OK").
- **low** · the generic-word guard is a denylist sample. Planting
  `|yes|next|avanti` in the English entry fails only `does not match "Yes"`
  (`Tests 1 failed | 90 passed`), and "next"/"avanti" go through. Planting
  `|continua` fails both the unit row and the integration negative
  (`expected [...] to not include '/beacon/consent-continua'`). So the
  positive control the dispatch asked for works, and the test protects exactly
  the words it names.
- **low** · the trailing `[.!]?` widens the generic words the docstring says
  stay as they were: `"ok."`, `"OK!"` and `"Continue."` match at head and not
  at base (`node <scratch>/regex.mjs`).
- **low** · the Log's base-run count is wrong. It records
  `Tests 7 failed | 1 passed | 50 skipped (58)` and in the same bullet says
  that both the "Accept all" control and the negative passed. Measured with
  `provoke.ts` at `056aab7`: `Tests 7 failed | 2 passed | 50 skipped (59)`.
- **dropped** · regex construction: no phrasing lost. 651 probes (the 31-entry
  base language × 3 case forms × 7 whitespace wrappings including tab, newline
  and NBSP) were all accepted by the old pattern and all by the new one. The
  anchors wrap one `(?:…)` group around the whole join, the flags are `i` as
  before, no phrase carries an unescaped `.`, `&` is literal, and the
  apostrophe is `['’]`.
- **dropped** · a terms checkbox labelled "Agree and continue" is not pressed
  (`/terms-checkbox.html` beacons `[]`): `clickByText` asks only for `button`
  and `link`.
- **findings** · the hunt returned 8; 6 carried in 5 bullets (the false press
  and the order regression are one mechanism and share the first), 2 dropped.
- Invariants: no tool crossing, no `AppError`/code change, no spawn, no
  URL/header logging, no SSRF surface, no progress, no contract edit, no new
  test package or workspace dependency; style ✓ (no `any`, no `console`).
  Skipped: route enumeration and the Dockerfile, which the diff cannot touch.
- NFR: security: the first med (submit buttons pressed on the page's behalf,
  in an anonymous context) · performance: a press on a covered false match
  burns the 2000 ms click timeout per pass per frame (unmeasured) ·
  reliability: the first med · maintainability ✓ (one phrase array per
  language, exported for a table test).

### Gate 2

**Gate: FAIL** — 2026-10-06 · `2557198..cabd299` · Opus 5.5, depth standard (re-gate)

**Gate-1 findings:**

- **med, false presses anywhere in the frame: fixed for in-flow controls,
  not fixed inside a fixed or sticky layer** (see the high below). I re-ran
  gate 1's `falsepress.mjs` unchanged at `cabd299`. The newsletter, terms
  button, comment and review-vote pages now have `beacons: []`, and
  `/order-overlay.html` and `/order-bar.html` now find the stream with
  `["/beacon/consent-accepted"]`.
- **med, start anchor untested: fixed.** Dropping the `^` from `CONSENT_TEXT`
  gives `provoke.test.ts -t "dl-82"` → `Tests 5 failed | 150 passed | 7
skipped (162)`. The failures are the five new refused rows that end in a
  phrasing.
- **low, Log base count: fixed.** I put `provoke.ts` at `056aab7` into the
  head tree and ran `browser-resolver.test.ts -t "no vendor selector
matches"` → `Tests 7 failed | 2 passed | 57 skipped (66)`, as the Log now
  says.
- **low, trailing `[.!]?`: fixed, as a side effect of the scoping.**
  `CONSENT_TEXT_ANYWHERE` refuses `"ok."`, `"OK!"` and `"Continue."`.
  `CONSENT_TEXT` still accepts them, but only inside a container, where the
  bare `"OK"` and `"Continue"` already match.
- **low, generic-word denylist is a sample:** not in this round's lines,
  stands as written.

**The builder's claim that `CONSENT_TEXT_ANYWHERE` is the pre-dl-82 pattern
byte for byte: verified.** I extracted the regex literal from `056aab7`'s
`CONSENT_TEXT` and from head's `CONSENT_TEXT_ANYWHERE`, and `cmp` reports them
`IDENTICAL` (314 bytes).

**The open decision, measured.** Script: `node <scratch>/gate-2/cases.mjs`,
which runs the real `BrowserResolver` from built `dist`. I rebuilt
`resolvers` at each sha and grepped `dist` for `CONSENT_TEXT_ANYWHERE`: 4 hits
at head, 0 at base. "Pressed" is the beacon list, and a control pressed in
both passes shows twice.

| Page                                                                            | `cabd299`                                | `056aab7`                    |
| ------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------- |
| (i) in-flow strip, "Ho capito"                                                  | nothing pressed · `NO_MEDIA_FOUND`       | same                         |
| (i) in-flow strip, "Accetto e continua"                                         | nothing pressed · `NO_MEDIA_FOUND`       | same                         |
| (i) control: in-flow strip, "Accetta"                                           | strip pressed · stream                   | same                         |
| (ii) `position: fixed` checkout bar, submit "Agree and continue", no consent    | **submit pressed ×2** · `NO_MEDIA_FOUND` | nothing pressed              |
| (ii) `position: sticky` checkout form, same button                              | **submit pressed ×2** · `NO_MEDIA_FOUND` | nothing pressed              |
| (iii) sticky header holding a notice, "Ho capito", no consent                   | **notice pressed ×2**                    | nothing pressed              |
| (iii) sticky header holding a notice, "OK", no consent                          | notice pressed ×2                        | notice pressed ×2            |
| (iii-b) sticky header "Ho capito" ahead of a fixed bottom consent bar "Accetta" | **notice pressed ×2 · `NO_MEDIA_FOUND`** | consent pressed · **stream** |
| (iv) cross-origin iframe, `role=dialog` overlay, "Ho capito"                    | consent pressed · stream                 | nothing · `NO_MEDIA_FOUND`   |
| (iv) cross-origin iframe, fixed overlay without `role`, "Ho capito"             | nothing · `NO_MEDIA_FOUND`               | same                         |
| (iv) cross-origin iframe, `role=dialog`, "Accetta"                              | consent pressed · stream                 | same                         |
| (iv) cross-origin iframe, fixed overlay without `role`, "Accetta"               | consent pressed · stream                 | same                         |

**Findings on the lines this round touched:**

- **high** · shipped text false against the code, and a regression on a page
  `origin/main` resolves (row iii-b; one mechanism). `clickConsentText`'s
  docstring in `resolvers/src/browser/provoke.ts` says the container pass is
  "Tried first, so a real consent layer wins over an earlier control in the
  document that happens to carry a label from the same list". The Log says
  "A real consent layer therefore wins over an earlier control with a
  colliding label". Neither holds when the earlier control sits in a fixed or
  sticky ancestor. The script marks every such ancestor as a zone, and
  `frame.locator('[data-downloader-consent-zone]').getByRole(...).first()`
  takes zones in DOM order, so a sticky header's "Ho capito" is pressed in
  both passes and the bottom consent bar's "Accetta" is never reached. Base
  pressed "Accetta", because "Ho capito" was not a label there. The Log's
  stated costs list in-flow strips and docked checkout forms, but not this.
  Reproduction:
  `node <scratch>/gate-2/cases.mjs /iii-sticky-header-hocapito-then-consent.html`
  → head `error NO_MEDIA_FOUND | beacons: ["/beacon/header-notice","/beacon/header-notice"]`,
  base `stream /media/mse/v1080.m3u8 | beacons: ["/beacon/consent-accepted"]`.
  With a full-viewport overlay instead of a bar, the header press would time
  out and fall through to the old pattern. I did not measure that variant.
  **Open decision:** (A) **recommended**: change the code so the claim is
  true. For example, treat a fixed or sticky ancestor as a zone only when its
  text carries consent wording (cookie, consent, privacy and their
  equivalents), keeping semantic dialogs unconditional. That would also close
  rows (ii) and (iii). It is unmeasured, and it would miss a consent bar with
  no such word. (B) Keep the code, rewrite the docstring and the Log to name
  this case as a third accepted cost, and record the regression as a med.
  The builder's option (2), a visual-position test, is unmeasured here, and
  it would not obviously separate a top sticky header from a top consent bar.
- **med** · no `Done when` line depends on it · rows (ii) and (iii): a
  non-consent control in a fixed or sticky layer whose label is a dl-82
  phrasing is pressed in both passes. Two of these are a form's submit. Base
  pressed none of them. The Log names the docked checkout bar but not the
  sticky-header notice. No test covers either. This is the measured content of
  the builder's open decision, so it goes with the high above.
- **low** · the cross-origin branch of `clickConsentText` (dialog semantics
  only) has no test. With its press replaced by `void dialogs;`,
  `npx vitest run tools/downloader/resolvers/test/browser` →
  `Test Files 7 passed (7)`, `Tests 322 passed (322)`. It works on a real
  page (row iv, `role=dialog` "Ho capito" → stream at head only), so this is
  a missing test, not a defect.
- **dropped** · a double press inside one `dismissConsent` call: there is
  none. A container press returns before the whole-frame fallback runs.
  Across the two provocation passes one probe can press two different
  controls (`/double-press.html`, head: `["/beacon/consent-accepted","/beacon/poll-ok"]`
  and the stream). Base pressed that page's in-flow "OK" twice
  (`["/beacon/poll-ok","/beacon/poll-ok"]`, `NO_MEDIA_FOUND`). Pressing in both
  passes is older than dl-82, so this is not a new class.
- **dropped** · the container script's cost on a large DOM. `node
<scratch>/gate-2/bench.mjs` times `dismissConsent` alone, 7 calls, on a page
  with no consent layer:

  | Page                                                    | Base median | Head median |
  | ------------------------------------------------------- | ----------- | ----------- |
  | 5,605 elements, about 2,000 links and buttons           | 73 ms       | 89 ms       |
  | 9,605 elements, each control under its own 12-div chain | 124 ms      | 183 ms      |

  One full probe of the 5,605-element page took 3,740 ms at base and
  3,437 ms at head, a single sample each. That is within noise. The cost is
  paid per frame per pass.

- **dropped** · `CONSENT_TEXT_ANYWHERE` drifting from the base pattern: it
  matches byte for byte (above), and `provoke.test.ts` pins KEPT ✓ / ADDED ✗
  against it.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- Gates at `cabd299`: `npm run check` exit 0. `npm test -- --project
downloader` exit 0, with 1760 passed and 2 skipped of 1762 tests (gate 1:
  1680, +80 = 5 refused rows + 31 + 37 pinning rows + 7 integration). PR #370
  on `cabd299`: 10 checks pass, and `test (windows-latest, informational)` was
  still **pending** when read.

## Log

### 2026-10-06 — build

- **Reproduced on `origin/main` (056aab7) first.** `consent-label.html?label=…`
  is a viewport-wide dialog with no vendor id, whose button's label comes from
  the query and which mounts an MSE player only when pressed. Run against the
  unchanged `provoke.ts`:
  `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "dl-82"`
  gave `Tests 7 failed | 1 passed | 50 skipped (58)`. All seven new phrasings
  (Accetto e continua, Acconsento, Sono d'accordo, Ho capito, Agree and
  continue, Accept & close, Yes, I agree) ended in `NO_MEDIA_FOUND`; the
  control `Accept all` and the negative test passed.
- **Fix.** `CONSENT_TEXT` is now built from one array of alternatives per
  language and exported (as `AGE_GATE_TEXT` is) so a table test can run it
  without a browser. Still one pattern anchored at both ends, with an optional
  trailing `.` or `!`. Same command after: the eight label tests and the
  negative pass, and `provoke.test.ts` `-t "CONSENT_TEXT"` runs 82 cases, 31 of
  them the pre-change phrasings, so a widening cannot drop one.
- **The negative test can fail.** With the anchors removed from the pattern,
  "presses neither a pagination link nor a vote button" fails with
  `expected [...] to not include '/beacon/consent-vote'`; restored, it passes.
  The fixture has a `Continua` link and a vote button labelled
  "Sono d'accordo con questa recensione" next to a body sentence starting the
  same way: a sentence in body text is not a control, so the button is what
  makes the case able to fail.
- **Left out on purpose**, per the brief's step 3 and 4: no bare "Continua", no
  bare "Allow", "Yes", "d'accord", "de acuerdo" or "zgoda" (each as generic as
  the "continue" and "ok" already here), and no "Entra" or "Enter". Polish
  "Zgadzam się i przechodzę do serwisu" is kept: it is a consent phrasing whose
  tail names the site, and its first words are the agreement.
- **What the brief had wrong:** nothing material. "Sono d'accordo" is both a
  step-1 label to be pressed and the start of a sentence to be left alone; the
  two do not conflict, because the pattern is anchored, and the fixtures show it.
- **Not folded in.** dl-48's Log notes that `CONSENT_TEXT`'s only Russian entry
  was "accept"; this change widens it, but that is a finished ticket's note and
  editing it would trip preflight's `## Review` check for a `done` ticket.
- **Coordination with dl-83.** This change exports `CONSENT_TEXT` and adds
  `CONSENT_TEXT` to the import list in `provoke.test.ts`, which dl-83 is likely
  to edit too; no helper is shared.

### 2026-10-06 — gate round 1

Corrections to the entry above:

- **The base-run count was wrong.** `7 failed | 1 passed | 50 skipped (58)` was
  measured before the `Accept all` control was added to the label list, so the
  sentence saying the control passed described a run that did not contain it.
  Re-measured with `provoke.ts` at `origin/main` and the fixtures in place:
  `npx vitest run …/browser-resolver.test.ts -t "no vendor selector matches"`
  gave `Tests 7 failed | 2 passed | 57 skipped (66)`; the seven new labels fail
  and the control and the negative pass.
- **"What the brief had wrong: nothing material" was wrong.** The brief weighed
  the widening only against the late revisits. The wider hazard is the
  whole-frame reach: `getByRole(...).first()` over the frame pressed a
  newsletter's "Ho capito", a checkout's "Agree and continue", a comment form's
  "Yes, I agree" and a review vote's "Sono d'accordo", and, in DOM order ahead of
  a consent dialog, made a page that resolved on `origin/main` fail. The gate's
  pages are now fixtures; against the round-0 head,
  `-t "gate 1"` gave `Tests 6 failed | 1 passed | 59 skipped (66)`.
- **"With the anchors removed … fails" held for the end anchor only.** Dropping
  the `^` passed every test, because each refused row began with a phrasing.
  Rows that end in one ("Read and continue", "Click OK", "Premi OK", "Please
  accept", "Non accetto") now fail it: without the `^`, `-t "CONSENT_TEXT"` gave
  `Tests 5 failed | 150 passed | 7 skipped (162)`.

**Decision (owner chose scoping, option (a)); how it is scoped is mine.** The
text fallback now has two reaches, in `dismissConsent`:

1. **Inside a consent container, the full `CONSENT_TEXT`**, tried first. A
   container is a semantic dialog (`SEMANTIC_DIALOG`) or any ancestor whose
   computed `position` is `fixed` or `sticky`, marked by script in a frame that
   allows it and found by dialog semantics alone in a cross-origin one. A real
   consent layer therefore wins over an earlier control with a colliding label.
2. **Anywhere in the frame, only `CONSENT_TEXT_ANYWHERE`**: the pre-dl-82
   pattern, byte for byte, so nothing a page was pressed for before is lost.

Why not container-only: a cookie strip in the page's own flow is common, and
`origin/main` pressed its "Accept"; container-only would have taken that away
to protect against labels it had never pressed. Why not the full pattern as the
whole-frame fallback: it is the very reach that pressed the gate's four false
pages, which have no container at all. The hybrid has one cost, stated rather
than hidden: **a consent strip that is neither a dialog nor a fixed or sticky
layer, labelled with a phrasing only dl-82 added ("Ho capito", "Accetto e
continua" and the rest), is not pressed.** Likewise a sticky or fixed _form_
(a docked checkout bar) is a container, and its "Agree and continue" would be
pressed. Neither is covered by a test.

Proof, all in `browser-resolver.test.ts` "…only inside a consent container
(dl-82 gate 1)": the order-overlay and order-bar pages yield the stream and leave
the newsletter alone; the newsletter, checkout, comment and vote pages press
nothing and end `NO_MEDIA_FOUND`; `consent-inline-strip.html` (an in-flow strip
with "Accept") is still pressed. `provoke.test.ts` pins that every pre-change
phrasing still matches `CONSENT_TEXT_ANYWHERE` and no added one does.

**Free with this change:** the low that `ok.`, `OK!` and `Continue.` now match
where they did not before. With the whole-frame reach back on the old pattern
they match only inside a container, so the generic words stay as bare as they
were everywhere a page can repeat them.

**Coordination with dl-83.** `dismissConsent` gained a required `scriptable`
argument, so the call line in `provokeFrame` changed, and `CONSENT_TEXT_ANYWHERE`
joins the import list in `provoke.test.ts`; both sit next to lines dl-83 is likely
to edit. No helper is shared.

### 2026-10-06 — gate round 2

The gate measured the round-1 hybrid and found its open decision was not a
cost but a regression. **The sentence above, "A real consent layer therefore wins
over an earlier control with a colliding label", was false** for a colliding
control inside a fixed or sticky layer. Every such ancestor was a container, and
`first()` took containers in document order, so a sticky header's "Ho capito"
was pressed ahead of a bottom consent bar's "Accetta" and a page `origin/main`
resolved ended in `NO_MEDIA_FOUND` (row iii-b). A docked checkout bar's submit
and a sticky header's notice were pressed too (rows ii, iii), where base pressed
neither. Round 1's recommendation, "accept both gaps", was wrong; the owner
chose option (A) on 2026-10-06.

**What is built (A).** A `fixed` or `sticky` layer is a consent container only
when its text carries consent wording, `CONSENT_WORDING`; a semantic dialog is one
unconditionally. A layer that speaks of consent is tried before a bare dialog
(two marks, `consent` then `dialog`), so a consent layer wins over an earlier
newsletter dialog. A layer that does not speak of consent is not a container, and
a label the old pattern knew is still pressed there through the whole-frame
reach, as before dl-82.

**The word list, and why.** `cookie` (which also covers "cookies" and
"Cookie-Einstellungen"), `ciasteczk`/`ciasteczek` (Polish), `kakor` (Swedish),
`куки`, `témoins` (Québec French for cookies); `consent` (covers
`consentement`, `consentimiento`, `consentimento`), `consenso`, `einwilligung`,
`toestemming`, `samtycke`, `zgodę/zgody na`, `согласие/согласия на`; `GDPR` and
`RODO`. Substrings, not words, so the inflected forms match, and no `\b`, which
does not see Cyrillic. Left off on purpose: `accept`, `agree`, `continue` (the
labels being matched; a checkout bar says "accept our terms"), and **`privacy`**.
The owner's brief for this round listed privacy as an example; I left it out because
a docked checkout bar links its privacy policy as readily as a consent bar does,
and the two errors are not the same size: a consent layer that is missed falls
through to the old pattern, where it stood before dl-82, while a checkout submit
that is pressed is a regression from base. Both choices are pinned: a bare privacy
notice and "By ordering you accept our terms and privacy policy." are test rows that do not
speak of consent, so the first falls back to the old pattern and the second is safe.

**What the rule still gives up.** A fixed or sticky consent bar that never says
cookie or consent, labelled with a phrasing only dl-82 added, is not pressed
(`consent-bar-nowording.html`, "Ho capito": nothing pressed, `NO_MEDIA_FOUND`; with
"Accetta" it is pressed, as on base). The opposite risk is real too: a docked
bar that does mention cookies, with a widened-label submit, is believed. The
text is the nearest fixed or sticky ancestor's, so a fixed app root that holds the
whole page, cookie notice in its footer included, may make itself a container
(unmeasured; reasoning from the script, not a run). None is covered by a test beyond
the no-wording bar.

**Proof.** Every row of the gate's table is a fixture and a test in
`browser-resolver.test.ts`, "…speaks of consent (dl-82 gate 2)": (i) the in-flow
strip with "Ho capito", "Accetto e continua" (nothing pressed) and "Accetta"
(pressed); (ii) fixed and sticky checkout bars (submit not pressed); (iii) the
sticky header's "Ho capito" (not pressed) and "OK" (still pressed, as on base);
(iii-b) the stream past the header's notice; (iv) the cross-origin `role=dialog`
(pressed, stream) and fixed layer without a role (not pressed). Against
`provoke.ts` at cabd299, `-t "gate 2"` gave `Tests 6 failed | 7 passed | 66
skipped (79)`: (ii) both, (iii), (iii-b), the dialog-order test and the no-wording
bar. After: `-t "dl-82"` over both files gave `Tests 209 passed | 57 skipped
(266)`, 2 of 2 files. Mutations: tier order reversed fails the dialog-order test;
the cross-origin press replaced by `void dialogs;` fails
`presses a widened label inside a role=dialog in a cross-origin frame` (the gate's
low, cross-origin branch untested, now has a test).

**Correction to the dialog-order test.** The fixture's newsletter dialog is pressed
in the _second_ pass, once the consent bar is gone, because a dialog is a container
whatever it says; the test therefore pins the order (consent first), not
that the newsletter is never pressed. That follows from "a semantic dialog counts
unconditionally".

**Free with this change:** nothing further; the other two lows of round 1 stand.

### 2026-10-06 — gate round 3

**`privacy` stays off `CONSENT_WORDING`, confirmed by the owner, with the gate's
measurement as the reason.** The gate rebuilt `dist` at head (`ab92dcd`), at head
with privacy words added (`privacy|confidentialité|privacidad|privacidade|datenschutz|prywatność|конфиденциальн`)
and at base (`056aab7`), and ran the same pages. "×2" is a press in both passes.

| Page                                                                    | head                      | + privacy                       | base                      |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------- | ------------------------- |
| p1 fixed bar "We value your privacy", "Ho capito"                       | nothing, `NO_MEDIA_FOUND` | pressed, stream                 | nothing, `NO_MEDIA_FOUND` |
| p1 same, "Accetto e continua"                                           | nothing, `NO_MEDIA_FOUND` | pressed, stream                 | nothing, `NO_MEDIA_FOUND` |
| p2 fixed checkout "… terms and privacy policy", "Agree and continue"    | nothing                   | **submit ×2**                   | nothing                   |
| p3 sticky header, "Privacy" nav link, notice "Ho capito"                | nothing                   | **notice ×2**                   | nothing                   |
| p3b p3's header ahead of a fixed "We value your privacy" bar, "Accetta" | consent, stream           | **notice ×2, `NO_MEDIA_FOUND`** | consent, stream           |
| p4 fixed bar "Datenschutz …", "Einverstanden"                           | consent, stream           | consent, stream                 | consent, stream           |
| p4b same bar, "Ich stimme zu"                                           | nothing, `NO_MEDIA_FOUND` | pressed, stream                 | nothing, `NO_MEDIA_FOUND` |

Adding privacy resolves three pages that neither head nor base resolves (p1
twice, p4b). It also presses two non-consent controls that neither presses (p2,
p3) and regresses one page that both resolve (p3b). Without it, head equals base
on every row. (p4 measures nothing: "Einverstanden" is a pre-dl-82 label,
pressed anywhere.) The gate's figure is not mine; I did not rerun it.

**Gate 3's two meds, and the mechanism.**

1. **Wording is read from the layer's visible prose.** `MARK_CONSENT_ZONES_SCRIPT`
   walks the layer's text nodes and keeps one only if its parent is not inside an
   `a` or `[role=link]` (up to the layer) and `parent.checkVisibility(...)` is
   true. I chose that over `innerText` minus links because `innerText` has no
   per-link subtraction (it would mean removing each link's text by string
   search), and over a detached clone because `innerText` of a clone is
   `textContent` (nothing is rendered). `checkVisibility` is false for
   `display:none` ancestors, `<script>` and `<style>`, which is what the gate
   left unmeasured: a script reading `document.cookie` inside a fixed app root
   would have counted as speaking of cookies. `consent-approot.html` carries
   exactly that script, and with the visibility check removed the
   footer-link variant fails (`Tests 1 failed | 7 passed | 79 skipped (87)`).
2. **Latin word start, and a word end for the ambiguous roots.**
   `(?<!\p{L})` under the `u` flag, which also works for Cyrillic, where `\b`
   does not. `consent` takes only its written-out inflections
   (`consentement`, `consentimiento`, `consentimento`, plural `s`) followed by a
   non-letter, so "consente", "consentito" and "consentono" no longer match;
   `kakor`, `куки`, `gdpr` and `rodo` end at a non-letter, so "pannkakor",
   "sockerkakor" and "Кукиш" no longer match (Кукиш was free); `témoins` counts
   only as "témoins de connexion/navigation/suivi" or "fichiers témoins", so
   "les témoins de l'accident" no longer matches. `cookie`, `ciasteczk`,
   `consenso`, `einwilligung`, `toestemming` and `samtycke` stay open at the end.

**Red at `ab92dcd`:** `-t "gate 3|CONSENT_WORDING"` gave
`Tests 13 failed | 33 passed | 241 skipped (287)`: the seven new `SILENT` rows
(consente, consentito, consentono, pannkakor, sockerkakor, témoins, Кукиш), the
two sticky-header cookie-link pages (visible and `display:none`), the bar
behind the linking header (a3c), the checkout "consente" (a4), the header
"pannkakor" (a5) and the app root with only a cookie link (a1b). After:
`-t "dl-82"` over both files gave `Tests 230 passed | 57 skipped (287)`, 2 of 2
files.

**Every row of the gate's second table is a test** (describe "…read from its
visible prose, by word (dl-82 gate 3)"): a3 and a3b (not pressed, equal to base),
a3c (bar reached, stream, equal to base), a3d (the existing
`consent-header-then-bar.html` test), a4 and a5 (not pressed, equal to base), a1b
(not pressed, equal to base). **a1 and a2 still differ from base**, as the gate
said visible text would leave them. They are pinned as what the code does:

- a1, a fixed app root whose footer says "Questo sito usa i cookie tecnici.":
  the root is a container, and its first widened label, the newsletter's "Ho
  capito", is pressed. Base pressed nothing there.
- a2, a docked checkout bar that says "Your cart is kept in a cookie.": its
  submit "Agree and continue" is pressed. Base pressed nothing.

Neither is closed by this round; closing them needs the wording to be near the
control rather than anywhere in the layer, which the owner has not chosen.

**The low** (the docstring's "are not containers at all"): rewritten. It now says
a header or bar whose prose says nothing of consent is not a container even when
it links a cookie policy, and that one whose prose does is, naming a1 and a2.
