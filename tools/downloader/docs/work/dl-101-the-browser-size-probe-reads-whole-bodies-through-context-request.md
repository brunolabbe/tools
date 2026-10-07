---
id: dl-101
tool: downloader
title: The browser tier's size probe reads whole bodies through `context.request`, and cannot reach an origin behind the terminating proxy
kind: fix
status: ready
milestone: null
depends_on: [dl-97]
difficulty: standard
---

# dl-101 — The browser tier's size probe reads whole bodies through `context.request`

## Why

`createRequestSizeProbe` in `resolvers/src/browser/size-probe.ts` weighs a
rendition (dl-30) with Playwright's `context.request`: a `HEAD`, a one-byte
ranged `GET`, and a `GET` plus `text()` of a media playlist. That is the same
call dl-97 took out of `#loadManifest`, and it has both of the defects dl-97
found there.

1. **The body is read in full and inflated before anything can look at it.**
   `text()` of a gzip media playlist is bounded only by its 8 s budget
   (`TEXT_BUDGET_MS`), and a server that ignores `Range` answers the "one-byte"
   `GET` with the whole resource, bounded only by its 4 s budget. dl-97's table
   is this call: one `context.request.get` and `text()` of `#EXTM3U` plus 256 MiB
   of gzipped spaces (255 KB on the wire) took the Node process up 771, 763 and
   772 MB in three runs, and 1 GiB timed out at 8 s holding +1,023 MB.
2. **Behind the proxy that terminates the tiers' TLS, it never reaches the
   origin.** `context.request` verifies with Node's own store; the pool trusts
   the proxy's generated root only in Chromium, by SPKI pin (dl-37), so every
   HTTPS size probe fails its handshake and the variant keeps its declared size.
   That proxy is the default (`FFMPEG_TLS_INTERCEPT` on), so since dl-37 the
   browser tier has measured nothing over HTTPS in a default deployment.

**Reproduction** (dl-97's builder, 2026-10-07), from
`api/test/manifest-refetch.test.ts` with a temporary assertion printing what the
origin was asked for. The re-fetched master names `refetched.m3u8`, a media
playlist the size probe reads with `text()`:

- plain HTTP through the egress proxy: `/page.html`, `/master.m3u8`,
  `/master.m3u8`, `/refetched.m3u8` — the size probe arrived;
- HTTPS through the terminating proxy, pin set: `/watch`, `/master.m3u8`,
  `/master.m3u8` — the re-fetch arrived (dl-97), the size probe did not.

## Build

1. **Reuse dl-97's client**, `resolvers/src/browser/manifest-fetch.ts`, rather
   than writing a second one. It already routes every hop through the egress
   proxy, follows redirects with a limit, reads the context's cookies per hop,
   trusts the pinned root, and stops reading at a cap of inflated bytes. What it
   lacks for this file is a method (`HEAD`) and a way to send `Range` and read
   `content-range`/`content-length` off a response without reading its body.
2. **Cap the ranged `GET`'s body**, not just `text()`'s: a server that ignores
   `Range` sends the whole segment, so read at most a few bytes and stop.
3. Keep `createRequestSizeProbe`'s contract: `undefined` on every failure, a
   sample is never a precondition. `ApiRequestLike` exists so the suite drives it
   with a stub; keep a seam of that shape.
4. Correct the header comment of `size-probe.ts`, which dl-97 left pointing here.

## Done when

- A test serves a gzip media playlist that inflates past the cap and proves the
  size probe's `text()` refuses it without inflating more than a chunk past it.
- A test proves a ranged `GET` answered `200` with a large body reads no more
  than the cap.
- A test in `api` proves the size probe reaches an HTTPS origin behind the
  terminating proxy (the origin is asked for the media playlist).
- `npm run check` and `npm test -- --project downloader` pass.

## Log

### 2026-10-07 — filed by dl-97's builder

Filed rather than folded in: the fix needs the client to grow a `HEAD`, a
ranged read and a body-less answer, and a test of its own in `api`, which is not
the small, already-specified work the fold-in exception covers.
