---
id: dl-144
tool: downloader
title: An embed whose own script redirects the top frame to a mirror after the landing window reads as navigated-away
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-144 — An embed's own late top-frame redirect reads as navigated-away

## Why

Seen in dev on 2026-11-15, while diagnosing dl-143. A third-party embed host's
`/e/<id>` page, pasted on its own into `POST /api/probe`, answers
`NO_MEDIA_FOUND` in about 7 s. `BrowserResolver`, called directly with a logger,
reports:

```
stage page-load        0.2 s
stage provoke-playback 1.7 s
stage network-quiet    3.0 s
WARN browser tier left the landing page during provocation
  {"step":"network-quiet","landingUrl":"https://<embed-host>/e/<id>",
   "departedTo":"https://<mirror-host>/e/<id>"}
NO_MEDIA_FOUND {"reason":"navigated-away", ...}
```

Measured with Playwright on the live embed, same day (times from `goto`): the
page's own script posts to its API at 0.8 s, requests the mirror's document at
1.2 s, and the top frame commits the navigation to `https://<mirror-host>/e/<same
id>` at 1.7 s, with no click. On the mirror, the player requests its HLS master
playlist on load (2.1 s), also with no click. The mirror address pasted on its
own resolves through the browser tier: one 720p HLS variant.

dl-55's decision 2 records the landing URL after `load` plus
`LANDING_URL_SETTLE_MS` (500 ms), so that "a redirect during load is legitimate
and never counts". This redirect lands just past that window, and from then on
`watchForDeparture` treats any top-frame navigation as a click that opened
something else.

## Decision — answered 2026-11-15 by the owner

**Answer: re-take the landing URL until the tier's first press**, as
recommended, chosen from:

- **A. Re-take the landing URL before the first press (recommended).** Until the
  browser tier has made its first press or click on the page, a top-frame
  navigation is the page redirecting itself, so the landing URL follows it. After
  the first press, dl-55's guard is unchanged. It is narrow. The risk is a
  redirect that lands within milliseconds after the first press, which still
  counts as a departure.
- B. Raise `LANDING_URL_SETTLE_MS` to about 2 s. One constant, but every probe
  pays the extra time, and a slower redirect still trips it.
- C. File only, and paste the mirror address meanwhile.

dl-55's option B ("count a departure only when it follows one of the tier's own
clicks") was rejected by the owner then, for the settle window. A narrows the
window it leaves open and does not reopen that decision: after the first press,
every top-frame navigation still counts, whether or not a click caused it.

Gate round 1 — answered 2026-11-15 by the owner: fix both meds and the low in this round.

## Build

1. **Fixture first, red on `main`.** A page on the fixture origin whose script,
   about 1000 ms after `load`, runs `location.replace` to the secondary fixture
   origin (`{{SECONDARY}}`) at the same `/e/<id>`-style path. The target page
   requests an HLS manifest from the fixture origin on load, with no click. Run
   the test red against `main`, failing as `navigated-away`, and record that in
   the Log. Pick the delay so it lands after `LANDING_URL_SETTLE_MS` and before
   the tier's first press. Measure where the first press falls on the fixture
   and say so in the Log. If the margin is thin, it is the brief's named risk;
   report it rather than widening anything.
2. **The signal.** `provokePlayback` (in `resolvers/src/browser/provoke.ts`)
   reports the tier's first press or click. That means any step that presses on
   the page: modal close, consent, age gate, dl-139's server tab, play
   selectors, play text, the video-surface click, the box click and
   `provokeInput`'s clicks. A scroll, a wheel input that is not a click, and a
   `.play()` call in script are not presses; say in the Log if you decide
   otherwise for any of them. Prefer one narrow seam (an `onFirstPress`
   callback, or a flag object passed in) over threading a value through every
   helper. The press count `provokeFrame` already returns is not enough, since
   it leaves out several kinds.
3. **The guard.** In `resolvers/src/resolvers/browser.ts`, `watchForDeparture`:
   until the first press has been signalled, a main-frame navigation updates the
   landing URL instead of recording a departure. After it, unchanged. The
   `departure` warn log and the `navigated-away` details stay as they are, and
   carry the _updated_ landing URL.
