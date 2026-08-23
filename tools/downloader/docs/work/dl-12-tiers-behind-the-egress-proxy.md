---
id: dl-12
tool: downloader
title: Point the browser and yt-dlp tiers at the guarded egress proxy
kind: fix
status: done
milestone: null
depends_on: [dl-11]
---

# dl-12 — The subprocess tiers behind the same proxy

**Area:** `tools/downloader/api/src/` and `tools/downloader/resolvers/src/browser/`

## Why

[dl-11](./dl-11-guarded-egress-proxy.md) put ffmpeg behind a loopback proxy that
runs the service's own `SsrfGuard` on every request, and its step 6 deferred the
other two subprocess tiers on purpose: prove it on ffmpeg first, then widen.
This is the widening, and [03-STATUS.md](../03-STATUS.md) names it as the last
egress outside the guard.

Both tiers already take a proxy — `browser/pool.ts` passes Playwright's
`proxy.server`, `ytdlp.ts` passes `--proxy` — and both currently receive
`config.proxyUrl`, which is unset in every deployment that does not have an
operator proxy. So today they resolve names themselves and open sockets nobody
authorised, exactly as ffmpeg did before dl-11.

**Chromium is the wider hole of the two**, and it is wider than ffmpeg's was.
ffmpeg fetched the URIs one manifest named. A browser fetches whatever a hostile
page names — every script, image, `fetch()` and XHR on it — and it does so with
the page's own timing and error signals readable back in JavaScript. That is not
blind SSRF: a page can port-scan the deployment's network from inside the probe
and read the results. The `ProbeResult` sweep cannot see any of it, because none
of those URLs ends up in a `ProbeResult`.

There is a second, quieter hole on the same path. `#loadManifest` in
`resolvers/src/resolvers/browser.ts` re-fetches the chosen manifest through
`context.request.get` — an attacker-influenced URL fetched from the API process,
with the body handed to a parser and its output reaching the client as variant
metadata. Nothing checks that URL today.

yt-dlp is the smaller case: it fetches what its extractor for that site decides
to fetch, and an extractor is code we ship rather than code the page supplies.
It still resolves and connects unguarded, and it is two lines to fix, so it goes
in the same ticket.

## Build

1. **Hand both tiers the local proxy instead of the operator's.** The two places
   that build `ResolveOptions` are `routes/probe.ts` and the orchestrator
   (constructed in `server.ts`). Both currently pass `config.proxyUrl`; both
   should pass the `EgressProxy.url` that `server.ts` already starts and already
   hands the engine. Put it on `AppContext` — it is runtime state, not config,
   and `ApiConfig` is env-derived by definition.
   In chained mode this is strictly better than today rather than a trade: the
   tiers reach the operator's proxy through ours, which vets the name first.
2. **Stop launching a Chromium per probe.** `BrowserPool.withBrowser` launches a
   _dedicated_ browser whenever `proxyUrl` is set, because Chromium binds
   `--proxy-server` per process. That was right when a proxy was the exception;
   with step 1 the proxy is always set and constant, so every probe would pay a
   full launch — ~1 s and ~150 MB — and the shared browser would never be used
   again. Key the shared browser on the proxy it was launched with: reuse it when
   the lease asks for the same one, and keep the dedicated path only for a lease
   that asks for a different one.
3. **Let the proxy carry what a browser sends.** `ALLOWED_METHODS` in
   `egress-proxy.ts` is `GET`/`HEAD` — "ffmpeg reads; it never writes", which was
   true of ffmpeg. A page's `fetch()` and XHR go through as absolute-form `POST`
   (measured, not assumed), so a plain-HTTP page would have its requests answered
   `405` by us and would fail in ways no log explains. Widen to the methods a
   browser actually sends and keep refusing the rest. The guard on every target,
   the absolute-form-only rule and the loopback binding are what stop this being
   a general-purpose proxy — not the verb list.
4. **Keep the loopback rule visible.** Playwright already passes
   `--proxy-bypass-list=<-loopback>` whenever a proxy is set, so requests to
   `127.0.0.1` go through the proxy rather than around it. That is load-bearing
   in both directions — it is what stops a page reaching the deployment's own
   loopback services, and it is why a fixture origin on `127.0.0.1` needs
   `SSRF_ALLOW_HOSTS` to reach the guard. It is Playwright's default, not ours,
   so it needs a comment where the pool sets the proxy and a test that would
   notice if a Playwright upgrade changed it.
5. **Do not leak the loopback port to clients.** `RequestContext.proxyUrl` is
   filled from `ResolveOptions.proxyUrl` by every resolver, and the probe
   response carries it to the browser. After step 1 that value is an ephemeral
   loopback port that is meaningless outside this process and stale after a
   restart. The field means "the proxy needed to re-issue this request from
   somewhere else", so the honest value is the operator's proxy or nothing.
   Correct it where the loopback URL was introduced — in the API — rather than
   by changing what the resolvers report.

**Traps.**

- `context.request.get` inherits the browser context's proxy, and Playwright's
  fetch sends `CONNECT` even for an `http://` target. So the `#loadManifest`
  hole closes with step 1 and needs no separate change — but it is worth a test,
  because it closes for a reason that is not obvious from either file.
