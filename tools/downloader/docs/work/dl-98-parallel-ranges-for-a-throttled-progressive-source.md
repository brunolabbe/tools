---
id: dl-98
tool: downloader
title: A progressive source throttled per connection downloads at one connection's rate, though four would be four times faster
kind: work-package
status: ready
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
5. **What it must not break** is unchanged: the SSRF check on every ranged
   fetch; the egress proxy and its TLS verification on every byte; the replayed
   headers and cookies; the size cap, counted on reassembled bytes; and
   cancellation and process-tree kill, which must cover the fetchers too.

## Build

Reproduce first with a fixture origin that throttles **per connection**. The
throttled range server used to reproduce dl-96 throttles per request, which is
the right shape. Show a single-connection baseline, then the speed-up.

## Done when

- Against a fixture origin throttled per connection, a job that measures slow
  switches to 4 connections and finishes at least 3x faster than the
  single-connection baseline, in a test that fails if the switch is removed.
- A fast origin, a source of unknown size or duration, and an opted-out host
  each stay on exactly one connection, counted at the fixture.
- The output is identical in media to a single-connection run, including a
  file whose `moov` is at the end.
- Bytes held ahead never exceed 4 × 4 MB per job, measured, not assumed.
- Every ranged fetch passes the SSRF check and the egress proxy, carries the
  replayed headers, counts toward the size cap, and stops on cancel.

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
