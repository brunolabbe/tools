---
id: lg-98
tool: ledger
title: Fetch the ledger's data through TanStack Query, so a tab switch asks only for what is stale
kind: work-package
status: ready
milestone: null
depends_on: [lg-97]
difficulty: hard
---

# lg-98 — Fetch the ledger's data through TanStack Query

## Why

Each ledger screen fetches its own data from scratch every time it opens. It does
this by hand with `useEffect` and an `AbortController`, in about 41 call sites
under `web/src`. The shell also asks again for the inbox count and the people's
names on every tab change (`web/src/App.tsx`, lg-33 and lg-54). One tab switch costs
between 3 and 8 `/api/` requests, and the same data is asked for repeatedly:

- `ROUTES.people` (`fetchPeople` and `fetchPeopleNames`) is asked on six screens
  and by the shell.
- `ROUTES.spendingCategories` is asked on six screens.

That volume trips Cloudflare's rate limiting rule on `/api/`, which allows 20
requests per 10 seconds per IP address and is shared by every tool in the zone.
lg-97 has the measurement. The owner chose, on 2026-11-01, to adopt TanStack Query
(`@tanstack/react-query`) instead of writing a small in-house cache that the
library would later replace. No web app in this repo has a fetching library yet.
That is why the choice is recorded here, and why it stays inside the ledger: under
the repo's rule, `packages/ui` gets shared code only when a second tool needs it.

## Build

1. **Add the dependency** to `tools/ledger/web/package.json` `dependencies`. Use a
   release at least seven days old (`.claude/rules/dependency-updates.md`). The image
   closure test (`packages/core/test/image-closure.test.ts`) concerns workspaces,
   not npm packages, so nothing changes there.
2. **One `QueryClient`, provided in `main.tsx`** (or at the top of `App`), with
   defaults stated in its comment:
   - **`staleTime` about 30 s.** Two people use this, and a change made by the other
     person shows within that window.
   - **No refetch on window focus.** A phone switching apps would otherwise refill
     the edge budget.
   - **A `retry` that retries a `RATE_LIMITED` query once**, after
     `details.retryAfterSec` (lg-92, lg-97). Cap the wait at about 15 s, and don't
     retry anything else that the taxonomy does not mark `retryable`.
3. **Query keys from the route**: `ROUTES.*` together with the request's
   parameters. That way the people a screen asks for and the names the shell asks
   for are one entry, because they are one route.
4. **Move each screen** from `useEffect` + `AbortController` to `useQuery`, one
   screen at a time. `queryFn` receives `{ signal }`, so the `fetch*` functions in
   `web/src/api/` stay as they are. Keep each screen's loading and failure wording:
   the tests read it.
5. **Writes become `useMutation`s that invalidate what they change.** For each
   write, list the queries it can change, and test that list rather than guess it.
   A rename invalidates people. A paste, a filing or an import invalidates the
   inbox. A rule invalidates rules and the inbox's suggestions. Where it is not
   clear what a write touches, invalidating everything is acceptable; the point is
   not to refetch on every tab.
6. **The shell's per-tab re-ask goes.** The inbox count and the names become
   queries, kept current by step 5's invalidations. lg-33's guarantee (a rename shows
   on the next screen opened) and lg-54's (the inbox count updates after a paste,
   with no tab change) must still hold. Their tests in `web/test/app.test.tsx` stay,
   reworded where they describe how the guarantee was met rather than what it is.
7. **Tests**: one `renderWithClient` helper that gives each test a fresh
   `QueryClient` with `retry: false`. Without it, cached answers carry from one test
   into the next and a test passes on another test's data. The 25 web test files
   mock the `api/` modules, and they keep doing that.
8. **`web/src/receipts/Queue.tsx`** already waits out a `RATE_LIMITED` read on its
   own (lg-92). It is a write queue, not a query, so leave it as it is unless moving
   it becomes free.

Traps worth knowing:

- An unmounted screen's request is cancelled through `signal` only if the
  `queryFn` passes it on.
- `exactOptionalPropertyTypes` is on (see the `signal?: AbortSignal | undefined`
  note in `api/client.ts`).

## Done when

- A tab switch back to a screen opened within `staleTime` sends no `/api/` request.
  This is proved by a test that counts the mocked `fetch*` calls across a sequence of
  tab switches.
- Opening every tab once, in order, from a cold start sends each distinct
  `ROUTES.*` GET once, which proves people and categories are asked for once each.
- Every write's invalidations are tested: after the write, the affected screen
  shows the new data without a reload.
- The lg-33 and lg-54 tests in `app.test.tsx` pass.
- A `RATE_LIMITED` query retries once after `retryAfterSec`, and any other failure
  is shown as before. Both are tested.
- `npm run e2e:ledger`'s layout spec passes, with its screenshots opened.

## Log
