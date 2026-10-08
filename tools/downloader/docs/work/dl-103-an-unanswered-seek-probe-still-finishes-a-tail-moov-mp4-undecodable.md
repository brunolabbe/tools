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

What C would see, sampled by the same gate: in **4 of 4** sampled garbage rows
(row 2's `403` on `bytes=1-1`, row 10's socks proxy, row 8's chain past the
limit, row 6's six redirects), ffmpeg logged exactly one `partial file` line and
one `Stream ends prematurely`, and the `partial file` line had reached the
engine's stderr handler **before `stream()` resolved**. Sampled on
ffmpeg-static 7.0.2 only. Not sampled: ffmpeg 6.1.1, and the other four rows.

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
   frames decoding. Row 3 is the one that regressed with dl-102 and is worth
   its own case.
2. **Measure on the bundled ffmpeg (6.1.1)** what dl-102's gate measured on
   7.0.2: that `partial file` arrives, and whether it arrives before the first
   byte, across the eight rows.
3. **Measure the false-positive side** on what C's text left unmeasured: a
   healing progressive body cut inside the `moov` itself, beside dl-53's
   existing heal controls, which must stay green.
4. Then the shape: a typed error before the first byte when `partial file`
   arrives first, otherwise a cut connection and `done` rejecting, in
   `stream.ts` beside `STREAM_ENDED_EARLY`. Which code it carries is the
   build's to settle and record in the Log.

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
