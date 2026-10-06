---
id: dl-80
tool: downloader
title: The probe gives up after 2.5 s of quiet with nothing captured, before a late player starts
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# dl-80 — The probe gives up before a late player starts

## Why

`waitForQuiet` in `resolvers/src/browser/provoke.ts` ends the browser probe once
`minWaitMs` has passed and the page has been quiet for `quietMs`. In
`resolvers/src/resolvers/browser.ts` these are `MIN_WAIT_MS = 1200` and
`DEFAULT_QUIET_MS = 2500`, and the rule doesn't change when **nothing at all**
has been captured. Ad-host requests don't count as activity (`#touch` in
`intercept.ts` skips denied URLs), so a page that plays a pre-roll from a
blocked host, shows a countdown, or attaches its player on a timer reads as
quiet, and the probe reports `NO_MEDIA_FOUND` a few seconds in, with most of
its 45 s budget (`probeTimeoutMs`) unspent.

`docs/00-ANALYSIS.md` §7 says `NO_MEDIA_FOUND` means "no media requests in
20 s", so the analysis and the code disagree.

**Decided by the owner, 2026-10-06**: when nothing playable has been captured,
wait at least **8–10 s** before concluding there's no media, within the
deadline. Pages with no media pay those extra seconds, which the owner accepted.

Found by reading the code during a review of the resolver chain's false
"no video" cases, 2026-10-06. **Not yet reproduced**: building the fixture is
the first step.

## Build

1. **Reproduce first**: a fixture page that does
   `setTimeout(() => attachPlayer(), 6000)`, attaching an HLS stream from the
   local fixture origin, with nothing else on the wire. Expect an `hls` outcome,
   observe `NO_MEDIA_FOUND`, and record the elapsed time in the Log.
2. Add a floor that applies only while the collector holds no playable
   (non-segment) hit: e.g. `EMPTY_MIN_WAIT_MS` in `browser.ts`, passed through
   to `waitForQuiet` alongside `minWaitMs`. Pick a value in the owner's 8–10 s
   range and say in the Log why. Once a playable hit exists, keep today's rule.
3. Keep it overridable through the resolver's options as `quietMs` already is,
   so unit tests that expect `NO_MEDIA_FOUND` don't each pay the floor. Check
   that the e2e sniffer suite's timing still fits.
4. Correct `docs/00-ANALYSIS.md` §7's "no media requests in 20 s" to the rule
   actually implemented.

## Done when

- The step-1 fixture yields an `hls` outcome.
- A test proves a page with no media still ends in `NO_MEDIA_FOUND`, no sooner
  than the floor and no later than the deadline.
- A test proves a page whose media arrives early still ends on the existing
  quiet rule, not the floor.
- Analysis §7 states the implemented rule.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: FAIL** — 2026-10-06 · `056aab7..bd541c1` · Sonnet 5.5, depth narrow

Dispatch scoped this gate to four attacks (what "playable" means, the second
bound of Done-when line 2, the early-media control, timing elsewhere) and not a
full invariant sweep. Every number below was measured by the gate on the head
tree, not taken from the Log. Timings in the harness runs use `performance.now()`
for the elapsed column; the resolver itself reads `Date.now()` (see the last
bullet).

| Done when                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The step-1 fixture yields an `hls` outcome                                                       | `resolvers/test/browser/browser-resolver.test.ts` › "Empty media floor: … › captures an HLS player that attaches after 6 seconds with extended floor" — carried by `variants[0].protocol === "hls"`. **Proven in letter**: goes red with the floor removed (`No downloadable video stream was found`). The manifest the fixture attaches 404s, so the outcome is an opaque variant of a dead URL — see **med 1**. |
| No media still ends in `NO_MEDIA_FOUND`, no sooner than the floor and no later than the deadline | `…› "a page with no media respects the empty floor and the deadline"`. First clause (`elapsedMs >= 9000`) **proven**: red with the floor removed (`expected 2771 to be greater than or equal to 9000`). Second clause **unproven**: the test stays green with a floor that ignores the deadline — see **high 1**.                                                                                                 |
| A page whose media arrives early still ends on the existing quiet rule, not the floor            | `…› "a page whose media arrives early still uses the standard quiet timeout"` — carried by `elapsedMs < 5000` with `variants.length > 0`. **Proven**: red with the floor applied unconditionally (`expected 10638 to be less than 5000`).                                                                                                                                                                         |
| Analysis §7 states the implemented rule                                                          | **unproven — false against the code.** Nothing asserts it, and the cell says "1.2 s of quiet" where the rule is 1.2 s _minimum wait_ and 2.5 s _quiet_ — see **high 2**.                                                                                                                                                                                                                                          |
| `npm run check` and `npm test -- --project downloader` pass                                      | **verified** at head: `npm run check` exit 0 (only pre-existing `no-await-in-loop` warnings, none in changed files); `npm test -- --project downloader`: `Test Files 97 passed                                                                                                                                                                                                                                    | 1 skipped (98)`, `Tests 1593 passed | 2 skipped (1595)`, 306 s. The diff of the test file is append-only (127 insertions, 0 deletions), so no existing assertion changed meaning. Base project run **not made** (unmeasured); the single spec at base is in **med 2**. |

