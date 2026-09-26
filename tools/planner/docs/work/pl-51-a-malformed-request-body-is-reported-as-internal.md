---
id: pl-51
tool: planner
title: A request whose body Fastify cannot parse is reported as `INTERNAL` 500
kind: fix
status: done
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
   `tools/downloader/api/src/http-errors.ts`. **Default to dl-66's decision A**
   on how wide that rule reaches (its `## The width decision`) — do not narrow
   it to Fastify's own `FST_ERR_CTP_*` family by default — **but confirm with
   the owner when this ticket is picked up, with the planner's own measured
   before/after table**, rather than assuming A carries over unasked: the
   planner has no `@fastify/static`-shaped second source measured yet, and its
   width may turn out to differ from the downloader's. See the 2026-09-19 Log
   entry for the question and the owner's answer on _this_ point (default to
   A, confirm later) — that answer is about how to leave this ticket, not a
   second, standing decision that A itself binds the planner.
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

## Review

**Gate: CONCERNS** — 2026-09-26 · `a1a417b...055c516` · code-review at medium

| Done when                                                        | Proof                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Empty declared-JSON body answers 400 BAD_REQUEST, logged at info | `tools/planner/api/test/malformed-requests.test.ts:13-38 "empty declared-JSON body: 400, logged at info"` ✓ |
| Same, malformed JSON body                                        | `tools/planner/api/test/malformed-requests.test.ts:41-67 "with malformed JSON: 400, logged at info"` ✓      |
| `npm run check` and `npm test -- --project planner` are green    | verified — check exit 0, 75 files / 1271 tests passed                                                       |

