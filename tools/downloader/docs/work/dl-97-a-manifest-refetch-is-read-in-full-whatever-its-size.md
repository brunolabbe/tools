---
id: dl-97
tool: downloader
title: A manifest's re-fetch is read in full, inflated, whatever its size
kind: fix
status: done
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
3. **What leaving `context.request` costs, and the four things that must be
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
   - **Proxy and TLS trust.** The proxy is the same item as the guard above. The
     egress proxy can terminate TLS and mint leaves from its own root, and the
     pool trusts that root by SPKI pin: the `--ignore-certificate-errors-spki-list`
     launch flag, fed by `BrowserPoolOptions.proxyRootSpkiSha256` (dl-37; its
     comment in `pool.ts` says why this and not `ignoreHTTPSErrors`, which nothing
     here sets). A client of our own has to trust that same root, or a manifest
     that loads in the page fails to re-fetch. A launch flag is a Chromium
     setting, so step 1 should also check how `context.request` is trusting the
     proxy today before deciding what to copy.
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

## Review

**Gate: CONCERNS** — 2026-10-08 · `9dcf0f6..f37a257` · Sonnet 5.5, depth full

Base `9dcf0f6f`, head `f37a2571bc9c9b7cfe05d340fc09e9cb81c820eb`, draft PR #395. CI read on that head: every check passes
(`check` x2, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `e2e (direct)`, `e2e (sniffer)`, `docker`,
`codeql` job, `dependency-review`, `changes`) except the code-scanning check `CodeQL`, which fails (F1). Preflight was not
run by this gate (the dispatch scoped its exit 16 out).

