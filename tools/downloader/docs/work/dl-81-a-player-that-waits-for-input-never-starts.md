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
  gave `Tests 7 failed | 4 passed | 344 skipped (355)`. The seven red are the
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
  commits: d1ec2c61 (the original, written with no rationale in the comment),
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
