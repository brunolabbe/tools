---
id: dl-81
tool: downloader
title: A player that loads only on the visitor's first input, with nothing to click, never starts
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-81 — A player that waits for input, with nothing to click, never starts

## Why

The browser tier provokes playback with a scroll, consent and modal dismissal,
a surface click on the chosen `<video>`, and play-ish text clicks
(`resolvers/src/browser/provoke.ts`). Two kinds of page fall through all of it
to `NO_MEDIA_FOUND`:

- **Players that load on input.** Some pages inject the player script only on
  the first `pointermove`, `wheel`, `touchstart` or `keydown`, and until then
  show a bare poster (`<div><img></div>`) with no `<video>` and no play-ish
  label. The tier never sends a generic input: its only keyboard call is
  `Escape` while dismissing a modal, and there are no mouse-move or wheel calls.
  `SCROLL_SCRIPT` scrolls only to the _first_ match of
  `video, iframe, [class*="player"], [id*="player"]`, so an ad iframe or a
  `player-nav` element earlier in the document takes that slot.
- **Players in a frame from another site.** `isScriptableFrame` keeps all
  script out of cross-origin frames, so an embedded player there gets no
  scroll, no scripted `play()`, and no scripted modal close or age gate. It gets
  only the locator-API clicks. dl-55's decision 3 already relaxed this for a
  read-only check, and its gate measured that evaluation works there. The
  policy's own docstring says what the locator path does, not why script is
  withheld.

The owner chose on 2026-10-06 to cover both. Found by reading the code during a
review of the resolver chain's false "no video" cases. **Not yet reproduced**:
building the fixtures is the first step.

## Build

1. **Reproduce first**, against the local fixture origin:
   - a page whose player script is injected only on the first
     `pointermove`/`wheel`/`keydown`, with the poster as a plain
     `<div><img></div>`;
   - a page whose earliest `[class*="player"]` element is a nav bar above the
     fold and whose real, lazily attached player is further down;
   - a cross-origin embed (a second fixture origin; note that the existing
     `cross-origin-shadow*` fixtures are same-site, being 127.0.0.1 on two
     ports) whose player starts only on scroll into view or a scripted
     `play()`.
     Record what `origin/main` returns for each.
2. Input: after the first pass, send one synthetic `page.mouse.move` across the
   viewport, one `page.mouse.wheel`, and a centre click on the largest visible
   player-ish box when no `<video>` was clicked. Never press Enter or Space on a
   focused element: either can submit a form or follow a link.
3. Scroll: target the largest visible candidate, not the first, using the same
   largest-area rule the surface click uses (`CHOOSE_VIDEO_INDEX_FN`).
4. Cross-origin: **before relaxing `isScriptableFrame`**, look through
   `git log -S isScriptableFrame` and the dl-16/dl-55 tickets for a recorded
   reason script was withheld. If you find a security or correctness reason,
   stop and put it in your report as an open decision with options. Otherwise
   run scroll and `play()` in those frames too, and leave consent text and the
   age gate main-origin only (dl-83 owns the age gate).
5. Each new provocation counts as activity, so check it doesn't stop network
   quiet from ever arriving.

## Done when

- Each step-1 fixture yields its stream.
- A test proves the input pass presses no key other than the existing
  `Escape`.
- A test proves scrolling targets the largest candidate.
- The Log records what step 4 found about the cross-origin policy.
- `npm run check`, `npm test -- --project downloader` and
  `npm run e2e:downloader:sniffer` pass.

## Log

