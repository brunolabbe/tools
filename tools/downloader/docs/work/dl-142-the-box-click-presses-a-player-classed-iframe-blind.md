---
id: dl-142
tool: downloader
title: The box click presses a player-classed `<iframe>` blind, against its own comment and the owner's 2026-10-07 decision
kind: fix
status: ready
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
