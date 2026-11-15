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
