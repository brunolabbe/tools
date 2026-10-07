---
id: dl-96
tool: downloader
title: A slow progressive source reads 0 B/s and `unknown total` although the probe measured its size
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-96 — A slow progressive source reads 0 B/s and `unknown total`

## Why

Reported by the owner on 2026-10-07, from the devcontainer: a progressive MP4
the browser tier found, listed as `MP4 · 96 MB`, downloaded with the card
reading **Speed `0 B/s`**, **Progress `unknown total`** and **Downloaded stuck at
6.8 MB**. The size was on screen before the download started.

Measured on the live job, not guessed:

- **The source really was slow, and the devcontainer was not the cause.** Both
  legs of the API's egress proxy carried the same bytes at ~15.6 KB/s, so the
  proxy added nothing. A fresh direct `curl` of a 10 MB range from the same
  origin ran at 21 KB/s, while the same container pulled an npm tarball at
  7.2 MB/s. 17 minutes in, the job had sent 10.4 MB of a 100,307,911-byte file.
- **The display made that look like a stall, and in two ways.**

**0 B/s, and a frozen Downloaded.** `speedBps` is a 5 s window over bytes
handed to the reader (`RateTracker` in `engine/src/ffmpeg/progress.ts`, fed
from `engine/src/stream.ts`). The MP4 muxer ran
with `frag_keyframe` alone (`engine/src/mux.ts`), and ffmpeg writes a fragment
only once it is whole, so the output left in one burst per keyframe interval.
6.8 MB was the first fragment. Reproduced locally with a 60 s, 6 Mbit/s file
with an 8.3 s GOP, served at 1 MB/s by a throttled range server: the card's
numbers read `0 B/s` for the first 7 s, then 6.9 MB jumps with `0 B/s` before
each, and 1.3–1.5 MB/s in between against a true 1.0 MB/s. At the live origin's
15 KB/s a fragment took minutes, so the window almost always held no change.
The visitor's own transfer had the same gaps.

**`unknown total`.** `percent` comes only from media time over a duration
(`engine/src/ffmpeg/progress.ts`, `toJobProgress`), and a browser-found
progressive variant carries a size and no duration. The engine also passed
`totalBytes: null` unconditionally, so the probe's exact size was dropped.

**Decided by the owner, 2026-10-07**, from options with their costs:

1. **Speed:** cap fragments at 1 s (`-frag_duration 1000000` beside
   `frag_keyframe`) rather than smoothing the display, which would have left the
   bursts in the visitor's transfer.
2. **Total:** show the source's measured size as an _approximate_ total at
   once, and learn the duration **in parallel with the download**, so the bar
   starts indeterminate and turns determinate when the duration arrives.
3. **Where the duration comes from:** ffmpeg's own `Duration:` line, not a
   parallel `moov` read through the resolvers. Measured first: at
   `-loglevel repeat+level+info` ffmpeg printed it 0.05–0.06 s after start,
   before any output byte, for both a moov-at-end and a faststart file, at the
   cost of ~35 `[info]` lines a job. No second connection to the origin, every
   input type, and no new API-to-engine wiring.
4. One ticket and one pull request, fixed now.
5. **Later the same day, after the cap was built and measured:** the reported
   file is ~2.15 Mbit/s behind a 15 KB/s origin, about 18x slower than
   realtime, so even a 1 s fragment takes ~18 s to arrive. The cap alone left
   27 of 31 readings at 0 B/s at that ratio. The owner chose to **stretch the
   speed window to cover a whole fragment** over leaving it, or over deriving
   speed from media time, which would be an estimate rather than counted
   bytes.

## Build

1. `engine/src/mux.ts` — video MP4 gets `-frag_duration 1000000` beside
   `frag_keyframe+empty_moov+default_base_moof`. Audio-only already cuts by
   duration; Matroska and WebM are untouched.