4. **What was collected before the hop.** The landing page's own hits from
   before the redirect (here, a master playlist request from the first document)
   are in the collector too. Decide whether they stay, say why in the Log, and
   make sure ranking still chooses the mirror's stream on the fixture.
5. Tests appended at the **end** of the right suite (find where dl-55's departure
   tests live). The late self-redirect resolves. A navigation after a press is
   still `navigated-away` (dl-55's existing tests must stay green unedited; if
   one has to change, stop and say why in your report). Mutation: disabling the
   pre-press exception turns the new test red.

## Traps

- **This repository is public.** Never write the live embed host, its mirror
  domain or any video address into a file, a commit or a PR. Write
  `<embed-host>` / `<mirror-host>` as above.
- dl-143 is being built at the same time, in `provokeFrame` (a bounded wait for a
  blank player iframe to fill). Keep your `provoke.ts` change to the signal
  seam, so the two merge cleanly. dl-142 (draft PR #817) also touches
  `provoke.ts`'s box click. Neither is a base for this branch.
- The SSRF guard re-checks navigations. A redirect to a private address must
  still be refused exactly as on `main`, whichever way the landing URL moves.

## Done when

- The late self-redirect fixture resolves through the browser tier, and is
  `navigated-away` on `main`.
- A top-frame navigation after the tier's first press is still `navigated-away`,
  and dl-55's existing tests pass unedited.
- `npm run check` exits 0; `npm test -- --project downloader` passes, or every
  failure is shown to also fail on `main`.

## Log

- 2026-11-15 — built (builder). Branch `downloader/dl-144-pre-press-self-redirect`.
  - **Signal.** `provokePlayback` takes `onFirstPress?: () => void`. It registers a
    once-only listener in a `WeakMap<Page, …>` in `provoke.ts`; each click site
    calls `notePress(frame)` just before the click (ten sites: `clickVisible`,
    `clickByText`, `clickByTextIn` (consent text), the modal close (marked and
    semantic), the age press, the chosen-`<video>` click (scriptable and not),
    the box click, dl-139's server tab). No helper signature changed, which keeps
    the merge with dl-143 and dl-142 to the lines they already touch. Announced
    before the click and on attempt, not success: a navigation can commit before
    `click()` returns, and a covered click that times out only puts the guard back
    to dl-55's strict reading. Not presses, as the Build section said: the scroll,
    `mouse.wheel`, `play()` in script and the `Escape` key (`dismissModal`'s
    fallback). The listener stays for the page's life, so `revisitOverlays`
    presses are announced too (a no-op once the first has been).
  - **Guard.** `watchForDeparture` now owns the landing URL: before `pressed()` a
    main-frame navigation off it moves it (and remembers the one left); after,
    dl-55 unchanged. The warn log and `navigated-away` details read the guard's
    current landing URL. The settle window is untouched, and "count only after the
    tier's own clicks" is not what this does: after the first press every
    top-frame navigation counts.
  - **Hits collected before the hop (Build 4): dropped at ranking.** Measured, not
    guessed: with a first document that fetches `master.m3u8` before hopping,
    ranking chose the abandoned page's manifest, because answered manifests order
    by arrival (dl-92) and it arrived first. They belong to the page that was
    left, as dl-55 says of hits after a departure. Filtered in `browser.ts` just
    before `rankHits`, by the `frameUrl` the collector already records with each
    hit, against the set of landing URLs the guard left. Not cleared at the hop:
    that read races the mirror's own first request (it can fire before Node sees
    `framenavigated`) and could drop the stream wanted. The collector itself is
    unchanged, so `hasPlayableHit()` still counts a pre-hop hit for the press
    gates and the quiet floor; only the result ignores it.
  - **Red on `main`** (tests written first, run with only the fixtures): the late
    redirect test failed `AppError: No downloadable video stream was found on that
    page.` with details `{"reason":"navigated-away","url":"<primary>/guard-late-embed.html",
    "departedTo":"<secondary>/guard-late-embed.html"}`; the post-press test failed
    on `details.url` (expected the mirror, received the primary page's URL).
  - **Mutation.** `let hasPressed = false` -> `true` in `watchForDeparture` turns
    both new tests red (2 failed). Making `onFirstPress` a no-op turns the
    post-press test red. Both restored.
  - **Margin.** Fixture: the hop lands 1000 ms after `load` (503 ms after the
    landing URL is read); the first document has nothing to press, and the mirror's
    play button is first pressed ~535 ms after the hop (T0+1044 vs hop T0+509).
    Live embed, two runs through the built tier: run 1, hop at +413 ms from the
    landing read, first press at +1462 ms (about 1 s clear); run 2, the hop had
    already landed before the landing URL was read and the first press came at
    +79 ms on the mirror. Both resolved to a 720p HLS variant in about 7.7 s; on
    `main` the same embed ended `NO_MEDIA_FOUND`, `navigated-away`. The named risk
    (a hop within milliseconds of the first press) did not occur, but it is a
    measured gap of about one second on one embed, not a proof.
  - **Brief nits.** The fixture is one file serving both origins (`{{PRIMARY}}`
    branch), so the mirror really is the same path. `{{SECONDARY}}` and
    `{{PRIMARY}}` are substituted only in `.html`, as expected. No existing test
    changed.
  - **Not proved by CI:** e2e and the container build were not run.

- 2026-11-15 — round 1 (gate 1, CONCERNS; owner: fix both meds and the low).
  - **Med 1, the captured set.** `HitCollector.exclude(predicate)` rules hits out
    of `hits` and `hasPlayableHit()` alike, so ranking, the `hasPlayable` the press
    gates read and `waitForQuiet`'s empty floor (dl-80) see one set. `browser.ts`
    installs it from the guard and no longer filters before `rankHits`;
    `countPlayedSegments` reads the same set. Test: "a hit the result will ignore
    does not end the empty floor on the mirror" (first document fetches a manifest
    and hops, the mirror fetches 5 s after its load). Red at 0359e152:
    `AppError: No downloadable video stream was found on that page.` after 5.9 s.
    The press-gate half is covered by the same single set, not by its own test (the
    gate had no working control for it either).
  - **Med 2, by document.** The guard now adds a landing URL to `left` only when a
    top-frame document request (`isNavigationRequest`) preceded the navigation, so
    a `replaceState`/`pushState` leaves nothing behind; and `isLeftBehind` never
    answers true for the current landing URL, so A, B, A keeps the final document.
    Tests: "a same-document rewrite before the first press keeps the page's own
    stream" and "a hop out and back to the same address keeps the final document's
    stream" (cookie tells A's second visit from its first). Both red at 0359e152
    with the same `NO_MEDIA_FOUND` error. Cost: hits of the _first_ A document are
    kept in an A, B, A bounce, since they carry the same address as the final one.
  - **Mutations** (each turns exactly its own test red, the other two stay green):
    `hasPlayableHit` back to the raw map -> floor test; `left.add` without the
    document-request test -> replaceState test; `isLeftBehind` without the
    current-landing-URL guard -> bounce test.
  - **Low, the comment.** The cost is any self-redirect after the first press, not
    "within milliseconds". The gate measured, on a primary page with a 640x360
    player box and a hop at `load` + 1000 ms, the box pressed on the primary first
    and the probe ending `navigated-away` at 1.65 s: on a page with something to
    press, the first press can come within about 0.5 s of the landing read. The
    reported embed is clear of it (first press ~1 s after its hop, two live runs).
    `watchForDeparture`'s comment now says so; the Decision above is the owner's
    wording and is left as answered.
  - **A flake seen, not explained.** dl-105's "a wall clock stepped back before
    the wait does not read as a floor that returned early" failed intermittently
    while this round was built (`expected 1410 / 1607 to be greater than or equal
    to 3000`: the wait ended at its quiet gate, as if a playable hit were
    captured): two full-suite runs and 3 of ~10 file runs. Nothing in this round
    touches a page with no hits (`exclude` is unset-equivalent there). I could
    not reproduce it with a debug dump of the hits, alone (0 of 12), nor at
    0359e152's sources (0 of ~16, including 6 interleaved pairs where the new
    sources failed 1 of 6). The last two full-suite runs at the final head were
    clean (2670 passed, 2 skipped). Treat it as an open question for whoever
    next sees it, not as cleared.

