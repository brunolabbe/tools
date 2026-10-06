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
