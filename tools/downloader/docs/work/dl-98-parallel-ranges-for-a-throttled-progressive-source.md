---
id: dl-98
tool: downloader
title: A progressive source throttled per connection downloads at one connection's rate, though four would be four times faster
kind: work-package
status: ready
milestone: null
depends_on: [dl-96, dl-102]
difficulty: hard
---

# dl-98 — Parallel ranged reads for a progressive source throttled per connection

## Why

Filed from [dl-96](./dl-96-progress-reads-zero-on-a-slow-untimed-source.md), at
the owner's request, 2026-10-07. The reported source was a 100 MB progressive
MP4 at ~2.15 Mbit/s whose origin served ~15–27 KB/s per connection, so the job
ran about 18x slower than realtime. At that rate the whole file would take over
an hour.

**Measured from the devcontainer, same origin, same range-capable URL:**

| reads at once | each       | together  |
| ------------- | ---------- | --------- |
| 1             | 27 KB/s    | 27 KB/s   |
| 4             | 19–27 KB/s | ~100 KB/s |

The throttle is per connection, not per client, at least up to four. The
same container pulled 7.2 MB/s from npm, so the link was not the limit.

Today the engine hands ffmpeg the URL and ffmpeg reads it over one connection
(`engine/src/stream.ts`; why progressive goes to ffmpeg as a URL is in that
file's header). dl-53 made the engine keep **no copy**: bytes stream to the
visitor as ffmpeg produces them. A parallel read fetches ahead, so it has to
hold what it fetched somewhere until ffmpeg reaches it. That is the design
question.

## Decisions

Taken by the owner on 2026-10-07, from the options recorded in the Log.

1. **Reassembly is a loopback range server inside the API**, which ffmpeg reads
   from. It fans each request out into ranged origin fetches and serves the bytes
   back in order. ffmpeg keeps its own seeking, so a tail `moov` stays a ranged
   read, and it keeps its reconnect logic. Feeding stdin is out because a pipe
   cannot seek. An external downloader stays out under "no shell, no new
   binaries".
2. **The memory bound is 4 chunks of 4 MB per job**, held in RAM since there is
   no disk (dl-53). That is about 32 MB at the default `MAX_CONCURRENT_JOBS` of
   2, small next to the ~300 MB of one browser probe.
3. **It turns on only once one connection measures slow.** Every job starts on a
   single connection and switches to parallel ranges only when the measured rate
   is below the media bitrate. The bitrate comes from the size and the duration.
   When either is unknown, the job stays on one connection. A fast origin never
   sees a second connection.
4. **N is fixed at 4, with a per-host opt-out**: an environment list of hosts
   that always get one connection, for an origin whose terms or anti-bot layer
   object. 4 is what the measurement above showed paying off.
5. **A host that refuses falls back, and is remembered until restart.** A
   refusal is a 429, 403 or 503, or a reset, on an extra connection; a 200 that
   ignores the range; or 4 connections together measuring no faster than 1,
   which is a per-IP throttle. Any of these drops the job back to one
   connection without failing it; the loopback server absorbs the switch, so
   ffmpeg never sees it. The host goes into an in-memory set in the API process,
   and later jobs to it stay on one connection. A restart clears the set, so
   each process gives a host one new try.
6. **What it must not break** is unchanged: the SSRF check on every ranged
   fetch; the egress proxy and its TLS verification on every byte; the replayed
   headers and cookies; the size cap, counted on reassembled bytes; and
   cancellation and process-tree kill, which must cover the fetchers too.

## Build

Reproduce first with a fixture origin that throttles **per connection**. The
throttled range server used to reproduce dl-96 throttles per request, which is
the right shape. Show a single-connection baseline, then the speed-up.

**After dl-102.** Build this after [dl-102](./dl-102-a-range-ignoring-origin-finishes-a-tail-moov-mp4-undecodable.md)
has merged (the owner's order, 2026-10-08, "so its fixtures can account for
dl-102's refusal"; `depends_on` carries it). dl-102's Done when 2 and 3 make `stream()`
refuse a tail-`moov` MP4 from an origin that ignores `Range`, with a new
contract code, before the first byte. So the "200 to a range request" refusal
test cannot serve a tail-`moov` file from an origin that answers `200` to every
request: that job fails with dl-102's code and never reaches the fan-out. Use a
fast-start MP4 from such an origin (dl-102's Done when 3 keeps it completing
whole), or an origin that honours the first connection's ranges and answers
`200` only to the extra connections the fan-out opens. Neither fixture has been
tried. Once this is built, ffmpeg reads the loopback server, so the origin sees
only the loopback's fetches and has to tell the first connection from the extra
ones by order or by count.

## Done when

- Against a fixture origin throttled per connection, a job that measures slow
  switches to 4 connections and finishes at least 3x faster than the
  single-connection baseline, in a test that fails if the switch is removed.
- A fast origin, a source of unknown size or duration, and an opted-out host
  each stay on exactly one connection, counted at the fixture.
- The output is identical in media to a single-connection run, including a
  file whose `moov` is at the end.
- For each kind of refusal in Decision 5 (a 429, a 403, a 503, a reset, a 200
  to a range request, and no speed-up at 4), the job completes on one
  connection with output identical in media, and a second job to that host opens
  one connection, counted at the fixture. The 200 case has a constraint: see
  Build, "After dl-102".
- Bytes held ahead never exceed 4 × 4 MB per job, measured, not assumed.
- Each function this branch adds or changes that issues a ranged request —
  listed by name in the Log — passes the SSRF check and the egress proxy,
  carries the replayed headers, counts toward the size cap, and stops on
  cancel, each with a test.

## Log

**2026-10-07** — filed `needs-decision` from dl-96's session. The measurement
above was taken against the live origin during dl-96's diagnosis, with the
owner's job running.

**2026-10-07** — decisions taken by the owner. The options put to them were:
reassembly in (a) a loopback range server, (b) stdin, or (c) an external
downloader; turning it on always with `Accept-Ranges` or only when measured
slow; and N as a fixed 4 with a per-host opt-out, a fixed 4 alone, or an env N
defaulting to 1. The first option was chosen each time. The 32 MB bound was
stated with option (a). Staying on one connection when the bitrate cannot be
computed follows from "only when measured slow".

**2026-10-07** — the owner asked what happens when a host refuses several
connections from one IP; nothing above said. The options were to fall back for
the job only, to fall back and remember the host until restart, or to fall back
and remember it in SQLite with an expiry. They chose until restart (decision 5).

**2026-10-08** — two records, no source changed, nobody building this ticket.

1. **Refusal scope in Done when.** The orchestrator (session tools-f1) put the
   question: "dl-98's Decision 5 counts 429, 403, 503, a reset, a 200 to a range
   request and 'no speed-up at 4' as refusals. Its Done when line tests only 429,
   a reset, a 200 and no speed-up. If dl-98 is built, should its refusal tests
   also cover 403 and 503?" The options were "Cover 403 and 503 too
   (Recommended)" and "Done when as written". **The owner chose "Cover 403 and
   503 too"**, which was the recommended option (the orchestrator's
   recommendation). The Done when bullet now names all six kinds.
2. **Deferred behind dl-102.** The orchestrator (session tools-f1) put the
   question: "dl-98 and dl-102 both rewrite how a progressive source reaches
   ffmpeg in engine/src/stream.ts, and the concurrency rule says not to run them
   side by side. dl-101 has no overlap with either, so it starts now regardless
   of what you pick. How should dl-98 run?" The options were:
   1. "dl-101 + dl-102 now; dl-98 later (Recommended)": "Build dl-101 and dl-102
      in parallel now. dl-98 goes in a later batch, built from main once dl-102
      has merged, so its fixtures can account for dl-102's refusal. Nothing
      depends on dl-98, and it is the largest of the three: a new loopback range
      server with no files named in its brief. No stacking or post-squash rebase
      is needed."
   2. "Stack dl-98 on dl-102": "Once dl-102 passes its gate, build dl-98 on
      dl-102's branch as a draft PR against it, inside this batch. That keeps
      all three in this batch but costs a rebase onto main with --onto after
      dl-102 squash-merges. If dl-102 changes in a fix round, dl-98 reads a
      moving base. This would also be the first trial of GitHub's native stacked
      PRs, which concurrency.md says the next chain should run."
   3. "dl-98 first, dl-102 after": "Build dl-101 and dl-98 now and hold dl-102
      until dl-98 merges. dl-102's probe could then reuse dl-98's API-side
      fetcher, which already does the SSRF check. The cost: a defect where a
      broken file is reported as a success stays on main for longer, behind the
      biggest ticket."

   **The owner chose option 1**, which was the recommended option (the
   orchestrator's recommendation). The owner's stated reason is the one in the
   option: "so its fixtures can account for dl-102's refusal". The `stream.ts`
   overlap in the question was the orchestrator's framing, taken from an intake
   seam-mapper, not the owner's reason. As the recorder's observation, it is also
   not total: dl-102's Build item 2 lets its probe live in the api before
   `stream()`. Read on `origin/main` at `856a4e87`: dl-102's Done when 2 has
   `stream()` throw a typed `AppError` with a new code before the first byte for
   a tail-`moov` MP4 from an origin that ignores `Range`, and its Done when 3
   keeps a fast-start MP4 from that origin completing whole. So the "200 to a
   range request" refusal test cannot use a tail-`moov` source from an origin
   that ignores `Range` on every request; Build, "After dl-102", says so.
   `depends_on` now lists dl-102, so `npm run status -- --ready` withholds this
   ticket until dl-102 is `done`, and the owner's order does not rest on prose.
   `status` stays `ready`: nobody has started it, and it is only withheld.

**2026-10-10** — the last Done when line reworded by the orchestrator, under the
batch's rule that an acceptance line saying "every" is reworded to an
enumerable scope before work starts. It read: "Every ranged fetch passes the
SSRF check and the egress proxy, carries the replayed headers, counts toward
the size cap, and stops on cancel." No source changed in this commit.

**2026-10-11** — built, on `dl-98-parallel-ranges-throttled-source`, stacked on
dl-103's branch at `c17b649d`. Binaries: the distro ffmpeg 6.1.1 unless a line
says 7.0.2 (ffmpeg-static, `FFMPEG_PATH` unset).

**What it is.** `engine/src/download/parallel-ranges.ts`'s `RangeFeeder`: a
loopback HTTP server on 127.0.0.1 with one random path, started per `attempt()`
and closed from ffmpeg's `completion` (dl-103's gate: a refusal before the first
byte leaves by a throw). ffmpeg reads it with `-http_proxy ""` and
`-protocol_whitelist http,tcp` for that input only (`buildLoopbackInputArgs`).
It relays each ffmpeg request to the origin with the same `Range`, and the
origin's status line, framing headers and body unchanged, while it measures the
rate (only while bytes flow, never while ffmpeg is not reading). After
`measureMs` (5 s by default) below the bitrate, the request in flight is split:
the open connection reads one more chunk, and the rest is fetched as closed
ranges, 4 at once, 4 MiB each, handed over in order. At or above it, the job is
settled on one connection. `SINGLE_CONNECTION_HOSTS` (API) /
`singleConnectionHosts` (engine) opt hosts out, subdomains included; the
refused set lives on the `Engine` instance, so a restart clears it.

**The last Done when line, enumerated.** One function issues the ranged
requests this branch adds: `RangeFeeder#request`, in `parallel-ranges.ts`. It is
called by `RangeFeeder#begin` for the relay, each chunk, and the continuation
after a fallback. Every request goes out through `get` in
`download/seek-probe.ts`, which is exported now with its body unchanged.
`openTunnel` there now rejects with `TunnelRefused`, which carries the proxy's
status line. The tests, all in `engine/test/parallel-ranges.test.ts` unless
named:

- SSRF check: `api/test/parallel-ranges-behind-the-proxy.test.ts` › "a ranged
  fetch redirected to a refused address is stopped at the guard, and the read
  completes", and "a whole job through the engine and the guarded proxy …". The
  real `startEgressProxy` and `createSsrfGuard` are used. The origin redirects
  every fan-out fetch to the literal loopback address, which the guard does not
  exempt, and the trap there saw 0 connections.
- Egress proxy: "every fetch, relayed and ranged, goes through the proxy with
  the replayed headers" (the proxy forwarded as many requests as the origin
  saw, each in absolute form to the origin's URL, more than 4 of them closed
  ranges). "with the egress proxy configured, ffmpeg's own request never
  reaches it". "a proxy's refusal reaches ffmpeg in the proxy's own words, and
  nothing goes around it": a refused `CONNECT`'s `502 TLS certificate