2. `engine/src/ffmpeg/args.ts` — `GLOBAL_ARGS` asks for `level+info`.
3. `engine/src/ffmpeg/runner.ts` — **the trap is the metadata.** At `info`,
   ffmpeg dumps the source's own metadata (title, comment) to stderr, and every
   failure pattern here reads stderr text: `isTlsVerificationFailure`, the
   failover classifier, `SEGMENT_SKIPPED`, the early-end matchers and the 4 KB
   tail. A title reading "certificate verification failed" would reclassify a
   failure. So a `StderrLevels` reader strips the `[level]` tag (format measured
   on 6.1.1 and on `ffmpeg-static`'s 7.0.2:
   `[http @ 0x…] [warning] HTTP error 404 Not Found`). It sends `[info]` and
   below to a new `onInfoLine` **only**, and passes everything else on untagged,
   so downstream sees exactly what `warning` wrote. An untagged line continues
   the message above it and takes its level (a metadata value with a newline).
   Before any tag it passes through, which keeps the stand-in binaries in the
   tests working. The tail is now built from the passed lines, and a last line
   with no newline is flushed on close.
4. `engine/src/ffmpeg/progress.ts` — `durationFromInfoLine`. `N/A` (live) and a
   zero are null.
5. `engine/src/ffmpeg/progress.ts`, `RateTracker`: when ffmpeg's media time
   moved inside the plain 5 s window, the window reaches back to the moment the
   fragment _before_ the latest one landed, kept for up to 60 s. Gated on media
   time because bytes alone cannot tell a fragment on its way from a stopped
   source, and an ungated stretch decays for a minute over a real stall instead
   of reading zero. Before the first byte the rate is null, not zero.
6. `engine/src/stream.ts` — passes `out_time` to the tracker. When neither the request nor the variant has a
   duration, the first input's `Duration:` line supplies it for `percent`, the
   ETA and the outcome. `expectedOutputBytes` passes the variant's size as
   `totalBytes` only for a progressive file the probe measured, copied unchanged:
   not for a transcode, audio-only, a separate audio input, a live capture, or
   HLS/DASH, where a segment sum counts MPEG-TS overhead the MP4 does not carry.
7. `contract/src/job.ts` — document `totalBytes` as an expectation that never
   drives `percent`. Doc comment only; the type is unchanged.
8. `web/src/components/JobCard.tsx` — Downloaded shows `6.8 MB / ~96 MB`.
   Progress shows `—` rather than `unknown total` once a total is known.
9. `docs/01-ARCHITECTURE.md` — the `-loglevel warning` sentence.

## Done when

- A video MP4 stream is cut at least once a second: a 9 s fixture keyed every
  6 s arrives in at least 9 `moof` fragments, and still probes at 9 s.
- A progressive source with no probed duration reports a non-null `percent`
  that reaches above 95 and never past 100, from ffmpeg's `Duration:` line.
- That stream's `totalBytes` is the variant's measured size on every event,
  and the output lands within 1% of it.
- No `[info]` message from a real ffmpeg run reaches `onStderrLine` or the
  logger, and a certificate-sounding `[info]` title neither reaches the stderr
  tail nor turns a failure into `TLS_VERIFICATION_FAILED`.
- A source delivering one fragment every 18 s reads between half and all of
  its true rate at every sample after the second fragment, never zero.
- A stall that stops the media time reads zero once the 5 s window passes, at
  the tracker; a steady stream reads the plain window's rate; no byte yet reads
  null. On the card this needs progress blocks to keep arriving, which ffmpeg
  6.1.1 does not send while its input is blocked (gate F7): the card then keeps
  the last reading until the next block or `rw_timeout`, as it did before.
- `expectedOutputBytes` is null for an estimate, a missing size, HLS, a
  separate audio input, audio-only, a transcode and a live capture, and a real
  `stream()` reports no total for audio-only, a transcode and a live capture
  (gate F3).
- A warning carrying ffmpeg 7.x's two prefixes is not filed as info after an
  `[info]` line (gate F1).
- The card shows an expected total as `~`, keeps the bar indeterminate while
  `percent` is null, and does not say `unknown total` beside a known one.
- Each of the above fails with its change reverted.

## Review

**Gate: CONCERNS** — 2026-10-07 · `1aece87d..004ba87b` · Sonnet 5.5, depth medium (extra attention on the premise, `StderrLevels`, `RateTracker`, `expectedOutputBytes`)

CI on this head (`gh pr view 391`): all 11 checks SUCCESS, `test (ubuntu-latest)` and `test (windows-latest, informational)` included. Local: `npm run check` exit 0; `npm test -- --project downloader` 2079 passed, 2 skipped of 2081 (100 files passed, 1 skipped).

