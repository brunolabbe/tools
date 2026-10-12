---
id: dl-119
tool: downloader
title: The dl-118 cap test's one 3000 ms ceiling failed a slow Windows runner
kind: fix
status: done
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

## Review

**Gate: PASS** — 2026-10-12 · `32f8a994...efada9ee` · Opus 5.5, depth narrow (acceptance plus four named attacks; invariant sweep skipped by dispatch)

| Done when                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each row carries its own ceiling; cookie and menu differ                                 | **verified**: the `test.each` in `resolvers/test/browser/provoke.test.ts` › "clickTimeoutMs caps the clicks a covering layer blocks (dl-118)" gives each row a `ceilingMs` (`MENU_CEILING_MS` 4000, `COOKIE_CEILING_MS` 3200), and the assertion reads `expect(elapsedMs).toBeLessThan(ceilingMs)`                                              |
| 2. Each row fails with its own regression planted; Log records each                         | **verified**, reproduced by the gate at 3 runs each: consent click uncapped fails both cookie rows (3880 to 4006 ms) and passes the menu row (1872 to 2118); play-selector click uncapped fails all three rows (menu 5469 to 5635); play-text click uncapped fails all three rows (menu 5480 to 5607). The Log records each plant and its times |
| 3. Log records each ceiling's margin against capped and regression, measured more than once | **verified**: the Log's margin bullet and table (5 capped runs, 3 to 5 per plant). The gate's own numbers are in the report and agree within load                                                                                                                                                                                               |
| 4. The three rows pass capped (`-t "clickTimeoutMs caps"`)                                  | **proven**: `Tests 3 passed \| 238 skipped (241)` on 1 unmodified local run and 23 instrumented ones (5 sequential, 18 in parallel under load); the whole file passes 241 of 241; `test (ubuntu-latest)` and `test (windows-latest, informational)` both pass on efada9ee, Windows rows 1965, 2195 and 2190 ms                                  |
| 5. Nothing outside the dl-118 cap block changes, other than this ticket                     | **verified**: `git diff --stat 32f8a994...HEAD` shows 2 files, and the test hunk lies between the cap `describe` and `describe("cappedTimeout (dl-118)")`. `git merge-tree --write-tree origin/dl-113 origin/dl-119` merges cleanly (tree 4ee4a387), and the merged file holds both dl-113's GEO_BLOCKED block and `MENU_CEILING_MS`            |

- **low** · no `Done when` line depends on it · nfr:maintainability. Switching from `%s` to `$name` changed the row titles. Vitest formats a `$` value as a quoted string and truncates it at 40 characters. The two cookie rows now print the **same** title, `'a cookie sheet\'s View our 18 partner…': the blocked clicks wait for the cap, not 2000 ms`, both locally and in this head's Windows log. A failing cookie row can no longer be told from the other, which is the distinction this ticket's Reproduction relied on. A `-t` filter on the old name now selects nothing and exits 0: `-t "closable panel"` gives `Tests 241 skipped (241)`, exit 0, at efada9ee, and `Tests 1 failed | 240 skipped` with the base test file. Remedy: go back to array rows with `%s` and add the ceiling as a fourth element.
- **low** · Log only · The Log says "Locally the launch and navigation are about 0.1 s, so this changes no local number". That holds for an idle box. It does not hold for the Done-when 4 command under load, where the first row pays the shared browser's cold launch. With the base test file, 6 parallel copies under 36 busy loops failed the menu row 4 of 6 times (`expected 3161`, `3181`, `3060`, `3042 to be less than 3000`). Under the same load the head's timed region never put a menu reading above 2737 ms in 30 runs. The change does more than the Log claims.
- **dropped** · the dispatch suspected that the cookie rows' 0.7 s margins would not hold under load. Measured: capped cookie readings go from 2075–2110 ms idle to a maximum of 2712 ms at 6 copies plus 12 busy loops, which leaves at least 0.49 s. Under 36 busy loops the consent regression goes **up**, to 4024–4281 ms, so load widens that side of the gap. None of 48 contended cookie readings crossed 3200. The test comment's "0.7 s each way" is its own idle measurement and is not false. Recorded as a measurement, not a defect.
- **dropped** · I checked whether moving the timer leaves a capped wait outside the timed region. It does not. All three `blockable` uses (`dismissConsent`, `clickVisible(PLAY_SELECTORS)`, `clickByText(PLAY_TEXT)`) are in `provokeFrame`, whose only caller is `provokePlayback`, and the timer brackets exactly that call. `elapsedMs` starts as `NaN`, so a path that never assigns it fails the assertion.
- **findings** · the hunt returned 4; 2 carried (both low), 2 dropped.
- Positive control: with the base, launch-inclusive timer the failure shape reproduces locally (see the second low). With `MENU_CEILING_MS` set back to 3000 and the head's timer, 6 copies under 36 busy loops all pass, menu 2205 to 2448 ms. On this box only launch time could push the menu row over 3000. **Unmeasured:** what made the Windows menu reading 3584 ms. In a full-file run the file-level pool's browser is already up, so cold launch is not shown to be the Windows cause.
- NFR: security n/a · performance ✓ (still well under the 8–13 s uncapped run) · reliability ✓ (contended spread above) · maintainability — the first low.

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

