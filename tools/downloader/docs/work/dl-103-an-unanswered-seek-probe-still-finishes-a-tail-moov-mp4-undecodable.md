---
id: dl-103
tool: downloader
title: An unanswered seek probe still finishes a tail-moov MP4 from a Range-ignoring origin undecodable
kind: fix
status: done
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

Taken by the owner on 2026-10-08 (1) and 2026-10-10 (2).

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

2. **What a short source gets: a failed download, wherever the shortness
   shows.** The owner's answer of 2026-10-10, asked by the orchestrator after
   gate 1 at `42d0fb1f`.
   - Question: "What should a short source get?" Gate 1 (F1) measured a
     fast-start file stored truncated at its origin, at 5% to 99.9%, and a
     fragmented one at 60%: the first build failed each with
     `SOURCE_NOT_SEEKABLE`, after the whole body was handed over or before the
     first byte, under copy that is false for it; `main` resolved `done` with
     the frames missing.
   - Options put: "A failed download, wherever the shortness shows" (the
     orchestrator's recommendation): only a proven unseekable source gets
     `SOURCE_NOT_SEEKABLE`, a short one `DOWNLOAD_FAILED`, before or after the
     first byte; the builder finds and measures a signal that separates the
     two, and stops with the measurement if none does. "Builder's split: after
     the first byte = failed download" (the builder's recommendation in its
     report on `42d0fb1f`), which leaves the 5% and fragmented files wrong.
     "Ship as built, file a follow-up".
   - **Chosen: a failed download, wherever the shortness shows.** It overrode
     the builder's recommendation. Any comment change to `SOURCE_NOT_SEEKABLE`
     stays under answer 1's pre-authorisation; no other contract change is
     authorised.

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

## Review

**Gate: FAIL** — 2026-10-10 · `7709411e..42d0fb1f` · Sonnet 5.5, depth full

Binaries: every real-ffmpeg result below is from the distro `ffmpeg version 6.1.1-3ubuntu5` (`/usr/bin/ffmpeg`) and from the bundled ffmpeg-static 7.0.2 (`FFMPEG_PATH` unset), and gave the same outcomes unless a row names one binary. This container exports `FFMPEG_PATH=/usr/bin/ffmpeg`, so a bare `npx vitest` run is 6.1.1.

| Done when                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Row 2 and row 3 reproduced at the end of `stream.test.ts`, red on `main`                  | `engine/test/stream.test.ts` › "dl-103: an unanswered seek probe › row 2: a 403 for the probe's bytes=1-1 only, from an origin that ignores Range, is SOURCE_NOT_SEEKABLE" and "› row 3: a 500 on the first request only, …". **Verified**: the branch's test file run against `main`'s `src` gives `6 failed \| 2 passed \| 56 skipped (64)`, each row `{"streamed":35164,"done":35164,"decodedFrames":0}`: `done` resolved, 0 of 100 frames. |
| 2. After the fix each rejects `stream()` or `done` with a typed `AppError`; the Log says why | The same two tests, asserting `stoppedWith(outcome)` is `"SOURCE_NOT_SEEKABLE"`; the Log names the code and the owner's Decision 1. **Proven**: 64 of 64 pass on 6.1.1; on 7.0.2 the 8 dl-103 tests pass.                                                                                                                                                                                                                                      |
| 3. dl-53's heal controls stay whole; a new control for a body cut inside the `moov` is whole | "control: a progressive body cut once and resumed on reconnect completes whole", "control: a separate audio rendition cut once and resumed …", the interleaving stand-ins, and the new "control: a body cut inside the moov and healed on reconnect completes whole". **Proven**: green on 6.1.1 (64 of 64); on 7.0.2 the failing 14 are HLS cases and are the same 14 on `main`.                                                              |
| 4. The Log records the 6.1.1 measurement of step 2 with counts                               | The Log's table and `ffmpeg -version` line. **Verified**: I re-ran rows 2 (403), 3 (500), 5, 6, 10 and the ninth case on both binaries, `main` against the head: `main` gives `done` resolved, 0 frames, exactly one `partial file`, logged before `stream()` resolves; the head refuses before the first byte, `SOURCE_NOT_SEEKABLE`, `retryable=false`. Not re-run: rows 2 (416), 3 (429), 4, 8, 13.                                         |
| 5. `npm test -- --project downloader` and `npm run check` pass                               | `npm run check` exit 0 on this tree (mine). CI at this head: `test (ubuntu-latest)` pass, `245 passed \| 1 skipped` files and `4845 passed \| 2 skipped` tests with `stream.test.ts` at 64 tests; `check` pass. I did not run the nine-minute downloader project locally.                                                                                                                                                                      |

Positive controls, each on a scratch copy of the head and restored byte-identical (`diff` empty) afterwards:

- `const progressive = request.variant.protocol === "progressive"` replaced by `true`: `1 failed | 7 passed | 56 skipped (64)`; "control: the same line from an HLS stream is not read as an unseekable origin" fails with `promise rejected "AppError: This video can't be streamed fr…" instead of resolving`. It is the only test pinning the scoping, and it is a stand-in (skipped on Windows).
- `endedEarly.size === 0 &&` removed: dl-53's "a progressive body cut after the first byte and never served again fails the stream" fails (`1 failed | 27 passed | 36 skipped`).
- the `if (unseekable !== null)` block after `firstChunk` removed: "`partial file` before the first byte refuses the stream, and after it cuts the stream" fails with `expected undefined to be 'SOURCE_NOT_SEEKABLE'`.

