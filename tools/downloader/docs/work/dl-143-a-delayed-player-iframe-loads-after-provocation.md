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
