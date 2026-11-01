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

The ledger trips it in ordinary use. Counted by rendering the shell over a stubbed
`fetch` on this branch (the gate's probe), one tab switch costs between 2 and 11
`/api/` GETs: the screen's own 0 to 9, plus the shell's 2, which are the inbox
count and the people's names, asked again on every tab change (`web/src/App.tsx`).
Stats is 11 (9 with no mortgage), Period 8, Salaries 7, Inbox 6, History, Receipt,
Rules and Categories 5, Home 4, Household 3, Paste and Import 2. Opening Stats and
Period in quick succession already reaches 19.
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

## Review

**Gate: CONCERNS** — 2026-11-01 · `83eac952..7dec916a` · Sonnet 5.5, depth medium

| Done when                                                                                                                               | Proof                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An edge 429 (HTML body) is `RATE_LIMITED` with the catalogue's message, carrying `Retry-After`'s seconds when sent and no wait when not | `web/test/client-retry-after.test.ts` › "an edge 429 with no body of ours reads as RATE_LIMITED, with the header's wait (lg-97)" and › "an edge 429 with no header carries no wait (lg-97)" ✓. Both are red against `main`'s `client.ts` |
| A 502 with no parseable body still reads "The API answered 502."                                                                        | Same file › "another status with no body of ours still names the status (lg-97)" ✓. It is a regression guard and passes on `main` too                                                                                                    |

- **med** · no `Done when` line depends on it · **the per-tab request counts were wrong**, in three places. lg-97's Why, `docs/02-DEPLOYMENT.md` and lg-98's Why all said 3 to 8, from a static read. The gate rendered `<App/>` over a stubbed `fetch` and counted 2 to 11, with Stats at 11. **Fixed** in all three, and lg-97's Why now lists each tab's count.
- **med** · lg-98's Done when 2 depends on it · **lg-98's Build 3 and Build 4 contradicted each other for people.** Build 3 gave every call to one route one cache entry, but Build 4 kept the `fetch*` functions as they are. `fetchPeople` and `fetchPeopleNames` return different shapes from the one `ROUTES.people` URL, so one key would hand a caller the other's data, and nothing would catch it. **Fixed**: Build 3 now caches the whole response, and each caller takes what it needs with `select`. Build 4 names the exception.
- **low** · **lg-98's smaller counts were off.** The fetch calls are 42 in 23 effects, not about 41. People is asked from six call sites on five tabs. Of the 25 web test files, 19 mock an `api/` module. **Fixed** in lg-98.
- **low** · shape-level, in another tool · **the planner has the same branch.** `tools/planner/web/src/api/client.ts` also shows "The API answered N." for a body it cannot parse, and the planner shares the same edge budget. Fixed in pl-67 (#738), with the downloader in dl-136 (#737); see the Log.
- **dropped (4)** · **behaviours the gate checked and found correct.** `Queue.tsx` now waits out an edge 429, which is lg-92's path and is safe, because a WAF block answers before the origin. An HTTP-date `Retry-After` reads as no wait, as it did before. The present-tense "lg-98 cuts" sentence in the deployment doc misleads no one. Computing `wait` before the parse is harmless.
- **findings** · the hunt returned 8; 4 carried, 4 dropped.
- **NFR** · security ✓ · reliability ✓ · performance: not applicable to this change (lg-98).

## Log

**2026-11-01.** Built. The tests are in `web/test/client-retry-after.test.ts`: the
three tests at the end of the file, one for each case in "Done when".

The 429s themselves stop in two other places, and this ticket fixes neither:

- **The WAF threshold.** The owner raises it at the dashboard. On Free, only the
  count can change, not the 10-second period. `docs/02-DEPLOYMENT.md` now records the
  ledger's counted requests in place of the note that they had not been measured.
- **The ledger's request count.** lg-98 adopts TanStack Query. The owner chose it,
  on 2026-11-01, over an in-house cache in `client.ts` that the library would have
  replaced later.

**2026-11-01, after gate 1.** Both mediums and the counts are fixed (see Review).
The planner had the same branch, and the owner added that the downloader might
too. It did: the downloader showed an edge 429 as `INTERNAL`. The owner chose to
fix both now, each in its own pull request: pl-67 (#738) and dl-136 (#737).
