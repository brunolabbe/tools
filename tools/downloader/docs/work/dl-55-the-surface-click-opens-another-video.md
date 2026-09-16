---
id: dl-55
tool: downloader
title: The browser tier clicks the first video element on a page, and returns the stream of whatever page that click opened
kind: fix
status: done
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

### Decided by the owner, 2026-09-15 (answering the round-2 gate's open decisions)

Three decisions the round-2 gate (`38df521`) sent to the orchestrator, put to
the owner quoting this ticket's own lines 111, 116 and 171-172. Recorded here
so dl-56's builder does not reopen any of them.

1. **Play-time URL rewrites.** Question: should a page that adds, changes or
   removes a query parameter on play (the Traps section's own example, `&t=0`)
   count as leaving the page? Options: **A**, the reviewer's recommendation —
   keep the comparison strict and record the cost in the Log; **B** — narrow
   exceptions now for named play-time parameters; **C** — ignore same-path
   query changes generally, which the Traps section (lines 171-172) already
   forbids ("never a looser comparison"). **The owner chose B**, overriding the
   reviewer's recommendation, narrowed to exactly `t`, `start` and `autoplay`:
   same origin, same path, and only those three query keys (plus the fragment,
   as before) may differ. An SPA rewriting its own _path_ for the same clip is
   explicitly **not** covered and still counts as a departure — that cost is
   paid, not answered, by this decision; see the Log for the number.
2. **The landing-URL remedy.** Question: when should the landing URL be read,
   so a page's own post-load lifecycle (a script redirect, a router stripping
   a tracking parameter) is not mistaken for a click that opened something
   else? Options: **A**, the reviewer's recommendation — read it later, at
   `load` (budgeted) or just before the first provocation click; **B** — count
   a departure only when it follows one of the tier's own clicks. **The owner
   chose A**, and left which of the two readings of "later" to the builder,
   to be justified in the Log. The builder chose "at `load`, budgeted" — see
   the Log for why `load` alone was not sufficient either, and what was built
   instead.
3. **The cross-origin chooser.** Question: now that "a cross-origin frame has
   no evaluation context" is known to be false (round-2 gate, low finding),
   should the surface click's chooser in such a frame use the same
   visible/no-link-ancestor/largest-area rule as everywhere else? Options:
   **A**, the reviewer's recommendation — yes, through one read-only round
   trip, relaxing the scriptable-frame policy for this one check; **B** — keep
   the CSS-selector fallback (first-in-document-order) as a narrower policy
   call; **C** — skip the surface click in a cross-origin frame entirely. **The
   owner chose A.**

### Decided by the owner, 2026-09-15 (answering the round-3 gate's two open decisions)

Two more decisions, from the round-3 gate (`d8aced1`) built on the answers
above. Recorded here for the same reason: so a later builder does not reopen
either.

4. **The shadow-DOM regression.** Question: round 3's gate found that a
   player inside an open shadow root gets no surface click on this branch,
   where `origin/main` (before dl-55) reached it — `CHOOSE_VIDEO_INDEX_FN`'s
   `document.querySelectorAll('video')` does not pierce a shadow root, and
   the `frame.locator("video").first()` it replaced did. Never a wrong
   video: the probe falls through to `NO_MEDIA_FOUND`. Fix here, with a
   narrow round 4, or file and ship? Options: **A**, the reviewer's
   recommendation — file a follow-up ticket and ship; a correct fix needs its
   own fixtures to keep the chosen index aligned with Playwright's own
   shadow-piercing locator order, real scope rather than a quick patch; **B**
   — fix it on this branch now. **The owner chose A.** The orchestrator told
   the owner plainly that dl-55 introduces the regression and that it is a
   coverage loss, never a wrong stream. Filed as
   [dl-61](./dl-61-shadow-dom-player-gets-no-surface-click.md),
   `depends_on: [dl-55]`.
5. **Reordered query parameters.** Question: `sameDocument` sorts both sides'
   query parameters before comparing, so `?v=abc&list=PL1` and
   `?list=PL1&v=abc` compare equal — not a deliberate choice, just how
   `URLSearchParams.sort()` happens to behave, and not separately called out
   when decision 1 was built. The round-2 gate's open-decision text (as the
   orchestrator relayed it) listed "any query change" as a departure; the
   owner's actual words, decision 1 above, named only `t`, `start` and
   `autoplay` as allowed to differ and said nothing about order. Accept the
   current behaviour, or drop the sort (a narrow round 4, a new fixture)?
   Options: **A**, the reviewer's recommendation — accept: a reorder changes
   no parameter's value, so it reads as within the owner's own framing of
   decision 1 rather than outside it; **B** — treat a reorder as a departure.
   **The owner chose A.** The orchestrator told the owner that "any query
   change must depart" was its own assumption relaying the round-2 finding,
   not the owner's wording. A spec pins this: reordering
   `?v=abc&list=PL1` still returns the stream (Log).

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
     is worth waiting for. `resolvers` does not depend on `@webtools/core`
     today, so add it to `resolvers/package.json`'s `dependencies`;
     `packages/core/test/image-closure.test.ts` fails by name if it is missing.
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
     requested, and its playlist is never in `variants`. Assert on the `requests`
     list `fixture-server.ts` already keeps.
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

## Review

### Gate round 1 — FAIL, 2026-09-14, `95c6403...fc8be9e`

Defect hunt run by the reviewer itself (Opus; builder Sonnet), at medium. Findings: one unproven Done-when line (the surface-click test survived disabling the link filter, the largest-area rule, the no-candidate rule and the click itself); med, a script redirect after DOMContentLoaded trips the guard; med, the cross-origin fallback rested on a false claim of no evaluation context; low, the departure warning was untested; three open decisions. The full report with reproductions is on the pull request thread. The builder reproduced all four findings and answered in `16084d2` (Log, gate round 1, answered).

### Gate round 2 — CONCERNS, 2026-09-14, `95c6403...16084d2`

