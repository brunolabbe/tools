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