- 2026-10-07 — **Built** (builder, Sonnet 5.5). Branch `dl-81-input-only-player`
  off `origin/main` 1aece87d.

  **Step 1, the reproduction.** Six fixtures, each yielding `NO_MEDIA_FOUND` on
  `origin/main`'s provocation (the only source change at that point being
  `export` on `SCROLL_SCRIPT`, so a test could call it):
  `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts tools/downloader/resolvers/test/browser/provoke.test.ts -t dl-81`
  gave `Tests 7 failed | 4 passed | 344 skipped (355)` **in that run; the
  `pointermove` page is not reliably red, see round 2**. The seven red were the
  `pointermove` and `wheel` input-gated pages (`input-gated-player.html?on=`),
  `player-nav-first.html` (an ad iframe and a `player-nav` bar above a lazily
  mounted shell 3000 px down), `player-box-click-only.html` (a poster in a `div`
  that starts on click, no `<video>`, no label), the two cross-origin embeds
  (`cross-origin-scroll-player.html`: a player that mounts on scroll into view;
  `cross-origin-play-only.html`: a `<video>` that starts only on `play`; both on
  the secondary fixture origin, so genuinely another origin) and the
  `SCROLL_SCRIPT` unit (`expected 4320 to be less than or equal to 720`: the
  shell was 4320 px below the viewport). The four that pass on `main` are guards
  that must stay green: two "never presses a link" pages and the two key tests.

  **Step 2, input.** `provokeInput` runs once, between the two passes: a
  `page.mouse.move` across the viewport (corner, then a stepped move to the far
  corner, then the centre), one `page.mouse.wheel(0, 120)`, then, when no pass-0
  frame clicked a `<video>`, `clickPlayerBox` on the top frame. No key is sent
  and none is listened for in the fixtures. Pages that wait for `keydown` or a
  touch are not reached, on purpose: Enter or Space can submit a form or follow a
  link. The box click is the largest eligible `iframe, [class*="player"],
[id*="player"]` by `CHOOSE_VIDEO_INDEX_FN`, centred in view first, and it
  refuses (a) a non-iframe box covering more than 85% of the viewport (a layout
  wrapper; `player-box-wrapper.html`), and (b) a point whose topmost element is,
  or sits inside, a link, form control or label (`player-box-link-centre.html`;
  `player-box-in-link.html` is also stopped earlier by the chooser's link-ancestor
  rule). It is the top frame only: an `<iframe>` is a candidate there, and the
  click lands on the embed's content whatever its origin, so a cross-origin
  click-only player needs no script in its frame, and a click in both the parent
  and the frame would start a player and pause it.

  **Step 3, scroll.** `SCROLL_SCRIPT` picks by `CHOOSE_VIDEO_INDEX_FN`, falling
  back to the first match when nothing is eligible, as before.

  **What the brief had wrong or omitted.** The 400 px `scrollBy` that followed
  the centring pushed a 640x360 player out of a 640x360 embed before the page's
  `IntersectionObserver` ran, so the cross-origin scroll fixture stayed red even
  with the policy relaxed (`AppError: No downloadable video stream was found`).
  It now runs only when there is nothing to centre. Not in the brief; the
  fixture needed it.

  **Step 4, the cross-origin policy.** `git log -S isScriptableFrame` gives four
  commits **when filtered to `tools/`; wrong, see round 2: unfiltered the first
  is 725740c3**: d1ec2c61 (the monorepo move, where a path filter stops),
  b0abed06 (the docs commit that filed dl-78..dl-83, naming the predicate in
  this ticket), 829e7ff3 (dl-83, which only reads it) and 18065251 (dl-55). The ticket that asked for the behaviour, dl-2 step 4, says "handle
  same-origin iframes" and gives no reason for stopping at the origin. dl-55's
  decision 3 (owner, 2026-09-15) relaxed it for the read-only chooser and its
  gate recorded "security ✓ (the cross-origin evaluation is read-only)"; its
  round-3 note calls the predicate "a _policy_ … not a technical wall". dl-16 and
  dl-12 say nothing about frames; neither does an ADR. So no security or
  correctness reason is recorded for withholding a scroll or a `play()`, and I
  did not stop. `SCROLL_SCRIPT` and `PLAY_SCRIPT` now run in every frame;
  consent, the modal close and the age gate stay main-origin (their locator-only
  paths are unchanged). One thing a human might weigh and nobody recorded: both
  are mutations of a third party's frame (a scroll position; a muted `play()`),
  where dl-55's chooser was read-only. Both do what the locator click already
  does to that frame.

  **Step 5, quiet.** The new provocations all sit in `provokePlayback`, which
  runs two passes and one input pass per probe; nothing is added to
  `waitForQuiet` or its `revisit` hook, so nothing repeats while it waits.
  Measured by the dl-80 tests that probe a page with no media:
  `npx vitest run tools/downloader/resolvers` gave `Test Files 20 passed (20),
Tests 880 passed (880)`, among them "the empty floor is overridable to allow
  tests to run quickly" (NO_MEDIA_FOUND in under 3 s) and "a budget shorter than
  the floor plus page load ends TIMEOUT". `resolvers/browser.ts` is untouched.

  **Guards proven red.** `BOX_MAX_COVER` set to 2: the wrapper test fails (1 of
  9 `dl-81` browser-resolver tests). The unsafe-element check disabled: the
  link-under-centre test fails. A `page.keyboard.press("Enter")` added to
  `provokeInput`: both key tests fail (3 failed | 9 passed in that run). All
  reverted.

  **Fold-in.** None taken: nothing in this change made another specified piece
  free. dl-93 (consent wording) and dl-83's age gate stay with their owners.

  **Not covered.** A player that waits for `keydown` or `touchstart`; a
  click-only `div` player inside a same-origin frame that is not the page's
  largest box; and hover previews, which a pointer sweep across the viewport can
  start on a related-video card (unmeasured).

