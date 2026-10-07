---
id: dl-91
tool: downloader
title: A typed manifest's compressed body is read in full, up to 400 times a probe
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-91 — A typed manifest's compressed body is read in full

## Why

`#captureBody` in `resolvers/src/browser/intercept.ts` reads
`response.text()` for every response `classifyMedia` calls `hls` or `dash`. Its
only guard is `hit.contentLength > MAX_CAPTURED_BODY_BYTES` (4 MiB), and for a
compressed response `Content-Length` is the size on the wire. Chromium inflates
the body before Playwright returns it, so a few kilobytes can name gigabytes
(1 GiB fits in 1,761 bytes of `br`, and in 1,949 bytes of `gzip, gzip`, measured
by dl-79's gate 1). The count is bounded only by `MAX_HITS` (400), one per
distinct url, and a page chooses its own urls.

**Measured by dl-79's gate 1, 2026-10-06:** 32 typed `.m3u8` responses, each a
small gzip body that inflates to about 12 MiB, gave a peak of **736 MB**. The
same shape sent untyped is what dl-79's sniffing path now holds to a budget of 2
compressed reads per probe (`MAX_ENCODED_SNIFFS_PER_PROBE` in `sniff.ts`); the
typed path has no such limit. At 400 distinct urls the same arithmetic is
~4.7 GB (400 x 12 MiB), unmeasured. That is a worse exposure than the sniff had, and it predates dl-79.

dl-79's owner decision of 2026-10-06 was to **file** this, not fold it into that
branch. The reproduction is the gate's scratch directory, which does not
outlive its session, so step 1 rebuilds it.

## Build

1. **Reproduce first**: a local server that answers `N` distinct
   `.m3u8` urls with `Content-Type: application/vnd.apple.mpegurl`,
   `Content-Encoding: gzip` and a body of `#EXTM3U` followed by ~12 MiB of
   spaces (a few KB compressed), and a page that `fetch()`es them. Run it
   through the real `BrowserResolver` and record the peak RSS of the Node process
   with N = 1 and N = 32 in the Log. Expect ~736 MB at 32.
2. Bound it the way dl-79 bounded the sniff: a compressed typed manifest is read
   in `#captureBody` only within a small budget per probe. Pick the budget and
   record it with its reason. `#loadManifest` in
   `resolvers/src/resolvers/browser.ts` re-fetches a manifest with the captured
   headers, and falls back to `bodyFor` only when that fails. _[Corrected
   2026-10-07: the original sentence said a manifest not captured here "is not
   lost". It is lost exactly when the re-fetch fails, which is the only case the
   fallback exists for; see the Log, round 2.]_
3. **Check `#loadManifest` as well**, which does
   `context.request.get(...)` then `response.text()` with no length check. A
   manifest url can be a bomb too, and the ranker picks at most
   `MAX_MANIFEST_ATTEMPTS` of them, so this is bounded by that count rather than
   by 400, but not by size. Measure it before deciding whether it needs a cap.
4. Do not change what is captured for an uncompressed manifest.

## Done when

- The step-1 fixture's peak RSS at N = 32 is within a few tens of MiB of N = 1,
  and the Log has both numbers from the same machine.
- A test proves a compressed typed response past the budget is never read
  (`text()` not called), and one inside it still yields its body from `bodyFor`.
- A test proves an uncompressed typed manifest is captured as before.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: CONCERNS** — 2026-10-07 · `1aece87d..e0693933` · Opus 5.5, depth standard

| Done when                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-1 fixture's peak RSS at N = 32 within a few tens of MiB of N = 1, both numbers in the Log from one machine                         | **verified** — the gate re-ran the fixture through the real `BrowserResolver` (gzip, 12 MiB inflated, 12,267 B on the wire), six runs each: head N = 1 259–272 MB, N = 32 312–344 MB (+40 to +85 MB); base N = 32 763 and 809 MB. N = 2 gave 328 and 330 MB, so what is left at 32 is the second permitted read, not leakage. The Log has both numbers from one machine (277; 314, 304)                                       |
| A compressed typed response past the budget is never read (`text()` not called), and one inside it still yields its body from `bodyFor` | `resolvers/test/browser/sniff.test.ts` › "no more than MAX_ENCODED_CAPTURES_PER_PROBE compressed bodies are read, and the rest are still hits" (over-budget probes count 0 `text()` and 0 `body()` calls) and › "a compressed manifest inside the budget still yields its body from bodyFor" (the first two `bodyFor` results equal the manifest, the third is `undefined`) ✓. With the budget block disabled, 3 of 54 go red |
| An uncompressed typed manifest is captured as before                                                                                    | `sniff.test.ts` › "an uncompressed typed manifest is captured as before, however many there are" (10 of 10 read, every body kept) and › "an uncompressed read is not charged to the budget, and identity is not compression" ✓. If uncompressed reads are charged too, 2 of 54 go red                                                                                                                                         |
| `npm run check` and `npm test -- --project downloader` pass                                                                             | **verified** — `npm run check` exit 0; downloader project 2,068 passed and 2 skipped of 2,070 (100 files passed, 1 skipped). The diff adds tests and deletes none. Every check on PR #389 passed on `e0693933`, the e2e, docker and Windows legs included                                                                                                                                                                     |

- **med** · no `Done when` line depends on it · **open decision** · **A master lost to the budget makes the probe return an ad.** The budget is spent in arrival order and is kept until the probe ends. Two compressed manifests that arrive before the page's compressed master use it up. If the master's replay then fails, `#loadManifest` gets `undefined` from `bodyFor`, moves on to the next ranked manifest and parses that one instead. Reproduction (`ads-first.mts`, real resolver and real parsers): two gzip `.m3u8` playlists on `localhost:<port>/creative/`, then a gzip `/v/master.m3u8` on the page's origin that answers 200 once and 403 on the replay. Base returns `["1080p …/v/1080p.m3u8","720p …/v/720p.m3u8"]`. Head returns `["0:12 http://localhost:<port>/creative/a0.m3u8"]`, the ad. With 0 or 1 ad, or with a replayable master, head returns the master's renditions. Polls whose query string changes are charged once each, so `live?t=1, live?t=2, master` also leaves the master with no body (seen on the real `HitCollector`). So the brief's sentence "a typed manifest that is not captured here is not lost" is false when the replay fails, which is the only case the fallback exists for. Three texts that rely on it are also wrong: the `MAX_ENCODED_CAPTURES_PER_PROBE` doc comment ("two covers a master and the variant it names, and a third is a body nothing is waiting on"), the comment in the first dl-91 test, and the Log. Options: **(a, recommended)** charge the budget only for reads whose inflated text exceeds `MAX_CAPTURED_BODY_BYTES`, and cap reads in flight at two by queuing the rest instead of dropping them. Ordinary small manifests then never use up the budget, and peak memory is still at most two inflations. A page that sends bombs only loses its own fallback. This is one builder round, and the tests need one case that queues and one that refunds. **(b)** Keep arrival order. State the loss in the brief, the doc comment and the test, and add a test that pins it. **(c)** Raise the budget, for example to 4. This makes the loss less likely but doubles the worst case. dl-79's `MAX_ENCODED_SNIFFS_PER_PROBE` has the same arrival-order shape, and there a dropped untyped master is not even recorded as a hit. That code is on `main` already, so this branch did not cause it, but option (a) applies to it too.
- **open decision** · no `Done when` line depends on it · **Build step 3 is not built, as the brief allows.** The brief says to measure `#loadManifest` "before deciding whether it needs a cap". The Log measures it and leaves the decision open, and `browser.ts` is untouched. The gate re-ran the builder's `loadmanifest.mts`, repointed at this worktree, and got the same costs: 12 MiB gzip +31 MB in 0.1 s, 256 MiB gzip +762 MB in 1.8 s. So one re-fetch is limited only by its 8 s timeout, and this ticket's count budget does not limit a single large bomb. Options: **(a, recommended)** file a follow-up `dl-` ticket for a size bound on the re-fetch, with these numbers as its reproduction. `APIRequestContext` has no body-size option, so it is a design choice, not a one-liner. **(b)** Fold it into this branch, which widens it past its Done-when lines.
- **low** · the Log reports the N = 32 vs N = 1 gap as "+27 to +37 MB", and its "after" N = 1 is a single run. Over six runs each, the gate measured +40 to +85 MB. Both are within the line, but the Log's range is narrower than what reproduces.
- **low** · a compressed url is charged when its read is scheduled, so a first read that throws (body discarded) is never retried on a later poll. A polled compressed playlist now keeps its first poll's body (seen: `poll 1` kept after three polls), where base kept the latest. That body only feeds the parser's fallback, so no live call site needs a fresh one.
- **dropped** · `Content-Encoding: gzip, identity` (and `identity, gzip`) is charged as compressed, but Chromium did not inflate it (the parser saw 12,266 characters). Charging it is the cautious side and costs only the sender's own slot. Not a defect.
- **dropped** · an uncompressed typed manifest with no `Content-Length` is read in full before the 4 MiB check. This predates the branch, step 4 forbids changing uncompressed capture, and nothing is amplified, because the bytes read are the bytes sent. Out of scope.
- **dropped** · could an over-budget response be read on another path? No. The only reads of an intercepted `Response` are `#sniffBody`'s `body()` and `#captureBody`'s `text()`. A typed response returns before `#sniffBody`, and `bodyFor`'s only caller reads stored strings. Not a defect.
- **findings** · the hunt returned 7; 4 carried (1 med, 1 open decision, 2 low), 3 dropped.
- Encodings run at N = 32 through the real resolver: gzip, br, deflate, `GZIP`, `  Gzip  ` all held peak at 327–343 MB with 33 requests served. `gzip, identity` and `identity, gzip` were not inflated (207–209 MB). A 64 MiB bomb gave N = 1 435 MB and N = 32 442 MB.
- Invariants: no cross-tool import, no new error path, no shell, no new log line, URLs and SSRF untouched, contract untouched, the tests sit in an existing registered spec. Style is clean. Skipped as not touched: Dockerfile, routes, progress.
- NFR: security, the bound holds for every encoding tried, and the re-fetch is the open decision above · performance n/a · reliability, the med above · maintainability, the doc comment and the test comment state the false premise (part of the med).

## Log

### 2026-10-07 — built (builder, Sonnet 5.5)

**Step 1, the baseline, before any bounding.** A local server answers `N`
distinct `/m/<i>.m3u8` urls with `application/vnd.apple.mpegurl`,
`Content-Encoding: gzip` and `#EXTM3U\n` plus 12 MiB of spaces (12,267 bytes on
the wire at level 9). A page `fetch()`es and reads each. The probe runs through
the real `BrowserResolver` (stub HLS parser), headless Chromium, and the number
is the Node process's `process.resourceUsage().maxRSS`, so Chromium's own memory
is not in it. The script was in the session scratch directory, which does not
outlive it; the shape above is enough to rebuild it.

| state                  | N = 1          | N = 32 (two runs) |
| ---------------------- | -------------- | ----------------- |
| before (`origin/main`) | 269 MB, 270 MB | 823 MB, 797 MB    |
| after                  | 277 MB         | 314 MB, 304 MB    |

The brief's 736 MB at 32 was measured on another machine; here 797-823. Both
runs served 33 requests (32 from the page, one `#loadManifest` re-fetch) and the
parser saw one 12,582,920-character body. A single bomb is also not
bounded by being alone: N = 1 at 64 MiB gave 431 MB and at 256 MiB gave 950 MB
(before), because the one read is the whole inflated body.

**Step 2, the budget: 2 compressed typed captures per probe, arrival order**
(`MAX_ENCODED_CAPTURES_PER_PROBE`, a count of reads, charged for each url once).
_Superseded the same day, see round 2 below: the count of reads was the wrong
unit and the premise it rested on was false._ It read: the captured body is only
the fallback for a failed `#loadManifest` re-fetch, which tries at most
`MAX_MANIFEST_ATTEMPTS` (2) manifests; two covers a master and the variant it
names, and a third is a body nothing is waiting on. Result at N = 32 was +27 to
+37 MB over N = 1 (table above), against +528 to +554 MB.

**Wrong, and corrected in round 2:** "a typed manifest that is not captured here
is not lost" (the brief's step 2, and this paragraph's reasoning) is false in
exactly the case the fallback exists for. A manifest whose body was never read
has nothing in `bodyFor`, so when its re-fetch fails `#loadManifest` moves on to
the next ranked manifest and the probe returns that one, which may be an ad.

**Step 3, `#loadManifest`: it needs a cap, and Playwright 1.62.1 offers none, so
it is not capped here.** `context.request.get` returns only after the whole body
is received _and inflated_ (the 1 GiB case timed out inside `get`, before
`text()`), and `APIRequestContext` has no maximum-body option (`grep
maxResponseBodySize` over `types.d.ts`: no match). One `get` + `text()` of a
gzip body, process peak RSS minus what the script held before the call, 8 s
timeout (what `#loadManifest` passes through `budget(deadline, 8000)`):

| inflated size | wire   | result           | delta over before |
| ------------- | ------ | ---------------- | ----------------- |
| 12 MiB        | 12 KB  | ok in 0.5 s      | +31 MB            |
| 256 MiB       | 255 KB | ok in 6.4 s      | +762 MB           |
| 1 GiB         | 1.0 MB | timed out at 8 s | +861 MB           |
| 1 GiB, 4 s    |        | timed out        | +582 MB           |
| 1 GiB, 2 s    |        | timed out        | +296 MB           |

So the only bound today is the timeout, at roughly 100-145 MB per second, per
attempt, and the attempts are sequential (at most 2). `replayHeaders` already
drops `accept-encoding`, and asking for `identity` would not help against the
server this is about. Left as an open decision for the orchestrator (options in
the report); the code in `browser.ts` is untouched.

**Fold-in.** Nothing else was made free by this change. The `#loadManifest`
bound is the one piece that looked adjacent, and it is not small or specified.

**Tests** (round 1), `tools/downloader/resolvers/test/browser/sniff.test.ts`,
describe "a compressed typed manifest is read on a budget (dl-91)", appended at
the end of the file. With the budget block disabled, 3 of the 5 fail; with it,
`npx vitest run tools/downloader/resolvers/test/browser/sniff.test.ts` was 54 of 54. Replaced in round 2.

### 2026-10-07 — round 2, after gate 1 (CONCERNS at e0693933)

**Owner decisions, 2026-10-07**, both put as questions with options:

1. Remedy for the gate's med (two compressed ad manifests spend the budget before
   the master; when the master's replay fails the probe returns the ad, where
   base returned the master). Options: (a) charge the budget only for reads whose
   inflated text exceeds 4 MiB, and queue reads beyond two in flight instead of
   dropping them (the gate's recommendation); (b) raise the budget to 4; (c)
   accept the arrival-order loss and document it. **Chosen: (a).**
2. Build step 3, a size cap on `#loadManifest`'s re-fetch. Options: (1) file a
   follow-up (the builder's and the gate's recommendation); (2) lower the
   re-fetch timeout to 2-3 s; (3) leave it. **Chosen: (1)**, filed in this branch
   as [dl-97](./dl-97-a-manifest-refetch-is-read-in-full-whatever-its-size.md),
   `difficulty: hard`, with the measured table as its reproduction.

_Superseded in round 3 below. Gate 2 showed the premise behind the choice of (a)
as worded, "peak memory is still at most two inflations", false: a body under
4 MiB is never charged, so every one is read, and the garbage builds up faster
than it is collected. The oversize count, the 8 MiB retained total and the
"exactly 2" claim under "What changed" are replaced; the in-flight limit, the
queue and the latest-body-per-poll behaviour stay._

**What changed** (`resolvers/src/browser/intercept.ts`). Compressed typed bodies
are read under three limits, none of which an ordinary manifest can spend:

- **In flight:** at most `MAX_ENCODED_READS_IN_FLIGHT` (2) at once; the rest wait
  in a queue, they are not dropped.
- **Oversize budget:** `MAX_OVERSIZE_ENCODED_READS_PER_PROBE` (2), charged only
  when a read comes back past 4 MiB inflated. Once spent, no further read starts
  and queued ones are answered with nothing. Reads in flight are held to what is
  left of it, so the total is exactly 2, not 3 (an intermediate cut let a third
  through while two might still be bombs).
- **Per-url dedupe is gone.** A polled compressed playlist is read again and keeps
  its latest body, as an uncompressed one does; this is the gate's second low,
  which had base keeping the latest and head the first.

**Two additions the decision did not name, and why.** Both are bounded by a
reproduction:

- **`MAX_ENCODED_RETAINED_BYTES` (8 MiB, twice `MAX_CAPTURED_BODY_BYTES`)**:
  option (a) refunds every read under 4 MiB, so a page's urls each inflating to
  just under it would be kept in full. N = 400 distinct urls of 3 MiB, 12 s
  probe: **649 MB** peak RSS with no total, **506 and 531 MB** with it (the
  process was at about 178 MB before the probe). Reads past the total are still made and still hits;
  only the body is not retained. Eight MiB is what the budget it replaced could
  keep (two bodies of 4 MiB).
- **`ENCODED_SLOT_HOLD_MS` (1500)**: `response.text()` never settles for a body a
  page abandoned (`settle`'s own comment), so two such reads would hold both
  slots for ever and starve the master behind them. A slot is released after 1.5 s
  whether or not the read settled; a read that is merely slow still completes. A
  genuine inflation is well inside it (_wrong as cited: 256 MiB took 1.8 s, which
  is longer than 1.5 s; corrected in round 3_). With the timer disabled, the new
  test "a read that never settles gives its slot back" goes red.

**Premise corrected.** "A typed manifest that is not captured here is not lost"
was false (see the correction above): the constant's doc comment, the first
version of the test comment and the brief's step 2 said it, and now state that a
manifest never read is lost to the fallback and why the limits are shaped to
cost an ordinary manifest nothing.

**The gate's reproduction, `ads-first.mts`** (two gzip ad manifests on another
origin, then a gzip master whose replay returns 403), run at the new head: with 0,
2 and 5 ads the probe returns `1080p`/`720p` of `/v/`, the master, never the ad.
At e0693933 the gate got the ad with 2 ads.

**Memory, `bombs.mts` (12 MiB gzip, 12,267 B on the wire).** The first round's
"+27 to +37 MB" was two runs and understated the spread. Peak RSS of the Node
process, same machine, same session, interleaved:

| state              | N = 1 (6 runs) | N = 32                            |
| ------------------ | -------------- | --------------------------------- |
| e0693933 (round 1) |                | 312-330 MB (5 runs)               |
| round 2            | 258-270 MB     | 315-384 MB (14 runs; median ~340) |

So N = 32 sits +45 to +126 MB over N = 1 across runs, against +528 to +554 MB
unbounded; the gate saw +40 to +85 MB at round 1. The remainder is the second
permitted read and GC timing, not growth: N = 2 gave 328 and 330 MB in the gate's
runs.

**Fold-in.** The `sniff.ts` budget (`MAX_ENCODED_SNIFFS_PER_PROBE`) has the same
arrival-order shape and a dropped untyped master there is not even a hit; the
gate says option (a) applies to it. It is on `main`, in a different path with a
different cost (the sniff reads untyped bodies up to 1 MiB, with no re-fetch to
recover), and the owner's decision named only this branch's budget, so it is not
folded in.

**Tests** (round 2), same file, describe "a compressed typed manifest is read
under three limits (dl-91)", ten tests. The first version's five are replaced; a
shared `reads` helper and a `concurrency` tracker on the file's `response()`
helper are added. Mutation-checked, each against `intercept.ts`: counting every
read as the budget (the old shape) fails 7 of 10; no in-flight limit fails 3; no
slot release fails 1; no retained total fails 1. Replaced in part in round 3.

### 2026-10-07 — round 3, after gate 2 (CONCERNS at dad7a1d3)

**Gate 2's med.** Bodies inflating to just under 4 MiB are never charged by the
oversize count, so with 3 MiB bodies (about 3 KB on the wire) peak RSS was 412 and
418 MB at N = 32 and 523 and 549 MB at N = 100, against ~222 MB for round 1 and
464 and 895 MB for base. The builder's own round-2 run agrees: `bombs.mts 32 3`
at the round-2 head gave 416 and 420 MB, with the retained cap in place.

**Owner decision, 2026-10-07**, put as a question with options. Remedy for that
med: (a) replace the oversize count and the 8 MiB retained cap with one per-probe
budget on total inflated bytes, charged as each read returns (the gate's
recommendation); (b) lower the oversize line to ~1 MiB; (c) accept, correct the
comments and file a follow-up; (d) revert to round 1's charge-every-read plus the
queue. **Chosen: (a)**, the figure left to the builder to choose by measurement,
the queue, the in-flight limit and the latest-body-per-poll behaviour kept unless
the measurement said otherwise (it did not).

**What changed.** `MAX_ENCODED_INFLATED_BYTES_PER_PROBE` replaces
`MAX_OVERSIZE_ENCODED_READS_PER_PROBE` and `MAX_ENCODED_RETAINED_BYTES`. Every
compressed typed read is charged its inflated length when it returns; once the
total reaches the budget no further compressed read starts, and queued ones are
answered with nothing. The in-flight limit (2), the queue and the slot hold
(1500 ms) stay, and a polled playlist still keeps its latest body.

**The figure: 8 MiB, chosen by measurement.** Peak RSS of the Node process,
`bombs.mts`, three runs each, same machine, MB. The budget is the only thing
changed between rows:

| budget | 3 MiB bodies, N = 32 | 3 MiB bodies, N = 100 | 12 MiB bodies, N = 32 |
| ------ | -------------------- | --------------------- | --------------------- |
| 8 MiB  | 251, 236, 239        | 238, 239, 239         | 330, 347, 328         |
| 16 MiB | 271, 258, 259        | 265, 269, 267         | 369, 398, 385         |
| 32 MiB | 321, 310, 319        | 320, 324, 323         | 386, 426, 399         |

Memory follows the budget, so the smallest that still covers ordinary use is
the choice. A real playlist is far under it (dl-79 sized a three-hour signed one
at ~590 KB, so 8 MiB covers about a dozen), and the 12 MiB column shows why 16 is
worse than it looks: with a budget above one bomb's size a third read starts
after the first returns. A retained total is no longer needed: every kept body
was charged, so what is kept is bounded by the budget plus the reads in flight
when it is spent.

**Final numbers at the figure chosen**, `bombs.mts`, six runs each, peak RSS in
MB (every run served N + 1 requests):

| bodies | N = 1                        | N = 32                       | N = 100                      |
| ------ | ---------------------------- | ---------------------------- | ---------------------------- |
| 3 MiB  | 226, 212, 214, 215, 214, 214 | 239, 240, 240, 240, 238, 239 | 242, 238, 242, 239, 241, 239 |
| 12 MiB | 273, 262, 258, 258, 271, 260 | 327, 331, 350, 336, 327, 329 | not run                      |

At 3 MiB the process is within 30 MB of one body at N = 100, where round 2 was
523-549 and base 895. At 12 MiB N = 32 is +54 to +92 MB over N = 1 across runs
(round 2: 258-270 against 315-384), so that figure is now in line with round 1.

`ads-first.mts` (two gzip ads on another origin, then a gzip master whose replay
returns 403), at the final head, 0, 2 and 5 ads: the probe returns the master's
`1080p` and `720p` under `/v/` every time.

**Gate 2's lows.**

- **The slot hold (fixed).** With the hold, a read slower than
  `ENCODED_SLOT_HOLD_MS` stops counting and a slow one can overlap with later
  ones: `hold.mts 10 4000 12` started six at once. The comments claiming "exactly
  this many" and "peak memory is that many inflations" are gone, and the constant
  now says the budget is the bound and the in-flight number is how many start
  together. The "256 MiB took 1.8 s" citation was longer than the hold it was
  cited for and is replaced by the 12 MiB figure (0.1 s). Gate 2 saw no memory
  cost in real Chromium (it answered late reads with "evicted from inspector
  cache"); a bound that counted released reads would bring back starvation by
  abandoned reads, so none is added.
- **The retained cap (superseded, not moot in effect).** The cap is gone. The
  case the gate named, a page's own two near-4 MiB bodies kept ahead of a small
  master, has the same shape under the new budget: two bodies of 4 MiB or more
  spend 8 MiB and a master queued behind them is not read. It is the choice made
  in (a), a page attacking its own playback, and a unit test states it ("a page
  that sends bodies past the budget loses its own fallback").
- **dl-97's two defects (fixed).** Its "Proxy and TLS" bullet now names the pinned
  egress root (`--ignore-certificate-errors-spki-list`, fed by
  `proxyRootSpkiSha256`) and not `ignoreHTTPSErrors`, which nothing here sets; and
  "three things" now reads "four things".

**Tests.** Describe renamed "a compressed typed manifest is read within a budget
of inflated bytes (dl-91)", ten tests: the two oversize-count tests and the
retained-cap test are replaced by three (bodies just under 4 MiB are charged;
a body inside the budget does not cost the next manifest its body; a page that
sends bodies past the budget loses its own fallback). Mutation-checked: charging
only bodies past 4 MiB (the round-2 shape) fails the 3 MiB test; charging nothing
fails it and the past-budget test. `npx vitest run
tools/downloader/resolvers/test/browser/sniff.test.ts` is 59 of 59.
