---
id: dl-119
tool: downloader
title: The dl-118 cap test's one 3000 ms ceiling failed a slow Windows runner
kind: fix
status: ready
milestone: null
depends_on: [dl-118]
difficulty: standard
---

# dl-119 — The dl-118 cap test's one 3000 ms ceiling failed a slow Windows runner

## Why

[dl-118](./dl-118-three-age-gate-rows-spend-11-s-each-in-provoke-playback.md)
added `clickTimeoutMs`, an optional cap on the clicks a covering layer blocks, and
a `test.each` in `provoke.test.ts` that proves it. Its landing commit `dd639f8c`
fixed gate lows with no re-gate (the owner's choice), and one of those fixes
turned the cap test into three rows with a single ceiling lowered from 5000 to
3000 ms. The 3000 came from the gate's low that restoring
`dismissConsent(frame, 2000, scriptable)` alone left the test green: with the
consent click uncapped the cookie rows took 4020 and 3927 ms locally, against
2011, 2213 and 2155 ms capped on an idle Linux machine.

The three rows catch different regressions, so one ceiling is a compromise
between two distances. The menu row has a regression about 8 s away (the play
clicks uncapped) and the cookie rows one about 1.8 s away (the consent click
uncapped); 3000 ms is generous to neither. On a slow Windows runner the menu row
failed with the cap working.

The owner decided on 2026-10-12, from "file and fix now", "fold it into dl-113"
and "file only": **file and fix now**.

## Reproduction

Read by the orchestrating session with `gh run view --job 114961368546 --log`:
the `test (windows-latest, informational)` leg of run 38294223397, on PR #449
(lg-19, a ledger-only branch), at 1f8bc481. The failing test is
`tools/downloader/resolvers/test/browser/provoke.test.ts` › "clickTimeoutMs caps
the clicks a covering layer blocks (dl-118)" › "a shell's 18+ menu button: the
blocked clicks wait for the cap, not 2000 ms".

```
× a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms 3587ms
✓ a cookie sheet's View our 18 partners, closable panel: the blocked clicks wait for the cap, not 2000 ms 2252ms
✓ a cookie sheet's View our 18 partners, sticky panel: the blocked clicks wait for the cap, not 2000 ms 2239ms
AssertionError: expected 3584 to be less than 3000
```

The same code took 2.0 to 2.3 s on the same runner for the other two rows, so the
runner was not slow across the board: the menu row alone read 1.4 s over. The
leg is informational, so the run was not red for it, but a leg that goes red on
sound code teaches people to ignore it.

Locally: `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
"clickTimeoutMs caps"` passes (the three rows at 2.0 to 2.3 s); the failure is
a runner's, so there is no local reproduction of the red itself, only of the two
regressions the rows must keep catching.

## Build

Replace the one `CAPPED_CEILING_MS` with a ceiling per row, in the dl-118 cap
block of `provoke.test.ts` only (dl-113 edits other blocks of the file in an open
pull request).

1. **Choose the form and say why.** Per-row ceilings, or a measurement relative
   to an uncapped run. A relative measurement costs the uncapped wait on every
   run (8 to 13 s a page, per dl-118), which is the cost dl-118 exists to remove,
   so it is not chosen unless a per-row ceiling cannot leave the room.
2. **Plant each regression and show its row fails before settling a value:**
   the consent click uncapped (cookie rows) and the play clicks uncapped (menu
   row), and each play site alone. Record the time of each.
3. **Time only `provokePlayback`**, not browser launch, context and navigation:
   the cap bounds the clicks, not the runner's cold start.
4. Report the margin each ceiling leaves, against the capped run and against its
   regression.

## Done when

1. Each row of the cap `test.each` carries its own ceiling, and the cookie rows
   and the menu row differ.
2. Each row fails with its own regression planted: the consent click uncapped
   fails both cookie rows; the play clicks uncapped fail the menu row. The Log
   records each plant and its time.
3. The Log records the margin each ceiling leaves against the capped run and
   against the regression, measured more than once.
4. The three rows pass with the cap in place:
   `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
"clickTimeoutMs caps"`.
5. Nothing outside the dl-118 cap block of `provoke.test.ts` changes, other than
   this ticket.

## Log

- 2026-10-12 — Filed and built in one pull request by a builder, on the owner's
  decision above. `status` is `ready`, not `in-flight`: the builder role page
  forbids the second, and the lander sets it with the gate record.
  - **Form: a ceiling per row.** A relative measurement would run an uncapped
    page (8 to 13 s) beside every capped one, and the rows would pay again what
    dl-118 removed. The room a ceiling needs is also available without it: the
    two regressions are a measured distance apart, and the ceiling sits between
    that distance and the capped run.
  - **Timed region.** `Date.now()` now brackets `provokePlayback` alone. Locally
    the launch and navigation are about 0.1 s, so this changes no local number;
    the claim is only that on a cold Windows runner the part of a row that is not
    the cap is kept out of what the ceiling bounds. Not measured: whether launch
    was the 1.4 s of the 3587 ms row, since the runner's log carries no split.
  - **Measurements** (this branch, `origin/main` 0484ae71, a 12-CPU machine at
    load average 4 to 13 shared with other sessions; the time is
    `provokePlayback` alone, from a temporary stderr line removed before the
    commit):

    | state                          | menu button     | cookie closable | cookie sticky   |
    | ------------------------------ | --------------- | --------------- | --------------- |
    | capped, 5 runs                 | 1941 to 2058 ms | 2116 to 2530 ms | 2128 to 2332 ms |
    | consent click uncapped, 5 runs | 1892 to 2274 ms | 3913 to 4452 ms | 3875 to 4421 ms |
    | play selector uncapped, 3 runs | 5484 to 5656 ms | 5710 to 5950 ms | 5688 to 5754 ms |
    | play text uncapped, 3 runs     | 5495 to 5672 ms | 5697 to 5766 ms | 5687 to 5823 ms |
    | both play clicks uncapped, 4   | 9195 to 9386 ms | 9301 to 9528 ms | 9294 to 9533 ms |

  - **Ceilings: menu 4000 ms, cookie sheets 3200 ms.** Margins against those
    ranges: the menu row is 1.9 s over its slowest capped run, 1.5 s under the
    nearest regression (one play site uncapped, 5.5 s) and 5.2 s under both. The
    cookie rows are 0.7 s over their slowest capped run (2.53 s) and 0.7 s or more
    under the consent regression (3.9 to 4.5 s): the gap is one 2000 ms wait less
    the 200 ms cap, so that is as wide as the cookie rows can be made. They are
    the rows to watch if a runner turns up slow again. The Windows reading that
    failed (3584 ms, menu) would pass the menu ceiling by 0.4 s even with its
    launch included; the Windows cookie readings (2252, 2239 ms) are 0.95 s under
    the cookie ceiling.
  - **Each plant, run on the final test**, two runs each, the
    `AssertionError: expected N to be less than C` lines:
    - consent click uncapped (`dismissConsent(frame, 2000, scriptable)`): both
      cookie rows fail, 4008 and 4110, then 4004 and 4062, against 3200; the menu
      row passes (`Tests 2 failed | 1 passed`).
    - play selector click uncapped: all three fail, menu 5562 and 5572 against
      4000, cookie 5867, 5791, 5783, 5749 against 3200.
    - play text click uncapped: all three fail, menu 5495 and 5506, cookie 5722,
      5828, 5713, 5690.
    - both play clicks uncapped: all three fail, menu 9232 and 9212, cookie
      9417, 9687, 9307, 9309.
  - Capped, three runs of `npx vitest run
tools/downloader/resolvers/test/browser/provoke.test.ts -t "clickTimeoutMs
caps"` on the final test: `Tests  3 passed | 238 skipped (241)`, rows at
    2034/2219/2133, 2025/2215/2163 and 2040/2321/2245 ms (the vitest per-test
    time, which includes launch).
  - What the brief had wrong: none. The "four blocked clicks at 2000 ms" of the
    menu row is the two play sites, twice each, as dl-118's Log table says; each
    site alone is already 3.5 s over, which the 4000 ms ceiling is set to catch.
