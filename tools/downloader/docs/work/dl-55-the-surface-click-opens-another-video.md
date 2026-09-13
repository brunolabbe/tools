---
id: dl-55
tool: downloader
title: The browser tier clicks the first video element on a page, and returns the stream of whatever page that click opened
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-55 — The surface click opens another video

**Packages:** `resolvers` (the provocation step, the metadata read and the
browser resolver), and a fixture page beside the existing ones.

**The site and the page are deliberately not named anywhere in this ticket**,
on the owner's instruction, as in dl-48. The failure is a page shape, and the
fixture below reproduces that shape locally.

## Why

**A video page on a video-search site probes successfully and returns a
different video.** Nothing in the response says so. A download from it would
hand the user the wrong file. Reproduced on 2026-09-13:

- **`POST /api/probe` answered 200 in 22.8 s** from the browser tier, with 6
  renditions of a 719.7 s stream. The probe's title belonged to a different
  video than the one the pasted page shows.
- **The pasted page describes a 625 s video.** Its structured data says 625 s.
  yt-dlp, given the canonical link to that video, which the page also carries,
  returns 625 s. That video lives at a different CDN object id from the one in
  the probe.
- **A plain visit plays the right video.** Three bare Playwright Chromium
  visits, outside the downloader, loaded the page's embedded player, and every
  one requested the page's own CDN object. The page title matched the video
  each time.
- **`provokePlayback` is what changes it.** The resolver's own
  `provokePlayback` was run from the build against the same page, with
  `Locator.prototype.click` wrapped to log each target:

  | Time  | Event                                                                                  |
  | ----- | -------------------------------------------------------------------------------------- |
  | 1.1 s | Page title names the pasted page's video                                               |
  | 2.5 s | Surface click: `locator('video').first()` hits a `<video>` inside a related-video card |
  | 2.6 s | Top frame navigates in-app to a **different video's page** on the same site            |
  | 7.2 s | That page's embedded player requests the CDN object the probe returned                 |
  | 13 s  | `readMetadata` reads the title of the other video, which is what the probe reported    |

**The mechanism is two gaps, each sufficient on its own:**

1. **The surface click picks the first `<video>` in document order, and forces
   it.** `provokeFrame` runs `frame.locator("video").first()`, then
   `click({ force: true, position: { x: 5, y: 5 } })`. On this page the player
   is a cross-origin iframe, so the top document holds no player `<video>` at
   all. The first `<video>` there is a muted hover preview inside a
   related-video link. `force` skips Playwright's actionability checks, so
   nothing stops a click on an element that is not the player.
   `METADATA_SCRIPT`'s duration fallback,
   `document.querySelector('video, audio')`, has the same first-element trap.
2. **Nothing notices that the page left.** `BrowserResolver` reads
   `page.url()` into `finalUrl` after the quiet wait. It uses that URL only to
   rank hits and to build the `Referer`, and never compares it with the page it
   loaded. Every hit collected after the navigation belongs to another page.

dl-48 already stated the principle and applied it to one control: "a stream
reached through [a call to action] is the wrong stream". This ticket applies it
to the surface click, and to navigation in general.

### Decided by the owner, 2026-09-13

Chosen from options:

- **Both layers, not either alone.** The selection fix makes this page return
  the right video. The navigation guard stops the next click that navigates,
  from any step (a play-text match, a close control, a gate), from turning
  into a wrong download. A guard alone would make this page return no video at
  all. Selection alone would leave every other navigating click unnoticed.

### Adopted rather than asked, and why

- **A detected navigation fails the probe as `NO_MEDIA_FOUND`**, rather than
  going back and retrying. The code's copy ("No downloadable video stream was
  found on that page.") is true of the pasted page. `NO_MEDIA_FOUND` falls
  through to the next tier, as the registry intends, and no new code is needed.
  A retry loop would spend a deadline that `provokePlayback` already shares
  between four steps.

## Build

1. **Choose the player, not the first video, in
   `resolvers/src/browser/provoke.ts`.** Replace the surface click's
   `frame.locator("video").first()` with a chosen element:
   - Only a visible `<video>` with no `a[href]` or `[role='link']` ancestor.
   - Of those, the one with the largest rendered area.
   - No candidate means no surface click. That is the correct result on a page
     whose player is in another frame: the frame loop reaches that frame
     anyway.
   - Keep `force` only if the chosen element needs it, and say why in a
     comment. `force` is what let a covered card be clicked here.
   - Mark the chosen element the way `MARK_CLOSE_SCRIPT` marks a close control,
     so the click goes through the locator API. In a non-scriptable frame, use a
     locator filter with the same rule, or skip the surface click. Either choice
     gets a sentence in the Log.
2. **Use the same choice for metadata.** `METADATA_SCRIPT`'s duration fallback
   reads the chosen player's duration, not `querySelector('video, audio')`'s
   first match. Keep one chooser for both, so the two cannot drift.
3. **Guard against leaving the page, in
   `resolvers/src/resolvers/browser.ts`.**
   - Once `navigate` has settled, record the top frame's URL as the **landing
     URL**. Redirects during load are legitimate and stay allowed.
   - From `provokePlayback` onward, watch the top frame's `framenavigated`
     event. Playwright fires it for same-document history changes too, which is
     how this reproduction navigated.
   - If the top frame's URL leaves the landing URL, record the moment. A
     fragment-only change does not count; any other change does.
   - After the quiet wait, if a departure was recorded, throw `AppError`
     `NO_MEDIA_FOUND` with `details: { reason: "navigated-away" }`, plus both
     URLs passed through `redactUrl` from `@webtools/core`. This holds even if
     hits exist: a hit collected before the departure could still be a preview
     clip. Stop the quiet wait early once a departure is seen; nothing after it
     is worth waiting for.
   - Log a `warn` naming the step that was running when the page left, so the
     next page shape that trips the guard is diagnosable from the log.
