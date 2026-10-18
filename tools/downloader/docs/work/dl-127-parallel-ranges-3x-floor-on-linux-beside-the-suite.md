---
id: dl-127
tool: downloader
title: The 3x parallel-ranges floor failed once on Linux at 2.97x beside the whole suite
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-127 — The 3x parallel-ranges floor on Linux, set from a measurement

## Why

`engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4
connections and finishes at least 3x faster" is dl-98's proof of its Done when 1.
It asserts `single.ms / split.ms >= 3` on wall-clock time, and since
[dl-121](./dl-121-the-3x-parallel-ranges-test-fails-on-the-windows-leg.md)
it asserts 2.5 on Windows and keeps 3 elsewhere.

**It failed once on Linux, beside the whole project.** The builder of
[dl-117](./dl-117-split-browser-resolver-test-so-one-file-is-not-the-whole-run.md)
ran `npm test -- --project downloader` six times locally on one machine, and run
3 failed with:

```
expected 2.9741046875533983 to be greater than or equal to 3
```

with `singleMs` 8483 and `splitMs` 2852 (8483 / 2852 reproduces the number). Runs
4 to 6 passed; the dl-117 Log does not say for runs 1 and 2. That file was not touched by dl-117, and the failure is
not a browser test.

The test's own comment records why this is plausible: the four-connection run
alone slows by 150 to 405 ms beside the rest of the suite while `singleMs` is a
paced transfer and does not move; Windows was recorded at 2.91 to 3.00 for that
reason, and the floor of 3 was kept for Linux on what dl-121's Log records:
dl-98's gate measured 3.450 to 3.476 over 10 quiet Linux runs, and 3.25 at its
lowest under a load average of 10 (a synthetic load). Nobody has measured Linux
beside the full suite.

**What is not known: whether dl-117's split made it likelier.** The six files
start more work at the same time than the one file did, and the base arm is a
single run. The ticket cannot settle that by reasoning, so it measures.

**The owner chose (2026-10-17)** to file this as a ticket, over keeping 3x or
setting Linux to 2.5 now.

## Build

1. **Measure the ratio on Linux beside the full downloader project**, the way
   the failing run was made: `npm test -- --project downloader`. The spec passes
   `timing` only as the `expect` message, so a passing run prints nothing; read
   `singleMs` and `splitMs` from an uncommitted scratch copy of the spec (or an
   uncommitted edit, restored from a commit with `git checkout <sha> -- <path>`)
   that logs `timing` on every run, and never commit it.
   Two arms, **twenty runs each** (the owner's choice, 2026-10-17, below), on the
   same machine and with no other gated run active (the gate prints how many
   hold a slot). The builder may stop an arm before twenty only once each arm
   has had a failure.
   - **base:** `origin/main` at `76ce7d52`, before dl-117's split (one
     `browser-resolver.test.ts`);
   - **split:** the squash-merge commit of PR #499 on `main`, or `76ce7d52` plus
     the six files and the harness restored from it.

   **Why twenty.** At the one failure in six that this ticket reports, eight
   clean runs happen 23 % of the time (5/6 to the eighth), and 60 % of the time
   at the 1-in-16 rate dl-121 recorded on Windows; twenty clean runs at one in
   six happen 2.6 % of the time. Eight a side also cannot say whether the split
   arm fails more often (step 4). By the dl-117 Log's timings (base 297.9 s a
   run, split 73 to 131 s) eight a side is about 50 minutes and twenty a side
   about 2 hours 10 minutes.

2. **Report both distributions** — minimum, median, maximum of
   `single.ms / split.ms`, and the count of runs below 3 — before changing
   anything. The fixture throttle makes `singleMs` about 8.4 s every time, so
   the variance is in `splitMs`.
3. **Set the Linux floor from that data**, the way dl-121 set Windows: a value
   below the lowest ratio recorded and far above 0.999, the ratio of a run that
   never splits. Update the test's comment with the numbers. If both arms show no
   run under 3, keep 3 and say so in the Log with the denominators; that is a
   result.
4. **If the split arm fails more often than the base arm**, say that plainly in
   the Log. Whether to do anything about the split's concurrency is then a
   decision for the owner, not for this ticket.

## Done when

1. The Log holds both arms' runs, each with its count and its minimum, median and
   maximum ratio, and the machine and the date.
2. The Linux floor in `parallel-ranges.test.ts` is either unchanged with the
   measurement that justifies it, or changed to a value below the lowest ratio
   measured, with the comment carrying the numbers.
3. `npx vitest run tools/downloader/engine/test/parallel-ranges.test.ts` passes,
   and `npm run check` passes.

## Review

**Gate: CONCERNS** — 2026-10-18 · `32d4eeee..7aefc39b` · Sonnet 5.5, depth medium

| Done when                                                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The Log holds both arms' runs, each with its count, minimum, median and maximum ratio, the machine and the date                                           | **verified** — the Log's table was rebuilt from the runner's `results.jsonl` (40 run records and one `done` record), not from the Log's arithmetic: base 20 runs, 3.400 / 3.444 / 3.481, `splitMs` 2426 to 2485, 280.5 to 285.5 s a run; split 20 runs, 3.399 / 3.478 / 3.504, `splitMs` 2417 to 2475, 73.4 to 74.8 s; `singleMs` 8398 to 8539 across both; 0 runs below 3; 2565 and 2584 tests, all passed. Machine facts re-read in this container: 12 cores, 15 GB, Node 22.23.3, kernel 5.15.90.1. All 40 run logs print `slot-0, 1 of 2 runs active ... 11 workers`; 0 of 40 flagged contaminated, 20 attempts an arm. The per-run ratios are not in the Log (F4) |
| 2. The Linux floor is unchanged with the measurement that justifies it, or lowered to below the lowest ratio measured, with the comment carrying the numbers | **verified** — the diff adds two comment lines to `engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4 connections and finishes at least 3x faster" and leaves `const floor = process.platform === "win32" ? 2.5 : 3` as it was. The comment's "3.40 to 3.50" is the recomputed 3.3986 to 3.5042 over all 40. Brief step 3 says two arms with no run under 3 keep 3, and this does. How far the measurement justifies keeping 3 beyond a quiet 12-core machine is F1 and F2                                                                                                                                                                 |
| 3. `npx vitest run tools/downloader/engine/test/parallel-ranges.test.ts` passes, and `npm run check` passes                                                  | **verified** — the spec at the head: `Tests 43 passed (43)`, exit 0; `npm run check`: exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **F1 · med** · no `Done when` line depends on it · the Log's cause for the 2.97, "Concurrent load is the likeliest cause", is a guess the evidence does not carry, and the gate's reproduction points the other way. The falsehood runs in the unsafe direction: it closes the question as explained and benign. (1) dl-117's own Log says run 3 "started with the slot free"; the only recorded overlap, a peer taking slot 1 for the last ~20 s of run 4, was on a run that passed, so "other worktrees taking gate slots just before and after" does not describe run 3. (2) CPU contention does not produce +430 ms on Linux. dl-98's gate saw 3.25 at load average 10. Here, one `parallel-ranges` test pinned to 4 cores with 12 busy loops pinned to the same 4 (load average 6.5 to 10.8, 4 runs): ratio 3.367 to 3.387, `splitMs` 2502 to 2527; the same pinning idle (3 runs): 3.457 to 3.473, `splitMs` 2416 to 2428. The 2852 is about +430 ms over idle; heavy CPU contention gave about +80 to +110 ms. (3) Not measured, so not excluded: disk or memory pressure, a WSL2 host stall, and a rare outlier at a quiet rate the 40 runs bound only at about 1 in 13 (the Log's own bound). **Fix (text):** say the cause is unknown; cite that 40 quiet runs and CPU contention alone did not reproduce it; say that keeping 3 leaves a rare red Linux run possible, as dl-117's option 2 put it; and, for the owner's weighing, add the CI record: of the 1000 most recent `ci.yml` runs (2026-10-06 to 2026-10-18) 11 failed, none with this test's message in its failed log, and a 60-run sample (45 of 60 had a passing `test (ubuntu-latest)` leg) puts about 480 of the 638 successful runs as a passing Linux leg, an estimate.
- **F2 · low** · `nfr:maintainability` · the new comment lines sit under an unqualified sentence they contradict: "Beside the rest of the suite the four-connection run alone slows by 150 to 405 ms". The 150 to 405 ms is dl-121's 4-core Windows runner figure. On this 12-core Linux the 40 whole-project runs have a `splitMs` median of 2433 (slowest 2485) against 2416 to 2456 for the test alone, so about +65 ms at most, and floor 3 is 377 ms of `splitMs` above that median (325 above the slowest run), inside the quoted band. The Log restates the comment as "beside a heavier load", which it does not say. The new lines also omit the machine (12 cores, 11 workers) the numbers depend on. A safe-direction overstatement of the Linux slowdown; nothing relies on it. **Fix (text):** mark the 150 to 405 ms as the Windows figure and add "on 12 cores" to the Linux lines.
- **F3 · low** · the split arm is not the split alone. `bf793fd6` is #499's squash merge, and between `76ce7d52` and it `engine/src/stream.ts` (+110) and `engine/test/stream.test.ts` (+414) changed too (dl-125), which is why the counts are 2565 and 2584 where dl-117's own Log has the split leaving 2565 unchanged. The brief allows either arm and no run failed in either, so no result depends on it. The Log's table names the arm "split" and never says what else it carries. **Fix (text):** one sentence naming dl-125's change to `stream.ts`, the code the test drives, and the extra tests.
- **F4 · low** · the Log cannot be re-derived: it holds no per-run ratios, and the 40 live only in the scratch `results.jsonl`. Its "pilot of 3 runs" is 3 recorded runs plus a fourth reading in the pilot's scratch (a base run killed mid-series, 3.455); none is under 3. **Fix (text):** add the per-run ratios in slot order (base 3.438 3.454 3.400 3.464 3.472 3.439 3.425 3.435 3.466 3.431 3.445 3.467 3.449 3.481 3.433 3.447 3.449 3.406 3.441 3.443; split 3.483 3.470 3.478 3.455 3.474 3.469 3.481 3.399 3.504 3.484 3.470 3.487 3.457 3.467 3.492 3.495 3.478 3.504 3.462 3.502) and say 4 pilot readings.
- **dropped** · "(5/6)^40 sets a loaded run's rate against quiet runs, so it excludes nothing": the ticket asked whether the split raised the intrinsic rate, which quiet arms do answer, and the Log's next sentence bounds only "a quiet Linux failure rate". Not a defect.
- **dropped** · "Done when 2 should lower the floor because 2.974 is the lowest ratio recorded": Build step 3 says two clean arms keep 3 and Done when 2's first branch allows it. A product decision, set out below.
- **findings** · the hunt returned 6; 4 carried, 2 dropped.
- Everything checked by arithmetic held: the table, `8483 / 2852 = 2.974`, "367 ms above the slowest run" (366.5), (5/6)^40 = 0.068 %, (15/16)^40 = 7.6 %, 3/40 = 1 in 13.3, the pilot's 3.435, 3.399, 3.458 and the smoke runs' 3.422, 3.455. `test` is `hidden` in `release-please-config.json`; `node scripts/commit-message.mjs --text` on the PR title exits 0; no `DL127` string appears in the branch diff or the head tree; `node scripts/status.mjs --json` exits 0.
- **Open decision (owner, not blocking)** · whether the unexplained 2.97 earns anything further. Options: (1) land as it stands, keep 3, cause stated as unknown, F1's CI record in the Log; costs nothing; a rare red Linux run stays possible. (2) lower the Linux floor to 2.5 on the 2.974 ratio, dl-121's rule applied to a ratio from outside the two arms; stops the red run, loosens a guard that sat 0.4 above every measured run. (3) file a cause-finding ticket; there is no reproduction to attach, so it would wait for a recurrence. Recommended: (1).
- NFR: security n/a · performance n/a · reliability — the 2.97 is unexplained (F1) · maintainability — F2, F4.

## Log

- 2026-10-17 — Filed from dl-117's Log (open decision A, owner's answer
  2026-10-17). Rated standard: the measurement is mechanical and choosing the
  floor from it is a judgement. The reproduction is the failure above, once in
  six whole-project runs on Linux, at 2.97 with `singleMs` 8483 and `splitMs` 2852.
