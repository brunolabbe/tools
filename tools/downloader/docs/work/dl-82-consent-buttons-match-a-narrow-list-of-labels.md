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
