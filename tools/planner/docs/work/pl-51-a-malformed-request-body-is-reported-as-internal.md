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
`isClientRequestStatusError` helper in the downloader's `http-errors.ts` —
copy the shape, not the code (the planner's `http-errors.ts` has no
`AppError`-instance-typed status table and no `web`-side
`ERROR_PRESENTATION` — `tools/planner/web` has no such file, confirmed by a
repo-wide search — so this ticket is `api`-only).

## Build

1. In `tools/planner/api/src/http-errors.ts`, add a helper that recognises an
   error carrying a numeric Fastify `statusCode` in the 4xx range and is not
   already an `AppError`, matching dl-66's `isClientRequestStatusError` in
   `tools/downloader/api/src/http-errors.ts`. **Copy dl-66's decision A** on
   how wide that rule reaches (its `## The width decision`): do not narrow it
   to Fastify's own `FST_ERR_CTP_*` family here either, even though the
   planner has no `@fastify/static`-shaped second source measured yet — the
   owner's answer was about the rule's shape, not about what the downloader
   happens to have mounted, and a planner-specific narrowing would be a second,
   unresolved question this ticket does not need to open.
2. In `toErrorResponse`, map such an error to `new AppError("BAD_REQUEST",
undefined, { cause: error })` before falling through to `AppError.from`.
3. Add `BAD_REQUEST: 400` to `STATUS_BY_CODE`.
4. **dl-66's own review gate found a second bug of the same shape and fixed
   it there — repeat the fix here rather than rediscovering it.**
   `tools/planner/api/src/server.ts:335`'s `registerErrorHandling` computes
   its own `const appError = AppError.from(error);` for the fields it logs,
   separately from the `AppError` `toErrorResponse` builds for the response.
   Left alone, a widened `BAD_REQUEST` would reach the client while the log
   still said `INTERNAL` for the identical request — the same failure this
   ticket's `Why` describes, just moved from the response to the log line.
   Have `toErrorResponse` return the `AppError` it built (`{ status, body,
appError }`) and read `server.ts`'s copy from that instead of calling
   `AppError.from` a second time — see dl-66's `http-errors.ts` and
   `server.ts` for the worked pattern.

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
- 2026-09-19 — dl-66's review gate measured this ticket directly rather than
  taking "confirmed by reading" on faith, and found the filing under-evidenced
  (a real gap, just not reproduced). Reproduction, at dl-66's `43d2e5e` (before
  its own gate fixes, which do not touch the planner): `POST /api/intakes`
  with `content-type: application/json` and no body answers 500
  `{"error":{"code":"INTERNAL",...}}`, logged `error`/`request
failed`/`code=INTERNAL`. Malformed JSON on `POST /api/plans` does the same.
  Separately, `toErrorResponse(new AppError("BAD_REQUEST"))` in the planner
  today answers **500** with code `BAD_REQUEST`, because `STATUS_BY_CODE`'s
  `Partial` table falls back to 500 for anything unmapped — the core code
  already exists there unmapped (inherited from `@webtools/core` the moment
  dl-66 lands), though nothing in the planner raises it yet, which is exactly
  the gap this ticket's Build step 3 closes. Added Build step 4 for the
  log-code bug dl-66's own gate found and fixed in the downloader, so this
  ticket does not repeat it.
- 2026-09-19 — Reproduced the reviewer's measurement independently rather than
  transcribing it: copied the reviewer's own probe
  (`.../scratchpad/dl-66-gate/planner-probe.test.ts`) into
  `tools/planner/api/test/`, ran it against the unmodified planner tree
  (`npx vitest run`, `GATE_OUT=<file>`), and got the same three findings —
  `POST /api/intakes` with an empty declared-JSON body and `POST /api/plans`
  with a malformed one both answer `500
{"error":{"code":"INTERNAL","message":"Something went wrong on our
end.","retryable":false}}`, logged `error/request failed/code=INTERNAL`; and
  `toErrorResponse(new AppError("BAD_REQUEST"))` called directly answers `500
{"error":{"code":"BAD_REQUEST","message":"The request could not be
understood.","retryable":false}}` (the `STATUS_BY_CODE` `Partial`'s
  fallback). Deleted the probe file afterward; it is not part of this
  ticket's own test suite. dl-66's width decision (A: keep the rule as
  written) is copied into this ticket's Build step 1 rather than re-decided
  here.
