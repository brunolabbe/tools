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
