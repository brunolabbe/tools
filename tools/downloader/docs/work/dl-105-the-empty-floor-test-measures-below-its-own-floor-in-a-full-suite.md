---
id: dl-105
tool: downloader
title: dl-80's empty-floor test reads elapsed time below its 9000 ms floor in a full suite
kind: fix
status: ready
milestone: null
depends_on: [dl-80]
difficulty: standard
---

# dl-105 — The empty-floor test measures below its own floor in a full suite

## Why

dl-80's test "a page with no media respects the empty floor and the deadline" in
`resolvers/test/browser/browser-resolver.test.ts` (describe block "Empty media
floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80)")
asserts `expect(elapsedMs).toBeGreaterThanOrEqual(9000)` after a probe built with
`emptyMinWaitMs: 9000`. It has twice failed with an elapsed time **below** the
floor, both times in a full-suite run; it passes alone:

1. dl-90's first build, `npm test -- --project downloader` inside
   `node scripts/preflight.mjs`, on 2026-10-10. The preflight log
   (`dl-90/build/preflight.log` in the orchestrator's scratch, not committed)
   reads:

   ```
   FAIL  |downloader| tools/downloader/resolvers/test/browser/browser-resolver.test.ts > Empty media floor: pages with delayed players wait longer before NO_MEDIA_FOUND (dl-80) > a page with no media respects the empty floor and the deadline
   AssertionError: expected 8577 to be greater than or equal to 9000
    ❯ tools/downloader/resolvers/test/browser/browser-resolver.test.ts:1842:25
   ```

   The same log: `Test Files 1 failed | 109 passed | 1 skipped (111)`,
   `Tests 1 failed | 2314 passed | 2 skipped (2317)`, the file at 593294 ms and
   that test at 10606 ms.

2. dl-93's branch: `expected 8040 to be greater than or equal to 9000`.
   **Relayed from dl-93's builder report; its log was overwritten, so the
   line is not quoted from a file and the run is not reproducible from a
   record.**

Neither branch touches that test or the code it exercises for this purpose. Run
alone on dl-90's branch (merged with `origin/main` `1a044437`) it passes:

```
npx vitest run --project downloader tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "respects the empty floor and the deadline"
Test Files  1 passed (1)
     Tests  1 passed | 161 skipped (162)
```

What is odd, and why this is a defect and not noise like
[dl-95](./dl-95-the-empty-floor-ceilings-flake-on-a-slow-windows-runner.md)'s
ceilings: **a slow machine can only lengthen the elapsed time**, and the floor is
counted inside `waitForQuiet` from the probe's own start, so an elapsed time
**shorter** than the floor says either the floor started counting before the
test's `startTime`, or the wait ended early, or the clock the test reads and the
clock the wait reads disagree. A timeout that fires late would flake the ceiling,
as dl-95 found; one that returns early flakes the floor, and this is the second
kind.

## Build

Not chased at filing; the owner's instruction to the filer was to record the
numbers and stop. The first move is a reproduction: run the whole
`resolvers/test/browser/browser-resolver.test.ts` file (not the one test) several
times, and the downloader project, logging `Date.now()` at the test's
`startTime`, at the entry of `waitForQuiet` and at its return, to find which of
the three explanations holds. Read `resolvers/src/browser/` for `emptyMinWaitMs`
before guessing: a pooled browser that has already been warmed by an earlier test
in the file, or a floor that begins when the first request is seen rather than
when `resolve` starts, might both give a short elapsed time only after other
tests have run.

Then fix the cause, not the assertion: loosening 9000 to 8000 would hide a floor
that returns early.

## Done when

- The cause is named in the Log, with a run that shows it (a log line, or a test
  that fails before the fix and passes after).
- The test passes in 10 consecutive runs of the whole file and of
  `npm test -- --project downloader`, or the Log says why that is not the bar.
- `npm run check` passes.

## Log

- 2026-10-10, filed from dl-90's landing. The owner chose to file it. Numbers
  above; the cause was not chased. `difficulty: standard`: the cause is unknown,
  and finding it needs judgement about three candidate explanations, but nothing
  in the brief touches a contract or an architecture choice.
