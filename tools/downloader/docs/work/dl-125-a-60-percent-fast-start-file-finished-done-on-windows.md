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

### 2026-10-15 — steps 1 and 2 measured; stopped before step 3 (Opus 5.5, builder)

This entry covers measurement only. Neither `src/stream.ts` nor the test was changed.

**Step 1: the Windows probe.** The probe was draft PR #486, head `63d63d25`, now
closed with its branch deleted. It added new files only: one workflow, plus
`NODE_OPTIONS=--import` instrumentation that wrapped `child_process.spawn` and
recorded the engine ffmpeg's stderr, exit and close times. The instrumentation
was needed because the test's failure message prints the outcome but not
ffmpeg's log, and step 2 asks for that log. The run was 38662561661, job
116186998598, on `windows-latest`. It printed:

```
ffmpeg-static: D:\a\tools\tools\node_modules\ffmpeg-static\ffmpeg.exe
ffmpeg version 6.1.1-essentials_build-www.gyan.dev
FFMPEG_PATH=unset
phase block result: 0 failed of 60 runs (60% case: 60 pass, 0 fail, 0 not found; 0 runs failed on something else) in 236s
phase file result: 0 failed of 30 runs (60% case: 30 pass, 0 fail, 0 not found; 0 runs failed on something else) in 492s
```

Each run was a fresh `vitest run tools/downloader/engine/test/stream.test.ts`:

- "block" used `-t "dl-103: an unanswered seek probe"`. On Windows the stand-ins
  skip, so this is the 60% case plus seven real neighbours.
- "file" ran the whole file.

**The rate is 0 of 90 isolated runs.** With no failures, the rule of three puts
it under 5% for the block (n = 60) and under 10% for the whole file (n = 30).
The probe PR's own whole-suite Windows leg (run 38662561614) also passed
`stream.test.ts`. That leg's one failure was dl-98's parallel-ranges timing,
which is dl-121's test.

**The whole-suite rate is 1 of 183, read from CI history.** I read every
`ci.yml` run created between 2026-10-11T01:28Z, when dl-103 merged as
`df941568`, and 2026-10-15T00:56Z:

- 186 Windows legs ran: 141 `success` and 45 `failure`.
- 183 of those heads carry `df941568`. The other 3 could not be checked.
- Every failed leg's `--log-failed` output was grepped for the 60% case. It
  appears in one: run 38355111789, the run this ticket was filed from. The
  other 44 failures are other tests, mostly dl-98's `parallel-ranges.test.ts`.

Two limits apply. `gh run list` shows only the latest attempt of each run, so an
earlier attempt that was re-run is not counted. A leg that concluded `success`
is counted as a pass of the 60% case, because a passing job's log has no
per-test lines to read.

**Step 2: what ffmpeg said, on passing runs only.** No looped run failed. I could
identify the 60% case's engine ffmpeg in 89 of the 90 runs. In every one:

- ffmpeg logged `partial file`, then exited 0, 4.1 to 14.5 ms later;
- it logged no `Stream ends prematurely`;
- the engine had the line well before the exit.

The trace's `data` listener reads the same chunk the engine's listener does. For
example, block run 1:

```
ffmpeg 4412/6344: video=654kB exit=0 null@45.1ms close@45.4ms stderr-end@42.7ms partial=[39.2ms:stream 1, offset 0xaa8a9: partial file] early=[] reconnect=[]
```

In the 90th run (file run 4), Windows reused the ffmpeg's pid within one worker,
and the trace keys on that pid. Its `partial file` at offset `0xaa395` is
present, but its exit timing is merged with another process's. The run's trace
artifact could not be downloaded from here: the artifact host timed out
(`dial tcp 52.239.172.36:443: i/o timeout`).

**The fixture differs on every run.** The fixture's size is not fixed: 60
distinct `faststart.mp4` sizes in 60 block runs (1,149,431 to 1,154,833 bytes)
and 30 in 30 file runs (1,149,409 to 1,155,036). So the 60% cut lands on a
different byte, and in a different place relative to the samples, every run.