Findings:

- **high** · open decision, measurement only (no recommendation, as dispatched) · `nfr:reliability` · **F1: a source that is merely short is refused as `SOURCE_NOT_SEEKABLE`, and the visitor copy and the doc comment are false for it.** `PARTIAL_FILE` fires on any `partial file` from a progressive source with no early end outstanding, and `attempt()` knows neither the probe's verdict nor the file's layout. Graded `high` by the table's clause on shipped text and on a comment stating a bound the code does not keep; which way to resolve it is the owner's.
  - Origin: `generateLargeProgressive`'s fast-start file (1,018,927 B; boxes `ftyp@0 moov@32 free@3957 mdat@3965`) stored truncated to its first N%, `Content-Length` and the `Content-Range` total equal to what is stored; it either answers `Range` with `206` or ignores it with `200`. In both the seek probe gets an answer.
  - Measured through `engine.stream()`. On `main` every row is `stream()` ok and `done` resolved. "After" is relative to `stream()` resolving, which is the first byte; times are 6.1.1.

    | stored                                  | `main`: bytes handed over, frames decoding | head                                            | `partial file` vs first byte |
    | --------------------------------------- | ------------------------------------------ | ----------------------------------------------- | ---------------------------- |
    | first 5%                                | 48,602, 3                                  | `stream()` rejects `SOURCE_NOT_SEEKABLE`        | before                       |
    | 20%                                     | 201,665, 18                                | `done` rejects after 201,665 B were handed over | after, 1 ms                  |
    | 40%                                     | 405,924, 39                                | `done` rejects after 405,924 B                  | after, 4 ms                  |
    | 60%, answered `206` or `200`            | 610,160, 60                                | `done` rejects after 610,160 B                  | after, 6 to 8 ms             |
    | 80%                                     | 814,383, 80                                | `done` rejects after 814,383 B                  | after, 9 ms                  |
    | 95%                                     | 967,386, 95                                | `done` rejects after 967,386 B                  | after, 9 ms                  |
    | 99.9% (one frame short)                 | 1,017,358, 99                              | `done` rejects after 1,017,358 B                | after, 11 ms                 |
    | fragmented MP4, first 60%               | 256,612, 25                                | `stream()` rejects                              | before                       |
    | fast-start 60%, sent chunked, clean end | 610,160, 60                                | `done` rejects after 610,160 B                  | after, 6 ms                  |

    The 5% to 99.9% rows ran on both binaries (7.0.2 is 1 B smaller throughout, same outcomes; its 60% delay is 2 to 4 ms); the fragmented and chunked rows on 6.1.1 only. The 60% case, 12 repeats per binary: 24 of 24 `done` rejects, `partial file` after `stream()` resolved. A whole fragmented MP4 completes on both trees, and a tail-`moov` file stored truncated to 60% (no `moov` at all) is `DOWNLOAD_FAILED` on both.

  - In the short-source runs `partial file` was the only one of `partial file` / `Stream ends prematurely` / `Will reconnect` in the log, at the offset where the stored file ends (`0x96622` for 60%). In every unseekable run the order was `partial file`, `Stream ends prematurely`, `Will reconnect`, at offset `0x30`, the first `mdat` sample of that fixture. Facts only; not a recommendation.
  - The copy against this file. `DEFAULT_ERROR_MESSAGES.SOURCE_NOT_SEEKABLE` says "the file keeps its index at the end, and the source won't let us skip ahead to read it"; the web presentation in `error-presentation.ts` says the same, with `allowRetry: false` and "another quality or format … may work". The `moov` is the first box after `ftyp`, and the origin answered the probe's `bytes=1-1` and ffmpeg's `bytes=0-` with `206`: false on both clauses. The doc comment this diff edits opens "A progressive MP4 whose index (`moov`) is at the end of the file, from an origin that ignores `Range`", which is false for it, and its added clause "when that probe got no answer, from ffmpeg's own `partial file`" is false for it and for the branch's own ninth-case test, where the probe answered `206`. The same scope is stated in `index.ts` ("a tail-`moov` file from an origin that ignores `Range`, and dl-103 when only ffmpeg could tell") and in the `PARTIAL_FILE` docblock ("what a tail-`moov` MP4 from an origin that ignores `Range` produces").
  - What the visitor sees is read from `orchestrator.ts` and `routes/files.ts`, not run over HTTP: before the first byte a JSON 422 carrying this copy; after it the `200` headers have gone, the response is destroyed after the last byte and the job is recorded failed with this code.
  - Options, unranked: keep the behaviour and rewrite the three texts (the copy is a non-comment contract edit, so the owner's); refuse only on a discriminator (the facts above are candidates; none was tried as one); a different code for the shape; leave the shape to ffmpeg as on `main`. The branch's Log already puts this shape to the orchestrator.

- **med** · no Done when line depends on it · `nfr:reliability` · **F2: an origin outage during a tail-`moov` file's index read is refused as unseekable and not retryable, where `main` says `DOWNLOAD_FAILED`.** The origin honours `Range`, serves `bytes=0-` whole, cuts ffmpeg's second request (`bytes=1015002-`, the `moov`) half-way, then stops accepting connections. Head, 6.1.1: `stream()` rejects `SOURCE_NOT_SEEKABLE`, `retryable=false`, `afterFirstByte=false`, at 176 s. `main`: `stream()` resolves at 231 s with 1,295 B, and `done` rejects `DOWNLOAD_FAILED`, retryable, at 297 s. The end of ffmpeg's log is `Stream ends prematurely at 1016964, should be 18446744073709551615`, then `Will reconnect at 328 in 0 second(s).` (no `error=`), the same at 1, 3 and 7 s, then `partial file`: no early end is outstanding, because each `Will reconnect` deletes its connection from `endedEarly`. Every later request reset instead, on 6.1.1 and 7.0.2: head `SOURCE_NOT_SEEKABLE` at 176 s; `main` `done` resolves at 187 s on 1,295 B of which 0 of 100 frames decode. The same index-read cut followed by `404`, `403`, `416`, `500`, `503` or `429` stays `DOWNLOAD_FAILED` (the log re-adds the early end after each `HTTP error`), and so does a cut in the later `mdat` read followed by the origin going away (`DOWNLOAD_FAILED` at 55 s, the same on `main`). The `PARTIAL_FILE` docblock says a body cut and never served again "stays `DOWNLOAD_FAILED`"; that holds for the `404` sequence it lists and not for connection-level failures at the index. A deterministic stand-in with the lines above, exit 0, `gate-fp.test.ts`, is handed to the orchestrator with this section: red on the head (`done rejected SOURCE_NOT_SEEKABLE`, expected `DOWNLOAD_FAILED`). Candidate fix, untried: a `Will reconnect … second(s).` with no `error=` is a retry wait and does not answer an early end. A fix has to keep dl-53's controls green.
- **low** · `nfr:maintainability` · F3: the only tests of the before/after-first-byte branches and of the progressive-only scoping are the two stand-in tests, skipped on win32. On `windows-latest` the file reports `64 tests | 6 skipped` and passes (the log gives file-level counts only); from the `skipIf` calls, the six dl-103 tests that run there are the four rows, the mirror case and the moov-heal control. Which side of the first byte `partial file` lands on with the Windows ffmpeg is unmeasured (the leg is informational). No live call site.
- **low** · F4: "a refusal from ffmpeg's own words tries the next mirror" takes its fault as `rows[0]?.[1]`, so reordering `rows` silently changes what it tests.
- **dropped** · "stderr and stdout are separate pipes, so `partial file` and the reconnect lines can arrive in either order": the reconnect lines and `partial file` are all stderr, one pipe, so their order is ffmpeg's; only the first byte (stdout) races them, and the code handles both sides. The healing runs below found no case.
- **dropped** · 14 failures on ffmpeg-static 7.0.2 attributed to the branch: the same 14 HLS tests fail on `main` (`14 failed | 42 passed (56)` there, `14 failed | 50 passed (64)` on the head, identical names). This settles the Log's "not run against `main`".
- **dropped** · the Log's "620,240 bytes and 59 of 100 frames" against my 610,160 B and 60 frames for the 60% shape: two fixture instances, since the encode is not byte-reproducible; the shape agrees.
- **findings** · the hunt returned 7; 4 carried (F1 to F4), 3 dropped.

Measured and clean, head against `main`:

- Healing refused: none in 69 runs in which a cut fired, 6.1.1 unless noted. 40 from the cut-once sweep (fast-start and tail-`moov`, the cut on requests 1 to 4 at 2%, 30%, 50%, 80% and 97%; 20 of 40 fired per binary, run on both, the index read cut at every fraction): all whole, 100 of 100 frames, no `partial file`. 24 single faults after a cut (`404`, `403`, `416`, `500`, `503`, `429`, reset, `200`-whole) at 3 positions: all whole. 5 origins cutting every connection (30% to 90%, FIN and RST): all whole after 6 to 18 requests.
- Persistent loss: `404`, `403`, `416`, `500`, `503`, `429`, reset and `200`-whole on every later request, and an origin that goes away, on the fast-start body and on the tail-`moov` file's `mdat` read: `DOWNLOAD_FAILED`, retryable, on the head (22 runs plus 4 more), the same code, bytes and frames as `main` in the 5 shapes run on both. F2's shapes are the exception.
- The contract edit is comment-only: `git diff 7709411e 42d0fb1f -- tools/downloader/contract` is one file, 4 insertions and 1 deletion, all inside the `SOURCE_NOT_SEEKABLE` doc comment. `src/errors.ts` with comments stripped (esbuild transform, then comments removed) is identical at both shas (2,662 characters each), and `dist/errors.d.ts` with doc comments removed is identical between a build of each.
- **For dl-98** (a second feeder of ffmpeg; from reading `stream.ts`, not run): (1) the check cannot tell the origin from whatever ffmpeg reads, so a loopback server's short answer, or one with no `Content-Length` that ends cleanly (a chunk fetch that failed), is a short source to it and F1's outcome: each ranged answer needs its `Content-Length` and a reset on failure. (2) The refusal before the first byte leaves `attempt()` by `throw` after awaiting only `ffmpeg.completion`, before the body's `close` handler exists: whatever a feeder holds per attempt (listener, queued chunks, sockets) has to be released from `completion`, and the mirror loop runs `attempt()` again. (3) `terminate` is first-wins in the runner: a feeder that terminates ffmpeg first decides the error, not `partial file`. (4) `details.url` is `context.url`, the URL ffmpeg is handed, while the probe's is the candidate: with a loopback it would name the loopback. (5) The early-end bookkeeping is per ffmpeg connection address and is what keeps a loss from reading as unseekable (F2 shows it has holes); fan-out multiplies the connections. (6) The dl-103 rows count origin requests (`count !== 1`, `blindCount >= 2`); that holds while the first connection is the probe and the fan-out is off.
- NFR: security ✓ (`redactUrl` on `details.url`; the stderr tail is already URL-redacted; no new URL, header or spawn) · performance ✓ (one regex per stderr line while no early end is outstanding; a refused short source costs its whole transfer, F1) · reliability — F1, F2 · maintainability — F3, F4; the discriminator is ffmpeg's English log text across two majors, and the real-ffmpeg row tests are its canary.
- Invariants walked: typed error from the contract (✓, the owner's Decision 1); contract edit comment-only (✓, above); no shell and `redactUrl` (✓); tests in a registered file, at the end of the suite (✓); `npm run check` (✓). Skipped as untouched: tool-import boundary, SSRF, progress, Dockerfile closure, route enumeration.

### Gate 2

**Gate: CONCERNS** — 2026-10-10 · `42d0fb1f..cf56efcf` · Sonnet 5.5, depth full · the round is `77e911ec`; `cf56efcf` is a merge of `main` at `1a044437` that touches docs only. Nothing in this section is a `high`.

Binaries as in gate 1: the distro `ffmpeg version 6.1.1-3ubuntu5` and ffmpeg-static 7.0.2 (`FFMPEG_PATH` unset), the same outcome unless a row names one.

Gate 1's findings, each against the new head:

- **F1 (high) · fixed.** A source that is merely short is `DOWNLOAD_FAILED`, retryable, wherever the shortness shows, on both binaries: the fast-start file stored at 5%, 20%, 40%, 60% (answered `206` and `200`), 80%, 95% and 99.9%; a fragmented MP4 at 60% (refused at `stream()` after 2.05 to 2.09 s, `afterFirstByte=false`); a fast-start file sent chunked with a clean early end. In all 20 runs `partial file` has no early end after it; where `stream()` resolved, the whole stored body was handed over before `done` rejected. A whole fragmented MP4 completes on both. Decision 2 and the round's Log record the owner's answer of 2026-10-10 and say it overrode the builder's split. The contract doc comment now names the pair (`partial file` followed by an early end at the same offset); it is true only for an origin that declares a length, see G2-2.
- **F2 (med) · fixed.** Both shapes, on both binaries (4 runs): `stream()` rejects `DOWNLOAD_FAILED`, retryable, `afterFirstByte=false`, at 178 to 184 s (ffmpeg's 176 s of retries and the 2 s hold); the first build said `SOURCE_NOT_SEEKABLE`. The last `partial file` is at offset `0x148`; where an early end follows it (the origin-gone runs) it is at `1016964`, so the offsets differ.
- **F3 (low) · carried, unchanged in kind.** On `windows-latest` at this head `stream.test.ts` reports `71 tests | 11 skipped` and passes. Of the 15 dl-103 tests, 8 run there (the four rows, the mirror case, the moov heal, and the 5% and 60% short-source cases, all against real ffmpeg) and 7 are skipped (the six stand-ins and the HLS control). So the Windows ffmpeg is shown to log the same-offset early end for the rows and not for the two short files; which side of the first byte `partial file` lands on there is still unmeasured.
- **F4 (low) · fixed.** The mirror case uses the named `row2`.

| Done when                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rows 2 and 3 red on `main`, `done` resolved, 0 frames                      | **Verified** again: the round's test file against `main`'s `src`: `13 failed \| 2 passed \| 56 skipped (71)`; rows 2, 3, 5 and the ninth case give `{"streamed":35164,"done":35164,"decodedFrames":0}`. The two that pass are the moov heal and the HLS control. The round's tests against `42d0fb1f`'s `src`: `5 failed \| 10 passed`, the two real-ffmpeg short-source cases and the F2 stand-in among them.                                                                                                                                                                                    |
| 2. Neither ends with `done` resolved; typed `AppError`; the Log names the why | `engine/test/stream.test.ts` › "dl-103: an unanswered seek probe › row 2 …" and "› row 3 …" assert `SOURCE_NOT_SEEKABLE`; 71 of 71 pass on 6.1.1. On 7.0.2, 57 of 71 pass and the 14 that fail are the same 14 HLS tests that fail on `main` (identical names). **Proven.** The round's Log entry names both codes and Decision 2.                                                                                                                                                                                                                                                                |
| 3. dl-53's heal controls and the moov heal complete whole                     | Unchanged tests, green. **Verified** by my own sweeps on the new head: 69 runs in which a cut fired (the cut-once sweep, 20 of 40 firing per binary; 24 single faults after a cut; 5 origins cutting every connection), all whole at 100 of 100 frames, none logging `partial file`.                                                                                                                                                                                                                                                                                                              |
| 4. The Log records the 6.1.1 measurement                                      | **Verified** at this head: rows 2, 3, 5, 6 and the ninth case, and the 1.5 MiB `free` chain (row 8), on both binaries; a forwarding proxy that refuses the probe, on 6.1.1. Each is `SOURCE_NOT_SEEKABLE` before the first byte, with `partial file` and then the early end at the same offset 0 to 2 ms later. Row 10 (socks5) was not re-run at this head.                                                                                                                                                                                                                                      |
| 5. `npm test -- --project downloader` and `npm run check` pass                | `npm run check` exit 0 on this tree (mine); the CI `check` jobs pass. **unproven (gate):** `test (ubuntu-latest)` and `test (windows-latest, informational)` are both red at `cf56efcf`, each on one file, `scripts/test/status.test.ts` › "the repo's own board surfaces at least one real outstanding obligation" (`expected [ 'dl-73' ] to include 'repo-16'`). It is red on `origin/main` at `1a044437` in my run, so it is `main`'s, not this branch's; every downloader file passed inside both legs (`stream.test.ts`: 71 tests). The legs go green once `main` is repaired and merged in. |

Positive control: `Number(endedAt) === partialAt` replaced by "an early end was seen" on a scratch copy of the head, restored byte-identical afterwards: `1 failed | 14 passed | 56 skipped (71)`, "stand-in: an early end at another offset is DOWNLOAD_FAILED". It is the only test pinning the offset equality, and it is a stand-in, skipped on win32. Second control, the hold removed: `4 failed`, among them the real-ffmpeg mirror case, which runs on Windows. The builder's other two mutation counts (the timer, the exit-time check) were not re-run.

New findings:

- **med** · no Done when line depends on it · `nfr:reliability` · **G2-1: a cancel or a stage timeout that lands in the hold is rewritten as `DOWNLOAD_FAILED`.** After a `partial file` and before the first byte, the first chunk waits on `Promise.race([verdict, exited])`. When ffmpeg is killed by the job's signal or the stage timer, `exited` resolves and the code then calls `decide(shortSource())`, which replaces the `JOB_CANCELED` or `TIMEOUT` that ended the process. Stand-in ffmpeg (`partial file`, a first chunk 50 ms later, alive for 15 s), seek probe unanswered: an abort at 400 ms gives `stream rejected DOWNLOAD_FAILED` after 404 ms, expected `JOB_CANCELED`; `stageTimeoutMs: 500` gives `DOWNLOAD_FAILED` after 506 ms, expected `TIMEOUT`. Controls in the same file: a cancel before the first byte with no `partial file` gives `JOB_CANCELED` (405 ms), after the first byte `done` rejects `JOB_CANCELED`, and the stage timeout gives `TIMEOUT`. New in the round: the first build had no hold, and `firstChunk` rejected with the process's own error. By `JobOrchestrator#recordFailure` (read, not run) a job is `canceled` only when the error's code is `JOB_CANCELED`, so such a job is recorded `failed`. The window is the hold, up to 2 s per attempt, and it is wide exactly where ffmpeg outlives its `partial file` (a fragmented short source, F2's outage). The fix is local: surface `completion`'s own rejection when `exited` ended the hold, and synthesise `shortSource()` only for the timer or a clean exit. Reproduction: `gate2-hold.test.ts`, in the gate's scratch directory and handed to the orchestrator; copy it into `engine/test/` and run it.
- **med** · no Done when line depends on it · `nfr:reliability` · **G2-2: an origin that ignores `Range` and sends no `Content-Length` is `DOWNLOAD_FAILED` when the probe was unanswered, and the comments say such an origin produces the early end.** Probe answered `403`, every other request the whole tail-`moov` file chunked (`Transfer-Encoding: chunked`, `Range` ignored): `stream()` rejects `DOWNLOAD_FAILED` (retryable) at 72 ms on 6.1.1 and 39 ms on 7.0.2, and the same with the 1.5 MiB `free` chain. The log has `offset 0x30: partial file` and no `Stream ends prematurely` at all; ffmpeg exits at once. `main`: `done` resolved on 1,295 B, 0 frames. Controls: a close-delimited body (no length, no chunking) does log the early end at 48 and is refused `SOURCE_NOT_SEEKABLE`; a chunked origin whose probe is answered is refused by the probe. It fails closed (a failed download, no garbage), which Decision 2 allows, and the log cannot separate it from a short source, since a chunked short source logs `partial file` and nothing else as well. So the remedy is the wording: the `PARTIAL_FILE` docblock ("its connection ends early at the very same offset") and the contract doc comment ("which such an origin produces and a source that is merely short does not") hold for an origin that declares a length, and the `seek-probe.ts` header still says dl-103 catches it "from ffmpeg's own `partial file`". Reproduction: scenario `blindchunk:moov-end.mp4` in the gate's harness, `gate-2/run4.mts`.
- **low** · G2-3: a short primary no longer fails over to a whole mirror. `isHostFailure` is false for a `DOWNLOAD_FAILED` whose stderr holds none of its connection words, so a fragmented short primary (refused before the first byte) with a whole alternate URL ends `DOWNLOAD_FAILED` after 2.08 s and the alternate sees no request; an unseekable primary with the same alternate still reaches it and completes at 100 of 100 frames. The first build tried the next mirror for the short case too. Facts for the owner; no recommendation.
- **dropped** · an unseekable origin whose early end comes later than 2 s after `partial file`, or at another offset: not found. 30 refused runs: origin headers held 1 s and 3 s; bodies trickled at 51 KB/s to 6.5 MB/s; a 1.5 MiB `free` box (offset `0x180030`, early end at `1572912`); six redirects; a forwarding proxy that refuses the probe; a lying probe (`206`); a close-delimited body; a 19.5 MB high-bitrate file. On both binaries except the proxy, lying-probe and close-delimited shapes (6.1.1 only). The early end came 0 to 8 ms after `partial file`, at the same offset, every time, and the source was refused before the first byte.
- **dropped** · a short source that logs a matching early end: not found. Stored short at seven sizes, fragmented and chunked; a body cut exactly on a sample boundary (a video sample, then audio samples) followed by `404`, a reset or the origin gone; out-of-range seeks answered `416`, `404`, `500`, `200`-whole or a reset; F2's shapes; every status after a cut. In each, `partial file` is followed by no early end, or by one at the byte where the body ended and not at the failing sample's offset (cut at 4253: `partial file` at `0x62ed`, early end at 4253).
- **dropped** · the held first chunk, unread, stalls ffmpeg before it can log the early end: the high-bitrate unseekable file writes 163,847 B of garbage on `main` (over the pipe's capacity) and is still refused, the early end 2 ms after `partial file`.
- **dropped** · the red `test` legs as this branch's: see Done when 5.
- **findings** · the hunt returned 7; 3 carried (G2-1 to G2-3), 4 dropped.

The hold and the retry path, measured:

- No whole or healing source is delayed or refused by the hold: it starts only after a `partial file`, which none of them logs. `stream()` resolved at 59 to 73 ms across the 40-run heal sweep (60 to 114 ms before the round) and a whole fragmented MP4 at 65 ms (6.1.1) and 29 ms (7.0.2). Inside the hold, ffmpeg exiting 0 at 500 ms gives `DOWNLOAD_FAILED` at 531 ms; a SIGKILL at 500 ms gives `DOWNLOAD_FAILED` at 537 ms; an early end at 1.9 s gives `SOURCE_NOT_SEEKABLE` (1,937 ms), at 2.2 s `DOWNLOAD_FAILED` (2,043 ms); a cancel and a stage timeout are G2-1.
- A short source that will always be short, per visitor action. Shown after the first byte (every size from 20% up): no automatic retry (`progress.started`), the whole stored body is moved and discarded, and the web copy is "worth another attempt" with `allowRetry: true`, so each click repeats the full transfer. Shown before it (a fragmented file; 5% on 7.0.2): `DOWNLOAD_FAILED` is in `REPROBE_WORTHY`, so the orchestrator re-probes the page and streams once more, each `stream()` costing 2.05 to 2.09 s of hold. With a subtitle track attached `openStream` also runs once more without it: 4.2 s and two ffmpeg runs measured (the origin saw the media twice), so one job is up to 8.4 s, four ffmpeg runs and two page probes (computed from the loop, not run through the orchestrator). Nothing remembers that a source was short. `DOWNLOAD_FAILED`'s doc comment in the contract (a segment's retry budget) is untouched, as the round's Log says; the owner's answer authorises no edit to it.
- The contract diff is comment-only: `git diff 7709411e cf56efcf -- tools/downloader/contract` is one file, 6 insertions and 1 deletion, inside the `SOURCE_NOT_SEEKABLE` doc comment; `src/errors.ts` with comments stripped is identical at both shas (2,662 characters), and `dist/errors.d.ts` with doc comments removed is identical between builds.
- **For dl-98**, what the round adds to gate 1's list: (1) the verdict needs the feeder's answers framed exactly. A loopback that sends no `Content-Length` (G2-2), or ends a ranged body short, makes ffmpeg's `partial file` read as a short source and `DOWNLOAD_FAILED`; `SOURCE_NOT_SEEKABLE` is unreachable through a loopback, and the dl-98 ticket's "a `200` to an extra connection" case now ends `DOWNLOAD_FAILED`. (2) The hold: the first byte can wait up to 2 s after a `partial file`, and a feeder's own cancel or timeout landing in it is currently rewritten (G2-1), which dl-98's Decision 6 (cancellation covers the fetchers) would trip over. (3) `DOWNLOAD_FAILED` before the first byte now reruns `attempt()` for the subtitle fallback and a feeder is built per attempt: up to two per `stream()`, and mirrors are not tried for it (G2-3). (4) A feeder that terminates ffmpeg first still decides the error (`terminate` is first-wins).
- NFR: security ✓ (`redactUrl` and the URL-redacted stderr tail in `partialDetails`; no new URL, header or spawn) · performance ✓ (a 2 s hold only after a `partial file`; the timer is unref'd and cleared on exit) · reliability — G2-1, G2-2, G2-3 · maintainability ✓ (the decision is one pair of regexes and one timer in `attempt`).
- Invariants walked: typed errors (✓, `DOWNLOAD_FAILED` and the owner's code); contract comment-only (✓, above); no shell and `redactUrl` (✓); tests in the registered file (✓); the owner's Decision 2 recorded in the ticket with its options and the choice (✓).

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

**2026-10-10** — round 1, on gate 1's findings at `42d0fb1f` (Opus 5.5,
builder), after merging `origin/main` at `15adb4f7`. The owner's answer to F1
is Decision 2 above.

**Both findings reproduced first.** F1, with gate 1's harness (`run2.mts`)
against this worktree at `42d0fb1f`: `serve:faststart.mp4:60:range` gave
`done` rejected `SOURCE_NOT_SEEKABLE`, 60 frames, on 6.1.1 and 7.0.2;
`serve:faststart.mp4:5:range` gave the same on 6.1.1, and `stream()` refused
`SOURCE_NOT_SEEKABLE` on 7.0.2. F2, with the gate's stand-in
`gate-fp.test.ts` copied into the suite:
`expected 'done rejected SOURCE_NOT_SEEKABLE' to match /DOWNLOAD_FAILED$/u`.

**The separator: an early end at the offset of the `partial file`, after
it.** On an origin that ignores `Range`, ffmpeg seeks to the first sample,
gets byte 0 again, logs `offset 0x30: partial file`, and then its connection
logs `Stream ends prematurely at 48`, the same offset in decimal (row 8's
chain: `0x180030` and `1572912`). A short source logs `partial file` where its
bytes run out, and no early end at that offset follows. Measured over every
run that logged `partial file` in gate 1's outputs (its `main` and head trees,
both binaries) and in mine, with `separate.cjs` in the build's scratch
directory:

| Shape                                                                                   | Gate 1's runs | This builder's runs | Early end at that offset after it        |
| --------------------------------------------------------------------------------------- | ------------- | ------------------- | ---------------------------------------- |
| Unseekable: rows 2 to 13 and the ninth case; the gate's blind faults and six redirects  | 24            | 32                  | 56 of 56, 0 to 2 ms after it where timed |
| Short: fast-start stored at 5% to 99.9%, unranged, chunked                              | 58            | 24                  | 0 of 82                                  |
| Short: fragmented, stored at 60%                                                        | 2             | 2                   | 0 of 4                                   |
| Cut and never served again (`404` to `503`, reset, `200`-whole, gone), index or samples | 39            | 15                  | 0 of 54 (F2's shapes included)           |

Each run is one `engine.stream()` that logged `partial file`, on `main`, on
`42d0fb1f` or on this round, on 6.1.1 or 7.0.2. The offset was 48 in every
unseekable run but row 8's (`0x180030`, `1572912`), and wherever the bytes ran
out in the others. Counted by `count.cjs` over gate 1's outputs and this
builder's `sweep-*.txt`, and `separate-mine.cjs` over its `measure-*.json`.

The build reads it so (`PARTIAL_FILE`, `SAME_OFFSET_ENDS_EARLY` in
`engine/src/stream.ts`): on a progressive source, `partial file` records its
offset and waits up to 2 s (`PARTIAL_VERDICT_MS`). An early end at that
offset is `SOURCE_NOT_SEEKABLE`. No such end before the 2 s, or before ffmpeg
exits, is `DOWNLOAD_FAILED` ("The source ended before the whole video
arrived."), retryable. A first byte that arrives while a `partial file` waits
is held for the verdict, so an unseekable origin is still refused before the
first byte; without the hold, the mirror case fails (below), because on a real
row the first chunk lands between the two lines. The first build's guard
(`partial file` only while no early end is unanswered) is gone: the separator
covers the cut it was for, and F2 was the hole in it.

**After, gate 1's harness on this tree, both binaries, 52 runs.** Every
unseekable row (r2, r3, r5, ninth, six redirects): `stream()` refuses
`SOURCE_NOT_SEEKABLE`. Fast-start stored at 5% to 99.9%, unranged 60%,
chunked 60%, fragmented 60%: `DOWNLOAD_FAILED` (60% and up after the first
byte, `done`; the fragmented file and 5% on 7.0.2 before it, `stream()`; 5%
on 6.1.1 after it). Whole fast-start, tail-`moov` and fragmented files, and
the index-read and `mdat` heals: whole, 100 of 100 frames. Cuts followed by
`404` in the index read and in the samples, a reset after the samples' cut,
RST replies: `DOWNLOAD_FAILED`. F2's two shapes (`cut:moov-end.mp4:2:0.5:reset:*`
and `…:down:1`), 4 runs: `stream()` refuses `DOWNLOAD_FAILED`, retryable,
where the first build said `SOURCE_NOT_SEEKABLE`. My own harness, both
binaries: rows 2 to 13 and the ninth case refused `SOURCE_NOT_SEEKABLE`, 22 of
22; a fast-start file stored at 60% (from `Range`-honouring and ignoring
origins) `DOWNLOAD_FAILED` after the first byte, 4 of 4; the never-healed cut
`DOWNLOAD_FAILED`; the moov heal whole.

**Tests, at the end of `stream.test.ts`.** New: "a fast-start file stored at
5% of itself is DOWNLOAD_FAILED" and "… at 60% …" (real ffmpeg); six stand-in
cases, named "stand-in: … is <code>": the verdict decided while the first
chunk is on its way, the verdict after a held first chunk, the verdict after
the first byte, no early end with ffmpeg still running (the timer, within
6 s), an early end at another offset, and gate 1's F2 tail (its
`gate-fp.test.ts`, folded in); the HLS control now sends the matching early
end too. F4: the mirror case uses a named `row2`. Against `42d0fb1f`'s
`stream.ts`: `5 failed | 10 passed` — both short-source cases, the timer case,
the other-offset case and F2. Mutations of this round's `stream.ts`, each
restored byte-identical: no hold, `4 failed` (the mirror case among them);
the timer at 600 s, `1 failed` (15,057 ms); offset equality removed, `1
failed`; the progressive guard removed, `1 failed` (the HLS control); the
exit-time check removed, `2 failed` (60% and F2); the after-first-chunk
verdict check removed, `5 failed`.

**F3, what the Windows leg proves.** `test (windows-latest)` runs
ffmpeg-static's Windows build (the distro step is Linux-only). There the four
real rows, the mirror case, the moov heal and the two short-source cases run:
a Windows ffmpeg that did not log the early end at the `partial file` offset
fails the rows (`DOWNLOAD_FAILED`), and one that logged it for a short file
fails the short cases. They accept either side of the first byte, so the leg
does not say which side `partial file` lands on there, and the seven stand-in
cases (the orderings, the timer, the offset mismatch, F2's tail, the HLS
scoping) are skipped on win32, as dl-53's are. Unmeasured: the order of
`partial file` against the first byte with the Windows binary.

**For dl-98, the shapes gate 1 named, now:** the refusal before the first
byte still leaves `attempt()` by `throw` after awaiting `completion` only, and
may now hold the first chunk for up to 2 s first; `terminate` is still
first-wins, and the verdict goes through it; `details.url` is still
`context.url`, what ffmpeg is handed. New: a short answer from whatever feeds
ffmpeg is `DOWNLOAD_FAILED` now, not `SOURCE_NOT_SEEKABLE`, unless its
connection ends early at the failing sample's offset.

**Not changed.** `DOWNLOAD_FAILED`'s doc comment ("Segment fetching failed
past the retry budget") already describes a segment, not a progressive loss,
and did so before this ticket; the owner's answers authorise no edit to it,
so it is untouched. The visitor copy of both codes is unchanged.

**2026-10-10** — round 2, on gate 2's findings at `cf56efcf` (Opus 5.5,
builder).

**The owner's answer, 2026-10-10.** Asked "What happens to them?" for G2-1
and G2-2, with the options "Builder fixes G2-1 and G2-2, gate checks
narrowly" (the orchestrator's recommendation), "Lander applies both, no
re-gate", and "Leave both recorded; file G2-1 as dl-106". **Chosen: the
builder fixes G2-1 and G2-2, and the gate checks narrowly.** G2-3 (a short
primary no longer fails over to a whole mirror) stays recorded in gate 2's
section, with no change.

**G2-1, fixed: whatever ends ffmpeg inside the hold keeps its code.** When
ffmpeg exited while the first byte was held, round 1 called
`decide(shortSource())` and threw that, over the `JOB_CANCELED` or `TIMEOUT`
that had killed it. Now the throw after the hold is `completion`'s own
rejection whenever there is one (`terminate` is first-wins, so a verdict
that ended ffmpeg arrives the same way), and the short-source verdict is
thrown only after a clean exit. Red first, with the four new cases at the end
of `stream.test.ts` ("… while the first byte is held for a verdict keeps its
code, …"):
`npx vitest run tools/downloader/engine/test/stream.test.ts -t "while the first byte is held"`
gave `Tests 3 failed | 1 passed | 71 skipped (75)`, with
`expected 'DOWNLOAD_FAILED' to be 'JOB_CANCELED'` and
`expected 'DOWNLOAD_FAILED' to be 'TIMEOUT'`; the crash case passed. After the
fix: 4 of 4. Gate 2's `gate2-hold.test.ts`, copied in and then removed:
`Tests 9 passed (9)`. The case "a cancel whose kill outlasts the hold" (the
stand-in ignores SIGTERM, so the 2 s timer fires mid-kill) pins the
`completion`-first throw: with that throw reverted to the verdict,
`3 failed | 16 passed`, that case included.

**G2-2, wording only, reproduced.** Gate 2's `run4.mts`, on 6.1.1 against
this tree: `blindchunk:moov-end.mp4` (probe `403`, every other answer the
whole file, chunked) gave `stream()` rejected `DOWNLOAD_FAILED`, with
`offset 0x30: partial file` and no early end; the control
`blindclose:moov-end.mp4` (no length, connection closed) logged
`Stream ends prematurely at 48, should be 18446744073709551615` and was
refused `SOURCE_NOT_SEEKABLE`. The `PARTIAL_FILE` docblock, the `stream.ts`
header, the `seek-probe.ts` header and the `SOURCE_NOT_SEEKABLE` doc comment
(comment-only, under Decision 1) now say the early end comes only from an
origin that declares where its body ends, and that a chunked one is
`DOWNLOAD_FAILED`.
