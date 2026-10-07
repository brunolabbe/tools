---
id: dl-95
tool: downloader
title: Two of dl-80's wall-clock ceilings flake on a slow Windows runner
kind: fix
status: done
milestone: null
depends_on: [dl-80]
---

# dl-95 — dl-80's wall-clock ceilings flake on a slow Windows runner

## Why

dl-80 added a describe block to
`resolvers/test/browser/browser-resolver.test.ts` that times real probes against
the fixture server. Two of its ceilings sat close to what a Windows CI runner
actually takes:

- "the empty floor is overridable to allow tests to run quickly" asserted
  `elapsedMs < 3000` for a probe that usually takes ~2.1 s.
- "a page whose media arrives early still uses the standard quiet timeout"
  asserted `elapsedMs < 5000` for a probe that usually takes ~2.8 s.

**Reproduction:** the `test (windows-latest, informational)` leg of #337
(`chore(ledger): release 0.1.0`) at `155c4039`, CI run 37550384344, job
112564550982, failed with `AssertionError: expected 3257 to be less than 3000`.
That pull request touches no downloader code. The leg is informational, so the
run's conclusion still read `success`. The same run slowed the other test to
4470 ms, 530 ms short of its own ceiling.

Measured on four of the ten Windows runs since dl-80 merged (milliseconds).
The six left out all fall in the normal band, two of them started in the same
minute as the slow run, so the slowdown was one runner, once in ten:

| Run                    | overridable | arrives early | attaches after 6 s |
| ---------------------- | ----------- | ------------- | ------------------ |
| Windows, main 10529a84 | 2101        | 2743          | 7377               |
| Windows, main 829e7ff3 | 2183        | 2819          | 7521               |
| Windows, #337 fec02820 | 2169        | 2842          | 7376               |
| Windows, #337 155c4039 | **3261 ✗**  | 4470          | 7533               |
| Ubuntu, #337 155c4039  | 2108        | 2735          | 7345               |

The slow run added 1.1 s to one probe and 1.6 s to the other. The
6-second-attach test was not slowed. It has 2 s of margin under its 9500 ms
ceiling on a normal run, but only about 0.35 s if it is ever slowed by the same
1.6 s. It is left alone: the failure it guards ends near 11 s, so a higher
ceiling buys little. If it flakes, that is this shape again, not a new defect.

## Build

Each ceiling only has to rule out a 9 s floor being applied where it should not
be. The test before them in the block asserts that such a wait ends at or after
9000 ms, and the measured result is about 10.7 s. Raise both ceilings to
7000 ms. That keeps ~3.7 s clear of the failure each test exists to catch and
leaves ~2.5 s of headroom over the slowest run observed. Rewrite the comments to
say so.

## Done when

- Both tests assert `elapsedMs < 7000`, and each comment says what its
  ceiling must rule out.
- Each ceiling still fails when its behaviour breaks: removing the
  `emptyMinWaitMs: 500` override, and applying the empty floor regardless of
  `hasPlayableHit()` in `provoke.ts`, both fail the test they guard.
- `npm run check` passes.

## Review

**Gate: PASS** — 2026-10-07 · `1aece87..ac78535` · Sonnet 5.5, depth narrow

The dispatch sized this gate to a test-only change: the acceptance lines, the premise behind 7000 ms, the 9500 ms ceiling, the ticket's factual claims and the title convention, and the other wall-clock ceilings dl-80 added. Every number below was measured by the gate on the head tree or read from the job logs named, not taken from the Log. The tree was farmed and built after detaching at the head, and every run used a private `TMPDIR`.

