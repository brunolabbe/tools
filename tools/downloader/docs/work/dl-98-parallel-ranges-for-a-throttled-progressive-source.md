---
id: dl-98
tool: downloader
title: A progressive source throttled per connection downloads at one connection's rate, though four would be four times faster
kind: work-package
status: done
milestone: null
depends_on: [dl-96, dl-102]
difficulty: hard
awaiting: CodeQL's js/request-forgery alert on startProxy in tools/downloader/engine/test/parallel-ranges.test.ts — reads dismissed (Suppressed via SARIF) on main's security tab after the first push to main following this merge
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

## Review

**Gate: FAIL** — 2026-10-11 · `df941568..53a1e7af` · Sonnet 5.5, depth full · ffmpeg 6.1.1 (distro) unless a line says 7.0.2 (`ffmpeg-static`, `FFMPEG_PATH` unset) · every figure below is from a run made by this gate; scripts are in the scratch directory `dl-98/gate-1/g1b/` and take the tree as an argument

Three `high` findings (a remote crash of the API process, a stall that hangs a split job where the baseline recovers in 32 s, and a rate meter that goes blind for origins that write 64 KiB at a time), three `med`, two `low`. The branch's own tests are green on Linux (engine spec 23 of 23, api spec 2 of 2, `stream.test.ts` 75 of 75; on 7.0.2 the dl-98 specs pass 25 of 25), and the properties rows 1 and 6 name go red when removed (own mutations). The findings are what those fixtures cannot see.

| Done when                                                                                                                                                                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A throttled-per-connection job switches to 4 connections, at least 3x faster than the single-connection baseline, in a test that fails if the switch is removed                                                                                                     | **proven for its fixture** — `engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4 connections and finishes at least 3x faster": the `>= 3` assertion on single/split milliseconds, with `fanOut > 4`, `maxOpen === 4` and equal `packetDigests`. 10 of 10 quiet runs 3.419–3.451; 3 of 3 beside a looping CPU-heavy suite 3.429–3.456 (the load average stayed under 0.5, so that run is weak evidence); 3 of 3 under 12 busy loops plus that suite (load average 10.02) 3.251, 3.393, 3.254. Switch removed (`#split` never called): red 3 of 3 at `fanOut > 4` ("expected 0 to be greater than 4"), and the raw ratio printed before any assertion was 0.999 (8398 ms against 8403 ms). **What the fixture cannot see is F3**: it writes 16 KiB at a time.                                                                                                                                     |
| 2. A fast origin, a source of unknown size or duration, and an opted-out host each stay on exactly one connection, counted at the fixture                                                                                                                              | **proven as written**, with two meds this line depends on (F4, F5). Tests: "a fast origin stays on exactly one connection, counted at the fixture", "a source of unknown size stays on one connection; control: ranged, so sized, it splits", "a source of unknown duration stays on one connection; control: told its duration, it splits", "an opted-out host stays on one connection, a subdomain of it too" — each asserts `{ fanOut: 0, maxOpen: 1, requests: 2 }`. The size control goes red when the size is read from the variant only (1 failed, "expected 0 to be greater than 0"); the duration control does not go red when the duration is read from the probe only (23 of 23 pass), which is F4.                                                                                                                                                                                                              |
| 3. Output identical in media to a single-connection run, a tail-`moov` file included                                                                                                                                                                                   | **proven** — "the output of a split %s is identical in media to a single-connection run" for `faststart.mp4` and `moov-end.mp4`: `packetDigests` (framemd5 per packet) equal, with the companion `digests.length > 100` that fails on empty output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4. For each refusal in Decision 5 (429, 403, 503, reset, 200 to a range request, no speed-up at 4) the job completes on one connection with identical media, and a second job to that host opens one connection                                                        | **proven** — "$kind: the job completes on one connection, identical in media, and the next job opens one", six rows, asserting identical `packetDigests`, only open-ended requests after the last fan-out request, and `{ fanOut: 0, maxOpen: 1, requests: 2 }` for the second job. **Verified beyond it**: 48 of 48 (2 files x fan-out positions 0, 3, 8 x 8 failure shapes: 429, 503, reset, 200, truncate-then-reset, truncate-then-clean-end, headers-then-reset, wrong range) finished `ok` with identical media, none `SOURCE_NOT_SEEKABLE`.                                                                                                                                                                                                                                                                                                                                                                          |
| 5. Bytes held ahead never exceed 4 x 4 MB per job, measured                                                                                                                                                                                                            | **proven on the feeder's own counter** — "bytes held ahead never exceed 4 x 4 MB, measured at the defaults with ffmpeg not reading" (`<= 16 MiB`, `>= 12 MiB` while paused). **Verified physically**, own run, 256 MiB body, defaults, reader stalled 8 s after 24 MiB: counter peak 13.1 MiB; `arrayBuffers` after a forced GC at the end of the stall 17.3 MiB above the base (≈4 MiB over the counter, not isolated; the 34–36 MiB peak before GC presumably includes bytes already delivered and not yet collected).                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6. (reworded 2026-10-10) Each function this branch adds or changes that issues a ranged request, listed by name in the Log, passes the SSRF check and the egress proxy, carries the replayed headers, counts toward the size cap and stops on cancel, each with a test | **proven** — the Log's list is complete: `RangeFeeder#request` is the only issuer added (grep of `get(`, `http.request`, `https.request` over the three changed sources finds it, `get` and `openTunnel` only). Per property, and each goes red when removed (own mutations, one test run each, control green): route forced to `direct` — "every fetch, relayed and ranged, goes through the proxy with the replayed headers" red (`expected [] to have a length of 29`); redirect hops fetched around the proxy — both `api/test/parallel-ranges-behind-the-proxy.test.ts` tests red (`expected 3 to be +0`, the trap saw 3 connections); replayed headers dropped — same engine test red; cap check removed — "the size cap counts reassembled bytes, relayed and fetched, and stops every fetch" red; feeder's cancel unwired — "a cancel stops the relay and every ranged fetch, and nothing is fetched after it" red. |

**The rewording, graded.** It drops the universal quantifier ("every ranged fetch") and with it two things: a second issuer added later would not be caught by the line, and the shapes of one issuer (relay, chunk, continuation, redirect hop, https through `CONNECT`) are covered only where a test happens to exercise them. This build is fine on both: one issuer (enumerated above), and I ran the shapes the tests skip by hand (relay redirected to loopback and to `169.254.169.254`: refused by the real guard and the job fails `DOWNLOAD_FAILED`, the same code the base tree gives for the same origin). It does not drop ffmpeg's own request to the loopback, which the old line, read literally, made false by design (that request must not pass the SSRF check or the proxy; `-http_proxy ""` is what keeps it off). It adds "each with a test", stricter than the old line.

### Findings

- **high** · no `Done when` line depends on it, but it breaks the process · **F1: an origin-controlled status line or reason phrase kills the API process.** `RangeFeeder#begin` runs `void this.#request(...).then(receive, onError)`; `#receive` is the fulfilled handler and calls `ServerResponse#writeHead` with the origin's status code and reason phrase unchecked, so a throw there is an unhandled rejection, and the API installs no process-level handler. Node's client accepts `HTTP/1.1 099 …`, `000` and a control character in the reason phrase; `writeHead` throws `ERR_HTTP_INVALID_STATUS_CODE` / `ERR_INVALID_CHAR`. The origin only has to answer the seek probe (`Range: bytes=1-1`) with a `206`, which the attacker's own server does. Reproduction (own run; `g1b/crash.mts` takes the tree and the status line the origin sends after the probe):
  `node --import tsx crash.mts <head tree> "HTTP/1.1 099 Odd"` → `RangeError [ERR_HTTP_INVALID_STATUS_CODE]: Invalid status code: 99 … at RangeFeeder.#relayHead … exit=1`; `"HTTP/1.1 206 Par\x01tial"` → `TypeError [ERR_INVALID_CHAR]: Invalid character in statusMessage … exit=1`. The same origin against the base tree (`df941568`, ffmpeg reads it directly): `job rejected: DOWNLOAD_FAILED … process still alive after the job, exit=0`. `g1b/fuzz.mts` (24 crafted answers, one an honest control, feeder only) finds exactly these: status 099, 000, reason phrase with `\x01`, `\x7f` or NUL → `unhandledRejection`; status 600/999, header values with control bytes (rejected by the parser as `HPE_INVALID_HEADER_TOKEN`), a malformed `Location`, duplicate or huge `Content-Length` → handled (502 or passed on). Also in this family: `HTTP/1.1 101` on a relayed request resolves nothing (no `upgrade` listener, and `get` has no timeout), so the loopback request got no answer within the harness's 2 s window; I did not measure how long it lasts. Fix shape: a catch on the whole fulfilled handler that fails the fetch, and a bound on how long any origin request may wait for headers (see F2); the builder's call.
