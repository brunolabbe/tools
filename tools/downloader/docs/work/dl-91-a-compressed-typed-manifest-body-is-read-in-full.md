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
