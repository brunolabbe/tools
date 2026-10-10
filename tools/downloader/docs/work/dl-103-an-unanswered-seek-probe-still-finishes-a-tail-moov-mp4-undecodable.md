---
id: dl-103
tool: downloader
title: An unanswered seek probe still finishes a tail-moov MP4 from a Range-ignoring origin undecodable
kind: fix
status: ready
milestone: null
depends_on: [dl-102]
difficulty: hard
---

# dl-103 — An unanswered seek probe still finishes a tail-moov MP4 from a Range-ignoring origin undecodable

## Why

[dl-102](./dl-102-a-range-ignoring-origin-finishes-a-tail-moov-mp4-undecodable.md)
asks a progressive file's origin, before ffmpeg starts, whether it honours
`Range`, and refuses a tail-`moov` MP4 from one that does not with
`SOURCE_NOT_SEEKABLE`. When the probe gets **no answer** it lets ffmpeg run,
so that ffmpeg's own failures keep their codes. dl-102's gate 1 measured what
that leaves behind: on an origin that ignores `Range`, 8 of 13 no-answer paths
still end in a clean response and a `done` that resolves with a file of which
0 of 100 frames decode, which is the defect dl-102 fixes for the answered case.
Two of the eight are worse than before dl-102: a one-shot fault on the first
request is now spent on the probe, and ffmpeg then runs into the defect where
it used to fail with `DOWNLOAD_FAILED`.

The owner decided on 2026-10-08, on dl-102, to keep the fallback and file this
ticket: option C from dl-102's "Options not taken", as a second line of
defence behind the probe rather than in place of it. The question, the
options and the choice are in dl-102's Log.

### Reproduction

From dl-102's gate 1 (Sonnet 5.5), at `2f91f2e`, its Item 4. A tail-`moov`
fixture of 1.02 MB (`ftyp,free,mdat,moov`) unless a row says otherwise, served
by an origin that ignores `Range`, through `engine.stream()`; ffmpeg-static
7.0.2 and the distro ffmpeg 6.1.1 gave the same outcome in every row. Each of
these ends with `done` resolved and 0 of 100 frames decoding:

| Row | The probe gets no answer because                                         | Before dl-102     |
| --- | ------------------------------------------------------------------------ | ----------------- |
| 2   | the origin answers `403` or `416` to `bytes=1-1` only                    | the same garbage  |
| 3   | a `429` or `500` on the first request only                               | `DOWNLOAD_FAILED` |
| 4   | the probe times out (15 s) and ffmpeg's requests are answered            | the same garbage  |
| 5   | the first request's connection is reset                                  | the same garbage  |
| 6   | six redirects: the probe follows 5, ffmpeg 8                             | the same garbage  |
| 8   | a box chain past the walk's 1 MiB limit (`ftyp,free(1.5 MiB),mdat,moov`) | the same garbage  |
| 10  | the proxy URL is not `http://` (`socks5://`), so the probe sends nothing | the same garbage  |
| 13  | the first `CONNECT` only is refused                                      | `DOWNLOAD_FAILED` |

Rows 1, 11 and 12 (a `404` everywhere, an untrusted certificate, every
`CONNECT` refused) fail with ffmpeg's own code, and rows 7 and 9 (a Matroska
body, a fast-start file past the limit) stream a good file; none of those five
is this ticket's.

**A ninth case, found by dl-102's gate 2 and not in the table above:** an
origin that honours bounded ranges and answers open-ended ones with the whole
file as `200`. Here the probe does get an answer: it asks `bytes=1-1`, gets
`206` and says `seekable`; ffmpeg asks `bytes=0-` twice and is given the
garbage. Measured by gate 2 at `040d42f` through `engine.stream()`:
`0/100 frames, done=resolved(37609)`, the origin seeing
`bytes=1-1 , bytes=0- , bytes=0-`. No real server of this shape was found. It
ends in the same file as the eight rows, so this ticket carries it with them;
it is recorded in dl-102's Log.

