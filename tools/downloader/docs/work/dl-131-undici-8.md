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
- 2026-11-10: built on `downloader/dl-131-undici-8` from `a100f429`.
  - **Version.** `@downloader/api` now declares `undici ^8.12.3`; the lockfile
    holds `node_modules/undici` at 8.12.3 (published 2026-10-19T14:02Z, 22 days
    old). 8.12.4 (2026-11-05T08:55Z) is under the seven-day wait and was not
    taken: its six advisories (GHSA-mqg3-3v4r-cm32 and five more) are all in the
    cache interceptor, the redirect interceptor or fetch's `integrity` option,
    and `grep -rnE "interceptors|cache\(|redirect\(\)|integrity"` over
    `tools/downloader/{api,engine,resolvers}/src` finds none of them in use;
    `npm audit --package-lock-only` at 8.12.3 prints `found 0 vulnerabilities`,
    so nothing reports an advisory against this tree. jsdom's nested
    `undici 8.12.2` (dev) dedupes to the root 8.12.3. Relock:
    `npx -y npm@11.21.1 update undici --before=2026-11-03 --package-lock-only
    --ignore-scripts`, then `npm install --package-lock-only --ignore-scripts`
    on npm 10.9.9 (npm 11 had also dropped `"peer": true` lines from unrelated entries; the npm 10
    pass put them back), `node scripts/check-lockfile-sync.mjs` → `up to date`.
    undici 8 needs Node `>=22.19.0`; the repo's `engines` is `>=22.22.2`. The
    image's Node (Playwright's `noble` base) was not measured here: the PR's
    `docker` job is that reading.
  - **What the brief had wrong.** It framed the risk as an address silently
    unpinned. The break was louder and elsewhere: **Node's global `fetch` cannot
    take an undici 8 dispatcher at all.** The farmed tree was pointed at 8.12.3
    (tarball from `npm pack`, integrity matching the lockfile, linked over the
    tree's own `node_modules/undici`; the shared checkout is untouched) and the
    unchanged source failed 33 tests in 10 files under
    `npm test -- --project downloader`, every one `TypeError: fetch failed`,
    cause `InvalidArgumentError: invalid onRequestStart method`
    (`UND_ERR_INVALID_ARG`): Node 22.23.4 bundles undici 6.29.1, whose `fetch`
    hands the dispatcher a legacy handler, and 8's `Agent` rejects it. Under 7
    the two shared a handler shape, so `createGuardedFetch(guard, globalThis.fetch,
    { dispatcher })` worked and nothing said it was a pairing. Fixed by making
    it one: `EgressDispatcher` gains `fetch`, undici's own `fetch`, and
    `server.ts` and every test that built the pair by hand take it from there
    (`dispatcher.ts`, `server.ts`; `dispatcher`, `egress-ca`, `embedded-ipv4`
    and `proxied-https` specs). Fetches with no dispatcher (`createGuardedFetch(guard)`,
    `human-check`'s default) stay on the platform's. A scratch probe through
    `createGuardedFetch(guard, egress.fetch, { dispatcher })` against a local
    origin showed the shapes production uses working on 8: a `URLSearchParams`
    POST with `AbortSignal.timeout` (human-check's siteverify), a `Headers`
    instance, a `Request` input, and a streamed body cancelled mid-flight (the
    origin saw the client close).
  - **Which tests prove pinning and the per-redirect check hold on 8**, each
    shown to fail when its mechanism is removed (one mutation at a time, on the
    committed source, restored from the commit after each):
    - Pinning: remove `lookup: createPinningLookup(...)` from the `Agent`'s
      connect options → `dispatcher.test.ts` "a rebind between the check and
      the connection" fails (all three: "the connector refuses the address the
      pre-flight check never saw", "and connects normally when the pinned
      address is allowed", "https goes through the same connector, not around
      it"), plus the two below. The connector's literal check is
      `embedded-ipv4.test.ts` "the bare pinned dispatcher refuses the literal,
      with no pre-flight check at all", which passed on 8 once paired with
      undici's fetch.
    - Per-hop check: remove `await guard.assertAllowed(currentUrl)` from
      `guarded-fetch.ts` → `ssrf.test.ts` "re-checks after a redirect, which is
      how a naive guard is defeated", `embedded-ipv4.test.ts` "a redirect hop in
      guarded-fetch, with no dispatcher behind it", and the new test below fail.
    - **No test failed if undici itself began following redirects, and one now
      does.** `embedded-ipv4.test.ts` "both layers: a redirect hop through the
      pinned dispatcher" ends in the connector's refusal either way, and
      `ssrf.test.ts` stubs the fetch. Changing `redirect: "manual"` to `"follow"`
      in `guarded-fetch.ts` left both green. New, at the end of
      `dispatcher.test.ts`, "a redirect on the pinned dispatcher": "is judged
      again by the guard before the second hop opens a socket" (the dispatcher's
      guard lets both hosts through its connector and the request's guard
      refuses the second, so only the per-hop check can stop it, and a
      redirect undici followed itself would put `/secret` among the origin's
      hits) and "is handed back to the caller, not followed, by the fetch the
      dispatcher travels with" (a raw `egress.fetch` with `redirect: "manual"`
      returns the 302 and the origin sees one request). With `"follow"` the
      first fails; with the per-hop check removed the first fails; the second
      is the direct statement of the invariant `dispatcher.ts` comments on.
  - **Results.** `npm run check` exit 0; `npm test -- --project downloader`
    exit 0, `Test Files 126 passed | 1 skipped (127)`, `Tests 2610 passed | 2
    skipped (2612)`, 79 s (after the fix; 33 failed before it). `ProxyAgent`
    (the proxy mode) is exercised by `proxied-https.test.ts` and
    `egress-proxy.test.ts`, both green on 8.
  - **Not run here.** The e2e suites: the paths only e2e reaches are the whole
    server booted by `createApp` (so `egress.fetch` with the pinned dispatcher
    on a probe, thumbnail and manifest fetch against the fixture origin) and
    the container's Node. Both are the draft PR's `downloader` workflow
    (`e2e` and `docker` jobs; `package-lock.json` is in its path filter). The
    planner and ledger web suites, whose jsdom now resolves the root undici
    8.12.3 instead of its nested 8.12.2 (a patch bump, dev only), were not run:
    this tree's jsdom is linked to the shared checkout's, which keeps its own
    nested copy, so a local run could not have read it.
- 2026-11-10 — Owner's answer on the builder's open decision about undici
  8.12.4, relayed by the orchestrator. The question: 8.12.3 is pinned under the
  seven-day rule; 8.12.4 (2026-11-05) fixes six advisories in features this tree
  does not use, and npm's advisory database lists none against 8.12.3; when
  should 8.12.4 come in. The options were: leave 8.12.3 and let the next
  dependency update take it, bump on this branch on 2026-11-12, or file a
  ticket. The owner chose to leave 8.12.3 and take 8.12.4 in the next dependency
  update, which was the builder's recommendation; nothing was overridden and no
  ticket was filed.
