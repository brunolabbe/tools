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

**What was not known when this was filed.** _Superseded on 2026-10-15; the
paragraphs below are kept as filed. The Log entries of 2026-10-15 now give the
rate: 0 of 90 isolated Windows runs, and 1 of 183 Windows CI legs. The
Decision section names the measured condition the fix targets. Whether ffmpeg
logged `partial file` on the filed run is still unknown._

- Whether this is a **product defect** (the engine misses the verdict it should
  reach for a short source, under some ordering Windows produces) or a **test
  timing** matter (the fixture origin, the process exit, or the log read
  racing). Nothing here measures it.
- Whether ffmpeg logged `partial file` on that run at all. The test prints the
  outcome and not ffmpeg's log, so the CI log cannot say.
- The failure rate.

**A reading, not a measurement.** _Superseded on 2026-10-15; kept as filed. The
reading has two corrections. ffmpeg reads the engine's own loopback URL, not
the test's origin (the Log). And `done` can resolve on a short source with no
`partial file` at all, when the stored file ends exactly at a sample boundary
(the Decision)._ The test's origin answers a `Range` request
with `content-range: bytes start-end/<stored length>` and a matching
`content-length`, so it declares exactly the bytes it has. Reading
`engine/src/stream.ts`, a short source of that kind has no early end, and the only
thing that makes it `DOWNLOAD_FAILED` is `PARTIAL_FILE` with no `SAME_OFFSET_ENDS_EARLY`
at its offset. That makes the verdict depend on ffmpeg printing the one line and
the engine reading it before the process ends. That is where to look first, and it
is only where to look.

## Decision

**Settled on 2026-10-15** by the owner's answers, relayed by the orchestrator.
The measurements behind them are in the Log entries of 2026-10-15.

**The cause.** "What next?" had four options:

- Boundary case + Win probe
- Boundary case, no probe
- Test defect: pin the cut
- Park it

The owner chose **"Boundary case + Win probe"**: take the sample-boundary cut as
step 3's measured condition.

**What the fix targets is that measured condition.** A fast-start file is stored
so that it ends exactly at a sample's first byte. ffmpeg then logs no
`partial file` and no early end, and exits 0, so `done` resolves with every
byte. Measured: every cut past the first two of a fixture copy ended this way,
816 of 816 on Linux and 544 of 544 on Windows with ffmpeg-static. The first two
cuts of each copy, inside the first 2.3% of the file, still log `partial file`.
ffmpeg says nothing the engine could read, so on both platforms a short source
of this kind breaks dl-103's rule today.

**The filed run matches this condition's signature, but its mechanism is
unmeasured.** Its signature is `done` equal to `streamed`, and 56 of 100 frames
decoding. No failing run's ffmpeg log exists. The rate also argues against
assuming the match:

- The fixture changes size on every run, so the 60% cut does land on a
  different byte each time.
- But a uniformly placed cut hits a sample start about once in 3,600 runs. That
  predicts at least one hit in 273 runs only about 7% of the time.
- Measured: 0 of 90 isolated Windows runs failed, and 1 of 183 Windows CI legs.

**The rule.** "Which rule?" had four options:

- Gap > 0.25 s fails
- Gap > 0.1 s fails
- Gap > 2% of declared
- Resolver duration, not container

The owner chose **"Gap > 0.25 s fails"**. In full:

- The rule applies to progressive sources only.
- It applies after ffmpeg exits 0 with no `partial file` verdict.
- `done` fails `DOWNLOAD_FAILED` when the container's declared duration minus
  ffmpeg's last `out_time` exceeds 0.25 s.
- The engine reads the container's `Duration` line on every run.

**What 0.25 s catches and misses, as measured:**

- It catches 94.1% of boundary cuts on both platforms.
- It falsely failed none of 90 whole-source runs. Those were 18 distinct
  synthetic fixtures, each run on 5 fixture copies (2 Windows, 3 Linux). 17
  of the 18 gave identical values across all five copies and both platforms;
  `webm/source.webm` differs by 2 ms across platforms (declared, `out_time`,
  gap: Windows 6.010 / 6.001 / 0.009, Linux 6.008 / 6.001 / 0.007). The largest
  gap was 0.067 s.
- Within its coverage, it misses only a truncation that loses the last 0.25 s
  or less.

**The rule does not cover:**

- HLS and DASH;
- a progressive run with no `Duration` line or no progress snapshot (the next
  answer).

**What the false-failure side was not measured against:**

- real sources;
- low or variable frame rates;
- edit lists;
- a declared duration longer than the tracks the engine maps
  (`-map 0:v:0? -map 0:a:0?`);
