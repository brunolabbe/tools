---
id: repo-91
tool: repo
title: CodeQL's missing-rate-limiting check cannot see `@webtools/core/rate-limit`, so how does the repo satisfy it
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-91 — CodeQL cannot see the shared rate limiter

## Why

On PR #345 (lg-4, the ledger's rule classifier and inbox), GitHub's
default-setup `CodeQL` check failed with **"Missing rate limiting (High)"** on
two ledger routes: `routes/inbox.ts` (line 21) and `routes/rules.ts` (line 57)
at 0e6bb53. The ledger then added `@webtools/core/rate-limit` to every route,
with `tools/ledger/api/test/route-limits.test.ts` proving the 429s, and the
check **still failed** at 6a5a73b (the same two files, lines 24 and 60). The
owner dismissed both alerts as false positives on 2026-10-03, and asked for this
ticket in the same answer.

**The cause.** `js/missing-rate-limiting` models a fixed list of libraries
rather than the behaviour. CodeQL's `MissingRateLimiting` library documents
`express-rate-limit`, `express-brute`, `express-limiter` and
`rate-limiter-flexible` (the classes `RateLimiterFlexibleRateLimiter` and
`RouteHandlerLimitedByRateLimiterFlexible`), plus a general
`RateLimitingMiddleware` class for a middleware that "acts as a rate limiter"
(<https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/security/dataflow/MissingRateLimiting.qll/module.MissingRateLimiting.html>,
read by this ticket's builder on 2026-10-03). The repo's own limiter is none of
those, so it is invisible to the query, and **every Fastify route that touches a
database or the filesystem can trip it, in any tool**.

**What the repo has, measured here at the base (ebb808b):**

- `@webtools/core/rate-limit` is imported from `tools/downloader/api/src` (its
  `server.ts`, `context.ts`, `rate-limit.ts`, `thumbnails.ts` and routes
  `probe.ts` and `files.ts`) and from `tools/planner/api/src` (`server.ts`,
  `context.ts`, `rate-limit.ts`). `grep -rn "webtools/core/rate-limit"
tools/*/api/src` lists them. The ledger's import is on #345 and is not on
  `main` yet.
- `rate-limiter-flexible` appears in no `package.json` in the repo
  (`grep -n "rate-limiter-flexible" package.json packages/*/package.json
tools/*/*/package.json` prints nothing), so adopting it is a new dependency.
- Neither the downloader nor the planner has been reported by this check. That
  is **unmeasured**, not evidence they are clean: CodeQL's alert list for those
  tools was not read.

## The decision

**The owner's question, in their words, was "what rate-limiter-flexible
advantages?"** What follows is the orchestrator's answer from its own knowledge,
**unverified** (the library's documentation was not read for this ticket):

- CodeQL recognises it, which is the only advantage that bears on the alert.
- Shared or persistent stores (Redis, Postgres, SQLite and others), so a limit
  survives a restart and holds across more than one process.
- Block durations, an insurance limiter that takes over when the primary store
  fails, and unions of limiters.
- The cost: a new dependency, and moving off the tested shared
  `@webtools/core/rate-limit`, which two tools use and which has its own suite.

**The measurement that must come first.** Does CodeQL recognise
`rate-limiter-flexible`'s `consume()` when it is called from a Fastify
`onRequest` hook? **It is unverified**, and a single command cannot settle it:
default-setup CodeQL runs only on a pull request, so it is answerable only by a
CI run on a throwaway branch with one route behind such a hook. The class names
above are Express-shaped, and nothing read so far says they follow a Fastify hook.

**Options.** No recommendation is set before that run; the measurement decides
whether the first is even available.

1. **Adopt `rate-limiter-flexible` in `@webtools/core`, behind the existing
   `RateLimiter` interface**, so no tool's call sites move. Costs a dependency in
   a shared package, a migration of the existing suite, and only helps if the
   measurement says CodeQL sees it from a hook.
2. **Keep core's limiter and dismiss each alert** as a false positive with a
   written reason, as the owner did on #345. Costs a manual dismissal per new
   route in any tool that trips it.
3. **Add a CodeQL model pack teaching it core's `RateLimiter`** (the general
   `RateLimitingMiddleware` class is the extension point). Probably means leaving
   default setup for an advanced one, which costs a workflow file and owning the
   query-pack version.

## Reproduction

The alerts are visible **only in the PR check run**, not through any command that
works here (`gh api` is denied):

- At 0e6bb53 the check run was
  <https://github.com/brunolabbe/tools/runs/111242886503> (relayed by the
  orchestrator, not re-read: a run this old was not fetched).
- Find the current one with `gh pr view 345 --json statusCheckRollup` and read the
  `CodeQL` entry's `detailsUrl`. At #345's head 42eee99 it was
  <https://github.com/brunolabbe/tools/runs/111258200380>, `conclusion: FAILURE`,
  measured on 2026-10-03; the annotations are on that page.

## Build

Not until the decision is answered. First, whichever option is chosen: the
measurement above, on a throwaway branch (never `main`), with the result written
into this ticket's Log. Then the option's own work.

## Done when

- The ticket's Log records whether CodeQL recognises `consume()` from a Fastify
  `onRequest` hook, with the run URL, and the owner's choice among the options
  is recorded here.
- A new ledger route (or any route) that is limited by the repo's chosen limiter
  passes the default-setup `CodeQL` check without a dismissal, or the Log says
  why the chosen option is a dismissal instead.

## Log

- 2026-10-03: filed by the 2026-10-03 batch's close-out, from the owner's
  decision on #345. `needs-decision` rather than `ready`: it poses a question
  its own page says must not be settled by whoever picks it up, and
  `docs/01-TICKETS.md` makes that the status of a filing like this. Verified
  here: the import list and the absent dependency above, the CodeQL
  documentation's class list, #345's current `CodeQL` check run. Relayed, not
  verified: the first run URL, the line numbers at 0e6bb53 and 6a5a73b, the
  owner's dismissal, and every claim about `rate-limiter-flexible` itself.
