---
id: dl-83
tool: downloader
title: An age gate is recognised in few phrasings per language, so an unrecognised one reads as no video
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-83 — The age gate recognises few phrasings

## Why

dl-48 taught the browser tier to recognise an age self-confirmation: a control
whose whole label matches `AGE_GATE_TEXT` (`resolvers/src/browser/provoke.ts`),
on a page whose text contains an `AGE_MARKERS` phrase
(`resolvers/src/browser/classify.ts`). Both conditions are required, so an
"I am 18" link in a footer isn't a gate. What happens next depends on the
operator's `ENABLE_AGE_CONFIRMATION`:

- **off** (the default, because the press attests on the user's behalf): a
  recognised gate ends the probe as `AGE_CONFIRMATION_REQUIRED`, which tells the
  user why;
- **on**: the tier presses it, and only in a main-origin frame.

**An unrecognised gate is neither of those.** It stays up, the player never
loads, and the user gets `NO_MEDIA_FOUND`: the wrong diagnosis with the setting
off, and a missed press with it on. Recognition is narrow. `AGE_GATE_TEXT`
takes "[yes,] I am / I'm [over|at least] 18|21 [years old]" and its equivalent
in each listed language, so Italian matches "Ho 18 anni" and "Ho più di 18
anni" but not "Sono maggiorenne", "Ho almeno 18 anni", "Confermo di avere 18
anni" or "Ho compiuto 18 anni". English misses "I'm 18 or older, enter" and
"I confirm I am 18". `AGE_MARKERS` has one or two phrases for most languages
(Italian: "vietato ai minori", "solo per adulti"; not "contenuti per adulti",
"conferma la tua età" or "maggiorenne").

The owner asked on 2026-10-06 for wider language coverage. **The default stays
off, and nothing here changes when the tier presses**: only what it
recognises. **Not yet reproduced** with a fixture: building one is the first
step.

## Build

1. **Reproduce first**, extending dl-48's age-gate suite: fixture gates
   labelled "Sono maggiorenne", "Confermo di avere 18 anni" and "I confirm I am
   18", on pages whose text carries "contenuti per adulti" or "conferma la tua
   età". With `confirmAge` off, expect `AGE_CONFIRMATION_REQUIRED` and record
   what `origin/main` returns. With it on, expect the stream.
2. Extend `AGE_GATE_TEXT` per listed language: a confirm verb ("I confirm",
   "confermo di avere", "je confirme avoir", "ich bestätige", …), "at least" /
   "almeno" forms, and the single-word adult forms ("maggiorenne", "majeur(e)",
   "volljährig", "mayor de edad", "maior de idade", "meerderjarig",
   "pełnoletni", "совершеннолетний"), each anchored like the rest.
3. Extend `AGE_MARKERS` with the matching "adult content", "confirm your age"
   and "adults only" phrasings for each listed language.
4. **Both halves stay required.** Add a negative test per new label family: the
   label on a page with no marker, and a marker on a page with no label, are
   neither recognised nor pressed.
5. Don't touch `ENABLE_AGE_CONFIRMATION`'s default, the main-origin limit on
   the press, or the contract's `AGE_CONFIRMATION_REQUIRED` copy.

## Done when

- Each step-1 fixture reports `AGE_CONFIRMATION_REQUIRED` with confirmation off
  and yields its stream with it on.
- The step-4 negative tests pass.
- A test proves a fresh config still has `enableAgeConfirmation: false`.
- `npm run check` and `npm test -- --project downloader` pass.

## Log
