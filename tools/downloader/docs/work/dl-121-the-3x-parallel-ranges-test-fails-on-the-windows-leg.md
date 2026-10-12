---
id: dl-121
tool: downloader
title: The 3x parallel-ranges test fails on the Windows leg since 2026-10-12, at a ratio of 2.91 to 3.00
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-121 — The 3x parallel-ranges test fails on the Windows leg

## Why

`engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4
connections and finishes at least 3x faster" is dl-98's proof of its Done when 1,
and it asserts `single.ms / split.ms >= 3` on wall-clock time. On
`test (windows-latest, informational)` it has started failing just under the
bar. It is the only failure in each of these jobs:

| Head       | Branch                     | singleMs | splitMs | ratio |
| ---------- | -------------------------- | -------- | ------- | ----- |
| `148b67a2` | repo-103                   | 8422     | 2835    | 2.97  |
| `b531355c` | dl-108                     | 8419     | 2896    | 2.91  |
| `68001337` | dl-113                     | 8400     | 2804    | 3.00  |
| `c37170bb` | pl-55                      | 8433     | 2819    | 2.99  |
| `47c95880` | repo-103                   | 8411     | 2855    | 2.95  |
| `4829513f` | repo-103                   | 8412     | 2887    | 2.91  |
| `0f16ef71` | release-please, downloader | 8421     | 2811    | 3.00  |
| `3463e481` | lg-21-head-sweep (#466)    | 8411     | 2867    | 2.93  |

(The ratios in the job logs carry more digits; `68001337` and `0f16ef71` are
2.9953 and 2.9962.)

Read from `gh run list --workflow CI` on 2026-10-12, over the last 140 runs.
The Windows job ran to a result in 80 of them:

- **Before 2026-10-12 18:52 UTC:** about 40 Windows results, and this test
  failed in none.
- **From 0484ae71 (18:52) on:** 8 failures, the table above, out of about 40
  Windows results. Every failing head contains `0484ae71`; passes in the same
  span include `main` at `c3717022` and `e46ec2eb`.

What is known about the cause, and what is not:

- `07acbb86..0484ae71` is two release commits (`966a97ed`, `0484ae71`) and
  touches nothing under `tools/downloader/engine`, so no code change lines up
  with the boundary.
- The runner image is the same on both sides (`windows-2025-vs2026`,
  `20260925.250.1`) for `07acbb86`, `0484ae71`, `148b67a2`, `3463e481` and
  `c3717022`.
- `singleMs` barely moves (8400–8433 ms) while `splitMs` is 2804–2896 ms. On
  Linux, dl-98's gate measured the split at 2408–2427 ms and the ratio at
  3.450–3.476 over 10 quiet runs, and 3.25 at its lowest under a load average of 10. So on Windows, the four-connection run is about 400 ms slower and the
  margin is gone, while the single-connection baseline is not affected.
- The engine-test commits that landed earlier that day, dl-112 (`a5458ef1`) and
  dl-116 (`b4ae2dc3`), both merged before 18:52 and passed on Windows after
  merging. They are not ruled out, because the failures are intermittent.

This is not dl-106. Its three tests (the "no speed-up at 4" continuation, F9 and
held bytes) are not among these failures, and its fix (pacing the test origin as
a bucket, `52fdc84b`) is in every failing head.

`lg-19`'s `1f8bc481` also failed on Windows in this span, on a different
assertion (`expected 3584 to be less than 3000`). It is not counted here.

## Build

1. **Measure before choosing.** On `windows-latest`, run only this test in a
   loop (a `workflow_dispatch` job, or a scratch branch's CI with
   `-t "finishes at least 3x faster"`) at least 10 times. Record `singleMs`,
   `splitMs` and the ratio for each run, on the current `main` and on
   `07acbb86`. That shows whether the slower split comes from code or from the
   runner.
2. Then bring the owner the options with the numbers attached. The 3x bar is
   dl-98's acceptance line, so changing it is a decision, not a fix:
   - (a) A cause in the code, if step 1 finds a difference between the two
     heads: fix that, and keep the bar.
   - (b) Keep `>= 3` on Linux and set a measured floor on Windows, with the
     reason in a comment. The informational leg stays a signal.
   - (c) Assert the speed-up from something that is not wall-clock time, for
     example bytes delivered per connection-second from the feeder's stats.
     Keep a looser wall-clock floor as the end-to-end check.
3. Whatever is chosen, the switch-removed mutant (`#split` never called) must
   still fail the test. dl-98's gate measured the raw ratio at 0.999 for it.

## Done when

- The Log names what step 1 measured on both heads, with the run ids.
- The test passes 10 times in a row on `windows-latest`, or the Log says why that
  is not the bar.
- With `#split` never called, the test still fails on Linux, and
  `npm run check` passes.

## Log

- 2026-10-12 — Filed from #466's Windows leg (run 38320156902, job
  115046284217), at the owner's choice of "file a dl- ticket" over reopening
  dl-106 or leaving it. The table and counts above come from the job logs of
  the last 140 `CI` runs.
