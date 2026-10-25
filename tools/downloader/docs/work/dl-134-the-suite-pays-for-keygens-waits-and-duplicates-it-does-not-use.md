---
id: dl-134
tool: downloader
title: The unit suite pays for TLS keygens, production waits and duplicate cases it does not need
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-134 — The unit suite pays for keygens, waits and duplicates it does not need

## Why

The downloader is 631 s of the 815 s summed test time on CI (run `40210503276`,
ubuntu, 4 workers; `npm test` wall 265 s). The ubuntu run is bound by total
work, so each summed second saved is worth about a quarter of a second of wall
time. The test-suite audit of 2026-10-25 found about 130 s of it that buys no
coverage:

- **Every api harness boot generates two RSA-2048 keys for a proxy the stub
  engine never uses.** `ffmpegTlsIntercept` defaults to `true` in
  `api/src/config.ts:627`, so `createTlsInterception` (`api/src/server.ts:251`)
  runs on every `createHarness` (`api/test/helpers.ts:215`) and every direct
  `createApp`. Measured: harness boot takes a median 122–145 ms with
  interception and 6–8 ms without (15 boots each). A keygen-counting preload
  counted 655 keygens, 43.7 s locally, across 27 api files.
- **Browser-tier api tests run production waits.** Their pages fetch the manifest
  at once, the case `resolvers/test/browser/helpers/stream-waits.ts`'s
  `AT_ONCE_WAITS` exists for. Measured with a scratch probe: 2.77 s → 0.76 s per
  warm probe.
- Duplicate cases and over-long fixtures (below).

## Decision — answered 2026-10-25 by the owner

