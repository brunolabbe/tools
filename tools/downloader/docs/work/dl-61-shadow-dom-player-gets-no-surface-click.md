---
id: dl-61
tool: downloader
title: A player inside an open shadow root gets no surface click
kind: fix
status: ready
milestone: null
depends_on: [dl-55]
---

# dl-61 — A player inside an open shadow root gets no surface click

## Why

dl-55 replaced the surface click's `frame.locator("video").first()` with a
chooser built around `document.querySelectorAll('video')`
(`CHOOSE_VIDEO_INDEX_FN` in `resolvers/src/browser/provoke.ts`), to stop the
click from landing on a related-video card ahead of the real player.
`querySelectorAll` does not descend into an open shadow root; the locator it
replaced did, since Playwright's locator engine is shadow-piercing by
default. A page whose player lives inside a shadow root — a common pattern
for a custom `<video-player>` web component — now gets no surface click at
all.

Found and reproduced by dl-55's round-3 gate (`ticket-reviewer`, Opus), while
checking the cross-origin chooser dl-55 added; not part of what that round
set out to test. **Never a wrong video** — the probe falls through to
`NO_MEDIA_FOUND`, the same code the registry already uses to try the next
tier, not a stream belonging to some other page. The owner decided to file
this rather than block dl-55 on it, on the reviewer's own recommendation.

### Reproduction, 2026-09-15

Fixture: a page whose only content is
`document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
'<video id="sv" width="640" height="360" muted playsinline></video>'`, with a
`click` listener on the shadow video that fetches a playlist. No other
video, no play button, no matching text.

- **`origin/main`'s `provoke.ts`/`browser.ts`** (before dl-55): returns the
  stream, both with the fixture served same-origin and with it embedded in a
  genuinely cross-origin iframe.
- **dl-55 at `d8aced1`**: `NO_MEDIA_FOUND` for both.

## Build

1. In `resolvers/src/browser/provoke.ts`, make `CHOOSE_VIDEO_INDEX_FN`'s
   candidate list shadow-piercing. `document.querySelectorAll('video')` only
   sees light-DOM video elements; a recursive walk (`element.shadowRoot`,
   entered when open, skipped when closed or absent) is needed to match what
   the locator API already does by default.
2. **Keep the chosen index aligned with the locator's own order** — the
   reviewer's own constraint on dl-55's cross-origin path. `clickChosenVideo`
   marks the scriptable-frame choice with `VIDEO_MARK` and clicks it through
   `frame.locator(`[${VIDEO_MARK}]`)`, which is shadow-piercing regardless
   and needs no index; the cross-origin branch clicks
   `frame.locator("video").nth(index)`, where `index` has to mean the same
   position in Playwright's own (also shadow-piercing) match order as it
   does in whatever list this ticket's candidate walk produces. Getting the
   two orders to disagree would silently misalign the click again, on a
   different page shape than dl-55's own gate found.
3. `METADATA_SCRIPT`'s duration fallback calls `CHOOSE_VIDEO_FN`, which
   shares `CHOOSE_VIDEO_INDEX_FN` — no separate change needed there once the
   candidate walk itself is shadow-piercing.
4. **Tests**, beside dl-55's in `resolvers/test/browser/browser-resolver.test.ts`:
   a fixture with a click-started player inside an open shadow root and no
   other candidate, probed both same-origin and (reusing dl-55's
   `FixtureServer.secondaryOrigin`) from a genuinely cross-origin frame.
   Revert the shadow-piercing walk and record in the Log that both tests go
   red.
5. A closed shadow root is out of scope — nothing in the DOM can see inside
   one, locator API included, so there is no behavior to match.

## Done when

- The reproduction above returns the stream, same-origin and cross-origin.
- Reverting the shadow-piercing candidate walk reddens both new tests
  (fixture test file:line noted in the Log).
- `npm run check` and `npm test -- --project downloader` pass.

## Log

**2026-09-15 — filed** from dl-55's round-3 gate, which found and reproduced
this while checking a different fix on the same branch. Not built against;
`depends_on: [dl-55]` since the regression is dl-55's own chooser.