What C would see, sampled by the same gate: in **4 of 4** sampled garbage rows
(row 2's `403` on `bytes=1-1`, row 10's socks proxy, row 8's chain past the
limit, row 6's six redirects), ffmpeg logged exactly one `partial file` line and
one `Stream ends prematurely`, and the `partial file` line had reached the
engine's stderr handler **before `stream()` resolved**. Sampled on
ffmpeg-static 7.0.2 only. Not sampled: ffmpeg 6.1.1, and the other four rows.

## Decisions

Taken by the owner on 2026-10-08.

1. **Which error code the build raises: `SOURCE_NOT_SEEKABLE`.**
   - Question: dl-103, filed on the dl-102 branch, will spot ffmpeg's
     `partial file` line and fail the job when the seek probe got no answer.
     Its brief left the error code to its builder, but the code is a
     `@downloader/contract` question, which the owner answered for dl-102.
     Which code should dl-103 raise?
   - Options put: reuse `SOURCE_NOT_SEEKABLE` (recommended): the same cause,
     the same visitor copy, not retryable, one comment-only contract edit to
     widen its doc comment ("raised before the first byte"), dl-103 stays
     `ready`; a new non-retryable code; `DOWNLOAD_FAILED`; decide later
     (`needs-decision`).
   - **Chosen: reuse `SOURCE_NOT_SEEKABLE`.** It was the recommendation of
     dl-102's gate 2 (N5) and of the orchestrator. The comment-only widening of
     its doc comment in `@downloader/contract` is part of this ticket's build
     and is pre-authorised by this answer.

## Build

Option C, as dl-102's "Options not taken" put it, copied rather than
re-derived:

> **C. Detect it after the fact, from ffmpeg's own words.** Treat `partial file`
> (from the mov demuxer), or a `Stream ends prematurely` whose reconnect then
> fails to find the index, as a loss. Cost: partly measured, by gate 1 on
> 2026-10-08. `partial file` appears in this reproduction's log and in dl-53's
> cut-body cases. (a) A progressive body that is cut and then healed does not
> log it: dl-53's Log says so for its healing control, and gate 1's run that cut
> a roughly 1 MB tail-`moov` file at 50% and let ffmpeg reconnect logged only
> `Stream ends prematurely` and `Will reconnect`, and decoded 100 of 100. So it
> was not a false positive in the one healing case run. (b) In 5 of 5 runs
> `partial file` reached the engine's `onStderrLine` before `stream()` resolved,
> that is before the first byte reached the reader. stdout and stderr are
> separate pipes, so that is observed order, not a guarantee; if it held, C
> could refuse before the first byte rather than cut a connection (a typed error
> before the first byte when `partial file` arrives first, otherwise the cut
> connection and `done` rejecting). Not measured: other ffmpeg versions, and a
> healing case that is cut inside the `moov` itself.

The open questions are those of that text, and the build answers them by
measurement before it commits to a shape:

1. **Reproduce first**, as the next test at the end of
   `engine/test/stream.test.ts`: a row above that ends in garbage on `main`
   after dl-102 (row 2 is the simplest to serve), red with `done` resolved and 0
   frames decoding. Rows 3 and 13 are the ones that regressed with dl-102 (both
   were `DOWNLOAD_FAILED` on `main`) and are worth their own cases.
2. **Measure on the distro ffmpeg, 6.1.1** (the image's: the `Dockerfile`
   installs it and sets `FFMPEG_PATH=/usr/bin/ffmpeg`; run with that variable
   set, since the bundled `ffmpeg-static` in a checkout is 7.0.2 and is what
   the default picks) what dl-102's gate measured on 7.0.2: that
   `partial file` arrives, and whether it arrives before the first byte,
   across the eight rows and the ninth case. Print `ffmpeg -version | head -1` for the
   binary used into the Log beside the counts.
3. **Measure the false-positive side** on what C's text left unmeasured: a
   healing progressive body cut inside the `moov` itself, beside dl-53's
   existing heal controls, which must stay green.
4. Then the shape: a typed error before the first byte when `partial file`
   arrives first, otherwise a cut connection and `done` rejecting, in
   `stream.ts` beside `STREAM_ENDED_EARLY`. The error is
   `SOURCE_NOT_SEEKABLE`, decided by the owner (see Decisions). Widen that
   code's doc comment in `@downloader/contract` (`contract/src/errors.ts`) as
   part of this build: it now says "Raised before the first byte, from a probe
   of the origin itself", which the after-the-first-byte branch contradicts.
   The edit is comment-only and pre-authorised by the owner's answer; change
   nothing else in the contract.

## Done when

1. A test at the end of `engine/test/stream.test.ts` reproduces at least row 2
   and row 3 above, red on `main` with `done` resolved and 0 frames decoding.
2. After the fix, neither ends with `done` resolved on an undecodable file:
   each rejects `stream()` or `done` with a typed `AppError`, and the Log names
   the code and why.
3. dl-53's healing controls in `stream.test.ts` still complete whole, and a new
   control for a body cut inside the `moov` and healed completes whole too.
4. The Log records the 6.1.1 measurement of step 2 with its counts.
5. `npm test -- --project downloader` and `npm run check` pass.

## Log

**2026-10-08** — filed by dl-102's builder, on the owner's decision of the
same day (recorded on dl-102) to keep the probe's fallback and carry option C
here. No source changed by this filing. The reproduction is dl-102's gate 1's
measurement, not this builder's, and was not re-run for the filing.

**2026-10-10** — built (Opus 5.5, builder), on `origin/main` at `7709411e`.

**The shape.** `PARTIAL_FILE` in `engine/src/stream.ts`, beside
`STREAM_ENDED_EARLY`: on a progressive variant, the mov demuxer's
`offset 0x…: partial file`, read while no early end is unanswered, terminates
ffmpeg with `SOURCE_NOT_SEEKABLE`. Before the first byte that is a refusal like
the probe's (the next mirror is tried, no retry without subtitles), and
`details.afterFirstByte` is `false`; after it the stream is cut and `done`
rejects, `afterFirstByte: true`. The code is the owner's (Decisions, 1): the
same cause, the same visitor copy, not retryable. The contract change is the
doc comment of `SOURCE_NOT_SEEKABLE` only, in `contract/src/errors.ts`.
`index.ts`'s caller notes and `seek-probe.ts`'s header now say the gap is
caught, rather than that dl-103 will catch it.

**Step 1, red on main.** Four cases at the end of `engine/test/stream.test.ts`
(rows 2, 3, 5 and the ninth case, served by an origin that ignores `Range`),
plus a mirror case. Before the source change,
`npx vitest run tools/downloader/engine/test/stream.test.ts -t "dl-103"`:
`Tests 6 failed | 2 passed | 56 skipped (64)`, each row failing with
`{"streamed":35164,"done":35164,"decodedFrames":0}: expected 35164 to be 'SOURCE_NOT_SEEKABLE'`,
that is `done` resolved and 0 of 100 frames. After: `Tests 8 passed | 56 skipped (64)`.

**Step 2, measured on 6.1.1.** A scratch harness drove `engine.stream()` from
source against one local origin per row, a 1.02 MB `ftyp,free,mdat,moov`
fixture generated by the same ffmpeg, and recorded every stderr line the
engine logged and whether `stream()` had resolved when it arrived.
`ffmpeg -version | head -1`: `ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers`.

| Row | Shape served                                                        | `main`: outcome               | `partial file` lines | before `stream()` resolved | order         | Head    |
| --- | ------------------------------------------------------------------- | ----------------------------- | -------------------- | -------------------------- | ------------- | ------- |
| 2   | `403` for `bytes=1-1` only                                          | `done` resolved, 0/100 frames | 1                    | 1                          | partial, E, R | refused |
| 2   | `416` for `bytes=1-1` only                                          | the same                      | 1                    | 1                          | partial, E, R | refused |
| 3   | `429` on the first request only                                     | the same                      | 1                    | 1                          | partial, E, R | refused |
| 3   | `500` on the first request only                                     | the same                      | 1                    | 1                          | partial, E, R | refused |
| 4   | first request held 16 s, the probe times out at 15 s                | the same                      | 1                    | 1                          | partial, E, R | refused |
| 5   | first connection reset                                              | the same                      | 1                    | 1                          | partial, E, R | refused |
| 6   | six redirects                                                       | the same                      | 1                    | 1                          | partial, E, R | refused |
| 8   | `ftyp,free(1.5 MiB),mdat,moov`, chunk offsets moved with it         | the same                      | 1                    | 1                          | partial, E, R | refused |
| 10  | `proxyUrl: socks5://…`, the probe sends nothing                     | the same                      | 1                    | 1                          | partial, E, R | refused |
| 13  | `https:` origin through a `CONNECT` proxy refusing the first tunnel | the same                      | 1                    | 1                          | partial, E, R | refused |
| 9th | bounded ranges honoured, `bytes=0-` answered whole                  | the same                      | 1                    | 1                          | partial, E, R | refused |

E is `Stream ends prematurely`, R its `Will reconnect` from the same
connection. **11 of 11 shapes: exactly one `partial file`, before `stream()`
resolved, and before any early end.** "Head" is the same harness after the
change: `SOURCE_NOT_SEEKABLE` thrown by `stream()`, before the first byte, in
11 of 11. The bundled ffmpeg-static (`ffmpeg version 7.0.2-static`) gave the
same counts and the same order in all 11 on `main`, and 11 of 11 refused on the
head. Row 13 is in the harness and not in the suite: the engine's suite has no
TLS origin or `CONNECT` proxy to serve it, and from ffmpeg's side it is row 3's
shape (the origin saw ffmpeg's two `bytes=0-` only; the proxy saw 3 tunnels).

**Step 3, the false-positive side.** Healing controls, from an origin that
honours `Range`: the file cut half-way through the `moov` on ffmpeg's read of
the tail (`bytes=<moov offset>-`) and resumed on reconnect logged E then R, no
`partial file`, and decoded 100 of 100 on both ffmpegs. It is now
"control: a body cut inside the moov and healed on reconnect completes whole"
in the suite. dl-53's heal controls stay green (whole spec below).

**What the brief had wrong.** `partial file` is not only the unseekable
origin's word. dl-53's "a progressive body cut after the first byte and never
served again fails the stream" turned from `DOWNLOAD_FAILED` to
`SOURCE_NOT_SEEKABLE` on the first version of the change
(`Tests 1 failed | 63 passed (64)`, `expected AppError: This video can't be streamed fr… to match object { code: 'DOWNLOAD_FAILED' }`).
Its stderr, measured: four rounds of E, R and `HTTP error 404`, a last E with
no R, then `partial file`. Hence the guard: `partial file` counts only while no
early end is unanswered, and that cut stays `DOWNLOAD_FAILED`. Option C's
"or a `Stream ends prematurely` whose reconnect then fails to find the index"
was not needed: in every unseekable run `partial file` came first.

**A third shape `partial file` also names, measured and not settled here.** A
fast-start file stored truncated at its origin (the first 60% of
`faststart.mp4`, served with a matching `Content-Length`, by an origin that
honours `Range` and by one that does not), on 6.1.1: on `main`, `done`
resolved with 620,240 bytes and 59 of 100 frames, a short file reported as
whole; on the head, `done` rejects with `SOURCE_NOT_SEEKABLE` after the first
byte (`partial file` arrived after it, with no early end), so it fails, but
under copy that says the index is at the end, which it is not. Put to the
orchestrator as an open decision; the build ships the ticket's shape.

**Branch coverage, by mutation.** Each check below fails when the line it
pins is removed, and passes with it:

- `firstChunk` already holding a chunk when the refusal is decided (a stand-in
  that ignores SIGTERM, so the kill takes its grace):
  "`partial file` before the first byte refuses the stream, and after it cuts
  the stream" failed with `expected undefined to be 'SOURCE_NOT_SEEKABLE'`.
  Real ffmpeg dies at once and reaches the refusal through `firstChunk`
  rejecting, which the row cases pin.
- the progressive-only guard: "control: the same line from an HLS stream is
  not read as an unseekable origin" failed, `promise rejected … instead of resolving`.
- the unanswered-early-end guard: dl-53's never-served-again case, above.

**Verification.** `npx vitest run tools/downloader/engine/test/stream.test.ts`
on 6.1.1 (`FFMPEG_PATH=/usr/bin/ffmpeg`, as this container sets it):
`Tests 64 passed (64)`. On 7.0.2: 50 passed, 14 failed, every one of them an
HLS case answering `502` (dl-102's and dl-103's progressive cases all passed);
this sandbox's ffmpeg-static is known to fail on HLS, and those cases were not
run against `main` on 7.0.2 to prove it. The stand-in cases are skipped on
Windows, as dl-53's are; the four row cases and the mirror case run there, and
the order of `partial file` against the first byte on Windows is unmeasured.

**Fold-in.** None was free: no other open ticket names `partial file`, and the
roadmap and architecture docs do not mention `SOURCE_NOT_SEEKABLE`.