- 2026-10-17 — Owner answer on the run count, after gate 2. Question: "dl-127
  says 'at least eight runs each' with no rationale. What should dl-127 say?"
  Options: twenty a side / builder chooses (and states the number, the cost and
  the failure rate it could and could not have excluded). The owner chose
  **twenty a side** (recommended): state the number as a choice with the
  arithmetic, and let the builder stop early only on a failure in each arm.
  Build step 1 says so.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, med — "dl-127's Build step 1 cannot produce the data its Done when 1 asks for … **Fix:** replace the example with that method: an uncommitted scratch copy (or an uncommitted edit, restored from a commit with `git checkout <sha> -- <path>`) that logs `timing` on every run, never committed."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'uncommitted scratch copy' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, med (run count) — "state the number as a choice with this arithmetic and set twenty a side, and let the builder stop early only on a failure in each arm."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'twenty runs each' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "name the split arm as the squash-merge commit of PR #499 on `main`, or as `76ce7d52` plus the six files and the harness restored from it."
  `sed -n '/^## Build/,/^## Done when/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'squash-merge commit of PR #499' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "cite dl-121's Log record (dl-98's gate 3.450 to 3.476 over 10 quiet Linux runs, 3.25 lowest under load average 10) instead of 'one reading'."
  `sed -n '/^## Why/,/^## Build/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F '3.450 to 3.476' | wc -l` → 1.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "runs 4 to 6 passed; the Log does not say for runs 1 and 2".
  `sed -n '/^## Why/,/^## Build/p' tools/downloader/docs/work/dl-127-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'does not say for runs 1 and 2' | wc -l` → 1.