**A cut that lands on a sample boundary gives the failing outcome on Linux.** I
ran a scratch script, not committed, against the built engine (`dist`), with
ffmpeg 6.1.1-3ubuntu5. It served a stored prefix exactly as the test's 60%
`answer` does and kept the engine's `ffmpeg` debug lines:

```
file 1026622 bytes, 60% = 615973, packets 274, cut falls inside packet at 611570+9299, next packet starts at 620869
60% (the test's cut): cut=615973 -> {"streamed":614789,"done":"DOWNLOAD_FAILED"} | ... stream 1, offset 0x97945: partial file
exactly at the next packet's start: cut=620869 -> {"streamed":619685,"done":619685} | (no partial file, no early end)
one byte past it: cut=620870 -> {"streamed":619690,"done":"DOWNLOAD_FAILED"} | ... stream 0, offset 0x979f1: partial file
one byte short of it: cut=620868 -> {"streamed":619684,"done":"DOWNLOAD_FAILED"} | ... stream 1, offset 0x97945: partial file
cuts exactly at a packet start in 40-80%: 114; done resolved on 114
random cuts in 40-80%: 500; DOWNLOAD_FAILED 500
```

So a stored file that ends exactly where a sample ends makes ffmpeg log nothing
at all. ffmpeg then exits 0 and `done` resolves with every byte, with no timing
involved. That is the failing run's outcome: `done` equal to `streamed`, and
fewer than 100 frames. One more reading agrees with it. On Linux, `streamed` is
about the cut minus 1,184 bytes. Applied to the Windows fixture range, a whole
60% prefix would stream 688,461 to 691,837 bytes, and `689225` falls inside it. This is consistent with
the failing run receiving the whole prefix, but it is not proof.

**What this does not settle.**

- Whether the Windows failure was this mechanism is not measured. Packet starts
  are 114 in 410,648 bytes, about 1 per 3,600. A uniformly placed cut would hit
  one on about 0.03% of runs. Over 273 runs (the 183 CI legs plus these 90),
  that predicts at least one hit only about 7% of the time, against the 1 seen.
- The boundary case has not been run on Windows's ffmpeg-static build.
- No failing run's ffmpeg log exists.

**The brief had one thing wrong.** ffmpeg does not read the test's origin
directly. Its `-i` is the engine's own loopback URL
(`http://127.0.0.1:<port>/<hex>`), and the engine relays to the origin.

Stopped here, before step 3, as dispatched.

### 2026-10-15 — the owner's answer; the boundary cut on Windows; what a detection rule would see (Opus 5.5, builder)

**The owner's answer, relayed by the orchestrator on 2026-10-15.** The question
was "What next?", with four options:

- Boundary case + Win probe
- Boundary case, no probe
- Test defect: pin the cut
- Park it

The owner chose **"Boundary case + Win probe"**, which was put to them as: take
the sample-boundary cut as step 3's measured condition; first, a roughly
10-minute Windows probe confirms that ffmpeg-static behaves the same way; then
the builder brings the detection rule (an output-time threshold, and the risk of
false failures) as options with numbers. No source changes until the owner
chooses.

**How it was measured.** One script, `detect.mts`, ran on both platforms. On
Windows it ran in probe PR #492 (head `fd58776c`, now closed, its branch
deleted). It does two things:

- **Boundary cuts.** It cuts fresh copies of dl-103's large fast-start fixture
  at every sample start and at random positions, and serves each cut the way
  the test's 60% `answer` does. The sample starts come from the moov's own
  `stco`/`stsc`/`stsz` tables, because ffmpeg-static ships no ffprobe.
- **Whole sources.** It serves every progressive fixture the engine's suites
  generate, uncut, with the variant declaring the container's own duration.

For each run it records three things:

- whether ffmpeg logged `partial file`;
- how `done` ended;
- `done`'s `durationSec`, which is ffmpeg's last `out_time` whenever a progress
  block arrived.

The gap is the declared duration minus `out_time`.

**On Windows, a boundary cut ends `done` the same way it does on Linux.** The
run was 38666579367, job 116199801215, on ffmpeg 6.1.1-essentials_build-www.gyan.dev
(ffmpeg-static, `FFMPEG_PATH` unset), with two fixture copies and 30 random cuts
each:

