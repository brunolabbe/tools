---
id: dl-82
tool: downloader
title: A consent button is pressed only when its label is one of a narrow list of exact phrasings
kind: fix
status: ready
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
