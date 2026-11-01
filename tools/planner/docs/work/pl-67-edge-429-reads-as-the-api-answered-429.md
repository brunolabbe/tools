---
id: pl-67
tool: planner
title: An edge 429 reads as "The API answered 429." instead of a rate limit
kind: fix
status: done
milestone: null
depends_on: []
---

# pl-67 — An edge 429 reads as "The API answered 429."

## Why

Cloudflare's WAF rate limiting rule on `/api/` (`docs/02-DEPLOYMENT.md`, "The
edge rate limit on `/api/`") answers with an HTML page. On the Free plan the rule
allows 20 requests per 10 seconds per IP address, and every tool in the zone shares
that budget. `web/src/api/client.ts` could not parse the HTML body, so it showed
"The API answered 429." instead of saying the request was rate limited.

The ledger shows the rule tripping in production (lg-97, PR #736). lg-97's gate
found this same code path here, and the owner chose, on 2026-11-01, to fix it now,
in a pull request of its own. The downloader's fix is dl-136 (PR #737). The
planner's own refusal already has a parseable body and is unaffected. The planner's
request count is still unmeasured.

## Build

In `requestJson`, a 429 whose body does not parse is thrown as `RATE_LIMITED`,
with the catalogue's message. When the response sends `Retry-After`, its seconds
go into `details.retryAfterSec`. Any other status with no parseable body still
reads "The API answered N.".

## Done when

- An edge 429 (HTML body) is an `AppError` with code `RATE_LIMITED`, whose message
  is "Too many requests. Try again shortly.", carrying the `Retry-After` seconds when
  the header is sent and no wait when it is not.
- A 502 with no parseable body still reads "The API answered 502.".

## Log

**2026-11-01.** Built. The tests are in `web/test/client.test.ts`, the planner's
first test of its client. The two 429 tests are red against `main`'s `client.ts`
(2 failed, 1 passed) and green with the change.

lg-97's gate was the review for this change, which repeats lg-97's ten lines.
