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
