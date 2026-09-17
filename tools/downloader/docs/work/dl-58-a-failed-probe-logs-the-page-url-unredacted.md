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
- **Widened by the owner's decision on D1/D2, 2026-09-17**: scope is not
  limited to `details` or to the page URL a failed probe was working on. Every
  string value in a log line is covered — a top-level field such as
  `egress-proxy.ts`'s `host` (H1), a URL embedded mid-sentence rather than
  being the whole of a field's value (H2), and the success-path `Referer` that
  reaches `probe complete` on a probe that _succeeded_ (H3, not only a failed
  one — the ticket's title undersells its own step 2, which already said
  "every log call passing a URL"). Each of H1, H2 and H3 has its own test,
  red at the gate's commit (`b63d8c6`)'s logger and green after.
- `npm run check`, `npm test -- --project downloader` and
  `node scripts/citations-gate.mjs --against origin/main` are green.

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
    `resolvers/src/browser/classify.ts:140,240,245` (all three paths of
    `classifyFailure`/`classifyNavigationError`; `:135` in an earlier draft of
    this Log pointed at a closing brace, not the `redactUrl` call).
  - Unredacted, feeding an `AppError.details.url` that a caller may log
    verbatim: `resolvers/src/registry.ts:75,136`;
    `resolvers/src/resolvers/direct.ts:109,175,210,343,349,383`;
    `resolvers/src/resolvers/ytdlp.ts:276,290,906`. (`engine/src/**` has no
    such site — checked by grep, none found.)
  - Manifest parsers (`resolvers/src/manifest/hls.ts:325`,
    `resolvers/src/manifest/dash.ts:361,368`), `browser/drm.ts:134` and
    `browser/pool.ts:224,321` (both throws, neither carrying `details` with a
    URL in it at all — `:224` has no `details` object at all) — not sites.

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
  - `npm test -- --project downloader` — 85 test files, 1434 tests passed.
    The branch adds 5 `test(` blocks to `logging.test.ts` (2 server-level, 3
    unit-level), so the base count is 1429 — corrected from an earlier draft
    of this Log, which undercounted the added tests as three and the base as 1431.
  - Did not run the full repo `npm test`: no shared config
    (`vitest.config.ts`, `tsconfig*.json`, `packages/core`) was touched, only
    `tools/downloader/api/src/logger.ts` and its test.

  **Left out on purpose:** no fix or test for `main.ts:83`, reasoned above.
  No change to `registry.ts`, `direct.ts`, `ytdlp.ts` or any other
  `AppError`-construction site — the fix is entirely at the log-emission
  layer, per the sweep's "one mechanism" instruction, so those sites keep
  their unredacted `details.url` and rely on `safeFields` to catch it on the
  way out.

