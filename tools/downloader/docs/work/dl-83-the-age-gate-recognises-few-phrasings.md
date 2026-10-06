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

**2026-10-06 — gate round 1 repaired** (gate FAIL at `25e97db`: two highs, one
med, five lows). The owner decided both highs on 2026-10-06, choosing the
first of three options the orchestrator put: the gate's remedy A, plus, for
the second high, counting a layer as blocking only at `AGE_LAYER_MIN_COVER` and
preferring a dl-48 candidate over a structural one. The other two options were
A plus a closed per-language attestation list for structural presses, and
accepting the branch as built. What changed, all in `AGE_CANDIDATES_FN` and
`AGE_CHOOSE_FN`:

- **A link that would leave the document is never pressed.** That means
  another http(s) origin, as before, or, in the top frame, another path or
  query on this origin. The departure guard already turned such a press into
  `NO_MEDIA_FOUND`, so no press that could have worked is lost. A link in a
  same-origin frame still navigates only the frame and is still pressed.
- **The layered-over-unlayered rule counts only a blocking layer**, one
  covering `AGE_LAYER_MIN_COVER`. A small dialog is still a layer for
  _recognition_.
- **Otherwise a dl-48 candidate beats a structural one.** When no candidate is
  blocking and any is dl-48's (label plus page marker), the structural ones
  go. I ran the tie-break on all 119 rows of the gate's matrix (below). It
  changed only the row it was meant for, and none of its rows came out as a
  choice between materially different behaviours.
- **The labels are tested before the ancestor walk** (the low's stated
  remedy). The gate's perf harness, `readSignals` median: 10, 10 and 28 ms for
  3000 links nested 10 deep, 3000 nested 40 deep and 10000 nested 40 deep.
  `25e97db` measured 35, 108 and 502 ms, and base 10, 8 and 23 ms.

**The gate's matrix, all 119 rows**, rerun with a copy of its harness pointed
at this worktree. Base was rerun too and matched the gate's own base run on
every row. 16 rows differ from `25e97db`, and every one is the decision's
intended effect:

| row (confirmation on)                     | base                    | `25e97db`                         | now                         |
| ----------------------------------------- | ----------------------- | --------------------------------- | --------------------------- |
| shell, `<a>18+` nav link, stream          | stream                  | `NO_MEDIA_FOUND` (navigated-away) | stream                      |
| shell, `<a>21 Savage`, stream             | stream                  | `NO_MEDIA_FOUND` (navigated-away) | stream                      |
| full-viewport promo `<a>Over 18?`, stream | stream                  | `NO_MEDIA_FOUND` (navigated-away) | stream                      |
| dialog card `<a>Over 18?`, stream         | stream                  | `NO_MEDIA_FOUND` (navigated-away) | stream                      |
| pricing `<a>Start 21-day trial`, stream   | stream                  | `NO_MEDIA_FOUND` (navigated-away) | stream                      |
| the same five pages, nothing playing      | `NO_MEDIA_FOUND`        | `NO_MEDIA_FOUND` (navigated-away) | `AGE_CONFIRMATION_REQUIRED` |
| dl-48 inline gate + cookie sheet          | stream, `age-confirmed` | `NO_MEDIA_FOUND`, `view-partners` | stream, `age-confirmed`     |

The "nothing playing" row is the declined press: those pages are still
recognised, and their only candidate is now a link that would leave. That gives
the same code that confirmation off already gave them at `25e97db`.
The other 103 rows are as `25e97db` had them. That includes the accepted
residue: the `pushState` "18+" button, the menu button, "View our 18 partners"
where play is a click, and `Age: 18`. Each is pressed as before. The owner
accepted these on 2026-10-06 as known, not fixed.

**Tests.** Each row of both highs is now a test in `browser-resolver.test.ts`,
in the "false candidates and the press, as gate round 1 measured them (dl-83)"
block. The fixtures are static copies of the gate's harness pages
(`age-false-*.html`, `age-inline-gate-plus-cookie.html`). There are 17 tests:
five leaving links that are never pressed, four pages with nothing recognised,
the negated chips with confirmation off and on, the inline gate beside the
cookie sheet, and four residue pins. Against `25e97db`'s `src/`, 6 of the 17
fail: the five links and the inline gate, which are the rows the decision
fixes. The 11 others pin behaviour `25e97db` already had.

**Left as recorded, not fixed.**

- The med: one press per document is never retried, and a hash or `pushState`
  route is not a new document. This change does not make it free. The hydrate
  and SPA rows are unchanged.
- The `about:srcdoc` ad frame low: its link is in a frame, not the top
  document, so the new rule leaves it pressable, and it is still pressed.
- The other lows (a lost mark, the tokeniser restated in `capture-rules.test.ts`,
  and the classification order) are untouched.
- dl-94 is filed on this branch for the `AGE_CONFIRMATION_REQUIRED` copy, on the
  owner's choice of (b), 2026-10-06. The copy is unchanged here.

