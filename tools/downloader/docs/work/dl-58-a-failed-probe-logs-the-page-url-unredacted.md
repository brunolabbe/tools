---
id: dl-58
tool: downloader
title: A failed probe logs the page URL with its query string, credentials included
kind: fix
status: done
milestone: M5
depends_on: []
difficulty: standard
---

# dl-58 — A failed probe logs the page URL unredacted

**Packages:** `api` (the error handler, and possibly the logger), plus whichever
packages put URLs into `AppError.details`.

## Why

The root `CLAUDE.md` says to redact credentials anywhere URLs are logged,
because "a signed URL carries its credential in the query string". A failed
probe breaks that rule:

- `resolvers/src/registry.ts:136` (`:105` at filing time, drifted since —
  re-resolved 2026-09-17) "details: { url: url.href, attempts },"
  — sets the page URL, query string included, as the `NO_MEDIA_FOUND` error's
  `details`. A second, un-cited site at `registry.ts:75` does the same for the
  "no resolver can handle that address" case.
- `downloader/api/src/server.ts:603` (`:600` at filing time) "details:
  appError.details," — is how the error handler copies those `details` into
  the `request rejected` (and `request failed`) line as they are. The `url`
  field beside it goes through `redactLoggedUrl`, and `details` does not.
- `downloader/api/src/logger.ts:104` "function safeFields(" — the logger's
  last line of defence rewrites only a `requestContext`, and its pino
  `redact` paths cover only `cookie` and `authorization` headers.

**Reproduced on 2026-09-13**, from the worktree at `origin/main` `1835657`,
against the real `createLogger`. It logged the fields the error handler builds,
with a signed page URL in `details`:

```text
{"level":"info",…,"url":"/api/probe","code":"NO_MEDIA_FOUND","status":422,
 "details":{"url":"https://cdn.example/watch?v=1&sig=SECRET123","attempts":[]},
 "msg":"request rejected"}
```

`sig=SECRET123` reached the output unchanged. That run exercised the logger,
not a request through Fastify. The server half above was read, not run. Step 1
closes that gap.

**Exposure today is low, and it grows at launch.** Behind Access, only the
owner's own URLs reach the owner's own logs. Once
[dl-49](./dl-49-open-without-a-login.md) removes the login, strangers' signed
URLs would be written to the host's logs, which is why dl-49 waits on this.

## Build

1. **Write the failing test first, through the real server.** Use Fastify
   `inject` with a resolver chain whose tiers all fail, a page URL carrying
   `?sig=SECRET123`, and a logger whose `write` captures lines. Assert that no
   line contains `SECRET123`. Record in the Log that it failed on `origin/main`.
2. **Sweep before fixing.** List every place an `AppError` is built with a URL
   in its `details`, across `resolvers`, `engine` and `api`, and every log call
   passing a URL field that does not go through `redactUrl` or
   `redactLoggedUrl`. Write the list in the Log. The fix should cover all of
   them with one mechanism, not one call site at a time.
3. **Choose the layer and say why in the Log.** Two candidates:
   - **The error handler** redacts absolute `http(s)` URLs inside `details`
     with `redactUrl` from `@webtools/core`. Narrow, and it matches where
     `url` is already redacted.
   - **`safeFields` in the logger** does it for every line. It catches callers
     that forget, which is that function's stated job, but it has to leave
     relative paths such as `/api/probe` readable.

   Either is acceptable. Picking one without saying why is not.

4. **Do not redact the probe's HTTP response.** The client sent that URL, so
   echoing it back discloses nothing. This fix is about what reaches the log.

## Done when

- The step-1 test fails on `origin/main` and passes on the branch, and the Log
  records both runs.
- The step-2 sweep is in the Log, and a test covers each other URL-carrying
  site it found, or the Log says why one needs none.
- A test proves the redacted line still carries the host and path, so the log
  still says which site failed.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-13 — Filed on the owner's instruction instead of being fixed on the
  spot. Found while filing
  [dl-57](./dl-57-a-record-of-how-probes-and-downloads-end.md), which reads
  these same log lines. The logger half was reproduced as above. The
  error-handler half was read, not run.