- 2026-09-17 — Gate at `b63d8c6`: **FAIL**, three highs (see `## Review`
  below once committed). The sweep in the entry above missed three live
  leaks; all three reproduced independently, against the same commit:

  **H1 confirmed** — `egress-proxy.ts`'s `refused`/`upstreamRefused` log a
  top-level `host` field carrying the full absolute-form target URL,
  unredacted; `redactDetailsUrls` only ever looks inside `details`, on the
  same line, so it never touches `host`. Reproduced with a real
  `startEgressProxy` + `createLogger` (dist build), a blocked-address target:
  `"host":"http://blocked.test/seg.ts?sig=SECRET_BLOCKED"` beside a correctly
  redacted `details.url`.

  **H2 confirmed** — `ytdlp.ts`'s `classifyFailure` puts raw yt-dlp stderr in
  `details.stderr`, and yt-dlp echoes the target URL mid-sentence
  (`ERROR: Unsupported URL: …`). `redactDetailsUrls` only redacts a string
  that parses _whole_ as a URL, so an embedded one in free text passes
  through. Reproduced with the real yt-dlp 2025.09.26 binary and a real
  `YtDlpResolver` against a local no-media page whose path happened to
  contain "drm" (a terminal marker in `classifyFailure`, so the error reaches
  `request rejected` rather than falling through): the resulting
  `details.stderr` carried the signed URL unredacted.

  **H3 confirmed, and worse than first measured** — `probe.ts`'s
  `requestContext: probe.requestContext` at `info`, on every successful
  probe, logs a `Referer` header that `redactRequestContext` (via
  `redactHeaders`) does not touch — that redactor is a header-name denylist
  (cookie, authorization, …), and `Referer` is deliberately not on it (it is
  needed for replay). Two distinct sources both carry the full signed page
  URL into that header, both measured directly rather than assumed:

  1. `resolvers/src/browser/request-context.ts:65`'s `??= input.pageUrl`
     fills `Referer` with the full page URL when the capture had none.
     Reproduced with the real `buildRequestContext` and `createLogger`.
  2. **Chromium's own captured `Referer`, in the ordinary case where the
     capture is _not_ empty, carries the same thing.** Verified live rather
     than left as a documented default: launched real headless Chromium via
     Playwright in this sandbox, served a same-origin page at
     `http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE` whose only
     sub-resource was `<video src="/media/v.mp4?sig=SECRET_MEDIA">`,
     navigated to it, and logged the raw request headers the browser sent
     for the media fetch. The captured header was
     `"referer":"http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE"` — the
     full page URL, query string included, under Chromium's default
     referrer policy with no override anywhere in this codebase's browser
     launch options. So this is not an edge case gated on a missing capture;
     it is what Chromium sends by default for the common same-origin case.

     Server (`node`, this repo has no bundled static-file server, so a
     three-route `http.createServer` stood in for one):

     ```js
     import http from "node:http";
     const server = http.createServer((req, res) => {
       if (req.url?.startsWith("/watch")) {
         res.writeHead(200, { "Content-Type": "text/html" });
         res.end(
           `<html><body><video src="/media/v.mp4?sig=SECRET_MEDIA" controls></video></body></html>`,
         );
         return;
       }
       if (req.url?.startsWith("/media/")) {
         console.log("MEDIA REQUEST HEADERS", JSON.stringify(req.headers));
         res.writeHead(200, { "Content-Type": "video/mp4" });
         res.end("fake-bytes");
         return;
       }
       res.writeHead(404);
       res.end();
     });
     server.listen(18099, "127.0.0.1", () => console.log("listening"));
     ```

     Browser, run from `tools/downloader/resolvers` (so the bare `playwright`
     import resolves) with the server above already running:

     ```
     node --input-type=module -e "
     import { chromium } from 'playwright';
     const browser = await chromium.launch();
     const page = await browser.newPage();
     await page.goto('http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE');
     await page.waitForTimeout(500);
     await browser.close();
     "
     ```

     The server's stdout is the evidence: the `MEDIA REQUEST HEADERS` line
     for the video request carries `"referer":"http://127.0.0.1:18099/watch?v=1&sig=SECRET_PAGE"`.

  **L1, L2 confirmed and corrected above** (citations re-resolved again —
  `safeFields` moved to `logger.ts:150`; `classify.ts:135` was a closing
  brace, the real `redactUrl` call is `:140`; `pool.ts:224` has no `details`
  object at all; the diff adds 5 `test(` blocks, not 3, so the base count is
  1429, not 1431).

  Waiting on the owner's decision (via the orchestrator) on D1 (remedy shape:
  one text-matching mechanism in the logger vs. fixing each source) and D2
  (whether H3 is in this ticket's scope or its own) before building the
  repair. The repair earns its own gate, on the new commit, with a red run
  per high.

- 2026-09-17 — Owner's decisions, relayed by the orchestrator (each option
  framed by the reviewer, `a9a05d05c8083a85d`, with its recommendation
  marked; the owner took the recommended option every time):
  - **D1: (a).** The logger redacts a URL substring in every string field
    value, wherever it appears — not just `details`, and not just a value
    that is a whole URL — including the output of `redactRequestContext`.
    Reuse `engine/src/ffmpeg/runner.ts`'s existing `redactUrlsInText` matcher
    rather than a third implementation. It stayed inside `@downloader/engine`
    (exported through that package's own index, dl-58's `api` already
    depends on it) — not a cross-tool import and not a lift into
    `packages/core`, so the "tell me first" branch of the decision did not
    apply. Accepted cost: a walk of every field on every log line, and every
    URL anywhere in a line loses its query string, including ones that
    carried nothing secret.
  - **D2: fix H3 in this ticket.** Not filed separately — it gets the same
    red-then-green treatment as H1 and H2, using the builder's own Chromium
    measurement as evidence that both of H3's sources (the resolver's `??=`
    fallback and Chromium's own captured same-origin `Referer`) produce the
    identical shape the fix has to catch.
  - **Q3: filed, not fixed here.** yt-dlp's `classifyFailure` matching a
    source-fact marker against its own echoed URL (H2's other half — the
    reproduction is the same shape, the defect is different: dl-58 is about
    what reaches the _log_, this is about what reaches the _client and the
    retry policy_) is
    [dl-67](./dl-67-yt-dlp-misclassifies-a-no-media-page-as-drm.md), carrying
    the same real-yt-dlp reproduction as its evidence.

  **Scope widened past the ticket's own title.** "A failed probe logs the page
  URL unredacted" undersold what step 2 already asked for ("every log call
  passing a URL field") — H3 is a _successful_ probe's log line, not a failed
  one, and the fix now covers it in the same branch. The Done-when section
  above is updated to say so; the title and Why section are left as filed,
  since they are the record of what was first found, not a moving target.

  **Implementation.** Replaced the `details`-only `redactDetailsUrls` with
  `redactUrlsDeep` in `logger.ts`: a recursive walk (cycle-safe via a
  `WeakSet`, matching the existing "logging must never crash" contract — a
  throw inside it is still caught by `emit`'s own `try`/`catch`, unchanged)
  over every string in the whole `fields` object, applying
  `redactUrlsInText` — exported from `@downloader/engine`'s index for this —
  to each one. Runs _after_ the structural `requestContext` credential wipe,
  so a `Referer` that wipe deliberately leaves alone still loses its query
  string here. `safeFields`'s "known limitation: top level only" docstring is
  narrowed to describe only the structural pass now — it was never accurate
  for the URL pass, which has always walked everything the deep function
  reaches (the pinned "known limitation" tests are about credential-shaped
  strings, which the URL pass was never going to catch, so they are
  unaffected and still pass unchanged).

  **Tests, each red at `b63d8c6`'s logger and green after** (verified by
  reverting only the source — `git stash`, restore just the test file from
  the stash, run, then reapply the full stash — never by reverting the test):
  - H1: `api/test/egress-proxy.test.ts`, new describe block at the file's
    end (this file carries pinned citations from dl-29 and repo-13 into its
    existing lines, so nothing above it moved), using a **real**
    `createLogger` rather than the file's existing `recordingLogger`/
    `NOOP_LOGGER` helpers — neither of those goes through `safeFields`, so
    neither would have caught this, which is exactly why the first gate's
    sweep missed it: `host` never reaches a real logger in this file's
    existing coverage. Red: 1 failed. Green: 1 passed.
  - H2: `api/test/logging.test.ts`, a unit test against `safeFields` with the
    exact shape `ytdlp.ts`'s `classifyFailure` produces (a URL embedded
    mid-sentence in `details.stderr`, alongside a whole-string
    `details.url`). Red: 1 failed. Green: 1 passed.
  - H1 also gets a unit-level companion in the same file (a top-level field
    outside `details` carrying a full URL), and H3 gets a server-level test
    using `probeResult({ requestContext: { headers: { Referer: signedUrl } } })`
    through `POST /api/probe` via `StubResolver` — the same shape whether the
    Referer came from the resolver's fallback or from a real browser capture,
    so one test covers both sources. Red: 3 failed together (this test, the
    H2 unit test, and the H1 unit companion). Green: all pass.
  - Command for all three, red then green:
    `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`.

  **dl-67 filed** for Q3, with the real-yt-dlp-2025.09.26 reproduction as its
  evidence (commands and output reproduced in its own Why section). Not
  fixed — the owner's instruction was to record the defect only.

  **A first pass at this round broke citations-gate**, caught by running it
  rather than assuming a small edit was safe: adding
  `import { redactUrlsInText } from "@downloader/engine";` as its own new line
  in `egress-proxy.test.ts`, and a few extra docstring lines to
  `redactUrlsInText` itself in `engine/src/ffmpeg/runner.ts`, shifted every
  line below each insertion by one (or more), which moved 10 of repo-13's
  pinned citations into `egress-proxy.test.ts` and 3 of repo-34's plus one of
  dl-19's into `runner.ts` off their anchors. Fixed by merging the new import
  onto the existing `AppLogger` import line
  (`import { createLogger, type AppLogger } from "../src/logger.ts";` — one
  line in, one line out, matching the inline-type-import style already used
  at `api/src/rate-limit.ts:18`) and by reverting the `runner.ts` docstring
  addition entirely, so that file is now byte-identical to `origin/main`
  (`git diff origin/main -- tools/downloader/engine/src/ffmpeg/runner.ts`
  produces no output) and the reuse note lives only in `logger.ts`'s own
  docstring instead.

  **Gates, at the final state:**
  - `npx vitest run tools/downloader/api/test/logging.test.ts tools/downloader/api/test/egress-proxy.test.ts`
    — 81 passed (43 + 38).
  - `npm run check` — exit 0.
  - `npm test -- --project downloader` — 85 test files, 1438 passed (1434
    before this round's 4 new tests — 3 in `logging.test.ts`, 1 in
    `egress-proxy.test.ts`).
  - `node scripts/citations-gate.mjs --against origin/main` — 84 enforced, 0
    failing; 7 grandfathered, 2 unresolvable, 21 unanchored; 7 entries
    compared against `origin/main`, 0 raised.
  - `dl-67` (filed for Q3): `npm run status -- --show dl-67` parses cleanly.