verification failed (CERT_HAS_EXPIRED)` reaches ffmpeg verbatim, so the runner
  still reads it as a certificate failure (dl-27).
- Replayed headers: the same proxy test, and the 3x test, which asserts
  `Referer`, `Cookie` and `User-Agent` on every request the origin saw.
- Size cap: "the size cap counts reassembled bytes, relayed and fetched, and
  stops every fetch". The feeder counts bytes handed to ffmpeg and calls
  `ffmpeg.terminate(SIZE_LIMIT_EXCEEDED)` past `maxFileSizeBytes`.
- Cancel: "a cancel stops the relay and every ranged fetch, and nothing is
  fetched after it" (the feeder's own signal), and "a cancel after the first
  byte closes every origin connection and opens no more" (through `stream()`).

`get` keeps dl-102's own tests for the probe. It counts no bytes; the cap is the
feeder's.

**Measured.**

- 3x: an origin throttled to 500 KB/s per request, with a 4,132,154 B tail-`moov`
  file of 6 s (about 690 KB/s of media), test settings of 128 KiB chunks and a
  200 ms window. Single connection (an opted-out host, ffmpeg straight to the
  origin) took 8,375 to 8,380 ms; split took 2,416 to 2,424 ms, 3.45 to 3.47x
  over 4 runs. The test asserts `>= 3`, the Done when's own number. The ceiling
  is 4x less the window and the last, partly filled round of chunks. With
  256 KiB chunks on a 4 s file it measured 2.97x, which is why the test uses the
  smaller chunk and the longer file. With the switch removed (`#split` replaced
  by a reset), split took 8,377 ms against 8,380 ms and the test fails.
