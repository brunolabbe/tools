---
id: dl-117
tool: downloader
title: One 2,153-line browser test file runs serially and is the whole of CI's npm test wall clock
kind: chore
status: done
milestone: null
depends_on: [dl-115]
difficulty: mechanical
---

# dl-117 — Split browser-resolver.test.ts so one file is not the whole run

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

vitest runs the tests in one file in sequence, and spreads files across workers.
`browser-resolver.test.ts` was 620 s of a 623 s `npm test` on CI. The 258 other
files finished in parallel long before it did. Once dl-111, dl-113, dl-114 and
dl-115 have removed what they can, about 140 to 200 s of serial probes will
remain (inferred). That is still the run's floor.

**The owner chose (2026-10-12)** to split the file. A split adds no workers: the
same pool simply stops idling while one worker runs a long file. The CI-only
worker count is [repo-99](../../../../docs/work/repo-99-ci-runs-vitest-on-three-workers-for-a-wait-bound-suite.md).
This ticket depends on dl-115 because every earlier ticket in this batch edits
the same file, and splitting it first would make each of them a conflict.

## Build

1. **Split along the existing top-level `describe` blocks** into four to six
   files in `resolvers/test/browser/`. Balance them by measured duration, not by
   line count. Name each file for what it covers (for example consent,
   departure guard, shadow root and frames, player box, empty floor).
2. **Move the shared setup into a helper** under `test/browser/helpers/`: the
   fixture server and the `BrowserPool({ maxConcurrent: 1 })` started in
   `beforeAll` and closed in `afterAll`, plus `options`, `probe`, `probeError`
   and `expectCode`. Each file still owns its own pool and server, so a failure
   in one file cannot orphan another file's Chromium.
3. **Move code, not tests.** No test is renamed, merged or changed here. The
   diff for each test body should be a pure move: check it with
   `git diff --color-moved`.
4. **Watch the timing-sensitive files** when they run beside each other: the
   dl-80 empty floor, dl-105's clock, dl-81's input. Run the whole downloader
   project three times locally and note any test whose duration moves by more
   than 20 %.

## Done when

1. The test count for the browser files is the same before and after (vitest's
   `Tests` line for `--project downloader`), and every moved test body is
   unchanged by `--color-moved`.
2. No browser test file takes more than about a quarter of the old file's
   post-trim duration.
3. `npm test -- --project downloader` passes three times in a row locally.
   CI's `npm test` duration, before and after, is in the Log.

## Review

**Gate: CONCERNS** — 2026-10-17 · `76ce7d5..17adad5` · Sonnet 5.5, narrow (ticket is `mechanical`: the named attacks and the acceptance table, no full invariant sweep)

