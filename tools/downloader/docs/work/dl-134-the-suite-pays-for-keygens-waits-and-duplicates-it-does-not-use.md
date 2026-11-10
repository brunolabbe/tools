---
id: dl-134
tool: downloader
title: The unit suite pays for TLS keygens, production waits and duplicate cases it does not need
kind: chore
status: in-flight
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

## Review

**Gate: CONCERNS** — 2026-11-10 · `e44644ad..60306eb9` (stacked on `downloader/dl-130-proxy-flake`) · Opus 5.5, depth full

| Done when                                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `npm test -- --project downloader` passes, and this PR's CI shows downloader's summed file time ≥ 90 s below run `40210503276`'s 631 s; the Log states the difference | **verified** — local run 126 passed, 1 skipped (127 files); 2596 passed, 2 skipped (2598 tests); exit 0. Re-derived with the gate's own parser from `gh run view --log`: 630.8 s at run `40210503276` against 466.6 s at `91278e41` (run `42734531994`) and 467.2 s at `60306eb9` (run `42735823958`). Both sides count the same 126 timed files plus one untimed skipped file, and no file appears on only one side. `91278e41..60306eb9` changes only the ticket |
| 2. An ffmpeg TLS-interception test still boots with it on, still fails if it is not wired, and is named in the Log                                                       | `api/test/logging.test.ts` › "the proxy that ffmpeg gets is the terminating one, and the tiers' is not" ✓. Opts in with `ffmpegTlsIntercept: true`. Went red with ffmpeg pointed at the tiers' proxy (`expected 'http://127.0.0.1:41557' not to be …`) and red with the interception never created                                                                                                                                                                 |
| 3. Each deleted or merged case is named in the Log, with the case that still covers its assertion                                                                        | **unproven (open decision)** — Build steps 6 and 10 delete cases and name survivors that do not cover one clause each (F1). Steps 5, 7, 8, 13, 15, 17 and 18 and `runSampling` hold: their named survivors went red under the planted regressions or cover the case by reading                                                                                                                                                                                     |
| 4. Steps 9, 11, 15 and 20 each carry their check's result in the Log                                                                                                     | Steps 9, 15 and 20 **verified**. Step 9's trace is true: `stream.ts`'s `onRefused` ignores the kind. Step 15's trace is true: `dismissModal` presses only `CLOSE_TEXT` or Escape. Step 15's rows went red under a widened consent press. Step 20's case asserts `TIMEOUT` with `expectCode` and passed 10 of 10 runs. Step 11 is **unproven (scope)**: the owner held it until dl-133 (#781) lands (2026-11-10, ticket Log), and it is built in a later round      |

- **med** · Done when 3 depends on it · `unproven (open decision)` · Two deletions the brief approved leave one clause with no test, against Build steps 6 and 10.
  - **Step 6.** The deleted `api/test/stream-link.test.ts` › "an error after the first byte aborts the connection with the code on the job" was the only api test that set `stageTimeoutMs`. That makes it the only test of `createApp` handing `config.stageTimeoutMs` (`JOB_TIMEOUT_MS`) to `createEngine` in `api/src/server.ts`. With that line removed, the deleted case goes red (`received.aborted`: `expected false to be true`). The named api survivor stays green, and so does every case in `stream-link.test.ts` (16 of 16). The engine survivor sets `stageTimeoutMs` itself.
  - **Step 10.** The dropped spawned row with `TURNSTILE_SITE_KEY` set was the only check that the boot output omits the site key when the key is set. The kept row's `not.toContain(PASS_SITE_KEY)` passes trivially, because its env holds no site key. The in-process refusal test hands over only the secret.
  - The site key is public, so the second gap is about a value that is safe to leak. **Options:** (a) restore each clause cheaply: an api wiring check that ends before the first byte, and a site-key-absent assertion on the in-process `siteKeyOnly` error. (b) Record both as accepted losses in the Log, as step 13's `NO_MEDIA_FOUND` already is. **Recommended: (a).** It is the owner's call because the brief named these survivors.
- **low** · `nfr:maintainability` · The Log and the commit subject say "164 s under the base", but the base there is run `40210503276` (2026-10-25). Against this branch's own base, `e44644ad` (#777's run `42731587914`, 577.2 s), the branch saves 110.7 s. The other 53.6 s is `main`'s drift. The figure overstates what the branch saves. Nothing is chosen on it, and 110.7 s still clears the 90 s bar.
- **low** · `nfr:maintainability` · No test or production code sets `BrowserResolver`'s `clickTimeoutMs` option any more. `confirming(clickTimeoutMs?)` in `browser-resolver-press-targets.test.ts` is never given one. The step-13 deletion left the option's wiring to `provokePlayback` untested. The cap itself is still tested in `provoke.test.ts`. No live call site.
- **low** · The comment on the faststart-only row in `engine/test/parallel-ranges.test.ts` says the first test has "the same configuration". It does not: 500 KB/s and the variant's own duration there, against 2 MB/s, `durationSec: 0.5` and a `digests.length > 100` companion in the dropped row. The comment is wrong about a detail that nothing relies on.
- **low** · `nfr:reliability` · unmeasured · The builder's `The database connection is not open` from `JobStore.recordProgress` did not reproduce: 0 of 10 runs of "a stream that passes MAX_FILE_SIZE_MB…". On that path the diff changes only `realApp`'s `ffmpegTlsIntercept: false`. That routes ffmpeg through the tunnel and drops two awaited closes between `queue.close()` and `db.close()` in `shutdown`. `killGraceMs` (step 4) is in engine stand-ins only. Whether this predates the branch is unmeasured.
- **dropped** · Tests that pass trivially after the default flip: none. With the interception forced off in `server.ts`, the api package failed the same 6 tests under the head's defaults as under the base's (6 of 850 each).
- **dropped** · Step 2's two "not handed the proxy's root" cases assert that nothing was fetched while running with `AT_ONCE_WAITS`. Both still need the capture, and the fetches they forbid run after the quiet wait. With chain verification disabled in `manifest-fetch.ts`, both went red: `expected 1 to be +0` and `expected 2 to be +0`.
- **dropped** · The second job deleted from step 5 is covered by composition. The first proxy case asserts `onRefused` with `FIXTURE_HOST`, and the "a 429" row asserts the engine remembers whatever host it is given.
- **dropped** · Step 18's 300 ms and 1500 ms rows: the brief and the owner's gate-2 choice. Not a defect.
- **findings** · the hunt returned 9: 5 carried, 4 dropped.
- NFR: security ✓ (the secret clause of step 10 is still non-trivial) · performance ✓ (110.7 s against the stack base) · reliability — above; the step 19 and step 20 timing cases passed 10 of 10 · maintainability — above.
- Steps not done, reasons checked: step 3 (`resolvers/src/index.ts` exports only `BrowserPoolStats`, and the package's `exports` allow no deep import) and `manifest-refetch.test.ts`'s registry case (`buildRegistry` passes no wait option).
- CI at `60306eb9`: every check green, the Windows leg and `e2e`/`docker` included.

## Log

- 2026-10-25: Filed from the test-suite audit; see
  [repo-127](../../../../docs/work/repo-127-pull-requests-run-every-project-whatever-they-touch.md).
  Checked and not a finding: the Fastify keep-alive close trap that cost ledger
  4 s does not happen here. A close-timer preload over 186 tests saw no close
  over 300 ms, and Fastify 5's `forceCloseConnections: "idle"` explains why.
  `api/test/stream-link.test.ts:531,549` overlap partly with engine tests, but
  were left alone (medium coverage risk, low confidence).
- 2026-11-10: Two owner answers, relayed by the orchestrator, recorded before
  the build. This branch is stacked on `downloader/dl-130-proxy-flake`
  (`e44644ad`), since dl-130 also edits
  `api/test/tiers-on-the-terminating-proxy.test.ts`.
  1. **Step 11 is held until dl-133 lands.** The question: step 11 edits
     `web/test/app.test.tsx`, which dl-133 (PR #781, in review) rewrites
     heavily; start dl-134 now? Options: yes, with step 11 held until dl-133
     lands / no, keep the trio. The owner chose **yes, step 11 held**. Step 11
     is **held, not "not applied"**: it is built in a later round on top of
     dl-133, so Done when 4's step-11 part is expected `unproven` on this
     branch (scope), and this ticket does not move to `done` here. Steps 9, 15
     and 20 stay in this build.
  2. **Step 2 skips `tiers-on-the-terminating-proxy.test.ts`.** The question:
     step 2 applies `AT_ONCE_WAITS` at that file's line 105 (inside
     `registryFor`, shared by all five tests there), which includes the flaky
     dl-37 Done-when 2 test, and dl-130 is parked with an `awaiting:` line for
     a real failure of it under today's timing; should step 2 touch it?
     Options: exclude that file / apply it there too / apply, and note it on
     dl-130. The owner chose **exclude that file**. Step 2's list above is
     therefore read without its last site; a shorter wait would change the
     timing dl-130 is measuring.
- 2026-11-10: Built on `downloader/dl-134-cheaper-unit-suite`, stacked on
  `downloader/dl-130-proxy-flake` (`e44644ad`), a draft against that branch.
  Steps 1-10 and 12-21 applied except as noted. **Step 11 is held** (owner
  answer above). Where the brief's line numbers had moved, the site was found
  by its content; each is named below.
  - **Step 1.** `createHarness` now defaults `ffmpegTlsIntercept: false`, and
    the direct `createApp` boots that never read the interception say so:
    `frame-grab-egress.test.ts` (the second `createApp`, the real-grab half),
    `parallel-ranges-behind-the-proxy.test.ts` (the wiring case),
    `stream-link.test.ts` (the restart, `realApp` and fresh-volume boots). Left
    on, because they are about the interception: `frame-grab-egress.test.ts`'s
    first boot and `range-ignoring-origin.test.ts` (both write `true` out),
    `egress-ca.test.ts` and `two-origin-tls.test.ts` (their `wiredApp` calls
    `createApp` with no key, so the production default), `queue-and-shutdown`'s
    `loadApiConfig` cases. Turning it off first failed four cases in
    `logging.test.ts` (`expected 'tunnel' to be 'terminate'`, `expected [] to
    have a length of 1`): three boots and `bootWithCa` now pass
    `ffmpegTlsIntercept: true` (its default, overridable by the case that
    passes `false`). The grep for assertions that read the interception or its
    CA (`ffmpegProxyUrl`, `ffmpegProxyTls`, `rootCaPath`, `tlsCaFile`,
    `egressProxyUrl`, `terminate`) found no other harness user that does:
    `tiers-behind-the-proxy.test.ts` reads `egressProxyUrl` on a harness with
    the browser tier off, and passed unchanged.
  - **Done when 2.** `logging.test.ts` "the proxy that ffmpeg gets is the
    terminating one, and the tiers' is not" boots with the interception on
    (explicitly) and asserts `ffmpegProxyTls` is `terminate` and the two proxy
    URLs differ. It failed (`expected 'tunnel' to be 'terminate'`) while the
    default was off and the case had not opted in, which is the fails-if-unwired
    reading; "a verifying deployment is told the proxy is what verifies" and the
    `bootWithCa` cases failed the same way. `egress-ca.test.ts` and
    `two-origin-tls.test.ts` keep the production default.
  - **Step 2.** `api/test/helpers/at-once-waits.ts` (a copy, with the rule and
    a pointer to `resolvers/test/browser/helpers/stream-waits.ts`) applied at
    `manifest-refetch.test.ts` (the three `new BrowserResolver` sites,
    `quietMs: 1200` before), `size-probe-behind-the-proxy.test.ts` (three) and
    `chunk-sniff-guard.test.ts` (one). **Not applied, on the owner's answer of
    2026-11-10: `tiers-on-the-terminating-proxy.test.ts`**, whose `registryFor`
    is shared by all five tests including dl-37's flaky Done-when 2 case, which
    dl-130 is measuring under today's timing. `tiers-behind-the-proxy.test.ts`
    untouched, as the brief says. **The brief's `manifest-refetch.test.ts:808`
    has no wait to shorten**: it is `buildRegistry` built from `loadApiConfig`,
    and `buildRegistry` passes the resolver no `quietMs` or `minWaitMs`; reaching
    it would need an api config knob, which is a source change this ticket does
    not name. Left as it is.
  - **Step 3 not done.** `BrowserPool` is not exported from
    `@downloader/resolvers` (`resolvers/src/index.ts` exports only
    `BrowserPoolStats`), so the api test cannot build the shared pool the brief
    asks for. Exporting it is a production-surface change for about 1 s; not
    taken, and not folded in for that reason.
  - **Step 4.** `engine/test/stream.test.ts`: the "early end ... first chunk is
    on its way" stand-in takes `killGraceMs: 300`; "a cancel whose kill outlasts
    the hold" takes `killGraceMs: 2000` (abort at 400 ms, hold ends at 2050 ms,
    kill ends at 2400 ms). Both tables gained an optional field.
  - **Step 5.** `parallel-ranges-behind-the-proxy.test.ts`: the origin trickles
    at 2 MB/s, and the whole-job case runs its first job only. The "host is
    remembered, the next job never fans out" assertion it dropped is
    `parallel-ranges-refusals.test.ts` "a 429: ... and the next job opens one".
  - **Step 6.** Deleted `stream-link.test.ts` "an error after the first byte
    aborts the connection with the code on the job" (real ffmpeg, 9.5 s), with
    the `lateSegmentDelayMs` fixture and `stageTimeoutMs` option only it used.
    Still covers it: `stream-link.test.ts` "an error after the first byte cuts
    the connection, and the job row carries the code" (api half) and
    `engine/test/stream.test.ts` "an error after the first byte cuts the
    connection and rejects `done` with its code" (real-ffmpeg half).
  - **Step 7.** dl-108's three `runSampling` cases are gone from
    `parallel-ranges-limits.test.ts`, and `runSampling` with them; `run` in
    `helpers/parallel-ranges-fixture.ts` takes an optional `samples` array. Each
    assertion rides on the dl-98 run of the same configuration, its message
    starting `dl-108`: the split-reports-2-to-4 check on "a job that measures
    slow switches to 4 connections and finishes at least 3x faster"; the
    never-more-than-one-and-never-null check on "a fast origin stays on exactly
    one connection, counted at the fixture"; the null-throughout check on "an
    opted-out host stays on one connection, a subdomain of it too" (that row's
    throttle and duration differ from dl-108's, which the null count does not
    read).
  - **Step 8.** `parallel-ranges.test.ts` "the output of a split %s is identical
    in media": the `moov-end.mp4` row dropped; covered by the first test of the
    file, which compares split to single digests on `moov-end.mp4`.
  - **Step 9, checked.** The refusal memory does **not** branch on the kind:
    `stream.ts` passes `onRefused: (host) => deps.refusedHosts?.add(...)` and
    ignores the kind argument, and `parallel-ranges.ts` calls `onRefused` for
    every `failure.refusal !== null`. So the second job ("the next job opens
    one") runs in the "a 429" row only; the other three rows end after the first
    job. Applied.
  - **Step 10.** `human-check.test.ts`: one spawned `main.ts` row kept, the one
    with `TURNSTILE_SECRET_KEY` set and the site key missing (the brief did not
    name the row; this one keeps the "no key value in the output" assertion
    non-vacuous, which the all-missing row would not). The other three are
    covered by "one key without the other refuses to boot, naming the missing
    variable only", "REQUIRE_HUMAN_CHECK with neither key refuses to boot,
    naming the variables" and the blank-key case.
  - **Step 11 held**, see the first entry. Not applied.
  - **Step 12.** `makeBody` and `parseRangeStart` deleted from
    `engine/test/helpers/http.ts` (grep over `tools/downloader`: no other user).
  - **Step 13.** Deleted the three-row `test.each` in
    `browser-resolver-press-targets.test.ts` ("accepted residue: %s is pressed
    where play is a click, and nothing plays") and its `BLOCKED_CLICK_MS`.
    Covered by `provoke.test.ts` "%s: the blocked clicks are given the cap, not
    2000 ms", same three pages, `confirmAge: true`, the same `pressed` beacon
    and `not.toContain("/beacon/play")`. The deleted rows also asserted
    `NO_MEDIA_FOUND` at the resolver, which the `provoke` rows do not.
  - **Step 14.** `browser-resolver-age-gate.test.ts` "meets a modal and a gate
    that mount after the playback passes are over": `quietMs: 6000` replaced
    by `STREAM_WAITS`; 3 of 3 runs of the file passed.
  - **Step 15, checked: applied.** `dismissModal` (and so `revisitOverlays`)
    presses only a control whose label matches `CLOSE_TEXT`, or sends Escape; it
    never reads `CONSENT_TEXT`. `consent-bar-rows.html` has no dialog and no
    close control, its buttons are "Ho capito", "Accetto e continua" and the
    like. The five rows (r1, r1b, r2, r2b, r5b) now call `provokePlayback`
    through a new `pressesOn(pathname, beacon)`, which `presses` wraps. The
    check is not vacuous: the same helper on `row=r7` (a pressed row) returned
    `expected 1 to be +0`. The age-gate rows in
    `browser-resolver-consent-and-links.test.ts` untouched, as the brief says.
  - **Step 16.** `AT_ONCE_WAITS` at "treats a manifest-level DRM verdict as
    terminal too" (`browser-resolver-capture.test.ts`), and at
    `chunk-streams.test.ts` "three whole files in one directory are all
    offered" (was `STREAM_WAITS`) and "aborting while a head read is
    outstanding" (was the default waits); the brief's `:111` and `:127` had
    moved to those.
  - **Step 17.** In `browser-resolver-departure-and-floor.test.ts`, dl-115's two
    `quietWait` probes and dl-129's two `sleepsOf` probes are two:
    `quietWait` now also returns the sleeps it saw. "a resolver given no
    options hands the wait MIN_WAIT_MS ... and sleeps 500 ms after load and 900
    ms between the passes" is the defaults probe; "a minWaitMs below it is the
    one the wait is handed, and landingSettleMs and passPauseMs replace the two
    sleeps and nothing else" sets all three. `sleepsOf` and its two tests are
    gone; the constants test and the source scan stay.
  - **Step 18.** `browser-resolver-player-input.test.ts`: `test.each([0, 3000])`.
  - **Step 19.** `delayed-player.html` reads `?delay=<ms>` (6000 by default);
    the dl-80 case uses `?delay=2500` with `emptyMinWaitMs: 4000`, and its
    upper bound is `4500` (measured 2890, 2954 and 2981 ms on 3 runs; a floor
    that is not dropped on a playable hit would end past 5.5 s).
  - **Step 20, checked: applied.** `timeoutMs: 5000` in "a budget shorter than
    the floor plus page load ends TIMEOUT": TIMEOUT on 10 of 10 local runs in a
    row (`npx vitest run ... -t "a budget shorter than the floor"`, ten times,
    each `Tests 1 passed | 18 skipped (19)`).
  - **Step 21.** `closeAllConnections()` before `close()` in
    `fixture-server.ts`'s `close`.
  - **Done when 1.** `npm test -- --project downloader` locally: `Test Files 126
    passed | 1 skipped (127)`, `Tests 2596 passed | 2 skipped (2598)`, 55.85 s
    wall, exit 0. **How the file time is summed, so a gate can repeat it:**
    `gh run view <run> --job <ubuntu test job id> --log`, strip the colour
    codes, take every vitest default-reporter line
    `<mark> downloader <path>.test.ts (<n> tests) <n>ms`, and add the `ms`
    (one line per file; 126 files, every one with a duration). On run
    `40210503276`'s ubuntu job that sum is 630.8 s over 126 files and 2594
    tests, the ticket's 631 s. The same sum over this machine's local run is
    480.6 s, which is **not** comparable (a different machine, 11 workers); the
    reading Done when 1 asks for is this pull request's own CI run, below.
  - **Not folded in.** No other already-specified piece became free; the
    brief's own steps were the work.
  - **Seams.** None of `dispatcher`, `egress-ca`, `embedded-ipv4` or
    `proxied-https` `.test.ts`, `dispatcher.ts` or `server.ts` (dl-131's) is
    touched. `tiers-on-the-terminating-proxy.test.ts` (dl-130's) is not.
    `web/test/app.test.tsx` (dl-133's) is not.
  - **Seen and not reproduced.** The first full `api` run (31 s, before the
    `logging.test.ts` repair) reported one unhandled `The database connection is
    not open` from `JobStore.recordProgress` via an ffmpeg progress chunk, at
    `stream-link.test.ts` "a stream that passes MAX_FILE_SIZE_MB is cut ...".
    Three further runs of that file and the whole downloader project run had
    none. Whether it predates this branch is unmeasured.
- 2026-11-10: Done when 1, read from this pull request's own CI run (#787,
  head `91278e41`, run `42734531994`, job `test (ubuntu-latest)` `129560446626`),
  by the sum described above: **466.6 s** over 126 downloader files and 2596
  tests, against run `40210503276`'s **630.8 s** over 126 files and 2594 tests,
  **164.2 s lower than that run, which is the bar's reference** (the bar was
  90 s, and the ticket words it against run `40210503276`). **That is not what
  the branch saves:** run `40210503276` is from 2026-10-25, and `main` has moved
  since. Against this branch's own base, `e44644ad` (#777's run `42731587914`,
  the same sum: 577.2 s over 126 files and 2608 tests), the branch saves
  **110.7 s** (577.231 - 466.579), which also clears 90 s; the other 53.6 s is
  `main`'s drift. (Corrected in round 1: this entry first read 164.2 s as the
  saving, and one commit subject carries the same wording.) That job's whole run
  (the projects the change reaches, 156 files) took 154.55 s wall. Every check
  on that head was green, the informational Windows leg included.
- 2026-11-10: Three owner answers after gate 1 (graded CONCERNS at `60306eb9`),
  relayed by the orchestrator, recorded before the round's work.
  1. **F1, two deletions that left a clause with no test.** Step 6's deleted
     stream-link case was the only api test of `createApp` handing
     `config.stageTimeoutMs` to `createEngine`; step 10's dropped spawned row was
     the only check that the boot output omits the site key when it is set.
     Options: (a) restore both clauses cheaply / (b) accept both as losses, as
     step 13's `NO_MEDIA_FOUND` is. The owner chose **(a) restore both clauses**,
     the gate's recommendation.
  2. **Step 3, re-asked on a measurement.** The owner first chose "export
     `BrowserPool` and build it". The re-ask carried the measurement that
     `tools/downloader/resolvers/package.json` `exports` has only `"."` and
     `src/index.ts` exports only `type { BrowserPoolStats }`, and the gate's
     point that the SPKI pin is a Chromium launch flag riding on the pool.
     Options: keep it (export and build) / drop step 3. The owner chose **drop
     step 3**. Step 3 stays **not done**, for that reason.
  3. **Lows.** Options: F2 and F4 in the round / F2, F3 and F4 / record all. The
     owner chose **F2 and F4 in the round**. F3 and F5 stay recorded and are not
     touched here.
- 2026-11-10: Round 1, after gate 1 and the three answers above.
  - **F1, step 6 restored.** `stream-link.test.ts` "the job timeout reaches the
    engine as its stage timeout": `realApp({ stageTimeoutMs: 2_000 })` and
    `app.context.engine.config.stageTimeoutMs` is `2000`. It ends before any
    byte and boots no stream; both defaults are 3 600 000, so the non-default
    value is the test. Red with `stageTimeoutMs: config.stageTimeoutMs` removed
    from `createEngine`'s call in `api/src/server.ts` (`AssertionError: expected
    3600000 to be 2000`, `Tests 1 failed | 16 skipped (17)`), green restored
    (`Tests 1 passed | 16 skipped (17)`). `realApp` took its `stageTimeoutMs`
    option back.
  - **F1, step 10 restored.** `human-check.test.ts` "the thrown refusal under
    REQUIRE_HUMAN_CHECK carries variable names and no key value" now also
    refuses `{ REQUIRE_HUMAN_CHECK, TURNSTILE_SITE_KEY: PASS_SITE_KEY }`, checks
    it names `TURNSTILE_SECRET_KEY`, and checks the refusal carries neither key.
    Red with `(${siteKey})` planted into the message in `api/src/config.ts`
    (`expected '{"error":"TURNSTILE_SECRET_KEY is not…' not to contain
    '1x00000000000000000000AA'`, `Tests 1 failed | 19 passed (20)`), green
    restored (`Tests 20 passed (20)`). The kept spawned row still carries the
    secret; the site key is now read in-process, where it costs nothing.
  - **F2.** The Log's reading of the saving is corrected above; the history is
    not rewritten.
  - **F4.** The comment on the faststart-only row in
    `engine/test/parallel-ranges.test.ts` now says the first test runs at a
    different throttle (500 KB/s against 2 MB/s) with the variant's own
    duration, and that the dropped row also counted more than 100 digests.
  - **Step 3** stays not done, on the owner's answer above. **F3 and F5** are
    recorded by the gate and not touched.
- 2026-11-10: Landing as `in-flight`; two things remain before this ticket
  reaches `done`. (1) **Step 11**, built on top of dl-133 (PR #781) once it
  merges, which settles Done when 4's step-11 part, now `unproven (scope)`.
  (2) A merge of `main` into this branch once PR #777 (dl-130) squash-merges,
  which retargets this draft (#787) to `main`; the draft holds for merge order
  until then.
