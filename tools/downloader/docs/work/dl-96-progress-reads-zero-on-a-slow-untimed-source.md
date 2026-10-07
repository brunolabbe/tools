---
id: dl-96
tool: downloader
title: A slow progressive source reads 0 B/s and `unknown total` although the probe measured its size
kind: fix
status: in-flight
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
handed to the reader (`engine/src/stream.ts`, `RateTracker`). The MP4 muxer ran
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
- A stall that stops the media time reads zero once the 5 s window passes; a
  steady stream reads the plain window's rate; no byte yet reads null.
- `expectedOutputBytes` is null for an estimate, a missing size, HLS, a
  separate audio input, audio-only, a transcode and a live capture.
- The card shows an expected total as `~`, keeps the bar indeterminate while
  `percent` is null, and does not say `unknown total` beside a known one.
- Each of the above fails with its change reverted.

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
