---
id: dl-143
tool: downloader
title: A player iframe that a delay-JS plugin fills only after the first interaction loads after provocation has ended
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-143 — A player iframe filled by a delayed script loads after provocation has ended

## Why

Seen in dev on 2026-11-15, the same day as dl-139 and on the same WordPress
site. The page's player is the same shape dl-139 answered: an iframe at
`about:blank` with its embed address base64-encoded in `data-enc`. But dl-139
did not help, because nothing on this page runs until a visitor touches it. The
site uses LiteSpeed Cache's **"delay JS"**: every page script, the player script
included, is emitted as `<script type="litespeed/javascript">`, and a loader runs
them only after the window sees one of
`mouseover, click, keydown, wheel, touchmove, touchstart, pointerup, pointerdown`.
There is no timeout fallback. When they run, the loader dispatches
`DOMContentLiteSpeedLoaded`, and the player script's listener for it copies
`atob(data-enc)` into the iframe's `src`. On a page with server tabs, the tab
`click` handlers are registered by that same delayed script, so a press that
arrives before the release does nothing except release it.

The live post (one player, no tabs, a third-party embed host's `/e/<id>` page)
answered `NO_MEDIA_FOUND` through the dev API and through `BrowserResolver`
called directly, the same way both times:

| Stage (s from start) | browser tier on the live post |
| -------------------- | ----------------------------- |
| page-load            | 0.1                           |
| provoke-playback     | 4.2                           |
| network-quiet        | 5.5                           |
| settle-requests      | 14.5 → `NO_MEDIA_FOUND`       |

No departure was logged. Measured with Playwright on the live post, same day
(times from `goto`):

- no interaction: the iframe is still `src="about:blank"` at 19 s, with no
  embed request;
- one interaction after `load` releases the delayed scripts. A mouse move, a
  wheel, a `window.dispatchEvent(new Event("mouseover"))` and a
  `window.scrollTo` each did it, and the iframe's `src` was set 0.2–0.6 s
  later. The embed frame then navigated `/e/<id>` → a mirror domain's
  `/e/<id>` about 0.4 s after that, and its player loaded;
- that embed host requests its manifest only after a click inside its frame
  (dl-139's Log recorded the same of this host, and its fixture models it).

So the tier's own pass 0 scroll (`SCROLL_SCRIPT` in `provokeFrame`) is what
releases the scripts. The frame then fills while pass 0 continues, the
`PROVOKE_PASS_PAUSE_MS` sleep runs, and pass 1 starts about 1 s later, while the
embed is still navigating to its mirror. Both passes together took 1.3 s.
Nothing clicks inside the embed once it has a player, `waitForQuiet` only
revisits overlays, and the probe ends empty. The same embed address pasted on
its own resolves through the browser tier.

A local copy of the dl-139-shaped page with a tab handler that is _not_ delayed
resolved in about 5 s, which is what isolates the delay as the cause.

## Decision — answered 2026-11-15 by the owner

**Answer: A**, as recommended, chosen from:

- **A. Wait for a blank player iframe to fill (recommended).** After the
  scroll and dl-139's tab press in the top frame, if a visible player-ish iframe
  is still blank, wait (bounded, about 3 s) for it to get a `src` and for its
  frame to load, and then continue with the in-frame clicks. It extends dl-139's
  own precondition and costs nothing on a page without a blank player iframe.
- B. Re-provoke a late frame: one more provocation pass during `network-quiet`
  on a player frame that appeared after `provokePlayback` ended. More general,
  more code, and it has to coexist with the overlay revisits.
- C. Interact earlier: hover or scroll during the landing settle window so
  delay-JS plugins run before provocation. Cheapest, but still a race when the
  delayed bundle is slow.

**Gate round 1 — answered 2026-11-15 by the owner:** F1 remedy (a), a short
loading-retry cap unless a replacement was counted, and only cross-document
navigations counted; F2 fixed in this round; F6 and F3 fixed alongside.

**Gate round 2 — answered 2026-11-16 by the owner:** count a main-frame
navigation as a replacement only once it commits.

## Build

1. **Fixture first, red on `main`.** In `resolvers/test/fixtures/pages/`, a page
   modelled on the live one: one `.player-frame` iframe at `about:blank` with
   `data-enc` holding the base64 of the embed fixture's address, and **no tab**.
   Its player script must not run until a window `mouseover | click | keydown |
   wheel | touchmove | touchstart | pointerup | pointerdown` (register those
   listeners the way LiteSpeed does, on `window`, `{passive: true}`). Then, after
   a delay of about 400 ms (a `setTimeout` standing in for the bundle loading),
   it sets `src = atob(data-enc)`. The embed must be one whose manifest is
   requested only after a click in its frame. dl-139's `player-tabs-embed.html`
   (`{{SECONDARY}}`) already does that; reuse it, and if it does not take long
   enough to become clickable, add a short in-frame redirect hop to model the
   mirror navigation. A second fixture with server tabs whose `click` handlers are
   also registered only after the release (the delayed-tab shape) covers dl-139's
   press meeting this plugin. Run each test red against `main`'s `provoke.ts`
   first and record the failure in the Log.
2. **The wait.** In `provokeFrame`, top frame only, after `SCROLL_SCRIPT` and
   after dl-139's `pressServerTab`: if a visible player-ish iframe whose `src` is
   empty or `about:blank` is present (reuse whatever predicate dl-139's press
   already uses for "blank player iframe"; do not write a second one), wait up to
   `BLANK_PLAYER_FILL_WAIT_MS` (about 3000, exported, named, bounded by the
   deadline and the abort signal) for its `src` to change and for that child
   frame to reach `load` in its _final_ document, after any in-frame redirect
   hop. Once per probe, like `serverTab.attempted`. If it never fills, continue
   as today; it is never an error.
3. **The frame list.** `provokePlayback` reads `page.frames()` once per pass,
   before visiting them. A frame that only exists after the wait in step 2 is not
   in pass 0's list, and may be mid-navigation when pass 1 reads its own list.
   Make sure the in-frame clicks reach the filled frame, whether by re-reading
   the list after the wait or by another route, and say in the Log which route
   you took and why.
4. Tests appended at the **end** of the right existing suite (the press-target
   file dl-139 used, `browser-resolver-press-targets.test.ts`, unless another
   fits better): the single-iframe delayed page resolves; the delayed-tab page
   resolves; a page with no blank player iframe does not pay the wait (assert it
   on timing or with a spy, whichever is not flaky). A mutation that removes the
   wait must turn the first test red.

## Traps

- **This repository is public.** Never write the live site, the embed host, its
  mirror domain or any video address into a file, a commit or a PR. The
  measurements above are the reproduction, and the fixtures recreate it.
- dl-142 (draft PR #817, not merged) changes `provoke.ts`'s box click
  (`MARK_PLAYER_BOX_SCRIPT` / `clickPlayerBox`). That is a neighbour, not this
  change. Do not build on it; whichever lands second rebases.
- dl-144 is being built at the same time and adds a "first press happened" signal
  that `provokePlayback` reports to `browser.ts`. A scroll is not a press there,
  and this ticket's wait is not one either. Keep your change out of
  `resolvers/src/resolvers/browser.ts` if you can.
- The release can also come from the tier's dismiss-modal and consent steps,
  which run before the scroll. The wait must key on the iframe state, not on
  which step released it.

## Done when

- The single-iframe delayed fixture resolves through the browser tier, and is red
  on `main`'s `provoke.ts`.
- The delayed-tab fixture resolves.
- A page with no blank player iframe pays no wait.
- `npm run check` exits 0; `npm test -- --project downloader` passes, or every
  failure is shown to also fail on `main`.

## Log

- 2026-11-15 — Built (option A). `provoke.ts`: the blank-player-iframe predicate
  is lifted out of `MARK_SERVER_TAB_SCRIPT` into `BLANK_PLAYER_IFRAMES_FN`, which
  the press and the new wait both read (no second predicate). `waitForBlankPlayerFill`
  marks the chosen blank iframe, then polls until its `src` has left `about:blank`
  and its child frame has been `complete` on one address for
  `BLANK_PLAYER_STABLE_MS` (800 ms), which is the final document after an in-frame
  hop. Bounded by `BLANK_PLAYER_FILL_WAIT_MS` (3000, exported) across the probe,
  the deadline and the abort signal; never an error; a page with no blank player
  iframe returns after one evaluate. Fixtures: `player-delayed-single.html`
  (`?plain` swaps the iframe for a div, `?never` releases but never fills),
  `player-delayed-tabs.html`, `player-delayed-embed-hop.html`. Three tests at the
  end of `browser-resolver-press-targets.test.ts`. Nothing in `browser.ts`.
  - **Step 3, the frame list: route taken is re-reading `page.frames()` before
    each visit** (a `visited` set in `provokePlayback`), not once per pass. Why:
    the wait runs in the top frame's visit, so what it fills is visited after it
    in the same pass and in its final state; a frame created by the wait is
    included; it costs one call per frame.
  - **The brief's order is not enough for the delayed-tab shape.** "After the press"
    alone leaves the press to run straight after the scroll, before the plugin has
    registered the tab handlers; it does nothing, and the press is once per probe.
    So the wait is in two calls sharing one 3000 ms budget: up to
    `BLANK_PLAYER_RELEASE_WAIT_MS` (1000) before the press, then the rest after
    it. Cost: a page with a blank player iframe that no script fills pays 1 s
    before its press (dl-139's own tab page: it pays no more than the wait
    ends early once the iframe fills). A page with no blank iframe pays nothing.
  - **Fixture timing is not the live timing, and says why.** The harness's own
    pointer activity at load can release a delay-JS page before provocation, and
    on `main` pass 1's in-frame click lands about 1.6 s after the scroll. Live
    numbers (fill 0.2-0.6 s, hop 0.4 s) passed on `main` three times in three.
    The fixture is slower (fill 1200 ms, hop 600 ms, tab handlers 1000 ms) so that
    it is red on `main` every run; the stability window (800 ms) sits above the
    hop (600 ms) on purpose, and a hop longer than it is not waited for.
  - **Red on `main`'s `provoke.ts`** (three runs each): the single-iframe test
    `AppError: No downloadable video stream was found on that page.` (about 3.0 s);
    the delayed-tab test, same error (about 2.9 s); the no-wait test
    `AssertionError: expected 56 to be greater than NaN` (the exported constant
    does not exist on `main`, so this one is red by import, not by timing; with the
    constant present and the wait removed it is `neverMs - plainMs` near 0).
  - **Mutations**: `waitForBlankPlayerFill` returning at once turns all three red.
    `BLANK_PLAYER_STABLE_MS = 0` leaves all three green: the hop is covered in
    these fixtures by pass 1 re-clicking after it, so the stability window is not
    pinned by a test. Left so rather than tuning a fixture to a race.
  - Runs: press-targets spec 38 of 38 earlier at 138 s; `npm run check` exit 0;
    `npm test -- --project downloader` 2668 passed, 2 skipped (130 files, 1
    skipped), exit 0. e2e and container gates not run; CI has not proved them.
  - **Live check** (the live post, `BrowserResolver` from this worktree's dist,
    sandbox firewall as found): still `NO_MEDIA_FOUND`, provoke-playback 3.8 s to
    8.1 s (so the wait ran), settle-requests ended at 17.2 s. Not proved either
    way: this environment may not reach the embed host, and I could not tell.
    The owner's dev run is the real reading.
- 2026-11-15 — Round 2 (owner's answer: add a hover, and chase the reload).
  - **Correction to the entry above.** The live check there said the sandbox
    "may not reach the embed host". It does reach it; the 60c42ca8 build failed
    live for a different reason (below). That entry's "no more than" sentence
    about dl-139's tab page is also muddled: it pays at most the 1 s before its
    press, and nothing once the iframe fills.
  - **Why 60c42ca8 failed live (3 of 3, then 2 of 5 after the hover alone).**
    Two causes, both measured with the coordinator's traced script. (1) Nothing
    released the plugin: the player sits below the top of the viewport, so
    `SCROLL_SCRIPT` moves nothing and sends no event the plugin hears; its
    "Start Load JS Delayed" came from a later click, about 3 s after "Start Lazy
    Load". (2) Once released, the plugin's bundle took 2.2-2.9 s to set the
    iframe's `src`, and the embed hopped 0.3-0.4 s after that, so the document
    with the player was there 3.2-4.2 s after the wait began; the 3 s budget
    ended first in 2 of 5 runs. `BLANK_PLAYER_FILL_WAIT_MS` is 6000 now.
  - **The hover.** `hoverPlayer` moves the pointer (`page.mouse.move`, 3 steps)
    onto the chosen blank player iframe, and, every 500 ms while it is still
    blank, alternately just off it and back on. Off and on because a pointer
    already over an element fires no `mouseover`, and because the plugin
    attaches its listeners a moment after `load`: a first move that arrives
    before them is lost (one live run: hover at about 4.1 s, release only at
    7.5 s from a later click). Once per probe in the sense that it only runs
    inside the wait, top frame only, and only for a blank player iframe. It is
    **an interaction made on the user's behalf**; it is safe because it sends
    `mousemove`/`mouseover` and nothing else: no button, no key, no touch, so it
    cannot press, submit, follow or play, and it is not a `.click(`, so it is not
    a press for dl-144's "first press" signal.
  - **The reload.** Measured on the live post in 10 runs: the main frame
    navigates twice to its own address (about 1.7 s and 3.1-4.1 s), and
    provoke-playback started at 3.9-4.7 s, after the second in 9 runs and 0.2 s
    after it in the other. No run lost its embed to a reload, and the misses
    were the budget above, not the reload. So no `browser.ts` change was made.
    The race is real but not demonstrated: if the second reload lands after
    provocation starts, the hover and the wait are on a doomed document. The
    narrow fix would be waiting out a same-URL main-frame reload before reading
    the landing URL in `browser.ts` (where dl-144 also edits
    `watchForDeparture`); it is not built, and no reload fixture was written.
  - Fixture: `player-delayed-single.html?hover`, released only by a window
    `mouseover`/`pointerup`/`pointerdown`, listeners attached 300 ms after
    `load`, fill 500 ms after the release, a 200 px spacer so the harness's
    initial pointer at (0, 0) is not already over the iframe. Test at the end of
    `browser-resolver-press-targets.test.ts`: "a player iframe in view that only
    a mouseover releases resolves, because the probe hovers over it".
  - **Red on 60c42ca8's `provoke.ts`** (two runs): `AppError: No downloadable
    video stream was found on that page.` (about 6.1 s); the same with the hover
    block disabled (`if (false && ...)`) on the new code. Without the spacer the
    fixture passed on the new code too: the pointer at (0, 0) was already over
    the iframe and nothing fired; the live page has the same property the other
    way round, hence the in-and-out moves.
  - Live acceptance, the traced script against this build: 10 of 10 resolved
    (an HLS stream, 17-21 s); the same script at the previous round's end, 2 of 5
    with the hover and a 3 s budget.
  - `npm run check` exit 0; `npm test -- --project downloader` 2669 passed, 2
    skipped (129 files passed, 1 skipped). e2e and container gates not run.
- 2026-11-15 — Round 3 (the reload race). The coordinator's live runs of
  ae2902a6 came to 4 of 6 (my 10 of 10 did not reproduce); the failing trace had
  the second main-frame load at 4.9 s with provoke-playback starting at 4.9 s, and
  provocation over in 1.2 s with no wait.
  - **Why provocation ended after 1.2 s with no wait: `waitForBlankPlayerFill`
    swallowed the error.** Its single outer `catch` set `state.done = true` on any
    failure that was not an abort, and the first thing the wait does, the
    `frame.evaluate` that marks the iframe, throws when the document is being
    replaced under it. A failure to read was treated as "the page went away", and
    the wait, and with it its 6 s, was skipped without a trace. Same family: when
    the reload landed after a successful mark, the poll's own `catch` swallowed
    the stale-handle error every 100 ms until the budget ran out, hovering and
    sampling nothing. And a third: after the reload, the new document has not yet
    parsed its iframe, the mark script returns `false`, which also set `done`.
  - **The fix is in `provoke.ts` only; `browser.ts` is untouched** (so nothing
    near `watchForDeparture`). The wait now runs in rounds, one per document: a
    failure to read ends the round, not the wait; the next round re-marks the
    iframe in the new document (`state.marked = false`) and the hover goes on
    there; "no blank player iframe" ends the wait only before any document has
    been replaced, and after one it is retried until the budget; only an abort, a
    detached frame, a closed page or the 6 s end it. Bounded by the same budget
    and deadline, so a page that reloads forever costs at most that wait.
  - **Why not a reload wait in `browser.ts`** (the coordinator's option B). The
    reload is not predictable from outside (a `guest.vary` fetch, then a reload,
    1.4-2.8 s after the first commit, and it landed 0.0 s to 1.1 s after
    provocation began in the traces I have); a wait for it in `waitForPageLoad`
    would still lose the race it is about whenever the reload lands just after
    the settle, which is the case that failed. Making the wait itself survive a
    document swap covers the reload wherever it lands in the wait. Not covered:
    a reload that lands before the wait starts and then leaves no blank iframe,
    and one that lands after the wait is done and the embed has been clicked.
  - Fixture: `player-delayed-single.html?reload`. First visit: the first
    interaction sets a cookie and reloads (tied to the interaction, not a timer, so
    it lands in the wait every run). Second visit (cookie): the hover-only page,
    whose iframe is put back into the document 600 ms after load, so a look right
    after the reload finds none. Test at the end of the press-targets spec: "a
    first-visit reload that lands in the wait does not end it...", which also
    asserts the page was requested twice.
  - **Red on ae2902a6's `provoke.ts`:** `AppError: No downloadable video stream
    was found on that page.` (4.4 s). **Mutations** (each red, 3.4-5.6 s, same
    error): the round's `catch` ending the wait as before (`state.done = true;
    break`), and the not-yet-parsed retry disabled (`if (true)` for
    `if (!replaced)`).
  - Live, the traced script, against this build: 6 of 6 (OK at 23.1, 18.8, 18.0,
    23.0, 21.5, 17.3 s). Second main load / provoke-playback start, seconds:
    3.2/4.0, 1.0*/1.8, 3.7/4.0, 3.1/3.9, 3.6/4.1, 3.5/4.0 (*the log's own
    out-of-order stamp). **None of the six had the reload land after provocation
    began**, so they show no regression, not the fix; the fix is shown by the
    fixture, and by an earlier run with the same code minus the not-yet-parsed
    retry (5 of 6; its miss had the second load at 5.1 s, provoke at 4.0 s,
    provocation over at 6.4 s: the retry case above).
  - `npm run check` exit 0; `npm test -- --project downloader` 2670 passed, 2
    skipped. e2e and container gates not run.
- 2026-11-15 — Round 4 (the "not covered" case happens live). The coordinator's
  6 runs of b1705c67 came to 5 of 6; the miss had its second load 0.8 s into
  provocation. My own 6 runs of b1705c67 were 6 of 6 (none had the reload after
  provocation began); a first round-4 build, the counter only, came to 5 of 6,
  and its miss is the second way the wait could still end on "no blank iframe"
  in a document that was not ready.
  - **Replacement is counted from the start of `provokePlayback`, not of the
    wait.** `provokePlayback` listens for main-frame `framenavigated` for the
    whole call (removed in a `finally`) and hands the count to the wait
    (`BlankPlayerWait.navigations`); a wait that begins after a reload began
    already counts as replaced, so "no blank iframe" in the new document is
    retried instead of ending it. Fixture `player-delayed-single.html?reload=early`
    adds a dialog over the page whose Close button the tier's first step presses;
    that press is the first interaction, so the page reloads before the wait has
    begun. **Red on b1705c67's `provoke.ts`** 3 of 3 (`AppError: No downloadable
    video stream was found on that page.`, 3.1-5.5 s); mutation `let replaced =
    false` (wait-relative tracking) red 2 of 2 on the final fixture. The first
    version of the fixture also reloaded from the Close handler and the page was
    requested three times; the handler no longer reloads, the count asserted is 2.
  - **A document still loading is not a page without the iframe.** The last
    live miss (second load at 5.5 s, provoke-playback at 6.0 s, provocation over
    at 7.4 s) had the reload land before provocation began, so the counter above
    did not see it, and the document was still loading when the wait looked.
    The mark script found no visible blank iframe and the wait ended. A no-match
    in a document whose `readyState` is not `complete` is now retried, bounded
    like the rest; a complete document with none still ends it at once. **This
    sentence said "so a page with no blank iframe pays nothing", which was false
    for a still-loading page (up to the whole 6 s); gate 1 measured it, and the
    gate round below corrects it.** I did not observe this directly (no
    instrumentation in the run); it is the reading that fits the log and the
    fixture reproduces the shape. Fixture `?slow`: the page holds its `load`
    event 3 s on a script from a new fixture-server route `/slow-asset.js`, and
    puts the iframe in only at `load`. **Red** before the change (2 of 2, same
    error, 4.5 s).
  - Live, the final build, `resolve-ls.mjs`, 6 of 6 (OK 20.4, 23.6, 19.1, 16.6,
    21.4, 20.1 s). Second main load / provoke-playback start: 3.6/4.1, 5.0/5.2,
    3.8/4.1, 3.8/4.0, 3.5/4.3, 3.7/4.3. In the 12 runs before it the shape that
    failed was a second load at or after provoke start (runs resolved when it
    landed 0.5 s after: 1.9/4.4 with the load at 4.9). The earlier round-4 build
    (counter only): 5 of 6, its miss the slow-document one above.
  - `npm run check` exit 0; `npm test -- --project downloader` 2672 passed, 2
    skipped. e2e and container gates not run.

- 2026-11-15 — Gate round 1 (FAIL at 4fe63aeb; the owner's answers are under the
  Decision). Merged `origin/main` (dl-142 as b795fa13) first; the 7 older dl-143
  tests and the new ones pass on the merged tree.
  - **F1 (high), remedy (a).** A still-loading document with no blank player
    iframe is retried for `BLANK_PLAYER_LOADING_RETRY_MS` (1000) only, unless a
    replacement was counted, and only **cross-document** main-frame navigations
    are counted: the counter listens to main-frame navigation `request`s, which a
    reload, a redirect or a link makes and `pushState`/`replaceState` do not.
    Tests: a page with no iframe whose `load` a hung image holds
    (`player-hung-subresource`, `provokePlayback` 2 s after `domcontentloaded`)
    was red at 6120 ms against a `< 3000` bound, now under it; a page rewriting
    its hash every 50 ms after its dialog's Close press (`player-hash-churn`) was
    red at 6270 ms, now green. Mutations: counting `framenavigated` again reds the
    hash test (6830 ms); an uncapped loading retry reds the hung test (8319 ms); no
    loading retry reds `?slow` (4446 ms). `?slow` was retimed: the server's
    `/slow-asset.js` answers after 2.5 s, not 3, so the document is still loading
    when the wait looks but done inside the 1 s cap. The
    `BLANK_PLAYER_FILL_WAIT_MS` docstring now says what is true: no wait on a
    complete document with no blank iframe, at most the 1 s retry on a loading
    one, the whole wait only after a counted reload.
  - **F2 (med).** `BLANK_PLAYER_IFRAMES_FN` stops its ancestor walk before
    `<body>`: the iframe and its ancestors below `body` are tested for a
    player-ish class or id, so `body.single-player-page` no longer makes a
    script-written ad slot a blank player iframe. Test `player-adslot-body-class`
    was red at 8478 ms against `< 3000`; the mutation (walking through `body`
    again) is red at 6195 ms. dl-139's tests, unedited, pass, and its press reads
    the same predicate, so the change reaches it. The live post is unaffected
    (6 of 6 below).
  - **F3 (low).** Test "an iframe that the delayed script adds while the probe
    waits is visited in the same pass, not only in the next"
    (`player-delayed-late-frame`: the delayed script fills the blank iframe with
    an inert page and adds a second iframe with the clickable embed, removed 3.5 s
    later; the second pass is 3 s after the first). The mutation, one frame list
    per pass, reds it (`expected [ ... ] to include '/media/related/master.m3u8'`).
  - **F6 (med).** The "pays no wait" timing test read `Date.now()`. A wall-clock
    step inside the timed span of the plain run inflates it and shortens the
    difference: the failing 3751 is 6251 minus 2500, the sandbox's 2.5 s forward
    step (measured by dl-144's gate 2) to the millisecond, so that is the cause
    by arithmetic, not by a captured step. The test, and the wait's own elapsed
    times, now read `performance.now()`; `remaining(deadline)` still reads
    `Date.now`, as everywhere in the tier. 20 runs of the test after the change:
    20 of 20 green (before: 1 in 10 red).
  - **F4 and F5 (lows) are recorded and not fixed.** F4: the hover is not a
    press for dl-144, and that branch follows a top-frame navigation before the
    first press as the page's own, so a navigation that a page's `mouseover`
    handler sets off moves the landing URL rather than reading as a departure; no
    live call site. F5: an abort thrown in the wait is swallowed by
    `provokePlayback`'s per-frame `catch` (older than this branch), so the rest of
    pass 0's frames are visited before the pass pause rethrows.
  - Live, the final build, 6 of 6 (OK 19.2, 21.0, 19.3, 17.8, 20.2, 19.0 s).
    Second main load / provoke-playback start, seconds: 3.3/4.1, 4.0/4.4,
    3.3/3.9, 3.5/4.0, 3.3/4.0, 3.3/4.1. None had the reload after provocation
    began.
  - `npm run check` exit 0; `npm test -- --project downloader` 2699 passed, 2
    skipped. e2e and container gates not run.

## Review

**Gate: FAIL** — 2026-11-15 · `5f15e56f..4fe63aeb` · Opus 5.5, depth medium

| Done when                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The single-iframe delayed fixture resolves through the browser tier, and is red on `main`'s `provoke.ts`             | `resolvers/test/browser/browser-resolver-press-targets.test.ts` › "a player iframe that a delay-JS plugin fills after the first interaction resolves, once its embed has hopped to the document with the player" ✓ (asserts the first variant is the embed's `/media/related/master.m3u8`); red with the base's `provoke.ts`, rerun by the gate: `NO_MEDIA_FOUND` in 3069 ms |
| The delayed-tab fixture resolves                                                                                     | same file › "a server tab whose handler a delay-JS plugin registers late is pressed once the page is ready" ✓ (the variant and the `/beacon/delayed-tab-0` press); red with the base's `provoke.ts`, `NO_MEDIA_FOUND` in 2964 ms                                                                                                                                             |
| A page with no blank player iframe pays no wait                                                                      | **not met** — a page with no iframe at all whose `load` is still pending pays the whole wait: `provokePlayback` 6173 ms at this head against 117 ms with the base's `provoke.ts` (F1). The branch's test, "a page with no blank player iframe pays no wait, and one whose iframe never fills pays the bound", measures only a document that is `complete`                    |
| `npm run check` exits 0; `npm test -- --project downloader` passes, or every failure is shown to also fail on `main` | verified — `npm run check` exit 0; `npm test -- --project downloader` exit 0, 2672 passed, 2 skipped (129 files, 1 skipped); the press-targets spec 42 of 42                                                                                                                                                                                                                 |

- **high** · F1 · Done when 3 depends on it · **open decision** ·
  `waitForBlankPlayerFill` in `resolvers/src/browser/provoke.ts` treats "no
  blank player iframe" as final only when `document.readyState` is `complete`
  (the round-4 retry). So a page with no player iframe at all, whose `load` is
  held by one slow subresource (an ad, a tracker), polls until `load` or until
  `BLANK_PLAYER_FILL_WAIT_MS` runs out. Measured with `provokePlayback` 2 s after
  `domcontentloaded`, which is the point the tier reaches after its 1.5 s `load`
  budget and settle. The page is a `.player` div with an `<img>` whose request never
  answers: 6173 ms at this head, 117 ms with the base's `provoke.ts`. The same
  page without the image takes 118 ms. Every probe of such a page pays this
  before its first play click, unless a stream was captured already. The shipped
  text is false in the unsafe direction: the `BLANK_PLAYER_FILL_WAIT_MS`
  docstring ("only on a page that has a blank player iframe") and the Log's round-4
  claim ("a complete document with none still ends it at once, so a page with
  no blank iframe pays nothing"). The second route to the same cost is
  unmeasured: `framenavigated` counted a same-document `replaceState` and
  `pushState` (one each in the gate's probe), so a hash change before the wait's
  first look would also make a complete page with no iframe pay the wait. In the
  gate's fixture the change landed after that look (96 ms and 112 ms). Options:
  (a) **recommended** — when no replacement was counted, retry a still-loading
  document for a short cap only (for example `BLANK_PLAYER_RELEASE_WAIT_MS`),
  and count only cross-document main-frame navigations; `?slow` may need
  retiming. This is untested and only a direction. (b) The owner rewords
  Done when 3 to "a page whose document is complete…" and accepts up to 6 s on
  slow-loading pages; the cost on real traffic is unmeasured. (c) Drop the
  round-4 retry and its `?slow` test, and accept the live miss it answered
  (1 run in about 12 in the Log).
- **med** · F2 · no `Done when` line depends on it · `BLANK_PLAYER_IFRAMES_FN`
  (dl-139's predicate, reused as the brief asked) also matches a visible,
  script-written `about:blank` iframe under any `[class*="player"]` or
  `[id*="player"]` ancestor, `<body>` included. Before this change that cost
  nothing without a server tab. Now it costs the whole wait, and the hover is
  aimed at that iframe: an ad slot written with `document.write` under
  `<body class="single single-player-page">` took 6305 ms against 177 ms on the
  base, and the same slot under `<body class="single">` took 184 ms. Direction
  only, untested: bound the ancestor walk short of `body` and `html`, or require
  an address-carrying attribute on the iframe. dl-139's press reads the same
  predicate, so the fix reaches it too.
- **low** · F3 · Build step 3's route, re-reading `page.frames()` before each
  visit, has no teeth. Restoring a once-per-pass snapshot (mutation `snapshot`)
  leaves all 7 dl-143 tests green.
- **low** · F4 · `nfr:reliability` · the hover is not a press for dl-144 (branch
  `downloader/dl-144-pre-press-self-redirect`, not merged), and that branch
  follows a top-frame navigation before the first press as the page's own. A
  navigation that a page's `mouseover` handler sets off would therefore move the
  landing URL rather than read as a departure. The delay-JS first-visit reload is
  the wanted case of this, and the gate saw no page that does it with a
  different URL. No live call site.
- **low** · F5 · an abort thrown in the wait is swallowed by `provokePlayback`'s
  per-frame `catch`, so the rest of pass 0's frames are still visited before the
  pass pause's `sleep` rethrows. The `catch` is older than this branch; the wait
  is a new thrower behind it.
- **med** · F6 · Done when 3 depends on it · the line's named proof is a
  wall-clock assertion that failed 1 run in 10: `npx vitest run
  browser-resolver-press-targets.test.ts -t "pays no wait"` ten times, run 1
  `AssertionError: expected 3751 to be greater than 5000` (test 6558 ms) and
  runs 2–10 green. Unexplained: the `?never` page's wait ended about 1.2 s
  short of its bound in that run.
- **dropped** · unbounded pass from the `visited` loop on a page that keeps
  attaching iframes: an iframe replaced every 200 ms took 178 ms at this head
  and 188 ms on the base. Not a defect.
- **dropped** · unbounded reload and hover loops: `allowedMs` is fixed per call
  from the shared `spentMs`, the deadline less 1500 and the cap, and the inner
  loop, the hovers and the reload rounds all sit inside it. The awaits without a
  timeout (`evaluate`, `boundingBox`, `mouse.move`) have the same exposure as the
  existing `SCROLL_SCRIPT` evaluate, under `browser.ts`'s hard cap.
- **dropped** · names in the diff: no host, site or video address in any added
  line. LiteSpeed and `guest.vary` name the plugin, not a site.
- **findings** · the hunt returned 9; 6 carried, 3 dropped.
- Teeth: the `nohover` mutation turned 4 of 7 dl-143 tests red, `nocounter`
  turned 2 red (the `reload=early` one included), and `noready` turned 2 red
  (`?slow`, and the never-fills timing test).
- Merge with `main` (dl-142 landed as `b795fa13`): `git merge-tree` is clean.
  On the merged tree, 7 of 7 dl-143 tests and 32 of 32 in
  `browser-resolver-player-input.test.ts` pass, so dl-142's refusal of an
  iframe box leaves this page's in-frame click intact.
- NFR: security — F2 aims a hover at an ad iframe; no host names · performance —
  F1, F2 · reliability — F4, F5, F6 · maintainability — F3.

### Gate 2

**Gate: FAIL** — 2026-11-16 · `4fe63aeb..1d409c19` (the round's own change read as `b3fe8a4c..1d409c19`; dl-142's files from the `origin/main` merge left out) · Opus 5.5, depth narrow

| Done when                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The single-iframe delayed fixture resolves through the browser tier, and is red on `main`'s `provoke.ts`             | `resolvers/test/browser/browser-resolver-press-targets.test.ts` › "a player iframe that a delay-JS plugin fills after the first interaction resolves, once its embed has hopped to the document with the player" ✓, 46 of 46 in the spec on 2 runs; red on the base measured by gate 1 and not re-run (the round does not touch this test)                                                                                                                                                            |
| The delayed-tab fixture resolves                                                                                     | same file › "a server tab whose handler a delay-JS plugin registers late is pressed once the page is ready" ✓                                                                                                                                                                                                                                                                                                                                                                                         |
| A page with no blank player iframe pays no wait                                                                      | **not met** (F1, fixed in part). The round's tests prove three cases: a page still loading pays the 1 s retry, not the whole wait; a hash rewrite is not counted; a `body` class is not a player. But a complete page with no iframe whose main frame makes a navigation request that never commits pays the whole wait, about 6.1 s against about 0.1 s: a 204, a download, a request cancelled by `window.stop()` or replaced by another. The owner's answer counts only cross-document navigations |
| `npm run check` exits 0; `npm test -- --project downloader` passes, or every failure is shown to also fail on `main` | verified: `npm run check` exit 0; `npm test -- --project downloader` exit 0, 2699 passed, 2 skipped (129 files, 1 skipped)                                                                                                                                                                                                                                                                                                                                                                            |

- **high** · F1 · **fixed in part** · Done when 3 depends on it · **open
  decision** · The loading cap holds. A page with no iframe whose `load` a hung
  image holds took 1147 ms and 1161 ms, against 76 ms and 81 ms with `main`'s
  `provoke.ts`. The remaining gap is in the counter. `provokePlayback`'s
  `onRequest` counts every main-frame `request` with
  `isNavigationRequest()`, and a navigation request is not a cross-document
  navigation. The gate's probe used a complete page with no iframe and started
  the navigation with `setTimeout(..., 0)` just before `provokePlayback`. At
  this head the wait was paid in full 12 times out of 12 for requests that never
  commit (`mainCommits=0` in every one):
  - 204: 6194, 6163 and 6122 ms
  - download: 6172, 6144 and 6171 ms
  - `window.stop()`: 6185, 6262 and 6243 ms
  - superseded by a 204: 6249, 6282 and 6265 ms

  With gate 1's head `provoke.ts`, which counted `framenavigated`, the same
  requests took 69–181 ms. `main` took 106–171 ms. A reload and a committed
  navigation pay about 6.1 s in both, which is the cost the owner accepted.
  Shipped text that is false in the unsafe direction: the counter's comment
  says "Cross-document navigations of the main frame only", and
  `BLANK_PLAYER_FILL_WAIT_MS`'s docstring says "the whole wait only if a
  cross-document navigation (a reload) was seen". The window is from
  `provokePlayback`'s start to the wait's first look: the modal, consent and age
  steps and the scroll. No live page has been seen to make such a request
  there. Options:
  - (a) **Recommended, direction only and untested.** Count a main-frame
    navigation only once it commits. One way is to pair the navigation
    `request` with the next main-frame `framenavigated`, which a 204, a
    download and a cancelled request never reach and a `pushState` reaches with
    no request.
  - (b) The owner accepts the cost. Done when 3, the comment and the docstring
    are reworded to "a main-frame navigation request".

- **med** · F2 · **fixed** · `body.single-player-page` with a script-written
  ad slot: 126 ms, against 130 ms on `main`. Ancestors are no longer read
  through `<body>`, and a blank player iframe placed directly in `<body>` with
  no wrapper is still matched by its own class (`player-frame`), id
  (`player-0`) or title: 6163, 6133 and 6158 ms when it never fills, against
  125–129 ms on `main`. A player token only on `<body>` is not matched (123 ms),
  which is what the fix intends. dl-139's tests are unedited (the branch's diff
  of the press-targets spec has no deletions) and pass, 46 of 46 on 2 runs.
- **low** · F3 · **fixed** · the `snapshot` mutation, one frame list per
  pass, turns "an iframe that the delayed script adds while the probe waits is
  visited in the same pass, not only in the next" red: `expected [ …(3) ] to
  include '/media/related/master.m3u8'`.
- **low** · F4 · **not fixed**, recorded by the owner's choice.
- **low** · F5 · **not fixed**, recorded by the owner's choice.
- **med** · F6 · **fixed** · the timing test, "a page with no blank player
  iframe pays no wait, and one whose iframe never fills pays the bound", and
  the wait's elapsed times read `performance.now()`. `Date.now()` is left only
  in the `deadline:` arguments, which are out of scope (dl-145). 20 of 20 runs
  of the test passed.
- **low** · `nfr:maintainability` · two comments in `provoke.ts` the round
  made stale. Each is false in the safe direction, and nothing relies on
  either:
  - The `BLANK_PLAYER_STABLE_MS` docstring ("A filled frame is loaded when…")
    now sits above `BLANK_PLAYER_LOADING_RETRY_MS`'s, so the stable-window
    constant has no docstring.
  - `BLANK_PLAYER_IFRAMES_FN`'s header still says a player-ish class or id "on
    it or an ancestor", with no stop before `<body>`.
- **low** · the walk's `/player/i` test of class and id is case-insensitive,
  but `[class*="player"]` was case-sensitive. A `class="videoPlayer"` ancestor
  now matches where it did not. That widens dl-139's press as well. Unmeasured,
  and no live call site is known.
- **dropped** · out of range · with a main-frame navigation that never answers
  and is never cancelled, `provokePlayback` was still running at 40 s against a
  30 s deadline, both at this head and with `main`'s `provoke.ts`. The behaviour
  is older than this branch.
- **dropped** · `player-hash-churn.html` names `framenavigated` as the counter
  that would have counted its rewrite. That is why the fixture exists, so the
  comment is not stale.
- **findings** · the round's attacks returned 5: F1's residue, which is carried
  as F1, two lows carried and two dropped. Gate 1's six were re-graded.
- Names in the diff: the added lines contain no host or site name.
- NFR: security — the hover no longer reaches a `body`-class ad slot · performance — F1 ·
  reliability — F4, F5 unchanged · maintainability — the two lows.
