---
id: dl-139
tool: downloader
title: A player iframe that only gets its source when a server tab is pressed stays blank, so the page reads NO_MEDIA_FOUND
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-139 — A player iframe that only gets its source when a server tab is pressed stays blank

## Why

Seen in dev on 2026-11-15 against a WordPress video page. Its player is a
third-party embed (a video host's `/e/<id>` page), and the page shows a row of
server tabs ("Player 01", "Player 02") above it. Three analyses in a row failed,
taken from `probe_outcomes`:

| Run (UTC) | `PROBE_TIMEOUT_MS` | yt-dlp                   | browser                  | direct                  | outcome          |
| --------- | ------------------ | ------------------------ | ------------------------ | ----------------------- | ---------------- |
| 17:01:36  | 45 000             | `NO_MEDIA_FOUND`, 19.3 s | `TIMEOUT`, 25.0 s        | —                       | `TIMEOUT`        |
| 17:05:59  | 90 000             | `NO_MEDIA_FOUND`, 19.2 s | `UNREACHABLE`, 27.8 s    | —                       | `UNREACHABLE`    |
| 17:06:45  | 90 000             | `NO_MEDIA_FOUND`, 11.6 s | `NO_MEDIA_FOUND`, 14.2 s | `NO_MEDIA_FOUND`, 0.3 s | `NO_MEDIA_FOUND` |

The first run looked like a budget problem: yt-dlp used 19 s of the 45 s the
whole chain shares (`registry.ts`). Raising the limit to 90 s (temporarily, with
the ceiling patched locally) ruled that out. The browser tier finished in 14 s
well within budget and had seen nothing to capture.

**The page never loads its player until a tab is pressed.** Each player is an
iframe whose real address is stored base64-encoded in a data attribute, and the
page's script copies it into `src` only on a tab press:

```html
<button class="player-btn active" data-player="4">Player 01</button>
<button class="player-btn" data-player="6">Player 02</button>
<div class="player-wrap">
  <iframe
    id="player-4"
    class="player-frame"
    src="about:blank"
    data-enc="aHR0cHM6Ly9…"
    loading="lazy"
    title="Video player 4"
  ></iframe>
</div>
```

Measured with Playwright on the live page, same day:

- after `domcontentloaded`, the `load` event and 5 s, both iframes are still
  `src="about:blank"`, with no `<video>` in any frame and no media request;
- scrolling the iframe into view leaves `src` at `about:blank`. A lazy-load
  plugin marks it `litespeed-loading`, but its own source attribute is also
  `about:blank`;
- pressing "Player 01" sets `src` to the decoded embed URL at once, and the
  frame navigates (cross-site, to a mirror domain of the host);
- the embed URL on its own, pasted into the dev API's `POST /api/probe`,
  resolved through the browser tier in 13 s: one HLS variant, 720p50,
  H.264 + AAC, no DRM.

So the browser tier reaches the page and the player is fine; what is missing is
the press. `clickPlayerBox` (dl-81) clicks the centre of the largest player-ish
box, which here is the blank iframe, and a click there does nothing.
`PLAY_SELECTORS` and `PLAY_TEXT` do not match "Player 01". The workaround today
is to find the embed URL by hand and paste it, which nobody using the UI can be
expected to do.

## Decision — answered 2026-11-15 by the owner

**Answer: A**, over B, C and D, as recommended. It was put to the owner through the
orchestrator's checkpoint with the four options below and A first. No
recommendation was overridden.

How should the browser tier reach a player that stays blank until a server tab
is pressed?

- **A. Press a server tab (recommended).** When the top frame holds a visible,
  player-ish iframe whose `src` is empty or `about:blank`, press one visible
  control on the page's own origin that reads like a server tab. That means a
  label matching `player|server|source|mirror|host` followed by a number or an
  ordinal, or a `data-player` / `data-server` / `data-source` attribute.
  Prefer the one marked active, otherwise the first. It is general: tabbed
  mirrors are a common shape on embed-aggregator pages, and nothing needs to
  know how a site encodes its URLs. It is one more press on the user's behalf,
  in the same class as consent (dl-82) and play labels, and it stays on the
  page's own origin as `isScriptableFrame` already requires for text presses.
  Risk: a nav link labelled "Server 2" on an unrelated page. The guards are the
  blank-iframe precondition and the existing departure guard.
- **B. Decode and follow, no press.** Read the `data-*` attributes of a blank
  player iframe. If one base64-decodes, or is already, an `http(s)` URL, set it
  as the iframe's `src` in the page (or probe it as a second navigation, through
  the SSRF guard). No click is made, but it only works for sites that store the
  address in the DOM. A site that fetches it on press (an XHR to
  `admin-ajax.php`, common on WordPress) is not reached at all.