Defect hunt over `fc8be9e...16084d2` run by the reviewer itself (Opus), at medium; every round-1 finding re-checked at the new tip.

| Done when                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The surface click never targets a video inside a link, picks the largest visible candidate, and makes no click when there is none                                 | proven — link: `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:271 "/related-card.html"` (link check deleted: red); largest: `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:292 "/related-card-area.html"` (first-qualifying instead: red); no click: `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:304 "/related-card-only-linked.html"` (fall back to any video: red). Both click-started fixtures go red with the surface click deleted                                                                                                                                                                                                                     |
| The duration fallback in `readMetadata` uses the same chooser                                                                                                     | proven — `tools/downloader/resolvers/test/browser/provoke.test.ts:51 "expect(durationSec).toBe(942)"`; reverting `tools/downloader/resolvers/src/browser/provoke.ts:328 "var media = chooseVideo()"` gave expected 30 to be 942 (run at `fc8be9e`; the anchor is the same line's content, moved to 328 by the round-3 decision-3 refactor above it)                                                                                                                                                                                                                                                                                                                                                                     |
| Navigation away fails `NO_MEDIA_FOUND` / `navigated-away` for pushState and a document navigation; a load-time redirect and a fragment-only change do not trip it | proven, with a finding — `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:319 "a same-document navigation (history.pushState)"` and `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:332 "a document navigation (location.assign) never returns"` (guard disabled: both red); `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:384 "/guard-fragment.html"` (fragment kept in the comparison: red); `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:368 "a redirect during load is not a departure, and the page still probes"` covers the server 302 that Build step 4 names. A script redirect after DOMContentLoaded does trip it: first finding |
| Each layer's test fails with that layer reverted, recorded in the Log                                                                                             | verified — re-run by the reviewer at both tips; at `16084d2` every chooser revert and the warn revert are red (see above). The Log records them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The analysis §7 table carries the new row                                                                                                                         | verified — `tools/downloader/docs/00-ANALYSIS.md:291 "Click opens other content"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check` and `npm test -- --project downloader` pass                                                                                                       | verified — at `16084d2`: check exit 0; 76 files / 1274 tests, exit 0; citations-gate against origin/main exit 0. No existing test assertion deleted or reworded. Live probe not attempted: the page is not named in the repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **med** · **A script redirect or router rewrite after DOMContentLoaded trips the guard.** `tools/downloader/resolvers/src/resolvers/browser.ts:323 "const landingUrl = page.url();"` is read as soon as goto resolves at domcontentloaded. A `location.replace` 200 ms after `load`, and a `history.replaceState` stripping `utm_source` 300 ms after parse, each give `navigated-away` here; with main's resolver files swapped in, the same pages return the stream. Reproduced independently by the builder, who traced main's success to the second provocation pass landing on the redirected page. Build step 3 says "Redirects during load are legitimate and stay allowed." The server-302 test also passes with the landing URL set to the requested URL, so it does not test the landing choice. Remedy: open decision 2. **Round 3 fixed this — see the Log — by reading the landing URL after `waitForPageLoad` instead of at domcontentloaded, so the line's own position moved even though its text did not.**
- **med** · **In a cross-origin frame the chooser still clicks the first video, not the largest.** The `NON_CARD_VIDEO_SELECTOR` constant in `tools/downloader/resolvers/src/browser/provoke.ts` at the reviewed commit `16084d2` (line 230). A cross-origin frame with a JS-click card (a div with an onclick) ahead of a larger click-started player returns the card's stream here and on main, and the top-frame guard does not see a subframe navigation. The same markup same-origin returns the right stream here. Not a regression and not acceptance-covered. The false claim of no evaluation context is corrected in `16084d2`; the choice of behaviour is open decision 3. **Round 3 fixed this — the constant is gone, folded into `CHOOSE_VIDEO_SCRIPT` — see the Log.**
- **low** · the `NON_CARD_VIDEO_SELECTOR` docstring says the gate found the reviewer's own claim false. The false claim was the builder's, and the reviewer measured it. The docstring also still said a size comparison needs a round trip per candidate where evaluate is allowed; `locator.evaluateAll` returned both widths in one call. Addressed after the gate, in the commit that carries this record — see the Log.
- **open decision 1** · players that rewrite their own URL on play (pushState `?t=0`, replaceState `?autoplay=1`, an SPA path rewrite) returned the right stream on main and give `navigated-away` here. Build step 3 and the Traps section mandate it; the owner's Decided section does not. A (recommended) keep and record the cost in the Log; B narrow exceptions now for named play-time parameters; C ignore same-path query changes, which the Traps section forbids.
- **open decision 2** · the landing-URL remedy. A (recommended) take the landing URL at `load` (budgeted) or just before the first provocation click, and add a script-redirect fixture; B count a departure only when it follows one of the tier's own clicks.
- **open decision 3** · the cross-origin chooser. A (recommended) the same rule through one `evaluateAll` round trip, relaxing the script policy for a read-only check; B keep the CSS fallback; C skip the surface click there, which loses a click-started player alone in a cross-origin frame.
- **resolved from round 1** · the surface-click tests now discriminate each clause, and the departure warning is asserted (`tools/downloader/resolvers/test/browser/browser-resolver.test.ts:357 "toMatch(/left the landing page/i)"`; warn neutralised: red).
- **dropped** · ticket-mandated, no action proposed. A JS-click card larger than the player, a player inside `role=link`, and a player inside `a href=#player` each return no video here where main returned the stream; all follow Build step 1's rule, and none returns a wrong video.
- **findings** · round 2 re-checked round 1's 5 carried findings: 3 resolved (the surface-click clauses, the warn test, the false comments), 2 still carried (the redirect, the cross-origin behaviour). The hunt over `fc8be9e...16084d2` returned 1 new, carried as low. Round 1's open decision and dropped line still stand. 0 dropped this round.
- Invariants: existing AppError code, redaction, contract untouched, new specs under the downloader glob, no new workspace dependency. Skipped as untouched: shell and process trees, SSRF, progress, cross-tool imports.
- NFR: security ✓ · performance ✓ · reliability — first finding, open decision 1 · maintainability — the low.

**Transcription disclosure:** the block above was drafted by `ticket-reviewer` (agent `a0701174359ad2606`) and relayed to the builder by message; the reviewer could not write to this file directly ("file writes were refused here") and asked the builder to commit it verbatim. Committed unedited except for this note and the low finding's "addressed after the gate" sentence, added by the builder per the reviewer's own instruction. The builder also fixed the low (the `NON_CARD_VIDEO_SELECTOR` docstring's attribution and round-trip claim) after this block was drafted, keeping the docstring's line count unchanged so the citations above still resolve — see the Log's "gate round 2" entry.

**Second edit, 2026-09-15 (round-3 gate, low finding):** round 3's own diff moved or deleted three of this block's citations. The `provoke.ts` duration-fallback citation in the second Done-when row was content-unchanged but moved a few lines down by round 3's own refactor above it, so its line number was updated to match. The two citations naming `browser.ts`'s old landing-URL read and `provoke.ts`'s deleted `NON_CARD_VIDEO_SELECTOR` constant, in the two "med" bullets, now describe code that no longer exists or no longer reads that way on the current tip, so each was pinned to the commit it was true of (`@16084d2`) instead. The two round-2 "med" bullets each gained one bold sentence naming that pin and pointing at the Log. The low bullet describing the `NON_CARD_VIDEO_SELECTOR` docstring had its tense corrected, past instead of present, since round 3 deleted that docstring along with the constant. None of this changed what the reviewer found or concluded; each edit keeps a citation true to the commit it describes, disclosed here as the reviewer's round-3 low finding asked.

### Gate round 3 — CONCERNS, 2026-09-15, `95c6403...d8aced1`

Defect hunt over `16084d2...d8aced1` run by the reviewer (Opus), narrowed to the owner's three decisions plus one shadow-DOM check; rounds 1 and 2 not re-swept.

| Done when                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The surface click never targets a video inside a link, picks the largest visible candidate, and makes no click when there is none                                 | proven — `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:271 "/related-card.html"`, `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:292 "/related-card-area.html"`, `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:304 "/related-card-only-linked.html"` (per-clause reverts red at `16084d2`; these tests and fixtures are unchanged since)                                                                                                                                                                                                                                                                                                                                                                                    |
| The duration fallback in `readMetadata` uses the same chooser                                                                                                     | proven — `tools/downloader/resolvers/test/browser/provoke.test.ts:51 "expect(durationSec).toBe(942)"`; `tools/downloader/resolvers/src/browser/provoke.ts:328 "var media = chooseVideo()"` (revert red at `fc8be9e`; content unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Navigation away fails `NO_MEDIA_FOUND` / `navigated-away` for pushState and a document navigation; a load-time redirect and a fragment-only change do not trip it | proven — `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:319 "a same-document navigation (history.pushState)"`, `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:332 "a document navigation (location.assign) never returns"`, `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:384 "/guard-fragment.html"`; load-time redirects `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:395 "/guard-script-redirect.html"` and `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:406 "/guard-router-rewrite.html"` (load wait removed: both red) and `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:421 "/guard-redirect-then-fragment"` (landing URL set to the requested URL: red) |
| Each layer's test fails with that layer reverted, recorded in the Log                                                                                             | verified — re-run by the reviewer at `d8aced1` for every round-3 layer (below); the Log records them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The analysis §7 table carries the new row                                                                                                                         | verified — `tools/downloader/docs/00-ANALYSIS.md:291 "Click opens other content"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run check` and `npm test -- --project downloader` pass                                                                                                       | verified — at `d8aced1`: check exit 0; 76 files / 1282 tests, exit 0; citations-gate against origin/main exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

| Owner's decision, 2026-09-15                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Only `t`, `start`, `autoplay` (and the fragment) may differ       | proven — `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:429 "adding ?%s= on play is not a departure"` (key deletion disabled: 3 red) and `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:440 "a query key outside the exception is still a departure"` (widened to any query change: red), against `tools/downloader/resolvers/src/resolvers/browser.ts:613 "const PLAY_TIME_QUERY_EXCEPTIONS"`. Reviewer attacks, each `navigated-away`: `v`, `id` and `list` changed; `t` added with `v` changed; path changed; cross-origin same path; `T=0`. Adding `t`, removing `autoplay`, changing `start`: right stream. Reordering is not a departure: open decision 5 |
| 2. The landing URL is read later                                     | proven — `tools/downloader/resolvers/src/resolvers/browser.ts:316 "await waitForPageLoad(page, deadline, options.signal);"`, tested at rows above. Bounded by `tools/downloader/resolvers/src/resolvers/browser.ts:82 "const LANDING_URL_LOAD_BUDGET_MS = 1500;"` and `tools/downloader/resolvers/src/resolvers/browser.ts:93 "const LANDING_URL_SETTLE_MS = 500;"`. Measured by the reviewer only, not asserted by a spec: a page whose `load` never fires returns the stream in 7505 ms, against 6005 ms for a fast page and 5520 ms on main                                                                                                                                                        |
| 3. The cross-origin chooser uses the same rule in one read-only call | proven — `tools/downloader/resolvers/src/browser/provoke.ts:570 "const index = await frame.evaluate<number>(CHOOSE_VIDEO_INDEX_SCRIPT);"`, tested by `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:475 "/cross-origin-card.html"` (CSS first-in-order restored: red, card's stream). Read-only per `tools/downloader/resolvers/src/browser/provoke.ts:169 "const CHOOSE_VIDEO_INDEX_FN ="`: geometry, computed style and attributes. `frame.evaluate`, not `evaluateAll`; the builder's reason is not verified by the reviewer. A click-started player alone in a cross-origin frame returns its stream (reviewer)                                                                |

- **med** · **A player inside an open shadow root gets no surface click: a regression from round 1, missed by rounds 1 and 2.** `tools/downloader/resolvers/src/browser/provoke.ts:208 "var videos = document.querySelectorAll('video');"` does not enter shadow roots; main's `frame.locator("video").first()` did. A page holding only a click-started 640 by 360 `<video>` inside an open shadow root returns its stream on main, same-origin and in a cross-origin frame, and `NO_MEDIA_FOUND` on `d8aced1` for both. Never a wrong video. The remedy is open decision 4.
- **low** · the Log's round-1 note for dl-56 still says a cross-origin frame has no evaluation context and points at `NON_CARD_VIDEO_SELECTOR`, which round 3 deleted.
- **low** · two stale comments, one mechanism: the `CHOOSE_VIDEO_INDEX_FN` docstring says it runs as a `locator.evaluateAll` callback while the code calls `frame.evaluate`; and the `PLAY_TIME_QUERY_EXCEPTIONS` docstring cites ticket lines that have already moved.
- **low** · the round-2 transcription disclosure note does not name the `d8aced1` edits to the round-2 bullets (pins, added sentences, a tense change, two repointed citations). The edits themselves are sound: 13 verified, 2 pinned.
- **open decision 4** · the shadow-DOM regression. A (recommended) file a follow-up ticket and ship: the failure is `NO_MEDIA_FOUND` falling through to the next tier, and a fix has to walk shadow roots and keep the index aligned with the locator's own order, which deserves its own fixtures. B fix it on this branch, with a narrow round 4.
- **open decision 5** · a reordered query string is not a departure (`tools/downloader/resolvers/src/resolvers/browser.ts:635 "leftParams.sort();"`). The orchestrator's scope listed it as one, while the owner's words were that only the three parameters may differ. A (recommended) accept: reordering changes no parameter. B treat it as a departure: drop the sort, add a fixture, and a narrow round 4.
- **resolved from round 2** · the script-redirect med (owner's decision 2) and the cross-origin-chooser med (owner's decision 3).
- **dropped** · a shadow-root JS card ahead of a light-DOM player in a cross-origin frame, tried for an index mismatch between the in-page list and Playwright's shadow-piercing locator: it returned the player's stream.
- **findings** · 7 returned: 1 med (with open decision 4), 4 lows in 3 bullets, 1 carried as open decision 5, 1 dropped.
- Invariants: existing `AppError` code, redaction, contract untouched, diff under `tools/downloader/`. Skipped as untouched: shell and process trees, SSRF, cross-tool imports.
- NFR: security ✓ (the cross-origin evaluation is read-only) · performance — about 500 ms per probe, about 2000 ms when `load` never fires, both bounded · reliability — the med · maintainability — the lows.

**Owner's answer, 2026-09-15:** open decision 4 — **A**, file and ship. Filed as [dl-61](./dl-61-shadow-dom-player-gets-no-surface-click.md). Open decision 5 — **A**, accept as built; a spec now pins it (Log). Both the reviewer's recommendation. With A on both the reviewer called the remaining items non-blocking and no round 4 needed — see the Log for what landed after this record.

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

## The gate on this filing

**2026-09-13 — CONCERNS**, from `ticket-reviewer` on Sonnet, at `f3d72e4`. It
checked every code fact in this ticket and in dl-56 against `1835657`, and
found all of them true. Its report is on the pull request thread.

- **high, no change needed** — the id `dl-55` was also claimed by PR #235.
  The reviewer ran before that PR's author renumbered: PR #235 at `3066c57`
  claims dl-57 and dl-58 and no dl-55, and `next-id.mjs` after a fetch lists
  dl-55 and dl-56 on this branch only. The reviewer's fix, renaming these
  tickets to dl-57 and dl-58, would have re-created the collision.
- **low, fixed** — Build step 3 imports `redactUrl` from `@webtools/core`, which
  `resolvers` does not depend on. Step 3 now says to add it.
- **low, fixed** — `api/src/thumbnails.ts` said `probeTimeoutMs` defaults to
  30 s, and `api/src/config.ts` sets 45 s. The comment is corrected on this
  branch.

## 2026-09-14 — built

Branch `dl-55-surface-click-opens-another-video` off `origin/main` at `95c6403`
(the head at intake).

**Both layers landed, as the owner decided.**

1. **Selection**, `resolvers/src/browser/provoke.ts`. `CHOOSE_VIDEO_FN` is one
   in-page function shared, as a string, by two call sites: `CHOOSE_VIDEO_SCRIPT`
   marks the chosen element (a visible `<video>` with no `a[href]` or
   `[role='link']` ancestor, largest rendered area among those) with
   `data-downloader-video`, so `clickChosenVideo` clicks it through the locator
   API in a scriptable frame; and `METADATA_SCRIPT`'s duration fallback calls the
   same function directly. A cross-origin frame has no evaluation context to mark
   an element in, so it gets a CSS-only fallback, `NON_CARD_VIDEO_SELECTOR`
   (`video:not(a[href] *):not([role='link'] *):visible`) — first visible
   non-card video in document order, not the largest, documented as a
   deliberate simplification (a per-candidate `boundingBox()` call is a round
   trip each, and every fixture here has at most one qualifying video per
   cross-origin frame). No candidate in either branch means no click, as the
   ticket specifies.
   - `force: true` and the `{ x: 5, y: 5 }` position are unchanged. Decided to
     keep `force`: the chooser already keeps a related-video card from ever
     being the _target_, which is what made `force` dangerous before, and a
     legitimate layer (a controls bar, a click-to-unmute scrim) can still sit
     over the player itself.
   - `PLAY_SCRIPT`'s card-clip trap (Traps section) does not manifest here: the
     related-card fixture's card `<video>` carries no `src`, so `PLAY_SCRIPT`
     calling `.play()` on it produces no network request. `PLAY_SCRIPT` was
     left unchanged; if a future page's card carries a real preview clip, the
     same trap and the same fix apply there too.
2. **Guard**, `resolvers/src/resolvers/browser.ts`. `landingUrl` is recorded
   once `navigate()` settles (so a load-time redirect is never a departure).
   `watchForDeparture` listens on `page.on("framenavigated", ...)`, filtered to
   the main frame, from before `provokePlayback` runs; `sameDocument` compares
   URLs with the fragment stripped, so a hash-only change is never a departure.
   `waitForQuiet`'s `stop` now also fires on a recorded departure, per the
   ticket's "nothing after it is worth waiting for". After the quiet wait
   (`guard.stop()` unregisters the listener first), a recorded departure throws
   `AppError("NO_MEDIA_FOUND", { details: { reason: "navigated-away", url,
departedTo } })` even if hits exist, with both URLs through `redactUrl` —
   **for dl-58's sweep: this is the only new `AppError` this ticket adds with a
   URL in `details`, at `resolvers/src/resolvers/browser.ts`'s departure check
   in `#run`, and both `url` and `departedTo` are already redacted.**
   - **Logging.** `resolvers` has no logging facility today (no `Logger` type,
     no dependency on `@downloader/engine` or a pino wrapper), so this adds a
     small structural `BrowserResolverLogger` (`{ warn(message, fields?) }`) as
     a `BrowserResolverOptions.logger`, defaulting to a no-op. `api/src/
resolvers.ts` now passes its own `AppLogger` in when constructing
     `BrowserResolver` — not in the ticket's Build steps verbatim, but without
     it the required warn line would never reach a real log, which is the
     acceptance criterion ("diagnosable from the log"). Small enough to fold in
     rather than file separately.

**The ticket's `redactUrl`/dependency instruction turned out to be
unnecessary, and the code takes the simpler path instead of the stated one.**
`resolvers/src/resolvers/browser.ts` already imports `AppError, redactUrl` from
`@downloader/contract` (which re-exports both from `@webtools/core`), so the
new `NO_MEDIA_FOUND` throw reuses that existing import rather than adding a
second one from `@webtools/core` and a new dependency line. Verified against
`packages/core/test/image-closure.test.ts`, which scans literal import
specifiers per package (not the transitive dependency graph) — no
`"@webtools/core"` string was added to `resolvers/src`, so no dependency was
needed; `resolvers/package.json` is unchanged. The gate on the filing had
already corrected the ticket text for this once (see above); this is a second,
smaller correction to the same instruction, at build time rather than filing
time.

**For dl-56 (grabs a preview frame when the page names none), which depends on
this ticket:** the chooser this ticket adds is `CHOOSE_VIDEO_FN` in
`resolvers/src/browser/provoke.ts` — a plain function, not a class — chooses
"the visible `<video>` with no link ancestor and the largest area", and is
already shared between the surface click and the metadata duration fallback.
If dl-56 needs "the element the tier decided is the player" for a frame grab,
this is that element's selector logic; reusing `CHOOSE_VIDEO_FN` (or the
`VIDEO_MARK` attribute it leaves on the DOM briefly during the click, in a
scriptable frame only) keeps dl-56 from drifting from what this ticket chose,
the same reason step 2 gives for sharing it with metadata in the first place.
Note the non-scriptable-frame gap: in a cross-origin frame there is no marked
element and no evaluation context, only `NON_CARD_VIDEO_SELECTOR`'s CSS
fallback — dl-56 needs its own answer for a frame grab there if it needs one at
all.

**Correction, 2026-09-15 (round-3 gate, low finding):** the paragraph above is
stale on two counts. "No evaluation context" was never true — round 2's gate
measured it false, and round 3's decision 3 acted on that: a cross-origin
frame now runs `CHOOSE_VIDEO_INDEX_SCRIPT` through `frame.evaluate`, one
round trip, same as everywhere else. `NON_CARD_VIDEO_SELECTOR` is deleted.
For dl-56: there is no non-scriptable-frame gap left to answer — every frame
now goes through the same chooser, `CHOOSE_VIDEO_INDEX_FN`, whose current
form and its one open item (dl-61, shadow-piercing) are described in the
round-3 Log entry below.

**Fixtures**, all under `resolvers/test/fixtures/pages/`: `related-card.html` +
`related-card-target.html` + `media/related/` + `media/related-target/` (the
related-card fixture); `guard-pushstate.html`, `guard-assign.html`,
`guard-fragment.html` (the guard fixture, its allowed fragment-only case) plus
a `/guard-redirect` 302-to-`/mse.html` route added to
`resolvers/test/browser/helpers/fixture-server.ts` (the allowed load-redirect
case); `duration-chooser.html`, driving a new unit-style test in a new file,
`resolvers/test/browser/provoke.test.ts`, that calls `readMetadata` directly —
added because a full probe's `ProbeOutcome.durationSec` (from the parsed
manifest) always wins over `readMetadata`'s fallback, so the fallback cannot be
isolated through `browser-resolver.test.ts`'s end-to-end probes. `duration-
chooser.html` shadows the read-only `duration` IDL property with
`Object.defineProperty` on each `<video>`, since driving a real value needs a
real decodable media resource this fixture has no reason to carry.

**Each layer's test verified red with that layer alone reverted, then restored
— temporary edits only, never committed:**

- Selection reverted (`clickChosenVideo` back to
  `frame.locator("video").first()`, guard left in place): "starts the real
  player and never reaches the card's own page or stream"
  (`browser-resolver.test.ts`) went red — `AppError: No downloadable video
stream was found on that page.` (`NO_MEDIA_FOUND` / `navigated-away`, from
  the guard catching the misclick's navigation; the ticket's own prediction —
  "a guard alone would make this page return no video at all" — is exactly
  what happened).
- Metadata's chooser reverted (`METADATA_SCRIPT` back to
  `document.querySelector('video, audio')`): "reads the chosen player's
  duration, not a related card's" (`provoke.test.ts`) went red — `expected 30
to be 942`.
- Guard reverted (the departure check and throw removed from `#run`, selection
  left in place): both guard-fixture tests in `browser-resolver.test.ts` went
  red — `expected undefined to be an instance of AppError` (no error at all;
  the wrong page's own content, having nothing this reproduction bothered to
  make probeable, simply timed out to nothing worth asserting further on).

**Verification.** Narrowest spec while iterating:
`npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts
tools/downloader/resolvers/test/browser/provoke.test.ts` — 34 tests, all
passing (33 in the first file, 1 in the second). Then the full gates:
`npm run check` (lint + format:check + typecheck) exits 0 across every
workspace; `npm test -- --project downloader` — **76 files, 1271 tests, all
passing**. `npx vitest run packages/core/test/image-closure.test.ts` — 7 tests,
all passing, confirming the `redactUrl` deviation above needs no dependency
change. `npm run format` run once after touching `docs/00-ANALYSIS.md`, which
reflowed the new table row's column widths; no other file changed by it.

**Not done, and not in Done-when:** the live-page check
(`ENABLE_YTDLP_RESOLVER=false` against the original page) — this container's
firewall blocks the outbound reach, and the ticket already marks that check
optional.

**Files touched:** `resolvers/src/browser/provoke.ts`,
`resolvers/src/resolvers/browser.ts`, `api/src/resolvers.ts`,
`resolvers/test/browser/browser-resolver.test.ts` (new describe blocks),
`resolvers/test/browser/helpers/fixture-server.ts` (`/guard-redirect` route),
`resolvers/test/browser/provoke.test.ts` (new), seven new fixture pages and
four new manifest fixtures under `resolvers/test/fixtures/pages/`,
`docs/00-ANALYSIS.md` §7.

No fold-in beyond the api logger wiring noted above — nothing else this branch
touched made another already-specified item free.

## 2026-09-14 — gate round 1, answered

`ticket-reviewer` (Opus, agent `a0701174359ad2606`) gated `fc8be9e` FAIL: one
unproven Done-when clause, three `med` findings, one `low`, three open
decisions. Reproduced every finding before acting — see method below — then
fixed what was mine to fix and left the three open decisions to the
orchestrator, as the reviewer itself said to.

**Finding 1 (med), confirmed, fixed.** All four of the reviewer's mutations
reproduced exactly as reported against the original `related-card.html`
fixture: deleting the link-ancestor check, replacing the largest-area
comparison with first-qualifying, adding a no-candidate fallback to
`document.querySelector('video')`, and deleting the `clickChosenVideo` call
each left the fixture's one test green. The root cause was mine: the card was
smaller than the player (so area alone already picked right), the page had
only one unlinked candidate (so no-candidate never triggered), and the player
started on its own `play` event listener — which `PLAY_SCRIPT`'s blanket
`.play()` call fires regardless of whether anything was ever clicked, so the
fixture's own comment claiming "only a surface click starts it" was wrong.
**Fixed by replacing one fixture with three, each discriminating exactly one
clause, all switched to a `click`-only start (never `play`) so `PLAY_SCRIPT`
cannot substitute for the surface click**:

- `related-card.html`, rewritten: an 800×450 linked card _larger_ than a
  480×270 unlinked player — area alone now picks the wrong one, so this
  isolates the link-ancestor exclusion.
- `related-card-area.html`, new: a 150×100 unlinked, listener-less decoy
  ahead of a 640×360 unlinked player — isolates the largest-area rule.
- `related-card-only-linked.html`, new: the page's only video is a card, so
  the chooser must find no candidate and click nothing; asserts the link
  target is never requested.
- Re-ran all four of the reviewer's mutations against the new set: each now
  reddens exactly the test built to catch it (mutation 1: the link-exclusion
  and no-candidate tests both went red, since the no-candidate fixture's one
  video happens to be linked too; mutation 2: only the area test; mutation 3:
  only the no-candidate test; mutation 4: the link-exclusion and area tests,
  both now `click`-gated). Restored and reran the full `dl-55`-tagged set
  clean (9/9) after each.

**Finding 2 (med), confirmed, not fixed — open decision 2, the orchestrator's.**
Reproduced with the reviewer's own scenario: a page whose body runs
`window.addEventListener("load", () => setTimeout(() => location.replace(...),
200))` to a page with its own `Play` button. Ran the exact same fixture and
resolve call against this branch (`fc8be9e` plus my Finding-1/3/4 fixes) and
against `origin/main`'s `provoke.ts`/`browser.ts` swapped in in place: branch
throws `NO_MEDIA_FOUND` / `navigated-away`
(`{"reason":"navigated-away","url":".../verify/redirect-after-load.html","departedTo":".../verify/redirect-target.html"}`);
main returns the redirected page's own stream
(`title: "Redirect target"`, `variants[0].url` the fake HLS master). Traced
why main succeeds: `provokePlayback`'s second of its two passes
(`provoke.ts`'s own docstring: "players are frequently lazy-mounted") runs
~900 ms after the first, by which time the 200 ms-delayed `location.replace`
has already landed — so pass two naturally re-provokes whatever page is
current. The guard's `landingUrl`, captured once at `domcontentloaded` and
compared for the rest of the probe, cannot tell that departure apart from the
one this ticket exists to catch. Not resolved here: the reviewer copied this
to the orchestrator as open decision 2 (recapture the landing URL later vs.
count only departures that follow the tier's own clicks), and it is not mine
or the reviewer's to settle.

**Finding 3 (med), confirmed, comments fixed — open decision 3, the
orchestrator's.** The claim in my own comments and in this Log's dl-56 note —
that a cross-origin frame "has no evaluation context" — is false, and I
should have measured before writing it rather than inferred it from
`isScriptableFrame`'s name. Reproduced directly: two real HTTP servers on
different loopback ports (genuinely cross-origin, confirmed by comparing
`origin` strings), an iframe on the first embedding a page from the second,
and `frame.evaluate("document.querySelectorAll('video').length")` on the
inner frame returned `1` without error. `isScriptableFrame` is a _policy_ this
file already applies to `SCROLL_SCRIPT` and `PLAY_SCRIPT`, not a technical
wall — its own comment says so ("Frames we are willing to run script in").
**Fixed:** both comments in `provoke.ts` (`NON_CARD_VIDEO_SELECTOR`'s
docstring and `clickChosenVideo`'s) now say this is a policy choice, not a
capability limit, and flag that the reason for the CSS fallback should be
revisited given that. **Not fixed:** the underlying behaviour — whether to
fold the cross-origin case into `CHOOSE_VIDEO_SCRIPT`'s own `evaluate` (one
more round trip, dropping the policy for this read-only check), keep the CSS
fallback as a narrower policy call, or drop the cross-origin surface click
entirely — is open decision 3, the reviewer's own framing, correctly not
settled here or by the reviewer.

**Finding 4 (low), confirmed, fixed.** No test exercised
`BrowserResolverOptions.logger`. Added "reports the departure to the injected
logger, naming the step and both URLs" to the navigation-guard describe block:
injects a capturing `BrowserResolverLogger`, asserts exactly one `warn` call,
a message matching "left the landing page", `fields.step` is one of
`provoke-playback`/`network-quiet` (the click that starts the navigation runs
during the first, but `framenavigated` can fire either side of the stage
boundary — asserting a single value was flaky, widened rather than pinned to
one run's timing), and both `landingUrl`/`departedTo` through `redactUrl`.

**Method.** Every mutation and reproduction applied to a saved copy of the
committed file, run, then restored (`git diff` empty after each) — the same
discipline as the original per-layer revert, never committed. Full gates
re-run after the fixes: `npm run check` exit 0; `npm test -- --project
downloader` — **76 files, 1274 tests** (1271 + 3 new); `npx vitest run
.../browser-resolver.test.ts .../provoke.test.ts -t dl-55` — 9/9;
`node scripts/citations-gate.mjs --against origin/main` — exit 0, 0 raised;
`npm run format` — no unexpected diffs.

**Not done:** open decisions 1–3 are the orchestrator's, not resolved on this
branch. No code changed for Finding 2 or the cross-origin selection strategy
in Finding 3 — only the false comments.

## 2026-09-15 — gate round 2, CONCERNS; low fixed after the gate

`ticket-reviewer` (agent `a0701174359ad2606`) re-gated `16084d2`: round 1's
finding 1, 3's comments and 4 confirmed resolved; findings 2 and 3's behaviour
still open, as expected (both are the orchestrator's open decisions 2 and 3).
One new **low**: `NON_CARD_VIDEO_SELECTOR`'s docstring, written during round 1,
misattributed the false "no evaluation context" claim to the reviewer rather
than to the builder who wrote it, and still claimed the size comparison needs
a `boundingBox()` round trip per candidate even where `evaluate` is allowed —
wrong on its own terms, since `locator.evaluateAll` returns every candidate's
size in one round trip.

**Fixed**, addressed after the gate: reworded the docstring to attribute the
claim correctly and to drop the false round-trip reasoning, keeping the same
16 content lines so `provoke.ts:230` (the `const` line the Review block cites)
did not move — confirmed with `grep -n` before and after, and `npx oxfmt` made
no further change to the file. `node scripts/citations.mjs <this file>
--section Review --require-anchors --require-distinct-anchors` — 13/13
verified, 0 moved, exit 0, after committing the Review block above.

The Review block above (both gate rounds) was drafted by the reviewer and
relayed by message, since it could not write to this file directly; committed
verbatim per its own instruction, plus the transcription disclosure note and
the "addressed after the gate" sentence on the low, both added by the
reviewer's explicit request.

Re-ran the full gates after the docstring fix: `npm run check` exit 0;
`npm test -- --project downloader` — 76 files, 1274 tests, all passing;
`npx vitest run .../browser-resolver.test.ts .../provoke.test.ts -t dl-55` —
9/9; `node scripts/citations-gate.mjs --against origin/main` — 81 records
(one new Review section), 0 failing, 0 raised.

**Not done:** open decisions 1–3 remain the orchestrator's.

## 2026-09-15 — round 3: the three decisions built

The owner answered all three open decisions (recorded above, under "Why", as
"Decided by the owner, 2026-09-15"). This round builds each.

**Decision 1 — play-time query exceptions**, `sameDocument` in
`resolvers/src/resolvers/browser.ts`. Rewritten to compare origin and pathname
exactly, then the query string with `PLAY_TIME_QUERY_EXCEPTIONS` (`t`,
`start`, `autoplay`) deleted from both sides before comparing — any other key,
or the path, still counts as a departure. New fixture `guard-query.html`,
`?rewrite=` picking which key its play control adds via `history.replaceState`
(`t`, `start`, `autoplay`, or `other`). Tests: `test.each` over the three
exception keys, each asserting the probe succeeds; one more asserting
`?rewrite=other` still fails `navigated-away`. **Revert-red:** disabling the
exception-deletion loop reddened exactly the three exception-key tests
(`AppError: No downloadable video stream was found on that page.`) and left
the `other` test green, restored after (`git diff` empty).

**Decision 2 — landing URL read later**, `waitForPageLoad` in
`resolvers/src/resolvers/browser.ts`, called right after the DRM check and
before `landingUrl` is read. Chose "at `load`, budgeted" over "just before the
first provocation click": the latter is ambiguous in this file (`provokeFrame`
attempts several clicks — a modal, consent, an age gate, `PLAY_SELECTORS`, the
surface click — and "the first" would mean rewriting where the guard commits
its baseline into that loop, a materially bigger and riskier change) and,
concretely, `load` fires almost immediately for a fixture with no heavy
resources, so a bare "wait for `load`" alone does **not** cover a redirect
timed _relative to_ `load` (the reproduction's own ~200 ms case) — measured
directly: waiting only for `load` still let the guard catch the
`guard-script-redirect.html` and `guard-router-rewrite.html` fixtures below as
departures. Built as two budgeted waits: `page.waitForLoadState("load", ...)`
capped at `LANDING_URL_LOAD_BUDGET_MS` (1500 ms), then a further
`sleep(...)` capped at `LANDING_URL_SETTLE_MS` (500 ms) — paid on every probe,
not only ones that redirect, which is the cost this decision accepts in
exchange for not mistaking page lifecycle churn for a click. New fixtures:
`guard-script-redirect.html` (+ `-target.html`), a `location.replace` 200 ms
after `load`; `guard-router-rewrite.html`, a `history.replaceState` stripping
`?utm_source` 300 ms after parse, on the same page (no navigation at all —
this one exercises `sameDocument`'s ordinary comparison once the URL it's
compared against is itself already post-rewrite); `guard-redirect-fragment-
target.html` + the `/guard-redirect-then-fragment` server route (302 to it) —
a fragment-only play on the _post-redirect_ page, which only passes if
`landingUrl` is the page reached, not the one requested. Three tests, one per
fixture, all asserting the probe succeeds with the expected stream.
**Revert-red, two mutations because the fix has two parts:** (a) removing
`waitForPageLoad`'s call entirely reddened the script-redirect and
router-rewrite tests (2 of 3) — the third (`guard-redirect-then-fragment`)
stayed green, because `navigate()`'s own `page.goto()` already follows the
redirect before `landingUrl` is ever read, so a missing _wait_ does not
reproduce the shape that test is for. (b) Changing `landingUrl` to the raw
requested `url.toString()` (the reviewer's own framing: "if `landingUrl` is
set back to the requested URL") reddened exactly the
`guard-redirect-then-fragment` test and none of the others. Both restored
after (`git diff` empty).

**Decision 3 — the cross-origin chooser**, `resolvers/src/browser/provoke.ts`.
`NON_CARD_VIDEO_SELECTOR` is gone. `CHOOSE_VIDEO_FN`'s body is now split out
as `CHOOSE_VIDEO_INDEX_FN` (takes a candidate list, returns an index, not an
element — so both the scriptable path and the new one below can share it
without drift), and a new `CHOOSE_VIDEO_INDEX_SCRIPT` runs it against
`document.querySelectorAll('video')` as a full script. `clickChosenVideo`'s
non-scriptable branch now calls `frame.evaluate<number>
(CHOOSE_VIDEO_INDEX_SCRIPT)` — one round trip, read-only, regardless of frame
origin — and clicks `frame.locator("video").nth(index)`.
**`Locator.evaluateAll` was tried first, per the owner's exact wording ("one
read-only `locator.evaluateAll` call"), and dropped**: passed a string page
function against a genuinely cross-origin frame (two real servers, different
loopback ports, confirmed different `origin`s), it resolved with `undefined`
and no error, while the identical logic passed as a real function reference
worked, and `frame.evaluate` with the _same string_ also worked. Rather than
chase a Playwright-version-specific string-vs-function gap in a locator API,
this uses `frame.evaluate`, which this file already knew worked cross-origin
(that was the whole premise decision 3 answers), on the same script shape the
rest of the file already uses everywhere else. New fixture-server capability:
`FixtureServer.secondaryOrigin`/`secondaryUrl`, a second `http.createServer`
on the same static root but a different loopback port — genuinely
cross-origin, not same-origin-by-convention, needed because every existing
"iframe" fixture here (`iframe-parent.html`) is same-origin. New route
`/cross-origin-card.html`, generated at request time (a static file cannot
know an ephemeral port), embedding `<iframe src="{secondaryOrigin}/cross-
origin-card-inner.html">`. New fixture `cross-origin-card-inner.html`: a
150×100 `<div onclick="location.assign(...)">`-wrapped video (a card wired by
JS, not `<a href>` — the link-ancestor rule does not exclude it, only the
largest-area rule does) first in the DOM, ahead of a 640×360 click-started
player. Test asserts the probe returns the player's stream from the secondary
origin and the card's own target page is never requested. **Revert-red:**
hardcoding the chosen index to `0` (first-in-document-order, the pre-decision-
3 CSS selector's own effective behaviour) reddened the test — the probe
returned the card's own stream (`/media/related-target/master.m3u8`) via the
subframe's `location.assign`, exactly the finding's own reproduction, since
the top-frame guard cannot see a subframe navigation either way (out of
scope for this decision, as the finding said). Restored after (`git diff`
empty).

**Method**, as before: every mutation applied to the actual committed file,
run, then restored from a saved copy — `git diff` empty after each, checked
before moving to the next.

**Gates**, run once at the end per the orchestrator's instruction: `npm run
check` — exit 0; `npm test -- --project downloader` — **76 files, 1282 tests**
(1274 + 8 new: 4 decision-1, 3 decision-2, 1 decision-3), all passing;
`node scripts/citations-gate.mjs --against origin/main` — 81 records, 0
failing, 0 raised, after repointing the three citations round 3's own edits
moved (two pinned to `@16084d2`, since the code they described was fixed by
this round; one updated to its new line, since the fact it names is still
true today) and disambiguating one indistinct anchor
(`node scripts/citations.mjs <this file> --section Review --require-anchors
--require-distinct-anchors` — 13/13 verified, 0 moved, exit 0).

- 2026-09-15 — The Review section's two citations pinned to `16084d2`, the
  branch commit this PR deletes on merge, were repaired on the owner's
  instruction. `browser.ts:286 "const landingUrl = page.url();"` still
  resolves once unpinned — the text is unchanged, only its position moved
  when the fix in round 3 pushed the read later in the function — so it was
  re-pointed to line 323. `provoke.ts`'s `NON_CARD_VIDEO_SELECTOR` citation
  does not: round 3 folded that constant into `CHOOSE_VIDEO_SCRIPT`, so there
  is nothing left to point at, and it was rewritten as prose naming the
  reviewed commit instead. No finding, verdict or anchor text changed.