- Held bytes, at the owner's defaults (4 × 4 MiB, only the window shortened), a
  40 MiB body at 40 MB/s per connection, the reader paused for 1.5 s:
  `maxHeldBytes` 13,254,656 B. The test asserts `<= 16 MiB`, and `>= 12 MiB`
  while paused, so the bound was reached and not only respected.
- One connection, counted at the fixture as requests open at once: 1 for a
  fast origin, an opted-out host, a sizeless origin, an untimed source (Matroska
  written live, `Duration: N/A` on 6.1.1 and 7.0.2), and a second job to every
  refusing host. Each count is 2 requests: the seek probe, then ffmpeg's read.
  This is counted on the fast-start file because **ffmpeg itself holds two open
  at once when it seeks a tail-`moov` file**: the baseline above showed
  `maxOpen` 2 over its 4 requests, as did the relay with the switch removed.
- The six refusals (429, 403, 503, a reset, a `200` to a ranged fetch, and a
  per-client throttle at 2 MB/s shared): each job completes with the same
  `framemd5` packets as a single-connection run. After the last fan-out request,
  only open-ended requests reach the origin. The second job on the same engine
  has 0 fan-out requests and at most 1 open.
- Nine mutations, each run against the test that names it, and each turns that
  test red: switch removed, held bound removed (`#occupied` → `#inFlight`), cap
  removed, the feeder's cancel unwired, `-http_proxy ""` removed, refusals not
  remembered (all six refusal tests), the no-speed-up check removed, headers not
  replayed, and the tunnel's status line dropped.