**2026-10-06 — gate round 2 repaired** (gate FAIL at `22bc21e`: one high, two
lows). The high: gate round 1's remedy assumed that "a press the guard would
call a departure could never have worked". That is false for a real gate built
as a link. Such a link can be cancelled by script, can go through a route that
sets a cookie and redirects back, can open in a new tab, or can point at a
play-time query key. None of those leaves the page, and dl-48 pressed all four.
**The owner chose the gate's option (A), 2026-10-06.** The options were (A)
exempt dl-48's candidates from the same-origin half of the leaving rule, keep
the cross-origin half for every candidate, and honour the guard's play-time keys
for the rest; (B) revert the same-origin half; (C) keep it as built. What
changed, in `AGE_CHOOSE_FN`:

- **dl-48's candidates are exempt from the same-origin half** of the leaving
  rule. The cross-origin half still applies to every candidate, as at base.
- **The same-origin half now honours the play-time keys**: a link differing
  only in `t`, `start` or `autoplay` is not leaving. The three keys moved from
  `resolvers/browser.ts` to `PLAY_TIME_QUERY_KEYS` in `provoke.ts`, and the
  guard reads them from there, so the guard and the press cannot disagree.
  The gate's dry run of (A) left this half out, which is why one more row
  changes here than it claimed: `ln-ptk-S` streams.
- **The filters run before the preferences.** Negation and leaving drop
  candidates first; the blocking and dl-48 preferences then choose among what
  is left. Applied the other way round, a preference could drop the real gate
  in favour of a candidate that a filter then removed (the first low).
- **The comment no longer says a same-origin frame's link "navigates only the
  frame"** (the second low). A link with `target="_top"` or `_parent`
  navigates the page. Behaviour is unchanged, and equal to base.

**The accepted cost, as the owner was told**: a structural-only gate (the
Italian label, no marker) built as a link that is cancelled by script, goes
through a redirect, or opens a new tab is declined (`AGE_CONFIRMATION_REQUIRED`).
`25e97db` pressed it. Base never recognised it.

**The first low's three decoy pages, after the reordering**: unchanged from
`22bc21e`. The English sheet, the Italian sheet and the Italian card below the
coverage threshold each press their dl-48 footer or header link once, and
nothing plays (`NO_MEDIA_FOUND`). The decoy is a `#top` link, which no filter
drops, so the dl-48 preference still picks it over the structural gate. The
reordering changes only the leaving-decoy page: there the decoy is now pressed
and departs, as at base, where `22bc21e` declined.

**Matrix**: 225 rows. These are gate round 1's 119 plus gate round 2's
`jobs5.json`, `jobs6.json` and `jobs7.json`, which repeat each other. I ran
the gate's own harness in place, read-only, at base, `22bc21e` and this head.
18 rows differ from `22bc21e`, which is 9 distinct rows, each listed twice. No
row of round 1's 119 differs.

| row (confirmation on)                       | base                                             | `22bc21e`                   | now            |
| ------------------------------------------- | ------------------------------------------------ | --------------------------- | -------------- |
| `ln-prevent-L` (script cancels the link)    | stream                                           | `AGE_CONFIRMATION_REQUIRED` | stream         |
| `ln-redirect-L` (cookie, redirect back)     | stream                                           | `AGE_CONFIRMATION_REQUIRED` | stream         |
| `ln-blank-L` (`target="_blank"`)            | stream                                           | `AGE_CONFIRMATION_REQUIRED` | stream         |
| `ln-ptk-L` (`?t=5`)                         | stream                                           | `AGE_CONFIRMATION_REQUIRED` | stream         |
| `ln-ptk-S` (`?t=5`, structural only)        | `NO_MEDIA_FOUND`                                 | `AGE_CONFIRMATION_REQUIRED` | stream         |
| `ln-leave-L` (an uncancelled link out)      | `NO_MEDIA_FOUND` (navigated-away)                | `AGE_CONFIRMATION_REQUIRED` | as base        |
| `ln-qmark-L?v=1` (`href="?"` under a query) | `NO_MEDIA_FOUND` (navigated-away)                | `AGE_CONFIRMATION_REQUIRED` | as base        |
| `tb-sheet-leaving-decoy`, resolve           | `NO_MEDIA_FOUND` (navigated-away), decoy pressed | `AGE_CONFIRMATION_REQUIRED` | as base        |
| `tb-sheet-leaving-decoy`, signals           | gate=true                                        | pressable=false             | pressable=true |

**Tests**: 13 new tests in "gates built as links, and the dl-48 preference, as
gate round 2 measured them (dl-83)", over static copies of the gate's
`pages5.mjs` pages (`age-link-*.html`, `age-tiebreak-*.html`). The fixture
server gained `/enter-redirect`.

- The four dl-48 link gates are pressed and stream.
- Their structural twins: three are declined (the accepted cost), and `?t=5`
  streams.
- `href="#enter"` is pressed and streams. A pressable link is pressed, which
  none of round 1's 17 tests showed.
- The three decoy pages are pinned as they stand.
- The leaving decoy departs.

Against `22bc21e`'s `src/`, 6 of the 13 fail: the four dl-48 link gates,
`ln-ptk-S` and the leaving decoy. The 7 others pin behaviour `22bc21e` already
had.

**Still recorded, not fixed**: the round-1 med (one press per document), the
srcdoc ad frame, the lost mark, the restated tokeniser and the classification
order.
