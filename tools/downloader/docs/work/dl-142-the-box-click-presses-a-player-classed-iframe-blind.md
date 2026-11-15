---
id: dl-142
tool: downloader
title: The box click presses a player-classed `<iframe>` blind, against its own comment and the owner's 2026-10-07 decision
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-142 — The box click presses a player-classed `<iframe>` blind

## Why

Found by dl-139's first gate (Opus 5.5), attack 4, on 2026-11-15, and filed on the
owner's answer at the orchestrator's checkpoint the same day (options: file; fold
into dl-139; correct the comment only. Answer: file). dl-139 is PR #802 and is
not merged at the time of writing. The defect is on `main`: the gate's diff of
dl-139 against `e7d791d6` has no hunk in `MARK_PLAYER_BOX_SCRIPT` or
`clickPlayerBox`.

**The rule it breaks.** dl-81's box click (`clickPlayerBox`, `MARK_PLAYER_BOX_SCRIPT`
in `tools/downloader/resolvers/src/browser/provoke.ts`) is documented as
choosing among "the ones `SCROLL_SCRIPT` scrolls to, minus `<video>` and **minus
`<iframe>`**", and says why: "A frame is never clicked blind: its content is
another document the checks below cannot see into, and a click there pressed an
advertiser's link, or a full-viewport interstitial (the gate's reproductions,
owner's decision 1, 2026-10-07)". The decision is dl-81's open decision 1 (gate 1:
A, "never box-click an `<iframe>`"; B, drop the box click; C, keep it and correct
the docstring), which the owner took at dl-81's round 2 ("Decided by the owner,
2026-10-07, each the gate's recommendation"); round 2's fix list records that
`MARK_PLAYER_BOX_SCRIPT` "no longer lists `<iframe>`". `clickPlayerBox`'s own
comment repeats it ("never an `<iframe>` itself").
dl-139's Build repeats it as a Trap ("`MARK_PLAYER_BOX_SCRIPT` deliberately
excludes iframes").

**What the code does.** The candidate selector is
`[class*="player"], [id*="player"]`, passed through `ALL_MEDIA_FN`, and nothing
in it or in the filter that follows excludes `<iframe>`. An `<iframe class="player-frame">`
that is the largest candidate is marked, and the click, which goes through the
locator API with `force: true`, lands inside the frame.

### The reproduction

The gate's `provoke-probe.mts` (on dl-139's branch, which has a function the
script reads from `provoke.ts` that `main` lacks) ran the real `provokePlayback`
with `hasPlayable: () => false` on local pages; each page's frame is served from
the same origin and records a beacon at `/inner-click` when anything inside it is
clicked. It was run again for this filing as a trimmed script on `main` at
`e7d791d6` (built, Playwright Chromium), the three `m4-` pages only. The page
records the box that `MARK_PLAYER_BOX_SCRIPT` marked (`data-downloader-box`) and
every click it sees:

```
bare-player-frame: box marked ["/mark/data-downloader-box?tag=IFRAME&id=pf"], clicks ["/inner-click"]
wrapped-player-frame: box marked ["/mark/data-downloader-box?tag=DIV&id="], clicks ["/click?tag=DIV&id="]
control-plain-frame: box marked [], clicks []
```

- **Bare:** `<iframe id="pf" class="player-frame" src="/inner" width="640" height="360" style="border:0">`
  as the only candidate. The iframe itself is marked and the click lands in the
  frame's document. This is the defect.
- **Wrapped:** the same iframe in `<div class="player-wrap">`. The full-width
  wrapper is the larger candidate and wins; the click's target in the top document
  is the `DIV`, and nothing reaches the frame. It passes **at this viewport only**:
  the centre of the wrapper happened to miss the frame. A wrapper whose centre sits
  over the frame would have `elementFromPoint` return the iframe, which
  `within(hit, el)` accepts, and the same click would land inside it. That variant
  was not run.
- **Control:** a plain `<iframe>` with no player class is not a candidate, and
  nothing is marked or clicked.