- **Browser concurrency: not chosen.** The audit measured that running a browser
  file's tests concurrently with `BrowserPool({ maxConcurrent: 4 })` cuts them by
  about 3–4× (consent-scope's c rows 22.2 s → 5.5 s), because ~80 % of each test
  is the resolver's own sleeps. The owner chose only the item-level fixes. Do not
  make the browser files concurrent in this ticket.
- **Production sleeps in "expects no media" tests stay** as dl-129's decision A
  set them. Not reopened.
- **Clear duplicates may be deleted.** Steps 6–12 are those.

## Build

The seconds are CI summed test time, estimated by an agent from the per-test
times in the CI log unless marked measured.

**api / engine**

1. `api/test/helpers.ts` `createHarness`: default `ffmpegTlsIntercept: false`,
   and do the same in direct `createApp` boots in api tests. Tests about the
   interception opt back in explicitly: the boot-line tests in
   `logging.test.ts:332-436`, and the "wiring" cases in `two-origin-tls` and
   `egress-ca`. Grep for every assertion that reads the interception or its CA
   before turning it off. ~30–35 s (measured).
2. Copy `AT_ONCE_WAITS` into an api test helper, with a comment pointing at
   `resolvers/test/browser/helpers/stream-waits.ts` and its rule: only for a test
   that cannot pass unless the stream is captured. Apply it to:
   `manifest-refetch.test.ts:188,371,419,808`,
   `size-probe-behind-the-proxy.test.ts:143,166,239`,
   `chunk-sniff-guard.test.ts:103` and
   `tiers-on-the-terminating-proxy.test.ts:105`.
   - **Do not** apply it to `tiers-behind-the-proxy.test.ts:127`, which asserts
     that a page fetch never lands. That is the "not requested" case the rule
     excludes.
   - The re-fetch and size probe run in `#buildOutcome` after the quiet wait
     (`resolvers/src/resolvers/browser.ts:421-470`), so a shorter wait cannot
     hide them.
   - ~26–30 s (measured per probe).
3. `size-probe-behind-the-proxy.test.ts`: hand its resolvers one shared `pool`
   instead of a Chromium launch per test. ~1 s.
4. `engine/test/stream.test.ts:2079`: set `killGraceMs: 300`, since the kill only
   needs to outlast the chunk written at 100 ms. `:2236`: about 2000 ms, which
   must outlast `PARTIAL_VERDICT_MS` (2 s, `engine/src/stream.ts:280`) from the
   400 ms abort. ~3.7 s.
5. `api/test/parallel-ranges-behind-the-proxy.test.ts:168,207`: the origin
   trickles at 1 MB/s against roughly 4.5 MB/s of media, and 2 MB/s still counts
   as slow. Keep `:207`'s first job only. ~3–4 s.

**Duplicates (api / engine / web)**

6. Delete `api/test/stream-link.test.ts:592` (9.5 s). The api half (connection
   cut, `TIMEOUT` on the job row, no re-probe) is `stream-link.test.ts:153`. The
   real-ffmpeg half is `engine/test/stream.test.ts:603`.
7. `engine/test/parallel-ranges-limits.test.ts:419,435,457` (dl-108) run the
   same configurations as `parallel-ranges.test.ts:42,102,149` (dl-98). Fold
   each dl-108 assertion (`onProgress` sampling) into the dl-98 run, and keep
   "dl-108" in the assertion message. ~4.5 s.
8. `engine/test/parallel-ranges.test.ts:164` `moov-end` row: split-vs-single
   digest equality is already asserted at `:42`. Keep the faststart row. ~1 s.
9. `engine/test/parallel-ranges-refusals.test.ts:63`: each of the 4 rows runs a
   second "next job opens one" job. First trace whether the refusal memory
   branches on the kind of refusal. If it does not, keep the second job in one
   row only. ~3 s.
10. `api/test/human-check.test.ts:508-525`: keep one spawned `main.ts` row. The
    other three vary the missing key, which the in-process cases `:371`, `:389`
    and `:439` cover. ~2 s.
11. `web/test/app.test.tsx:63` `mountApp`: calls `vi.resetModules()` and
    re-imports `App` per case. If `App` reads `USING_MOCK_API` at render time,
    not at module evaluation, replace the reset with a `vi.mock` factory using a
    getter. If it reads it at evaluation, leave the reset and say so in the Log.
    ~3–4 s.
12. `engine/test/helpers/http.ts:67,74`: delete the unused `makeBody` and
    `parseRangeStart`.

**resolvers (browser)**

13. Delete `resolvers/test/browser/browser-resolver-press-targets.test.ts:166-191`
    (3 rows, 12.8 s). The same fixtures, `confirmAge: true` and capped click,
    with the same beacon assertions, are `provoke.test.ts:670-747`.
14. `browser-resolver-age-gate.test.ts:65-84`: drop `quietMs: 6000`, which was
    needed only before dl-80, and use `STREAM_WAITS`. Revisits depend on the
    empty floor, not on `quietMs` (`browser.ts:421-441`, `provoke.ts:1977`).
    ~5 s.
15. `consent-scope.test.ts:98-113` (r1, r1b, r2, r2b, r5b): move these "not
    pressed" rows to call `provokePlayback` directly, the `presses()` pattern
    dl-113 used. First check that `revisitOverlays`'s `dismissModal` cannot
    press a widened consent label inside a `role=dialog`. If it can, leave the
    rows as they are and say so in the Log. Do not convert the age-gate rows in
    `browser-resolver-consent-and-links.test.ts`, whose revisit pass is part of
    what they test. ~6 s.
16. `browser-resolver-capture.test.ts:192-201` (manifest-level DRM),
    `chunk-streams.test.ts:111` and `:127`: these can only pass if something is
    captured, so they can take `AT_ONCE_WAITS`. ~5 s.
17. `browser-resolver-departure-and-floor.test.ts:488-578`: merge dl-115's and
    dl-129's recorder probes into two. One uses the defaults and reads both
    `sleepCalls` and `quietWaitCalls`; one sets `minWaitMs`, `landingSettleMs`
    and `passPauseMs` together. Drop `:549`, which adds nothing to `:554`.
    ~2.6 s.
18. `browser-resolver-player-input.test.ts:160` `test.each([0,300,1500,3000])`:
    drop the 300 and 1500 rows, which share 3000's branch. **Keep 3000**, a row
    the owner chose at gate 2. ~2.5 s.
19. `browser-resolver-departure-and-floor.test.ts:282-311` (player at 6 s): add
    a `?delay=` query to `delayed-player.html`, then use 2500 ms with a 4000 ms
    floor. That exercises the same branch. ~3.5 s.
20. `browser-resolver-departure-and-floor.test.ts:313-345`: try `timeoutMs: 5000`,
    the resolver's own minimum. Keep it only if the case ends in `TIMEOUT`, not
    another code, on 10 local runs in a row. ~2 s.
21. `resolvers/test/browser/helpers/fixture-server.ts:307`: call
    `closeAllConnections()` before `close()`, as `chunk-server.ts:234` does.
    It saves nothing today (measured), but it is a free safeguard.

## Done when

1. `npm test -- --project downloader` passes, and the CI run of this pull request
   shows downloader's summed file time at least 90 s below run `40210503276`'s
   631 s. The Log states the measured difference.
2. A test about ffmpeg's TLS interception still boots with it on and still fails
   if the interception is not wired. Name the test in the Log.
3. Each deleted or merged case is named in the Log, with the case that still
   covers its assertion.
4. Steps 9, 11, 15 and 20 each carry their check's result in the Log, applied or
   not.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](../../../../docs/work/repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Checked and not a finding: the Fastify keep-alive close trap that cost ledger
  4 s does not happen here. A close-timer preload over 186 tests saw no close
  over 300 ms, and Fastify 5's `forceCloseConnections: "idle"` explains why.
  `api/test/stream-link.test.ts:531,549` overlap partly with engine tests, but
  were left alone (medium coverage risk, low confidence).
