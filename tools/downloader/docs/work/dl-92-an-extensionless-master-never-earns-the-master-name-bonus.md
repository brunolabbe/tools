---
id: dl-92
tool: downloader
title: A master playlist with no file extension never earns the master-name bonus, so a variant named index.m3u8 outranks it
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-07 · `1aece87d..d864e947` · Opus 5.5, depth standard

| Done when                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The step-1 fixture yields the master's variants                                                                                  | `resolvers/test/browser/browser-resolver.test.ts` › "outranks the variant it names, even when that variant is called index.m3u8" ✓ — real `BrowserResolver` over `extensionless-master.html`; asserts the chosen URL is `/api/playlist?id=4`, the parsed body has `#EXT-X-STREAM-INF`, and `variants` has length 2. Red with the new clause removed (received `/media/extless/v/high/index.m3u8`) |
| A test proves an extensionless master outranks a later `index.m3u8`, and a typed `master.m3u8` listed first still wins as before | `resolvers/test/browser/capture-rules.test.ts` › "%s outranks a later variant named index.m3u8" (four routes) ✓ and › "a typed master.m3u8 listed first still wins over a later extensionless route" ✓. The first four go red with the clause removed; the second passes at base and head, which is the "as before" — see the `/hls?token=` finding for what this line does not cover             |
| `npm run check` and `npm test -- --project downloader` pass                                                                      | **verified** — check exit 0; downloader project exit 0, 2071 passed, 2 skipped of 2073, 100 of 101 files. The test diff only adds tests. PR #388's CI is green on `d864e947` too, every leg included                                                                                                                                                                                              |

- **med** · no `Done when` line depends on it · **The route bonus picks routes that are not masters, and they now beat a correctly ranked master that has no word in its name.** `ROUTE_MASTER_NAME` in `resolvers/src/browser/rank.ts` gives +120 to any hls/dash hit whose last path segment contains one of the seven words as a substring and has no `.` after it. A master whose name carries no word (`/abc.m3u8`, `/hls?token=…`) gets no bonus, so a later variant, an ad manifest or an unrelated route that matches now beats it by 110. At the base those inputs were ranked correctly by `seq`. Reproduction: write the base `rank.ts` to `rank-base.ts`, then run `tsx compare.ts` (both in this gate's scratch dir), which scores 34 capture shapes at base and head, all `confirmed`, status 200. Output: `cases=34 changed=21 head-wrong=22`. 8 change from wrong to right and 13 from right to wrong, for example `[1150->1150 1140->1260] /abc.m3u8 then variant route /api/video?id=1&r=720` → head picks the variant; `/hls?token=abc` then `/r/720/index` → head picks the variant; `/abc.m3u8` then ad `https://ads.adnet.example/vast/video?id=1` → head picks the ad; an ad `/ads/stream?x=1` requested before `/abc.m3u8` → head picks the ad; substring hits `/p/abc/videos`, `/p/abc/mainstream`, `/p/abc/playlists`, `/api/remainder`, `/api/domain` all pick the non-master. No test on the branch pins an extensionless route that carries a word but is _not_ a master. "a word in a directory, or before another extension, earns nothing" covers only a word in a directory and a word before another extension. How often these shapes occur on real sites is **unmeasured**: the repo has no real capture corpus, and these shapes are synthetic. The mechanism is the same one `MASTER_NAME` already has for `.m3u8` file names; this branch extends it to routes, which are named far more freely. Remedies are an open decision (below).
- **med** · no `Done when` line depends on it under its literal reading · **The `/hls?token=...` master named in the Why is still lost.** `compare.ts` output: `same HEAD-WRONG [1150->1150 1260->1260] brief Why: /hls?token then index.m3u8`, and the same for `/api/hls/abc?token=1` and a dash `/dash?token=1`. The Log says so itself. Done when 2 says "an extensionless master" and is met by the four word-carrying routes. Build step 2 offers "its own words (`/playlist`, `/master`, `/manifest`)" as an allowed pick, and that option cannot reach `/hls`, so the brief allows a build that leaves the case out. If Done when 2 means _every_ extensionless master, it is unmet. Open decision (below).
- **low** · edges of `ROUTE_MASTER_NAME`, no known live call site: a trailing slash (`/api/playlist/`) and a percent-encoded letter (`/api/play%6Cist`, `/api/%70laylist`) earn nothing. A word in the query (`/api/get?type=playlist`) earns nothing, by design, because only `pathname` is read. `/api/playlist%2Em3u8` earns the bonus because `%2E` is not `.`, which is harmless. A fragment is ignored correctly.
- **low** · `nfr:maintainability` — `extless/master.m3u8` names `/media/extless/v/low/index.m3u8`, and that file is not in the fixtures. Nothing fetches it today: the e2e uses `recordingHlsParser`, which counts `#EXT-X-STREAM-INF` and fetches nothing. A later test that uses a real parser would get a 404.
- **dropped** · `/api/playlist.json` served as typed hls still loses to a later `index.m3u8`. The branch's own test asserts this exclusion on purpose, and it matches base behaviour. This is a product choice, not a defect.
- **dropped** · the Log's claims (five capture-rules tests red with the clause removed, two passing; `/hls?token=abc` and `/api/ad-slate.m3u8` at `[1150, 1260]`; "no existing expectation moves") all reproduced. The Log does not name the regression class in the first finding, but it states nothing false.
- **findings** · the hunt returned 6; 4 carried, 2 dropped.
- Positive control: with `|| ROUTE_MASTER_NAME.test(path)` removed from `scoreHit`, `-t "dl-92"` gave `6 failed | 2 passed`. The 6 were the four routes, the dash case and the BrowserResolver e2e. The 2 that passed were the two "as before" guards, as expected. The file was restored and the tree is clean.
- Invariants: tool isolation, `AppError`, contract and style are untouched (the diff adds one regex and one `||`). No shell, URL logging, SSRF or progress code is in the diff. Test registration: both specs already exist. The Dockerfile is not touched.
- NFR: security n/a · performance n/a (one extra regex test per manifest hit) · reliability — the first finding · maintainability — the low findings above.

**Open decision (remedy for both meds):**

1. **Recommended: let arrival order outweigh the name among same-kind manifests.** Either the earliest confirmed hls/dash hit gets a bonus of at least 120, or the master bonus becomes a tiebreak under `seq`. This fixes `/hls?token=`, `/abc.m3u8` and the route false positives in one rule, and it is the brief's third alternative. Cost: a page that fetches an ad or preview manifest before the real `master.m3u8` changes its answer (the Log's objection), so it needs its own tests, and some existing `rankHits` expectations may move, which Build step 3 forbids without a decision.
2. **Narrow `ROUTE_MASTER_NAME`.** Anchor it to the start of the segment and drop the generic words (`stream`, `video`, `main`, `index`), so only `^(?:master|manifest|playlist)\b` earns the bonus on a route. Add a test that `/api/video?id=1&r=720` after `/abc.m3u8` still loses. Cost: small, but the branch's `/stream` route test has to go. It cuts down the false positives but leaves `/hls?token=` lost. File that as its own ticket.
3. **Accept as is**, record the regression class in the ticket, and file `/hls?token=` as a follow-up. Cost: nothing now. The first finding stays live behind a condition whose frequency nobody has measured.