- 2026-09-17 — Built on `dl-58-redact-probe-error-url` off `origin/main`
  (`20c8fd1`).

  **Citations re-resolved before relying on them** (both had drifted since
  filing): `registry.ts:105` is now `registry.ts:136`; `server.ts:600` is now
  `server.ts:603`. Corrected in the Why section above.

  **Step 1 — the failing test, through the real server.** Added
  `describe("a failed probe never logs the page URL's credentials", ...)` to
  `api/test/logging.test.ts`. Two cases, not one: a 5xx (`TLS_VERIFICATION_FAILED`,
  the "request failed" branch, logged at `error`) and a 4xx
  (`AUTH_REQUIRED`, the "request rejected" branch, logged at `info` — the
  ticket's own reproduced shape). Both inject a `StubResolver` that throws an
  `AppError` carrying `details: { url: signedUrl }` where `signedUrl` has
  `?sig=SECRET123`, through `POST /api/probe` via Fastify `inject`, with a
  logger whose `write` captures raw lines. **Neither case uses `NO_MEDIA_FOUND`**:
  that code is a fall-through in `ResolverRegistry.resolve()`, so with the
  real `direct` tier also registered (required for the app to boot at all —
  `assertUsable` refuses a config with every tier off) the chain would move on
  to it and reach real DNS for the fixture host — `probe-outcomes.test.ts`
  already documents this exact constraint and avoids it the same way. Ran
  first against unfixed `origin/main`: both **failed**, each with `SECRET123`
  present in exactly one raw line (`"msg":"request failed"` /
  `"msg":"request rejected"`), reproducing the vulnerability through the real
  server rather than only against `createLogger` directly, which is the gap
  the ticket's own 2026-09-13 reproduction named ("that run exercised the
  logger, not a request through Fastify"). Command:
  `npx vitest run tools/downloader/api/test/logging.test.ts -t "a failed probe never logs"`.

  **Step 2 — the sweep.** Every `AppError` built with a URL in its `details`,
  across `resolvers`, `engine` and `api`:
  - Already redacted at the source, via `redactUrl` (no action needed):
    `resolvers/src/browser/classify.ts:135,240,245` (all three paths of
    `classifyFailure`/`classifyNavigationError`).
  - Unredacted, feeding an `AppError.details.url` that a caller may log
    verbatim: `resolvers/src/registry.ts:75,136`;
    `resolvers/src/resolvers/direct.ts:109,175,210,343,349,383`;
    `resolvers/src/resolvers/ytdlp.ts:276,290,906`. (`engine/src/**` has no
    such site — checked by grep, none found.)
  - Manifest parsers (`resolvers/src/manifest/hls.ts:325`,
    `resolvers/src/manifest/dash.ts:361,368`), `browser/drm.ts:134` and
    `browser/pool.ts:224,321` build `details` with no URL in it at all — not a
    site.

  Every log call passing `AppError.details` to a line, across `api` (`engine`
  and `resolvers` have no logger of their own): `api/src/server.ts:603` (the
  ticket's own site); two more the ticket did not name,
  `api/src/egress-proxy.ts:357` (`refused`) and `:450` (`upstreamRefused`);
  and `api/src/main.ts:83`, a direct `process.stderr.write` with no `AppLogger`
  involved at all — "no logger yet if `createApp` was what failed", per its
  own comment.

  **Step 3 — the layer, and why.** Chose **the logger's `safeFields`**
  (candidate two), not the error handler, on a measurement rather than a
  guess: `egress-proxy.ts`'s `refused` and `upstreamRefused` share the exact
  same `AppLogger` (`createLogger`/`adapt()`) that `server.ts`'s error handler
  uses, so redacting inside `safeFields` covers those two sites _and_
  `server.ts`'s **for free** — three of the four known log sites, with zero
  additional call-site edits — where redacting only inside
  `registerErrorHandling` would cover exactly one of the four. That is the
  "one mechanism, not one call site at a time" the Build asked for, measured
  against the sweep above rather than assumed from the ticket's own framing of
  the two candidates. Implemented as `redactDetailsUrls()` in `logger.ts`: for
  every string value under a top-level `details` key, if it parses whole as an
  absolute `http(s)` URL, replace it with `redactUrl(value)` (origin + path,
  query redacted); anything else — a relative path, a number, `attempts`,
  `stderr` tails — passes through untouched, matching the "leave relative
  paths readable" requirement without a name-based allowlist (a relative path
  simply fails `new URL()`). This changed **zero lines in `server.ts`**, which
  also means it needed no coordination with dl-66's planned edit to
  `registerErrorHandling` in the same file — there was nothing to keep out of
  its way.

  `main.ts:83` is the one known log site this does not cover, and it is
  deliberately left that way rather than patched without a test: it writes
  directly to `process.stderr` before any `AppLogger` exists, and it only
  fires on a **startup** failure (`createApp()` rejecting) — before a single
  request, let alone a page URL, has entered the process. Read every
  `AppError` reachable from that synchronous boot path
  (`config.ts`'s `PROXY_URL` validation, `assertUsable`'s tier check,
  `ssrf.ts`'s guard construction, `operator-ca.ts`'s CA read): none carries a
  request-scoped URL — `config.ts`'s own two sites carry `hint`/`scheme`
  fields, not a URL. No test exists for it and none is added; a fix with no
  failing test to justify it would violate this ticket's own step 1.

  Added three more unit tests, directly against `safeFields`/`logger.ts`
  rather than only through the server, to pin the mechanism itself: a
  `details.<key>` URL is redacted whatever the key is named (`url` and
  `manifestUrl` both, in one line, matching `egress-proxy.ts`'s shape); a
  relative path in `details` is left alone; non-URL `details` (numbers,
  arrays, nested objects — the shape `attempts` and `retryAfterSec` take) are
  untouched. These are the direct evidence that `egress-proxy.ts`'s two sites
  are covered, in place of adding that file's first-ever logging test.

  **Fold-in considered, not taken.** No other small, already-specified piece
  of work became free here — dl-49 depends on this ticket but is a
  substantially larger removal (the login gate), not something this diff
  makes trivial, and dl-57 (which found this gap) is already merged.

  **Re-run after the fix**: both step-1 cases pass, and the pre-existing
  "known limitation" tests in the same file (nested `requestContext`, arrived
  under another name) still pass unchanged — this mechanism is a distinct
  code path from `requestContext`'s structural redaction, not a widening of
  it.

  **Gates:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts` — 40 passed (40).
  - `npm run check` — exit 0 (lint, `oxfmt --check`, `tsc --build`, all clean;
    the file's own pre-existing `no-await-in-loop` and `prefer-array-find`
    warnings are unrelated and unchanged by this diff).
  - `npm test -- --project downloader` — 85 test files, 1434 tests passed
    (1431 before this branch's three new unit tests).
  - Did not run the full repo `npm test`: no shared config
    (`vitest.config.ts`, `tsconfig*.json`, `packages/core`) was touched, only
    `tools/downloader/api/src/logger.ts` and its test.

  **Left out on purpose:** no fix or test for `main.ts:83`, reasoned above.
  No change to `registry.ts`, `direct.ts`, `ytdlp.ts` or any other
  `AppError`-construction site — the fix is entirely at the log-emission
  layer, per the sweep's "one mechanism" instruction, so those sites keep
  their unredacted `details.url` and rely on `safeFields` to catch it on the
  way out.