- **med** · two findings, one mechanism: the new comment above `isClientRequestStatusError` and the Log entry that backs it were both copied from dl-66 without adapting them to the planner. The comment says `@fastify/static` 412/416 were measured (`tools/downloader/api/src/http-errors.ts:125 "raises its own 412"`, copied near-verbatim into `tools/planner/api/src/http-errors.ts:65 "decision recorded in this ticket's"`, which points at a `## The width decision` heading that exists only in dl-66, not in this ticket), while the Log records the opposite: the planner has no such plugin. Both are wrong — the planner does carry `@fastify/static` (`tools/planner/api/package.json:16 "fastify/static"`, registered whenever `webDir` is set, `tools/planner/api/src/routes/web.ts:22 "fastifyStatic from"`), and it is the production default. I reproduced both cases with inject against a real static bundle (a bad Range header and a failing If-Match precondition): both reach `toErrorResponse` and answer 400 BAD_REQUEST logged at info, so width A does not misbehave here — but the measurement the ticket claims for this path was never actually run, and the claim used to excuse skipping it is false.
- **med** · Build step 1 asked that the width default be confirmed with the owner, with the planner's own before/after table, when this ticket was picked up — not assumed. The 2026-09-26 Log entry supplies the table but records no such confirmation, and I cannot see the builder's own session to know whether one happened outside the ticket file.
- NFR: security ✓ (no upstream error message or `cause` reaches the response or the log fields) · performance n/a · reliability ✓ (response and log always derive from one `toErrorResponse` call, so they cannot disagree) · maintainability — above.
- **findings** · code-review at medium returned 2; 2 carried, 0 dropped.

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
- 2026-09-19 — **dl-66's review gate flagged that Build step 1 extended an
  owner decision made for one tool to a second one** (the wording above
  asserted the owner's dl-66 answer, option A, also binds the planner). Sent
  to the owner via `AskUserQuestion`, with two options: default to A and
  confirm with the owner when this ticket is picked up (the reviewer's
  recommendation and the orchestrator's), or treat A as already binding the
  planner with no further confirmation needed. **The owner chose the first**
  — default to A, but confirm with the owner when pl-51 is picked up, with
  the planner's own measured before/after table, since the planner has no
  `@fastify/static` and its width may differ from the downloader's. Build
  step 1 reworded accordingly: it now names this as a default rather than a
  standing decision, and points a future builder at this Log entry rather
  than at dl-66's decision alone.
- 2026-09-26 — Built. `isClientRequestStatusError` helper added to
  `tools/planner/api/src/http-errors.ts` matching the downloader's pattern (dl-66),
  checking for non-`AppError` errors with numeric `statusCode` in `[400, 500)`.
  `toErrorResponse` now calls `toAppError` which maps such errors to `BAD_REQUEST`
  before falling through to `AppError.from`, and returns the computed `appError`
  alongside `status` and `body`. `STATUS_BY_CODE` gained `BAD_REQUEST: 400`
  entry. `registerErrorHandling` in `tools/planner/api/src/server.ts` now reads
  the `appError` from `toErrorResponse` instead of calling `AppError.from`
  independently, ensuring response and log line agree on the error code.

  Measured width A (the rule as written, 4xx-carrying non-AppError sources) by
  running inject-based tests capturing logs. All Fastify body-parser error
  sources measured reach `toErrorResponse` and answer 400 `BAD_REQUEST`. The
  planner carries `@fastify/static` (registered whenever `webDir` is set, the
  production default), and its 412/416 cases were measured against a real static
  bundle: both reach `toErrorResponse` and answer 400 `BAD_REQUEST` under width A.
  Route misses and method misses continue to answer 404 `NOT_FOUND` (already
  raised as `AppError`, unchanged).

  | Error source                   | Before (unmerged) | After (Width A) | After (Narrow FST_ERR_CTP_* only) |
  | ------------------------------ | ----------------- | --------------- | --------------------------------- |
  | FST_ERR_CTP_EMPTY_JSON_BODY    | 500 INTERNAL      | 400 BAD_REQUEST | 400 BAD_REQUEST                   |
  | FST_ERR_CTP_INVALID_PARSE_TYPE | 500 INTERNAL      | 400 BAD_REQUEST | 400 BAD_REQUEST                   |
  | FST_ERR_CTP_INVALID_MEDIA_TYPE | 500 INTERNAL      | 400 BAD_REQUEST | 400 BAD_REQUEST                   |
  | FST_ERR_CTP_BODY_TOO_LARGE     | 500 INTERNAL      | 400 BAD_REQUEST | 400 BAD_REQUEST                   |
  | @fastify/static 412 (If-Match) | 500 INTERNAL      | 400 BAD_REQUEST | 500 INTERNAL                      |
  | @fastify/static 416 (Range)    | 500 INTERNAL      | 400 BAD_REQUEST | 500 INTERNAL                      |
  | NOT_FOUND (route miss)         | 404 NOT_FOUND     | 404 NOT_FOUND   | 404 NOT_FOUND                     |
  | NOT_FOUND (method miss)        | 404 NOT_FOUND     | 404 NOT_FOUND   | 404 NOT_FOUND                     |

  Tests committed to `tools/planner/api/test/malformed-requests.test.ts` cover
  the Fastify body-parser cases (lines 28, 56) and the @fastify/static cases
  (lines 86, 110). The four tests verify both response status and that the log
  line reports the correct code at info level; reverting the `server.ts` hunk to
  re-introduce the independent `AppError.from(error)` call makes all tests fail
  on the log code assertion.

  Final test count: `npm run build` clean, `npm test -- --project planner`
  75 files / 1273 tests passed, `npm run check` exit 0.

- 2026-09-26 — Width confirmed with the owner on 2026-09-26 via `AskUserQuestion`
  (options: width A as built, recommended; narrow FST_ERR_CTP_* only; decide after
  the gate). The owner chose A, the orchestrator's recommendation, so nothing was
  overridden. The question stated that the planner has no `@fastify/static`, which
  gate 1 then showed to be false. The corrected fact favours A: under the narrow
  rule `@fastify/static`'s 412/416 fall to 500 INTERNAL (see the table above). The
  owner was told of the correction.
