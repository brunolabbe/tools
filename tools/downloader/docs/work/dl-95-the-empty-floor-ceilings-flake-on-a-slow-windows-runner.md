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

Measured on every recent run that reached the block (milliseconds):

| Run                    | overridable | arrives early | attaches after 6 s |
| ---------------------- | ----------- | ------------- | ------------------ |
| Windows, main 10529a84 | 2101        | 2743          | 7377               |
| Windows, main 829e7ff3 | 2183        | 2819          | 7521               |
| Windows, #337 fec02820 | 2169        | 2842          | 7376               |
| Windows, #337 155c4039 | **3261 ✗**  | 4470          | 7533               |
| Ubuntu, #337 155c4039  | 2108        | 2735          | 7345               |

The slow run added 1.1 s to one probe and 1.6 s to the other. The
6-second-attach test was not slowed and keeps 2 s of margin under its 9500 ms
ceiling. It is left alone.

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
