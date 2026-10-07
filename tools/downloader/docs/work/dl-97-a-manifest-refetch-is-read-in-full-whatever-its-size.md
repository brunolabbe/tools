---
id: dl-97
tool: downloader
title: A manifest's re-fetch is read in full, inflated, whatever its size
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-97 — A manifest's re-fetch is read in full, inflated, whatever its size

## Why

`#loadManifest` in `resolvers/src/resolvers/browser.ts` re-fetches the ranked
manifest with `context.request.get(...)` and then `response.text()`, with no
length check. Playwright 1.62.1's `APIRequestContext` has **no body-size option**
(`grep maxResponseBodySize node_modules/playwright-core/types/types.d.ts`: no
match), and `get` returns only after the whole body is received **and inflated**:
a 1 GiB gzip body timed out inside `get`, before `text()` ran. So a manifest url
that is a compression bomb is bounded only by the 8 s `budget(deadline, 8000)`
timeout, and the ranker tries at most `MAX_MANIFEST_ATTEMPTS` (2) of them, one
after the other.

dl-91 bounded the other half, `#captureBody`, which reads the same shape at
interception time. Its step 3 asked for this half to be measured before deciding
whether it needs a cap. It does, and no cheap cap exists, so on 2026-10-07 the
owner chose to file it (options were: file a follow-up, lower the timeout to
2-3 s, leave it).

**Reproduction** (dl-91's builder, 2026-10-07; re-run by its gate 1 the same
day). One `context.request.get(url, { timeout })` then `text()` against a local
server answering with `Content-Encoding: gzip` and `#EXTM3U\n` plus N MiB of
spaces, gzipped up front so the timer measures the client. The number is the Node
process's `process.resourceUsage().maxRSS` after, minus what it was before the
call. Headless Chromium from `chromium.launch`, one context.

| inflated size | wire   | timeout | result      | peak RSS delta |
| ------------- | ------ | ------- | ----------- | -------------- |
| 12 MiB        | 12 KB  | 8 s     | ok in 0.5 s | +31 MB         |
| 256 MiB       | 255 KB | 8 s     | ok in 6.4 s | +762 MB        |
| 1 GiB         | 1.0 MB | 8 s     | timed out   | +861 MB        |
| 1 GiB         | 1.0 MB | 4 s     | timed out   | +582 MB        |
| 1 GiB         | 1.0 MB | 2 s     | timed out   | +296 MB        |

The gate re-ran the 12 MiB and 256 MiB rows against the branch and got +31 MB in
0.1 s and +762 MB in 1.8 s. So the memory moved is about 100-145 MB per second of
timeout, per attempt, and the timeout is the only limit. The probe's own
`Accept-Encoding` is not the lever: `replayHeaders` already drops it, and a
hostile server compresses regardless of what it was asked for.

## Build

1. **Reproduce first.** Rebuild the table's 12 MiB, 256 MiB and 1 GiB rows with a
   throwaway script (a local server, `chromium.launch`, `context.request.get`,
   `text()`), and add them to the Log. The session scratch directory the numbers
   came from does not outlive it.
2. **Decide the shape; the rest of the work follows from it.** The only bound
   that is not the timeout is one that stops reading a body part way through, and
   `APIRequestContext` cannot. So the re-fetch has to leave it: read the manifest
   with a client that streams (Node's `fetch`/undici or `https.request`) and
   abandons the body past a cap. Pick the cap: dl-79 sized a real playlist at
   ~590 KB for a three-hour VOD with signed urls, and `MAX_CAPTURED_BODY_BYTES`
   is 4 MiB. The cap applies to the **inflated** length, so decompress as a stream
   and count what comes out.
3. **What leaving `context.request` costs, and the three things that must be
   rebuilt by hand:**
   - **Cookies.** `context.request` sends the context's session cookies, which the
     CDN demands on replay (see `resolvers/src/browser/size-probe.ts` for why
     `#loadManifest` uses it in the first place). Read them with `context.cookies(url)` and send them as the
     `Cookie` header, with the other replayed headers from `replayHeaders(hit)`.
   - **The SSRF guard.** The browser's own requests, `context.request` included,
     reach the network through the API's loopback egress proxy (dl-12; see the
     `proxyUrl` note in `resolvers/src/browser/pool.ts` and
     `api/src/egress-proxy.ts`), which is where the guard runs, on every hop.
     A client that dials the origin itself skips it, so the streaming client has
     to go **through the same proxy**, or re-run the guard on every redirect hop
     itself (CLAUDE.md: "including after each redirect"). Read how
     `egress-proxy.ts` vets an address before choosing; the `direct` resolver's
     vetted-address fetch (dl-8) is the other precedent.
   - **Redirects.** `context.request` follows them. A streaming client must follow
     them itself, with a hop limit.
   - **Proxy and TLS.** Whatever the browser context was launched with (proxy,
     `ignoreHTTPSErrors`) has to reach the new client, or a manifest that loads in
     the page fails to re-fetch. The proxy is the same item as the guard above.
4. **Keep the fallback.** A re-fetch that fails or is refused still falls back to
   `collector.bodyFor(hit.key)`, as today; a refused (over-cap) body is logged as
   a refusal, not an error. Redact the url in any log line (`redactUrl`).
5. **Do not change the timeout** unless the measurement in step 1 shows the new
   client does not need the 8 s.

## Done when

- A test serves a gzip body that inflates past the cap from a few KB and proves
  the re-fetch refuses it without holding the inflated body (peak RSS delta for
  the 256 MiB case within a few tens of MiB, both numbers in the Log), and that a
  manifest inside the cap still parses through the same path.
- A test proves a redirect from the manifest url to an address the SSRF guard
  refuses is not followed, and that the session cookie reaches the re-fetch.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

### 2026-10-07 — filed by dl-91's builder

Filed instead of fixed, by the owner's decision of the same day (see dl-91's
Log). `difficulty` is set to `hard` rather than `standard`: the shape is a client
swap whose cookie, redirect and SSRF handling each have a way to get wrong that
passes a happy-path test. The gate's reproduction (`loadmanifest.mts`) is the same
two calls as the table's, repointed at the branch.
