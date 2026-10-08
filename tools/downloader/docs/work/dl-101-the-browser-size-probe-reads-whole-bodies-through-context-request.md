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
   trusts the proxy's root by its PEM, and stops reading at a cap of inflated bytes. What it
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

### 2026-10-08 — dl-97 round 1 changed the client this reuses

- `fetchManifest` now checks an IP-literal target's certificate against the IP
  (gate 1, F3), and is exported from `@downloader/resolvers`.
- **Build step 1's "trusts the pinned root" is now wrong; read "trusts the proxy's
  root, by its PEM".** The owner chose on 2026-10-08, in dl-97's round 2:
  - the client takes the root as `proxyRootCaPem` and hands it to Node's `ca`;
  - Node verifies chain, signature, validity and host, with no
    `rejectUnauthorized: false` and no CodeQL excusal;
  - `TierEgress.rootCaPem` reaches the browser tier through `buildRegistry`.

  So this ticket's `HEAD` and ranged read inherit expiry checking too (dl-97's
  F4). The size probe must be given the same PEM, through the same resolver
  field, or it fails the handshake behind the terminating proxy exactly as
  `context.request` does today.

### 2026-10-08 — built (branch dl-101-size-probe-without-whole-bodies)

- **The size probe no longer touches `context.request`.** `fetchHeaders` is new in
  `manifest-fetch.ts`: the same hops, cookies, proxy and PEM trust as
  `fetchManifest`, but for a `HEAD` (or a `GET` whose body is never wanted) it
  answers the final 2xx's lower-cased headers and closes the response. `text()`
  is `fetchManifest` again, capped at `MAX_PLAYLIST_BYTES` (4 MiB, the same as the
  manifest). `createRequestSizeProbe` takes a `SizeRequestLike` (`headers` and
  `body`), the seam the suite stubs; `createSizeRequest` binds it to the real
  client, and `BrowserResolver.#clientOptions` is the one place the proxy, the
  jar and `proxyRootCaPem` are gathered, so the re-fetch and the probe cannot
  disagree about what they can reach.
- **Build step 1's wording was stale, as the 2026-10-08 entry above said**: it now
  reads "trusts the proxy's root by its PEM". Checked against the code first:
  `ManifestFetchOptions.proxyRootCaPem` is handed to Node's `ca`, and
  `buildRegistry` passes `TierEgress.rootCaPem` to the browser tier.
- **Step 2 is stricter than written.** It said "read at most a few bytes and
  stop"; the ranged `GET` reads none, because only its `Content-Range` is wanted.
  The test below fails (`expected true to be false`) when `fetchHeaders` is made
  to read the body to its end instead of closing it.
- **Red, then green, for the `api` Done-when.** Run against `dist` built from
  `origin/main`, the first test of `size-probe-behind-the-proxy.test.ts` fails with
  `expected 0 to be greater than or equal to 1` (the origin was never asked for
  `/media.m3u8`); after `npm run build -w @downloader/resolvers` it passes, and the
  variant carries the weighed size (4,800,000 bytes, against 6,000,000 declared).
  Its second test is the control: with the SPKI pin but no PEM, the page and the
  master load and the origin is still never asked for the playlist.
- **`tiers-behind-the-proxy.test.ts`'s "context.request is proxied too" test was
  replaced.** It pinned Playwright's request context through the proxy, which
  nothing in `src` uses any more. It now pins `fetchHeaders` and `fetchManifest`
  against the real guard (`http://internal.test/…` answers 403 for both).
- **Folded in:** the three comments that still described the probe as Playwright's
  (`size-probe.ts`, `size-sample.ts` twice) and the header comment this ticket's
  step 4 named.
- **Not folded in:** giving the browser probe an optional `bytes()` (the
  `SizeProbe` interface says only the fetch-backed probe can honour it because
  Playwright cannot stop reading). The client could now do it, but that is a
  feature (dl-64's codec read for the browser tier) with its own cap, not a piece
  of this fix.
- **Not folded in:** a ranged `GET` answered `200` with a `Content-Length` is
  still "unmeasured", as before; that length is the resource's total and could be
  used. A behaviour change nobody specified.
- `npx vitest run tools/downloader/resolvers` took 557 s for 947 tests (the browser
  suites launch Chromium); the new probe tests alone run in about 1 s.

### 2026-10-08 — gate 1 at 498ca6e failed with two highs; round 1

**Owner decision on F1, 2026-10-08.** The orchestrator put it with AskUserQuestion:
the replaced "size probe's requests are proxied too" test hands the client its
proxy itself, so it passes when `BrowserResolver` stops giving the size probe one,
and over plain HTTP nothing notices. Options: "Add a resolver-level test
(Recommended)" (drive a real `BrowserResolver` over plain HTTP through the real
guard, name the rendition on a refused host, assert the origin never sees it), or
"Rename the test only". **The owner chose "Add a resolver-level test".**

Each new or tightened test was run against the gate's mutant before commit:

- **F1** (high). `size-probe-behind-the-proxy.test.ts` › "the size probe goes
  through the egress guard over plain HTTP". With `...client, proxyUrl: undefined,`
  in both spreads of `createSizeRequest` (and `resolvers` rebuilt), it goes red:
  `expected [ { method: 'GET', …(2) }, …(6) ] to deeply equal []`, 7 requests with
  `Host: localhost`. Its control, run with the guard allowing `localhost`, sees
  `/media.m3u8` at that host. The client-level test in `tiers-behind-the-proxy`
  is renamed to what it proves ("…routes a length and a playlist through the proxy
  it is given") and says where the wiring is pinned.
- **F2** (high). The ranged-`GET` test now offers 512 MiB in 64 KiB writes and
  bounds what the origin managed to write at four caps (16 MiB), against about
  2.5 MiB when the client closes at once. With `fetchHeaders` made to read 32 MiB
  before closing it goes red: `expected 35717120 to be less than 16777216`. A
  client that read less than the bound would still pass: the bound is the cap plus
  the socket buffers, which differ by platform, and not a byte count.
- **F3** (low). The overshoot allowed is now one decoder chunk (16 KiB), as measured.
  With the decoder stopped three chunks late, all three encodings go red:
  `expected 4259840 to be less than or equal to 4210688`.
- **F4** (low). The bomb test runs for gzip, deflate and br. With the cap not
  applied to br, only br goes red: `expected '#EXTM3U\n …' to be undefined`.
- **F5** (low). The two `SizeProbe.bytes` sentences in `size-sample.ts` now say
  only that the fetch-backed probe implements it and that the browser client could
  but nothing asks for it yet.
- **F6** (low). The client's deadline error reads "The request exceeded its time
  budget." since it is no longer only the manifest re-fetch's.
