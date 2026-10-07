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
   record it with its reason. A typed manifest that is not captured here is not
   lost: `#loadManifest` in `resolvers/src/resolvers/browser.ts` re-fetches it
   with the captured headers, and falls back to `bodyFor` only when that fails.
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

**Step 2, the budget: 2 compressed typed captures per probe**
(`MAX_ENCODED_CAPTURES_PER_PROBE` in `intercept.ts`), its own counter apart from
the sniff's. Reason: the captured body is only the fallback for a failed
`#loadManifest` re-fetch, which tries at most `MAX_MANIFEST_ATTEMPTS` (2)
manifests. Two covers a master and the variant it names, a third is a body
nothing is waiting on, and each costs up to a full inflation, so the bound is
that of dl-79's sniff. A url is charged once, so a polled live playlist neither
re-reads a possible bomb nor spends the budget again. Uncompressed manifests,
and `Content-Encoding: identity`, are not counted and are captured as before.
Result at N = 32 is +27 to +37 MB over N = 1 (table above), against +528 to
+554 MB.

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

**Tests**, `tools/downloader/resolvers/test/browser/sniff.test.ts`, describe "a
compressed typed manifest is read on a budget (dl-91)", appended at the end of
the file. With the budget block disabled, 3 of the 5 fail (the over-budget read,
the in-budget `bodyFor` and the repeated url); with it, `npx vitest run
tools/downloader/resolvers/test/browser/sniff.test.ts` is 54 of 54.