- 2026-10-07 — **Round 2** (builder, Sonnet 5.5), after gate 1 graded FAIL at
  `a280941b` (three highs, three meds, one low). Findings and the owner's three
  decisions below; the round-1 entry above is left as written except where it
  says "round 2".

  **Decided by the owner, 2026-10-07**, each the gate's recommendation, so a
  later builder does not reopen them. Each was put as a question with options:

  1. **The centre click on a player-ish box presses whatever is largest.**
     Measured at `a280941b`: it navigated away on a related-video grid, a
     newsletter form, a cross-origin `target=_top` billboard and a full-viewport
     interstitial, posted a form, and returned an advertiser's `.mp4`. Options:
     **A**, skip it once anything playable has been captured, never click an
     `<iframe>`, treat a button inside a form as unsafe; **B**, drop the box
     click; **C**, keep it and correct the docstring. **The owner chose A.**
     Accepted cost: a click-only player alone in a cross-origin frame, with no
     `<video>` and no label, is no longer reached.
  2. **A cross-origin `play()` plays every media element in that frame.** An ad
     frame's `<video>` outranked the page's own progressive file, and a frame
     whose `play` handler sets `top.location` turned a real stream into
     `navigated-away`. Options: **A**, in a frame from another site play only the
     video the dl-55 chooser picks, and only while nothing has been captured;
     **B**, keep `play()` main-origin and reword Done when 1; **C**, accept as
     built. **The owner chose A.**
  3. **The pointer sweep starts hover previews.** A keydown-gated page above
     eight preview cards returned `/atk/preview-2.mp4`, a related video's clip.
     Options: **A**, drop the mouse moves and keep the wheel; **B**, move only
     over the chosen box; **C**, keep. **The owner chose A.**

  **The `pointermove` premise, measured.** The coordinator relayed a
  disagreement; both of us were right, and the fixture was not a reproduction.
  At base `provoke.ts` (restored from 1aece87d), `pointer.mts idle`, which sends
  no provocation at all, printed
  `idle: {"ev":["pointermove@33(0,0)","mousemove@34(0,0)"],"status":"mounted"}`:
  headless Chromium sends a `pointermove` and a `mousemove` at (0,0) while a page
  loads. `npx vitest run … -t "first pointermove"` at base passed 3 of 3. But the
  same two files with `-t dl-81`, as in round 1, gave `6 failed | 6 passed` and
  `7 failed | 5 passed` on two runs, the `pointermove` test red in one and green
  in the other: the load-time event is racy, so the page mounts by timing. The
  ticket's premise ("the tier never sends a generic input") is false for
  `pointermove` and `mousemove` listeners, and round 1's "seven red" was one lucky
  run. A wheel is never sent by the browser itself, and
  `?on=wheel` is red at base every time (`ERR NO_MEDIA_FOUND`) and green at head.
  The `pointermove` case is dropped as a test (decision 3 removes the only thing
  that could have mounted it, and a test of it cannot fail reliably); the fixture
  says so in a comment.

  **Fixes, by finding.**
  - _High, the box click._ Decision 1. `MARK_PLAYER_BOX_SCRIPT` no longer lists
    `<iframe>`, treats any point inside a `<form>` as unsafe (a form's submit
    button is out; a button outside one is allowed), and **no longer scrolls**
    (see the next finding); `provokePlayback` takes `hasPlayable?: () => boolean`
    and `resolvers/browser.ts` passes `() => collector.hasPlayableHit()`, the
    one line changed there. The docstring no longer says "never marks a control a
    click could act on" without saying what it can see.
  - _High, `pointermove`._ Above.
  - _High, "scrolls to the largest candidate…" passed without the scroll._ The
    box script's own `scrollIntoView` brought `player-nav-first.html`'s shell into
    view. Removed; a box that is not already in view is now left alone. With
    `SCROLL_SCRIPT` set back to `candidates[0]` the resolver test and the unit
    both fail (`2 failed | 23 passed`).
  - _Med, `PLAY_SCRIPT` in every frame._ Decision 2: `PLAY_CHOSEN_SCRIPT` in a
    non-scriptable frame, behind `!hasPlayable()`. The gate's `ad-outranks.html`
    (a progressive `preload=none` `<video>` beside a cross-origin ad frame whose
    `<video>` fetches an HLS master on `play`) returns `P/atk/real.mp4` at base
    and head both; at `a280941b` it returned the ad's master.
  - _Med, the nudge._ The 400 px `scrollBy` now follows the centring whenever
    the centring moved nothing (`scrollX`/`scrollY` compared; `behavior:
'instant'` so a smooth-scrolling page is not misread). The gate's
    `nudge.html` returns the stream at base and head;
    `player-header-nudge.html` is the test. The frame-sized embed still gets no
    nudge, because its shell is 1500 px down and the centring moves.
  - _Med, hover previews._ Decision 3: no `page.mouse.move` anywhere in the tier.
  - _Low, the first commit._ `git log -S isScriptableFrame` with no path filter
    gives 725740c3 ("WP-2: Playwright browser sniffer resolver"), not d1ec2c61,
    which is the monorepo move where a path filter stops. Its comment over the
    DRM read-back says "A rejected read means the frame detached or is
    cross-origin", so the likely origin is a belief that evaluation fails there,
    which dl-55 measured false. The docstring and round 1's Step 4 name it.

  **The gate's base-versus-head table, re-run on this result** with the gate's
  `harness.mts` (its paths pointed at this worktree), the real `BrowserResolver`,
  `quietMs: 1200`, `emptyMinWaitMs: 1200`, 25 s, the secondary origin
  `localhost`. Base is `provoke.ts` from 1aece87d; head is this commit.

  | page                                                                   | base                                                | head                                            |
  | ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
  | `related-grid.html` (Play poster, grid of `onclick` cards)             | `P/media/hls/master.m3u8`                           | same                                            |
  | `form-button.html` (Play poster, signup form box)                      | `P/media/hls/master.m3u8`                           | same                                            |
  | `form-navigates.html`                                                  | `P/media/hls/master.m3u8`                           | same                                            |
  | `billboard.html?mode=top` (cross-origin `_top` billboard, Play poster) | `P/media/hls/master.m3u8`                           | same                                            |
  | `billboard.html?mode=blank`                                            | `P/media/hls/master.m3u8`                           | same                                            |
  | `billboard-poster.html?mode=blank` (billboard, click-to-start poster)  | `NO_MEDIA_FOUND`                                    | `P/media/hls/master.m3u8`, the poster's own     |
  | `interstitial.html` (full-viewport cross-origin ad)                    | `NO_MEDIA_FOUND`                                    | `NO_MEDIA_FOUND` (not `navigated-away`)         |
  | `ad-vs-hls.html`, `top-nav-play.html`                                  | `P/media/hls/master.m3u8`                           | same                                            |
  | `ad-outranks.html`                                                     | `P/atk/real.mp4`                                    | same                                            |
  | `nudge.html`                                                           | `P/media/hls/master.m3u8`                           | same                                            |
  | `hover-preview.html` (keydown player, hover previews)                  | `NO_MEDIA_FOUND`                                    | `NO_MEDIA_FOUND`, no `/atk/preview-*` requested |
  | `cookie-banner.html` (box under a banner)                              | `NO_MEDIA_FOUND`                                    | `P/media/hls/master.m3u8`: see below            |
  | `input-gated-player.html?on=wheel`                                     | `NO_MEDIA_FOUND`                                    | `P/media/hls/master.m3u8`                       |
  | `input-gated-player.html?on=pointermove`                               | `P/media/hls/master.m3u8` (the browser's own event) | same                                            |
  | `player-nav-first.html`, `player-box-click-only.html`                  | `NO_MEDIA_FOUND`                                    | the stream                                      |

  `cookie-banner.html` differs from the gate's `a280941b` run, where it stayed
  `NO_MEDIA_FOUND`: with the box click no longer scrolling, the page ends up
  scrolled (to 200 or 220 px, gate 2's measurement, **not** by the wheel's 120 px
  as this entry first said) so the box's visible centre is above the banner, the
  click lands on the box, and `/beacon/banner-link` is never requested. That is a
  click on the box and not on the banner. Gate 2 varied the gap above the box over
  eight layouts: the box was clicked in 2, no click was made in the other 6, and
  the banner link was never requested in 8 of 8.

  **Guards proven red**, by mutating `provoke.ts` one thing at a time and running
  the `dl-81` tests (`mutate2.mjs`, each restored): scroll back to the first
  match, 2 failed (the resolver test and the unit); `play()` in every frame, 1
  failed (the ad test); the cross-origin `play()` ignoring `hasPlayable`, 1;
  the box click ignoring `hasPlayable`, 1 (the related-grid test; its first
  version had a two-row grid whose centre is a gap, and passed with the mutation,
  so the grid is 3x3); `<iframe>` back among the box candidates, 1; `form` out of
  the unsafe list, 1; the nudge removed, 1; the wheel removed, 1; a mouse sweep
  added, 1 (the hover test); `keyboard.press("Enter")` added, 3; the cover cap
  at 2, 1; the unsafe walk disabled, 2.

  **Not covered, unchanged:** a player that waits for `keydown` or `touchstart`
  (a hover-preview page that does is the regression above); a click-only `div`
  player alone in a cross-origin frame; a click-only `div` in a same-origin frame
  that is not the page's largest box. dl-92 (#388) merges first; this branch is
  rebased onto it afterwards, both append at the end of
  `browser-resolver.test.ts`.

- 2026-10-07 — **Round 3** (builder, Sonnet 5.5), after gate 2 graded CONCERNS at
  `092fc118`: gate 1's seven findings all fixed, three new meds, no high.

  **Decided by the owner, 2026-10-07.** Question: the centre click checks for a
  captured stream right after pass 0's press, before a slow player has requested
  its manifest (a request 300 to 3000 ms after the press: base returned the real
  stream, `092fc118` navigated away to a related-video card). Options: **A**,
  skip the box click once pass 0 has pressed a play button or label (the gate's
  recommendation); **B**, after such a press wait up to about 1 s for a stream
  before box-clicking; **C**, record and accept. **The owner chose A.** The press
  is the evidence a player was started, whether or not it has asked for anything
  yet. `provokeFrame` now returns whether it pressed a play-ish selector, a
  label or the chosen `<video>`, and `provokeInput` skips the click on it, as well
  as on a captured stream.

  **Fixes, by finding.**
  - _CodeQL, two high "DOM text reinterpreted as HTML" alerts_ in this branch's
    fixtures (`hover-previews-keydown-player.html:43`, `v.src =
v.getAttribute("data-preview")`; `player-poster-related-grid.html:58`,
    `location.href = card.getAttribute("data-to")`), read from the CodeQL check
    page of `092fc118`. Both URLs are now built from the card's index in the
    script and the attributes are gone, so no adr/005 excuse is needed.
  - _The race._ Above. Pinned with `player-poster-related-grid.html?delay=<ms>`
    (the manifest request held back after the press) at 0, 300, 1500 and 3000 ms,
    on the shipped 9 s floor (at the tests' 1.2 s floor a request at 3 s arrives
    after the wait has ended, which is the test's artefact, not the tier's). With
    the press check removed: 3 of the 4 fail (300, 1500, 3000). A fifth case, a
    stream captured with nothing pressed (`player-autostart-related-grid.html`),
    is what still needs `hasPlayable`: with that check removed, it fails.
  - _The nudge._ `SCROLL_SCRIPT` nudges by 400 px in the top frame always, as at
    base, and in a subframe only when the centring moved nothing (the frame-sized
    embed is the one case the nudge ever broke). Both scrolls are `instant`. The
    centre click takes a minimum size (200x120, `BOX_MIN_WIDTH`/`BOX_MIN_HEIGHT`),
    so a 300x50 `player-header` is never "the player". `player-header-nudge.html`
    takes `?top=` and `?smooth=1` and is tested at the top, at 500 px, and both on
    a smooth-scrolling page; with the nudge reduced to "only when nothing moved",
    the two `top=500` layouts fail. `player-header-only.html` (a fixed 300x50 bar
    recording clicks) fails with the minimum removed.
  - _Log._ The round-2 cookie-banner entry now says the page was scrolled to 200
    or 220 px, not by the wheel's 120.

  **Base versus head, re-run.** The gate's `harness.mts` over the real
  `BrowserResolver`, the secondary origin `localhost`. For this round base is
  `provoke.ts` **and** `resolvers/browser.ts` from 1aece87d (head adds the
  `hasPlayable` argument there).

  | page                                                                                      | base                           | head                                       |
  | ----------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
  | `related-grid.html`, `form-button.html`, `form-navigates.html`                            | real HLS                       | same                                       |
  | `billboard.html?mode=top` and `?mode=blank`                                               | real HLS                       | same                                       |
  | `billboard-poster.html?mode=blank`                                                        | `NO_MEDIA_FOUND`               | real HLS, the poster's own                 |
  | `interstitial.html`                                                                       | `NO_MEDIA_FOUND`               | `NO_MEDIA_FOUND`                           |
  | `ad-vs-hls.html`, `top-nav-play.html`, `ad-outranks.html`                                 | real HLS, real HLS, `real.mp4` | same                                       |
  | `nudge.html`, `nudge-low.html?top=500`, `?top=0&smooth=1`, `?top=500&smooth=1`            | real HLS                       | same (all four)                            |
  | `smooth-lazy.html`                                                                        | `NO_MEDIA_FOUND`               | real HLS                                   |
  | `hover-preview.html`                                                                      | `NO_MEDIA_FOUND`               | `NO_MEDIA_FOUND`                           |
  | `cookie-banner.html`                                                                      | `NO_MEDIA_FOUND`               | real HLS (a click on the box, see round 2) |
  | `input-gated-player.html?on=wheel`, `player-nav-first.html`, `player-box-click-only.html` | `NO_MEDIA_FOUND`               | the stream                                 |

  The delay table, on the shipped floors (`GATE_DEFAULTS=1`):

  | `related-grid-delay.html?delay=` | base                 | head                                  |
  | -------------------------------- | -------------------- | ------------------------------------- |
  | 0, 300, 800, 1500, 3000 ms       | real HLS in all five | real HLS in all five, no card pressed |

  **Mutations this round** (`mutate2.mjs`, each restored; the first batch
  overlapped a second run on the same file and was repeated alone, so only the
  repeated results are quoted): press check removed, 3 failed (the delay cases);
  `hasPlayable` check removed, 1 (the autostart page); nudge reduced to "when
  nothing moved", 2; nudge removed, 4; minimum size removed, 1 (the header bar);
  scroll back to the first match, 2. **`behavior: 'instant'` on the nudge is not
  pinned**: a plain `scrollBy(0, 400)` on a smooth-scrolling page still reaches
  the 300 px threshold in every layout here, so that mutation survives.

  **Not covered, unchanged from round 2.**

- 2026-10-07 — **Decided by the owner, after gate 3** (`1a224b86`, CONCERNS).
  Question: the `pressed` flag that skips the box click is set by any
  `PLAY_SELECTORS` hit (substring matches: `aria-label*='play'` catches
  "Autoplay" and "Play slideshow", `data-testid*='play'` catches
  `display-name`), by a bare "Watch" link through `PLAY_TEXT`, and by a press in
  any frame including a cross-site ad. On a click-only player box the stream at
  `092fc118` becomes `NO_MEDIA_FOUND`, 3 of 3; nothing is lost against `main`,
  and the round 3 entry above states the cost as "a play button that does
  nothing". Options: **A**, narrow what counts as a press now (the gate's option
  A); **B**, record it and file a downloader ticket with the gate's fixtures as
  its reproduction (gate 3's recommendation); **C**, accept it and correct the
  Log's stated cost. **The owner chose B.** No code changed on this branch for
  it; [dl-100](./dl-100-a-click-only-player-box-is-skipped-after-an-unrelated-play-press.md)
  was filed for it, `needs-decision`. Gate 3's low, the 200x120 minimum's
  docstring overclaiming, stays recorded and unfixed by the severity floor.