- 2026-10-17 — Owner answer on when the measurement runs. Question, asked through
  AskUserQuestion: "If dl-127 is in: when does its ~2h10m exclusive measurement
  run?" Options offered: **"Last, after other builds"** (recommended) — dispatch
  it once every other builder and gate in the batch has finished its local
  `npm test` runs, so nothing skews its ratios and it slows nobody else; **"First,
  alone"** — run it before anything else, every other ticket waits about 2 h;
  **"Leave it out"** — not in this batch. Chosen: **"Last, after other builds"**,
  and dl-127 was left out of the batch that recorded this. For whoever schedules
  it: run the two-arm measurement only once no other builder's or gate's local
  test run is active on the machine, and last in its batch. Status is unchanged
  and the measurement has not been run.
- 2026-10-18 — Measured; **the Linux floor stays 3.** Machine: the repo's
  devcontainer on WSL2 (kernel 5.15.90.1), 12 cores, 15 GB, Node 22.23.3; every
  run took the test gate's slot alone with 11 workers. Each run was
  `npm test -- --project downloader` in a detached worktree carrying an
  uncommitted edit that appended `singleMs`, `splitMs` and their ratio to a file;
  the edit was never committed. The two arms alternated, and the starting arm
  alternated too. Before each run the runner waited for 60 s with no `vitest`,
  `test-gate`, `playwright`, `tsc`, `vite build` or `oxlint` process outside the
  two arms (the editor's resident `oxlint --lsp` and Playwright `test-server`
  excepted). It flagged any run that such a process overlapped and repeated it.
  None was flagged. Runs 05:21 to 07:59 UTC, 2026-10-18, after peer session
  tools-01 confirmed it had no local run left.

  | arm                                   | commit     | runs | below 3 | min   | median | max   | `splitMs`    | wall a run       |
  | ------------------------------------- | ---------- | ---- | ------- | ----- | ------ | ----- | ------------ | ---------------- |
  | base (one `browser-resolver.test.ts`) | `76ce7d52` | 20   | 0       | 3.400 | 3.444  | 3.481 | 2426 to 2485 | 280.5 to 285.5 s |
  | split (#499's squash merge)           | `bf793fd6` | 20   | 0       | 3.399 | 3.478  | 3.504 | 2417 to 2475 | 73.4 to 74.8 s   |

  `singleMs` was 8398 to 8539 throughout, so, as the ticket expected, the
  variance is in `splitMs`. Every run passed whole (2565 tests on base, 2584 on
  split). **Build step 4: the split arm did not fail more often.** Neither arm
  failed, and the split's median is the higher of the two. The split arm is not
  the split alone: between `76ce7d52` and `bf793fd6` dl-125 also changed
  `engine/src/stream.ts` (+110), the code this test drives, and added the tests
  behind the 19 extra (`engine/test/stream.test.ts`, `engine/test/helpers/media.ts`).
  `parallel-ranges.test.ts` is identical in both arms. Not counted: a 2026-10-17
  pilot that died mid-series, 4 readings (3.435 and 3.455 base, the second from a
  run killed after this test; 3.399 and 3.458 split), and two single-file smoke
  runs (3.422, 3.455).

  Per-run ratios in slot order. Base: 3.438 3.454 3.400 3.464 3.472 3.439 3.425
  3.435 3.466 3.431 3.445 3.467 3.449 3.481 3.433 3.447 3.449 3.406 3.441 3.443.
  Split: 3.483 3.470 3.478 3.455 3.474 3.469 3.481 3.399 3.504 3.484 3.470 3.487
  3.457 3.467 3.492 3.495 3.478 3.504 3.462 3.502.

  What 40 clean runs can and cannot exclude: at dl-117's one failure in six,
  (5/6)^40 ≈ 0.07 %; at dl-121's Windows rate of one in sixteen,
  (15/16)^40 ≈ 7.6 %. So the 95 % upper bound on a quiet Linux failure rate is
  about 3/40 (one in thirteen), and about 3/20 per arm.

  **The cause of the 2.97 is unknown.** Its `splitMs` of 2852 is 367 ms above
  the slowest four-connection run here. Forty quiet runs did not reproduce it, and
  neither did CPU contention alone: gate 1 pinned this test to 4 cores beside 12
  busy loops (load average 6.5 to 10.8) and got 3.367 to 3.387, `splitMs` +80 to
  +110 ms over idle against the failure's +430. dl-117's run 3 started with the
  test gate's slot free; disk or memory pressure, a WSL2 host stall, and a rare
  outlier at a quiet rate under one in thirteen are not excluded. Keeping 3
  leaves a rare red Linux run possible, as dl-117's option 2 put it. CI has not
  shown one: none of the 12 failed `ci.yml` runs created since 2026-10-06 carries
  `to be greater than or equal to` in its failed log
  (`gh run view <id> --log-failed`). The test's comment now carries the Linux
  numbers.

- 2026-10-18 — Gate 1 (CONCERNS, no high) fixed at landing. The owner was
  away and had authorised taking the recommended choice. Every finding was a
  text fix to this branch's own lines. **F1 (med):** the Log said "Concurrent
  load is the likeliest cause". It now says the cause is unknown, cites the
  gate's CPU-contention reproduction and the 40 quiet runs, and adds the CI
  record, re-run here rather than relayed: 12 failed `ci.yml` runs since
  2026-10-06, 0 with the message. The gate's 480-passing-legs estimate was left
  out as unverified. **F2 (low):** the comment now marks 150 to 405 ms as the
  `windows-latest` figure (dl-121's Log: loaded 2631 to 2854 against quiet
  medians 2449 and 2481). The Linux lines name 12 cores, 11 workers and the
  ~70 ms Linux slowdown (slowest 2485 against 2416 for this test alone).
  **F3 (low):** the split arm's extra dl-125 change is named. **F4 (low):** the
  per-run ratios and the pilot's fourth reading are in. **Open decision,
  resolved by the recommendation:** whether the unexplained 2.97 earns more.
  Options were (1) land, keep 3, cause stated as unknown; (2) set Linux to 2.5
  on the 2.974; (3) file a cause-finding ticket with no reproduction to attach.
  Taken: (1), which costs nothing and is reversible. Choose (2) or (3) later if
  a red Linux run recurs.
