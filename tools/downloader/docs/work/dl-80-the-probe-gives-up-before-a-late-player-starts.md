---
id: dl-80
tool: downloader
title: The probe gives up after 2.5 s of quiet with nothing captured, before a late player starts
kind: fix
status: ready
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