The ticket's own `## Log` was read last. Acceptance is graded as the dispatch set it: Done when 2 from per-file durations plus CI's numbers, Done when 3 as three consecutive local passes with CI before/after in the Log or listed unverified.

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Test count for the browser files is the same before and after, and every moved test body is unchanged by `--color-moved` | **verified.** `vitest list --json` on the base file (copied into the tree, removed after) against the six new files: 124 of 124 full names equal as multisets, 0 missing, 0 added. A parse of every `test(...)`, `it(...)` and `test.each(...)(...)` statement (96 of 96, the `.each` ones expanding to the 124 names) is identical to the base once indentation is stripped, 0 mismatches. `git diff 76ce7d5 17adad5 --color-moved=zebra --color-moved-ws=ignore-all-space` over the test directory leaves 245 of 4,586 lines unpaired (212 added, 33 removed), all of them the old header, imports and helpers or the new headers, imports, wrappers and harness — no test-body line. No `.skip`, `.only`, `.todo`, `.fails` or `.concurrent` in the six files or the harness. Not re-run: the project-wide `Tests` line (the Log's 2,565 passed, 2 skipped on both sides) — there is no like-for-like base in CI. |
| 2. No browser test file takes more than about a quarter of the old file's post-trim duration                                | **verified.** CI: the old `browser-resolver.test.ts` took 284.7 s in a pre-split `ubuntu-latest` run (lg-10, a branch holding dl-115 and not dl-117); at 17adad5 the six files took 52.7, 50.4, 49.3, 44.6, 42.7 and 41.0 s, the largest 18.5 % of the old file (a quarter is 71 s). Local, gate run 2 of the six files: 54.7, 52.2, 51.3, 47.3, 44.3 and 41.8 s, the largest 18.6 % of the Log's recorded 294 s base. Two further runs beside `parallel-ranges.test.ts`: largest 57.7 s and 56.8 s. Gate run 1 (cold start, F2) peaked at 78.4 s, 26.7 % of 294 s.                                                                                                                                                                                                                                                                                                                                                  |
| 3. `npm test -- --project downloader` passes three times in a row locally; CI's duration, before and after, is in the Log   | **unproven (scope)** for the three whole-project runs: the dispatch forbade running the downloader project three times on the shared machine. Run instead: the six files four times (run 1: 3 of 124 failed, F2; run 2: 124 of 124; two runs with `parallel-ranges.test.ts`: 167 of 167 each). The Log records runs 4 to 6 passing after run 3 failed in `parallel-ranges.test.ts` (open decision A). CI clause: the Log lists the after as unverified, which the dispatch accepts, but its before figure is the wrong baseline (F1); the leg has since finished green at 17adad5, so the numbers exist.                                                                                                                                                                                                                                                                                                             |

- **med** · Done when 3 depends on it, fix stated, may land without a re-gate (F1) · The Log's CI paragraph gives "Before: 623 s" and "After: unverified". 623 s is the audit's figure from before dl-111, dl-113, dl-114 and dl-115 merged, so it is not this change's before. Measured, both from the runs' own jobs and logs: `ubuntu-latest` `npm test` was 307 s in run 38979599628 (lg-10, job 117237128243; vitest `Duration` 305.7 s) and 307 s in run 38979170308 (dl-125, job 117235755795), against 325 s in run 38980295983 at 17adad5 (job 117239451601; `Duration` 323.7 s). `windows-latest` (informational) 477 s and 489 s before, 418 s after. The base commit's own push run (38976257518) skipped its test matrix as docs-only and is no baseline. So the split moved the ubuntu leg from 307 s to 325 s, not from 623 s to 325 s, which is what a reader of the Log would take away. The ticket predicted a null result: it says a split adds no workers, and repo-99 (depends on this ticket) is where the worker count changes. **Fix:** replace the Log's CI paragraph with these numbers and ids, and say the 623 s predates the trims. A false baseline in a record, and the direction is flattering.
- **med** · no `Done when` line depends on it; recorded (F2) · Six files now start six Chromiums in the same seconds. In gate run 1, the first Chromium use in this tree after several idle minutes, the first probe of every one of the six files took 26.1 to 26.4 s (`starts the real player and never reaches the card's own page or stream` 26,203 ms; `captures the master playlist behind an MSE blob: player` 26,390 ms; and so on), against 2.2 to 2.4 s in run 2 and about 2 s in CI. Three of the six exceeded the 25 s `PROBE_TIMEOUT_MS` and failed with `TIMEOUT: The page was still loading when the time budget ran out.`: `browser-resolver-age-gate.test.ts` › "closes the modal through its close control and, told to confirm ages, finds the stream", `browser-resolver-consent-and-links.test.ts` › "a dl-48 gate built as a link whose script cancels it is pressed, and yields its stream", `browser-resolver-player-input.test.ts` › "a player injected on the first wheel is reached from a bare poster". Reproduction: `npx vitest run --project downloader --reporter=default tools/downloader/resolvers/test/browser/browser-resolver-` on a machine that has not launched Chromium for several minutes. Cause inferred (a cold Chromium start, six at once); not measured: the base file's first probe under the same cold start, and how often it recurs (1 of 4 six-file runs here; the Log's six whole-project runs show none). The old file paid one cold start per run, so the exposure is 6x on the one condition where the 25 s budget is already tight. CI is not exposed. See open decision B.
- **low** · `nfr:maintainability` · The Log says "the brief's list of nine docs was incomplete" and names `reference/history.md` as "the brief's own bar". The ticket's brief has no list of docs; both phrases refer to the dispatch prompt. The Log also counts 196 lines naming the old file in 39 files; `git grep` at 17adad5 gives 199 in 39 (the Log's own lines are among them). False in the safe direction, nothing relies on either.
- **open decision A** (carried from the Log; the Log's entry is the options, so this restates it for the agent that can ask) · `engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4 connections and finishes at least 3x faster" failed once in the builder's six whole-project runs with `expected 2.9741046875533983 to be greater than or equal to 3` (`singleMs` 8483, `splitMs` 2852; 8483/2852 reproduces it). Neither file changed on this branch. The test's own comment records Windows at 2.91 to 3.00 beside the suite and a 3 floor kept for Linux (dl-121). Whether the split raised the Linux failure rate is not established: the base arm is one run. Gate measurement: the test passed 2 of 2 beside the six files (seven-file runs); that is not the whole-suite load. Options, recommended first: (1) a new `dl-` ticket that measures the Linux ratio beside the full suite, with a base arm, and sets the floor from that; (2) keep 3x and accept a rare red local run; (3) set Linux to 2.5 now on dl-121's reasoning. This ticket moves code only and should not change the threshold.
- **open decision B** · F2 above. Options, recommended first: (1) record it, change nothing here (a pure move; CI is unaffected); (2) a follow-up ticket that measures a cold start with the base file and the split side by side and decides between a pool warm-up in each file's `beforeAll` and a longer first-probe budget. Neither belongs in this diff.
- **verified, not a finding** · attack 5: `scripts/citations.mjs` is gone from `main`; `git log --diff-filter=D -- scripts/citations.mjs` names 3a7d8a9f (#350). `ci.yml` runs `check-lockfile-sync`, `npm run check`, `status.mjs --json`, `status.test.ts` and `npm test`; its only mention of the checker is a comment, and nothing under `scripts/`, `.github/` or `package.json` names the old test file. `git grep -o` finds 34 `file:line` pins into it at 17adad5: dl-55 20, dl-61 10, dl-68 3, dl-105 1, as the Log says. Nothing on `main` checks them, so no CI step fails on the dangling pins; the Log's old-to-new line map is the only conversion, and the tickets are not edited.
- **dropped** · `vi.mock` of `provoke.ts` now applies to one file instead of six: the mock passes every call through to the original and only records `minWaitMs`, and only the dl-115 tests read the record, so no behaviour moves. Not a defect.
- **dropped** · `afterAll` calling `pool.close()` on an undefined pool when `beforeAll` throws: the base did the same. Not introduced here.
- **dropped** · a test hitting another file's server or a closed one (attack 1): every file declares its own module-level `server` and `pool`, assigns them in its own `beforeAll` and closes them in its own `afterAll`; `probes(() => server)` reads the file's variable at call time; the dl-78 progressive server is created and closed inside its own `describe` in the capture file. Fixture servers listen on port 0, the pool is built with an explicit `maxConcurrent`, and nothing in the six files touches `process.env`, a temp directory or a fixed port. The only shared resource found is the cold Chromium start (F2).
- **findings** · the hunt returned 7; 4 carried (F1, F2, the low, open decision A; B is F2's decision), 3 dropped.
- NFR: security n/a (tests only) · performance — ubuntu `npm test` 307 s before, 325 s after (F1); the structural aim is met (no file above 19 % of the old one), the wall clock waits on repo-99 · reliability — F2 and decision A · maintainability — a shared harness and six files named for what they cover; `probes(() => server)` is a getter closure and says why in its comment.

## Log

- 2026-10-12 — Filed from the suite-speed audit. Rated mechanical: the split
  follows existing `describe` boundaries and moves code only.
- 2026-10-16 — Built on `dl-117-split-browser-test` from `origin/main` 76ce7d52,
  by a builder agent (Claude Haiku 5.5). `dl-115` (8f9d8efc) had merged, so the
  split went ahead. **The brief was stale on one number:** the file was 2,153
  lines, not 2,400; the title says so now.

  **What moved.** `browser-resolver.test.ts` is gone, replaced by six files in
  `resolvers/test/browser/` and one helper, `helpers/browser-harness.ts`. The
  helper reuses the existing `helpers/fixture-server.ts`. Old line ranges, for
  anyone resolving a pin into the old file:

  | old lines                                                            | new file                                                  | tests |
  | -------------------------------------------------------------------- | --------------------------------------------------------- | ----- |
  | 119–276, 996–1064, 1067–1177, 1179–1251, 1253–1328, 2067–2084        | `browser-resolver-capture.test.ts`                        | 25    |
  | 277–461, 1549–1613, 1977–2065, 2086–2153, and the `vi.mock` at 32–45 | `browser-resolver-departure-and-floor.test.ts`            | 17    |
  | 463–602, 604–726                                                     | `browser-resolver-age-gate.test.ts`                       | 16    |
  | 728–883, 1876–1975                                                   | `browser-resolver-press-targets.test.ts`                  | 22    |
  | 885–993, 1330–1547                                                   | `browser-resolver-consent-and-links.test.ts`              | 22    |
  | 1615–1874                                                            | `browser-resolver-player-input.test.ts`                   | 22    |
  | 1–117                                                                | `helpers/browser-harness.ts`, and each file's setup block | —     |

  Each file keeps its own `BrowserPool({ maxConcurrent: 1 })` and fixture server,
  started in `beforeAll` and closed in `afterAll`. Test names keep their full
  paths (each file keeps the `describe("BrowserResolver")` wrapper where its tests
  had one), so `-t` filters still match.

  **One deviation from Build step 2.** `probe` and `probeError` cannot close over
  a `let server` assigned in another module, so the helper builds them with
  `probes(() => server)` and each file calls `const { probe, probeError } =
probes(() => server)`. The bodies are otherwise the same. The `vi.mock` that
  records `minWaitMs` (dl-115) moved with the only test that reads it.

  **Move check, Done when 1.** Commands, run from the worktree:
  - `git diff --cached --color-moved=zebra --color-moved-ws=ignore-all-space`,
    classified by a script that counts changed lines git did not pair as moved.
    Unpaired new lines are the imports, the wrappers, the shared setup and the
    new doc comments. Unpaired removed lines are the old header and the helpers
    now in `browser-harness.ts`. No test-body line is unpaired. With exact
    whitespace the only other unpaired lines are the `probe`/`probeError` bodies,
    which read the server through the getter.
  - `npx vitest list --project downloader` on the six files: 124 entries. The
    names match the base run's JSON report exactly: 124 of 124, 0 mismatches.
  - Base and after `Tests` lines, the same on every run: base
    `Test Files 119 passed | 1 skipped (120)` and `Tests 2565 passed | 2 skipped
(2567)`; after `Test Files 124 passed | 1 skipped (125)` and the same
    `Tests` line.
  - `npm run typecheck`: exit 0. `npm run check`: exit 0.

  **Durations, Done when 2.** Base is one `npm test -- --project downloader`
  run at 76ce7d52 with `--reporter=json`: `browser-resolver.test.ts` 294 s,
  124 tests. A quarter of that is 73.5 s. The six after runs, per file in
  seconds (`endTime - startTime` from the JSON report):

  | file                                           | tests | runs 1–6               |
  | ---------------------------------------------- | ----- | ---------------------- |
  | `browser-resolver-press-targets.test.ts`       | 22    | 55, 55, 57, 52, 52, 52 |
  | `browser-resolver-consent-and-links.test.ts`   | 22    | 53, 51, 53, 53, 55, 52 |
  | `browser-resolver-player-input.test.ts`        | 22    | 53, 51, 53, 51, 51, 47 |
  | `browser-resolver-age-gate.test.ts`            | 16    | 45, 45, 47, 46, 44, 47 |
  | `browser-resolver-capture.test.ts`             | 25    | 45, 44, 47, 46, 42, 41 |
  | `browser-resolver-departure-and-floor.test.ts` | 17    | 42, 40, 46, 44, 40, 41 |

  The largest file is 57 s, 19 % of the base file, so the line holds. The
  longest file in the project is now `parallel-ranges.test.ts`, at 64–73 s.
  Project wall clock, from each run's `Duration` line: base 297.9 s (default
  reporter) and 325.7 s (JSON reporter); after 130.9, 78.6, 83.7, 87.6, 81.6 and
  73.3 s.

  **Done when 3, three runs in a row.** `npm test -- --project downloader`:
  runs 4, 5 and 6 each passed, `Tests 2565 passed | 2 skipped (2567)`. Run 3
  failed: `tools/downloader/engine/test/parallel-ranges.test.ts` > "dl-98: a
  progressive source throttled per connection" > "a job that measures slow
  switches to 4 connections and finishes at least 3x faster", with
  `expected 2.9741046875533983 to be greater than or equal to 3`
  (`singleMs` 8483, `splitMs` 2852). It is not a browser file, and it is not
  touched by this diff. Its own comment (lines 485–491) says that beside the rest
  of the suite the split run slows on Linux, and only Windows has the 2.5 floor
  (dl-121). **Open decision, not fixed here:** this ticket moves code only, so
  the threshold is not changed. Options for the owner, recommended first: (1) a
  new `dl-` ticket that measures the Linux ratio beside the suite and sets the
  floor from that measurement; (2) keep 3x and accept a rare red run on Linux; (3)
  set Linux to 2.5 like Windows, now, on dl-121's reasoning.

  **Test gate.** Every measured run printed `1 of 2 runs active ... 11 workers`
  at start. Another worktree (`agent-a6bf…`) held slot 0 until about 22:55, before
  run 1, and I waited for it. Another worktree (`agent-ac4e…`) took slot 1 at
  23:02:46 and overlapped the last ~20 s of run 4. Run 3 started with the slot
  free, and no second holder was in the gate when I next looked, at 23:02:46.
  Apart from that overlap, I saw no second gated run while runs 1–6 were going;
  I looked only at their start and end, not throughout.

  **Per-test movement, Build step 4.** Against the one base run, 58 of the 117
  tests that took at least 1 s moved by more than 20 % in some after run. The
  four after runs alone already differed by more than 20 % in 56 of 117, so most
  of that is run-to-run noise on this machine. Seven tests moved more than 20 %
  in the same direction in all four runs, and I read that as the base sample
  rather than the split: six faster (mostly age-gate tests, whose bodies did not
  change), one slower. The timing-sensitive tests named in the brief held:
  the dl-80 floor tests (6434 ms base, 6366–6632 ms after; 4017 ms, 4012–4022 ms)
  and dl-105's clock test (4667 ms, 4560–4672 ms) stayed within 3 % of base in
  every run. The dl-81 input tests carry most of the single-run spikes, up to
  2.3x in one run (`a scripted play() run there does not play an ad`, 2463 ms
  base, 4383 ms in run 3).

  **Citations.** `scripts/citations.mjs` no longer exists. `3a7d8a9f` (#350,
  2026-10-03, ADR 006) deleted it and its gate from `main`, so there was no
  citations check to run, and nothing reports. The dispatch's list of nine docs was
  incomplete. `git grep` finds 39 files, this ticket included, with 199 lines
  (at 17adad5, counted by the gate) naming `browser-resolver.test.ts`. Of those lines, 17 carry 34 `file:line` pins
  into the old file (dl-55: 20, dl-61: 10, dl-68: 3, dl-105: 1), and 29 are `-t`
  commands naming the old path. The rest name the file in prose. The pins now
  resolve to nothing; the map above converts them. Not edited: the finished
  tickets (preflight refuses edits to a `done` ticket with no `## Review`), and
  `reference/history.md` (the dispatch's own bar).

  **Fold-in.** Nothing else was made free. `repo-99` depends on this ticket and
  holds the CI worker count; that is a `repo-` change with its own measurement
  and is not folded. `dl-49` and `dl-125` are unrelated.

  **CI duration, Done when 3.** Corrected in place on 2026-10-17 after gate 1;
  the builder's paragraph gave "Before: 623 s" and "After: unverified". The
  623 s is the audit's figure from before dl-111, dl-113, dl-114 and dl-115
  merged, so it predates the trims and is not this change's before. Measured
  from the runs' own jobs (`gh run view --json jobs`, the `Run npm test` step;
  the job id of run 38980295983 re-checked for this edit):

  | leg                              | before (no split)                                                                                                              | after, at 17adad5 (run 38980295983, job 117239451601) |
  | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
  | `ubuntu-latest` `npm test`       | 307 s: run 38979599628 (lg-10, job 117237128243; vitest `Duration` 305.7 s), 307 s: run 38979170308 (dl-125, job 117235755795) | 325 s (`Duration` 323.7 s)                            |
  | `windows-latest` (informational) | 477 s and 489 s                                                                                                                | 418 s                                                 |

  The base commit's own push run (38976257518) skipped its test matrix as
  docs-only and is no baseline. So the ubuntu leg went from 307 s to 325 s, not
  from 623 s to 325 s. That is the null result the Why section predicted: a split
  adds no workers, and the CI worker count is repo-99, which depends on this
  ticket.

- 2026-10-17 — Owner answers to the open decisions above, recorded after gate 1.
  The one in-place correction made then is the CI paragraph above, plus the
  "dispatch" wording and the 199-line count in **Citations**; this entry is
  appended.

  **A. `parallel-ranges` "at least 3x faster" failed once locally on Linux at
  2.97x, beside the full suite.** This ticket did not touch that file, and it is
  not known whether the split made the failure likelier. Options were: file a
  `dl-` ticket / keep 3x / set Linux to 2.5 now. The owner chose **file a `dl-`
  ticket**, the builder's and the gate's recommendation. Filed as
  [dl-127](./dl-127-parallel-ranges-3x-floor-on-linux-beside-the-suite.md), in
  this branch, as its own commit.

  **B. Cold Chromium start.** Six files start six Chromiums at once. On a cold
  machine 3 of 124 tests hit the 25 s `PROBE_TIMEOUT_MS` in 1 of 4 six-file
  runs (gate 1, F2; the cause, a cold Chromium start, is inferred and not
  measured, and two of those four runs also ran `parallel-ranges.test.ts` as a
  seventh file); CI is unaffected. Options were: record only, or a follow-up
  ticket comparing a cold start on the base file and the split (a pool warm-up
  in each `beforeAll`, or a longer first-probe budget). The owner chose **record
  only, file neither** (recommended). Nothing is filed; the reproduction is gate
  1's F2: `npx vitest run --project downloader --reporter=default
tools/downloader/resolvers/test/browser/browser-resolver-` on a machine that
  has not launched Chromium for several minutes.

  **The 34 old `file:line` pins** into `browser-resolver.test.ts` (dl-55: 20,
  dl-61: 10, dl-68: 3, dl-105: 1). The owner chose **record only, file
  neither** (the recommended option). The old-to-new map in the 2026-10-16 entry
  is the only conversion; nothing on `main` checks the pins.

- 2026-10-17 — Fixed at landing by owner choice: gate 2, low — "the dl-117 Log's B entry says 'On a cold machine 3 of 124 tests hit the 25 s `PROBE_TIMEOUT_MS`'. Gate 1 gave the cold start as an inferred cause, not measured, and two of the four runs it counts also ran `parallel-ranges.test.ts` as a seventh file."
  `sed -n '/^- 2026-10-17 — Owner answers/,/^- 2026-10-17 — Fixed/p' tools/downloader/docs/work/dl-117-*.md | tr '\n' ' ' | tr -s ' ' | grep -o -F 'is inferred and not measured' | wc -l` → 1.
