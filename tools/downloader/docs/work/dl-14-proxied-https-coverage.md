---
id: dl-14
tool: downloader
title: Cover the proxied-HTTPS path with a TLS fixture origin
kind: fix
status: ready
milestone: null
depends_on: [dl-11, dl-12]
---

# dl-14 — Nothing in this repo has ever served TLS

**Area:** `tools/downloader/engine/test/`, `tools/downloader/api/test/`, and a
new TLS fixture helper the two share.

## Why

[dl-11](./dl-11-guarded-egress-proxy.md) found that `PROXY_URL` had never
worked. ffmpeg's `-protocol_whitelist` omitted `httpproxy` — the protocol
libavformat opens an _HTTPS_ target through when a proxy is set — so every
proxied HTTPS download failed with `Invalid argument` before the proxy was
contacted at all. The feature had been shipped, documented and deployed in that
state.

The reason nobody noticed is still true today: **no test in this repo serves
TLS.** Grep for `https.createServer` or `createSecureServer` and there is
nothing. Every fixture origin — `engine/test/helpers/http.ts`,
`e2e/fixtures/hls-origin.ts`, the resolvers' page server, the proxy tests' echo
servers — is plain `http://127.0.0.1`.

That is not a stylistic gap, because plain HTTP and HTTPS take _different code
paths through the same proxy_, and only the first is exercised:

- Plain HTTP through the proxy is an **absolute-form request**. ffmpeg opens
  `http://…` with `http_proxy` set; the proxy forwards it; the `http` protocol
  is all that is involved.
- HTTPS through the proxy is a **`CONNECT` tunnel**, and on ffmpeg's side it is
  the `httpproxy` protocol — the one the whitelist forgot.

What covers each today:

- `engine/test/ffmpeg-args.test.ts` asserts the whitelist _string_ and that a
  remote input "can be opened through a proxy". That is an argument-array
  assertion. It would have passed with the broken whitelist too, had it named
  the same constant.
- `api/test/egress-proxy.test.ts` proves an allowed `CONNECT` "reaches the
  origin and passes bytes both ways" — against a raw socket echo. No TLS
  handshake, no ffmpeg, no manifest.
- The e2e suite downloads for real, through the proxy, from a **plain-HTTP**
  origin. It proves `SSRF_ALLOW_HOSTS` reaches a fixture through the proxy; it
  says nothing about the tunnel.

So the one path that has already been broken once, in production, is the one
with no end-to-end coverage. Every real site the tool exists for is HTTPS.

## Build

1. **A TLS fixture origin, generated at test time.** A self-signed certificate
   for `127.0.0.1` — with the address in `subjectAltName`, or Node refuses it
   for a reason that reads as a network error — created in the fixture rather
   than checked in. A checked-in certificate expires, and it expires on a
   Tuesday eighteen months from now in someone else's CI run. Node's own
   `crypto` can generate the key; the certificate wants either a tiny
   dependency or ffmpeg's neighbour `openssl`, so **choose deliberately and
   record it** — a new devDependency for a fixture is a real cost and a
   `spawn`ed `openssl` is a portability one.
2. **Serve the same HLS the existing helper serves, over TLS.** Reuse
   `engine/test/helpers/http.ts` rather than forking it: the fixture that gates
   segments on the captured headers is the interesting one, and a second copy
   of it will drift.
3. **The engine test that would have caught dl-11's bug.** Real ffmpeg, real
   `https://127.0.0.1:<port>` master playlist, `http_proxy`/`https_proxy`
   pointing at a real `startEgressProxy`, and a real MP4 out the other end with
   the segments actually fetched. Model it on `engine/test/hls-e2e.test.ts`,
   which is the shape this is missing.
4. **The proxy test that pins the tunnel end to end.** A `CONNECT` to the TLS
   fixture, an allowed target and a blocked one, with the certificate proving
   the bytes were the origin's own — the point of no TLS interception is that
   the chain stays end-to-end, and nothing currently demonstrates it.
5. **`guardedFetch` through `ProxyAgent`, against a proxy.**
   `api/test/dispatcher.test.ts` proves the dispatcher "switches to the proxy
   wholesale when one is configured" by inspecting what it built.
   `config.ts` refuses an unusable `PROXY_URL` at boot. Neither has ever sent a
   request through one. With a TLS fixture available this becomes cheap, and it
   is the path the engine's non-ffmpeg fetches take.
6. **Chained mode, once, for real.** `startEgressProxy` with
   `upstreamProxyUrl` set has unit coverage against a fake upstream. Point it at
   a second instance of our own proxy and fetch an HTTPS target through both.
   That is the deployment `PROXY_URL` actually describes, and `mode: "chained"`
   is what `/api/health` reports for it.

**Traps.**

- Self-signed means ffmpeg and undici both reject the certificate on trust
  grounds, which will read exactly like the proxy failure this ticket is about.
  Pass the CA explicitly — ffmpeg has `-ca_file`, undici takes a `ca` in its
  connect options — rather than disabling verification. A
  `NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere in this repo is a finding, not a fix.
- The proxy resolves and pins the target itself in pinned mode, so the fixture
  on loopback still needs the guard opened for `127.0.0.1` exactly as the e2e
  config does. A test that "fails to connect" is far more likely to be the
  guard doing its job than the tunnel being broken.
- `new URL("https://host:443")` normalises the port away — dl-11's log records
  this biting once already in the `CONNECT` target parser. Assertions on port
  numbers in these tests should expect the same.
- Do not add TLS to the Playwright e2e origin. That suite's job is the user's
  journey through a real browser, and a self-signed certificate there means
  teaching Chromium to trust it — cost with no new information, since the
  proxied tunnel is proven at the engine level by step 3.

## Done when

- A test drives real ffmpeg, through the real egress proxy, against an HTTPS
  origin, to a playable MP4 — and fails if `httpproxy` is removed from
  `REMOTE_PROTOCOL_WHITELIST`. Prove that second half by deleting it and
  watching the test go red; a regression test nobody has seen fail is a guess.
- A blocked HTTPS target is refused at `CONNECT` and never completes a
  handshake with the origin.
- `guardedFetch` retrieves a body through a proxy, over TLS, with the guard
  applied.
- Chained mode moves bytes through two real proxies.
- `npm run check` is green and every existing suite passes unchanged.
- [03-STATUS.md](../03-STATUS.md) loses "the gap in coverage that hid it is
  still there", and gains whatever this leaves uncovered instead.

## Log

_Not started._
