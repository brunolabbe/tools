---
id: dl-111
tool: downloader
title: Browser fixtures that fetch a manifest and never read its body stall every probe on the 3 s settle cap
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-111 — Browser fixtures that never read a fetched body stall each probe 3 s

## Why

CI's unit-test job runs for about 11.5 minutes, and `npm test` takes 620 s of
it on `ubuntu-latest`. Of that, 620 s is
`resolvers/test/browser/browser-resolver.test.ts`, whose 177 tests run serially
in one file (run 38203804906, 2026-10-12). On 2026-10-12 the owner asked for the
suite to be made faster by **testing the same thing more cheaply, not by adding
CPU**, because an orchestrator runs several reviewers on one machine at once.
This is the first of the tickets that came out of that audit (dl-111 to dl-117,
repo-99, repo-100).

The cheapest saving is a fixture defect, and it changes no production code.
Some fixture pages `fetch()` a manifest and never read the response. The
collector's body read for that request never completes, so
`collector.settle(Math.min(SETTLE_TIMEOUT_MS, …))` (`browser.ts:403`) waits
out its full 3000 ms cap (`SETTLE_TIMEOUT_MS`, `browser.ts:86`). The fixture
server sends `cache-control: no-store` (`helpers/fixture-server.ts:276`).

**Reproduced during the audit**, with scratch copies of the pages:

- `guard-fragment.html` as served: 5997 and 5866 ms. With the body read: 2942
  and 2868 ms.
- `shadow-player.html`: 5739 → 2801 ms.
- `cross-origin-shadow.html`: → 2802 ms.
- `cross-origin-scroll-player.html`: → 2781 ms.

None of the affected tests is about the cap. `sniff.test.ts:309` already tests
the abandoned-body cap without a browser.

## Build

1. **Find every fixture with an unread fetch.** Do not trust this list; time the
   tests. The CI per-test durations put the affected tests at about 5.7 to 6.0 s,
   against about 2.8 s for a normal probe. The tests seen there:
   - `browser-resolver.test.ts`
     - dl-55: same-origin iframe, related card, largest candidate, pushState
       departure, fragment only, script redirect, router replaceState, landing
       URL, the three `?t=`/`?start=`/`?autoplay=` rows, reordered query,
       cross-origin card.
     - dl-48: Escape.
     - dl-61 and dl-68: all four shadow-player tests.
     - dl-100: box click only, billboard, cross-origin scroll, cross-origin
       `play()`.
   - **Pages named as suspects:** `iframe-player.html` (lines 23–25),
     `guard-*.html`, `modal-escape.html` (51–53), `related-card*.html`,
     `cross-origin-card-inner.html`, `shadow-player*.html`,
     `player-box-click-only.html`, `player-box-billboard.html`,
     `xo-play-only-inner.html` and `xo-scroll-player-inner.html:24`. Also check
     the fixtures used by `consent-scope`, `chunk-streams`, `manifest-refetch`
     and `size-probe-behind-the-proxy`.
2. **Make each such page read what it fetches** (`await r.text()`, or
   `arrayBuffer()` for binary). Change nothing else about the page: the delay,
   the player and the request order are what the tests prove.
3. **Keep one test that abandons a body on purpose**, at resolver level, so the
   end-to-end path through `settle()`'s cap is still exercised by one browser
   test. Use a fixture named for it, and have the test assert that the probe
   still answers. Do not assert a timing.
4. **Do not drop `no-store`** from the fixture server. Inside one probe, a
   browser cache could hide repeated requests from `server.requests`, and several
   assertions count those (inferred by the audit).

## Done when

1. No browser test that is not about the settle cap takes 3 s more than the
   baseline probe. Proof: before and after per-test durations for every fixture
   changed, from a local run, in the Log.
2. Exactly one browser test exercises an abandoned body on purpose, and its
   name says so.
3. `npm test -- --project downloader` passes, and every test this changes still
   asserts what it asserted before.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The owner's decisions behind
  the batch: delete tests already covered elsewhere but keep rows a gate or an
  owner decision chose; allow production timing options only with unchanged
  defaults; split the big file and raise workers on CI only; one ticket per
  phase. This ticket needs none of them, since it changes test fixtures only.
