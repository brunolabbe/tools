---
id: dl-131
tool: downloader
title: Move the API's undici from 7 to 8
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-131 — undici 7 to 8

## Why

`@downloader/api` declares `undici ^7` (7.30.1 since the 2026-10-24 dependency
update, which took the 7.x advisory fixes). 8.0.0 shipped 2026-04-02 (8.12.3
latest). undici is the API's own HTTP client, and it carries this tool's network
invariants: address pinning into the socket (dl-8), the SSRF check after every
redirect, and the proxied direct fetches. A major there is a security-relevant
change even with no advisory against 7.

## Build

1. Read undici 8's breaking changes against every import in
   `tools/downloader/api/src` (`grep -rn undici`), with the dispatcher, `connect`
   options and redirect handling first — the 7.x advisories included a
   `BalancedPool` that dropped connect options, which is the shape of bug that
   would unpin an address silently.
2. Bump, adapt, and run `npm test -- --project downloader`, then the e2e suite.
3. In the Log, say which test proves the pinning and the per-redirect SSRF check
   still hold on 8 — and write one if none would fail when they stop.

## Done when

- `@downloader/api` resolves undici 8.x, the downloader's suites pass, and the Log
  names the tests that would fail if pinning or the redirect SSRF check broke.

## Log

- 2026-10-24: filed from the dependency audit.