4. **Tests**, beside dl-48's in `resolvers/test/browser/browser-resolver.test.ts`,
   with static pages in `resolvers/test/fixtures/pages/`:
   - **The related-card fixture.** An MSE player that starts only when its
     surface is clicked, placed **after** a related-video card in document
     order. The card is an `<a href>` to a second fixture page wrapping a
     muted `<video>`, and it overlaps the player's corner, so a forced click
     at (5, 5) on the first `<video>` would land on it. The second page plays a
     different master playlist.
   - The probe returns the first page's playlist, the second page is never
     requested, and its playlist is never in `variants`. Assert on requests the
     fixture server saw. If `fixture-server.ts` records none, add that.
   - **The guard fixture.** A page whose only play control navigates the top
     frame, once by `history.pushState` plus in-page content swap and once by
     `location.assign`, to a page that plays a stream. Both probes fail
     `NO_MEDIA_FOUND` with `details.reason === "navigated-away"`, and neither
     returns the other page's stream.
   - **The allowed cases.** A page that redirects during load (a server 302,
     then a player) still probes. So does one that changes only its fragment
     on play.
   - Revert each layer in turn and record in the Log that the matching test
     fails: selection alone reddens the first fixture, the guard alone the
     second.
5. **Docs.** `docs/00-ANALYSIS.md` §7 gains a row for a click that opens other
   content: the symptom is a probe that succeeds with another page's stream,
   and the response is `NO_MEDIA_FOUND` with `navigated-away`.

## Traps

- **The top document may have no player at all.** Here the player is a
  cross-origin iframe, and every top-level `<video>` is a card. A chooser that
  falls back to "largest video anyway" picks a card again. No candidate must
  mean no click.
- **`PLAY_SCRIPT` calls `play()` on every media element in a scriptable
  frame**, cards included. That does not navigate, but a hover preview is an
  `.mp4` request the collector may count as a hit. Not measured in this
  reproduction: the stream that won was the other page's player. If the
  related-card fixture shows a card's clip in `variants`, apply the same
  chooser to `PLAY_SCRIPT`, and say so in the Log.
- **Same-document navigation is still navigation.** This page changed videos
  without a new document. A guard that listens only for document loads, or
  compares only `page.url()` before and after, misses it or catches it only by
  luck.
- **Query strings carry video ids** (`watch?v=`). Ignoring the query in the
  comparison would miss a whole family of sites. If a real player turns out to
  rewrite its own query on play (say `&t=0`), the answer is a fixture and a
  narrow exception with a Log entry, never a looser comparison.
- **This environment's DNS sinkholes analytics hosts.** The reproduction's API
  log had `BLOCKED_TARGET` warnings for trackers resolving to `0.0.0.0`,
  unrelated to the failure, as in dl-48. Do not loosen the guard on their
  account.
- **The deadline.** The chooser is one evaluation per frame. Do not probe
  elements one round trip at a time; `visibleQuery`'s comment explains what
  that costs.

## Done when

- The surface click never targets a `<video>` inside a link, picks the largest
  visible candidate, and makes no click when there is none (related-card
  fixture test).
- The duration fallback in `readMetadata` uses the same chooser (unit or
  fixture test naming it).
- A top-frame navigation away from the landing URL during provocation or the
  quiet wait fails the probe `NO_MEDIA_FOUND` with `navigated-away`, for both
  `pushState` and a document navigation (guard fixture tests). A load-time
  redirect and a fragment-only change do not trip it.
- Each layer's test fails with that layer reverted, recorded in the Log.
- The analysis §7 table carries the new row.
- `npm run check` and `npm test -- --project downloader` pass. If the builder
  can reach the original page, a probe with `ENABLE_YTDLP_RESOLVER=false`
  that returns a 625 s stream is worth a Log line. Ask the owner for the page:
  it is not in this repo.

## Log

**2026-09-13 — filed** from a reproduction the owner asked for, while
investigating why the same page shows no preview image (that half is dl-56).
The probe ran against the dev API from a checkout at `82e7801`. The click trace
ran `provokePlayback` from a build of `origin/main` `1835657`. No commit
between the two touches `tools/downloader`. Facts checked against the code at
`1835657`:

- `provokeFrame` clicks `frame.locator("video").first()` with
  `{ timeout: 1500, force: true, position: { x: 5, y: 5 } }` after
  `PLAY_SELECTORS` and `PLAY_TEXT`, then evaluates `PLAY_SCRIPT` in scriptable
  frames.
- `METADATA_SCRIPT` reads duration from `document.querySelector('video, audio')`.
- `BrowserResolver.resolve` reads `const finalUrl = page.url()` after
  `waitForQuiet` and `collector.settle`, and uses it in `rankHits`,
  `classifyFailure` and `buildRequestContext`. Nothing compares it to the
  requested or landing URL.
- The probe's `requestContext` `Referer` was the embedded player's origin, so
  the winning hit came from the second page's player iframe, not the top frame.
