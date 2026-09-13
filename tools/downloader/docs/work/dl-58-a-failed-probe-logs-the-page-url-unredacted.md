---
id: dl-58
tool: downloader
title: A failed probe logs the page URL with its query string, credentials included
kind: fix
status: ready
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

- `resolvers/src/registry.ts:105` "details: { url: url.href, attempts },"
  — sets the page URL, query string included, as the `NO_MEDIA_FOUND` error's
  `details`.
- `downloader/api/src/server.ts:600` "details: appError.details," — is how
  the error handler copies those `details` into the `request rejected` line
  as they are. The `url` field beside it goes through `redactLoggedUrl`, and
  `details` does not.
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