The same script on the gate's own tree (`f4483f8e`, dl-139's head) gave identical
results for the three pages, which is the "pre-existing" reading.

## Build

1. **Reproduce first.** Add the bare-iframe page as a fixture under
   `resolvers/test/fixtures/pages/` whose frame beacons its own click, and a test
   appended at the **end** of the browser-resolver suite, not inserted in the
   middle: `provokePlayback` on the bare page must not click inside the frame (the
   beacon is never requested). Red on `main`.
2. **The fix.** Exclude `<iframe>` from `MARK_PLAYER_BOX_SCRIPT`'s candidates,
   which restores what its comment says. Leave dl-81's other rules as they are.
3. **The wrapper variant.** Decide, and record in the Log, what to do when the
   topmost element at the click point is an `<iframe>` (or is inside one) even
   though the chosen box is not one: refusing the click there closes the second
   bullet above and costs a player whose box is a wrapper entirely covered by its
   frame. Measure a wrapper whose centre sits over the frame first. If the choice
   is not obvious, record it as an open decision in the report; do not settle it
   in the Log.
4. **Do not touch the `SCROLL_SCRIPT` candidates**: it lists `iframe` on purpose,
   to scroll a frame into view. Only the box click excludes it.
5. **Check dl-139's interplay** when both are on `main`: its server-tab press
   runs before `clickPlayerBox` and treats a visible blank player iframe as the
   precondition, and its Trap says to leave this rule alone. This ticket restores
   the rule; it does not move the press.

## Done when

- A committed test with a bare player-classed `<iframe>` shows no click inside the
  frame, and is red on `main` before the change.
- The existing box-click tests (dl-81, dl-100) pass unchanged, so a player that is
  a `div` is still clicked.
- The Log says what was decided about a wrapper whose centre is over a frame, with
  the measurement.
- `npm run check` exits 0 and the downloader project passes.

## Review