- **C. A, then B** when no control matches. Covers both shapes, and costs both
  implementations and both sets of fixtures.
- **D. No resolver change; say it in the UI.** When the tier ends
  `NO_MEDIA_FOUND` with a blank player-ish iframe on the page, return a hint
  telling the user to open the player itself and paste its address. Cheapest,
  but it leaves the hand work this ticket exists to remove.

Recommended: **A**. It covers this page and the XHR variant that B misses, and
it adds no new kind of action, only a new label to an existing kind.

## Build

Written for option A, which the owner chose.

1. **Fixtures**, in `resolvers/test/fixtures/pages/`:
   - `player-tabs-blank-iframe.html`: the shape above, two tabs and two
     `about:blank` iframes with `data-enc`. A tab's click handler decodes it
     into `src`, and nothing else ever sets it. The embed it points at lives on
     `{{SECONDARY}}`, a different site, as the existing cross-origin fixtures
     do.
   - `player-tabs-embed.html` on `{{SECONDARY}}`: requests
     `/media/related/master.m3u8` the way the live embed did. **Measure first**
     whether the live embed fetches its manifest on load or only after a click
     in its frame. On its own as the top frame it needed provoke's surface
     click, and inside a cross-site frame that click goes through the locator
     API (`isScriptableFrame`'s comment). Make the fixture do what was
     measured, not the easy thing.

     > **Answered 2026-11-15 by the owner** (raised by the orchestrator at
     > intake: the live site is left out on purpose, so no builder can take the
     > measurement above). Options: (1) the embed fixture requests the manifest
     > only after a click in its frame, matching the top-frame measurement this
     > ticket already records ("it needed provoke's surface click"); (2) the
     > owner supplies the URL privately for a live measurement; (3) build both a
     > load-time and a click-time fixture. **Answer: (1)**, as the orchestrator
     > recommended; no recommendation was overridden. The Log records that the
     > in-frame behaviour was not measured live, and why. The live site is not
     > to be found or reached.

   - a negative fixture: a page with a "Server 2" nav link and no blank player
     iframe, whose link target records a beacon if pressed.
2. **The press**, in `resolvers/src/browser/provoke.ts`: a step in the top frame
   only, after `SCROLL_SCRIPT` and before `clickPlayerBox`, gated on (a) a
   visible player-ish iframe, by the `CHOOSE_VIDEO_INDEX_FN` rule, whose `src` is
   empty or `about:blank`, and (b) nothing captured yet. Press at most one
   control, then let the existing settle and capture run. If the iframe's `src`
   is still blank afterwards, do not try the next tab. One press is the
   decision, not a search.
3. **Tests**, appended at the **end** of the browser-resolver suite, not
   inserted in the middle: the tab page resolves to the stream; the negative
   page is not pressed (no beacon) and still ends `NO_MEDIA_FOUND`; a page with
   a blank iframe and no tab ends as it does today.

Traps:

- An `about:blank` frame passes `isScriptableFrame`, but the embed it becomes
  does not. Do not move the press into the subframe.
- The embed redirected cross-site on navigation (host → mirror). Capture is per
  context, so the request is still seen, but a test that waits on a frame URL
  will not match.
- `MARK_PLAYER_BOX_SCRIPT` deliberately excludes iframes. Leave that rule alone.
  This is a different control, not a box click.

## Done when

- The tab fixture resolves to the `related` HLS stream through the real
  `BrowserResolver`, and its tab-click beacon shows the press happened.
- The negative fixture's beacon is never requested, and it ends
  `NO_MEDIA_FOUND`.
- The existing resolver suite passes unchanged.

## Log

- 2026-11-15 — Filed from a dev session. The live page, its embed host and the
  video are left out on purpose, since this repository is public. The
  measurements above are the reproduction, and the fixture in Build is how a
  builder recreates it without the live site. The temporary 90 s limit was
  reverted the same session.
- 2026-11-15 — Built (option A). `pressServerTab` and its two scripts are in
  `resolvers/src/browser/provoke.ts`; `provokeFrame` calls it in the top frame
  only, after the scroll and before the play selectors, once per probe
  (`serverTab.attempted` is shared by both passes and set when a control was
  found, whether or not the page then loaded the player), and only while
  `hasPlayable()` is false. It does not count as a play press, so the box click
  is not held back by it. Fixtures in `resolvers/test/fixtures/pages/`:
  `player-tabs-blank-iframe.html` (primary; two tabs, two blank iframes, the
  address base64 in `data-enc`, set into `src` only by a tab's handler),
  `player-tabs-embed.html` (`{{SECONDARY}}`), `player-tabs-nav-no-iframe.html`
  and `player-blank-iframe-no-tab.html`. Three tests, appended at the end of
  `browser-resolver-press-targets.test.ts` (the browser-resolver suite was
  split by dl-117, and that file is the one about what the press reaches).
  - **The in-frame behaviour of the live embed was not measured.** The brief
    said to measure first whether the live embed fetches its manifest on load or
    after a click in its frame. The live site is left out of this public
    repository on purpose, so no builder can take that reading, and the owner's
    answer (2026-11-15, option 1) was to model it as the top-frame measurement
    already recorded here: the embed requests its manifest only after a click in
    its frame. The fixture does that and not the easy thing: no request on load,
    none on `.play()` either, and its `<video>` (300x170) is smaller than its
    frame (640x360), so the click a wrapper's centre would make lands on an empty
    body and only the surface click at the video's corner can start it.
  - **The click inside the cross-site frame reached it, with no change to
    provoke's surface click**: `clickChosenVideo`'s non-scriptable branch
    (`frame.locator("video").nth(i).click`) did it. Mutation, committed first and
    restored by `git checkout 9a689b3f -- <file>`: making that branch return
    early turns the first test red (`No downloadable video stream was found`).
    Other mutations, each one test red and the other two green: the press
    disabled (`if (false && …)`) reds the tab test; the blank-iframe precondition
    removed reds the "no blank player iframe" test (the `Server 2` button is
    pressed); the leaving-link rule disabled reds the "no tab to press" test
    (the link's beacon is requested).
  - **Two things the brief said that the code does not bear out.** `Build`'s Trap
    says `MARK_PLAYER_BOX_SCRIPT` "deliberately excludes iframes", and its doc
    comment says so too, but by reading the script it excludes them only by not
    naming `iframe` in its selector: an `<iframe>` whose class or id contains
    "player" (the page's `class="player-frame"`) matches
    `[class*="player"], [id*="player"]` and is a candidate, so the box click can
    land on a player iframe's centre. Not measured, and left alone as the Trap
    asks; the embed fixture's small video is what keeps the test from depending
    on it. Second, the brief's "after `SCROLL_SCRIPT` and before
    `clickPlayerBox`" is two different functions: the press is in `provokeFrame`
    after the scroll, and `clickPlayerBox` is in `provokeInput` after pass 0, so
    "before" holds by construction.
  - **A link is a tab only if it stays on the page** (its address is the page's
    own, a fragment of it, or `javascript:`), and a `target=_blank` link never
    is. The brief names only the "nav link labelled Server 2" risk and the two
    guards; this is a third one, cheap and covered by the third test.
  - Runs at `9a689b3f`: `npx vitest run
    tools/downloader/resolvers/test/browser/browser-resolver-press-targets.test.ts`
    → 22 of 22 passed (the file's 19 existing tests and the 3 new), 49.5 s;
    `npm run check` exit 0. The rest of the browser tier is CI's to read on the
    draft.
  - Fold-in: none made. No other small, already-specified piece became free.