- 2026-10-12 — **Gate 1's two lows, _fixed at landing_** (the owner chose that
  over fixing the titles only or landing as is, with no re-gate). Asked "Land it
  how?", with three options: "lander fixes both (recommended)", "fix titles
  only" and "land as is". Chosen: the lander fixes both. Neither finding touched
  a `Done when` line.
  - **Row titles (maintainability).** Switching from `%s` to `$name` made Vitest
    quote the value and cut it at 40 characters, so the two cookie rows printed
    one title and a failing cookie row could not be told from the other, and
    `-t "closable panel"` selected nothing and exited 0. Fixed by going back to
    array rows with `%s` and the ceiling as a fourth element, so no placeholder
    reads it (the dl-118 `%d` trap printed `NaN ms` when the ceiling was the
    second element). The test body and the timed region are unchanged. Control,
    at efada9ee before the fix: `npx vitest run
tools/downloader/resolvers/test/browser/provoke.test.ts -t "closable panel"`
    gave `Tests  241 skipped (241)`, exit 0, and `-t "clickTimeoutMs caps"` gave
    the cookie rows as `'a cookie sheet\'s View our 18 partner…': the blocked
clicks wait for the cap, not 2000 ms`, twice. After the fix: `-t "closable
panel"` gives `Tests  1 passed | 240 skipped (241)`, and `-t
"clickTimeoutMs caps"` prints three distinct full names, with the rows at
    2034, 2219 and 2136 ms and `Tests  3 passed | 238 skipped (241)`:
    - `a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms`
    - `a cookie sheet's View our 18 partners, closable panel: the blocked clicks wait for the cap, not 2000 ms`
    - `a cookie sheet's View our 18 partners, sticky panel: the blocked clicks wait for the cap, not 2000 ms`
  - **The Log's "no local number changes" (Log only).** The build entry's "Locally
    the launch and navigation are about 0.1 s, so this changes no local number"
    holds for an idle box and not for the Done-when 4 command under load, where
    the first row pays the shared browser's cold launch and the base test file,
    which timed the launch, read it as the cap. The change does more than that
    sentence said: it keeps a loaded box's cold launch out of the number the
    ceiling bounds. Control, here and not the gate's: 6 parallel copies of the
    Done-when 4 command under 36 busy loops on a 12-CPU box, once with the base
    file (`32f8a994`, kept as a temporary file beside the test and removed) and
    once with this head's. Base: the menu row failed in 6 of 6 copies (per-test
    4351, 4289, 4917, 3632, 4970, 4863 ms), and 10 of 18 rows failed in all
    (`expected 4874`, `3044`, `3612`, `4859`, `3196`, `4913`, `4348`, `4277`,
    `3176`, `3008 to be less than 3000`). Head: 0 of 18 rows failed,
    every copy `Tests  3 passed | 238 skipped (241)`. The load was heavier than
    the gate's (the gate saw the menu row fail in 4 of 6), so the numbers differ
    and the direction is the same. The build entry's sentence is left as written;
    this entry corrects it.