| Done when                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gzip body that inflates past the cap from a few KB is refused without holding the inflated body | `resolvers/test/browser/manifest-fetch.test.ts` › "refuses a gzip body that inflates past the cap, having inflated no more than a chunk past it" ✓ (64 MiB from under 100 KB; asserts `readBytes` is above the cap and at most cap + 64 KiB). Also `api/test/manifest-refetch.test.ts` › "refuses a body that inflates past the cap, logs it as a refusal and falls back" ✓ (256 MiB from ~255 KB, real resolver)                       |
| …peak RSS delta for the 256 MiB case within a few tens of MiB, both numbers in the Log            | **verified** — no test asserts RSS; the Log carries both numbers (about +763..+772 MB through `context.request`, +4..+5 MB through `fetchManifest`) and I re-ran them in fresh processes: same 260,949-byte body, `fetchManifest` → `too-large`, `readBytes` 4,210,688 (cap + one 16 KiB chunk), 154 ms, **+15 MiB** (module load included); Playwright `request.newContext().get().text()` → 268,435,464 chars, 2,498 ms, **+871 MiB** |
| …and a manifest inside the cap still parses through the same path                                 | `api/test/manifest-refetch.test.ts` › "parses a compressed manifest inside the cap through the same path" ✓ (the probe's variants name the re-fetched playlist, and the warning list is empty); `manifest-fetch.test.ts` › "reads a %s body inside the cap" ✓ (gzip, deflate, br)                                                                                                                                                       |
| A redirect from the manifest url to an address the SSRF guard refuses is not followed             | `api/test/manifest-refetch.test.ts` › "a redirect to an address the guard refuses is not followed" ✓ — real `BrowserResolver`, real egress proxy and guard; the assertion that carries it is `secret.requests` equal to `[]` beside "the re-fetch happened" (`masterRequests() - before` is 2). Positive control: sending hops after the first straight to the origin turns 4 of 22 red, this test among them                           |
| …and the session cookie reaches the re-fetch                                                      | `api/test/manifest-refetch.test.ts` › "the session cookie reaches the re-fetch, on a hop it was redirected to as well" ✓ (asserts both the first hop's and the redirected hop's cookie). Positive control: never asking the jar on later hops turns this test and the unit "sends the replayed cookie on the first hop and asks the jar for every later one" red (2 of 22)                                                              |
| `npm run check` and `npm test -- --project downloader` pass                                       | **verified** — `npm run check` exit 0; `npm test -- --project downloader` exit 0, 102 of 103 files passed (1 skipped), 2151 of 2153 tests passed (2 skipped). CI `check` and `test (ubuntu-latest)` green on this head. Base suite not run (unmeasured); the new specs add 15 + 7 = 22 tests, and the only edit to an existing test is a title and comment in `api/test/tiers-behind-the-proxy.test.ts`, no assertion touched           |

Not a Done-when line, but the Log's headline claim: "HTTPS re-fetches behind the default terminating proxy failed since dl-37
and now succeed" is **verified in both halves**. With `browser.ts` put back to the base and `resolvers` rebuilt, the branch's
`api/test/manifest-refetch.test.ts` › "trusts the proxy's root by its pin, so the re-fetch is answered" fails with `expected [ { method: 'GET', …(2) } ] to
have a length of 2 but got 1`; at head it passes (7 of 7). Second method: the real `createTlsInterception` leaf for `localhost` and for
`127.0.0.1`, served over `node:https`: Node's default trust gives `SELF_SIGNED_CERT_IN_CHAIN`, `fetchManifest` with the root's pin returns
`ok`, without the pin `refused: untrusted-certificate`. End to end through Chromium over plain HTTP with no proxy the re-fetch carried the page's
User-Agent, Accept-Language, Referer, `Sec-Fetch-Mode` and the session cookie, and its playlist was the one parsed.

- **med** · no `Done when` line depends on it · **F1, the `CodeQL` check is red on this head and nothing excuses it.** One new
  alert, "Disabling certificate validation" (`js/disabling-certificate-validation`, High) on `rejectUnauthorized: false` in
  `startTls` in `resolvers/src/browser/manifest-fetch.ts`. The file carries no `// codeql[…]` comment and the ticket's Log records no
  excusal, so under adr/005 and the lg-5 precedent the row is a red check nobody excused; this gate does not grant one. The
  verification is redone by hand and the matrix below shows it holds, so this reads as a false positive in effect, but adr/005 rule 3
  asks for the test that goes red if the design regresses, and F2 is exactly the part of the design that has none. Read from the check
  run's page with WebFetch; `gh pr checks` gives only "fail".
- **med** · no `Done when` line depends on it · **F2, the signer-binding and host-name halves of `signedByPin` are unproven, and the
  Log's reason for not testing them is wrong.** The code is right as run (matrix below); nothing on the branch would notice if it
  were not. Mutations, each rebuilt into `dist`, both new specs run (22 tests): _any chain accepted once a pin is set_ → 21 of 22,
  red on "and refuses a leaf that a key other than the pinned one signed" (`expected 1 to be +0`), the planted positive control;
  _every chain accepted_ → red on the same test. But dropping `leaf.verify(candidate.publicKey)` (the signature), replacing the
  `checkIssued && verify` pair with `return true` (the cert carrying the pinned key merely sits in the chain), and dropping
  `tls.checkServerIdentity` from the pin rule each leave **22 of 22 green**. Under the first of those, the harness accepts a leaf
  signed by an attacker key whose issuer name and AKID are copied from the root, sent beside the real root certificate; at head it is
  refused. The Log says "`resolvers` has no way to mint a certificate… and in `api` the only leaves on offer are the proxy's own";
  `node-forge` is `api`'s runtime dependency and `api/test/helpers/tls-origin.ts` already mints with it, and a 40-line forge script
  produced the attacker CA and leaf. The existing test's title ("a leaf that a key other than the pinned one signed") describes
  what these mutations break while its body varies the pin and leaves the chain without the pinned key, which is why I considered a
  `high` ("a test that passes when the thing it claims to prove is broken") and graded `med`: the body and comment say what they
  prove, the Log discloses the gap, and the code is correct. Regrade if the title is read as the claim. Remedy: in `api/test/manifest-refetch.test.ts`
  add an origin whose chain is [leaf signed by a forge-minted key under the root's subject name, `intercept.rootCaPem`] and one whose
  leaf names another host but is signed by the real root, assert the origin sees no request; the three surviving mutations must go
  red. Rename the existing test to say it refuses a pin the chain does not carry.
- **med** · no `Done when` line depends on it · **F3, an IP-literal HTTPS target is verified against `localhost`, not against the IP.**
  `startTls` passes `servername` only for DNS names and no `host`, and with a wrapped `socket` Node checks identity against
  `servername || host || socket._host || "localhost"`; `_host` is unset for a literal-IP `net.connect` and is the proxy's address for a
  CONNECT tunnel. Reproduction: a server on `127.0.0.1` with a leaf signed by a CA handed to Node through `NODE_EXTRA_CA_CERTS`.
  (a) Leaf naming only `localhost`: `fetchManifest("https://127.0.0.1:PORT/m")` → `ok`; plain `https.get` to the same URL →
  `ERR_TLS_CERT_ALTNAME_INVALID`. (b) Leaf with an IP SAN `127.0.0.1`: `fetchManifest` → `refused: untrusted-certificate`, direct and
  through a tunnelling proxy; plain `https.get` → 200; `tls.connect({ socket, host })` → `authorized: true`. So (a) accepts any
  Node-trusted certificate for "localhost" for every IP-literal target (needs a trusted CA that issues such a certificate, which the
  public roots do not) and (b) refuses a CA-valid IP certificate where `context.request` accepted, in tunnel mode
  (`FFMPEG_TLS_INTERCEPT` off) or with no proxy; the fallback to the captured body covers (b). The default terminating proxy is
  unaffected: the pin path checks `host`, and the real leaf for `127.0.0.1` is accepted. The `startTls` docstring ("for every other
  chain it is the verdict Node would have reached") is false for this case. Remedy: give `tls.connect` a `checkServerIdentity` that
  checks `host`, or pass `host`. dl-101 reuses this client and should carry it if not fixed here.
- **low** · `nfr:security` — **F4**, an expired and a not-yet-valid leaf signed by the pinned key are accepted (matrix: both
  ACCEPTED; Node's own verification would reject). Chromium's flag does the same and the docstring lists only host and signer under
  "narrower", so nothing is misstated; the proxy mints ten-year, five-minute-backdated leaves from a per-process key, so no live call
  site.
- **low** · `nfr:reliability` — **F5**, a jar read that outlives the deadline lets `follow` carry on after `fetchManifest` has
  thrown: with `cookieFor` resolving after `timeoutMs` on the second hop, one request to the next hop was made after the call had
  already rejected with `TIMEOUT`, and its sockets are registered after the `finally` that destroys them. `context.cookies` answers in
  milliseconds or rejects when the context closes: no live call site. A trickling body does end at
  the deadline (401 ms for a 400 ms budget).
- **low** · **F6**, the redaction of the refusal log's URL is unproven. Replacing `redactUrl(hit.url)` with `hit.url` in the warn line
  leaves `api/test/manifest-refetch.test.ts` 7 of 7 green: the fixture URL has no query, so `redactUrl` returns it unchanged. The
  code complies (ticket Build 4, not a Done-when line); a manifest URL with `?token=` in that test would pin it.
- **dropped** · a self-signed leaf whose SPKI equals the pin is refused (Node gives no `issuerCertificate` for it, and holding the
  key is the proxy's own position). Not a defect.
- **dropped** · `proxyUrl: ""` dials the origin directly. It is the convention `pool.ts` uses for the browser itself, and
  `routes/probe.ts` always passes `tierProxy.url`. A non-http, scheme-less or malformed proxy URL never dials: 10 forms, 0 origin hits.
- **dropped** · the narrowing of `Set-Cookie` (attributes ignored, deletions skipped) is disclosed in the Log and is a product choice,
  not a defect.
- **findings** · the hunt returned 9; 6 carried (F1–F6), 3 dropped.

**TLS acceptance matrix, run at head** (forge-minted chains served over `node:https`, `fetchManifest` direct with the pin set unless
noted; 17 rows, `NODE_EXTRA_CA_CERTS` unset): leaf signed by the pinned root, [leaf, root] → accepted (control); same chain with no
pin → refused; with a wrong pin → refused; attacker-signed leaf copying issuer name and AKID beside the pinned root cert, in the
orders [leaf, root], [leaf, atkCA, root], [leaf, root, atkCA] → refused x3; attacker leaf under an honest attacker CA → refused; leaf
for another host signed by the pinned root → refused; leaf under an intermediate under the pinned root → refused; leaf signed by the
pinned root with the root not sent → refused; the root certificate presented as the leaf → refused; expired and not-yet-valid leaves
signed by the pinned root → accepted (F4). With `NODE_EXTRA_CA_CERTS` set to an ordinary CA: its leaf for `localhost` → accepted
with no pin, its leaf for another host → refused with and without a pin.

**SSRF and redirects, real egress proxy and guard** (`createSsrfGuard` + `startEgressProxy`, fixture host exempt by name): a
redirect to each of `127.0.0.1`, `localhost`, `[::1]`, `169.254.169.254`, decimal `2130706433`, `0x7f.0.0.1`, a name resolving to
loopback, `https://127.0.0.1`, `[::ffff:127.0.0.1]`, `0.0.0.0`, `10.0.0.5` → 11 of 11 `status 403`, 0 hits on the secret origin; a
three-hop chain allowed → allowed → private → 403, 0 hits; scheme changes to `ftp:`, `file:`, `gopher:`, `data:`, `javascript:`,
`ws:` → `unsupported-scheme`, and a protocol-relative `//127.0.0.1:…` → 403, 0 hits; a redirect loop → `too-many-redirects` after
21 origin requests (1 + 20 followed, Playwright's limit).

**The cap, other encodings** (fresh process each): deflate 256 MiB (260,937 B) → `readBytes` 4,210,688, +18 MiB; br 256 MiB (224 B)
→ 4,210,688, +31 MiB (the decoder's 16 MiB window included); gzip 1 GiB (1,043,671 B) → 4,210,688 in 134 ms, +15 MiB; a gzip body
of 18,393 B that inflates to 6 MiB, sent chunked with no Content-Length → refused at 4,199,775. Content-Length does not help an
attacker: the compressed length is not what is counted.

- NFR: security — F1, F2, F3 above; every hop of the re-fetch goes through the proxy (verified), `Authorization` is dropped at the
  first origin change and stays dropped (unit test, and red when the drop is removed), and the only log line redacts the URL (F6 for its test).
- NFR: performance ✓ — a 256 MiB or 1 GiB bomb costs 134..159 ms and +15..+31 MiB against 2.5 s and +871 MiB through `context.request`.
- NFR: reliability — F5; the fallback to the captured body is kept for every non-`ok` outcome.
- NFR: maintainability — the TLS branch of a new file is covered only by a Chromium-backed `api` spec (F2); the stale comments naming
  `context.request` were updated, and the size probe's remaining use is filed as dl-101 (`npm run status -- --show dl-101` exit 0, blocked by dl-97).
- Invariants walked: no tool imports another; failures are `AppError` (`TIMEOUT` is core) or outcomes; no shell and no spawn; no
  `any` or `console`; the new specs are in existing packages' `test/` and were typechecked and run (15 + 7); no new workspace
  dependency, so no `Dockerfile` edit; contract package untouched. Skipped: progress, routes.
- Unverified: Windows behaviour beyond the informational CI leg (green on this head); the base suite's counts; Chromium's own pin
  handling beyond what the branch's `api` spec exercises.

## Log

### 2026-10-07 — filed by dl-91's builder

Filed instead of fixed, by the owner's decision of the same day (see dl-91's
Log). `difficulty` is set to `hard` rather than `standard`: the shape is a client
swap whose cookie, redirect and SSRF handling each have a way to get wrong that
passes a happy-path test. The gate's reproduction (`loadmanifest.mts`) is the same
two calls as the table's, repointed at the branch.

### 2026-10-07 — built (builder, Opus 5.5)

**Step 1, the reproduction, at base `9dcf0f6f`.** `baseline.mjs`: one
`context.request.get(url, { timeout })` and `text()` against a local server
answering `Content-Encoding: gzip` with `#EXTM3U\n` plus N MiB of spaces, gzipped
a block at a time before the timer. The number is `process.resourceUsage().maxRSS`
after the call minus before it, one process per run, headless Chromium from
`chromium.launch`, one context:

| inflated size | wire     | timeout | result         | peak RSS delta            |
| ------------- | -------- | ------- | -------------- | ------------------------- |
| 12 MiB        | 12,267 B | 8 s     | ok in 0.16 s   | +35 MB                    |
| 256 MiB       | 260,949  | 8 s     | ok in 2.1-4.6s | +772, +771, +763, +772 MB |
| 1 GiB         | 1.04 MB  | 8 s     | timed out, 8 s | +1,023 MB                 |

**Step 1 also answered the trust question, and the brief's premise was wrong.**
The brief assumed `context.request` trusts the egress proxy's generated root and
asked how, so the new client could copy it. It does not trust it. Playwright
1.62.1's `BrowserContextAPIRequestContext._defaultOptions()` takes the proxy from
the launch options (`this._context._browser.options.proxy`) and
`ignoreHTTPSErrors` from the context, which nothing here sets; the SPKI pin is a
Chromium launch flag and never reaches Node's TLS. So behind the terminating
proxy, the default since dl-37, every HTTPS re-fetch failed its handshake and
fell back to the captured body. Measured: `api/test/manifest-refetch.test.ts`'s
"trusts the proxy's root by its pin, so the re-fetch is answered", run with
base's `browser.ts` rebuilt into `dist`, fails with `expected [ { method: 'GET',
…(2) } ] to have a length of 2 but got 1` — the origin heard from the page and
never from the re-fetch. **This is a behaviour change beyond the cap**: with
this branch, a default deployment re-fetches HTTPS manifests again, as every
non-terminating one always did.

**Step 2, the shape: a client of our own, through the same proxy.**
`resolvers/src/browser/manifest-fetch.ts`, on `node:http`, `node:tls` and
`node:zlib`. Through the proxy rather than re-running the guard, because the
resolvers package has no guard (it lives in `api`), the proxy is the path the
browser's own fetches take, and `GuardedFetch` — the other precedent — follows
redirects itself and re-sends the same headers on every hop, `Cookie` included,
so a redirect to another host would be handed the first host's session.

- **The cap is `MAX_CAPTURED_BODY_BYTES` (4 MiB), reused, now exported from
  `intercept.ts`.** The re-fetch's answer stands in for a captured body, and a
  body the collector refuses to keep should not be accepted here. dl-91's other
  bound, `MAX_ENCODED_INFLATED_BYTES_PER_PROBE` (8 MiB per probe), does not fit:
  it is a budget shared by concurrent captures, and the re-fetches are
  sequential, at most `MAX_MANIFEST_ATTEMPTS` (2), each held to 4 MiB, and run
  after `settle`. dl-79's 590 KB three-hour playlist is inside it seven times
  over. It counts **inflated bytes** coming out of the decoder (gzip, x-gzip,
  deflate, br; anything else is refused, not parsed raw), and an identity body
  whose declared length passes it is refused before reading.
- **Proxy.** `http:` targets go to the proxy in absolute form; `https:` ones
  through `CONNECT`, which the proxy vets, then TLS over the tunnel. A refused
  `CONNECT` is a status like any other. A proxy URL that is not `http:` is a
  refusal, never a direct dial. With no proxy (tests, a standalone resolver),
  the client dials the origin, as the browser itself then does.
- **Redirects.** Followed by hand, every hop a fresh request through the proxy,
  `MAX_MANIFEST_REDIRECTS` = 20, Playwright's default and so what the re-fetch
  followed before. `authorization` is dropped at the first hop that changes
  origin and stays dropped, even on a hop back, as Playwright had it.
- **Cookies.** As `context.request` did them: the first hop sends the `cookie`
  the browser sent (it is in `replayHeaders(hit)`, via `allHeaders()`), and only
  if there is none asks the jar; every later hop drops it and asks
  `context.cookies(hopUrl)`. `Set-Cookie` goes back to the context with
  `addCookies({ name, value, url })`, scoped to the URL that set it; a cookie
  that deletes or expires itself is skipped rather than stored. That narrowing
  is mine; Playwright parsed the attributes.
- **Trust.** `rejectUnauthorized: false`, then: accepted if Node's own
  verification passed (`socket.authorized`, hostname included — the verdict
  `context.request` reached), or if a pin is set and the leaf names the host
  (`tls.checkServerIdentity`) and was signed by a certificate in the chain whose
  SPKI hashes to the pin (`checkIssued` and `verify`). Narrower than Chromium's
  flag, which accepts any chain carrying the key. `proxyRootSpkiSha256` is now
  kept on the resolver and used by the re-fetch even when a pool is supplied;
  its doc comment says so.
- **Deadline.** One timer over every hop, racing the whole call, so a wait no
  socket owns (the jar, a handshake) cannot outlive it; every socket and stream
  the call opened is destroyed when it ends.

**Step 4, the fallback is kept.** Anything but an `ok` with a non-blank body
falls back to `collector.bodyFor(hit.key)`. A `too-large` answer is logged once
through the resolver's logger at `warn`, "manifest re-fetch refused: its body
passed the cap", with `url: redactUrl(hit.url)` and `limitBytes`; other failures
stay silent, as before.

**Step 5, the timeout stays 8 s.** The cap no longer depends on it — the client
refuses a 1 GiB bomb in 0.06 s — so it now bounds only a slow server, and nothing
measured says a slow legitimate CDN should get less.

**After.** `after.mjs`, the same server and the same arithmetic against
`fetchManifest` from the built `dist`, cap 4 MiB. It launches no Chromium, so its
"before" is lower (74-79 MB against 125-135); the delta is what compares:

| inflated size | result                                | time   | peak RSS delta    |
| ------------- | ------------------------------------- | ------ | ----------------- |
| 3 MiB         | ok, 3,145,736 chars                   | 0.04 s | +9 MB             |
| 12 MiB        | too-large                             | 0.04 s | +4 MB             |
| 256 MiB       | too-large, `readBytes` 4,210,688 (x3) | 0.05 s | +5, +5, +4, +5 MB |
| 1 GiB         | too-large                             | 0.06 s | +5 MB             |

4,210,688 is the cap plus one 16 KiB zlib chunk: the decoder stops between
chunks when it is destroyed. The 256 MiB case is +4 to +5 MB against +763 to +772.

**Tests.**

- `resolvers/test/browser/manifest-fetch.test.ts` (new, no browser), 15 tests:
  the cap (64 MiB gzip from under 100 KB refused with `readBytes` at most the cap
  plus 64 KiB; gzip, deflate and br inside it read; a declared identity length
  refused unread; an undeclared one refused; an unknown encoding refused; a
  non-2xx status; the deadline), redirects (limit; replayed cookie on hop one and
  the jar's on hop two, asked for that hop's URL; `Set-Cookie` stored;
  `authorization` dropped cross-origin and not restored on the way back), and
  the proxy (every hop in absolute
  form; a refused `CONNECT` is a status and nothing is dialled; a `socks5:` proxy
  is refused, not bypassed). 15 of 15.
- `api/test/manifest-refetch.test.ts` (new, real `BrowserResolver`, real egress
  proxy and guard), 7 tests: a redirect to `127.0.0.1`, which the guard refuses,
  is not followed and the captured manifest is used; the session cookie reaches
  the re-fetch and the hop it redirects to; a hop to another host gets no
  cookie; a 256 MiB gzip re-fetch is refused, logged, and falls back; a gzip
  manifest inside the cap is parsed from the re-fetch; behind the terminating
  proxy the pinned root is trusted and the re-fetch answered; and a pin that is
  not the proxy's root is refused (nothing reaches the origin). 7 of 7. At base,
  the terminating-proxy test is the one that fails (above); the other six pass
  there too, because Playwright did those things, and are regression guards.
- **Mutation-checked**, each against `manifest-fetch.ts`, rebuilt, both files run
  (22 tests):
  - redirect hops dialled directly instead of through the proxy fails 4, the
    guard test among them because the secret origin was asked for
    `/latest/meta-data`;
  - the replayed cookie sent on every hop fails 2;
  - any chain accepted once a pin is set fails the mis-pinned test
    (`expected 1 to be +0`);
  - the cap multiplied by 1024 fails 3, both bomb tests among them;
  - `authorization` dropped only on hops whose origin differs from the first
    URL's (the first cut of this branch) fails the return-hop test, unit file
    only, 1 of 15.
- **Not tested:** the half of the pin rule that requires the leaf to be _signed_
  by the pinned key rather than merely chained beside it. _Wrong, corrected in
  round 1 below:_ this said `api` had no way to mint such a chain, but
  `node-forge` is `api`'s runtime dependency and `api/test/helpers/tls-origin.ts`
  already mints with it. The tests now exist.

**Also changed.** `tiers-behind-the-proxy.test.ts`'s "the manifest re-fetch is
proxied too" pinned Playwright's `context.request` on the grounds that
`#loadManifest` used it; renamed to "the size probe's context.request is proxied
too", which is the caller it still pins. `size-probe.ts`'s header comment said
the same thing and now points at dl-101.

**Fold-in: not done, filed as dl-101.** `createRequestSizeProbe` reads with the
same `context.request.get` and `text()`, so it has both defects: no cap, and
behind the terminating proxy it never reaches an HTTPS origin. Measured with a
temporary assertion in the new `api` test: over plain HTTP the origin is asked
for `/refetched.m3u8`, the media playlist the size probe reads; behind the
terminating proxy it is not. Fixing it needs this client to grow `HEAD`, a
ranged read and a body-less answer, plus its own `api` test, which is not the
small, already-specified work the exception covers.

### 2026-10-08 — round 1, after gate 1 (CONCERNS at f37a2571)

**Owner decision, 2026-10-08**, relayed by the orchestrator. Question: "dl-97
(#395): its new hand-written TLS client has a red CodeQL check, an untested
signer/host check, and an IP-identity bug, none of which an acceptance line
depends on. What should happen before it lands?" Options: fix all three, then
excuse; fix F2 and F3, leave CodeQL; land as built, findings recorded. **Chosen:
fix all three, then excuse.**

**`fetchManifest` is now exported from `@downloader/resolvers`**, so the `api`
suite can drive its TLS rules against chains minted with `node-forge`, with no
proxy and no Chromium deciding anything.

**F2, the pin rule's signer and host halves (fixed).** A new describe at the end
of `api/test/manifest-refetch.test.ts`, "the re-fetch's TLS rules against minted
chains (dl-97)", calls `fetchManifest` directly with the interception root's pin:

- "accepts a leaf the pinned root signed for this host" is the control;
- "refuses a leaf another key signed under the pinned root's name, sent beside
  that root": issuer name and authority key identifier copied from the root,
  signed by a fresh key, chain `[leaf, real root]`;
- "refuses a leaf the pinned root signed for another host" uses `leafFor("other.example")`.

The two refusal tests assert both that the outcome is `refused: untrusted-certificate`
and that the origin received no request. The Chromium test the gate named is
renamed to what it proves: "and refuses the proxy's leaf when the pin names a key
its chain does not carry".

**F3, IP-literal identity (fixed).** `startTls` now passes `host` to
`tls.connect`, so an IP literal is checked against itself and not against
`"localhost"` or the proxy's address. The docstring says so. Node's own
verification needs a CA it trusts, and `NODE_EXTRA_CA_CERTS` is read only at
start-up, so two tests run the client in a child `node` (argument array,
`shell: false`):

- "refuses a trusted certificate naming only localhost for an IP-literal target"
  covers the gate's case (a);
- "accepts a trusted certificate whose IP SAN is the IP-literal target" covers
  its case (b).

**F6, the refusal log's redaction (fixed).** The proxied fixture's page now asks
for `/master.m3u8?token=s3cr3t-signature`. The refusal test expects
`redactUrl(...)` of that URL and asserts that the warnings carry no
`s3cr3t-signature`.

**Mutations**, each applied to `src`, rebuilt into `dist` (checked by grepping
`dist` for the change), and run against both new specs (27 tests):

| mutation                                                        | result      | red                                                                                                                                               |
| --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| drop `leaf.verify(candidate.publicKey)`                         | 1 of 27 red | refuses a leaf another key signed under the pinned root's name, sent beside that root                                                             |
| `checkIssued && verify` replaced by `return true`               | 1 of 27 red | the same                                                                                                                                          |
| drop `tls.checkServerIdentity` from the pin rule                | 1 of 27 red | refuses a leaf the pinned root signed for another host                                                                                            |
| drop `host` from `tls.connect` (this branch before the round)   | 2 of 27 red | refuses a trusted certificate naming only localhost for an IP-literal target; accepts a trusted certificate whose IP SAN is the IP-literal target |
| `url: hit.url` instead of `redactUrl(hit.url)` in the warn line | 1 of 27 red | refuses a body that inflates past the cap, logs it as a refusal and falls back                                                                    |

At gate 1 the first three left 22 of 22 green.

**F4 and F5 (lows): not fixed, left recorded.** Neither states its fix. F4: an
expired or not-yet-valid leaf signed by the pinned key is accepted, as Chromium's
flag also accepts it. F5: a jar read that outlives the deadline lets `follow`
send one more request after `fetchManifest` has already rejected.

**F1, the `CodeQL` excusal, is not written this round.** adr/005 limits excusals
to findings that are "structurally permanent", where no shape of the code would
stop the query firing. This one has such a shape, and it was measured. The
measurement went back to the orchestrator as a question, and this entry does not
settle it.

The shape is design B: hand Node the proxy root's PEM (`TlsInterception.rootCaPem`,
through `TierEgress` and a new `BrowserResolverOptions.proxyRootCaPem`) as `ca`,
and delete `signedByPin` and `rejectUnauthorized: false`. Built in place,
measured, kept as a patch in the build's scratch directory and reverted. Results:

- `api/test/manifest-refetch.test.ts`, `resolvers/test/browser/manifest-fetch.test.ts`,
  `api/test/tiers-on-the-terminating-proxy.test.ts` and `api/test/resolvers.test.ts`
  pass, 48 of 48;
- `rejectUnauthorized` appears 0 times in the client's source and in `dist`;
- putting `rejectUnauthorized: false` back turns 4 of 27 red: the mis-pinned,
  attacker-chain, other-host and localhost-only tests;
- not handing the PEM to `ca` turns 2 of 27 red: both acceptance tests.

These tests are the ones written this round for design A, unchanged except for
the option they pass, so they hold whichever design lands.

**dl-101** inherits the F3 fix, and its brief's "trusts the pinned root" depends
on the F1 answer; a line is on its Log.

### 2026-10-08 — round 2: the proxy root by its PEM, not its pin

**Owner decisions on F1, both 2026-10-08, relayed by the orchestrator.**

1. **First: "Fix all three, then excuse"** (recorded under round 1). It assumed
   the hand-written check behind `rejectUnauthorized: false` was the only way to
   trust the proxy's root, so the alert could only be excused.
2. **Why that premise failed.** adr/005 allows an excusal only for a finding that
   is "structurally permanent", one that "will be wrong for every version of this
   code", and calls reaching for a suppression comment when the code could change
   "the failure mode this paragraph exists to prevent". This alert can be avoided.
   `TlsInterception.rootCaPem` already exists, so the client can take the root as
   Node's `ca` and drop the validation bypass; round 1 measured that design
   (above).
3. **Second, superseding the first as far as the excusal goes.** Question:
   "dl-97 F1: the CodeQL alert ('Disabling certificate validation') can be
   avoided. adr/005 only allows an excusal when it can't be. How should it be
   resolved?" Options: trust the proxy root's PEM; excuse as originally decided.
   **Chosen: trust the proxy root's PEM.** No excusal is written.

**What changed** (round 1's measured patch, applied, plus the docs it left stale):

- **`manifest-fetch.ts`:**
  - `proxyRootSpkiSha256` becomes `proxyRootCaPem`, and `signedByPin` is gone.
  - `startTls` hands the PEM to `tls.connect` as `ca: [rootCaPem]`. That is the
    only anchor, as ffmpeg gets `rootCaPath` alone: behind the terminating proxy
    the client only ever meets leaves minted under that root.
  - Validation is left on, so Node checks chain, signature, validity and host.
  - A certificate failure (`ERR_TLS_CERT_*` or an OpenSSL verify code) is the
    `refused: untrusted-certificate` outcome; any other socket error still rejects.
  - `rejectUnauthorized` is no longer set as an option. The word appears in
    `manifest-fetch.ts` only in its header comment, which describes the first
    cut, and in that comment's copy in `dist` (corrected per gate 2, N1).
- **`browser.ts`:** a new option, `proxyRootCaPem`, stored on the resolver and
  passed to the client. `proxyRootSpkiSha256` is back to Chromium's alone, as it
  was before dl-97; its doc comment says so.
- **`api/src/resolvers.ts`:** `TierEgress` gains a required `rootCaPem`, and
  `buildRegistry` passes it to the browser tier as `proxyRootCaPem` beside the
  SPKI.
- **`api/src/server.ts`:** fills `rootCaPem` from `tierInterception.rootCaPem`.
  Required on the type, so dropping it fails typecheck.
- **`tiers-on-the-terminating-proxy.test.ts`:** its hand-built `TierEgress`
  carries the PEM.

**F4, fixed.** Node now rejects an out-of-date leaf. The proxy root's private key
never leaves `createTlsInterception`, so the validity tests mint a root of their
own and hand its PEM to the client; to the client, a root is whatever PEM it was
given. Three tests were added to the minted-chain describe:

- "accepts a current leaf the given root signed (the control for the two below)";
- "refuses an expired leaf the given root signed";
- "refuses a not-yet-valid leaf the given root signed".

**F2's tests carry over unchanged in what they assert.** Their wording is renamed
off the pin: "accepts a leaf the proxy's root signed for this host", "refuses a
leaf another key signed under the proxy root's name, sent beside that root",
"refuses a leaf the proxy's root signed for another host". The Chromium pair is
now "trusts the proxy's root it was handed, so the re-fetch is answered" and "and
refuses the proxy's leaf when it was not handed the proxy's root".

**Wiring test, new.** "a registry built with tierEgress re-fetches through the
terminating proxy", in its own describe at the end of
`api/test/manifest-refetch.test.ts`. A `buildRegistry` with `tierEgress` probes
an HTTPS origin through the terminating proxy, and the origin must see the
manifest twice.

**Mutations under this design**, each applied, rebuilt into `dist` (checked by
grepping it) and run against both specs. Gate 1's three pin-rule mutations no
longer have code to land on: `signedByPin` is deleted.

| mutation                                                           | result      | red                                                                                                                                       |
| ------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `rejectUnauthorized: false` restored, no check behind it           | 6 of 30 red | the mis-anchored Chromium test, attacker signature, other host, expired, not yet valid, localhost-only for an IP                          |
| the PEM not handed to `ca`                                         | 3 of 30 red | trusts the proxy's root it was handed; accepts a leaf the proxy's root signed for this host; accepts a current leaf the given root signed |
| `host` dropped from `tls.connect` (F3)                             | 5 of 30 red | the three acceptance tests above, plus both IP-literal tests                                                                              |
| warn line logs `hit.url` (F6)                                      | 1 of 30 red | refuses a body that inflates past the cap, logs it as a refusal and falls back                                                            |
| `browser.ts` does not pass `proxyRootCaPem` to the client          | 1 of 30 red | trusts the proxy's root it was handed, so the re-fetch is answered                                                                        |
| `buildRegistry` does not pass `tierEgress.rootCaPem` (31-test run) | 1 of 31 red | a registry built with tierEgress re-fetches through the terminating proxy                                                                 |

**F5 stays recorded, not fixed**: its finding states no fix.

### 2026-10-08 — landing, after gate 2 (PASS at d9269157)

- **N1, fixed:** the round-2 sentence claiming `rejectUnauthorized` "appears
  nowhere" now says it appears only in `manifest-fetch.ts`'s header comment and
  that comment's copy in `dist`.
- **N2, N3 and N4 (low) stay recorded, not fixed**, by the orchestrator's
  instruction for this round. In order: `rootCaPem: ""` in `server.ts` is held
  only by the type; the line `isCertificateRefusal` draws is not pinned by a
  test; "the PEM replaces Node's store rather than adding to it" is not pinned by
  a test. F5 also stays recorded. None has a live call site, per gate 2.
