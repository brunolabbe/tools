---
id: dl-98
tool: downloader
title: A progressive source throttled per connection downloads at one connection's rate, though four would be four times faster
kind: work-package
status: needs-decision
milestone: null
depends_on: [dl-96]
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

## Decisions needed

Ask these as options with costs before anything is built.

1. **Where reassembly lives.**
   - (a) A loopback range server inside the API that ffmpeg reads from. It
     fans each request out into N ranged origin fetches and serves them back in
     order. ffmpeg keeps its own seeking (a tail `moov` is a ranged read) and
     its reconnect logic.
   - (b) Feed ffmpeg on stdin from an in-order reassembler. Simpler wiring, but
     a pipe cannot seek, so a moov-at-end file would need its tail fetched and
     handled first, or would fail.
   - (c) Out of the engine entirely: an external downloader. Rejected in
     advance by "no shell, no new binaries" unless the owner reopens it.
2. **The memory bound.** No disk (dl-53), so chunks fetched ahead live in RAM:
   N connections × chunk size × concurrent jobs. At 4 × 4 MB × the default
   `MAX_CONCURRENT_JOBS`, what is acceptable on the deployment host?
3. **When to turn it on.** Always for progressive with `Accept-Ranges`, or only
   once a single connection measures slow (e.g. under the media bitrate)? The
   second costs nothing on a fast origin.
4. **How many connections, and politeness.** Opening several connections to
   one origin is what download managers do, and what some origins' terms or
   anti-bot layers forbid. A fixed small N, per-host opt-out, or both?
5. **What it must not break.** The SSRF check, which must run on every ranged
   fetch. The egress proxy and its TLS verification, which every byte must
   still pass through. The replayed headers and cookies, and the size cap,
   which must count reassembled bytes. Cancellation and process-tree kill,
   which must cover the fetchers too.

## Build

Not until the decisions above are recorded here. Then: reproduce first with a
fixture origin that throttles **per connection**. The throttled range server
used to reproduce dl-96 throttles per request, which is the right shape. Show a
single-connection baseline, then the speed-up.

## Done when

To be written with the decisions. At minimum: a per-connection-throttled
fixture downloads N times faster, the output is byte-identical in media to a
single-connection run, and memory stays within the decided bound.

## Log

**2026-10-07** — filed `needs-decision` from dl-96's session. The measurement
above was taken against the live origin during dl-96's diagnosis, with the
owner's job running.
