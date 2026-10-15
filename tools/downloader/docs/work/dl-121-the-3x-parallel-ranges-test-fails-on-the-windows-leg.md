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
2. **Answered 2026-10-15: option (b), floor 2.5 on `win32`; see the Log.** Then
   bring the owner the options with the numbers attached. The 3x bar is dl-98's
   acceptance line, so changing it is a decision, not a fix:
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
- The test asserts a ratio of at least 2.5 on `win32` and at least 3 elsewhere,
  with the reason in a comment. (Reworded 2026-10-15 from "passes 10 times in a
  row on `windows-latest`": the Log shows a loop of the one test cannot show the
  failure, and ten whole-suite runs cost about 1.5 h for a flake detector.)
- With `#split` never called, the test still fails on Linux, and
  `npm run check` passes.

## Log

- 2026-10-12 — Filed from #466's Windows leg (run 38320156902, job
  115046284217), at the owner's choice of "file a dl- ticket" over reopening
  dl-106 or leaving it. The table and counts above come from the job logs of
  the last 140 `CI` runs.
- 2026-10-15 — **Step 1 measured, on `windows-latest`; the choice of bar is not
  made.** Measurement only: no assertion and no source changed. A probe pull
  request (#484, a draft that added one workflow file, closed with its branch
  deleted; `git ls-remote --heads origin dl-121-probe | wc -l` printed 0)
  copied `parallel-ranges.test.ts` to a new file with one `console.log` before
  the unchanged assertion, because the real test prints `singleMs` and `splitMs`
  only when it fails. Both refs ran on the same kind of runner (4 cores, node
  22): `07acbb86` and `main` at `8e49523c`.

  **Round 1, the one test on its own, looped inside one job** (run
  [38661757405](https://github.com/brunolabbe/tools/actions/runs/38661757405),
  `vitest run <copy> -t "finishes at least 3x faster"`, 30 passes per ref):

  | Ref        | Runs | Ratio min / median / max | splitMs min / median / max | singleMs min / max | Below 3 |
  | ---------- | ---- | ------------------------ | -------------------------- | ------------------ | ------- |
  | `07acbb86` | 30   | 3.283 / 3.395 / 3.478    | 2445 / 2481 / 2561         | 8404 / 8581        | 0       |
  | `main`     | 30   | 3.370 / 3.432 / 3.486    | 2413 / 2449 / 2495         | 8375 / 8434        | 0       |

  Per-run ratios, in order. `07acbb86`: 3.39 3.39 3.41 3.40 3.42 3.33 3.37 3.43
  3.39 3.48 3.42 3.36 3.44 3.44 3.42 3.39 3.39 3.33 3.43 3.33 3.40 3.43 3.44 3.40
  3.36 3.32 3.35 3.35 3.40 3.28. `main`: 3.47 3.46 3.49 3.40 3.43 3.42 3.44 3.44
  3.39 3.44 3.44 3.43 3.40 3.37 3.45 3.41 3.42 3.45 3.47 3.41 3.46 3.42 3.40 3.45
  3.48 3.40 3.47 3.41 3.38 3.47.

  The same job also ran the whole `tools/downloader/engine` package (every file
  but the original spec, so the copy was the only 3x test) four times on `main`:
  3.31 3.41 3.39 3.43, all passing. So the engine's own siblings are not the load
  that moves it.

  **Round 2, the whole suite the way CI runs it** (run
  [38662846516](https://github.com/brunolabbe/tools/actions/runs/38662846516):
  `npm ci`, `npm run build`, `npx playwright install chromium`, then
  `npx vitest run` over every project with the original spec excluded, one suite
  per runner, 8 runners per ref, all started together):

  | Ref        | Runs | Ratios, sorted                          | Median | splitMs median / max | Below 3 |
  | ---------- | ---- | --------------------------------------- | ------ | -------------------- | ------- |
  | `07acbb86` | 8    | 3.02 3.02 3.06 3.11 3.21 3.46 3.46 3.46 | 3.159  | 2715 / 2830          | 0       |
  | `main`     | 8    | 2.95 3.07 3.20 3.37 3.39 3.45 3.47 3.53 | 3.381  | 2522 / 2854          | 1       |

  The `main` run at 2.953 is `singleMs` 8428, `splitMs` 2854, the one failure of
  16, and it sits inside the band the table in Why records (2.91 to 3.00,
  `splitMs` 2804 to 2896). `singleMs` stayed 8400 to 8909 in all 16.

  **What it shows:**

  - **There is no difference between the two heads.** In isolation `main`'s
    split is faster (median 2449 against 2481), under full load `07acbb86`'s is
    slower (2715 against 2522), and four of its eight sit at 3.02 to 3.11. The
    comparison of one failure to none in eight cannot separate them (Fisher
    exact, p = 1). Option (a) is closed by this: there is no code
    difference to fix.
  - **The cause is load on the runner, on the split run only.** Alone, the
    four-connection run takes about 2450 ms and the ratio is 3.28 to 3.49, 60
    passes out of 60. With the rest of the suite running beside it, `splitMs`
    goes to 2630 to 2850 in 8 of 16 and the ratio to 2.95 to 3.21; the other 8
    of 16 stayed quiet (2420 to 2530, ratios 3.37 to 3.53). The single run is a
    paced 4 MB at a fixed rate and does not move; the split run is short enough
    that 200 to 400 ms of contention is a tenth of it. The loaded runs land on
    both sides of the bar of 3, so on this runner the bar is a coin the load
    tosses. dl-98's gate saw the same shape on
    Linux: 3.450 to 3.476 quiet, 3.25 under a load average of 10.
  - **The failure rate is not pinned.** 1 of 16 here, about 8 of 40 on the
    record in Why. The sample is too small to say the boundary at `0484ae71` was
    a runner change, and nothing in the two refs suggests it was code.
  - **The "passes 10 times in a row" bar is expensive to prove and weak.** The
    one test alone passes 30 of 30 on both refs at the current bar of 3, so a
    loop of the single test proves nothing about the failure. Only a whole-suite
    run reproduces it: 7 to 11 minutes each, about 1.5 h for ten in a row, and
    at the recorded rate (about 1 in 5) ten in a row at the current bar passes
    with probability about 0.11, at 1 in 16 about 0.52. It is a flake detector,
    not a pass/fail gate.
  - **The mutant is far from every bar considered.** The switch-removed mutant
    (`#split` never called) measured 0.999 in dl-98's gate; it was not re-run
    here. A bar of 2.5 on Windows is 1.5 above it. A fan-out of only two
    connections would give a ratio near 2 by arithmetic (not measured), below
    the bar.

  **The options with their numbers**, for the owner:

  - **(a) A cause in the code.** Closed: no difference between `07acbb86` and
    `main` in either mode. Not offered.
  - **(b) Keep `>= 3` where the runner is quiet and set a floor for Windows,**
    with the reason in a comment. Recommended: **2.5 on `win32`, 3 elsewhere.**
    2.5 is 0.41 below the lowest ratio ever recorded here (2.91) and 0.45
    below the lowest of the 16 whole-suite runs, and still 1.5 above the
    mutant, and rejects a two-connection fan-out by arithmetic. Cost: one `process.platform`
    branch in one assertion, the leg stays informational. Weakness: it still
    measures wall-clock time, so a loaded runner worse than this one can cross
    2.5 too (the lowest split seen was 2854 ms; 2.5 would need 3370 ms).
  - **(c) Assert the speed-up from something that is not wall-clock time,** bytes
    delivered per connection-second from the feeder's stats, and keep a looser
    wall-clock floor (say 2.0) as the end-to-end check. Sturdier against load
    and platform-independent, but it is new code in the test and needs the
    feeder's stats to carry per-connection time, which the measurement here did
    not look at; it is the largest change of the three and changes dl-98's
    proof of its Done when 1, not only its tolerance.
  - **(d) Leave the test and the leg as they are,** on the argument that the
    leg is informational. Costs nothing, and leaves a red leg about 1 run in 5
    to 1 in 16 that every later pull request has to explain.
  - **(e) Make the test less sensitive to a fixed overhead,** by lengthening the
    file so the split run takes about twice as long. Not measured. It would
    double a test that already takes about 11 s a run and 74 s as a file (the
    whole spec file on the Windows leg of #484: 43 tests, 73839 ms), and leave
    the same margin shape.

  **Unmeasured:** the mutant on Windows; any whole-suite run beyond 16; whether
  the failing runs share a time of day or a runner pool. In round 2 the `repo`
  project's `scripts/test/next-id.test.ts` ("a command that is not on PATH
  exits 127") failed on all 16 runners, while #484's own Windows leg, which ran
  `npm test`, passed 276 files of 278; the probe ran `npx vitest run`, not
  through the gate, so this is probably the invocation and was not
  investigated. It does not touch the 3x test. `status` is left as it is.

- 2026-10-15 — **Owner's answer, taken by the orchestrator, 2026-10-15.**
  Question: "What should the bar be?" Options: (b) Win32 floor 2.5, (c) not
  wall-clock, (d) leave as is, (e) lengthen the file; (a) was closed by the
  measurement above and not offered. Chosen: **(b) keep `>= 3` everywhere else
  and set 2.5 on `win32`, with the reason in a comment**, which is 0.41 below the
  lowest ratio ever recorded and 1.5 above the mutant's 0.999, one platform
  branch. The Done-when line "passes 10 times in a row" is reworded to the floor
  (above), and Build step 2 is marked answered.
