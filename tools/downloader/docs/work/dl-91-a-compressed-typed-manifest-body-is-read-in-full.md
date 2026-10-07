---
id: dl-91
tool: downloader
title: A typed manifest's compressed body is read in full, up to 400 times a probe
kind: fix
status: ready
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
  genuine inflation is well inside it (256 MiB took 1.8 s in Node). With the
  timer disabled, the new test "a read that never settles gives its slot back"
  goes red.

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
slot release fails 1; no retained total fails 1.
