---
id: dl-11
tool: downloader
title: Put ffmpeg's own fetches behind a guarded egress proxy
kind: fix
status: ready
milestone: null
depends_on: [dl-6, dl-8]
---

# dl-11 — A guarded egress proxy for ffmpeg

**Area:** `tools/downloader/api/src/` — a new proxy beside `dispatcher.ts`

## Why

[03-STATUS.md](../03-STATUS.md) records it in one line: **ffmpeg fetches outside
the guard.** `guarded-fetch.ts` covers the direct resolver and the engine's own
fetches, and `dispatcher.ts` pins those connections to a vetted address, but
ffmpeg does its own HTTP through libavformat and neither mechanism can reach it.

What is already covered is worth stating, because it bounds the work. Every URL
in a `ProbeResult` — each variant, its `audioUrl`, every subtitle — is swept by
`assertAllAllowed` before the engine is handed anything (`urlsInProbeResult` in
`ssrf.ts`), and `REMOTE_PROTOCOL_WHITELIST` in `engine/src/ffmpeg/args.ts` omits
`file`, so a segment URI of `file:///etc/passwd` is already dead and stays dead
across a redirect.

Three holes remain, and they are all the same hole seen from three angles —
ffmpeg opens sockets nobody authorised:

1. **Segment URIs inside the manifest.** The one that matters. ffmpeg fetches
   the playlist and then fetches every URI the playlist names: `#EXTINF`
   segments, the `#EXT-X-MAP` init segment, the `#EXT-X-KEY:URI=` key, DASH
   `BaseURL` and `SegmentTemplate` expansions. None of those exist at probe
   time, so the `ProbeResult` sweep cannot see them. A hostile page serves a
   well-formed playlist whose segments address `http://10.0.0.5:8500/v1/kv/`.
   Mostly this is **blind** SSRF — ffmpeg fails to demux non-media bytes and the
   job errors — but it is a working oracle for internal services via timing and
   error differences, and `stderrTail` carries the evidence into the `AppError`.
2. **Redirects.** A vetted manifest URL answers `302` to an internal address and
   libavformat follows it. `guarded-fetch.ts` exists to re-check every hop by
   hand; ffmpeg goes around all of it.
3. **DNS rebinding.** dl-8's pinning `lookup` governs undici only. ffmpeg
   resolves the name again for itself, so the check and the connection can
   disagree — the exact TOCTOU dl-8 closed everywhere else.

Parsing manifests ourselves and pre-vetting each segment is the obvious answer
and the wrong one: it abandons why `download/manifest.ts` exists at all
(analysis §6 — hand-rolled concatenation gives timestamp drift and A/V desync
across discontinuities), and it still would not cover key URIs, nested variant
playlists or template-expanded DASH URLs. The check has to sit at the socket,
not at the manifest.

## Build

An in-process HTTP forward proxy on loopback that runs the **existing**
`SsrfGuard` on every request and pins the address, with ffmpeg pointed at it.
Every ffmpeg fetch then becomes a request this process authorised — segments and
key URIs included — without a line of manifest parsing.

The plumbing is already there, which is what makes this small. `runFfmpeg`
exports `http_proxy`/`https_proxy` into the child's env
(`engine/src/ffmpeg/runner.ts`), and `proxyUrl` already threads from
`config.ts` → `server.ts` → the orchestrator → the engine. Nothing downstream of
the proxy URL changes; only what that URL points at.

1. **`api/src/egress-proxy.ts`** — a `node:http` server bound to `127.0.0.1`
   on an ephemeral port, started with the app and closed on shutdown.
   - **`CONNECT`** (all HTTPS, so the common path): the target is `host:port`
     and nothing more. Run `assertAllowed` against it as an `https://` URL,
     resolve and check every record exactly as `createPinningLookup` does, then
     `net.connect` to the pinned address and pipe both ways. **No TLS
     interception** — the bytes are tunnelled, so certificates stay end-to-end
     and ffmpeg needs no trust-store change. The guard is host- and
     address-based, so not seeing the path costs nothing.
   - **Absolute-form `GET`/`HEAD`** (plain HTTP): the request line carries the
     full URL. Vet it, then forward with the same pinned `lookup`.
   - Reuse `isBlockedAddress` and `guard.isExemptHost` directly. Do **not**
     restate the policy — dl-8's note about a fixture host that one check waves
     through and another refuses applies here with equal force.
2. **Refuse anything else.** No other methods, no origin-form requests. A
   `407`/`405` is fine; what matters is that this cannot be walked into a
   general-purpose open proxy.
3. **Bind loopback only**, and log the chosen port at boot. In the container
   that is the whole containment story; do not add credentials for it unless
   step 6 shows a reason.
4. **Chain, do not replace.** When `PROXY_URL` is set, the local proxy forwards
   through the operator's proxy instead of connecting itself. In that mode it
   vets the name and cannot pin — same reason as dl-8's proxy mode, and the
   `EgressDispatcher.mode` distinction is the precedent to follow. Report the
   mode the same way.
5. **Point ffmpeg at it.** `server.ts` passes the local proxy's URL as the
   engine's `proxyUrl` in place of `config.proxyUrl`. Confirm this reaches
   `runFfmpeg` on **both** ffmpeg paths — `download/manifest.ts` and the mux in
   `mux.ts` — and note that `env.http_proxy` is what libavformat honours, which
   the runner already sets.
6. **Leave the browser and yt-dlp tiers alone for now.** Both take a proxy
   already (`browser/pool.ts` passes Playwright's `proxy.server`, `ytdlp.ts`
   passes `--proxy`), so pointing them here is a two-line follow-up — but
   Chromium through a hand-rolled proxy is its own afternoon, and this ticket is
   worth proving on ffmpeg first. Open the follow-up rather than widening this.

**Traps.** `CONNECT` needs the `upgrade`-style raw-socket handling, not the
ordinary `request` handler. Half-open sockets must propagate or a stalled
segment leaks a connection per job. And the abort path matters: when a job is
cancelled the tunnels must close, or `killProcessTree` reaps ffmpeg while this
process keeps the sockets alive.

## Done when

- A test serves a playlist whose segment URI resolves to a blocked address,
  runs the real download path against it, and asserts the job fails with
  `BLOCKED_TARGET` — the URL never appeared in the `ProbeResult`, which is the
  whole point.
- A test proves the redirect hop is checked: the manifest URL is public and
  `302`s to loopback, and the proxy refuses the second hop.
- A rebind test in the shape of dl-8's: public address for the pre-flight check,
  loopback from the connector's resolver, refused at connect.
- The proxy refuses a non-`CONNECT`, non-absolute-form request.
- `npm run e2e:downloader` passes unchanged — it drives the direct resolver
  against a local fixture origin, so `SSRF_ALLOW_HOSTS=127.0.0.1` has to keep
  working through the proxy. If it does not, the exemption is not being shared.
- The line in [03-STATUS.md](../03-STATUS.md) moves from "known gaps" to closed,
  naming what remains true in proxy mode.

## Log

_(empty — not started)_
