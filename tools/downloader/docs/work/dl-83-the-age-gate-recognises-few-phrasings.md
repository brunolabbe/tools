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

**2026-10-06 — built** on `dl-83-age-gate-phrasings`, off `origin/main` at
`056aab7`.

**Reproduced before any fix.** One fixture, `age-gate-overlay.html`, carries
every step-1 gate behind a query flag (`exit=link`, `exit=button`, `second`,
`shadow`, plus `exit=foreign` and `decoy`, below). Probed through
`BrowserResolver` with `quietMs: 1200`, against `056aab7`'s `src/` and then
this branch's:

| fixture                       | `056aab7`, off   | `056aab7`, on                      | branch, off                 | branch, on                  |
| ----------------------------- | ---------------- | ---------------------------------- | --------------------------- | --------------------------- |
| `Ho 18 anni o più - Entra`    | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed       |
| + exit link to another origin | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed       |
| + same-origin exit `<button>` | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed       |
| + off-site exit, Czech label  | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed       |
| + a second entry (`second`)   | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | `AGE_CONFIRMATION_REQUIRED` |
| layer in an open shadow root  | `NO_MEDIA_FOUND` | `NO_MEDIA_FOUND`                   | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed       |
| + `AGE_GATE_TEXT` decoy above | `AGE_CONF…` ¹    | `NO_MEDIA_FOUND`, decoy pressed 6× | `AGE_CONFIRMATION_REQUIRED` | stream, entry pressed only  |

¹ with `marker: "adults only"`, which the decoy variant adds on purpose. No exit
beacon fired in any run. The committed tests, run against `056aab7`'s `src/`:
10 of 14 failed (`npx vitest run …/browser-resolver.test.ts …/provoke.test.ts -t "dl-83"`);
the 4 that passed are the brief's four negatives, which `056aab7` also
recognises as no gate. (That run predates the fifth negative and the nav
fixture's "Rated 18+" text, both added below.)

**The three values the brief left to the builder.**

- **Word cap: 10** (`AGE_LABEL_MAX_WORDS`). The longest attestation phrased as
  a control I could list is "I confirm that I am 18 years of age or older", ten
  words; "Yes, I am 18 years of age or older" is nine, the Italian label six. At
  8 the first two are lost. The cap is a weak filter by design — a label also
  needs a blocking layer whose own text names the age — so the cost of 10 over
  8 is two words of caption, inside a layer that already qualifies.
- **Negation lists** (`AGE_NEGATIONS`), one closed list for every language
  `AGE_GATE_TEXT` lists (en, ru, de, fr, es, it, pt, nl, sv, pl): negation and
  under-age words only — `not`/`no`/`under`, `не`/`нет`/`младше`, `nicht`/`unter`,
  `pas`/`moins`, `menos`/`menor`, `meno`/`sotto`, `não`, `niet`/`jonger`,
  `inte`/`yngre`, `nie`/`poniżej` and their kin. **Not "exit" or "leave"**: an
  exit naming no age is not a candidate in the first place, and one that names
  it nearly always negates as well. Matched as whole words after splitting the
  lowercased label on anything not a letter or digit, so `Je n'ai pas` is caught
  by `pas`. A language with no list has the origin rule, and then nothing —
  `exit=foreign` (Czech) is the fixture for that.
- **Coverage: more than half the viewport** (`AGE_LAYER_MIN_COVER = 0.5`),
  measured as the positioned element's intersection with the viewport. "Most"
  read literally; every gate seen so far is a full-viewport backdrop, and a
  fixed header or a cookie strip covers far less. Limit: a gate drawn as a small
  centred card beside a sibling backdrop, rather than inside one, falls short
  and is recognised only through dialog semantics or dl-48's path.

**What the brief had wrong, or left out.**

- **"The layer's own text must also mention the number" is vacuous as
  written**: the label is inside the layer, so the layer always mentions it.
  Built as the layer's text _with controls excluded_. `age-negative-menu.html`
  (a full-screen menu whose only 18 is its own `18+` link) is the fifth
  negative fixture, added for this; counting control text made it fail.
- **The choice rules apply to a lone candidate too.** The brief said "one
  candidate → it". A gate whose only age-bearing control is its exit would have
  had the exit pressed for want of a second; now it presses nothing and reports
  `AGE_CONFIRMATION_REQUIRED`. Stricter only.
- **A third rule, first: when any candidate sits in a blocking layer, the
  candidates outside every layer are dropped.** The decoy is a genuine dl-48
  candidate (an `AGE_GATE_TEXT` label on a page with a marker), so without this
  the decoy gate had two candidates and pressed nothing — which passes "the
  decoy is not clicked" without proving the press goes to the recognised
  control. A person could not press a control under a layer either.
- **One press per document.** With the three rules in, the decoy was still
  pressed — once, by the second playback pass, after the layer's own entry had
  worked and the layer was gone, leaving the decoy as the one candidate.
  `056aab7` pressed it six times. `confirmAgeGate` now records a landed press on
  the document (`AGE_PRESSED`) and makes no second one; a click that did not
  land records nothing, so dl-48's intercepted-by-a-promo case still retries. A
  navigation is a new document and starts unpressed.
- **"Reports `AGE_CONFIRMATION_REQUIRED` as if the setting were off" needed a
  signal.** The resolver cleared `ageGate` whenever confirmation was on.
  `readSignals` now also returns `ageGatePressable` — a press was made in this
  document, or the choice would make one — and the resolver keeps `ageGate`
  when it is false. The contract's copy for the code, untouched per step 4,
  says "this server is not set to confirm it", which is not true of a declined
  press with the setting on.
- **Step 4's check holds**: `classifyFailure` omits `marker` when no
  `AGE_MARKERS` phrase is present, and the Italian test asserts
  `details.marker` is undefined.
- **A fresh config's `enableAgeConfirmation: false` was already tested**:
  `api/test/config.test.ts`, "is off in an empty environment". No new test.
- **Fixture trap**: `classifyFailure` reads the served HTML, inline script
  included, so a marker phrase written in a fixture's script leaks into
  `details.marker` for every variant. The decoy's phrase is assembled from
  pieces for that reason.

**Each rule is load-bearing**, measured by disabling it and re-running the
dl-83 tests (`-t "dl-83"`), one at a time:

| disabled                        | fails                                                 |
| ------------------------------- | ----------------------------------------------------- |
| the origin rule                 | the off-site exit in a language with no negation list |
| the negation rule               | the same-origin exit button                           |
| layered-over-unlayered          | the decoy                                             |
| one press per document          | the decoy                                             |
| controls excluded from its text | the full-screen menu negative                         |
| the coverage threshold (to 0)   | the nav-bar negative (its own text says "Rated 18+")  |

**Known limits, recognition side** (a wrong message with the setting off; a
press with it on, if alone): a consent dialog with a "View our 18 partners"
button, and a fixed or absolute app shell that covers the viewport and carries
both a short control and its own text naming 18 or 21. Neither is in the
brief's negatives and neither is handled.

**Nothing folded in.** dl-81 touches the same passes and is held behind this
branch by the orchestrator; dl-82 owns `CONSENT_TEXT`. No other open ticket
names the age gate.
