---
id: lg-97
tool: ledger
title: An edge 429 reads as "The API answered 429." instead of a rate limit
kind: fix
status: done
milestone: null
depends_on: []
---

# lg-97 — An edge 429 reads as "The API answered 429."

## Why

The owner often sees "The API answered 429." on the production ledger (reported
2026-11-01, screenshot on the Rules tab). The ledger did not send that 429. Its own
refusal (`api/src/rate-limit.ts`) has a body in the error taxonomy, and
`web/src/api/client.ts` shows it as "Too many requests. Try again shortly.". A
429 whose body the client cannot parse comes from in front of the API. That is
Cloudflare's WAF rate limiting rule on `/api/`
(`docs/02-DEPLOYMENT.md`, "The edge rate limit on `/api/`"). On the Free plan the
rule allows 20 requests per 10 seconds per IP address, and every tool in the zone
shares that budget. When the rule trips, it returns an HTML page.

The ledger trips it in ordinary use. Read from the fetches each screen makes when
it opens, on `main` at `83eac952`, one tab switch costs between 3 and 8 `/api/`
requests. The screen itself makes between 1 and 6, and the shell adds 2: the inbox
count and the people's names, both asked again on every tab change
(`web/src/App.tsx`). Opening three screens in quick succession reaches about 20.
Everyone in the household on the same home connection shares the one budget.

## Build

In `requestJson`, a 429 whose body does not parse is thrown as `RATE_LIMITED`,
with the catalogue's message. When the response sends `Retry-After`, its seconds
go into `details.retryAfterSec`, as lg-92 does for the ledger's own refusal. Any
other status with no parseable body still reads "The API answered N.".

## Done when

- An edge 429 (HTML body) is an `AppError` with code `RATE_LIMITED`, whose message
  is "Too many requests. Try again shortly.", carrying the `Retry-After` seconds when
  the header is sent and no wait when it is not.
- A 502 with no parseable body still reads "The API answered 502.".

## Log

**2026-11-01.** Built. The tests are in `web/test/client-retry-after.test.ts`: the
three tests at the end of the file, one for each case in "Done when".

The 429s themselves stop in two other places, and this ticket fixes neither:

- **The WAF threshold.** The owner raises it at the dashboard. On Free, only the
  count can change, not the 10-second period. `docs/02-DEPLOYMENT.md` now records the
  ledger's measured counts in place of the note that they had not been measured.
- **The ledger's request count.** lg-98 adopts TanStack Query. The owner chose it,
  on 2026-11-01, over an in-house cache in `client.ts` that the library would have
  replaced later.