```
== outcomes ==
  boundary DOWNLOAD_FAILED partial: 4
  boundary done no-partial: 544
  random DOWNLOAD_FAILED partial: 60
  whole done no-partial: 36
```

On Linux (ffmpeg 6.1.1-3ubuntu5, three copies, 40 random cuts each) the result
is the same:

```
  boundary DOWNLOAD_FAILED partial: 5
  boundary done no-partial: 816
  boundary refused DOWNLOAD_FAILED partial: 1
  random DOWNLOAD_FAILED partial: 120
  whole done no-partial: 54
```

The boundary cuts that failed are the two earliest of each copy, inside the
first 2.3% of the file, where ffmpeg still logged `partial file`. Every other
sample-boundary cut ended `done` with no `partial file`, on both platforms.
Every random cut was `DOWNLOAD_FAILED`.

**The gap, in seconds.** The two platforms agree to the millisecond:

```
                        boundary cuts ended done                       whole sources
Windows  n=544 min=0.029 p5=0.215 median=2.026 max=4.000    n=36 min=0.006 median=0.011 max=0.067
Linux    n=816 min=0.029 p5=0.215 median=2.026 max=4.000    n=54 min=0.006 median=0.011 max=0.067
```

**Every whole source, on both platforms.** The values were identical on every
copy:

| source           | declared (s) | out_time (s) | gap (s) |
| ---------------- | ------------ | ------------ | ------- |
| prog4 a/v        | 4.000        | 3.994        | 0.006   |
| prog5 a/v        | 5.000        | 4.992        | 0.008   |
| prog9 a/v        | 9.000        | 8.986        | 0.014   |
| prog4/5/9 audio  | as a/v       | as a/v       | as a/v  |
| prog4/5/9 video  | 4, 5, 9      | 3.933 ...    | 0.067   |
| large 4 s 2 Mb/s | 4.000        | 3.994        | 0.006   |
| gop6 12 s        | 12.000       | 11.981       | 0.019   |
| rate 7 s 1 Mb/s  | 7.000        | 6.989        | 0.011   |
| webm (Windows)   | 6.010        | 6.001        | 0.009   |

The largest gap, 0.067 s, is one 15 fps frame on the video-only files: there,
`out_time` is the last frame's start, not its end.

**What a threshold T would catch and falsely fail.** "Fail a `done` whose gap
exceeds T", on both platforms:

| T              | boundary cuts caught, Windows | Linux     | whole sources failed |
| -------------- | ----------------------------- | --------- | -------------------- |
| 0.05 s         | 540 / 544                     | 810 / 816 | 6/36 and 9/54        |
| 0.1 s          | 532 / 544                     | 798 / 816 | 0 and 0              |
| 0.25 s         | 512 / 544                     | 768 / 816 | 0 and 0              |
| 0.5 s          | 478 / 544                     | 717 / 816 | 0 and 0              |
| 1% of declared | 542 / 544                     | 813 / 816 | 4/36 and 6/54        |
| 2% of declared | 536 / 544                     | 804 / 816 | 0 and 0              |

The cuts any threshold misses are the last few samples of the file. A cut at
the final sample start leaves a gap of 0.029 s. Cuts at 99.1%, 98.2%, 97.3% and
96.4% of the file leave gaps of 0.053 to 0.080 s, 0.099 to 0.120 s, 0.122 to
0.160 s and 0.169 to 0.200 s respectively.

**What this does not measure.**

- Real-world sources: low or variable frame rates, edit lists, a declared
  duration longer than the tracks the engine maps (`-map 0:v:0? -map 0:a:0?`),
  and resolver-supplied durations rounded to whole seconds. Each could widen
  the whole-source gap past these fixtures'.
- HLS and DASH, which a rule for progressive sources would not cover.
- Whether the engine reads the reference duration itself. Today it parses
  ffmpeg's `Duration` line only when the variant carries no duration
  (`learnedDurationSec`), and the variant's duration is the resolver's.

The detection rule is open, with the owner. No source or test was changed.