## Review

**Gate: CONCERNS** — 2026-11-15 · `5f15e56f..0359e152` · Opus 5.5, depth standard

| Done when                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The late self-redirect fixture resolves through the browser tier, and is `navigated-away` on `main`                     | `resolvers/test/browser/browser-resolver-departure-and-floor.test.ts` › "an embed that moves itself to a mirror after the settle window resolves the mirror's stream" ✓ (asserts `variants[0].url` is the secondary origin's `master.m3u8`). The `main` clause was verified by mutation: with the pre-press branch in `watchForDeparture` disabled (dl-55's guard as on `main`), the test throws `NO_MEDIA_FOUND` with `reason: "navigated-away"` |
| A top-frame navigation after the tier's first press is still `navigated-away`, and dl-55's existing tests pass unedited | same file › "a press on the mirror that navigates is still a departure, measured from the mirror" ✓ (asserts `reason`, `url` = mirror, `departedTo`, and the warn's `landingUrl`). dl-55's tests are in the same file under "a navigation away from the landing page fails NO_MEDIA_FOUND (dl-55)" and pass. The branch's test diff only adds lines (39 added, 0 removed)                                                                         |
| `npm run check` exits 0; `npm test -- --project downloader` passes                                                      | **verified**: `npm run check` exit 0; `npm test -- --project downloader` exit 0, 2667 passed and 2 skipped of 2669, 129 files passed and 1 skipped of 130                                                                                                                                                                                                                                                                                         |

- **med** · no `Done when` line depends on it · builder's choice (1) is wrong for the quiet floor. A hit dropped at ranking by `leftBehind` still counts in `HitCollector.hasPlayableHit()`. `waitForQuiet` therefore drops dl-80's 9 s empty floor on the mirror, and a mirror whose player asks for its manifest late ends empty. Reproduced with production waits: a first document fetches `master.m3u8` and then hops at `load`+1000 ms, and the mirror fetches 5 s after its own load. That probe ended `NO_MEDIA_FOUND` at 3.7 s, with 1 master request (the pre-hop one). The same page without the pre-hop fetch resolved the mirror's stream at 6.35 s. On `main`, with the guard as it was, both are `navigated-away`, so nothing got worse than `main`. But the fix does not reach these pages. The press-gate half (the box click, the dl-139 server tab, the cross-origin `play()`) was not demonstrated: in my box-click control the box click never reached the mirror either. Direction, not tested: the `hasPlayable` passed to `provokePlayback` and the floor check in `waitForQuiet` should read the same filtered set that ranking reads. Recommended: fix in this round, since it is small.
- **med** · no `Done when` line depends on it · `leftBehind` is keyed by URL string, not by document. Suppose a same-document `history.replaceState` or `pushState` lands after the settle window and before the first press. The old URL goes into `left`, and the stream the still-live document already fetched is dropped. Reproduced: a page fetches its HLS manifest on parse, then at `load`+1000 ms runs `replaceState` to `?v=2`. At the head it ended `NO_MEDIA_FOUND` with no reason, which reads as plain absence (1 master request). With the guard as on `main` it was `navigated-away`. Without the `replaceState`, the same page resolved. So the outcome matches `main`, but the reported reason is now wrong, and a page move the Decision forgives still fails. dl-55's own comment in `browser.ts` names a router's `replaceState` that strips a tracking parameter as an observed pattern. Same mechanism, checked by reading only: an A→B→A bounce before the first press puts both URLs in `left`, which drops every hit from the final document. Direction, not tested: drop by document rather than by URL, and never drop a hit whose `frameUrl` is the current landing URL. Recommended: fix with the finding above.
- **low** · `nfr:maintainability` · the `watchForDeparture` comment (and the Decision it repeats) gives the remaining cost as "a redirect that lands within milliseconds after the first press". Measured on a primary page with a 640×360 player box and a self-hop at `load`+1000 ms: the tier pressed the box on the primary first, and the probe ended `navigated-away` at 1.65 s. The remaining window is any self-hop after the first press, and on a page with something to press that press can come within about 0.5 s of the landing read. The falsehood runs in the unsafe direction, but nothing in code relies on it. The builder's live measurement (first press about 1 s after the hop) shows the reported embed is clear of it. Recommended: reword the comment and record the measurement.
- **low** · `nfr:maintainability` · no test pins individual press sites. With every `notePress` disabled, 5 of 98 tests in the four departure-bearing files fail: dl-55 ×2, dl-83 ×2 and dl-144 ×1. Those cover the play press and the age press. Whether the modal close (×2), the consent-text click, the `<video>` click (×2), the box click and the server tab are each guarded was not measured site by site. By reading, all 10 Playwright `.click(` calls in `resolvers/src` are preceded by `notePress`. The ones left out (`keyboard.press("Escape")`, `mouse.wheel`, in-script `play()`) are the exclusions the Build named. No missed press site was found.
- **dropped** · builder's choice (2), a press announced on attempt rather than on success. A failed attempt only returns the guard to dl-55's strict reading, which is the safe direction. Not a defect.
- **dropped** · dl-55 decision 2 is not reopened. After `pressed()`, every top-frame navigation counts whatever caused it, and `LANDING_URL_SETTLE_MS` is untouched. With the pre-press branch disabled, both new tests fail, which shows the change sits only before the first press.
- **dropped** · the SSRF re-check. `landingUrl` and `leftBehind` are read only by the warn, the error details and the ranking filter in `browser.ts`. The API's egress proxy checks every connection, and the diff does not touch that path. This was verified by reading only, with no private-address probe run.
- **dropped** · public-repo leak. A grep of the whole diff, ticket included, for URLs and host names found none. The fixtures use `{{PRIMARY}}` and `{{SECONDARY}}`, and the ticket uses `<embed-host>` and `<mirror-host>`.
- **findings** · the hunt returned 8; 4 carried, 4 dropped.
- NFR: security ✓ (SSRF path unchanged, no hosts leaked) · performance ✓ (no new waits; settle constant unchanged) · reliability — the two meds above · maintainability — the two lows above.

### Gate 2

**Gate: CONCERNS** — 2026-11-15 · `0359e152..d971f140` · Opus 5.5, depth narrow (the round's diff, gate 1's probes, four attacks on the new guard, the dl-105 flake)

| Done when                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The late self-redirect fixture resolves through the browser tier, and is `navigated-away` on `main`                     | `resolvers/test/browser/browser-resolver-departure-and-floor.test.ts` › "an embed that moves itself to a mirror after the settle window resolves the mirror's stream" ✓ (asserts `variants[0].url` is the secondary origin's `master.m3u8`; passed in 10 of 10 file runs at the head). The `main` clause stands on gate 1's mutation M1; the round changes only the pre-press branch's `left.add`, not the `pressed` path M1 disabled |
| A top-frame navigation after the tier's first press is still `navigated-away`, and dl-55's existing tests pass unedited | same file › "a press on the mirror that navigates is still a departure, measured from the mirror" ✓. dl-55's tests pass, and the round's test diff only adds lines (38 added, 0 removed)                                                                                                                                                                                                                                              |
| `npm run check` exits 0; `npm test -- --project downloader` passes, or every failure is shown to also fail on `main`    | **verified**: `npm run check` exit 0; `npm test -- --project downloader` exit 0, 2670 passed and 2 skipped of 2672, 129 files passed and 1 skipped of 130. The intermittent dl-105 failure is the sandbox's clock, not the branch (see the dropped bullet below)                                                                                                                                                                      |

- **F1** (med) · **fixed**. `HitCollector.exclude` feeds `hits` and `hasPlayableHit()` alike, so ranking, the press gates' `hasPlayable` and the empty floor read one set. Verified with gate 1's probe: late-prehop ended `NO_MEDIA_FOUND` at 3.7 s at `0359e152`, and resolves the mirror's `master.m3u8` at 8.76 s at the head. box-prehop now runs the full floor (10.65 s, against 3.7 s), the same as box-control (10.64 s). The press-gate half still has no working control, because the box click does not reach the mirror in either probe.
- **F2** (med) · **fixed in part** · no `Done when` line depends on it. Fixed: the `replaceState` page now resolves its own stream (gate 1's replace probe), and the branch's bounce test passes. Three gaps remain, all from the same cause: the guard still judges a hit by the URL of the frame that issued it, not by the top-frame document.
  - **(a) A same-URL reload leaves the flag stale.** `onNavigated` returns on `sameDocument` before it resets `documentRequested`. So a page that reloads itself and then runs `replaceState` drops the live document's stream. Probe: the first visit sets a cookie and reloads at `load`+1000 ms; the reloaded document fetches its manifest and runs `replaceState` to `?v=2` at `load`+300 ms. It ended `NO_MEDIA_FOUND` with no reason and 1 master request. The control (reload only) resolved. Remedy, tested: read and clear the flag on every top-frame commit, before the `sameDocument` return. That makes the probe resolve, and the dl-144 and dl-55 tests pass (16 of 16). Not covered by that remedy, by reading only: a navigation request that never commits (a 204, a download) followed by a `replaceState`.
  - **(b) A child frame of the page that was left is not left behind.** Probe: the first document's player iframe fetches a manifest, the top frame hops at `load`+1000 ms, and the mirror fetches 5 s after its load. Result: the left page's `master.m3u8` at 3.67 s. The mirror's stream was never waited for. On `main` this page is `navigated-away`.
  - **(c) A live child frame at a left address is excluded.** Probe: the mirror iframes the original landing URL, and that frame plays. Result: `NO_MEDIA_FOUND` at 10.85 s, against the control (an iframe at another address), which resolved. This answers the dispatch's question: yes, `exclude` can hide a non-top frame's hits.
  - `isLeftBehind`'s doc comment ("By document, not by URL … the document now showing is never left behind") is false in (a) and (c). It overstates in the direction a reader would trust. Nothing in code relies on it.
  - Direction, not tested: stamp each hit with a top-frame document generation, and drop by generation rather than by frame URL.
- **F3** (low) · **fixed**. The `watchForDeparture` comment now gives the cost as any self-redirect after the first press, with gate 1's 0.5 s measurement. Verified by reading.
- **F4** (low) · **not fixed**, as the owner's round scope intended. No test pins the individual press sites.
- **N1** (low) · `nfr:maintainability` · the branch's Log says the dl-105 failure ended the wait "as if a playable hit were captured" and leaves it an open question. Measured: the sandbox steps the wall clock forward by 2.5 s for 50–100 ms, then back by 4.8 s, every 30 s of monotonic time; `/proc/uptime` agrees with `performance.now`. `waitForQuiet` reads `Date.now`. A tick inside the forward window ends the empty floor early. Planting that step 1 s into the wait ended it at 1007 ms on the head's sources and at 1018 ms on `0359e152`'s. The Log's 1-of-6 interleaved count is also confounded: with a fixed head/base order and runs of about 7 s, the 30 s step phase-locks onto one arm (in my first single-test loop 9 of 15 head runs held a step, against 0 of 15 base runs). The Log's text is wrong in the safe direction, and nothing relies on it.
- **dropped** · the dl-105 flake as a defect of this branch. Counts: the departure file 0 of 10 at the head and 0 of 10 at `0359e152`, interleaved. The test alone, fixed order: 1 of 15 and 0 of 15. The test alone, random order with jitter: 1 of 20 and 0 of 20. Every failure (2624 ms, 1824 ms) fell in a run that spanned a forward step. Head runs that held a step failed 2 of 19, against 0 of 4 for base. The difference is indistinguishable (Fisher p ≈ 0.5 over 2 of 40 against 0 of 40), the round does not touch `waitForQuiet`, and a planted step fails both sources. This is environment.
- **dropped** · out of the reviewed range: the floor's exposure to a forward wall-clock step is on `main` (`waitForQuiet` reads `Date.now`, and dl-105's test guards only a backward step). This goes in the report as an open decision, not as a finding here.
- **dropped** · `isNavigationRequest` is unreliable for a 302 hop or a bfcache return. Measured: a 302 inside the hop fires a main-frame navigation request for each leg. `history.back()` re-fetched the document (`back_forward`, the window marker did not survive), so bfcache did not serve it. A same-URL reload fires one; its handling is F2 (a).
- **findings** · the hunt returned 7: 3 folded into F2 as fixed in part, 1 carried (N1), 3 dropped.
- NFR: security ✓ (no host names in the round's diff; SSRF path unchanged) · performance ✓ (one `request` listener per probe, unlinked in `stop`) · reliability — F2 · maintainability — F4, N1.
