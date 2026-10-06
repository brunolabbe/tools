---
id: dl-83
tool: downloader
title: An age gate is recognised only by exact phrasings, so an unrecognised one reads as no video
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-83 — Recognise an age gate by its structure, and press it strictly

## Why

dl-48 taught the browser tier to recognise an age self-confirmation:
`AGE_GATE_SCRIPT` (`resolvers/src/browser/provoke.ts`) returns true when a
visible control's whole label matches `AGE_GATE_TEXT` **and** the page text
contains an `AGE_MARKERS` phrase (`resolvers/src/browser/classify.ts`). What
happens next depends on the operator's `ENABLE_AGE_CONFIRMATION`:

- **off** (the default, because the press is an attestation made on the
  user's behalf): a recognised gate ends the probe as
  `AGE_CONFIRMATION_REQUIRED`, which tells the user why;
- **on**: `confirmAgeGate` presses it, in a scriptable (same-origin) frame only.

**An unrecognised gate is neither.** It stays up, the player never loads, and
the user gets `NO_MEDIA_FOUND`: the wrong diagnosis with the setting off, and a
missed press with it on. Recognition depends on exact phrasings, one family per
language. Measured against `AGE_GATE_TEXT` at `4907d9a`: `Ho 18 anni` and
`I'm 18 or older` match, while `Ho 18 anni o più` and
`Ho 18 anni o più - Entra` (a label the owner saw on a real gate, 2026-10-06)
don't. Each new wording would cost another edit to the list.

Two more things are wrong in today's shape:

- **Detection and the press are separate searches.** `AGE_GATE_SCRIPT` returns
  a boolean, and `confirmAgeGate` then calls
  `clickByText(frame, AGE_GATE_TEXT)`, which clicks the first match on its own.
  Nothing guarantees that the element pressed is the one that was recognised.
- `AGE_GATE_SCRIPT` searches with `document.querySelectorAll`, which stops at
  shadow roots (compare dl-68 and dl-69).

**Decided by the owner, 2026-10-06: split recognition from the press.** A false
match costs very different things on each side. A false _recognition_, with the
setting off, reports `AGE_CONFIRMATION_REQUIRED` where `NO_MEDIA_FOUND` was
right: a wrong message, nothing clicked. A false _press_ clicks something on the
user's behalf. So recognition goes broad and structural, independent of
language, and the press stays strict.

## Build

1. **Reproduce first**, extending dl-48's age-gate suite with fixture gates:
   - `Ho 18 anni o più - Entra` in a full-viewport overlay, page text in
     Italian with no current `AGE_MARKERS` phrase;
   - a **two-button** gate: `Ho 18 anni o più - Entra` next to
     `Ho meno di 18 anni - Esci`, the exit being a link to another origin;
   - the same two buttons but the exit is a same-origin `<button>` with a
     script handler (no href to judge by);
   - a gate whose overlay lives in an open shadow root.
     Record what `origin/main` returns for each, with confirmation off and on.
2. **Recognition (structural, any language).** A gate candidate is a visible
   control (the selector `AGE_GATE_SCRIPT` already uses) whose label is short
   (pick and justify a word cap, around 8) and contains `18` or `21` as a whole
   number, optionally followed by `+`, **inside a blocking layer**: a
   `SEMANTIC_DIALOG` element, or a fixed- or absolute-positioned ancestor that
   covers most of the viewport. The layer's own text must also mention the
   number or carry an `AGE_MARKERS` phrase. Today's `AGE_GATE_TEXT` + marker
   rule stays as a second, sufficient path, so nothing dl-48 recognises is lost.
   Walk open shadow roots the way `ALL_MEDIA_FN` does.
3. **The press (strict, setting on only).** Recognition returns its candidates,
   and the press chooses exactly one and clicks _that element_ by marking it,
   the way `MARK_CLOSE_SCRIPT` and `CLOSE_MARK` do for the modal close. Never
   use a second text search. The choice:
   - one candidate → it;
   - several → drop any whose label carries a negation or under-age word
     (a short closed list per listed language: "under", "not", "meno",
     "non", "moins", "unter", "menos", "младше", …), then drop any that is
     a link to another origin;
   - exactly one left → press it; otherwise press nothing, and the probe
     reports `AGE_CONFIRMATION_REQUIRED` as if the setting were off. Saying
     why is better than guessing.
     After a press, a gate still showing or a departure from the page keeps
     today's handling (`navigated-away`, and the resolver's `ageGate` clearing).
4. Don't touch `ENABLE_AGE_CONFIRMATION`'s default, the limit to scriptable
   frames, or the contract's `AGE_CONFIRMATION_REQUIRED` copy.
   `classify.ts` already reports the code without a `marker` detail when there
   is none, so a structural match needs no contract change. Check that before
   relying on it.
5. Negative fixtures, each recognised as **no gate**: an `18+` category link in
   a nav bar (not in an overlay); a "Top 21" heading in a modal; a cookie
   dialog whose text mentions "18 partner"; a promo modal with a "Get 18% off"
   button.

## Done when

- The `Ho 18 anni o più - Entra` gate reports `AGE_CONFIRMATION_REQUIRED` with
  confirmation off, and yields its stream with it on.
- With confirmation on, both two-button gates press the entry and never the
  exit, and a gate with two candidates still standing after the choice rule
  presses nothing and reports `AGE_CONFIRMATION_REQUIRED`.
- The shadow-root gate is recognised.
- Every step-5 negative fixture is recognised as no gate.
- A test proves the element pressed is the element recognised: a decoy
  matching `AGE_GATE_TEXT` earlier in the DOM, outside the overlay, is not
  clicked.
- dl-48's existing age-gate tests pass unchanged.
- A test proves a fresh config still has `enableAgeConfirmation: false`.
- `npm run check` and `npm test -- --project downloader` pass.

## Log
