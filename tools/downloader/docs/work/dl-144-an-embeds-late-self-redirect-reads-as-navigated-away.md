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
