---
id: dl-125
tool: downloader
title: A fast-start file stored at 60% of itself finished as done on one Windows run
kind: fix
status: ready
milestone: null
depends_on: [dl-103]
difficulty: hard
---

# dl-125 — A fast-start file stored at 60% finished as `done` on one Windows run

## Why

[dl-103](./dl-103-an-unanswered-seek-probe-still-finishes-a-tail-moov-mp4-undecodable.md)
settled, on the owner's answer of 2026-10-10, that a source which is merely short
is a failed download, `DOWNLOAD_FAILED`, "wherever the shortness shows" and never
a clean `done` carrying the frames that were there. Its test, in
`tools/downloader/engine/test/stream.test.ts` under "dl-103: an unanswered seek
probe", stores the fast-start fixture truncated at 5% and at 60% and asserts that
`stream()` ends `DOWNLOAD_FAILED`.

On one Windows run the 60% case ended `done`.

**Reproduction (as filed, from CI).** `test (windows-latest, informational)` of
PR #474 (lg-8, head `bd5a4381`), run 38355111789, job 115156202754:

```
FAIL  downloader  tools/downloader/engine/test/stream.test.ts > dl-103: an unanswered seek probe > a fast-start file stored at 60% of itself is DOWNLOAD_FAILED
AssertionError: {"streamed":689225,"done":689225,"decodedFrames":56}: expected 689225 to be 'DOWNLOAD_FAILED' // Object.is equality
```

`streamed` is the bytes that reached the response body, `done` is what
`media.done` resolved with (a byte count, not an error code), and
`decodedFrames` is how many frames the written file decodes. So the whole of what
the origin had was handed over, `done` resolved, and 56 frames came out: a
silently truncated file, which is what dl-103 ruled out. On that same Windows
job the 5% case passed (91 ms) and the failing 60% case took 117 ms; on ubuntu
in the same run both passed. The lg-8 pull request touches no downloader code.

**What is known.**

- It is intermittent: the same test passed on main's Windows run 38355501857 at
  `4f756c40` (job 115157392366 concluded `success`), and 25 of 25 local Linux runs
  pass (the Log).
- It has been seen once, on Windows only so far. One occurrence is no rate, and
  Linux passing does not refute the Windows failure.

**What is not known.**

- Whether this is a **product defect** (the engine misses the verdict it should
  reach for a short source, under some ordering Windows produces) or a **test
  timing** matter (the fixture origin, the process exit, or the log read
  racing). Nothing here measures it.
- Whether ffmpeg logged `partial file` on that run at all. The test prints the
  outcome and not ffmpeg's log, so the CI log cannot say.
- The failure rate.

**A reading, not a measurement.** The test's origin answers a `Range` request
with `content-range: bytes start-end/<stored length>` and a matching
`content-length`, so it declares exactly the bytes it has. Reading
`engine/src/stream.ts`, a short source of that kind has no early end, and the only
thing that makes it `DOWNLOAD_FAILED` is `PARTIAL_FILE` with no `SAME_OFFSET_ENDS_EARLY`
at its offset. That makes the verdict depend on ffmpeg printing the one line and
the engine reading it before the process ends. That is where to look first, and it
is only where to look.

## Build

Start by measuring. Do not change `src/stream.ts` or the test until step 3 has an
answer.

1. **Get a rate on Windows.** The Windows leg is informational and runs the
   whole suite. Run the one case alone, many times, on a Windows runner (a
   throwaway branch with a workflow that loops
   `npx vitest run tools/downloader/engine/test/stream.test.ts -t "stored at 60%"`,
   which is how the local runs below were made). Record the count of failures
   over the count of runs. If it never fails alone, run it in the whole file and in
   the whole project, because the failing run had the machine loaded with the
   rest of the suite.
2. **Make a failing run say what ffmpeg said.** In a throwaway change, have the
   test's outcome carry ffmpeg's stderr lines that match `PARTIAL_FILE` and
   `SAME_OFFSET_ENDS_EARLY`, and whether the process exited before or after the
   engine read them. Loop as in step 1 until one fails.
3. **Decide from that.** `partial file` logged and the verdict missed: a product
   race, in the engine. `partial file` never logged on a run that finished `done`:
   ffmpeg or the origin behaved differently, and the question is whether
   the product can still tell. Timing in the test's origin or its read of `done`:
   a test defect. Record which, with the lines that show it.
4. Then fix what step 3 named, with a check that fails before the fix on the
   measured condition, and the dl-103 rule kept as the owner stated it: a short
   source is `DOWNLOAD_FAILED`, never `done`.

## Done when

- The Log records the failure rate on Windows from step 1, as failures over runs,
  and what ffmpeg and the engine said on a failing run from step 2.
- The cause is named as a product defect or a test-timing defect, with the
  evidence that separates the two.
- The fix has a test that fails on the measured condition before it and passes
  after, or, if the cause is the test, the test is changed so that it cannot
  report `done` as a pass of the wrong thing, and says so.
- The 60% case passes on the Windows leg over the same number of runs that
  step 1 used to measure the failure.
- `npm run check` and the downloader project's tests pass.

## Log

### 2026-10-13 — filed (Sonnet 5.5, builder-standard)

Handed over from the peer session that found the failure on PR #474's Windows
leg. Read from the CI log, not restated:

```
$ gh run view 38355111789 --job 115156202754 --log
✓ a fast-start file stored at 5% of itself is DOWNLOAD_FAILED 91ms
× a fast-start file stored at 60% of itself is DOWNLOAD_FAILED 117ms
AssertionError: {"streamed":689225,"done":689225,"decodedFrames":56}: expected 689225 to be 'DOWNLOAD_FAILED' // Object.is equality
Tests  2 failed | 5548 passed | 51 skipped (5601)
```

The run's other failure is dl-124's, the IPv6 log test matching a request id.

```
$ gh run view 38355501857 --json jobs --jq '.jobs[] | [.name,.conclusion,.databaseId] | @tsv'
test (windows-latest, informational)   success   115157392366
test (ubuntu-latest)                   success   115157392404
```

That is the job's conclusion at `4f756c40`. A passing job's log carries no
per-test lines, so the 60% test's own pass on that run is inferred from it and not
read.

**Local Linux runs, which do not refute the Windows failure:**

```
$ npx vitest run tools/downloader/engine/test/stream.test.ts -t "stored at 60%"   # 5 runs, then 20 in a loop
Tests  1 passed | 78 skipped (79)        # 25 of 25
$ npx vitest run tools/downloader/engine/test/stream.test.ts -t "stored at" --reporter=verbose
✓ … stored at 5% of itself is DOWNLOAD_FAILED 115ms
✓ … stored at 60% of itself is DOWNLOAD_FAILED 124ms
```

So the failing Windows case (117 ms) was not slower than a passing Linux one
(124 ms): nothing in the timing points at a slow runner.

**Not measured.** The failure rate, the cause, ffmpeg's log on the failing run,
and the size of the fixture, so that `689225` being the stored body in full is
the reading and not a count. No Windows run was made from here.
