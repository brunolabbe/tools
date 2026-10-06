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