- **low** · no live call site beyond a co-located process · **F7: the loopback server's request handler can throw too.** `new URL(request.url, "http://loopback")` runs before the token check. `g1b/badurl.mts <tree> "//["` sends `GET //[ HTTP/1.1` to the feeder's port: `TypeError [ERR_INVALID_URL]: Invalid URL`, exit 1, no token needed; `"/ok"` → `404`. Reach is 127.0.0.1 only (the egress guard refuses loopback), so a co-located process, not a visitor. Same fix family as F1.
- **high** · `Done when` 1 is met by its fixture, but the feature's promise ("ffmpeg keeps its own seeking and reconnect logic", Decision 1) fails in split mode · **F2: a second loopback request is starved while the first holds the slots, so any stall hangs the job.** `#fill` shares one pool of `connections` slots across all requests, and `#fillAll` refills in insertion order, so the first request's lookahead always wins. ffmpeg opens a seek or a reconnect connection before it closes the old one (the ticket's own Log records two open at once on a seek; the stall run below shows a reconnect starved), and the new request gets no fetch and, because `writeHead` precedes the first byte, no headers: ffmpeg waits for them until its 30 s read timeout. A fetch that stalls (headers, then silence) makes that permanent, since nothing in `get` times out. Two reproductions, own runs:
  1. Feeder only, defaults (4 MiB chunks), 96 MiB body, first read stopped after 12 MiB with the split engaged: `g1b/starve2.mts <tree> a-open 96 4` → `A read 12597441 B then stopped reading; feeder mode=parallel; maxHeld=13074432 B` / `a-open: B (a seek to 80%) -> NO RESPONSE (no headers, no byte) within 12000 ms`. Controls: `a-closed` (first request destroyed before the second) → `first byte after 4 ms (status 206)`; `a-resumes` (first reader resumes after 3 s) → still `NO RESPONSE … within 12000 ms`. A small body does not show it: the remainder fits the socket buffers and the slots free up (`g1b/starve.mts`, 4 MB file: second request served in 11 ms).
  2. Through the engine and real ffmpeg, one connection stalls once, 2 MB/s, `faststart.mp4`, 30 s read timeout (`g1b/stall-engine.mts <tree> <direct|feeder> faststart.mp4`): direct (opted-out host) `ok media=identical in 32.4 s`, `Will reconnect at 1000000 in 0 second(s), error=Connection timed out.`; feeder (third fan-out fetch sends headers and stops) `TIMEOUT … in 153.0 s` against the 150 s stage timeout I set, `Will reconnect at 819200 … error=Connection timed out.` repeated with growing delays, origin saw 6 fan-out requests and no new one. With the default stage timeout the same stall in `g1b/sweep.mts` (`stall` group) ended `DOWNLOAD_FAILED` after 809.5 s (what ended it I did not establish), holding a job slot the whole time. The relay before the split is not affected (a relay request takes no slot).
     Two parts, both the builder's: an idle bound on every origin fetch so a stalled one fails into the fallback, and slot arbitration so a newer request is not starved (for instance dropping an older request's lookahead when a newer one arrives). Either alone leaves part of this.
- **high** · `Done when` 1 and the test that proves it · **F3: the rate meter discards every chunk the response write reports as backpressure, which blinds it for origins that write 64 KiB at a time; the test passes because its fixture writes 16 KiB.** `#pump` marks a request `blocked` when `ServerResponse#write` returns false, pauses the origin response and calls `Meter.interrupt()`, which drops the interval before the next chunk. Node 22 (v22.23.3 here) has a 64 KiB high-water mark and `write` reports it as soon as 64 KiB is in one call, whether or not the socket took the bytes at once (`g1b/hwm.mts`: writes of 1024, 16384 and 32768 B → true; 65535 B, in the same tick as those, → false because the unflushed total passed 64 KiB; 65536 and 131072 → false; the feeder-only table below shows the single-write threshold, 65535 true and 65536 false), so a source whose data events are 64 KiB never accumulates `measureMs` of active time and never splits, with no log line and no refusal recorded. Own runs:
  Feeder only, 1 MB/s, `g1b/winsim.mts <tree> normal 1000000 <write size>`: 16384, 32768, 49152, 65535 → `feeder mode=parallel; fan-out requests the origin saw=29`; 65536 and 131072 → `feeder mode=single; fan-out requests the origin saw=0`.
  Real ffmpeg, the 3x fixture's file with the declared duration cut to 0.5 s (media 8 MB/s) so every rate below is "slow", measure window 200 ms, `g1b/bigwrite.mts <tree> <bytes/s> <write sizes>`:

  | origin rate per connection | 16 KiB writes            | 64 KiB writes                |
  | -------------------------- | ------------------------ | ---------------------------- |
  | 1 MB/s                     | split, 30 fan-out, 1.4 s | split, 30 fan-out, 1.5 s     |
  | 2 MB/s                     | split, 28 fan-out, 0.8 s | **single, 0 fan-out, 2.3 s** |
  | 3 MB/s                     | split, 27 fan-out, 0.6 s | **single, 0 fan-out, 1.5 s** |
  | 5 MB/s                     | split, 24 fan-out, 0.5 s | **single, 0 fan-out, 0.9 s** |

  Same origin rate, same file, same declared duration; only the origin's write size differs. At 500 KB/s, the 3x fixture's rate with the declared 6 s duration, 16, 32 and 64 KiB writes all still split (fan-out 31, 31, 31); I did not run the motivating origin's 15–27 KB/s. The module comment ("records a rate over the time something was actually flowing, and nothing else") and `Meter`'s claim are false for this case. Fix shape (builder's): count paused time by timestamp rather than discarding the next interval, or call it backpressure only when `drain` has not fired by the next tick. This is probably also the Windows leg's red (below), but that is not measured.

- **med** · `Done when` 2 depends on it · **F4: Decision 3's "unknown duration" is read by the build as "neither the probe nor ffmpeg's own `Duration:` line knows it", and no test pins that reading. This is the premise of the open decision below.** `attempt` hands the feeder `durationSec: () => mediaDurationSec ?? learnedDurationSec`; `learnedDurationSec` is dl-96's reading of ffmpeg's `Duration:` line. With the duration narrowed to `mediaDurationSec` (what the probe knew before the stream) the engine spec still passes 23 of 23 — the "unknown duration" test uses a live-written Matroska that ffmpeg cannot time either, and its control passes the duration in the variant. The size half is pinned (narrowed to the variant's size, "a source of unknown size … control: ranged, so sized, it splits" goes red). **Open decision, measured, no recommendation (the dispatch asks for the measurement only):** the dl-96-shaped source (tail-`moov` MP4, `filesizeBytes` known from the browser, `durationSec` absent — dl-96's Why says a browser-found progressive variant "carries a size and no duration"), origin 300 KB/s per connection, own run of `g1b/item3.mts` (`GATE_SRC=1`):

  | reading                                                                                           | dl-96 shape                              | size absent, duration known   | both absent                   |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- | ----------------------------- |
  | build's (probe, else ffmpeg's `Duration:`; size from the variant, else the 206's `Content-Range`) | 30 fan-out, 4 open, mode parallel, 4.2 s | 31 fan-out, 3.9 s             | 30 fan-out, 4.2 s             |
  | duration from what the probe knew only (`g1b/mutate.mjs probe-duration-only`)                     | **0 fan-out, mode single, 14.1 s**       | 31 fan-out, 3.9 s             | **0 fan-out, single, 14.1 s** |
  | size from the variant only (`probe-size-only`)                                                    | 30 fan-out, 4.3 s                        | **0 fan-out, single, 14.1 s** | **0 fan-out, single, 14.1 s** |

  So the probe-limited reading leaves a source shaped like dl-96's on one connection, 3.4x slower in this fixture; dl-98's Why names that source as the case it was filed for. Options for the owner: (a) the build's reading, which makes a ranging origin eligible whenever ffmpeg can time the file; (b) probe-only, under which only variants whose resolver supplies both size and duration are eligible. Whichever is chosen needs a test that pins it.

- **med** · `Done when` 2 depends on it (its "opted-out host" clause) · **F5: the operator's opt-out, `SINGLE_CONNECTION_HOSTS`, is wired from the environment to the engine and nothing tests the wiring.** The engine spec sets `singleConnectionHosts` on the engine directly. With `loadApiConfig`'s `list(env["SINGLE_CONNECTION_HOSTS"])` and `server.ts`'s `singleConnectionHosts: config.singleConnectionHosts` both replaced by `[]` (own mutation, scratch tree), `api/test/config.test.ts` passes 6 of 6; `grep -rn SINGLE_CONNECTION_HOSTS tools/downloader/api/test tools/downloader/engine/test` finds nothing. If either line breaks, the host an operator listed for its anti-bot layer is split anyway, silently. Needs one test through `loadApiConfig` and one through `createApp` (or the engine config's env fallback, which parses the same variable a second time).
- **med** · no `Done when` line depends on it · **F6: the `CodeQL` check is red on this head and nobody has excused it.** `gh pr view 421`: check `CodeQL` FAILURE on `53a1e7af`; every other check SUCCESS except the informational Windows leg. The check page (WebFetch of its `detailsUrl`) prints "Check failure on line 584 in tools/downloader/engine/test/parallel-ranges.test.ts", "Server-side request forgery Critical test", "The URL of this request depends on a user-provided value". **Graded: a test-file false positive.** The call is `startProxy`'s `http.request(request.url, …)`, the fixture forward proxy that listens on 127.0.0.1 inside the test and forwards whatever absolute-form target a test sent it; it never ships, and GitHub labels the alert `test`. No request path a visitor influences. `docs/adr/005` requires, in the triage steps and rules 1–4: reproduce against the tip (done here), say true or false positive on the evidence, and record **the category as the reason** for a test double ("do not argue the logic of code that never ships"); the excuse is a comment on its own line directly above the alert, carrying the query id (`js/request-forgery`), the file, the date, the reasoning, and the test that would go red if the design regressed (rule 3, "no test, no excuse" — for a fixture there is no production design, and the ADR does not say what field five holds; the builder should say so in the comment); that comment is the register, not the mechanism: the `CodeQL` check stays red on this pull request until the push-to-`main` dismissal step in `security.yml` runs, so landing needs the owner's recorded excusal (the lg-5 precedent), after which the row is `awaiting`. One thing to check when writing it: the printed line is not the one carrying the URL argument (in the head blob it is the closing `);` of the multi-line `http.request(` call), and the suppression query scopes a comment to exactly the line after it; read the SARIF region, do not infer it.
- **low** · **F8: the refused-host set never shrinks.** `Engine#refusedHosts` takes one entry per distinct refusing hostname and has no cap or expiry (Decision 5: "until restart"). Own run, `g1b/refusedset.mts <tree> 24`: 24 jobs to 24 distinct refusing hosts, all 24 completed, set size 24. Growth is one short string per job a visitor can start, bounded in practice by job throughput; recorded because the question was asked, not because it bites.
- **dropped** · (a) "physical memory is 34–36 MiB over the 16 MiB bound": explained, 17.3 MiB retained after a forced GC (row 5). (b) `serve.position` is wrong for a suffix `Range: bytes=-N` relayed to the origin: ffmpeg never sends one and only a token holder could; no live call site. (c) a response closing before `#receive` attaches its `close` listener would leave `fetch.closed` unresolved and delay a continuation: could not be made to happen in any run, including 18 origin-dies and 8 continuation-once cases; unverified, dropped.
- **findings** · the hunt returned 11; 8 carried (F1–F8), 3 dropped.