- `stream.test.ts` with the feeder in place: 75 of 75. A trace showed 27 feeder
  starts across it: dl-53's progressive cases (cut-and-healed, cut-and-lost),
  dl-96's and dl-103's `large-103` cases. On 7.0.2 it is 61 of 75. The 14
  failures are HLS sources (11 on `hls6` or `hls11`, `midfail`, and the two `HLS`
  rows), the same count dl-103's gate 3 recorded on `main`. Their names were not
  compared with a `main` run. The dl-98 specs pass 25 of 25 on 7.0.2 (23 engine, 2 api).

**What the brief had wrong, or did not say.**

1. **Which origins go behind the loopback.** Only a progressive file read as
   one input whose origin answered dl-102's probe with a `206`. An origin that
   does not range cannot be split. Leaving it on ffmpeg's own path keeps
   dl-102's and dl-103's verdicts on it exactly as they were, so gate 2's
   prediction for this ticket ("a `200` to an extra connection now ends
   `DOWNLOAD_FAILED`") does not arise: a fan-out answer is never relayed to
   ffmpeg, and the `200` case completes. Also excluded: a separate audio
   rendition (two inputs, one bitrate), a live capture, and a proxy that is not
   `http://` (ffmpeg goes direct there, and the feeder could not follow it).
2. **"Unknown size".** An origin that ranges states the total in every `206`,
   and the feeder reads it there, so a ranging origin's size is never unknown.
   The variant's `filesizeBytes` is only the fallback. The size is unknown only
   from an origin that does not range, and that origin is never split; the test
   uses one (a chunked `200` with no length). The fixture shape that would have
   kept the size unknown at a ranging origin, `Content-Range: bytes a-b/*`, is
   unreadable to ffmpeg itself: 6.1.1 given one directly fails with `moov atom
not found`.
3. **"Unknown duration"** is the probe's duration or ffmpeg's own `Duration:`
   line (dl-96), whichever arrives. dl-96's reported source was untimed by the
   probe, so with the probe's alone this would not have helped the case it was
   filed for. That reading of Decision 3 goes to the orchestrator as an open
   question in the builder's report.
4. **The `200` fixture.** The Build's second shape, an origin that honours the
   first connection's ranges and answers `200` only to the fan-out. It picks
   out the fan-out by shape and not by order: a closed range other than the
   probe's `bytes=1-1`. The relay and the continuation send open ranges, as
   ffmpeg does.
5. **Failures that are not refusals.** Any failure of a ranged fetch drops the
   job back to one connection. Only Decision 5's kinds remember the host. A
   guard's refusal of a redirect hop is a `403`, and so is remembered. A split
   that holds up is judged once and not again; "no speed-up" is under 1.5x the
   single connection's rate, measured only while all 4 slots are reading.
6. **A defect found and fixed in this build:** the feeder first cached a
   redirect's target, as ffmpeg does. One refused hop then stood in for every
   later request, and the fallback's continuation was refused too. Measured red
   on the API test before the fix: the first case hung to its 120 s timeout, and
   the second ended `DOWNLOAD_FAILED` ("The source cut part of the video
   short"). Every fetch now starts from the candidate.
7. **A second defect, found by re-reading before the pull request:** a
   fallback aborted every read in progress, a second ffmpeg connection's relay
   included. A relayed `200` has no known end, so no continuation could resume
   it, and its response ended clean and short. "a second read relaying a
   whole-file 200 is left to finish when the split falls back" was red before
   the fix (`first.complete` false) and is green after it. A healthy relay is
   now left alone, since it is one connection already.

dl-103's handover items: (1) composed answers declare `Content-Length`, and a
failed fetch is passed on as a cut connection, which ffmpeg reconnects from.
(2) The feeder is released from `completion`. (3) There is one feeder per
attempt, so up to two per `stream()` with the subtitle retry. (4) The feeder's
only `terminate` is the size cap's. `details.url` still names the candidate,
never the loopback.

**Not measured:** Windows. That includes `-http_proxy ""` passed through
`spawn` there and the loopback under Windows' ffmpeg; CI's Windows leg is the
first reading. Also unmeasured: a real throttled origin, and the 5 s production
window against one.

**Fold-in:** nothing. No open downloader ticket touches the progressive
streaming path (`npm run status -- --tool downloader`: dl-49, dl-90, dl-93,
dl-100).