### Gate 2

**Gate: PASS** — 2026-10-07 · `d864e947..6f00fa15` · Opus 5.5, depth standard (re-gate of the round's diff only)

| Done when                                                                                                                        | Proof                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The step-1 fixture yields the master's variants                                                                                  | `resolvers/test/browser/browser-resolver.test.ts` › "outranks the variant it names, even when that variant is called index.m3u8" ✓. Unchanged this round, passes at head, and goes red with base `rank.ts` under the head tests. `extless/v/low/index.m3u8` now exists                        |
| A test proves an extensionless master outranks a later `index.m3u8`, and a typed `master.m3u8` listed first still wins as before | `resolvers/test/browser/capture-rules.test.ts` › "%s, requested first, beats a later variant named index.m3u8" ✓ (four shapes, `/hls?token=abc` among them; all four red at base) and › "a typed master.m3u8 listed first still wins over a later extensionless route" ✓                      |
| `npm run check` and `npm test -- --project downloader` pass                                                                      | **verified** — rebuilt first (`dist/browser/rank.js` has `isAnsweredManifest` and no `ROUTE_MASTER_NAME`). Check exit 0. Downloader project exit 0, 2080 passed and 2 skipped of 2082, 100 of 101 files (gate 1: 2071; +9 is the dl-92 block's net growth). PR #388 CI is green on `6f00fa15` |

Gate 1's findings:

- **med, route bonus false positives — fixed.** `ROUTE_MASTER_NAME` is gone. Gate 1's `compare.ts` at this head prints `cases=34 changed=18 head-wrong=1`. All 13 shapes that went from right to wrong at `d864e947` are `same head-correct` against base. › "a later route that carries a master word (%s) does not outrank an earlier master" pins five of them. All five fail with the round-1 `rank.ts` under the head tests (`10 failed | 6 passed` for the dl-92 block).
- **med, `/hls?token=` still lost — fixed.** `compare.ts`: `CHANGED head-correct … brief Why: /hls?token then index.m3u8`, and the same for `/api/hls/abc?token=1` and dash `/dash?token=1`. The head tests named in Done when 2 fail at base for these.
- **low, route-name edges (trailing slash, percent-encoding, query word) — moot.** Nothing reads a route's name any more. All five such shapes in `compare.ts` are `head-correct`.
- **low, missing `extless/v/low/index.m3u8` — fixed.** The file is added, byte-identical to `high/index.m3u8` (`cmp` exit 0).
- **open decision — closed by the owner (option 1)**, recorded in the Log. The one right-to-wrong shape left is the accepted cost: an ad `/ads/stream?x=1` requested before `/abc.m3u8`. › "an ad manifest requested before master.m3u8 is offered first; the master is next" pins it.

Checks the dispatch asked for:

- **The comparator is transitive and stable.** The key is a partition (answered manifest or not) followed by a lexicographic tuple within each side, so it is a total preorder. Measured: `tsx fuzz.ts` (gate-2 scratch) ranks 6000 random sets of 2 to 8 hits. They mix hls, dash, progressive and segment, statuses undefined/200/206/403/404/500, confirmed true/false, two origins, and sizes from 1 kB to 1 GB. Half the sets have unique seq and half allow equal seq. Every pair in each full sort was checked against both two-element orderings, and every set against a shuffled copy: `pairwiseViolations=0 antisymViolations=0 permutationViolations=0`. Positive control: a rock-paper-scissors comparator through the same check (`control-cmp.ts`) gives `control violations=333`.
- **Equal seq cannot occur in production.** `HitCollector` gives out `seq` from one counter per probe (`new HitCollector()` once in `resolvers/src/resolvers/browser.ts`). The sniff path reserves a number from the same counter. So the name tiebreak only matters in unit fixtures, whose `hit()` helper defaults `seq: 0`. The Log says the same.
- **No caller relied on `seq` in the score.** `scoreHit` has one caller, `rankHits`. Nothing under `tools/downloader` imports it, tests included. `#buildOutcome` uses the ranking only through the order of `manifests` and of `files`, which it filters separately.
- **No existing expectation moved.** I put the base (`1aece87d`) `capture-rules.test.ts`, `browser-resolver.test.ts` and `sniff.test.ts` over the head source: `329 passed (329)`. Positive control: with the `seq` comparison reversed in `rankHits` under the same base tests, 66 tests failed. All files were restored afterwards and the tree is clean.

New in the round's lines:

- **low** · no known live call site · **Answered-before-unanswered is now absolute, where the base made it a +30 term.** `tsx unconfirmed.ts` (gate-2 scratch): an unconfirmed `master.m3u8` at seq 0 next to a confirmed `/v/720p.m3u8` at seq 1 gives base the master and head the variant. The same happens with `chunklist_1.m3u8` at seq 5. This bites only when the master's response event is missed while its variants' responses are caught. I found no path that produces that, and it is unmeasured. › "an earlier request that never got a response does not outrank one that did" pins the rule on purpose. The owner's decision covered arrival order against the name, not this key, so this is the builder's call and the Log states it.
- **low** · the Log's round-2 "answers that moved" bullet is wrong about its examples. "17 changed from wrong to right" is the right count, but it then names `/abc.m3u8` followed by `/api/video?id=1&r=720`, an ad `/vast/video?id=1`, `/p/abc/mainstream` and `/api/domain`. `compare.ts` prints all four as `same head-correct`: base ranked them right. They were round-1 regressions that are now gone, not base defects this fix closes. A reader would infer the base mis-ranked them.
- **dropped** · the name tiebreak is unreachable in production (above). This is stated in the Log and the code comment, and `MASTER_NAME` still decides ties in unit fixtures. Not a defect.
- **findings** · the hunt returned 3; 2 carried, 1 dropped. Nothing is a `high`.
- Invariants: no imports, errors, shell, logging, SSRF, progress or contract code in the diff. Style is clean (check exit 0). Tests are in existing registered specs.
- NFR: security n/a · performance n/a (comparator is O(1) per comparison) · reliability — the unconfirmed low above · maintainability ✓.

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