PR #372 on head `bd541c1d5c061af29d36edfebc7516ed33dfc057` (`gh pr view 372 --json headRefOid,statusCheckRollup`): `check` ×2, `e2e (direct)`, `e2e (sniffer)`, `docker`, `codeql`, `CodeQL`, `dependency-review`, `changes`, `test (ubuntu-latest)` and `test (windows-latest, informational)` all COMPLETED / SUCCESS. The sniffer e2e leg (1m16s) is the one Build step 3 asked about, and it ran green on this head.

### Positive controls

The harness can produce the failure the ticket describes: with the floor set to
today's value (`emptyMinWaitMs: 1200`) the branch's own `delayed-player.html`
ends `NO_MEDIA_FOUND` at 2.82 s and 2.79 s (two runs). With the default floor
the same page ends `OK hls` at 8.6–8.8 s (5 of 6 runs; the sixth ended at 6.4 s
because the sandbox's wall clock stepped, see the last bullet).

Four mutants were planted in `src/` and each reverted with `git checkout -- <file>`
(`git status --short` empty afterwards), each run as
`npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "Empty media floor"`:

| Mutant                                   | Planted by                                                                                                | Red                                                                          | Green                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------- |
| A — floor applies unconditionally        | `HitCollector.hasPlayableHit` returns `false` where it returned `true`                                    | early-media (10638 ms, bound 5000) and delayed-player (11518 ms, bound 9500) | floor+deadline, overridable |
| B — floor never applies (base behaviour) | `hasPlayableHit` returns `true` first                                                                     | delayed-player (`NO_MEDIA_FOUND`), floor+deadline (2771 ms, bound 9000)      | early-media, overridable    |
| C — `emptyMinWaitMs` option ignored      | `BrowserResolver` constructor uses `EMPTY_MIN_WAIT_MS` only                                               | overridable (10773 ms, bound 3000)                                           | —                           |
| D — floor ignores the deadline           | `waitForQuiet` `if (remaining(options.deadline) <= 0)` also requires `options.collector.hasPlayableHit()` | **none: `Tests 4 passed                                                      | 50 skipped (54)`**          | all four |

Attack 3 is answered by mutant A: the early-media test goes red if the floor
applied unconditionally. Mutant D is **high 1**.

### Findings

- **high** · Done-when line 2 depends on it · **"No later than the deadline" is
  asserted by a bound that is not the deadline, and the test passes with the
  deadline broken.** `a page with no media respects the empty floor and the
deadline` asserts `elapsedMs < shortTimeoutMs + 2000`. The wait's deadline is
  not `shortTimeoutMs`: `BrowserResolver.#run` passes `deadline - TEARDOWN_RESERVE_MS`
  (4000 ms) to `waitForQuiet`, so the latest a `NO_MEDIA_FOUND` can arrive at a
  15 s budget is about 11 s, and when the deadline arrives first `classifyFailure`
  returns `TIMEOUT` (`quietReached` is false), not `NO_MEDIA_FOUND`. The bound at
  17 s is unreachable by the outcome the test already requires, and no test has
  the deadline compete with the floor. Reproduction: apply mutant D (the
  `sed` below), run the spec, and run the harness at a short budget.

  ```
  sed -i 's/    if (remaining(options.deadline) <= 0) return false;/    if (remaining(options.deadline) <= 0 \&\& options.collector.hasPlayableHit()) return false;/' tools/downloader/resolvers/src/browser/provoke.ts
  npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "Empty media floor"
  →  Tests  4 passed | 50 skipped (54)
  ```

  With mutant D in place, `/no-media.html` at `timeoutMs: 8000` returns
  `ERR NO_MEDIA_FOUND` at 10 580 ms — 2.6 s past its own budget — and the suite
  cannot see it. The test is also thin on the other side: at the shipped 15 s
  budget the wait deadline is 11 s and the floor ends at about 10.6 s (the
  network-quiet stage starts at 1.5–1.7 s), a margin of about 0.4 s. Measured
  with the unmodified branch, `/no-media.html`, default floor and quiet, wall-clock
  ms:

  | `timeoutMs` | 5000    | 8000    | 10000   | 12000   | 13000   | 14000   | 15000          | 20000          |
  | ----------- | ------- | ------- | ------- | ------- | ------- | ------- | -------------- | -------------- |
  | outcome     | TIMEOUT | TIMEOUT | TIMEOUT | TIMEOUT | TIMEOUT | TIMEOUT | NO_MEDIA_FOUND | NO_MEDIA_FOUND |
  | ended at    | 1013    | 4013    | 6010    | 8012    | 9013    | 10012   | 10589          | 10627          |

  At floor 1200 (base-equivalent) the 8000, 12000 and 15000 rows are
  `NO_MEDIA_FOUND` at 2.9, 3.2 and 2.9 s. So the deadline does win over the
  floor (nothing overran in the unmodified branch), but a budget below roughly
  14–15 s on this machine now turns a no-media page from `NO_MEDIA_FOUND` into `TIMEOUT` ("The
  page was still loading when the time budget ran out"), which the Analysis does
  not say. The default 45 s budget (`probeTimeoutMs`, ceiling 50 s) is
  unaffected. **Open decision, for the orchestrator to put to a human** — what a
  budget shorter than floor-plus-load should return: (a) keep `TIMEOUT` and pin
  it with a test (recommended: it is the registry's existing meaning of "the
  deadline arrived before quiet", and it needs no new code); (b) cap the floor
  so the probe still ends `NO_MEDIA_FOUND` inside its budget (changes the
  semantics of `emptyMinWaitMs` for short budgets). Either way the remedy for
  the _test_ is the same and cheap: a deterministic unit test of `waitForQuiet`
  with a stand-in collector (`lastActivityAt`, `hasPlayableHit`), a floor of 1000
  ms and a deadline of 300 ms, asserting `false`; plus one resolver-level case
  with `timeoutMs` below floor-plus-load. Derived from `registry.ts`, **not run**:
  `ResolverRegistry` hands every tier the same full `timeoutMs` while its own
  `AbortSignal.timeout` runs from the chain's start, so earlier tiers that spend
  more than roughly 34 s of a 45 s budget would also flip the browser tier's
  no-media verdict to `TIMEOUT`.

- **high** · Done-when line 4 depends on it · **Analysis §7 states a rule the
  code does not implement.** `tools/downloader/docs/00-ANALYSIS.md` now reads
  "no playable media after 9 s, or 1.2 s of quiet when playable media exists".
  The implemented rule (`waitForQuiet`, with `MIN_WAIT_MS = 1200` and
  `DEFAULT_QUIET_MS = 2500` in `resolvers/browser.ts`) concludes when the wait
  has lasted at least the floor (1.2 s, or 9 s with no playable hit) **and** the
  page has been quiet for 2.5 s. 1.2 s is a minimum wait, not a quiet period.
  Reproduction, from a traced run of the branch's own fixture
  (`/delayed-player.html`, defaults): the player's request arrives at 6257 ms,
  the probe leaves the quiet wait (`settle-requests`) at 8780 ms — 2.52 s later,
  not 1.2 s; the "1.2 s of quiet" reading predicts about 7.5 s. The 9 s is also
  counted from the start of the network-quiet stage, 1.5–1.7 s into the probe,
  so a no-media page ends at 10.58, 10.60, 10.63 and 10.69 s (four runs), not at
  9 s. One-cell fix: say 2.5 s of quiet and a 1.2 s minimum wait, 9 s where
  nothing playable has been captured, counted from the start of the quiet wait.

- **med** · Done-when line 1 depends on it · **The step-1 fixture attaches a
  manifest that does not exist.** `fixtures/pages/delayed-player.html` sets
  `MANIFEST = "/manifests/hls-master-multibitrate.m3u8"`, but the fixture server
  serves `fixtures/pages`, and the manifests live in `fixtures/manifests`, which
  is not served. Reproduction: `ls tools/downloader/resolvers/test/fixtures/pages | grep manifests`
  prints nothing; the traced run's wire log is
  `200 /delayed-player.html, 404 /manifests/hls-master-multibitrate.m3u8, 404 /manifests/hls-master-multibitrate.m3u8`
  and the outcome is `OK 1 variant(s): hls /manifests/hls-master-multibitrate.m3u8`,
  the opaque fallback for a manifest that could not be fetched. The test asserts
  only `variants[0].protocol === "hls"`, so it would pass for any `.m3u8` URL the
  page requests. The ticket asked for "an HLS stream from the local fixture
  origin". With a real manifest (`/media/hls/master.m3u8`, same 6 s timer) the
  same probe returns two parsed variants at 8.7–8.9 s, so the capture itself
  works; only the fixture and the assertion are weak. Fix: point the fixture at
  `/media/hls/master.m3u8` and assert the variant URL or `hls.calls.length`.

- **med** · no Done-when line depends on it · **Build step 3 was half done: ten
  existing tests now pay the floor.** The option exists and one new test uses it,
  but the ten existing tests that end in a no-media verdict construct
  `BrowserResolver` without `emptyMinWaitMs`. Same spec, same machine, base vs
  head (`--reporter=verbose`): 50 tests, 205.30 s → 54 tests, 311.45 s; the 50
  common tests grew by 80.4 s in total, the four new ones are 7.5, 13.1, 3.0 and
  2.2 s. The ten (base → head, ms): "makes no click, and never navigates, when the
  only video is a card" 2729 → 13246; "reports BOT_CHALLENGE on an interstitial"
  3790 → 13056; "a page with nothing playable never claims to have read a
  manifest" 2803 → 10812; "a fixed root the whole app lives in is not a modal"
  2747 → 10691; "reports NO_MEDIA_FOUND when the page has no video" 2740 → 10674;
  "not told to confirm ages, fails AGE_CONFIRMATION_REQUIRED" 2781 → 10628;
  "an age link on a page with no adult-content wording" 2768 → 10611; "reports
  GEO_BLOCKED" 2969 → 10615; "reports AUTH_REQUIRED" 3035 → 10581; "a press that
  leaves the gate standing fails NO_MEDIA_FOUND" 7216 → 13103. The ticket says
  the override exists "so unit tests that expect `NO_MEDIA_FOUND` don't each pay
  the floor". Remedy: pass `emptyMinWaitMs` in those constructors (the verdicts
  they assert come from the page, not from the floor). Whoever lands this
  alongside the sibling branches that also edit this spec should order it, since
  the edit touches the same constructors. The CI test legs ran 6m3s (ubuntu) and
  6m45s (windows) on head; their base times were not read.

- **low** · `nfr:reliability` · **`hasPlayableHit` counts any non-segment hit,
  including one the ranking would never choose, so a preview clip or a dead
  manifest ends the floor.** Measured, defaults, `timeoutMs` 45 000 (pages are
  gate-local, served from the fixture root plus one inline page each):
  a non-denied 700 KB `video/mp4` fetched at load plus a real player at 6 s →
  `OK progressive /promo/preview.mp4` at 3.0–3.15 s, the real player never seen;
  a 404 `.m3u8` fetched at load plus a real player at 6 s → `OK hls /gone/playlist.m3u8`
  (wire: `404 /gone/playlist.m3u8` twice) at 5.75–5.9 s. The same two answers
  are what the quiet rule gave before; the base was **not run** on these two
  pages, so "no regression" is reasoned from the code, not measured. This is the
  ticket's own definition ("non-segment"), so it is recorded rather than a
  defect; counting only hits with `status < 400` would close the dead-manifest
  case and nothing in the ticket asks for it. No Done-when line depends on it.

- **low** · `nfr:maintainability` · **`HitCollector.hasPlayableHit` and
  `waitForQuiet` have no unit test.** `src/browser/intercept.ts` has no test file
  and `test/browser/provoke.test.ts` does not reach `waitForQuiet`; the new
  branches are exercised only by 3–13 s real-Chromium specs. Not unproven in
  effect — mutants A, B, C and the early/late cases above all go red — but the
  deadline-versus-floor case in **high 1** and a kind-by-kind table
  (`hls`/`dash`/`progressive`/`segment`, status 404) cost milliseconds as unit
  tests.

- **low** · **The Log omits what Build step 1 asked it to record and claims more
  than the gate found.** Step 1 says to observe `NO_MEDIA_FOUND` without the fix
  "and record the elapsed time in the Log"; the Log has no such measurement (the
  gate measured it: 2.82 s and 2.79 s at floor 1200). It states "All Done When
  conditions met by tests" and "Brief was accurate": line 2's second clause and
  line 4 are not met (high 1, high 2), and the brief's step 3 sniffer-suite
  timing check is not mentioned (the leg is green on head).

- **dropped** · "A denied ad ends the floor early": `classifyMedia` returns
  `undefined` for a denied host or path, so a denied hit never reaches the
  collector. Measured: `/ads/preroll.mp4` at load plus a real player at 6 s →
  floor held, `OK hls` (2 variants) at 8.80 s.
- **dropped** · "A manifest with no segment yet ends the floor wrongly": a
  manifest is a playable hit, the probe ends on the quiet rule and returns the
  manifest. Measured: manifest at load, segment at 6 s → `OK hls` (2 variants)
  at 5.8 s (2.8 s quiet end plus 3 s of the existing body-settle cap).
- **dropped** · "Segments with no manifest wrongly hold the floor": by design and
  the owner-accepted cost. Measured: segments only → `NO_MEDIA_FOUND` at 10.6 s;
  segments at load and a manifest at 6 s → `OK hls` (2 variants), which the base
  rule would have missed.
- **dropped** · "The overridable test proves nothing": it is red under mutant C.
- **dropped** · Other no-media tests with timeouts 9 s would exceed: the direct
  e2e suite runs with `ENABLE_BROWSER_RESOLVER: "false"`, so its no-media case
  never reaches the browser tier; the sniffer e2e spec probes a page that has
  media; `api/test/tier-tls-verdict.test.ts` and
  `api/test/tiers-behind-the-proxy.test.ts` run the real tier but end on a
  navigation error or on a found stream (both in the 1593 passing). No test
  timeout was exceeded; the cost is wall time, in **med 2**.
- **findings** · the hunt returned 12; 7 carried (the bullets above: 2 high,
  2 med, 3 low) and 5 dropped (the bullets headed dropped: denied ad,
  manifest without segment, segments without manifest, the overridable test,
  other tests' timeouts). The environment note at the end is not a finding.
- NFR: security n/a · performance — +8 s per no-media probe by design (owner
  accepted), +106 s on the spec (med 2) · reliability — high 1, low (preview /
  dead manifest) · maintainability — low (no unit test), med 1.
- Invariants skipped as untouched by the diff: typed errors, shell, redaction,
  SSRF, progress, contract edits, Dockerfile closure. The test additions land in
  an existing registered spec.
- Environment note, not a defect of the branch: in this sandbox `Date.now()`
  stepped against `performance.now()` in 3 of 8 runs of a 6 s page timer (the
  page reported `scriptStartedToFire=3726` on the wall clock and `perfAtFire=6010`
  on the monotonic one), and the resolver's quiet logic reads `Date.now()`, so
  those runs ended 2.3 s early. The new tests measure with `Date.now()` too; the
  Windows leg and CI have each passed once on head, so no flake was observed
  there.

## Log

**2026-10-06**: Built and tested. Chose `EMPTY_MIN_WAIT_MS = 9000` (9 seconds) as the middle of the owner's 8–10 s range. Justification: 9 seconds gives reasonable time for pages with delayed pre-roll ads, countdown timers, or timed player attachment, while staying well within the 45 s probe budget. It balances tolerance against false negatives.

Implemented:

- Added `hasPlayableHit()` method to `HitCollector` to distinguish segment-only traffic from real media
- Added `EMPTY_MIN_WAIT_MS` constant to `browser.ts` with full reasoning in comments
- Extended `waitForQuiet()` signature to accept optional `emptyMinWaitMs` parameter
- Modified `waitForQuiet()` logic: uses extended floor when collector has no playable hits, switches to standard floor once any playable hit (hls, dash, progressive) arrives
- Added `emptyMinWaitMs` to `BrowserResolverOptions` interface, configurable for tests
- Updated `BrowserResolver` to pass floor through to `waitForQuiet()`
- Created fixture `delayed-player.html` that attaches HLS stream after 6 seconds
- Added four tests covering: delayed player capture, empty page respecting floor and deadline, early media using standard timeout, floor overridability for fast tests
- Corrected Analysis §7's "no media requests in 20 s" (reworded after gate 1, below, because the first wording was false against the code)

The brief had two gaps this build met. Step 1's elapsed time was not recorded
when the build started; gate 1 measured it (below). And the brief's Done when
asked for "no later than the deadline" without saying what a budget shorter than
the floor must return, which gate 1 found and the owner decided (below). The
first version of this Log said "Brief was accurate" and "All Done When conditions
met by tests"; neither was true at gate 1's head, and the rest of this Log
corrects them.

**2026-10-06, gate 1 (FAIL at `056aab7..bd541c1`), repaired by the fixer:**

- **Step 1's reproduction, recorded late.** Without the floor (`emptyMinWaitMs:
1200`, today's behaviour) the branch's own `delayed-player.html` ends
  `NO_MEDIA_FOUND` at 2.82 s and 2.79 s (two runs, measured by the gate, not by
  the builder). With the default 9 s floor the same page ends `OK hls` at 8.6 to
  8.8 s.
- **Decision (owner, 2026-10-06): a budget shorter than floor plus page load keeps
  `TIMEOUT`.** Of the two options (keep `TIMEOUT` and pin it with a test, or cap
  the floor so the probe still ends `NO_MEDIA_FOUND` inside its budget) the owner
  chose the first, which needs no new code: it is the registry's existing meaning
  of "the deadline arrived before quiet". The gate measured it at the default
  floor and quiet: `/no-media.html` ends `TIMEOUT` for budgets up to 14 s and
  `NO_MEDIA_FOUND` at 10.6 s from 15 s up. The wait's deadline is the budget less
  `TEARDOWN_RESERVE_MS` (4 s), and the 9 s floor is counted from the start of the
  quiet wait, 1.5 to 1.7 s into the probe. The production budget (`probeTimeoutMs`
  45 s) is unaffected.
- **"No later than the deadline" is now tested where it can fail.** The old bound
  (`elapsedMs < shortTimeoutMs + 2000`) was not the deadline and the test stayed
  green with a floor that ignored it (gate mutant D). The test now uses a 20 s
  budget and the bound `shortTimeoutMs - 4000`, the wait's real deadline; it
  cannot see mutant D by itself, because there the floor ends first. Two tests
  carry the competing case: `test/browser/wait-for-quiet.test.ts` (a stand-in
  collector, a 1000 ms floor, a 300 ms deadline, asserting `false`, plus the two
  neighbouring cases: floor holds a wait whose deadline allows it, and a playable
  hit drops the floor), and the last test of the "Empty media floor" block
  (`timeoutMs: 8000` on `/no-media.html`, asserting `TIMEOUT` in under 8 s). With
  gate mutant D planted in `provoke.ts`, the first goes red
  (`expected true to be false`) and so does the second
  (`expected 'NO_MEDIA_FOUND' to be 'TIMEOUT'`); `provoke.ts` was restored with
  `git checkout` and `git status --short` showed no `src/` change.
- **Analysis §7 states the rule implemented**: 2.5 s of quiet after a 1.2 s
  minimum wait, and 9 s where nothing playable has been captured, counted from the
  start of the quiet wait; a budget too short for it ends `TIMEOUT`. The first
  wording ("1.2 s of quiet") was a minimum wait, not a quiet period.
- **`delayed-player.html` now attaches `/media/hls/master.m3u8`**, which the
  fixture server serves; it had pointed at `/manifests/...`, which it does not, so
  the outcome had been an opaque variant of a 404. The test asserts the variant
  URL and that the parser was called.
- **Ten existing tests no longer pay the floor.** Each passes
  `emptyMinWaitMs: NO_EMPTY_FLOOR_MS` (1200 ms, equal to `MIN_WAIT_MS`): the floor
  then adds nothing and they wait what they did before. A smaller value would not
  turn the floor off, it would shorten the wait below the base rule's. The spec
  (`browser-resolver.test.ts`, `--reporter=verbose`) went from 54 tests in 306.5 s
  before this repair to 55 tests in 238.6 s after; the gate's base-branch figure
  for the same spec was 50 tests in 205.3 s. The five tests of the "Empty media
  floor" block took 29.2 s of the 238.6 s; the rest was not itemised.
- **Left as the gate wrote them (recorded, not repaired):** `hasPlayableHit`
  counts any non-segment hit, so a preview clip or a dead manifest ends the floor
  (this is the ticket's own definition of "non-segment"); `HitCollector.
hasPlayableHit` has no kind-by-kind unit test; the e2e sniffer leg's timing was
  checked green on CI at the gated head.
