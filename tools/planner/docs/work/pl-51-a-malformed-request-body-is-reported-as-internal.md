---
id: pl-51
tool: planner
title: A request whose body Fastify cannot parse is reported as `INTERNAL` 500
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# pl-51 — A malformed request body is reported as `INTERNAL`

## Why

Found while building [dl-66](../../downloader/docs/work/dl-66-a-malformed-request-body-is-reported-as-internal.md),
which fixes the identical gap in the downloader and asked that this tool be
checked (its own Build step 5). It has the same gap.

`tools/planner/api/src/http-errors.ts`'s `toErrorResponse` passes every error
straight through `AppError.from`, which turns anything that is not already an
`AppError` into `INTERNAL` — including a body Fastify's own content-type parser
rejected (empty when JSON was declared, malformed JSON, unsupported media type)
before any route handler ran. That request never touched the caller's actual
mistake; it is reported as a 500, logged at `error` in
`registerErrorHandling` (`tools/planner/api/src/server.ts`), and reads as a
server fault rather than a malformed request. `STATUS_BY_CODE` in
`http-errors.ts` is a `Partial<Record<ErrorCode, number>>` here (unlike the
downloader's exhaustive one), so an unmapped `INTERNAL` also falls back to 500
regardless — the same wrong answer twice over.

dl-66 already added `BAD_REQUEST` (400) to `@webtools/core`'s
`CORE_ERROR_CODES`/`CORE_ERROR_MESSAGES` and a
`isUnparsedClientRequestError` helper in the downloader's `http-errors.ts` —
copy the shape, not the code (the planner's `http-errors.ts` has no
`AppError`-instance-typed status table and no `web`-side
`ERROR_PRESENTATION` — `tools/planner/web` has no such file, confirmed by a
repo-wide search — so this ticket is `api`-only).

## Build

1. In `tools/planner/api/src/http-errors.ts`, add a helper that recognises an
   error carrying a numeric Fastify `statusCode` in the 4xx range and is not
   already an `AppError`, matching dl-66's `isUnparsedClientRequestError` in
   `tools/downloader/api/src/http-errors.ts`.
2. In `toErrorResponse`, map such an error to `new AppError("BAD_REQUEST",
undefined, { cause: error })` before falling through to `AppError.from`.
3. Add `BAD_REQUEST: 400` to `STATUS_BY_CODE`.

## Done when

- An `inject` of a route that accepts a JSON body, sent with `content-type:
application/json` and no body, answers 400 `BAD_REQUEST` and logs at `info`,
  not `error`.
- The same for a malformed JSON body.
- `npm run check` and `npm test -- --project planner` are green.

## Log

- 2026-09-19 — Filed from dl-66's Build step 5, which asked the downloader
  builder to check the planner for the same gap rather than fix it here (one
  tool per PR). Confirmed by reading `tools/planner/api/src/http-errors.ts`
  and `server.ts`: identical shape to the downloader's pre-fix code, same
  `AppError.from`-only path, same log-level split keyed off `status`. No
  `web`-side presentation table exists for the planner, so this ticket carries
  no `web` edit.
