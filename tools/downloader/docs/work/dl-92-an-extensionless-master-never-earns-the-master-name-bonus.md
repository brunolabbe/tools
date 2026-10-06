---
id: dl-92
tool: downloader
title: A master playlist with no file extension never earns the master-name bonus, so a variant named index.m3u8 outranks it
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-92 — An extensionless master never earns `MASTER_NAME`'s bonus

## Why

`MASTER_NAME` in `resolvers/src/browser/rank.ts` is
`/(?:master|main|index|manifest|playlist|stream|video)[^/]*\.(?:m3u8?|mpd)$/i`.
It needs a file extension, so a master served from `/api/playlist?id=1` or
`/hls?token=...` (typed `application/vnd.apple.mpegurl`, or sniffed since dl-79)
can never earn its +120. A variant whose name happens to match, such as
`/v/high/index.m3u8`, then outranks it even though it was requested after it.

**Measured, 2026-10-06** (dl-79's gate 1 reported `n=1`; re-run against the
built `rank.js`, both hits `hls`, confirmed, status 200, same origin as the page):

```
https://site.example/api/playlist?id=1  seq=0 score=1150
https://site.example/v/high/index.m3u8  seq=1 score=1260
winner=https://site.example/v/high/index.m3u8
https://site.example/api/master.m3u8    seq=0 score=1270   (the same master, with an extension)
```

The winner is a single rendition where the master would have offered every one
(`n=1` against `n=2` in the gate's run). Pre-existing, and independent of
dl-79: it applies to any typed extensionless master.

## Build

1. **Reproduce first**, through the real `BrowserResolver`: a page that fetches
   an extensionless master (served `application/vnd.apple.mpegurl`, two
   `#EXT-X-STREAM-INF`s), then a variant named `index.m3u8`. Expect the master's
   variants, observe one. A unit test over `rankHits` alone is not enough: the
   outcome the user sees is `variants.length`.
2. Decide what identifies a master when the name cannot: the strongest signal is
   the body (`#EXT-X-STREAM-INF` for HLS, which `#loadManifest` already has by
   the time the choice is made), but `rankHits` runs before any body is read. The
   alternatives are to let the extension-less path earn the name bonus on its
   own words (`/playlist`, `/master`, `/manifest`), or to prefer the earlier
   request among hls hits of equal kind, which is what the `seq` term already
   tries to say. Pick one and say why in the Log; do not widen
   `VARIANT_NAME`'s penalty to compensate.
3. Keep every existing `rankHits` expectation in
   `test/browser/capture-rules.test.ts`.

## Done when

- The step-1 fixture yields the master's variants.
- A test proves an extensionless master outranks a later variant named
  `index.m3u8`, and that a typed variant named `master.m3u8` listed first still
  wins as before.
- `npm run check` and `npm test -- --project downloader` pass.

## Log
