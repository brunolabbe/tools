---
id: dl-83
tool: downloader
title: An age gate is recognised only by exact phrasings, so an unrecognised one reads as no video
kind: fix
status: done
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

## Review

**Gate: FAIL** — 2026-10-06 · `056aab7..25e97db` · Sonnet 5.5, depth full

| Done when                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ho 18 anni o più - Entra` reports `AGE_CONFIRMATION_REQUIRED` off, yields its stream on                                        | `resolvers/test/browser/browser-resolver.test.ts` › "an Italian gate in a fixed layer, not told to confirm, fails AGE_CONFIRMATION_REQUIRED" (code, `marker` undefined, no confirm beacon) and "…told to confirm, yields its stream" (stream url and the beacon) ✓                                                                                                                           |
| Both two-button gates press the entry, never the exit; two candidates still standing press nothing and report the code          | same file › "a two-button gate with %s presses the entry and never the exit" (3 rows: exit link, same-origin exit button, off-site exit with no negation list; asserts stream, `age-confirmed` present, `age-exit` absent) and "two candidates still standing after the choice presses nothing and fails AGE_CONFIRMATION_REQUIRED" (code, neither confirm beacon, master never requested) ✓ |
| The shadow-root gate is recognised                                                                                              | same file › "a gate whose layer lives in an open shadow root is recognised" and "…told to confirm, yields its stream" ✓                                                                                                                                                                                                                                                                      |
| Every step-5 negative fixture is recognised as no gate                                                                          | `resolvers/test/browser/provoke.test.ts` › "…is no gate" (5 rows) with the positive control "recognises the Italian gate in a fixed layer" ✓ — **proven as written; the adjacent shapes are recognised, see the first high**                                                                                                                                                                 |
| The element pressed is the element recognised: an `AGE_GATE_TEXT` decoy earlier in the DOM, outside the overlay, is not clicked | `browser-resolver.test.ts` › "presses the control it recognised, not an AGE_GATE_TEXT decoy earlier in the DOM" (stream, `age-confirmed` present, `age-decoy` absent) ✓; red under four mutations, below                                                                                                                                                                                     |
| dl-48's existing age-gate tests pass unchanged                                                                                  | **verified** — test diff has 0 deletions in `browser-resolver.test.ts` and `provoke.test.ts`, one changed line in `capture-rules.test.ts` (the import widened); the 3 spec files run 201 of 201, of which 135 are not dl-83's                                                                                                                                                                |
| A fresh config still has `enableAgeConfirmation: false`                                                                         | `api/test/config.test.ts` › "is off in an empty environment" ✓ (pre-existing; the branch does not touch it)                                                                                                                                                                                                                                                                                  |
| `npm run check` and `npm test -- --project downloader` pass                                                                     | **verified** — `npm run check` exit 0; `npm test -- --project downloader` 97 files passed, 1 skipped; 1655 tests passed, 2 skipped (1657). CI on this head: all 11 checks pass, e2e (direct), e2e (sniffer) and the informational Windows leg included                                                                                                                                       |

**Method.** Real pages served to the real `BrowserResolver` (quiet 1200 ms, one pooled Chromium), once with `src/` at `25e97db` and once with `src/` at `056aab7` (a copy of base `resolvers/src` beside a symlinked `node_modules`). Base here is all of `resolvers/src`, not `provoke.ts` alone: head's `resolvers/browser.ts` reads `ageGatePressable`, which base's `provoke.ts` never returns, so the two files together would not be base's behaviour; 78 + 16 + 6 + 16 jobs each. Positive control for the harness: the branch's own Italian gate gives `ageGate=false`, `NO_MEDIA_FOUND` off and on at base, and `ageGate=true`, `AGE_CONFIRMATION_REQUIRED` off, stream with the entry pressed on, at head — so the harness sees recognition, a press and an outcome, and tells base from head. Pages are page-shaped, written for this gate; they are not captured from real sites.

- **high** · no `Done when` line depends on it, but the owner's decision does ("the press stays strict") · **A lone false candidate is pressed, and with `enableAgeConfirmation` on that loses pages that resolved at base.** Recognition is broad and the press chooses among recognition's candidates, so one false candidate is a false press: the brief's premise (the owner's decision) that a false recognition is "a wrong message, nothing clicked" holds only with the setting off. The Log lists this as a known limit ("a press with it on, if alone") and measures neither what the press does nor what it costs. Confirmation on, a stream available on every page (a fixture requests it on load, as `mse.html` does), `NO_MEDIA_FOUND` with `reason: navigated-away` at head wherever the press was a link or a route change:

  | page shape                                                                                               | recognised at head | pressed at head | base             | head                                                 |
  | -------------------------------------------------------------------------------------------------------- | ------------------ | --------------- | ---------------- | ---------------------------------------------------- |
  | `position: fixed` app shell, nav `<a href>18+`, text "Updated 18 minutes ago"                            | yes                | the nav link    | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | `position: absolute` shell, nav `<button>18+` doing `pushState`                                          | yes                | the button      | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | the same shell, `<a>21 Savage</a>` and "21 Savage - top tracks"                                          | yes                | the link        | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | full-viewport promo, "orders over 18 euros", `<a>Over 18? Buy now</a>`                                   | yes                | the link        | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | `role=dialog` card, same text and link                                                                   | yes                | the link        | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | `role=dialog` pricing, "Try Pro free for 21 days", `<a>Start 21-day trial</a>`                           | yes                | the link        | stream           | `NO_MEDIA_FOUND` (navigated-away)                    |
  | cookie `role=dialog` sheet, "our 18 partners", `<button>View our 18 partners</button>`, play is a click  | yes                | the button      | stream           | `NO_MEDIA_FOUND` (with a closable or a sticky panel) |
  | the same shell with a `<button>18+</button>` that opens a menu, play is a click                          | yes                | the button      | stream           | `NO_MEDIA_FOUND`                                     |
  | pricing "Save 18%", bottom 80 px shop banner "Over 18? Buy now", plain "21 Savage" page, `<select>` ages | no                 | —               | stream           | stream                                               |
  | sign-up chips "Under 18 / 18-24 / 25+" under "You must be 18 or older"                                   | yes                | nothing         | `NO_MEDIA_FOUND` | `AGE_CONFIRMATION_REQUIRED`, on or off               |
  | sign-up custom `<button>Age: 18</button>`                                                                | yes                | the button      | stream           | stream                                               |

  Confirmation off, none of the stream pages differ (the press never happens), and every recognised one reports `AGE_CONFIRMATION_REQUIRED` where base said `NO_MEDIA_FOUND` once nothing plays. Cookie dialogs whose label `dismissConsent` knows are dismissed first and never reach the press (`Accept all` fixture: only `accept` fired); one whose label it does not know ("Accept All Cookies", "Allow all cookies") is the shape above. Reproduce: serve the first row's HTML — `<div style="position:fixed;inset:0"><header><a href="/other.html">18+</a></header><main><span>Updated 18 minutes ago</span><div id="player"></div></main></div>` with the stream requested on load — and probe it with `confirmAge: true` at both shas.

  **Open decision, options.** (A) Narrow the press: never press a link that would leave the document (top frame; a different path or a query beyond the guard's own play-time keys). The guard already turns such a press into `NO_MEDIA_FOUND` whether or not the stream was found, so no press that could have worked is lost; a link in a same-origin frame is untouched. Dry-run in a scratch copy of head (about 6 lines in `AGE_CHOOSE_FN`'s `offsite`): removes 5 of the 6 `navigated-away` rows (the `pushState` button remains), leaves every branch fixture and the dl-48 fixture as they were (8 gate shapes with confirmation on, 2 off), and leaves the button rows. (B) Add dl-48's "covers something" test to a positioned layer. Dry-run, run with A applied (A cannot change recognition): the four app-shell rows are no longer recognised and the 5 negatives stay negative, **but a real Italian gate over a page with nothing under the viewport centre is no longer recognised** (head: `AGE_CONFIRMATION_REQUIRED` off, stream on; with B: `NO_MEDIA_FOUND` both) — a recall loss, so not B alone. (C) Press a structural candidate only on a closed attestation phrase per language: back to the list the ticket wanted gone; not run. (D) Accept as built and record the surface in the ticket; opt-in only. Recommendation: A, then ask the owner whether the button residue (a consent "View our 18 partners", a menu button, `Age: 18`) is acceptable or wants C. dl-82 (#370) changes the consent step that runs before the press in `provokeFrame` and adds `Accept All Cookies` to its list; from its diff it would dismiss the sheet in the cookie rows whose accept label it lists, before the press runs, and no other row. The two branches were not run together, so that is unmeasured.

- **high** · the brief's step 2 says "nothing dl-48 recognises is lost", and this loses a page dl-48 pressed · **The layered-over-unlayered rule picks a cookie dialog's button over the real gate.** A page with a dl-48 inline gate (`<p>This channel is for adults only.</p>` and an unpositioned `<button>I am 18 or older</button>`) and a cookie `role=dialog` sheet ("Our 18 partners", `<button>View our 18 partners</button>`, an accept label `dismissConsent` does not know) resolves at base (`age-confirmed` pressed, stream). At head the sheet's button is the only layered candidate, so the gate is dropped by the rule the Log calls "a third rule, first", and `View our 18 partners` is pressed: `NO_MEDIA_FOUND`, `age-confirmed` never fired. Confirmation off is unchanged (`AGE_CONFIRMATION_REQUIRED` at both). The rule's reason ("a layer intercepts the pointer") holds for a layer that covers the viewport and not for a sheet that covers about 16 percent of it (120 px of the resolver's 768). Dry-run of the narrow fix, only counting a layer at `AGE_LAYER_MIN_COVER` as blocking for this rule: the wrong press stops, the decoy and Italian gates still resolve, and the probe then presses nothing (`AGE_CONFIRMATION_REQUIRED`) because two unlayered candidates stand — so it is not sufficient alone. **Open decision:** pair it with the first high's remedy so the sheet's button is not a candidate, or prefer a legacy (label plus page-marker) candidate over a structural one whose layer is not blocking (not run). Same root as the first high; separate reproduction.

- **med** · no `Done when` line depends on it, and the fix must keep the decoy line green (the decoy test fails without the rule: `onepress` mutation, below) · **One press per document is never retried, and a same-document route change is not a new document.** `__downloaderAgePressed` is set on `window` when a click lands, and `window` survives a hash or `pushState` change. Measured, confirmation on, base against head:

  | page                                                                                           | base                                                     | head                                       |
  | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
  | gate whose click handler is attached 1500 ms (then 3000, 5000) after load, as before hydration | stream, 2, 4 and 6 early clicks before the one that took | `NO_MEDIA_FOUND`, one click, never retried |
  | gate, entry changes `location.hash` and shows a second gate in the same document (`#/watch`)   | stream, both pressed                                     | `NO_MEDIA_FOUND`, only the first pressed   |
  | handler attached at once (delay 0)                                                             | stream                                                   | stream                                     |

  A full navigation does reset it: a same-origin frame whose entry navigates the frame to a second gate had both gates pressed at head (`step1`, `step2`), so the `AGE_PRESSED_SCRIPT` race is not live. Two documents (parent and same-origin frame) each press their own gate: `age-main`, `age-frame`. Options: record the press per element and stop pressing once a stream has been captured, which keeps the decoy line (it is the decoy pressed after the layer's entry worked that the rule exists for); or retry while the same layer is still showing, up to a small bound.

- **low** · no live call site beyond opt-in · **A structural candidate is recognised in a same-origin `about:srcdoc` ad frame with no page marker.** A 300x250 srcdoc iframe holding `position:absolute; inset:0` with "Hot singles near you, 18+ only" and `<a>Enter 18+</a>`: head pressed it (the frame requested the link's target), base did not. The stream still resolves; the press was made on the user's behalf in an ad.

- **low** · contrived · **A lost mark costs the pass.** A page that re-renders the node when the foreign attribute `data-downloader-age` is set (a `MutationObserver` replacing the button) left no stale mark and no error (three mark-and-replace cycles, each bounded by the 2000 ms click timeout in `confirmAgeGate`; the elapsed time was not measured), and the page resolved at base and not at head. Real frameworks do not re-render on a foreign attribute; recorded because the item asked.

- **low** · `nfr:performance` · The candidate walk climbs every control's ancestors before it tests the label (`layerOf` runs before `age.test(name)`), so `readSignals` at head costs 35 ms for 3000 links nested 10 deep, 108 ms at depth 40 and 502 ms for 10000 links at depth 40, against 10, 8 and 23 ms at base. It runs once per frame per pass and per revisit with confirmation on, and once more at the end of every failed probe. Testing the label first removes the walk for nearly every control.

- **low** · `nfr:maintainability` · The negation tokeniser is restated in `capture-rules.test.ts` (`negated`) and the 34 entry and exit labels run against that copy, not the in-page `AGE_CHOOSE_FN`. Only the one end-to-end row ("a same-origin exit button") exercises the shipped tokeniser, so a drift between the two reads green.

- **low** · unmeasured, from reading `classifyFailure` · A structural false recognition now outranks `GEO_BLOCKED`, `UNREACHABLE` (status 4xx/5xx) and `TIMEOUT`, which are classified after `AGE_CONFIRMATION_REQUIRED`; at base the gate was rare enough that the order cost nothing.

- **dropped** · the contract copy for `AGE_CONFIRMATION_REQUIRED` says "this server is not set to confirm it", false for a declined press with the setting on. Out of scope by the dispatch (the ticket forbids touching it and it is with the owner); the Log names it.
- **dropped** · a page with two `AGE_GATE_TEXT` controls (an inline entry button and a header link, both "I am 18 or older") resolves at base (first match pressed) and gives `AGE_CONFIRMATION_REQUIRED` at head. The ticket decides it ("otherwise press nothing"); recorded as the one by-design base-to-head change in the on state.
- **findings** · the hunt returned 10; 8 carried (2 high, 1 med, 5 low), 2 dropped.
- **`ageGatePressable`** · confirmation off, the dl-48 gate ends in `AGE_CONFIRMATION_REQUIRED` at both shas, and at head so do the Italian, shadow, sparse and two-candidate gates (base did not recognise them: `NO_MEDIA_FOUND`); confirmation on with the press declined (two candidates, a lone exit) is `AGE_CONFIRMATION_REQUIRED`; a landed press that did not start the player is `NO_MEDIA_FOUND`, as at base. No path was found that gives `NO_MEDIA_FOUND` where base gave `AGE_CONFIRMATION_REQUIRED`: head recognises a superset, and with the setting on base never gave the code. The reverse (`AGE_CONFIRMATION_REQUIRED` where base gave `NO_MEDIA_FOUND`) is every new recognition, and the two declined presses above, by design.
- **Mutations** (each in the worktree, then restored; `-t dl-83` on the three spec files, 66 tests at head, all green before): the negation check removed → 1 red, "a same-origin exit button with a script handler presses the entry and never the exit"; `AGE_LAYER_MIN_COVER` coverage test removed (`return true`) → 2 red, the nav-bar negative in `provoke.test.ts` and the decoy; layered-over-unlayered removed → 1 red, the decoy; one press per document removed → 1 red, the decoy; the second text search restored in `confirmAgeGate` → 6 red; head's tests against base `src/` → 61 of 66 red (the 5 negatives pass at base, as the Log says). Worktree clean and at `25e97db` after each.
- Invariants walked: contract untouched, no cross-tool import, no new `AppError` code, no shell, no new log line, no new workspace dependency, no new test package (new cases are in registered files), style (`import type`, no `any`, no `console`). Skipped: SSRF and redaction (nothing fetched or logged), Dockerfile closure.
- NFR: security — the press, first high · performance — above · reliability — second high and the med · maintainability — above.

### Gate 2

**Gate: FAIL** — 2026-10-06 · `25e97db..22bc21e` · Sonnet 5.5, depth full

Gate 2 raises one high, so a third gate runs. It is in the lines this round added: the same-origin half of the `leaves` rule. The owner's remedy for gate 1's first high rests on a premise this round measured false, and the premise is gate 1's own: its remedy A said "no press that could have worked is lost", and gate 1 dry-ran A only against the false pages and the branch's button fixtures, never against a gate built as a link.

**Method.** Same harness as gate 1: real pages served to the real `BrowserResolver` (quiet 1200 ms, confirmation on unless stated), once with `src/` at `22bc21e`, once at `25e97db` and once at `056aab7` (a copy beside a symlinked `node_modules`). Positive control: the pages that are supposed to change do change (5 pages × 3 rows and the inline-gate row, below), so the harness sees a press, a decline and an outcome at each sha. Pages are page-shaped and written for this gate.

| Gate 1 finding                                                            | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| high 1, a lone false candidate is pressed                                 | **fixed for the five leaving-link rows**: `mode=stream` gives the stream with nothing pressed on all five (shell `18+` link, shell `21 Savage` link, full-viewport promo link, dialog card link, pricing `21-day trial` link), `mode=none` gives `AGE_CONFIRMATION_REQUIRED`, signals `pressable=false`. The four button rows the owner accepted are unchanged from `25e97db` (pressed as before). **The fix is a new high, below.** |
| high 2, the layered rule picks a cookie button over the gate              | **fixed**: dl-48's inline gate beside the cookie sheet gives the stream with `age-confirmed` pressed and `view-partners` never (was `NO_MEDIA_FOUND`). `tiebreak` and `blocking_any` mutations each turn exactly that test red. **The tie-break has a reach of its own, below.**                                                                                                                                                     |
| med, one press per document                                               | not fixed, by decision. The hydrate rows (1500, 3000, 5000 ms) and the hash-route row are identical to `25e97db` in the rerun.                                                                                                                                                                                                                                                                                                       |
| low, label tested after the ancestor walk                                 | **fixed**: `readSignals` median 4, 14, 15 and 28 ms for 200, 3000, 3000 (deep) and 10000 links, against 7, 35, 108 and 502 at `25e97db` and 4, 10, 8 and 23 at base. The builder's 5, 10, 10 and 28 are within noise. The pages carry no age number, so the saving is the common case; a page whose every control names 18 or 21 still walks.                                                                                        |
| low, srcdoc ad frame; lost mark; tokeniser restated; classification order | not touched, as the Log says; the ad-frame and lost-mark rows are identical to `25e97db`.                                                                                                                                                                                                                                                                                                                                            |

**What I ran.** `npx vitest run` on the three spec files with `-t dl-83`: 83 passed, 135 skipped (218), against 66 passed at `25e97db`, so 17 new, as claimed. `npm run build` exit 0, `npm run check` exit 0, `npm test -- --project downloader`: 97 files passed, 1 skipped; 1672 tests passed, 2 skipped (1674), against 1655 at `25e97db`. `gh pr checks 374`, read once, head `22bc21e`: all 11 checks pass (check ×2, test ubuntu, test windows informational, e2e direct, e2e sniffer, docker, CodeQL ×2, dependency-review, changes). The worktree was clean and at `22bc21e` after every mutation.

**The 119-row rerun** (gate 1's four jobs files and the sparse-gate file, at `22bc21e`) against my `25e97db` rows: 16 rows differ, and they are exactly the builder's list: the five leaving-link pages, three rows each (`mode=stream` now the stream, `mode=none` now `AGE_CONFIRMATION_REQUIRED`, signals `pressable=false`), and `inline-gate-plus-cookie` now the stream with `age-confirmed`. Nothing else differs, hydrate and hash-route included. Not rerun: base (its source is untouched; the builder's base run is unverified by me and my gate 1 base rows stand).

**New tests, positive controls.** Each new rule, disabled alone, in the worktree and then restored (`-t dl-83`, 83 tests):

| disabled                                                 | red                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| the same-origin half of `leaves`                         | 5: the five "never presses … which would leave the document" tests                                    |
| the cross-origin half of `leaves`                        | 1: "an off-site exit in a language with no negation list presses the entry and never the exit"        |
| the tie-break (a dl-48 candidate beats a structural one) | 1: "dl-48's inline gate beside a cookie sheet presses the gate, never the sheet's 18 partners button" |
| `blocking` counting any layer again                      | 1: the same test                                                                                      |
| `25e97db`'s `src/` under the new tests                   | 6 of 17: the five links and the inline gate, as claimed                                               |

- **high** · no `Done when` line depends on it, but the brief's step 2 says "nothing dl-48 recognises is lost", and the premise of the owner's choice is false · **A real gate built as a link is no longer pressed, and base streamed it.** The new same-origin half of `leaves` drops any `<a href>` whose target is another path or query. The comment says the departure guard turns such a press into `NO_MEDIA_FOUND`, so nothing that could have worked is lost. That holds only when the click navigates the page. Four shapes do not, measured with confirmation on, a full-viewport gate carrying the `AGE_GATE_TEXT` label "I am 18 or older" and an `adults only` marker (the dl-48 shape):

  | gate                                                                                                        | base   | `25e97db` | `22bc21e`                                |
  | ----------------------------------------------------------------------------------------------------------- | ------ | --------- | ---------------------------------------- |
  | `<a href="/enter">` whose handler calls `preventDefault()` and shows the player                             | stream | stream    | `AGE_CONFIRMATION_REQUIRED`, not pressed |
  | `<a href="/enter-redirect?next=<landing>">`, the server sets a cookie and redirects back to the landing URL | stream | stream    | `AGE_CONFIRMATION_REQUIRED`, not pressed |
  | `<a href="/dest/enter.html" target="_blank">` whose handler shows the player                                | stream | stream    | `AGE_CONFIRMATION_REQUIRED`, not pressed |
  | `<a href="?t=5">` (a key the guard ignores), cookie set, page reloads into the player                       | stream | stream    | `AGE_CONFIRMATION_REQUIRED`, not pressed |

  The redirect-back row is the common server-side gate: the guard saw no departure (base streamed, with the redirect route requested). The `target=_blank` row opens a tab, and the guard watches only the original page's top frame. The `?t=5` row is a query the guard's own play-time exception ignores and `leaves` does not (gate 1's remedy A named "a query beyond the guard's own play-time keys"). The same four with the ticket's Italian label and no marker (structural only) streamed at `25e97db` and are declined now; base did not recognise them, so for that family it is a regression against the previous head and not against base. Passing: `href="#enter"`, `href="javascript:void(0)"`, `href=""`, `href="?"` (landing without a query), a relative href resolving to the same path — all stream at all three shas. A link whose click is never cancelled and leaves, and `href="?"` under a landing URL that has a query, depart at base too (`NO_MEDIA_FOUND`, navigated-away) and are declined now: not a regression, and the new code is the better one.

  None of the 17 new tests covers a pressable link: they only assert that five leaving links are not pressed, so an over-broad rule keeps them green (the same-origin half off turns exactly those five red, and nothing turns red when the rule drops too much).

  **Open decision, options.** (A) Exempt dl-48's candidates from the same-origin half and keep the cross-origin half for all, as at base; honour the guard's play-time keys for the rest. Dry-run in a scratch copy of `22bc21e` (four edits in `AGE_CHOOSE_FN`, the fourth the reordering described under the low below): the four rows above return to base (stream); the five false structural rows from gate 1 stay fixed; `inline-gate-plus-cookie` stays the stream; of 52 resolve rows, 7 differ from `22bc21e`: the four above, two legacy leaving links that now depart as at base (`NO_MEDIA_FOUND`, navigated-away), and the footer-decoy page below, which now departs as at base. Structural-only link gates with a handler, a redirect or `_blank` stay unpressed (they never worked at base). (B) Revert the same-origin half to `25e97db`'s behaviour: every link gate presses and the five false rows regress. (C) Keep as built, knowing the premise is false for four shapes. Recommendation: A, and tell the owner that the structural family (Italian label as a link) is the cost.

- **low** · no live call site beyond the decoy page; an owner-decided trade · **The tie-break lets a dl-48 decoy beat a structural gate in a non-blocking layer.** An English bottom sheet (`role=dialog`, 120 px, "adults only", `<button>I am 18 or older - Enter</button>`) with a footer `<a href="#top">I am 18 or older</a>`; the same in Italian ("Vietato ai minori", `Ho 18 anni o più - Entra`, a footer `Ho 18 anni` link); and the Italian card dialog with no backdrop and a header `Ho 18 anni` link (the case the Log names as falling short of coverage). At `25e97db` each streamed with `age-confirmed` pressed; at head the decoy is pressed once and nothing plays (`footer-decoy`, `NO_MEDIA_FOUND`). Base failed all three (it pressed the decoy six times), so this is a regression against the previous head only. A second shape: the decoy is a same-origin link that leaves. The tie-break drops the real structural gate first, `leaves` then drops the decoy, and nothing is pressed (`AGE_CONFIRMATION_REQUIRED`, `pressable=false`); `25e97db` streamed it. Applying the negation and leaving filters before the blocking and legacy preferences would keep the gate there; that reordering alone was not run. Option A's dry-run included it, and the decoy page there is pressed and departs as at base, because A exempts the legacy decoy from the same-origin half.

- **low** · no regression, equal at all three shas · **A link in a same-origin frame is pressable "because it navigates only the frame", and not when it has `target="_top"`.** A same-origin frame holding `<a href="/dest/entered.html" target="_top">I am 18 or older</a>` is pressed at base, `25e97db` and `22bc21e`, and the top document departs (`NO_MEDIA_FOUND`, navigated-away). The comment's claim is false for `_top` and `_parent`.

- **dropped** · a gate in a cross-origin frame: nothing pressed at any sha (`isScriptableFrame` is untouched by the diff).
- **dropped** · a link never cancelled and `href="?"` under a landing query: declined now, `NO_MEDIA_FOUND` (navigated-away) at base and `25e97db`; not a regression.
- **findings** · the hunt returned 5; 3 carried (1 high, 2 low), 2 dropped.

**dl-94 stands alone.** The ticket has the frontmatter fields the format asks for, `depends_on: [dl-83]`, a Why, a Build, a Done when and a Log. `npm run status -- --show dl-94` reads it (ready, "blocked by dl-83 (ready)", difficulty standard) and `npm run status -- --json` exits 0. Its id is free: main's newest downloader ticket is dl-84, the open pull requests add dl-90, dl-91 and dl-92, and dl-94 appears only on this branch. Its reproduction holds at `22bc21e`: a probe with `confirmAge: true` against `age-gate-overlay.html?second` fails `AGE_CONFIRMATION_REQUIRED` with the message "This video asks the viewer to confirm their age, and this server is not set to confirm it." (read from the error at `22bc21e`, and the same message with the setting off), which is the contract text the ticket quotes. The three places it names exist: the contract message, its docstring and the web detail; the mocked `scenarios.ts` carries only the code, and no test pins the old wording (the only match outside those is a comment in `browser-resolver.test.ts`). The ticket asks the next agent to record the message and does not record it itself; the message above is that record. Nothing to carry.

- NFR: security — the new high is the press, as before · performance — fixed, above · reliability — the new high · maintainability — the same-origin half of `leaves` is a rule with no test that it presses what it should.

### Gate 3

**Gate: CONCERNS** — 2026-10-06 · `22bc21e..2cac790` · Sonnet 5.5, depth full

**No high.** Nothing this round added loses a page that resolved at base. Every row where head differs from base in the on state is a row where base also failed, or where head is better. The CONCERNS is the round-1 med, which stands unfixed by decision, and four lows. CI has not run on this head: see the last bullet.

| Gate 2 finding                                               | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| high, the same-origin half of `leaves` drops real link gates | **fixed**: the four dl-48 link gates are back to base. Script-cancelled link, cookie-and-redirect-back link, `target="_blank"` link and `?t=5` link each give the stream with the entry pressed (22bc21e declined all four). Gate 1's five false structural rows stay fixed, and the structural twins are declined as the owner accepted, except `?t=5`, which streams. Exemption off turns three of the four link tests red, plus the leaving-decoy pin. |
| low, the tie-break lets a dl-48 decoy beat a structural gate | **applied as asked, reach unchanged**: filters now run before preferences. The three `#top` decoy pages (English sheet, Italian sheet, Italian card) are identical to 22bc21e (decoy pressed once, nothing plays) and pinned so. The leaving decoy is now pressed and departs as at base (22bc21e declined).                                                                                                                                              |
| low, the `target="_top"` frame comment                       | **fixed**: the comment no longer says a same-origin frame's link navigates only the frame. Behaviour is unchanged and equal to base (the frame-top row is identical in the rerun).                                                                                                                                                                                                                                                                        |
| med (round 1), one press per document                        | **not fixed**, by decision. The hydrate and hash-route rows are identical to 22bc21e.                                                                                                                                                                                                                                                                                                                                                                     |

**The `ln-ptk-S` question: I agree with the builder.** Gate 2's option (A) said to honour the guard's play-time keys, and its dry-run did not implement that half. Pinning `ln-ptk-S` as pressed is the correct reading. It has a consequence for item 3 below.

**What I ran.** `npx vitest run` on the three spec files with `-t dl-83`: 96 passed, 135 skipped (231), against 83 at 22bc21e, so 13 new, as claimed. `npm run build` exit 0, `npm run check` exit 0, `npm test -- --project downloader`: 97 files passed, 1 skipped; 1685 tests passed, 2 skipped (1687), against 1672 at 22bc21e. The guard's own tests (`-t dl-55`): 17 passed. The worktree was clean and at `2cac790` after every mutation. `22bc21e`'s `src/` under the 13 new tests: 6 of 13 red (the four dl-48 link gates, `ln-ptk-S`, the leaving decoy), as claimed.

**The matrix, rerun at `2cac790`.** The builder's 225 rows are 119 plus `jobs5`, `jobs6` and `jobs7`, which repeat each other; I ran the 190 distinct keys at head and compared them with my 22bc21e rows (gate 2's runs, and a rerun of `jobs6` at 22bc21e this round) and with base, plus 23 rows of my own. Every row the builder lists differs from 22bc21e exactly as it says (nine distinct rows, `ln-prevent-L`, `ln-redirect-L`, `ln-blank-L`, `ln-ptk-L`, `ln-ptk-S`, `ln-leave-L`, `ln-qmark-L?v=1`, and `tb-sheet-leaving-decoy` resolve and signals), and no other row of the 190 differs in outcome. One row differs in a count: `rerender-on-mark` showed four mark cycles in one run against three at 22bc21e, same outcome; three repeat runs at head and at 22bc21e each gave three cycles, so it is timing noise, and the Log's "no row of round 1's 119 differs" is true in outcome.

- **item 2 · low · accepted by the owner's (A), unpinned** · **The dl-48 exemption's reach, against base and against 22bc21e.** A dl-48 label ("I am 18 or older" with a marker on the page) is pressed again when its link goes to another path on this origin. Confirmation on, base | 22bc21e | head:

  | page                                                                                                           | base                                                                       | 22bc21e                     | head                                                                |
  | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
  | no gate; the page streams on its own; footer `<a href="/terms">I am 18 or older</a>` and an `adults only` line | `NO_MEDIA_FOUND`, navigated-away (the link pressed)                        | stream (not pressed)        | `NO_MEDIA_FOUND`, navigated-away (the link pressed)                 |
  | the same link to another origin                                                                                | `NO_MEDIA_FOUND`, navigated-away                                           | stream                      | stream (the cross-origin half applies to every candidate)           |
  | a full-viewport Italian structural gate and the footer link to `/terms`                                        | `NO_MEDIA_FOUND`, nothing pressed (the overlay intercepts the footer link) | stream, entry pressed       | stream, entry pressed (the blocking preference picks the entry)     |
  | a dl-48 inline gate button and the footer link, both "I am 18 or older"                                        | `NO_MEDIA_FOUND`, navigated-away (button pressed, then the link)           | stream                      | `AGE_CONFIRMATION_REQUIRED`, nothing pressed (two candidates stand) |
  | the same, the footer link to `#terms-section`                                                                  | stream                                                                     | `AGE_CONFIRMATION_REQUIRED` | `AGE_CONFIRMATION_REQUIRED`                                         |
  | non-blocking sheet gate and a footer decoy to another path (the builder's pinned page)                         | `NO_MEDIA_FOUND`, navigated-away                                           | `AGE_CONFIRMATION_REQUIRED` | `NO_MEDIA_FOUND`, navigated-away, decoy pressed                     |

  So the exemption brings back two base behaviours that cost a page: a footer link carrying a dl-48 label is pressed on a page that needs no gate, and on a non-blocking sheet gate the decoy is pressed. Both lose the page at base too, so neither is a regression against base. Against 22bc21e the first row is a loss. The fourth row is a loss against 22bc21e and a change of failure against base (base pressed the button and then the link, and departed). The fifth row (the hash link) shows the two-candidate decline is the round-1 decision and not this round's. No test pins the first, second and fourth rows. Unmeasured option, offered as a direction and not as a prototype: press nothing once the tier has already captured a stream, which would clear the first row (the autoplay stream is requested at load, before any press).

- **low** · the owner's accepted cost has a second effect · **When the real structural gate is a link the filters drop, a dl-48 decoy elsewhere is pressed instead of nothing.** An Italian full-viewport gate whose entry is `<a href="/enter">Ho 18 anni o più - Entra</a>` (script-cancelled) and a header `I am 18 or older` button with an `adults only` line: base presses the decoy six times and nothing plays; 22bc21e presses nothing (`AGE_CONFIRMATION_REQUIRED`); head presses the decoy once (`NO_MEDIA_FOUND`). With a button entry the same page streams at 22bc21e and at head, so the Done-when decoy line holds for the shape it names; it does not hold for this one. Equal or better than base, worse than 22bc21e.

- **item 3 · low · no outcome lost in the five shapes measured** · **The play-time widening presses structural false candidates.** A false structural candidate whose link differs from the page only in `t`, `start` or `autoplay` was declined at 22bc21e and is now pressed. Fixed shell with "Updated 18 minutes ago" and `<a href="?t=1080">Jump to 18 min</a>`; the same with `<a href="?autoplay=1">Autoplay 21+ clips</a>` and "21 comments"; a `role=dialog` "You watched 21 minutes" with `<a href="?start=1260">Resume at 21 min</a>`. Base did not recognise any of them. At head each is pressed once and the stream is still found. With play as a click, the shape with a reloading link and the one with a script that seeks both still stream; the reloading one counts two page loads and one press (no loop), the press landing before the play click. The same link with another key riding along (`?t=1080&v=2`) is not pressed. So the widening is a false press that did no harm here, on pages that restart cleanly; a page whose reload loses the player was not measured.

- **low** · `nfr:maintainability` · **Two of the round's rules are pinned by no test.** Reverting the filters to run after the preferences turns nothing red (96 of 96), and neither does letting a dl-48 candidate through the cross-origin half. Both change outcomes: with a non-blocking sheet gate and a footer decoy that goes to another origin, base departs, 22bc21e declined and head streams; with the footer link to another origin and no gate, base departs and head streams. The other two new rules are pinned: the exemption off turns 4 red (the three link gates and the leaving decoy) and the play-time keys off turns 1 red (`ln-ptk-S`).

**The `PLAY_TIME_QUERY_KEYS` move.** Consumers: the guard's set in `resolvers/browser.ts` (one use, in the same-document comparison) and `AGE_CHOOSE_FN` in `provoke.ts` (the keys serialised into the page script); nothing else in `tools/` or `packages/` reads it, and `provoke.ts` imports nothing from the resolver, so there is no cycle. The diff of `resolvers/browser.ts` is six changed lines: the import, the comment, and the set built from the array. The values and the iteration order are the old literal's (`["t","start","autoplay"]`, compared at run time against the literal at 22bc21e). The guard's existing tests pass (17 of 17, `-t dl-55`), and emptying the constant at its one definition turns three of them red (`?t=`, `?start=`, `?autoplay=` "is not a departure"), so the guard really does read from it. The guard's behaviour is unchanged.

- **dropped** · `ln-ptk-S` now streaming as a finding: I agree with the pin (above), not a defect.
- **dropped** · the `rerender-on-mark` count (four cycles once, three in the repeats), timing noise.
- **findings** · the hunt returned 6; 4 carried (all low), 2 dropped. No high and no new med.
- **CI** · `gh pr checks 374`, read once: no checks reported for head `2cac79002d4f9ce7140fd057f6e620fa5a1b63b9`, and `mergeStateStatus` is `DIRTY`. The branch conflicts with `origin/main` (the dl-78 merge, in `capture-rules.test.ts`, as the dispatch said); a conflicting pull request does not start the pull-request workflows, which I infer is why none has run. **Unproven (gate)** for this head: the e2e (direct), e2e (sniffer), docker, CodeQL and Windows legs. They were green at `22bc21e`, and this round touches `resolvers/src` and one test helper. Locally: `npm run check` exit 0 and the downloader project 1685 of 1687 (2 skipped) above. The rebase will need a re-read of `gh pr checks 374` on the rebased head.
- NFR: security — the press, lows above · performance — n/a this round (no new walk) · reliability — the lows above · maintainability — the two unpinned rules.

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