| Done when                                                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A video MP4 stream is cut at least once a second: a 9 s fixture keyed every 6 s arrives in at least 9 `moof` fragments and still probes at 9 s                                          | `engine/test/stream.test.ts` › "dl-96: progress on a source the probe could not time" › "a long-GOP source still reaches the reader at least once a second" (assertions: `moof` count ≥ 9, probed duration within `TOLERANCE_SEC` of 9) and `engine/test/mux-args.test.ts` › "fragment cadence (dl-96)" › "video MP4 is cut at each keyframe and at least once a second". **proven**; both go red with the `-frag_duration` pair removed from `streamingContainerArgs`                                                                                                                                                                                       |
| A progressive source with no probed duration reports a non-null `percent` that reaches above 95 and never past 100, from the `Duration:` line                                           | `engine/test/stream.test.ts` › "ffmpeg's own Duration line turns the percent on, and the size becomes the total" (`percents.length > 0`, max > 95, max ≤ 100; the variant carries a size and no duration) plus `engine/test/ffmpeg-progress.test.ts` › "durationFromInfoLine (dl-96)". **proven**; red with `GLOBAL_ARGS` back to `warning`                                                                                                                                                                                                                                                                                                                  |
| That stream's `totalBytes` is the variant's measured size on every event, and the output lands within 1%                                                                                | same stream test: `seen.every(totalBytes === sourceBytes)` (guarded by `percents.length > 0`, so not vacuous) and `                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | outcome.bytes − sourceBytes | / sourceBytes < 0.01`. **proven**; red with `totalBytes: null` restored. Gate's own run of the branch argv on a 9 MB fixture: output 0.03% over the source |
| No `[info]` message from a real ffmpeg run reaches `onStderrLine` or the logger, and a certificate-sounding `[info]` title neither reaches the tail nor makes `TLS_VERIFICATION_FAILED` | `engine/test/ffmpeg-runner.test.ts` › "StderrLevels: info goes to onInfoLine, warnings arrive untagged (dl-96)" › "a certificate-sounding title fails nothing, reaches no tail, and is offered as info" (stand-in binary: `DOWNLOAD_FAILED`; tail has no "certificate"; the tail does contain the real warning, which is the non-empty companion) and the stream test above (`logged` filtered for `Duration:`/`Stream #`/`Input #`/level tags equals `[]`; its `percent > 95` shows the info stream existed). **proven** for a title value and an ordinary file; red with the filter off (2 tests fail). A crafted tag _key_ gets a forged line through: F2 |
| A source delivering one fragment every 18 s reads between half and all of its true rate at every sample after the second fragment, never zero                                           | `engine/test/ffmpeg-progress.test.ts` › "RateTracker across fragments slower than its window (dl-96)" › "reads the source's rate between fragments, never zero" (min > `RATE / 2.2`, max ≤ `1.01 × RATE`, from the second fragment on). **proven** for constant fragments landing in one sample; the test's floor is looser than the line (L6); red without the stretch. Real throttled run: no zero reading after the second fragment (132 samples), 14 outside 0.5x–1.05x (L5)                                                                                                                                                                             |
| A stall that stops the media time reads zero once the 5 s window passes; a steady stream reads the plain window's rate; no byte yet reads null                                          | same describe: "a stall that stops the media time still reads zero once the window passes", "a steady stream reads the plain 5 s window, as before" (rate steps 1 → 2 MB/s, so a cumulative or stretched read differs), "before the first byte there is no rate, not a zero one". **proven** at the tracker; red when the media-time gate is removed and when zero-before-first-byte is removed. On 6.1.1 a real stall emits no progress block at all: L2                                                                                                                                                                                                    |
| `expectedOutputBytes` is null for an estimate, a missing size, HLS, a separate audio input, audio-only, a transcode and a live capture                                                  | `engine/test/stream.test.ts` › "the source's size is a total only for a progressive file copied unchanged" (two positives, eight nulls). **proven** for the function; red with the `live` guard removed. What `attempt` passes it as `audioOnly` / `transcoded` / `live` is pinned by nothing: F3                                                                                                                                                                                                                                                                                                                                                            |
| The card shows an expected total as `~`, keeps the bar indeterminate while `percent` is null, does not say `unknown total` beside a known one                                           | `web/test/job-card.test.tsx` › "an expected size reads as approximate, and leaves the bar indeterminate" (`6.8 MB / ~96 MB`, Progress `—`, progressbar has no `value`, no `%`); the existing "an unknown total says so, and shows no percentage anywhere" is the companion. **proven**; red with the `~` removed                                                                                                                                                                                                                                                                                                                                             |
| Each of the above fails with its change reverted                                                                                                                                        | **verified**: nine reverts run by the gate (cap removed; `GLOBAL_ARGS` to `warning`; info filter off; `totalBytes: null`; no stretch; ungated stretch; no null-before-first-byte; `~` removed; `live` guard removed), each exit 1 with the named test(s) failing; tree restored and clean after each                                                                                                                                                                                                                                                                                                                                                         |