- Chromium speaks no UDP through an HTTP proxy, so QUIC is not a bypass; WebRTC
  is, and no HTTP proxy can see it. Out of scope, and worth saying so.
- `ws://` on a plain-HTTP page arrives as an `upgrade` event, which this proxy
  does not handle, so those connections die. `wss://` rides inside a `CONNECT`
  and is unaffected. Mixed-content rules mean only an entirely plain-HTTP page
  can be in the first case; accept it and record it.

## Done when

- A real Chromium, pointed at the proxy, loads a fixture page that requests a
  subresource from a blocked host — and the request is refused by the guard
  while the page itself loads. The URL never appears in a `ProbeResult`, which
  is the same point dl-11's first test made about segment URIs.
- A test proves the manifest re-fetch goes through the proxy too.
- A test proves the probe route and the orchestrator hand resolvers the loopback
  proxy and not `PROXY_URL`.
- A test proves two leases with the same proxy share one browser, and that a
  different proxy still gets its own.
- The proxy forwards an absolute-form `POST` to an allowed target and refuses
  one to a blocked target, and still refuses a method outside the browser set
  and an origin-form request.
- `npm run check` is green, the downloader suites pass, and
  `npm run e2e:downloader` passes unchanged.
- The "browser and yt-dlp tiers still fetch outside the guard" entry in
  [03-STATUS.md](../03-STATUS.md) moves from known gaps to closed, naming what
  remains true (WebRTC, plain-HTTP WebSocket, and proxy mode's lack of pinning).

## Log

Shipped. `AppContext.egressProxyUrl` carries the loopback proxy to
`routes/probe.ts` and to the orchestrator, `BrowserPool` keys its shared browser
on the proxy it launched with, and `ALLOWED_METHODS` grew to the set a browser
sends. Verified against a real Chromium rather than reasoned about, which is
what the brief demanded and what it should have demanded of dl-11's step 6 too.

**Chromium was measured before the brief was written**, and two of the three
things it settled went the other way from the guess:

- **A page's `fetch()` arrives as an absolute-form `POST`.** With the old
  `GET`/`HEAD` set the proxy would have answered `405` to every XHR on a
  plain-HTTP page, which is a resolver failure with no explanation anywhere.
- **Playwright already passes `--proxy-bypass-list=<-loopback>`** whenever a
  proxy is set, so nothing had to be added for loopback — Chromium's own default
  is to bypass proxies for `127.0.0.1`, and Playwright turns that off. Measured
  both ways: with a bypass list that names a loopback host, Playwright drops the
  flag and the page reaches loopback directly. That is what
  `tiers-behind-the-proxy.test.ts` asserts against, so a Playwright change here
  fails a test rather than silently reopening the hole.
- **`context.request` inherits the context's proxy** and sends `CONNECT` even for
  an `http://` target. That closes `#loadManifest` — an attacker-influenced URL
  fetched from _this_ process, whose body reaches a parser — without touching
  `browser.ts` at all. It gets its own test because nothing in either file says
  so.

**Step 2 was the only real code in the ticket.** The semaphore would still have
bounded how many browsers ran at once, so nothing unbounded was at stake — but
every probe would have paid a launch it used once and threw away, and the
~150 MB of fixed browser overhead would have been per concurrent probe instead
of shared. `stats.launched`, which `/api/health` uses to tell "idle" from
"Chromium cannot start in this container", would also have gone permanently
false, since nothing would ever have populated the shared slot.

**yt-dlp needed no code change at all** — `ytdlp.ts` already turned
`options.proxyUrl` into `--proxy` — but that had never been tested, so the fake
binary grew an `echo-args` mode and two tests now pin it. "Two lines" in the
brief was one line too many and one test too few.

**One thing the brief did not anticipate.** With the tiers proxied, every
resolver echoed the loopback URL into `RequestContext.proxyUrl`, and that field
reaches clients twice: in the probe response and in the `probed` job event, which
carries the whole `ProbeResult`. `withoutEgressProxy` strips it on both paths.
The resolvers still report what they were given — that is honest, and it is the
API that introduced a value worth hiding.

**Where it does not reach.** WebRTC leaves Chromium over UDP and no HTTP proxy
observes it. A `ws://` upgrade on a plain-HTTP page arrives as an `upgrade` event
this proxy does not handle, so it dies rather than being tunnelled; `wss://` is
unaffected. Both are recorded here and in `api/src/egress-proxy.ts`'s docblock
rather than fixed. Proxy mode still does not pin, for the reason dl-8 gives.

Tests: `api/test/tiers-behind-the-proxy.test.ts` (5, one driving a real
Chromium), `resolvers/test/browser/pool.test.ts` (3), two more in
`api/test/egress-proxy.test.ts` for what a page sends, and two in
`resolvers/test/ytdlp.test.ts`. 534 unit tests pass across 36 files,
`npm run check` is green, and `npm run e2e:downloader` passes unchanged — which
matters here for the same reason it did in dl-11: it proves `SSRF_ALLOW_HOSTS`
still reaches a fixture origin through the proxy.
