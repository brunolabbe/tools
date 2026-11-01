---
id: dl-136
tool: downloader
title: An edge 429 reads as INTERNAL instead of a rate limit
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-136 — An edge 429 reads as INTERNAL

## Why

Cloudflare's WAF rate limiting rule on `/api/` (`docs/02-DEPLOYMENT.md`, "The
edge rate limit on `/api/`") answers with an HTML page. On the Free plan the rule
allows 20 requests per 10 seconds per IP address, and every tool in the zone shares
that budget. `web/src/api/http.ts` could not parse the HTML body, so it threw
`INTERNAL`, which tells the visitor "Something went wrong on our end". That is
wrong about whose end, and it says nothing about waiting.

The ledger shows this happening in production. One ledger tab switch costs 2 to 11
`/api/` requests, and lg-97 has the per-tab counts. The ledger fix is lg-97 (PR
#736). The lg-97 gate found the planner's identical branch, and the owner chose,
on 2026-11-01, to fix all three tools now, in a pull request each. The downloader's
own refusal (`api/src/rate-limit.ts`) already has a parseable body and is
unaffected.

## Build

In `createHttpClient`'s `request`, a 429 whose body does not parse is thrown as
`RATE_LIMITED`, with the catalogue's message. When the response sends
`Retry-After`, its seconds go into `details.retryAfterSec`. Any other status with
no parseable body stays `INTERNAL`, with `details.status`.

## Done when

- An edge 429 (HTML body) is an `AppError` with code `RATE_LIMITED`, carrying the
  `Retry-After` seconds when the header is sent and no wait when it is not.
- A 502 with no parseable body is still `INTERNAL`, with `details.status` 502.

## Log

**2026-11-01.** Built. The tests are the three at the end of
`web/test/http-client.test.ts`. The two 429 tests are red against `main`'s `http.ts`
(2 failed, 4 passed) and green with the change. The 502 test is a regression guard
and passes on both.

lg-97's gate was the review for this change, which repeats lg-97's ten lines. It
found the same branch in the planner, and pl-67 fixes that.
