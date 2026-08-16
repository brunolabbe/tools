---
id: dl-17
tool: downloader
title: Answer an unknown endpoint with NOT_FOUND, not JOB_NOT_FOUND
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-17 — An unknown URL is not a missing job

**Packages:** `api`, and one line of `web`.

## Why

`registerNotFoundHandler` in `api/src/server.ts` raises `JOB_NOT_FOUND` with the
message "No such endpoint." for any URL that matches no route. A code about a
missing _document_ is being re-worded to describe a missing _route_, and the
re-wording is the tell: if the copy has to be replaced at the call site, the code
is the wrong one.

It matters more than a typo. `JOB_NOT_FOUND` is a code the UI presents as "the
server has no record of this download", offers no retry for, and a client can
reasonably act on by dropping a job it is polling. A typo'd URL that answers with
it tells a client something false about a job that is fine.

The planner had the identical bug with `CONVERSATION_NOT_FOUND`, which is how
`NOT_FOUND` came to exist: two tools independently reached for their nearest
domain code, which is the repo's rule for lifting met exactly.
[pl-11](../../../planner/docs/work/pl-11-retire-the-conversation-vocabulary.md)
added it to `CORE_ERROR_CODES` and fixed the planner's half; this ticket is the
downloader's, deliberately left out of it because a planner ticket must not reach
into another tool.

## Build

1. **`NOT_FOUND` already exists** in `@webtools/core` and is already mapped to
   404 in `api/src/http-errors.ts`, with a comment pointing at this ticket. The
   copy in `web/src/lib/error-presentation.ts` exists too. Nothing to add.
2. **Raise it** in `registerNotFoundHandler`, with no message argument, so the
   catalog's copy is used. Drop the `"No such endpoint."` override — the catalog's
   message is already about a route, which is the whole reason the code was added.
   The `details.path` slice stays.
3. **Assert it.** `api/test/` has an unknown-path test asserting
   `JOB_NOT_FOUND`; it says `NOT_FOUND` instead. The SPA fallback's behaviour is
   unchanged — an unknown path still gets `index.html` when the web bundle is
   served and a typed error when it is not.

## Done when

- `GET /api/nope` answers 404 with `NOT_FOUND`, and a real missing job still
  answers `JOB_NOT_FOUND`.
- The mock's `every ErrorCode is demonstrable` test in
  `web/test/mock-api.test.ts` still passes. `NOT_FOUND` sits in its
  `notReachableInTheMock` list, and it stays there: the mock answers the routes
  it implements, so a route miss is not something it can produce.
- `npm run check` and `npm test -- --project downloader` are green.

## Traps

**Do not remove `JOB_NOT_FOUND`.** It is correct and load-bearing for its actual
meaning — a job id the server has no record of, which the UI presents as such.
Only the unknown-route call site is wrong.

## Log

_Not started._