- resolver durations rounded to whole seconds.

Each could put a whole source's gap past 0.25 s.

**A run the rule cannot measure.** "What should such a run do?" (a progressive
run with no `Duration` line, or no progress snapshot) had three options:

- Stays `done`, as today
- Fails DOWNLOAD_FAILED
- Fall back to resolver duration

The owner chose **"Stays `done`, as today"**. With no container duration or no
`out_time`, the rule does not apply, and the run ends as it does now.

**When to build.** "When should dl-125's fix be built?" had two options:

- Record now, build later
- Build it in this batch

The owner chose **"Record now, build later"**. This ticket stays `ready` for a
later batch.

**What the record says about the second mechanism.** Answered on 2026-10-15,
after gate 2. "What should the record say?" had two options:

- Add the capture to Build
- Leave it

The owner chose **"Add the capture to Build"**. The Build tells a reader to
bring back a Windows failure whose ffmpeg log shows `partial file`, and no
reader can see that log from CI today. Build 4 now has the two dl-103 cases'
failure messages carry the engine's ffmpeg `partial file` and
`Stream ends prematurely` lines.

## Build

The rule and the condition it targets are settled (Decision, above). Build the
rule. A Windows failure whose ffmpeg log shows `partial file` is a second
mechanism, not this one: bring it back.

1. **Read the container's duration every time.** Today
   `engine/src/stream.ts` parses ffmpeg's `Duration` line (`learnedDurationSec`,
   through `durationFromInfoLine` in the `onInfoLine` handler) only when
   `mediaDurationSec` is null. That value is
   `context.liveDurationSec ?? context.durationSec`, where `durationSec` is
   `request.durationSec ?? variant.durationSec`. So a variant or request that
   declares a duration, as the test's `large()` does with `durationSec: 4`,
   means the line is never learned. Keep `learnedDurationSec`'s current role in
   progress reporting unchanged. Also keep the container's own `Duration`, for
   progressive sources, whatever the variant says. The handler takes the first
   line that parses, which is the video input's. If a progressive variant with
   a separate `audioUrl` changes that, say so in the Log.
