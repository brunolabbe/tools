---
id: dl-92
tool: downloader
title: A master playlist with no file extension never earns the master-name bonus, so a variant named index.m3u8 outranks it
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-92 — An extensionless master never earns `MASTER_NAME`'s bonus

## Why

`MASTER_NAME` in `resolvers/src/browser/rank.ts` is
`/(?:master|main|index|manifest|playlist|stream|video)[^/]*\.(?:m3u8?|mpd)$/i`.
It needs a file extension, so a master served from `/api/playlist?id=1` or
`/hls?token=...` (typed `application/vnd.apple.mpegurl`, or sniffed since dl-79)
can never earn its +120. A variant whose name happens to match, such as
`/v/high/index.m3u8`, then outranks it even though it was requested after it.

**Measured, 2026-10-06** (dl-79's gate 1 reported `n=1`; re-run against the
built `rank.js`, both hits `hls`, confirmed, status 200, same origin as the page):

```
https://site.example/api/playlist?id=1  seq=0 score=1150
https://site.example/v/high/index.m3u8  seq=1 score=1260
winner=https://site.example/v/high/index.m3u8
https://site.example/api/master.m3u8    seq=0 score=1270   (the same master, with an extension)
```

The winner is a single rendition where the master would have offered every one
(`n=1` against `n=2` in the gate's run). Pre-existing, and independent of
dl-79: it applies to any typed extensionless master.

## Build

1. **Reproduce first**, through the real `BrowserResolver`: a page that fetches
   an extensionless master (served `application/vnd.apple.mpegurl`, two
   `#EXT-X-STREAM-INF`s), then a variant named `index.m3u8`. Expect the master's
   variants, observe one. A unit test over `rankHits` alone is not enough: the
   outcome the user sees is `variants.length`.
2. Decide what identifies a master when the name cannot: the strongest signal is
   the body (`#EXT-X-STREAM-INF` for HLS, which `#loadManifest` already has by
   the time the choice is made), but `rankHits` runs before any body is read. The
   alternatives are to let the extension-less path earn the name bonus on its
   own words (`/playlist`, `/master`, `/manifest`), or to prefer the earlier
   request among hls hits of equal kind, which is what the `seq` term already
   tries to say. Pick one and say why in the Log; do not widen
   `VARIANT_NAME`'s penalty to compensate.
3. Keep every existing `rankHits` expectation in
   `test/browser/capture-rules.test.ts`.

## Done when

- The step-1 fixture yields the master's variants.
- A test proves an extensionless master outranks a later variant named
  `index.m3u8`, and that a typed variant named `master.m3u8` listed first still
  wins as before.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

**2026-10-07, builder.**

- **Step 1, reproduced through the real `BrowserResolver` before any change to
  `rank.ts`.** New fixture `test/fixtures/pages/extensionless-master.html` fetches
  `/api/playlist?id=4` (served `application/vnd.apple.mpegurl`, two
  `#EXT-X-STREAM-INF`s; `UNTYPED_ENDPOINTS` in `fixture-server.ts` gained the
  route) and then `/media/extless/v/high/index.m3u8`. On the unchanged ranking,
  `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "dl-92"`:
  `1 failed | 138 skipped (139)`, `Expected: ".../api/playlist?id=4"`,
  `Received: ".../media/extless/v/high/index.m3u8"`.
- **Step 2, approach chosen: let an extensionless route earn the name bonus on its
  own words** (`ROUTE_MASTER_NAME`, the same word list as `MASTER_NAME`, read off
  the last path segment, which must carry no `.`). Over the other two:
  - _Body_ (`#EXT-X-STREAM-INF`) needs every candidate's body before ranking, or a
    second fetch per runner-up against a CDN that may rate-limit, and typed
    manifests are not read at capture time. Larger than the defect.
  - _Earliest hls wins_ changes the answer for inputs that are not this defect: a
    page that fetches an unrelated manifest first (ad slate, preview) and then
    `master.m3u8` picks the first today by name, and would pick the first under it.
    The brief does not settle which is right (open decision, reported to the
    orchestrator).
  - Words alone change the score only for an hls/dash hit whose last segment has
    no extension and carries one of the seven words, so no existing expectation
    moves. Measured, `scoreHit` on `[route seq=0, /v/high/index.m3u8 seq=1]`:
    `/api/playlist?id=1` `[1270, 1260]` winner the route (was `[1150, 1260]`).
- **What this does not cover, measured:** `/hls?token=abc` `[1150, 1260]` and
  `/api/ad-slate.m3u8` `[1150, 1260]` both still lose to the later
  `index.m3u8`. The first is the `/hls?token=...` shape the Why names; the second
  shows the cause is the 120 name bonus against the 10-per-step `seq` term, not the
  missing extension, so any master whose name carries none of the seven words loses
  the same way. Only a rule that lets arrival order outweigh the name closes those.
- Tests, at the end of each suite: `capture-rules.test.ts`
  `rankHits with a master that has no file extension (dl-92)`, five failing with
  the clause removed (`5 failed | 2 passed`), all passing with it; and
  `browser-resolver.test.ts` `a master served from a route with no extension (dl-92)`.
- Fold-in: none. The only adjacent piece, a rule for wordless masters, is the open
  decision above, not an already-specified one.
- **Round 1's approach was replaced in round 2 (below); `ROUTE_MASTER_NAME` no
  longer exists.**

**2026-10-07, builder, round 2 (after gate 1, CONCERNS at `d864e947`).**

- **Decision, recorded.** Question put to the owner on 2026-10-07: the route bonus
  picks non-master routes that now beat a wordless master (13 of 34 shapes right to
  wrong in the gate's harness), and `/hls?token=` is still lost. Options: (1) let
  arrival order outweigh the name among same-kind manifests (the gate's
  recommendation); (2) narrow the regex to a segment-start `master`/`manifest`/
  `playlist`; (3) accept, record, and file `/hls?token=` as a follow-up (the
  builder's recommendation); (4) drop dl-92. **Answer, owner, 2026-10-07: (1).** It
  overrode the builder's recommendation, and it lifts Build step 3's ban on moving
  `rankHits` expectations for the ones this rule changes.
- **Rule built.** In `rankHits`, among manifests whose response was not an error
  (hls/dash, status not 400 or above), the order is: answered before unanswered,
  then arrival (`seq`) ascending, then score, then input position. Answered
  manifests rank above everything else; progressive files and refused manifests
  order by score as before. `scoreHit` no longer scores `seq`. The comparison is one
  lexicographic key, so it stays transitive; an earlier version that mixed a
  `seq` comparison with a score comparison across classes could cycle.
- **`ROUTE_MASTER_NAME` removed, and why.** Under arrival-first the name only breaks
  a tie, and `seq` is unique per recorded hit (`HitCollector` allocates it from one
  counter, a sniffed hit keeps its reserved one), so the clause could not change an
  answer in production. Its only effect would have been the false positives gate 1
  measured (`/p/abc/mainstream`, `/api/domain`, a `/vast/video?id=1` ad). That also
  closes gate 1's low about trailing slashes and percent-encoded letters: nothing
  reads a route's name any more, so there is no edge to judge.
  `MASTER_NAME` and `VARIANT_NAME` stay, as the tiebreak, because the unit fixtures
  and any future caller that records equal `seq` values still rely on them.
- **Existing expectations that moved: none.** Every `rankHits` expectation on
  `origin/main` (`capture-rules.test.ts` "prefers the master playlist over the
  variant it names", "prefers an adaptive manifest over a progressive file", the
  numbered-name block, the dl-79 `sniff.test.ts` arrival-order test) lists the
  expected winner first, so arrival order and the old name rule agree. Measured:
  `npx vitest run tools/downloader/resolvers`, `20 passed (20)` files, `885 passed
(885)`, none edited. What moved is the branch's own round-1 test "a word in a
  directory, or before another extension, earns nothing" (old winner and new winner
  differ: `/v/high/index.m3u8` before, `/video/a/high.m3u8`, the earlier request,
  now), which was removed with the clause it tested.
- **Answers that moved, measured with gate 1's harness on 34 capture shapes**
  (`rank-base.ts` against this head, `npx tsx compare.ts`):
  `cases=34 changed=18 head-wrong=1`. 17 changed from wrong to right, including
  `/hls?token=abc`, `/api/hls/abc?token=1` and a dash `/dash?token=1`. The shapes
  `/abc.m3u8` followed by `/api/video?id=1&r=720`, an ad `/vast/video?id=1`,
  `/p/abc/mainstream` and `/api/domain` are not among the changes: base already
  ranked them right, and they are round-1 regressions (the route-name regex) that
  this round removed, not base defects. One changed from right to wrong, the
  recorded cost: an ad
  `/ads/stream?x=1` requested before master `/abc.m3u8` (base winner `/abc.m3u8`,
  head winner the ad).
- **The cost is pinned**, not accidental: `capture-rules.test.ts` "an ad manifest
  requested before master.m3u8 is offered first; the master is next". The master is
  the second candidate, which `#buildOutcome` falls back to when the first does not
  parse, within `MAX_MANIFEST_ATTEMPTS`; an ad playlist that parses is still taken.
- **Tests**, at the end of `capture-rules.test.ts`, "rankHits among manifests:
  arrival order wins, the name breaks a tie (dl-92)": routes and a wordless file
  first, the false-positive routes later, typed `master.m3u8` first, the ad, the
  tie, a refused earlier manifest, an unanswered earlier request, a manifest above
  a progressive file. Against the base `rank.ts`, `-t "dl-92"` gives `6 failed | 10
passed`; against this head, all pass. The browser-resolver test is unchanged and
  passes.
- Gate low, fixture: `extless/v/low/index.m3u8` added, so the master's second
  variant resolves.