**Gate: FAIL** — 2026-11-15 · `5f15e56f..d3ab6c31` · Opus 5.5, depth full

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A committed test with a bare player-classed `<iframe>` shows no click inside the frame, and is red on `main` before the change | `resolvers/test/browser/browser-resolver-player-input.test.ts` › "a player-classed iframe that is the only box is never clicked into, and the probe ends NO_MEDIA_FOUND" ✓ — `not.toContain("/beacon/inner-click")`, with `toContain("/player-box-frame-inner.html")` as the companion that fails on an unloaded frame. Red with both changed lines removed (`main`'s `MARK_PLAYER_BOX_SCRIPT`): 2 failed, 1 passed of 3 |
| The existing box-click tests (dl-81, dl-100) pass unchanged, so a `div` player is still clicked                                | `browser-resolver-player-input.test.ts` › "clicks the middle of the largest player-ish box when no <video> was clicked" and `browser-resolver-press-targets.test.ts` › "ctl=autoplay (a toggle labelled Autoplay) is pressed but does not hold back the box click" ✓ (asserts `/beacon/box-clicked`); the branch deletes no test line (numstat 54 added, 0 removed); downloader project 2668 passed, 2 skipped           |
| The Log says what was decided about a wrapper whose centre is over a frame, with the measurement                               | **verified** by reading — the Log's "Owner's answer on Build 3" and "Built Build 3" entries carry option A and `["/beacon/inner-click"]` before, none after; the gate's own probe agrees (`player-box-iframe-wrapper.html?over`: base marks the wrapper and the frame's beacon fires, head refuses)                                                                                                                      |
| `npm run check` exits 0 and the downloader project passes                                                                      | **verified** — `npm run check` exit 0; `npm test -- --project downloader` 129 files passed, 1 skipped; 2668 tests passed, 2 skipped; PR #817 all 11 checks pass at `d3ab6c31`, CodeQL included                                                                                                                                                                                                                           |

- **high** · no `Done when` line depends on it · **An `<iframe>` in an open shadow root that covers the box's centre is still clicked into.** `document.elementFromPoint` returns the shadow host, not the frame, so the `unsafe` walk in `MARK_PLAYER_BOX_SCRIPT` starts above the frame and never meets it. Measured with the real `provokePlayback` at head: a `class="player-host"` div whose shadow root holds a 640x360 iframe, and a `.player-wrap` holding an unclassed host with the same shadow iframe — both mark the box and the frame's own click beacon fires. Graded `high` as false text in the unsafe direction: the branch's new comment on `unsafe` says "a box whose centre is covered by a frame is refused too", and the docstring that the topmost element there must not sit inside an `<iframe>`; option A's own words (the topmost element at the box's centre is an `<iframe>`) hold for these pages and the click is not refused. The same retargeting hides an `a[href]` in a shadow root from the walk, which `main` already did. **Open decision:** (a, recommended) drill the hit through open shadow roots — after `var hit = …elementFromPoint(…)`, `while (hit && hit.shadowRoot) { var deeper = hit.shadowRoot.elementFromPoint(x, y); if (!deeper || deeper === hit) break; hit = deeper; }` — measured with the variant below: both pages are refused, and the resolvers' browser specs pass 797 of 797; (b) narrow both comments to light-DOM frames and file the shadow case as its own ticket.
- **low** · no `Done when` line depends on it · **`<frame>`, `<object>` and `<embed>` that hold an HTML document are clicked into**, both as the box itself (`class="player"` on each) and as what covers a `.player-wrap`'s centre: five pages (`frame`, `object` and `embed` bare, `object` and `embed` wrapped), each clicked into at base and still at head. The docstring's "A frame is never clicked blind: its content is another document" is false for them. That is the unsafe direction, but the sentence was already on `main` and the shape has no known live call site (frames and HTML-document plugins are not how a player is embedded today). The variant measured for the high closes all five: candidate filter `/^(iframe|frame|object|embed)$/i.test(box.localName)`, and `iframe, frame, object, embed` at the end of `unsafe`.
- **low** · `nfr:maintainability` · **The `IFRAME` candidate filter has no test that fails without it.** Positive control: with that line removed, the dl-142 describe still passes 3 of 3, because the `unsafe` walk then refuses a bare frame on its own. The filter's only separate effect is the one the Log gives: a large player-classed frame cannot win the choice over a smaller `div` player. The gate's page has a 860x500 frame beside a 400x240 `.video-player`. At head the div is clicked; with the filter removed, nothing is clicked. No fixture has that shape.
- **low** · no live call site · **The filter compares `tagName === 'IFRAME'`, which is lowercase in an `application/xhtml+xml` document.** The same frame-beside-a-div page served as XHTML: at head nothing is clicked (the frame wins and the walk refuses it), so the `div` player is not pressed. This is the safe direction, since nothing reaches the frame. A bare XHTML frame and an XHTML wrapper over a frame are both refused at head by the walk, whose `matches('iframe')` is lowercase. `localName` in the variant above fixes it.
- **dropped** · the sweep's third base/head difference, `player-nav-first.html` (head marked `.player-shell`, base never reached the box click). That is timing: re-run 4 times in each order, base never marked it, head marked it on 2 of the 4 base-first runs and on 0 of the 4 head-first runs, and the shell has no frame for the change to act on.
- **dropped** · `c-cross-wrap-poster` and `c-dl139-tab-poster` (a cross-origin player that starts only on a click anywhere on its surface, wrapped so the wrapper's centre is over it). At base the box click started it, and at head nothing does. That is the cost the owner accepted with option A, not a defect.
- **findings** · the hunt returned 6; 4 carried, 2 dropped.
- NFR: security — the high and the first low (a click into another document is the advertiser-link risk dl-81's decision closed) · performance n/a (one string compare, one selector) · reliability ✓ (dl-139's server-tab press and a cross-origin frame's own pass still yield media) · maintainability — the third low.

### Gate 2

**Gate: PASS** — 2026-11-15 · `d3ab6c31..74e003a4` · Opus 5.5, depth narrow

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A committed test with a bare player-classed `<iframe>` shows no click inside the frame, and is red on `main` before the change | `resolvers/test/browser/browser-resolver-player-input.test.ts` › "a player-classed iframe that is the only box is never clicked into, and the probe ends NO_MEDIA_FOUND" ✓. The round leaves it unchanged. Gate 1 measured it red on `main`. In this gate's sweep, `player-box-bare-iframe.html` is still marked and clicked at `5f15e56f` and refused at head                                                 |
| The existing box-click tests (dl-81, dl-100) pass unchanged, so a `div` player is still clicked                                | `browser-resolver-player-input.test.ts` › "clicks the middle of the largest player-ish box when no <video> was clicked" and `browser-resolver-press-targets.test.ts` › "ctl=autoplay (a toggle labelled Autoplay) is pressed but does not hold back the box click" ✓. The round's test diff adds 57 lines and removes 0. Both pass in the project run                                                          |
| The Log says what was decided about a wrapper whose centre is over a frame, with the measurement                               | **verified** by reading. The round does not change those entries                                                                                                                                                                                                                                                                                                                                               |
| `npm run check` exits 0 and the downloader project passes                                                                      | **verified**. `npm run check` exits 0. The downloader project: 2675 passed, 1 failed, 2 skipped of 2678. The failure is the dl-115 quiet-wait timing test, which read 803 ms by `performance.now` and 3363 ms by `Date.now`, so the sandbox's two clocks disagreed. That file re-run alone: 19 passed of 19. PR #817's `test (ubuntu-latest)` passes at `74e003a4`, as do the other 10 checks, CodeQL included |

- **F1 (high), fixed in part.** The drill closes every open-shadow-root page:
  - gate 1's host-is-the-box and wrapper pages are refused, with no beacon;
  - nested roots (a host inside a shadow root inside a host), bare and wrapped, are refused;
  - a host whose shadow root answers the host itself still ends the loop, and that host is still pressed at base and at head.

  Removing the loop turns both `player-box-shadow-frame.html` rows red (2 failed, 9 passed, 20 skipped of 31). **What remains: a closed shadow root.** A `class="player-host"` whose closed root holds a 640x360 iframe is marked and clicked into, at base and at head, and the same holds with a `.player-wrap` around it. That is the limit of option (a), which the owner chose and which names open roots. The docstring and the drill's comment both say "every open shadow root". The comment on `unsafe` says "however deep in shadow roots", and the older docstring sentence "A frame is never clicked blind" is still false for a closed root. Both are false in the unsafe direction. I grade the remainder **low** rather than high: no live call site is known, and the same function states the true bound twice before the paraphrase. The fix is text only, "however deep in open shadow roots".

- **F2 (low), fixed.** All five `frame`/`object`/`embed` attack pages are refused at head, with no beacon. Removing `object, embed` from `unsafe` turns the two wrapped rows red (2 failed, 9 passed, 20 skipped of 31). The `<frame>` half has no test: see N1.
- **F3 (low), fixed.** With the candidate filter removed, the HTML and XHTML rows of "a large player-classed frame does not win the choice over a smaller div player" fail: 2 failed, 9 passed, 20 skipped of 31, which matches the Log.
- **F4 (low), fixed.** Reverting to `box.tagName === 'IFRAME'` turns the XHTML row red (1 failed, 10 passed, 20 skipped of 31). The new `.xhtml` entry in `fixture-server.ts` is keyed on the lower-cased `path.extname`. `player-box-frame-beside-div.xhtml` is the only `.xhtml` file in the repo, so no other fixture's served type changes.
- **N1 · low** · `nfr:maintainability` · **`frame` in the filter and in `unsafe` has no test.** Removing it from both leaves the dl-142 describe green, 11 passed of 11. The test comment and the Log say "a `<frame>` exists only in a frameset, which cannot sit beside a player, so no fixture reaches it". That is half true:
  - A `<frame>` outside a frameset loads no document. Inserted by script into an HTML body, or in an XHTML body, it is marked at base, but its document never beacons. So the wrapper case has no fixture.
  - The bare case does. Gate 1's `a-frameset.html`, a frameset whose `<frame class="player">` is the box, is clicked into at base and refused at head.

  Direction: a frameset fixture with a player-classed `<frame>`, and a test that its inner beacon never fires. I did not run it as a test.

- **dropped** · the project run's one failure. It is the clock disagreement above, and the file passes alone and in CI on this head.
- **dropped** · `player-host` with an open `<slot>` whose light-DOM iframe covers the centre. `main` pressed it and head refuses it. The refusal comes from the light-DOM walk (option A's accepted cost), not from the drill.
- **findings** · the round's attacks returned 4: 1 carried as N1, 1 folded into F1 as its remainder, 2 dropped.
- Sweep: 159 URLs (gate 1's 151 plus the round's 8). `5f15e56f` and head differ on 10, every one a branch fixture. None of the 149 pre-existing URLs differs; `player-nav-first.html` did not recur.
- NFR: security — F1's remainder (closed roots) · performance n/a (the loop is bounded by shadow nesting depth) · reliability ✓ (dl-139's tab and cross-origin pages are unchanged) · maintainability — N1.

## Log

- 2026-11-15 — Filed from dl-139's first gate (Opus 5.5), attack 4, on the owner's
  answer at the orchestrator's checkpoint: file. The gate named three options
  (file; fold into dl-139; correct the comment only) and recommended filing; no
  recommendation was overridden. The gate's report notes that the third option
  would reverse the owner's 2026-10-07 decision without asking. The reproduction
  was re-run on `main` at `e7d791d6`; the live page that surfaced dl-139 is not
  involved.
- 2026-11-15 — Owner's answer, at the orchestrator's checkpoint after gate 1
  graded `d1ae1be7` CONCERNS, on how the lander handles gate 1's findings.
  Options: fix the meds and the lows at landing with no re-gate (the gate's
  recommendation); fix the meds only; record only. Answer: fix the meds and the
  lows at landing. No recommendation was overridden. Gate 1's one finding on this
  ticket was a low.
- 2026-11-15 — Fixed at landing by owner choice: gate 1, the last low — the
  wrapper reading named `within(el, hit)`, and the clause that accepts a hit
  inside the chosen box is `within(hit, el)` (`MARK_PLAYER_BOX_SCRIPT` in
  `provoke.ts`, where `within(inner, outer)` is the signature). Proof: `git diff d1ae1be7 HEAD -- tools/downloader/docs/work/dl-142-the-box-click-presses-a-player-classed-iframe-blind.md | grep -c '^-.*within(el, hit)'` → 1.
- 2026-11-15 — Gate 1's full report is on the pull request thread, #809; status
  unchanged.
- 2026-11-15 — Built steps 1, 2, 4 and 5 (builder, Sonnet 5.5); **step 3 is an open decision and is not built.** The brief was right that the defect is on `main` and wrong that dl-139 was unmerged: it is #802 (`5f15e56f`), so step 5 was live.
  - **Red on `main`.** `player-box-bare-iframe.html` (a `class="player-frame"` iframe, the only candidate; its document, `player-box-frame-inner.html`, beacons `/beacon/inner-click` on any click). `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver-player-input.test.ts -t "dl-142"`, before the fix: `AssertionError: expected [ Array(3) ] to not include '/beacon/inner-click'`, 1 failed. Appended at the end of that file as its own `describe`.
  - **The fix.** `MARK_PLAYER_BOX_SCRIPT` drops a candidate whose `tagName` is `IFRAME`, before the size filter, so a large frame cannot also win the choice over a smaller `div` box. The same spec file after it: 22 passed of 22. `SCROLL_SCRIPT` is untouched (step 4).
  - **Control.** `player-box-iframe-wrapper.html` (a 1000 px `.player-wrap` holding a 300 px frame, centre at 500,180, off the frame): the wrapper is clicked (`/beacon/wrapper-clicked`) and the frame is not. It passes on `main` and after the fix, so a `div` box that holds a frame is still pressed.
  - **Step 3, measured on `main` with the fix applied (step 2 only).** The same page with `?over` (wrapper 640x360 exactly over a 640x360 frame): `["/beacon/inner-click"]`, so the click lands in the frame through the wrapper; the full-width wrapper with the frame at its left: `[]`. `?over` is in the fixture and untested. The candidate fix is one word: add `iframe` to `unsafe` in `MARK_PLAYER_BOX_SCRIPT` (`a[href], [role="link"], form, input, select, textarea, label, iframe`), which the existing `for (node = hit …)` walk already applies to the topmost element and its ancestors. With it, `?over` gives `[]`, and `npx vitest run tools/downloader/resolvers/test/browser` gave 795 passed, 1 failed of 796, the one being the measuring probe, so no existing spec (dl-81, dl-100, dl-139) depends on a click that lands in a frame through a wrapper. That change was then taken out: what it costs is a player whose only press is a wrapper entirely covered by its frame, and that is not a test the suite has either way. The owner's rule of 2026-10-07 says a frame is never clicked blind, which reads for it; the ticket's own cost reads against it. Left to the owner.
  - **Step 5, dl-139.** `provokePlayback` presses the server tab before `clickPlayerBox`; the exclusion does not touch that press (`MARK_SERVER_TAB_SCRIPT` selects `iframe` itself) and `browser-resolver-press-targets.test.ts` passed in the suite run above (20 files, 795 of 796 with the probe).
  - **Fold-in.** None: no other small specified piece became free.
- 2026-11-15 — Owner's answer on Build 3, put by the orchestrator from the builder's open decision. Options: A, refuse the click when the topmost element at the click point is an `<iframe>` (recommended); B, leave a wrapper entirely covered by its frame clicked blind. Answer: A, the recommendation; nothing overridden. Build 3 is therefore: add `iframe` to the `unsafe` list in `MARK_PLAYER_BOX_SCRIPT`, with a test on `player-box-iframe-wrapper.html?over`.
- 2026-11-15 — Built Build 3 on the owner's answer above (option A). `unsafe` in `MARK_PLAYER_BOX_SCRIPT` now ends `, iframe`, and the walk that already runs from the topmost element up through its ancestors refuses the click. New test `a div box whose centre is over a frame is not clicked either: the topmost element there is the frame` (`browser-resolver-player-input.test.ts`, appended last in the dl-142 describe, on `player-box-iframe-wrapper.html?over`). Red without the word: `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver-player-input.test.ts -t "dl-142"` → `AssertionError: expected [ …(3) ] to not include '/beacon/inner-click'`, 1 failed, 2 passed of 23. Green with it: 3 passed, 20 skipped of 23. This is the measurement Done when 3 asks for: a wrapper whose centre is over a frame took the click into the frame before (`["/beacon/inner-click"]`), and takes none now, while the wrapper whose centre misses the frame is still pressed (`/beacon/wrapper-clicked`).
- 2026-11-15 — Owner's answer on gate 1 (`ticket-reviewer-opus`, head `d3ab6c31`, graded FAIL on one high; all four Done-when lines passed and its 151-URL sweep found no fixture that loses a box click), put by the orchestrator. The high, an `<iframe>` in an open shadow root covering the box's centre: options (a) drill the hit through open shadow roots (recommended); (b) narrow both comments to light-DOM frames and file the shadow case. Answer: (a). The three lows go into the same round because a round is open and each fix is fully stated. No recommendation was overridden. Dispositions follow in the round's next entry.
- 2026-11-15 — Round 1 dispositions (builder, Sonnet 5.5), every finding reproduced before it was fixed: the seven new cases below were red at `0110b3dc` (the fix absent) and are green after; the output is `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver-player-input.test.ts -t "dl-142"`, `7 failed | 4 passed | 20 skipped (31)` before, `11 passed | 20 skipped (31)` after.
  - **High, fixed.** `MARK_PLAYER_BOX_SCRIPT` now goes down from the `elementFromPoint` hit through every open shadow root (`while (hit.shadowRoot) { deeper = hit.shadowRoot.elementFromPoint(x, y); … }`) before the `within` and `unsafe` checks. Tests, appended last in the dl-142 describe: `a frame in an open shadow root that covers the centre is not clicked into` on `player-box-shadow-frame.html`, both rows (host is the box; box is a wrapper around an unclassed host), red then green. The comment on `unsafe` and the docstring now say what the code does.
  - **Low, `<frame>`, `<object>`, `<embed>`, fixed.** The candidate filter and `unsafe` now name all four. Tests: `is not clicked into` on `player-box-plugin-frame.html`, four rows (object and embed, each as the box and under a wrapper's centre), red then green. **`<frame>` has no test**: a `<frame>` exists only in a frameset, which cannot sit beside a player, so no fixture reaches it; it is in the regex and the selector on the gate's evidence for the other three.
    - **WITHDRAWN — do not cite this paragraph** (the sentence beginning "**`<frame>` has no test**"): a `<frame>` does have a fixture, a frameset whose `<frame class="player">` is the box. Gate 2's N1 found it; the claim was the builder's. The gate also found that a `<frame>` outside a frameset loads no document, so a wrapper over a frame still has no fixture, and that half stands.
  - **Low, no test for the candidate filter, fixed.** `player-box-frame-beside-div.html` (an 860x500 `class="player-frame"` iframe beside a 400x240 `.video-player` div that beacons `/beacon/div-clicked`). It is green at `0110b3dc` and red with the filter line removed: `2 failed | 9 passed | 20 skipped (31)`, the HTML and XHTML rows, then the line was restored from a copy (`diff` empty).
  - **Low, `tagName` in XHTML, fixed.** The filter reads `localName`. `.xhtml` is added to the fixture server's `CONTENT_TYPES` (`application/xhtml+xml`), one line, and `player-box-frame-beside-div.xhtml` is the same page; its row was red at `0110b3dc` and is green.
- 2026-11-15 — Owner's answer on gate 2 (`ticket-reviewer-opus`, head `74e003a4`, PASS), put by the orchestrator. F1's remainder, a closed shadow root that the drill cannot open, graded low, and N1, `frame` with no test. Options: lander fixes both (recommended); fix the wording only; record both and land as is. Answer: lander fixes both; nothing overridden. The fixes follow as the two entries below.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, F1 (remainder) — "however deep in shadow roots" and "A frame is never clicked blind" were false for a closed shadow root. The `unsafe` comment now says "however deep in open shadow roots" and the docstring says a frame in the light DOM or in an open shadow root is never clicked blind, one in a closed shadow root being out of reach of every check. Wording only, `provoke.ts`. Proof: `git diff 74e003a4 HEAD -- tools/downloader/resolvers/src/browser/provoke.ts | grep -c '^-.*however deep in shadow roots'` → 1, and the same with `'^-.*A frame is never clicked blind'` → 1.
- 2026-11-15 — Fixed at landing by owner choice: gate 2, N1 — "`frame` in the filter and in `unsafe` has no test". New fixture `player-box-frameset.html` (a frameset whose `<frame class="player">` is 70% wide and loads `player-box-frame-inner.html`, which beacons any click) and, appended last in the dl-142 describe of `browser-resolver-player-input.test.ts`, `a player-classed frame in a frameset is never clicked into, and the probe ends NO_MEDIA_FOUND`. Green: `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver-player-input.test.ts -t "dl-142"` → 12 passed, 20 skipped of 32. Red with `frame` taken out of both the candidate filter regex and `unsafe` (committed first, then mutated, then restored from the commit, tree clean after): `1 failed | 11 passed | 20 skipped (32)`, `expected [ '/player-box-frameset.html', …(3) ] to not include '/beacon/inner-click'`. The test comment on `<object>` and `<embed>` no longer says no fixture reaches a `<frame>`.