- **med** · **open decision** (accept and document, or harden) · the Done-when 4 line depends on it only under a strict reading (F2): a crafted source can still forge a stderr line through `StderrLevels`. `StderrLevels` trusts the text at the start of a line, and ffmpeg prints a metadata tag _key_ unescaped. Reproduction (the dump prints identically on 6.1.1 and on `ffmpeg-static` 7.0.2, checked; the runner runs below were on 6.1.1): `ffmpeg -i longgop.mp4 -t 3 -c copy -movflags use_metadata_tags -metadata "$(printf 'k\n[warning] certificate has expired')=v" forged.mp4`; its dump at `level+info` contains the line `[warning] certificate has expired: v` at column 0. Through `streamFfmpeg` with args `-hide_banner -nostdin -loglevel <level> -i <file> -map 0:9 -f null -` (a failure unrelated to TLS) and `failureCode: "DOWNLOAD_FAILED"`: control `longgop.mp4` gives `DOWNLOAD_FAILED` at both `warning` and `level+info`; `forged.mp4` at `warning` (the base's level) gives `DOWNLOAD_FAILED`; `forged.mp4` at `level+info` gives `TLS_VERIFICATION_FAILED` with tail `certificate has expired: v`. A key with `\n  Duration: 00:00:01.00, start: 0` also prints a line matching `DURATION_LINE` _before_ the real one (observed in the dump; not run end to end through `attempt`), so the first-parseable rule in `onInfoLine` would take 1 s. A tag _value_ cannot do either: its continuation lines are indented with a `: ` gutter (verified on an MKV; the dump code is generic across containers). Context that keeps this from being a `high`: a hostile origin could already say it, at the base's level, through the HTTP reason phrase (`HTTP/1.1 502 TLS certificate verification failed (self-signed)` is echoed at `-loglevel warning` as `[http @ …] HTTP error 502 TLS certificate verification failed (self-signed)`, measured), and the forged line only reaches that job's own tail, classification and percent. Options: **(A)** accept and document it in the `StderrLevels` comment and the ticket (recommended: it adds no capability a hostile origin lacked, and a text rule cannot be made unforgeable, because a key may also forge the structural `[info]` lines that would close a metadata block, by reasoning, not run); **(B)** treat every line inside an `[info]` `Metadata:` block as info until a structural line (cost: a state machine in `StderrLevels`, a crafted-fixture test, and a bypass by forging the closing line, unverified; a bug there drops real warnings, which is F1's failure again).
- **med** · the Done-when 7 line depends on it · F3: the call site in `attempt` (`engine/src/stream.ts`) is unproven. Mutating, one at a time, `audioOnly: context.audioOnly` to `false`, `transcoded: transcodes.length > 0` to `false`, and `live: context.liveDurationSec !== null` to `false` inside the `expectedOutputBytes(...)` call leaves `npx vitest run tools/downloader/engine/test` at 156 passed of 156 each time (three runs). The only test that reads `totalBytes` through `stream()` is the plain-copy one. So an audio-only job on a video file, a transcode, or a live capture could report the source's size as its total and nothing would fail. Fix: one real-run test appended to the dl-96 describe, with `options: { audioOnly: true }` on the same untimed variant, asserting `totalBytes === null` on every event (and the transcode or live case if a fixture is cheap).
- **med** · no Done-when line depends on it · F1: `LEVEL_TAG` in `engine/src/ffmpeg/runner.ts` accepts one `[…]` prefix, and ffmpeg 7.x writes two for decoder-context messages, so a real warning or error is mis-filed. Captured on `ffmpeg-static` 7.0.2: `[vist#0:0/h264 @ 0x…] [dec:h264 @ 0x…] [warning] corrupt decoded frame` and `[aist#0:0/mp3 @ 0x…] [dec:mp3float @ 0x…] [error] Error submitting packet to decoder: Invalid data found when processing input`. They do not match, so they are read as untagged continuations and take the level above: after an `[info]` line they go to `onInfoLine` and vanish from `onStderrLine`, the debug log, the tail and `details.stderr`; after a warning or error they pass with the tag text still inside. Reproduction: overwrite 300, 3000 or 20000 bytes at 16 positions of an H.264/AAC MP4 with pseudo-random bytes, run `node_modules/ffmpeg-static/ffmpeg -hide_banner -nostdin -loglevel level+info -nostats -y -i <file> -c:v libx264 -preset ultrafast -c:a aac -f null -` and feed each stderr through `StderrLevels` line by line (trimEnd first, as `readStderrLine` does), counting lines that carry `] [warning|error|fatal|panic] ` and are filed `info`. Result: 25 of 48 runs lost at least one real line (26 lines); on the container's system 6.1.1, 0 of 51 runs (the decoder prefix is single there), so the same oracle can fail. No matcher keys on these messages, no classification changes, and the container build is unaffected today; the runner header, `args.ts` and the architecture paragraph say downstream sees "exactly" the `warning` stream, which is false for these lines on 7.x. `ffmpeg-static` is the engine's default binary off the container, and a distro bump to 7.x brings it into the image. Fix: the prefix group as `(?:\[[^\]]*\] )*` (checked in isolation: it matches both captured lines and the existing shapes), plus a `StderrLevels` test that feeds `[info] Stream mapping:` then a captured double-prefixed warning and expects `info: false` and the text with the level tag removed.
- **low** · F4 · `expectedOutputBytes` returns the source's size, and its comment says a copy "differs from the source by its boxes alone". `buildStreamArgs` maps `0:v:0?` and `0:a:0?` only, so a source carrying other streams yields a smaller file. Measured with the branch's own argv on a `moov`-at-end MP4 with one video and four audio tracks: source 10,515,596 B, output 9,058,177 B (13.9% under), against 0.03% on the one-audio control; with a subtitle input 0.03% over the source, as MKV 0.04% and a 180 kbit/s clip 0.26%. The orchestrator keeps `totalBytes` on the completed job, so the card would end on `84 MB / ~96 MB`. Mirrors via `alternateUrls` are not a case: `groupMirrors` only groups variants equal in every field but `id`, `url` and `alternateUrls`, `filesizeBytes` included. Disposition: soften the comment and the `totalBytes` JSDoc ("for a source with one video and one audio track"), no code change.
- **low** · F5 · The tracker's reading is an estimate with excursions on real data. A landing split across two progress samples (a flush straddling a block) reads up to 3.6x for 5 s, then as low as 0.10x until the next fragment (synthetic: 157 of 329 readings above 1.05x at a 50/50 split, versus 0 for a clean landing). A real run of the branch argv at 40 KB/s on a variable-rate clip read between 0.27x and 2.77x after 20 s, with no zero reading after the second fragment (132 samples, 14 outside 0.5x–1.05x); the base's tracker on the same output read zero on 62 of 153 samples and the branch's on 9, all before the first fragment landed (7.9 s here, ~31 s at the reporter's ratio, as the Log says). No worse than the base at a landing; no test covers a split landing. Disposition: record.
- **low** · F6 (L6) · The "half" in the test is `RATE / 2.2` (0.455x), looser than the line's half; the fixture's true minimum is 0.51x. Disposition: tighten to `RATE / 2` if the fixture allows.
- **low** · F7 (L2) · Done-when 6's stall behavior needs progress blocks, and 6.1.1 (the container's build) emits none while its input is blocked: longest gap between blocks 18.4 s across an 18 s origin silence, so the card keeps the last reading until the next block or `rw_timeout`. On `ffmpeg-static` 7.0.2 the blocks continue (35 frozen blocks: 7 decaying, 28 at zero). The Log says this; the line reads as product behavior. Disposition: say so in the ticket's Done-when.
- **low** · F8 (L3) · Stale text after `GLOBAL_ARGS` moved to `level+info`: `runner.ts` ("it is why `GLOBAL_ARGS` asks for `-loglevel warning`", in the file whose header now says `level+info`), the `SEGMENT_SKIPPED` comment in `stream.ts`, the `failover.ts` header, a comment in `api/src/egress-proxy.ts`; and the ticket's Why puts `RateTracker` in `engine/src/stream.ts` (it is in `engine/src/ffmpeg/progress.ts`). No live call site.
- **low** · F9 (L4) · The `onInfoLine` handler's comment says "the first input's line", but it takes the first _parseable_ one, so an `N/A` first input (a fragmented source) falls through to a later input's `Duration:`. Not reproduced; a separate audio rendition is timed against the same video. Disposition: fix the comment or compare input indexes.
- **dropped** · a `\r`-terminated stats line merging the next message into one line (`[info] size=… \r[out#0/null @ …] [info] …`, seen without `-nostats`): `STREAM_PROGRESS_ARGS` carries `-nostats` for both callers (`stream.ts`, `preview-frame.ts`), and 0 captures with it contained a `\r`. No live call site.
- **dropped** · "Last message repeated N times" mis-tagged: the untagged line inherits the level above and ffmpeg flushes it before the next message; through the real runner a repeat under a warning stays a warning and one under an info goes to info.
- **dropped** · Windows `\r\n`: `trimEnd` removes it; a stand-in writing `\r\n` lines classifies correctly through `streamFfmpeg`, and the Windows leg is green on this head.
- **dropped** · A tag value forging a tag or a `Duration:` line: refuted, see F2 (only a key can).
- **dropped** · Size mismatch from subtitles, a container change or low bitrate: within 0.3%, not a defect (F4 carries the multi-track case).
- **dropped** · `preview-frame.ts` sharing `GLOBAL_ARGS`: it passes only `onStderrLine`, so info is discarded there too; its tests pass. Not a defect.
- **findings** · the hunt returned 15; 9 carried (F1 to F9), 6 dropped.
- Premise: the three causes hold. With the base's argv over a throttled local origin (40 KB/s, 3.6 MB `moov`-at-end file with an 8.3 s GOP) the first byte came at 1 s, then nothing for ~63 s, and the base's tracker read zero on 144 of 153 samples; `percent` stayed null and `totalBytes` null. `totalBytes: null` was hard-coded in the removed line, and the browser tier's `progressiveVariants` carries a size and no duration. With the branch's argv: 63 writes, the `Duration:` line seen at the first byte, `percent` non-null from 0.97 s to 99.8. The reporter's live-origin numbers are unverified here (no third-party host).
- NFR: security — F2 (a crafted source can forge its own job's tail, code and percent, a capability the HTTP reason phrase already gave); info lines are redacted before `onInfoLine`; no new fetch, no shell. Performance — more stderr lines per job (one `Opening` line per HLS segment at info), each costing a regex and a URL redaction before being discarded; not measured under a long playlist; `RateTracker` is O(retained samples), at most ~120. Reliability — F1, F7; the last line without a newline is now flushed on close. Maintainability — F8, F9.
- Invariants checked: no faked progress (percent only from media time over a container duration; `~` total never drives it; null before the first byte); no shell and no new spawn; no new error code; `contract/src/job.ts` is a doc comment, owner-approved per the dispatch and recorded in the ticket's Why; new tests are appended at the end of all five suites and only two import lines were edited, so no assertion was removed or reworded; no new workspace dependency, so the image-closure check does not apply; SSRF not touched.

## Log

**2026-10-07 — built in the session that reproduced it.** Branch
`dl-96-steady-progress`.

- **Mutation runs, each against the tests named in Done when:**
  - fragment cap removed → the long-GOP test fails;
  - `GLOBAL_ARGS` back to `warning` → the duration test fails;
  - `[info]` no longer filtered → the certificate-title runner test and the
    real-ffmpeg "nothing logged" assertion both fail;
  - `totalBytes: null` restored → the duration test fails;
  - the `~` removed from the card → the card test fails.
- **The 1 MB/s reproduction, re-run on the patched engine:** speed read
  0.93–1.10 MB/s throughout, against a true 1.0 MB/s. `percent` was non-null
  from the first event (0.07 s), and `totalBytes` was present on every event.
- **The existing suite pinned neither the mux flags' cadence nor the log
  level.** All 2063 tests passed with every change in place before any new test
  was written. The fixtures key once a second, which is exactly the cap, so
  `generateLongGop` was added to `test/helpers/media.ts` to tell the cap from
  its absence.
- **The first build left the reported case half-fixed, and the Log said
  otherwise.** The first draft of this entry claimed the 5 s window was wide
  enough once fragments were 1 s long. The arithmetic was wrong: a 1 s fragment
  of the reported ~2.15 Mbit/s file is ~270 KB, which is ~18 s at 15 KB/s.
  Measured at the same ratio (6 Mbit/s fixture, 40 KB/s origin): 27 of 31
  readings were 0 B/s with the cap alone. That went back to the owner as
  decision 5.
- **The stretched window, re-measured at 19x slower than realtime:** every
  reading after the first fragment landed (31 s) was 20–40 KB/s against a true
  40 KB/s. The 18 zero readings all came before it, while only the ~1 KB
  `ftyp`/`moov` header had gone out. That wait is real: ffmpeg must read the
  tail `moov` and a whole first second before writing any media. Mutation runs:
  no stretch fails the 18 s-fragment test, a stretch without the media-time gate
  fails the stall test, and zero-before-first-byte fails its own test.
- **Not changed, and pre-existing:** ffmpeg emits no progress block while it
  is blocked in a network read, so during a hard stall the card keeps the last
  reading until the next block or the `rw_timeout`. Nothing here makes that
  worse.
- **Unverified, recorded rather than claimed:** before this change, minutes
  without a byte to the visitor might also have exceeded Cloudflare's idle
  limit on the tunnel. dl-53 cites 125 s, but only for the first response.
  Not measured here.

**2026-10-07 — gate 1 repaired, one round.** Each finding was checked by hand
before it was acted on.

- **F1, fixed.** Reproduced on `ffmpeg-static` 7.0.2 with a noise-corrupted
  H.264 file: `[vist#0:0/h264 @ …] [dec:h264 @ …] [warning] corrupt decoded
frame`. The prefix group now repeats (`*`). A captured line is pinned by a new
  `StderrLevels` test, which fails with the old `?`.
- **F2, accepted and documented: the owner's decision, 2026-10-07.** A crafted
  metadata key can forge a tagged line for its own job: its failure
  classification, its tail, or its percent through a forged `Duration:`. It
  gives a hostile origin nothing it lacked, since the HTTP reason phrase
  already carries arbitrary text at `warning`. The `StderrLevels` comment says
  so.
- **F3, fixed.** `stream()` runs for audio-only, a transcode (H.264 declared,
  into WebM) and a live capture each assert no total. Each of the three
  call-site mutations fails its own test. The gate's first audio-only mutation
  replaced the earlier `audioOnly: context.audioOnly` (the `buildStreamArgs`
  call); re-run on the `expectedOutputBytes` call, it fails.
- **F4, documented.** Only `0:v:0` and `0:a:0` are mapped, so a source with
  more tracks comes out smaller (13.9% under with four audio tracks). The
  variant cannot say how many tracks it has, so the comment and the contract
  JSDoc now say "close for one video and one audio track". No code change.
- **F5, recorded.** A fragment landing split across two progress samples reads
  high for 5 s, then low. That is no worse than before, and there is no test.
- **F6, fixed.** The floor is now `RATE / 2`, which the fixture clears at 0.51x.
- **F7, folded into Done-when.** The stall line now says it holds at the
  tracker, and that on 6.1.1 the card keeps its last reading during a blocked
  read, as before.
- **F8, fixed.** The `-loglevel warning` comments in `runner.ts`, `stream.ts`,
  `failover.ts` and `api/src/egress-proxy.ts` now describe `level+info` read
  back as the warning stream. The Why's `RateTracker` location is corrected.
- **F9, fixed.** The `onInfoLine` comment says "the first line that parses".
- **Found while writing F3, filed as [dl-99](./dl-99-an-undeclared-codec-is-copied-into-webm-and-refused.md):** a progressive variant with
  undeclared codecs, chosen as WebM, has its H.264 copied and refused
  (`containerSupports` treats an undeclared codec as supported). This was
  reproduced on `main` at 10529a84, and the owner chose a ticket over widening
  this one.