| Done when                                                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both tests assert `elapsedMs < 7000`, and each comment says what its ceiling must rule out                                                                                                                    | **proven** — `resolvers/test/browser/browser-resolver.test.ts` › "Empty media floor…" › "a page whose media arrives early still uses the standard quiet timeout" and › "the empty floor is overridable to allow tests to run quickly" each end in `expect(elapsedMs).toBeLessThan(7000)`. The diff changes only those two numbers and their comments (17 lines, one test file, no test added or removed). Both comments name what the ceiling rules out (a floor applied anyway, an ignored override, each ending at or after 9000 ms). Block run at the head: `Tests 5 passed \| 133 skipped (138)`; the two tests took 2800 ms and 2210 ms. |
| Each ceiling still fails when its behaviour breaks: removing the `emptyMinWaitMs: 500` override, and applying the empty floor regardless of `hasPlayableHit()` in `provoke.ts`, both fail the test they guard | **verified** — the gate planted each mutation **alone** and reverted it (`git status --short` empty after each). Nothing on the branch asserts this; the mutation check is the proof. Table below.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run check` passes                                                                                                                                                                                        | **verified** — `npm run check` at the head, exit 0, in the gate's worktree. The PR's two `check` jobs also passed on this head. The unit-test legs (`test (ubuntu-latest)`, `test (windows-latest, informational)`) were still pending when read, so nothing here rests on them.                                                                                                                                                                                                                                                                                                                                                              |

Mutation check, each run as `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "Empty media floor"`:

| Mutation, alone                                                                                                                  | Failed                                                                                                                    | Still green                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| none (positive control: the harness runs and the block can pass)                                                                 | —                                                                                                                         | all 5 (`5 passed \| 133 skipped (138)`)                                                                 |
| A: delete `emptyMinWaitMs: 500` from the "overridable" test's resolver                                                           | "overridable": `expected 10624 to be less than 7000`                                                                      | the other 4 (`1 failed \| 4 passed`); "arrives early" stayed at 3118 ms                                 |
| B: `waitForQuiet` in `resolvers/src/browser/provoke.ts` computes `effectiveMinWaitMs` from `false` instead of `hasPlayableHit()` | "arrives early": `expected 10680 to be less than 7000`; "attaches after 6 seconds": `expected 11033 to be less than 9500` | the other 3 (`2 failed \| 3 passed`); "overridable" stayed at 2507 ms since its floor is 500 either way |

Each mutation fails only the test or tests it should, so the Log's "each failure comes from its own mutation" holds. The Log ran the two together; run alone they separate cleanly, and the 6-second-attach test failing under B is correct. The measured failures (10.6 to 11.0 s) agree with the Build's "about 10.7 s".

CI on the head: `gh pr checks 383` read `check` ×2, `changes`, `codeql`, `CodeQL`, `dependency-review`, `docker`, `e2e (direct)` and `e2e (sniffer)` as pass. The two `test` legs were pending.

### Premise

The ticket rests on one CI failure. Its job log was read with `gh run view 37550384344 --job 112564550982 --log`: `AssertionError: expected 3257 to be less than 3000`, and the reporter lines for the same file read 7533 ms, 4470 ms and 3261 ms for the three tests. The run's conclusion is `success` with the Windows job `failure`, as the Why says. The pull request it names, #337, touches `.release-please-manifest.json`, `package-lock.json` and four `tools/ledger` files, no downloader code.

All fifteen figures in the ticket's table were re-read from the job logs of the four named runs plus the Ubuntu job of the slow run, and each matches (the Windows rows are 7377/2743/2101, 7521/2819/2183, 7376/2842/2169 and 7533/4470/3261 for the three tests; Ubuntu is 7345/2735/2108). The 3257 versus 3261 pair is the assertion's `elapsedMs` against the reporter's test duration, four milliseconds apart by construction.

**Is 7000 right.** Yes. The failure each ceiling guards is a 9000 ms floor applied where it should not be. `waitForQuiet` cannot return before the floor has elapsed, so that failure ends at 9000 ms plus the 1.5 to 1.7 s the probe spends before the wait starts, and the gate measured 10624 ms and 10680 ms. A ceiling anywhere between the slowest passing run (4470 ms) and 9000 ms discriminates, and 7000 sits 2.5 s above the former and 3.6 s below the measured failure. The Build's arithmetic (about 3.7 s and about 2.5 s) reproduces.

**The 9500 ms ceiling.** Safe to leave on the evidence, with a thinner margin than the ticket says; see the second finding.

### Findings

- **low** · no `Done when` line depends on it · `nfr:maintainability` · The Why says the table is "every recent run that reached the block". It is four of at least ten Windows runs since dl-80 merged. Six more exist, all inside the normal band: the downloader and planner release-PR runs created at the same minute as the slow one (7418/2750/2120 and 7460/2794/2169), two `dl-83` pull-request runs (7437/2726/2119 and 7448/2759/2140), and the two earlier release-PR runs, at the minute dl-80 merged (7437/2858/2261 and 7392/2733/2109). Found with `gh run list --workflow ci.yml` and the six Windows job logs. Two of those ran concurrently with the slow one and were not slow, so the slowdown was one runner, once in ten. That supports the ticket's reading as a flake and does not change 7000, but it means the figure rests on a single outlier. **Fixed** in the same PR: the Why now says four of the ten, and why the other six were left out.

- **low** · no `Done when` line depends on it · The Why's "keeps 2 s of margin under its 9500 ms ceiling" is true of the run observed (7533 ms), not of a slow run. The same run added 1.1 s and 1.6 s to the other two probes; the same 1.6 s on the 6-second-attach test would end near 9.1 s, about 0.35 s under the ceiling. Across 11 Windows and Ubuntu observations it ran 7345 to 7533 ms, and it was not slowed in the one slow run, so there is no live failure. The window is narrow by construction: a floor that never drops after the media arrives ends at 11033 ms here, so a ceiling much above 9500 buys little margin against that. **Fixed** in the Why, which now gives both margins and says a flake here is this shape again. The ceiling is left at 9500.

- **low** · no `Done when` line depends on it · `nfr:reliability` · The other wall-clock ceilings dl-80 added, enumerated against the population that exists: in the block, `< shortTimeoutMs - teardownReserveMs` (16000 ms) against 10.5 to 10.8 s measured in CI, and `< timeoutMs` (8000 ms) against 4.0 s; the `>= 9000` assertion is a floor and only a slower runner raises it. In `resolvers/test/browser/wait-for-quiet.test.ts`, two `toBeLessThan(1000)` against 303 ms and 201 ms measured locally, about 0.7 to 0.8 s of margin, and that file's total in five CI logs read 1510 to 1553 ms, 1553 on the slow run, so the slowdown never reached it (pure timers, no browser). No other test in the downloader `e2e` or resolver `test` directories asserts an elapsed ceiling. Nothing has failed; the 0.7 s margin is the same shape as the one this ticket repairs, on a different cause (event-loop stall rather than a slow page). **Left**: filed only if one of them flakes.

- **dropped** · the ticket's 3257, 3261 and 4470 read as inconsistent: they are the assertion's `elapsedMs` and the reporter's duration for different tests, within 4 ms for the one test that has both. Not a defect.
- **dropped** · the Log's mutation check "ran both together" as a weakness: run alone each mutation gives the same verdicts (above). The claim holds.
- **dropped** · frontmatter `title` differing from the ticket's H1: the repo's other tickets (dl-80) do the same, and `npm run status -- --show dl-95` parses it (exit 0).
- **findings** · the hunt returned 6; 3 carried (all low), 3 dropped.

Not verified: the Log's account of the owner's choice, of the "~6000 ms" proposed when the decision was asked, and that 4470 ms was measured after the question. Nothing in the repo or the CI logs holds them. The whole spec file and the downloader project were not run; the block, `wait-for-quiet.test.ts` and `npm run check` were.

Title and release: `node scripts/commit-message.mjs --text "test(downloader): widen two dl-80 timing ceilings a slow Windows runner broke (dl-95)"` exits 0, and PR #383's title is the same text. `release-please-config.json` lists `{ "type": "test", "section": "Tests", "hidden": true }`, so the squash lands no changelog line even though its path is under `tools/downloader`.

Invariants: only the style rules could apply to a test-only change of two numbers and comments (no new imports, no `any`, no `console`); the rest skipped. No test file or tsconfig reference added.

NFR: security n/a · performance n/a (test ceilings only; no runtime path, suite time unchanged) · reliability ✓ (the flake is removed and each ceiling still discriminates, above) · maintainability ✓ (each comment says what the ceiling rules out; the first finding is the one wording fix).

## Log

**2026-10-07**: Filed and fixed in one branch, at the owner's choice when #337's
Windows leg failed. Ceilings raised to 7000 ms, a little above the "~6000 ms"
proposed when the decision was asked. The second test's 4470 ms was measured
after the question, and 6000 would have left that test 1.5 s of headroom
against a slowdown already seen at 1.6 s.

Mutation check, run locally on both mutations together: removing the
override, and replacing `options.collector.hasPlayableHit()` with `false` in
`waitForQuiet`. "overridable" failed at 10816 ms against 7000 and "arrives
early" at 10764 ms against 7000. Each failure comes from its own mutation. With
the override removed, a no-media page takes the 9 s default whichever branch
runs. The media page is only slowed by the `provoke.ts` change. The
6-second-attach test also failed, at 10905 ms against 9500, as it should. With
both mutations restored, the block's five tests pass.

Gate 1 (Sonnet) passed with three low findings. The two wording fixes are folded into the Why, and the third is left as recorded under Review. The gate also ran each mutation alone, which confirms the attribution above.