2. **Apply the rule where the other short-source verdicts are.** It goes in
   `done`'s completion handler, after the `endedEarly` and `partialAt` checks
   and before `body.end()`. Fail a progressive run with `DOWNLOAD_FAILED` when
   the container's duration minus the last progress snapshot's `out_time`
   exceeds 0.25 s, so the visitor sees a cut connection and not a complete
   response. Name the 0.25 s as a constant whose comment cites this ticket's
   measurement. A run with no container `Duration` or no progress snapshot
   stays `done`, as today (the owner's answer in the Decision): the rule
   applies only when both are present.
3. **Test it on the measured condition.**
   - **The failing case.**
     - Add a new `describe` at the end of `engine/test/stream.test.ts`, with
       its own origin. dl-103's `answer`, `blind` and `outcomeOf` are closed
       over inside their own block, so only the top-level helpers (`exchange`,
       `large`, `fixtureRoot`) are reachable.
     - In it, cut dl-103's large fast-start fixture exactly at a sample's first
       byte, far enough from the end that the gap is well over 0.25 s (around
       60% gives about 1.6 s).
     - The origin serves the stored prefix the way the 60% case's `answer`
       does: `206` with `content-range: bytes start-end/<stored length>` and a
       matching `content-length`.
     - Read it through `exchange`, as the HLS and DASH cut tests do. Assert
       that it ends `DOWNLOAD_FAILED` and that the visitor's response is
       aborted (`received.aborted` is `true`), not completed.
     - A test that checks only the `done` code cannot see where the verdict
       sits. The gate measured this: it stays green with the verdict moved
       after `await finished(body, …)`.
     - Do not model the test on "a progressive body cut after the first byte
       and never served again fails the stream". It stays green with the
       `endedEarly` verdict deleted, because its `DOWNLOAD_FAILED` comes from
       another path.
   - **Finding the sample starts.** The probe's moov parser does this:
     `sampleStarts` in `.github/probe-dl-125-2/detect.mts`, at probe PR #492's
     head `fd58776c` (`git fetch origin pull/492/head`). It reads
     `stco`/`co64`, `stsc` and `stsz`, and needs no ffprobe, which ffmpeg-static
     does not ship. Where it lives once it is real (a test helper beside
     `topLevelBoxes` in `helpers/media.ts`, or elsewhere) is your call.
   - **Before the fix.** This case must fail on every run, because every cut
     past the first two of a fixture copy ended `done` (816 of 816 on Linux,
     544 of 544 on Windows). Each vitest process makes a fresh fixture, so
     loop it in at least 25 fresh processes, the filing's own loop count. Log
     the count as failures over runs.
   - **Controls**, each ending `done` before and after the fix:
     - A cut at the final sample start (a gap of about 0.029 s), so the
       accepted miss is pinned from the other side.
     - A stand-in ffmpeg that writes output and exits 0 with no `Duration`
       line and no progress block. Make it the way dl-103's `standIn103`
       does. That helper is closed over inside its own block too, so copy it
       or lift it to the top level.
     - A second stand-in that prints a `Duration` line but no progress block.
       Print it tagged, `[info]   Duration: 00:00:04.00, start: 0.000000`, as
       the engine's `level+info` makes ffmpeg do; an untagged line never
       reaches `onInfoLine`.
     - A third stand-in that prints no `Duration` line but writes a progress
       snapshot (`out_time_us=1000000`, then `progress=end`) to descriptor 3,
       with its output on stdout, and exits 0. Its `large()` variant declares 4. It must end `done`, before and after the fix: a rule that took the
       variant's 4 s as the container's duration would see a gap of 3 s and
       fail it.
     - The stand-ins are Linux-only, skipped on win32 like their dl-103
       siblings, and serve the owner's "stays `done`" answer.
4. Keep the dl-103 rule as the owner stated it: a short source is
   `DOWNLOAD_FAILED`, never `done`. Its 5% and 60% cases keep their assertions.
   Change their failure messages only: they carry the engine's ffmpeg
   `partial file` and `Stream ends prematurely` lines, read through
   `capturingLogger`, so a Windows recurrence shows which mechanism it is (the
   owner's answer, in the Decision).

## Done when

- The Log records the measured condition the fix targets, and says the filed
  run's mechanism is unmeasured. Done: the Log entries of 2026-10-15 and the
  Decision above.
- A progressive run that exits 0 with no `partial file`, and whose container
  duration exceeds its last `out_time` by more than 0.25 s, ends
  `DOWNLOAD_FAILED`, and the visitor's response is aborted, not completed
  (`received.aborted` through `exchange`).
- The exact-sample-start cut fails in every one of at least 25 fresh-process
  runs before the fix, logged as failures over runs, and passes after.
- The final-sample-start control and the three stand-ins (no `Duration` line
  and no snapshot, a tagged `Duration` line and no snapshot, a snapshot and no
  `Duration` line) end `done`, before and after. The rest of the downloader
  project's existing suite passes unchanged.
- On the pull request's own Windows leg, the new test and the dl-103 60% case
  both pass.
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
  has a `FAIL` line in one: run 38355111789, the run this ticket was filed
  from. (_Corrected after gate 1:_ the case's name also appears in run
  38165406514, as a passing line, `✓ a fast-start file stored at 60% of itself
is DOWNLOAD_FAILED 343ms`.) The other 44 failures are other tests, mostly
  dl-98's `parallel-ranges.test.ts`.

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
ffmpeg 6.1.1-3ubuntu5. The script, `boundary.mjs`, is not kept; the outputs
below stand without it. _Corrected after gate 1:_ it, and `history.mjs`
beside it, took the repository tree as their first argument instead of
hard-coding this worktree's path. It served a stored prefix exactly as the
test's 60%
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
copy and both platforms, except the webm's, which differs by 2 ms (_corrected
after gate 2:_ Linux 6.008 / 6.001 / 0.007):

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
96.4% of the Windows fixtures leave gaps of 0.053 to 0.080 s, 0.099 to 0.120 s,
0.122 to 0.160 s and 0.169 to 0.200 s respectively. On the Linux fixtures the
same gaps fall at 98.9 to 99.1%, 97.9 to 98.0%, 96.8 to 96.9% and 95.7 to
95.9%.

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

### 2026-10-15 — the rule chosen; to be built later (Opus 5.5, builder)

The owner answered two questions, relayed by the orchestrator:

- **"Which rule?"** The options were "Gap > 0.25 s fails", "Gap > 0.1 s
  fails", "Gap > 2% of declared" and "Resolver duration, not container". The
  owner chose **"Gap > 0.25 s fails"**.
- **"When should dl-125's fix be built?"** The options were "Record now, build
  later" and "Build it in this batch". The owner chose **"Record now, build
  later"**.

What changed on the ticket:

- A Decision section now records all three answers of 2026-10-15.
- The Build is rewritten. It no longer runs steps 1 to 3 again; it starts from
  the rule and gives a test plan: an exact-sample-start cut, using
  `sampleStarts` from probe PR #492's `detect.mts`, failing on every run before
  the fix, plus a final-sample-start control.
- The Done-when lines are rewritten to match.
- `status` stays `ready`. No source or test was changed.

One case is outside the answer: a run with no `Duration` line or no progress
snapshot. The Build says to bring it back as a question rather than choose.
(_Answered the same day, below._)

### 2026-10-15 — gate 1's findings applied (Opus 5.5, builder)

Gate 1 (Sonnet 5.5, narrow) at `9417c837` returned CONCERNS with nine findings.
It re-derived every logged number from the raw logs, and the Linux boundary
reproduction re-ran identically. The owner answered the two open decisions,
relayed by the orchestrator:

- **F1, "How should the record read?"** The options were "Reword to what's
  measured" and "Leave as written". The owner chose **"Reword to what's
  measured"**.
  - The Decision now says the boundary cut is the measured condition the fix
    targets, and that the filed run matches its signature but its mechanism is
    unmeasured.
  - The Build now says a Windows failure whose ffmpeg log shows `partial file`
    is a second mechanism, to be brought back.
  - `Done when` 1 is reworded to match.
- **F3, "What should such a run do?"** (a progressive run with no `Duration`
  line, or no progress snapshot). The options were "Stays `done`, as today",
  "Fails DOWNLOAD_FAILED" and "Fall back to resolver duration". The owner chose
  **"Stays `done`, as today"**.
  - It is recorded in the Decision and replaces Build 2's "bring it back".
  - Two stand-in controls the next gate can grade are now in Build 3 and
    `Done when` 4.

The others were applied as the gate wrote them:

- **F2.** `Done when` 2 now asserts `DOWNLOAD_FAILED` with the visitor's
  response aborted (`received.aborted` through `exchange`). "Before
  `body.end()`" stays as Build 2's placement. Build 3 says the "cut after the
  first byte" test is not the model.
- **F4.** "Every cut past the first two of a copy" (816 of 816, 544 of 544); a
  floor of 25 fresh-process runs; "the rest of the downloader project's
  existing suite".
- **F5.** A new `describe` with its own origin.
- **F6.** The `Duration` condition is now worded as the code has it:
  `mediaDurationSec` null, which is `liveDurationSec ?? durationSec`. I checked
  this against `stream.ts`: `const durationSec = request.durationSec ??
variant.durationSec ?? null`.
- **F7.** The superseded `## Why` paragraphs are marked, and the pull request
  is retitled.
- **F8.** The "not measured" list and the coverage limits are carried into the
  Decision.
- **F9.** Both wording points are corrected in place, each marked "Corrected
  after gate 1". I reproduced the first one:
  `gh run view 38165406514 --log-failed | grep "stored at 60%"` prints
  `✓ a fast-start file stored at 60% of itself is DOWNLOAD_FAILED  343ms`.
- **The gate's script defect.** `boundary.mjs`, `sweep.mjs` and `history.mjs`
  now take the repository tree as their first argument. Re-run:
  `node boundary.mjs <tree> <work dir>` gives `cut=620869 ->
{"streamed":619685,"done":619685} | (no partial file, no early end)`, as
  logged.

`status` stays `ready`. No source or test was changed.

### 2026-10-15 — gate 2's findings applied; the records are on the thread (Sonnet 5.5, fixer)

Gate 2 (Sonnet 5.5, narrow) at `270ec0e9` returned CONCERNS with four findings.
The ticket stays `ready`, so no review record is committed here (`status.mjs`
fails one on a `ready` ticket). Gate 1's and gate 2's full reports are on pull
request #490's thread, one comment each.

- **F10.** Build 3's second stand-in prints its `Duration` line tagged
  `[info]`, as the gate wrote it.
- **F11.** Build 3 has a third stand-in: no `Duration` line, a progress
  snapshot, output on stdout, exit 0, the `large()` variant declaring 4.
  `Done when` 4 names the three stand-ins.
- **F12.** The owner chose "Add the capture to Build" for "What should the
  record say?" (options: "Add the capture to Build", "Leave it"). It is in the
  Decision, and Build 4 has the two dl-103 cases' failure messages carry the
  engine's ffmpeg `partial file` and `Stream ends prematurely` lines.
- **F13.** (a) The Decision names `webm/source.webm`'s 2 ms difference across
  platforms; the whole-source paragraph of the 2026-10-15 Log carries the same
  correction, marked, because it made the same claim. (b) The Linux band is
  "96.8 to 96.9%". (c) The `boundary.mjs` sentence no longer sends the reader to
  a scratch path.

`status` stays `ready`. No source or test was changed.