### Items the dispatch asked for, answered

**1. The loopback server and its egress.** It binds `127.0.0.1` only (`listen(0, "127.0.0.1")`), on a random port, answering one path of 128 random bits: another path is `404`, a non-`GET` `405` (test "the loopback answers its own path only, and only GET"; and see F7 for what it does before that check). Anything that holds the path can request through it, and what it can make the feeder fetch is only the candidate URL with a `Range` of the requester's choosing; the path is in ffmpeg's argv. Every origin request is `get` from `seek-probe.ts` on the probe's route. Own runs against the real `startEgressProxy` and `createSsrfGuard` (`g1b/item1.mts`): the origin redirects every fan-out fetch to `http://127.0.0.1:<trap>/x` → job `ok`, trap connections 0, guard log `BLOCKED_TARGET reason=blocked-address address=127.0.0.1`; to `http://169.254.169.254/latest/meta-data/` → trap 0, `address=169.254.169.254`; to `localhost`, `[::1]`, `2130706433`, `0x7f.1`, `https://169.254.169.254/` (the `CONNECT` path), `[::ffff:127.0.0.1]`, `10.0.0.1` → trap 0 and a `BLOCKED_TARGET` each (7 of 7); `file:///etc/passwd` → no request leaves (`ERR_SCHEME`). **Positive control**: the same run with the guard's private-address block off → trap connections 3, no guard refusal. The relay (open-ended request) redirected to loopback or to `169.254.169.254` → refused by the guard, job `DOWNLOAD_FAILED`, identical to the base tree. Every other ffmpeg input keeps the proxy: argv (via a logging wrapper) carries `-protocol_whitelist http,tcp -http_proxy ""` only before the loopback `-i`; with a subtitle track the proxy forwarded `faststart.mp4` and `sub.vtt` and nothing addressed to the loopback port. The server and its connections were gone, with no origin connection left open, after a success, a cancel mid-split, a stage timeout (1500 ms), an already-aborted signal, a nonexistent ffmpeg and a NUL byte in the title (spawn throws synchronously; the runner turns it into a rejection, `INTERNAL`): 0 of N servers still listening each time. A size-cap refusal at the estimate never created one. No shell is invoked in `parallel-ranges.ts`, the feeder logs no header and no loopback path, the runner does not log argv, and the one URL the feeder logs goes through `redactUrl` (ffmpeg's own stderr at debug level I did not read for the path).

**2. Timing.** Row 1. The single-connection baseline is deterministic (8378–8398 ms quiet, 8468–8616 ms saturated, origin-paced); the split side carries the variance. Removing the switch fails the test 3 of 3. The fixture can fail for reasons other than the switch: the `maxOpen === 4`, `fanOut > 4` and digest assertions trip on slot, ordering and reassembly regressions, and under saturation the margin over 3 shrinks to 8%; no run of 16 unmutated runs failed.

**4. dl-103's detection.** No feeder answer found that makes ffmpeg read an origin as short or unseekable when it is neither, or the reverse. The detector needs `partial file` and `Stream ends prematurely` at the same byte; the feeder cuts only at a delivered boundary, so equality needs a sample to start exactly there. Swept with the real engine against the same origin read directly: the 48 refusal cases above; origin dying for good after fan-out #0, #2, #6 (reset, 503, 200): `DOWNLOAD_FAILED` (a short source) 9 of 9 on the tail-`moov` file, e.g. `Stream ends prematurely at 376880` with no `partial file` at that offset, and the 200 variant `partial file` at 0x613fb against an early end at 393264, so not equal; on the fast-start file the same three after #0 are `DOWNLOAD_FAILED`, and 6 of 6 after #2 and #6 ended `ok` with identical media (the file was already complete before the origin died); a continuation answered badly once (503, reset, 200, headers-then-reset) → 8 of 8 `ok`, identical; an origin that answers `206` to the probe and `200` to every later request → feeder and direct give the same result (`DOWNLOAD_FAILED` on the tail-`moov` file, `ok` on the fast-start one). The one stall (F2) is the exception. A `200` on a fan-out connection never reaches ffmpeg; it falls back.

**6. Windows (reading A).** `gh run view 38102735870 --json jobs`: every step of `test (windows-latest, informational)` that ran passed except `Run npm test`. 21 of 25 dl-98 tests failed (19 of 23 engine, 2 of 2 api); the four that passed are the fast origin, the opted-out host, "the loopback answers its own path only, and only GET" and "a proxy's refusal reaches ffmpeg in the proxy's own words". None is skipped on win32 (no platform conditional in either file). The fan-out never engages: every failure is `fanOut` 0 or `mode` `single`, and the feeder-only tests (no ffmpeg, no spawn) fail the same way, so it is not `-http_proxy ""` through `spawn`. **Why: unmeasured.** The mechanism reproduced on Linux is F3, which gives the same symptom (mode `single`, 0 fan-out requests, the read completing whole); whether Windows' reads reach 64 KiB for these fixtures I could not measure. A diagnostic for the builder: log, per request, the data-event sizes and the count of `interrupt()` calls on the Windows leg. **A Windows job still completes correctly on one connection**: in the failing tests the first assertions passed (identical `packetDigests` in all six refusal tests; `read.equals(body)` in the feeder tests), 5032 tests passed overall, including `stream.test.ts` with the feeder in the path (75 tests, 15 skipped, so 60 ran; which 15 the log does not say). Not measured: `-http_proxy ""` through Windows `spawn` (the assertion that proves it, in "with the egress proxy configured, ffmpeg's own request never reaches it", follows the failed `fanOut` one). The leg is informational and no Done-when line names Windows.

- NFR: security — F1 (remote process crash), F7, F6, SSRF and egress ✓ (items above) · performance — F3, F2 · reliability — F1, F2, F3, F8 · maintainability — `parallel-ranges.ts` is 992 lines in one class with the flow control, the meter and the fallback interleaved; the tests are thorough on the paths they chose, and every comment I checked states the code except `Meter`'s (F3) and the module's "ffmpeg keeps its own seeking" (F2).
- Invariants walked: tool boundary ✓ (only `@downloader/contract`); typed errors ✓ (`SIZE_LIMIT_EXCEEDED` through `AppError`; module-internal `Error`s never leave the module); no shell, no process tree added ✓; redaction ✓; SSRF after every hop ✓ (item 1); contract untouched ✓; tests registered ✓ (new files under existing packages; CI `check` green); no new workspace dependency ✓. Skipped: no-faked-progress (no progress code), Dockerfile closure (no new workspace import).
- CI at the head `53a1e7af`: `check` x2, `e2e (direct)`, `e2e (sniffer)`, `docker`, `codeql`, `dependency-review`, `changes`, `test (ubuntu-latest)` SUCCESS; `test (windows-latest, informational)` FAILURE (above); `CodeQL` FAILURE (F6). Unmeasured by this gate: the live throttled origin and the production 5 s window against it; the downloader project end to end (the ubuntu leg ran it green); HLS on 7.0.2 (not touched by this branch).

### Gate 2

**Gate: CONCERNS** — 2026-10-11 · `53a1e7af..3b6a832d` (the round's two commits, `git log --no-merges --first-parent`) · Sonnet 5.5, depth full · ffmpeg 6.1.1 (distro) unless a line says 7.0.2 (`ffmpeg-static`, `FFMPEG_PATH` unset) · every figure is from a run made by this gate; scripts are in the scratch directory `dl-98/gate-2/g2/` and take the tree as an argument

**Nothing I found is a `high`.** All eight of gate 1's findings are fixed, pinned or recorded as the brief and the owner's answers require, and the three highs reproduce no longer. The round adds two `med` problems in lines it touched (F9, F10) and one `low` (F11); none is in a `Done when` line's way, so no third gate is owed unless the owner asks for one. The engine spec passes 34 of 34 and the api spec 3 of 3 on this head (7.0.2: 34 of 34 and 3 of 3); `stream.test.ts` was not re-run here; CI's `test (ubuntu-latest)` ran it, with the rest, green on this head.

### Gate 1's findings

- **F1 (high) — fixed.** `g1b/fuzz.mts`, rerun: 24 of 24 crafted answers handled, no `unhandledRejection`. Status 099, 000, 600 and 999 now reach the reader as `502 Bad Gateway`; a reason phrase with `\x01`, `\x7f` or NUL is relayed empty (`status 206 ""`, body complete); a latin-1 reason phrase passes unchanged; the `101` is bounded by the idle bound, not by the harness's 2 s window. `crash.mts`, which exited 1 on the previous head, exits 0 for `HTTP/1.1 099 Odd`, `000 Zero`, `206 Par\x01tial` and `600 Six`: `job rejected: DOWNLOAD_FAILED … process still alive`, the base tree's answer. Each guard goes red alone when reverted (own mutations, one test each): without `#receiveOrFail`'s catch, "F1: … status 099" fails; without that catch and the reason-phrase guard, "F1: … a control character in the reason phrase" fails.
- **F7 (low) — fixed.** `badurl.mts <tree> "//["` → `GET //[ -> HTTP/1.1 404 Not Found; process alive` (was `TypeError [ERR_INVALID_URL]`, exit 1). "F7: a request target the loopback cannot parse is a 404, not a crash" fails with the string comparison and the handler's catch both reverted (`Unhandled Errors`).
- **F2 (high) — fixed, both parts.** Starvation: `starve2.mts <tree> <variant> 96 4` at default chunk size, split engaged, first read stopped after 12 MiB: `a-open` first byte after 4 ms (status 206), `a-closed` 5 ms, `a-resumes` 3 ms (was `NO RESPONSE … within 12000 ms` for the first and third). Stall: `stall-engine.mts <tree> feeder faststart.mp4`: `ok media=identical in 22.0 s` (was `TIMEOUT … 153.0 s`); the tail-`moov` file the same, 22.0 s; direct is 32.4 s. A relay (never split) stalled mid-body: `ok media=identical in 22.2 s`, `Will reconnect at 1000000`. Both fixes red when reverted: without the `#dropLookahead` loop "F2: a second request is answered at once …" fails; with `#arm` made a no-op "F2: a fan-out fetch that sends its headers and then nothing …" fails (`expected 31008 to be less than 15000`) and so does the `101` test. New cost, F10 below.
- **F3 (high) — fixed.** Real ffmpeg, media declared 8 MB/s, `bigwrite.mts <tree> <bytes/s> 16384 65536 131072`: at 1, 2, 3 and 5 MB/s per connection all three write sizes now split (fan-out 24–31 each; the 64 KiB rows that were `single, 0 fan-out` at 2, 3 and 5 MB/s are 28, 27 and 24). Feeder only, `winsim.mts`: write sizes 16384, 65535, 65536 and 131072 → `mode=parallel`, 29 fan-out each; the every-write-is-backpressure simulation → `mode=parallel`, 29. "F3: an origin that writes 65536 bytes at a time is measured, and splits" fails with the pause turned back into an interruption (`expected 0 to be greater than 4`). Done when 1 re-run on this head, `parallel-ranges.test.ts › "a job that measures slow switches to 4 connections and finishes at least 3x faster"` instrumented to print its ratio: 10 of 10 quiet runs 3.450–3.476 (gate 1 saw 3.419–3.451), single 8369–8373 ms, split 2408–2427 ms. The builder's named cost and its reverse are measured under F9 and "The reverse" below.
- **F4 (med) — pinned, and the build does the owner's choice.** "F4: a source the probe could not time, but ffmpeg can, is split (the owner's reading of Decision 3)" fails with `durationSec: () => mediaDurationSec` (`expected 0 to be greater than 4`). The Log records the options, the recommender, the owner's choice and gate 1's numbers (4.2 s against 14.1 s).
- **F5 (med) — tested.** Three separate reverts each turn a test red: the engine config's env parse (`expected [] to deeply equal [ 'cdn.example.com', '.other.org' ]`), the API's `list(env[…])`, and `server.ts`'s pass-through (the same assertion, through `loadApiConfig` and `createApp`).
- **F6 (med) — the build does the owner's choice; the check stays red until `main`.** The comment sits on its own line directly above the forwarding call, and the call is one line now. The check (WebFetch of its `detailsUrl`) prints "1 new alert including 1 critical severity security vulnerability", Server-side request forgery, on `3b6a832d`, at line 617, which is that call, the line after `// codeql[js/request-forgery]`. Against `docs/adr/005`: query id, file, date and reasoning are in the comment; the category is the reason (triage step 5); field five is stated and true, since pointing the fixture's forwarding at a dead address turns "every fetch, relayed and ranged, goes through the proxy with the replayed headers" red (own mutation, `expected false to be true`). The ticket's `awaiting:` line is `CodeQL's js/request-forgery alert on startProxy … — reads dismissed (Suppressed via SARIF) on main's security tab after the first push to main following this merge`: it has the `<owed> — <reading>` shape `docs/01-TICKETS.md` asks for, a nameable event, and `npm run status -- --show dl-98` prints it on its own row; `node scripts/status.mjs --json` exits 0 with empty stderr. **Row: awaiting** — the push to `main` after the merge runs `security.yml`'s dismissal step; the reading is the alert reading dismissed ("Suppressed via SARIF") on main's security tab. Every other check is SUCCESS on this head except the informational Windows leg (below), which is not a gate.
- **F8 (low) — recorded, no bound.** The Log's reason holds: any cap evicts a host before restart, which Decision 5 rules out.

### New in the round

- **med** · no `Done when` line depends on it as written · **F9: the rate meter's pause is one flag for every request, and nothing undoes it when the paused request goes away.** `#pump` calls `Meter.pause` when a request is `blocked`; `Meter.record` then subtracts the whole interval for every other request too. `Meter.resume` is reached only by that same request unblocking, never by its being dropped. So a request that ffmpeg stopped reading (backpressure) and then closed for a seek freezes the meter for the rest of the job: no verdict, no split. `stuckpause.mts <tree> <variant>`: origin 4 MB/s against media 10 MB/s (slow), 2 s window, request A read 200 KB and stopped for 7 s, then B read at full speed. New head, A closed: `B read 56.0 MB in 14.0 s; mode single; first non-single at never`; previous head: `B read 80.0 MB in 5.5 s; mode parallel; first non-single at 0.5 s`; control without A: split at 2.1 s on both. A kept open and paused: new head the same freeze, previous head split at 0.5 s. Mechanism confirmed: a scratch build that resumes the meter in `#drop` when the dropped head was paused splits at 0.2 s in the closed case and still freezes in the kept-open one. Reach: it needs the loopback's buffers (several MB) full while a request is unread, then a seek; I ran it at 4 MB/s, and at 500 KB/s to 1.2 MB/s over the 5 s window the pause never engaged (`slowreader.mts`), so the motivating origin does not reach it. The failure is the baseline (one connection), not an error. Fix, fully stated: count paused requests and treat the meter as paused only while every request being measured is, and resume for a request that is dropped while paused; add the case above as a test. Fixable at the landing without a re-gate if the owner chooses; I grade it `med` because it needs a paused request ahead of the measured one, and if the owner reads Done when 1 as "a slow job always switches" it is the one line it touches.
- **med** · no `Done when` line depends on it · **F10: the 20 s idle bound also applies to the relay's wait for headers, so an origin that answers late but within ffmpeg's 30 s fails the job.** `delayhdr.mts <tree> <direct|feeder> 25000 faststart.mp4` (ffmpeg's first read answered 25 s late, the probe on time): direct `ok () in 27.1 s`; behind the feeder `DOWNLOAD_FAILED (The download failed partway through.) in 20.1 s`, ffmpeg: `HTTP error 504 Connection timed out … Error opening input: Server returned 5XX Server Error reply`. The unanswered relay is not slot-gated, so it never needed the bound, and the relay's silence mid-body is already healed (cut at 20 s, ffmpeg reconnects, 22.2 s above). Silent origins, relay and chunk (`idlebound.mts`, defaults): headers then silence → read closed at 20.0 s (relay), fan-out cut at 20.3 s with refusal `{ kind: "reset", detail: "idle" }` and the job continuing at full speed; accepted and never answered → `504 Connection timed out` at 20.0 s. **Slow but alive is not cut**: one byte every 15 s survived 70 s on the relay (4 bytes delivered, still open), and on a chunk fetch survived 60 s (4 fan-out connections open, mode `parallel`, no refusal) with the no-speed-up judge switched off (`FLOOR=0`; with the default floor the first trickled byte is judged `no-speedup` at 15.3 s, which is that judge, not the bound). **Open decision, two remedies:** (a) apply the bound to chunk fetches and the post-fallback continuation only, leaving the relay to ffmpeg's own timeout; (b) keep a bound on the relay and set it to ffmpeg's 30 s or more. Recommended (a): it removes the regression, loses nothing the stall fix needs (a relay takes no slot), and (b) leaves a second timer on the relay that ffmpeg's own already covers.
- **low** · **F11: a failing assertion in a feeder test leaks a live feeder, and the next test fails on its traffic.** "a cancel stops the relay and every ranged fetch …" asserts before it aborts or closes; red there leaves a feeder fetching from the shared origin on a direct route. With that test's `expect(open).toBe(4)` changed to `toBe(3)` (scratch tree), Linux gives `a cancel stops the relay …: expected 4 to be 3` and then, in the next test, `expected [ …(29) ] to have a length of 47 but got 29` — the same signature as the Windows leg's second failure. Wrap the feeder in `try/finally` in the tests that hold one. No live call site beyond diagnosis.

### Attack items

**1. Arbitration.** `seekstress.mts <tree> <seed> 40`, feeder only, 1 MiB chunks (bound 4 MiB), 64 MiB body of self-addressing words so a misplaced byte cannot compare equal, 8 MB/s per connection: random requests (open-ended and closed ranges, 30% seeks back to an earlier offset), at most three open, some left open and unread while the next opens, readers pausing at random. Seeds 1, 2, 3: 40 requests each, 0 failures (every byte checked), worst first byte 14, 16 and 13 ms, `maxHeldBytes` 3.95, 3.83 and 3.97 MiB against the 4 MiB bound, `maxConcurrentFetches` 4. At default chunk size (`starve2.mts`) `maxHeld` 12.9–13.1 MB against 16 MiB. The previous head cannot be run through this harness: it never answers the second request (the run had to be killed after 10 minutes), which is also the positive control. Real ffmpeg on a tail-`moov` file: the identical-media tests and the 3x test pass (two requests alive at once). Not reproduced: a non-interleaved MP4 whose demuxer alternates between regions (no fixture; the seeks above stand in). A cost, not a defect (reasoned, not measured): taking a request's lookahead discards the chunks it had in flight, so at the reported 27 KB/s a seek throws away up to three partly fetched 4 MiB chunks.

**2. The builder's named cost, and the reverse.** Feeder only (`slowreader.mts`, production 5 s window, 60 MB body, media 10 MB/s): origin 4 MB/s (slow), reader unthrottled → `parallel` at 5.1 s; reader at 1 MB/s or 100 KB/s → `single` for the whole 30 s; and when a slow reader speeds up after 8 s the job splits at 11.5 s (100 KB/s then free) and 10.8 s (1 MB/s then free). So a slow reader does not make the origin measure fast and settle: it postpones the verdict until the reader is fast, and the previous head does the same (single for 30 s; 11.6 s and 10.9 s). Reverse, counted at the fixture: a fast origin never splits in 32 of 32 cases, fan-out 0 and mode `single` in each: real ffmpeg, 16/64/128 KiB writes at 4 MB/s, 20 MB/s and unlimited, windows 200 and 1000 ms, against 690 KB/s media (18); feeder-only with a 1 s window and origins of 800 KB/s to 4 MB/s read by bursty, throttled, stalled and 64 KiB-write readers (8); feeder-only with the 5 s window, origins 2 MB/s (media 690 KB/s), 5 MB/s (media 3 MB/s) and 15 MB/s (media 10 MB/s), the reader unthrottled or at 100 KB/s (6). The one wrong verdict I found is F9, and it errs toward the baseline.

**3. A mapped 502 mid-split.** `mapped502.mts <tree> feeder 8 moov-end.mp4` (a raw origin serving a real file at 2 MB/s, every request after the eighth answered `HTTP/1.1 099 Odd`): `DOWNLOAD_FAILED (The source cut part of the video short.) in 11.3 s`; ffmpeg: `Stream ends prematurely at 901168`, `HTTP error 502 Bad Gateway`, reconnect attempts at 0, 1, 3 and 7 s; no `partial file`, so dl-103's verdict never forms. The fast-start file after 14 good requests: the same `DOWNLOAD_FAILED … cut part short` at 11.5 s with `HTTP error 502 Bad Gateway`. The feeder logs the mid-split failure as `kind: failure, remembered: false`, so the host is not marked. Direct, the same origin: `DOWNLOAD_FAILED (The source ended before the whole video arrived.)` in 11.1 s on the tail-`moov` file (a `partial file` at 0x30, decided as a short source).

**4. Windows (informational leg), `53a1e7af` → `3b6a832d`.** `gh pr view 421`: `test (windows-latest, informational)` FAILURE and `CodeQL` FAILURE; `check` x2, `e2e (direct)`, `e2e (sniffer)`, `docker`, `codeql`, `dependency-review`, `changes` and `test (ubuntu-latest)` SUCCESS. In the Windows run, `Run npm test` is the one failed step; 5062 tests passed and 3 failed (was 21 failed). dl-98: engine spec 31 of 34, api spec 3 of 3. **The builder's two risks did not materialise**: the 3x test passed on Windows (11 s for the test), and "with the egress proxy configured, ffmpeg's own request never reaches it" passed, which is `-http_proxy ""` through `spawn` working on win32. The fan-out engages there now (every split, refusal, held-bytes, identical-media and F3 test passes). The three failures: (1) "a cancel stops the relay and every ranged fetch …": `expected 3 to be 4` for requests open at one instant 500 ms in; (2) "every fetch, relayed and ranged, goes through the proxy …": `expected [ …(29) ] to have a length of 51 but got 29`, which is F11's cascade from (1) (reproduced on Linux with the same signature above, not a bypass of the proxy); (3) "F2: a second request is answered at once …": `expected 'fallen-back' to be 'parallel'` at 2.5 s. (1) and (3) are assertions on the state at an instant; why Windows differs I did not measure (the same two tests pass on Linux, (3) 4 of 4 under 14 busy loops).

**5. The ticket.** `status: ready` is unchanged and the `Done when` section is untouched; the Log records both owner answers with their options and who chose, the round's findings with the reproduction and the red-when-reverted evidence for each, and what Windows could still show. `awaiting` and the register comment are graded under F6.

- NFR: security — F1/F7 closed, SSRF and egress unchanged by the round (api spec 3 of 3, including the guard tests) · performance — F9, F10, the lookahead cost · reliability — F2 closed, F9, F10 · maintainability — the new tests name the finding they pin and were each shown red; F11.
- Unmeasured: the Windows causes in (1) and (3); a non-interleaved MP4 through real ffmpeg; the live origin.

### Gate 3

**Gate: PASS** — 2026-10-11 · `3b6a832d..6f85fb48` (the round's two commits, `git log --no-merges --first-parent`) · Sonnet 5.5, depth narrow · ffmpeg 6.1.1 (distro) · every figure is from a run made by this gate; scripts are in the scratch directory `dl-98/gate-3/g3/` and take the tree as an argument

Narrow, as asked: gate 2's F9, F10, F11 and its two Windows-only assertions, and what the round itself broke. **Nothing I found is a `high` or a `med`**: three `low`s are recorded, none in a `Done when` line's way, and the one acceptance obligation outstanding is the `awaiting` row from gate 2, unchanged. The engine spec passes 38 of 38 and the api spec 3 of 3 on this head. Settled rows were not re-measured; the 3x test was run three times because the meter changed (3.469, 3.467, 3.474; single 8370–8378 ms, split 2409–2417 ms), and the slow-reader and fast-origin scenarios were repeated once for the same reason (below).

### Gate 2's findings

- **F9 (med) — fixed.** `stuckpause.mts <tree> <variant>` (origin 4 MB/s against 10 MB/s of media, 2 s window, request A read 200 KB and stopped for 7 s, then B read at full speed): `controlNoA` split at 2.1 s; `withA` (A closed) `B read 80.0 MB in 5.2 s; mode parallel; first non-single at 0.2 s`; `withAkept` (A left open and paused) `80.0 MB in 7.1 s; mode parallel … at 0.5 s`. Gate 2's head gave "never" for both. Tests, each shown red by this gate: "F9: a paused request ffmpeg closed …" and "F9: a paused request left open …" both fail against the previous head's source (`expected null not to be null`); the second also fails with the all-paused rule replaced by "any request paused" (`expected null not to be null`). The first stays green with only the release-on-drop removed, as the Log says, because the per-request rule alone covers it; the release is pinned by "F9: a request ffmpeg closed while it was reading does not count a later pause as the origin's time", which passes on the head and fails with the release removed (`expected 'parallel' to be 'single'`, a 4 MB/s origin against 3 MB/s of media was split). That third test passes on the previous head's source: it guards the new design, not the old defect.
- **F10 (med) — fixed, as the owner chose.** `delayhdr.mts <tree> feeder 25000 faststart.mp4` (ffmpeg's first read answered 25 s late): `ok () in 25.8 s`, where it was `DOWNLOAD_FAILED … in 20.1 s` with `HTTP error 504`; direct is 27.1 s. `idlebound.mts`, defaults: a relay answered with headers and then silence, and a relay accepted and never answered, are both still open at 70.1 s with no 504 (the feeder leaves them to ffmpeg; the harness's own client has no timeout); the silent fan-out fetch is cut at 20.3 s (`onRefused 127.0.0.1 reset`, refusal `{ kind: "reset", detail: "idle" }`) and the read continues `fallen-back`, 40.6 MB by 60 s; a trickling fan-out fetch (one byte every 15 s, speed-up judge off) has 4 connections open at 60.1 s. **A relay silent mid-body is still healed by ffmpeg**: `stall-engine.mts <tree> feeder-relay faststart.mp4` (the relay never splits, stalls after 1 MB once) → `ok media=identical in 32.4 s`, `Will reconnect at 1000000 … error=Connection timed out.`, the direct path's time to the tenth. Tests red when the relay is bounded again: "F10: a relay answered later than the idle bound is not cut …" (`expected 504 to be 206`) and "F1: a 101 on a relay is left to ffmpeg's own timeout, and going away closes it" (`expected 'answered 504' to be 'gave up'`).
- **F11 (low) — fixed.** Gate 2's plant, an assertion that fails before the cancel test aborts or closes anything (`expect(open).toBe(99)`), run over "the feeder's own limits": with the registry, `1 failed | 5 passed` (`expected 4 to be 99`) and the next test, "every fetch, relayed and ranged, goes through the proxy …", passes; with the registry's close removed (positive control), `2 failed | 4 passed`, the second with the old cascade signature `expected [ …(29) ] to have a length of 55 but got 29`.
- **The two Windows-only assertions — fixed, each still red without its feature.** "a cancel stops the relay and every ranged fetch …" now waits up to 10 s for `mode === "parallel" && open === 4`; with the switch to parallel removed it fails after 11 s with `Error: not within 10000 ms: {"open":0,"stats":{"mode":"single",… "originRequests":1 …}}`. "F2: a second request is answered at once …" waits up to 15 s for the split, the first reader stopped at 8 MiB and three chunks held; with the switch removed it fails with `not within 15000 ms: {"read":8388608,"stats":{"mode":"single",…`, and with the arbitration loop removed it fails with `Error: no answer within 10 s`. On the Windows leg of this head both pass (547 ms and 3309 ms), and the proxy test that used to fail by cascade passes too.

### New in the round

- **low** · no `Done when` line depends on it · **G3-1: the new meter keeps every completed chunk fetch alive.** `Meter.release` is called when a response ends, a fetch fails and a serve is dropped, but not where a bounded fetch completes inside `#data` (it destroys the response, so `end` never runs) and not in `#dropLookahead`; `#members` holds those fetches until the feeder closes or the meter resets. `retain.mts <tree> 32 128` (a 128 MiB split read in 32 KiB chunks, forced GC, feeder still open): previous head `1.9 MiB above before` after 3896 origin requests; this head `33.8 MiB` after 3887, about 8 KiB a fetch. At the default 4 MiB chunk and the 4 GiB cap that is about 1024 fetches, 8 MiB, freed at the end of the job. It changes no verdict in parallel mode, where only chunk fetches are measured and none is ever paused. Fix: release at the completion path in `#data` and in `#dropLookahead`.
- **low** · no live call site I could build from ffmpeg's flow · **G3-2: a request that delivered data and then went silent, and is still open, makes the meter ignore another request's pause.** The meter is paused only while every member is, and a silent request is a member that is not paused. `silenta.mts <tree>` (request A: 100 KB, then its origin goes silent for good, kept open; request B from a fast origin, 4 MB/s against 3 MB/s of media, its reader stopped for 8 s after 200 KB): previous head `mode=single, fan-out requests=0, split at never`; this head `mode=parallel, fan-out requests=70, split at 8.1 s` — the stall was charged to the origin and a fast origin got four connections. Reaching it needs ffmpeg to leave a silent request open while it reads another; ffmpeg closes the request it abandons when a seek completes, and a silent one is bounded by its own 30 s. The relay no longer has the feeder's 20 s bound, which is the owner's choice, so this is the cost to record. Not fixed by G3-1's fix.
- **low** · informational leg · **G3-3: one dl-98 test is red on the Windows leg of this head.** See "CI at the head". Not attributable to the round by reading it, not reproduced on Linux.
- **dropped** · "the F9 closed-request test does not by itself pin the release on drop": true, and the builder's Log says so; the third test pins it (red with the release removed).
- **findings** · the hunt returned 4; 3 carried (G3-1 to G3-3), 1 dropped.

### Reverse and slow-reader repeat (the meter was reworked)

`slowreader.mts`, 1 s window: origins of 500 KB/s (slow) split at 1.1 s with the reader unthrottled, at 200 KB/s and at 100 KB/s for 3 s; the eight fast-origin cases (800 KB/s to 4 MB/s, bursty, throttled, stalled and 64 KiB-write readers) all `single`, fan-out 0. Production 5 s window, buffers full (`run-slowreader4.sh`): origin 4 MB/s against 10 MB/s of media splits at 5.1 s with the reader unthrottled and stays `single` for 30 s at 1 MB/s and 100 KB/s; origin 15 MB/s stays `single` with the reader unthrottled or at 100 KB/s. Every line equals gate 2's on the previous head.

### CI at the head `6f85fb48`

`check` x2, `e2e (direct)`, `e2e (sniffer)`, `docker`, `codeql`, `dependency-review`, `changes` and `test (ubuntu-latest)` SUCCESS. `CodeQL` FAILURE with the one alert gate 2 graded, Server-side request forgery in `tools/downloader/engine/test/parallel-ranges.test.ts` at the printed line 648, which is the call one line below `// codeql[js/request-forgery]`; the row stays **awaiting**: the first push to `main` after the merge runs `security.yml`'s dismissal step, and the reading is the alert dismissed ("Suppressed via SARIF") on main's security tab. `test (windows-latest, informational)` FAILURE, completed: `Run npm test` is the one failed step; 5068 tests passed and 1 failed (was 3 at `3b6a832d`, 21 at `53a1e7af`); the engine spec 37 of 38, the api spec 3 of 3. The failure is "'no speed-up at 4 (a per-client throttle)': the job completes on one connection, identical in media, and the next job opens one", at `expect(after.length).toBeGreaterThan(0)` (`expected 0 to be greater than 0`): the origin saw no request after the last fan-out request, so no fallback continuation happened. It took 2323 ms there; on the Windows run of `3b6a832d` it passed in 7809 ms. Whether this is the round or a flake is **unmeasured**: the round leaves that judge's arithmetic as it was for an unpaused flow (the new meter changes who is counted, not how the rate is computed), and on Linux the test passes 10 of 10 under 14 busy loops on this source and 10 of 10 on the previous one; there is one Windows run on each side. One more run of the leg would say; I did not re-run it. The 3x test and the proxy-bypass-by-cascade test pass on Windows.

- NFR: security — unchanged by the round (api spec 3 of 3 with the guard tests) · performance — G3-1, G3-2 · reliability — F9, F10 closed · maintainability — the new tests name the finding and were each shown red; the registry closes every feeder a test starts.
- Unmeasured: the cause of G3-3; a non-interleaved MP4 through real ffmpeg; the live origin.

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

**2026-10-11** — two owner answers, put by the orchestrator after gate 1.

1. **Decision 3, what makes a source's duration and size "known".** The
   options were "Build's reading: probe, else ffmpeg's own duration" (the
   builder's and the orchestrator's recommendation) and "Probe only". They were
   asked with gate 1's measurement of dl-96's shape: under the first it splits
   in 4.2 s, and under the second it stays on one connection at 14.1 s. **The
   owner chose "Build's reading: probe, else ffmpeg's own duration".** The
   duration is the probe's, or else ffmpeg's own `Duration:` line. The size is
   the variant's, or else the origin's `Content-Range`. "F4: a source the probe
   could not time, but ffmpeg can, is split (the owner's reading of Decision
   3)" pins it.
2. **CodeQL's `js/request-forgery` on `startProxy`**, the test-only forward
   proxy in `engine/test/parallel-ranges.test.ts`. The options were "Excuse it,
   with the register comment" (recommended) and "Refuse it". **The owner chose
   "Excuse it, with the register comment".** The comment sits above the
   forwarding call, under docs/adr/005, with the category as its reason. The
   call is on one line, so the suppression's one-line scope covers it. The
   `CodeQL` check stays red on the pull request until the push to `main` after
   the merge runs `security.yml`'s dismissal step, which the `awaiting` line
   above records.

**2026-10-11** — gate 1's round (FAIL at `53a1e7af`: F1 to F3 high, F4 to F6
med, F7 and F8 low). Each was reproduced on that head with the gate's own
script first. Each fix has a test, and each test was run red with the fix
reverted (`mutate-r1.py`, one revert at a time, source restored after). The
tests are in "dl-98 round 1: what gate 1 found", at the end of
`engine/test/parallel-ranges.test.ts`, and the last case of
`api/test/parallel-ranges-behind-the-proxy.test.ts`.

- **F1** (high), fixed. A status line Node will not write reached
  `writeHead` inside an unobserved `.then`. Before the fix:
  `crash.mts <tree> "HTTP/1.1 099 Odd"` died with `RangeError
[ERR_HTTP_INVALID_STATUS_CODE]`, exit 1. After it, `job rejected:
DOWNLOAD_FAILED`, the process alive, exit 0; the same for `000` and for
  `206 Par\x01tial`, which matches what the base tree gives. Three changes:
  - `#receiveOrFail` turns any throw into a failure of that fetch.
  - A status outside 200 to 599 is told to ffmpeg as `502 Bad Gateway`.
  - A reason phrase with a control character is relayed empty.

  The gate's `fuzz.mts`: all 24 answers handled. The `101` now ends at the idle
  bound (below) as `504 Connection timed out`. Tests: "F1: an origin answering
  with status 099 / 000 / a control character in the reason phrase …" and "F1:
  a 101 the client never hands back is ended by the idle bound, as a timeout".
  The first three were red with the guards reverted, and the 101 test with the
  bound removed.

- **F7** (low), fixed. The loopback compares its path as text, and its request
  handler catches anything. `badurl.mts <tree> "//["`: `ERR_INVALID_URL`, exit
  1, before; `HTTP/1.1 404 Not Found`, process alive, after. Test: "F7: a
  request target the loopback cannot parse is a 404, not a crash".
- **F2** (high), fixed in both of the parts the gate named:
  - **An idle bound.** `idleMs`, 20 s by default, is under ffmpeg's 30 s
    `-rw_timeout` on the loopback. It applies to every origin fetch while the
    feeder is reading it: no headers, or no byte, for that long is a reset.
    Time while ffmpeg is not reading does not count. Once split, the reset is
    a Decision 5 refusal and the job falls back. Before the split, it is passed
    on as a cut ffmpeg reconnects from.
  - **A newer request wins the slots.** It takes the older requests'
    lookahead, which ffmpeg is about to abandon. Slots then go round-robin,
    newest first, and a composed answer's headers are flushed at once rather
    than with the first byte.

  `starve2.mts <tree> a-open 96 4`: `NO RESPONSE … within 12000 ms` before, and
  `first byte after 4 ms (status 206)` after; `a-resumes`: 5 ms.
  `stall-engine.mts <tree> feeder faststart.mp4`: `TIMEOUT` at 153 s before;
  `ok media=identical in 22.0 s` after, at the default bound. The direct path
  takes 32.4 s on the same stall. Tests:
  - "F2: a second request is answered at once while the first, split, is not
    being read" (48 MiB body, 2 MiB chunks) was red with the arbitration
    reverted.
  - "F2: a fan-out fetch that sends its headers and then nothing falls back,
    and the job completes" (idle bound 500 ms) was red with the bound removed.

- **F3** (high), fixed. The meter now subtracts the time the origin was paused
  from the interval that held it. It no longer discards that interval, which
  every 64 KiB write paused. `winsim.mts <tree> normal 1000000 65536`: `feeder
mode=single; fan-out … 0` before; `mode=parallel; fan-out … 29` after (and
  for 131072). Tests: "F3: an origin that writes 65536 / 131072 bytes at a
  time is measured, and splits", both red with the old interruption put back.
  The fixture now takes a write size (16 KiB by default).
  - **The cost:** bytes that queued in the socket while the origin was paused
    arrive in a burst after it resumes, and count against little time. So a
    visitor reading slowly can make an origin measure fast and keep it on one
    connection. Splitting would not help a slow reader, so this errs the right
    way.
- **F4** (med), pinned per the owner's answer above. It was red with the
  duration narrowed to the probe's (`durationSec: () => mediaDurationSec`).
- **F5** (med), tested.
  - "F5: SINGLE_CONNECTION_HOSTS reaches the engine's config from the
    environment" (engine) was red with the parse removed.
  - "the API parses the variable, and the app hands the engine what it parsed"
    (`api/test/parallel-ranges-behind-the-proxy.test.ts`, through
    `loadApiConfig` and `createApp`) was red with the parse removed, and
    separately with `server.ts`'s pass-through removed.
- **F6** (med): the register comment, per the owner's answer above.
- **F8** (low), no bound added. The refused-host set holds one hostname per
  distinct host that refused. A visitor adds at most one per job they can
  start, and job starts are already rate-limited and capped per client. Any cap
  would have to evict a host before restart and give it a second try, which
  Decision 5 ("until restart") rules out. So a bound is not cheap in the sense
  asked: it changes decided behaviour.

**Windows:** expected green for the fan-out, but **not measured**. Gate 1 saw
`fanOut` 0 and `mode` `single` in every failing win32 case, the feeder-only ones
included. That is F3's signature, and F3 is reproduced and fixed on Linux. If
Windows hands the feeder larger reads than Linux does, the meter was blind
there, and it is not now. What could still be red there:

- The 3x ratio, if Windows' timer granularity (about 15.6 ms against the
  fixture's 32 ms slices) costs the split side its 15% margin.
- `-http_proxy ""` through `spawn`, which no Windows run has reached yet.

**2026-10-11** — two more owner answers, put by the orchestrator after gate 2
(CONCERNS at `3b6a832d`, no high).

1. **"How should the bound apply?"** (gate 2's F10.) The options were "Chunk
   fetches only; the relay uses ffmpeg's timeout" (gate 2's (a), recommended by
   the gate and the orchestrator) and "Keep it on the relay at 30 s or more".
   **The owner chose "Chunk fetches only; the relay uses ffmpeg's timeout".**
2. **"How should dl-98 finish?"** The options were "One more builder round,
   then a narrow gate 3" (recommended), "Lander applies F9, F10 and F11, no
   re-gate" and "Land as gated; file the rest as dl-106". **The owner chose
   "One more builder round, then a narrow gate 3".**

**2026-10-11** — gate 2's round. Each new test was run red on `3b6a832d` first,
and each fix half was reverted alone to show its test red
(`mutate-r2.py`, source restored after). The tests are in "dl-98 round 2: …" at
the end of `engine/test/parallel-ranges.test.ts`.

- **F9** (med), fixed as gate 2 stated it. The meter knows which fetches it is
  measuring, is paused only while every one of them is, and releases a fetch
  that ends, fails or whose request ffmpeg closed.
  - Gate 2's `stuckpause.mts`: `withA` and `withAkept` gave "first non-single
    at never" on `3b6a832d`. Now they give 0.1 s and 0.5 s.
  - "F9: a paused request ffmpeg closed does not keep the meter paused for the
    next one" and "F9: a paused request left open does not stop the meter for
    one that is reading" were both red on `3b6a832d` (`expected null not to be
null`: B never split). The second is red again with the all-paused rule
    reverted.
  - The release on drop needed its own case. Without it, the two tests above
    still pass, because the all-paused rule alone covers them. Without it, a
    request closed while still reading stays counted as reading, so a later
    pause is charged to the origin. "F9: a request ffmpeg closed while it was
    reading does not count a later pause as the origin's time" is red with the
    release removed: a 4 MB/s origin against 3 MB/s of media was split.
- **F10** (med), done as the owner chose. The idle bound now arms only for a
  bounded fetch: a chunk, the connection open before the split once it has a
  chunk's end, and the continuation after a fallback. A relay is left to
  ffmpeg's own 30 s, as it is without the feeder; ffmpeg going away is what
  closes it.
  - Gate 2's `delayhdr.mts <tree> feeder 25000 faststart.mp4`: `ok () in
25.8 s`, where it was `DOWNLOAD_FAILED … in 20.1 s`.
  - `idlebound.mts <tree> chunk-silent`: the silent fan-out fetch is still cut
    at 20.3 s (`onRefused 127.0.0.1 reset`), and the read continues
    `fallen-back`.
  - Tests: "F10: a relay answered later than the idle bound is not cut: its
    wait is ffmpeg's", and the 101 test, renamed "F1: a 101 on a relay is left
    to ffmpeg's own timeout, and going away closes it". Both were red on
    `3b6a832d` (`expected 504 to be 206`; `expected 'answered 504' to be 'gave
up'`), and red again with the relay bounded.
  - The round-1 stall test still passes, so the chunk-fetch bound still does
    its job.
- **F11** (low), fixed with one registry instead of a `try/finally` in each
  test. Every feeder `feederFor` starts is pushed to `liveFeeders`, which
  `afterEach` closes whatever the test's outcome. That covers every feeder test
  and any test added later, with no per-test cleanup to forget.
- **The two Windows-only failures on `3b6a832d`** (gate 2's item 4). Both now
  wait, with a bound, for the condition they asserted at one instant, and print
  the feeder's stats if it never comes.
  - "a cancel stops the relay and every ranged fetch …" waits for split with 4
    origin connections open, up to 10 s, before it cancels. **Why one instant
    could show 3:** a chunk fetched and not yet handed over holds a slot with
    no origin connection open. Measured on Linux, 400 samples 5 ms apart during
    a split: 4 open in 180, 2 in 22, 1 in 6, and 0 in 192 once the file was
    done. So any one sample can see fewer than 4 on any platform, and Windows'
    sample at 500 ms fell in a dip.
  - "F2: a second request is answered at once …" waits, up to 15 s, until the
    feeder has split, the first reader has stopped at 8 MiB, and its lookahead
    holds three chunks besides the head. That is the precondition the test is
    about, stated rather than slept for. The speed-up judge is off in this test
    (`speedupFloor: 0`). **Why Windows fell back: not measured.** The leg
    printed only `'fallen-back'`. The one refusal a healthy fixture origin can
    produce is "no speed-up", from this test's 100 ms window. If Windows'
    fallback was anything else, this change does not fix it, and the new
    message names the refusal.

**2026-10-11** — gate 3 (PASS at `6f85fb48`, narrow, run because the owner asked
for one) and the landing. Gate 3 recorded three lows unfixed, with F8 from
before: G3-1 (the meter keeps every completed chunk fetch alive), G3-2 (a
silent request that stays open makes the meter ignore another's pause) and
G3-3 (one dl-98 test red on the Windows leg). Its Windows reading was one run on
each side of the round and said one more run would settle it.

**"How should dl-98 land?"** The options were "Rerun the Windows job once, then
land" (recommended), "Land now, record it" and "Another builder round on that
test". **The owner chose "Rerun the Windows job once, then land"**, on the terms
that if it failed again dl-98 lands and the failure is filed. It failed again,
on the same test and on the F9 test too, both in run 38141287195, attempt 2
(job 114495526538). Both are filed as
[dl-106](./dl-106-two-parallel-ranges-tests-fail-on-the-windows-leg-and-pass-on-linux.md)
in this pull request with both attempts as the reproduction. The Windows
leg stays red on this merge; it is informational.

- 2026-10-12 — Its "Cover 403 and 503 too" refusal rows ("a 403", "a 503" in
  `parallel-ranges.test.ts`) were replaced by a feeder-level unit test pinning
  `REFUSAL_STATUSES` (403, 429, 503) in
  [dl-112](./dl-112-engine-and-api-tests-wait-out-timers-they-do-not-test.md),
  on the owner's answer of 2026-10-12. 429 stays as the end-to-end row.
