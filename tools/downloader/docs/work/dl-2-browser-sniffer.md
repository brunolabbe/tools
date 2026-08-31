---
id: dl-2
tool: downloader
title: Browser sniffer resolver
kind: work-package
status: done
milestone: M2
depends_on: [dl-1]
---

# dl-2 — Browser sniffer resolver

**Package:** `tools/downloader/resolvers` · **Was:** WP-2 · **Ran parallel with:**
[dl-1](./dl-1-resolver-registry-and-parsers.md),
[dl-3](./dl-3-download-engine.md), [dl-4](./dl-4-web-ui.md)

## Why

**This was the critical path.** It is the only component that can handle a site
nobody has written code for, which is the entire point of the project — see
[00-ANALYSIS.md](../00-ANALYSIS.md) §1 for why the DOM cannot answer the
question and the network layer can. Everything else in Phase 1 was either a
speed optimisation in front of it or a consumer behind it.

It depends on dl-1 only for the manifest parsers; if those had slipped, the
instruction was to stub them behind the same signature rather than idle.

## Build

Build `resolvers/browser.ts`, priority 50, `canHandle` returns true for all
http(s).

1. **Playwright Chromium**, headless, with a pooled browser instance and one
   fresh `BrowserContext` per probe (never a shared context — cookie bleed
   between probes causes wrong and occasionally cross-user results). Respect
   `MAX_CONCURRENT_BROWSERS`. Realistic UA, viewport and `Accept-Language`.

2. **Intercept on both `request` and `response`.** Match on file extension
   _and_ `Content-Type` — plenty of CDNs serve manifests from extensionless,
   signed, query-only URLs, so extension matching alone misses them. Capture the
   full request headers for every hit; that becomes `RequestContext`.

3. **DRM detection via init script** — inject before page scripts run, wrapping
   `navigator.requestMediaKeySystemAccess` to record the key systems requested.
   This is the most reliable detector available because it fires regardless of
   manifest format. Do not block the call; observe it, then report
   `DRM_PROTECTED`.

4. **Provoke playback.** Dismiss consent/cookie banners (common selectors +
   text matching), scroll the player into view, click play buttons, try
   `video.play()` directly, and handle same-origin iframes — embedded players are
   extremely common. Then wait for network quiet, capped at `timeoutMs`.

5. **Rank hits.** Master playlists beat variant playlists; larger `.mp4` beats
   small ones; ignore ad-network domains and analytics beacons. Deduplicate by
   normalised URL. If a master playlist was found, hand it to the dl-1 parsers
   to enumerate variants rather than reimplementing that logic.

6. **Classify failures precisely** — `BOT_CHALLENGE` (Cloudflare/DataDome
   interstitial), `AUTH_REQUIRED` (redirect to a login route), `GEO_BLOCKED`,
   `NO_MEDIA_FOUND` (page loaded, no media requests). A vague error here makes
   the whole product feel broken, because this is the resolver that runs on
   everything unusual.

7. **Always tear down** the context in `finally`, and implement `dispose()`.
   Leaked contexts exhaust memory within an hour of real use.

Test against locally-served fixture pages (a static HLS player page, a DASH
page, a blob/MSE page, a page with no video) — not live sites.

## Done when

It resolves a locally-served MSE/`blob:` player page, which is precisely the
case that defeats DOM scraping.

## Log

Shipped in `725740c`. M2 followed once
[dl-5](./dl-5-api-and-orchestration.md) composed the registry.

Known gap, carried forward: **the container's browser tier is only
smoke-tested.** Chromium is confirmed to launch and render inside the image, but
no probe of a real MSE page has been run from inside a container. The E2E suite
drives only the direct resolver — dragging Chromium and a network extractor into
a UI test would make it slow and flaky without proving anything new — so nothing
exercises sniffer → engine → UI in one piece. That seam is covered by types and
by the API's own tests.

**2026-08-30 — half of that gap is closed; the other half is not.**
[dl-16](./dl-16-e2e-through-the-sniffer.md) added a second e2e suite,
`npm run e2e:downloader:sniffer`, which does exercise sniffer → engine → UI in
one piece against a local MSE page. So the sentence above about the E2E suite is
now true only of the fast suite. **The container half stands exactly as written**:
that run is a `webServer` on the host, and no probe of a real MSE page has still
ever happened inside the image.
