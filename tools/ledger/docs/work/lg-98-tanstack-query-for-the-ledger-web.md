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
this by hand with `useEffect` and an `AbortController`: 42 `fetch*` calls outside
`web/src/api/`, in 23 effects, and the work is sized by the 23. The shell also asks
again for the inbox count and the people's names on every tab change
(`web/src/App.tsx`, lg-33 and lg-54). One tab switch costs between 2 and 11 `/api/`
requests (Stats is 11, Period 8; lg-97 has the per-tab counts), and the same data is
asked for repeatedly:

- `ROUTES.people` (`fetchPeople` and `fetchPeopleNames`) is asked from six call
  sites on five tabs (Salaries asks twice, through `Salaries` and
  `MortgageSplitCard`), and by the shell.
- `ROUTES.spendingCategories` is asked on six tabs, once each.

That volume trips Cloudflare's rate limiting rule on `/api/`, which allows 20
requests per 10 seconds per IP address and is shared by every tool in the zone.
lg-97 has the measurement. The owner chose, on 2026-11-01, to adopt TanStack Query
(`@tanstack/react-query`) instead of writing a small in-house cache that the
library would later replace. No web app in this repo has a fetching library yet.
That is why the choice is recorded here, and why it stays inside the ledger: under
the repo's rule, `packages/ui` gets shared code only when a second tool needs it.

## Decision — answered 2026-11-07 by the owner

**Question.** The Done when line "Every write's invalidations are tested: after the
write, the affected screen shows the new data without a reload" names no list, so a
gate has nothing to grade it against. Counted at `08f78f69` by the orchestrator, and
re-counted on 2026-11-08 at `origin/main` (`08f78f69`, the same tree), the write call
sites in `web/src/api` are 34 lines, from
`grep -rnE '"(POST|PUT|PATCH|DELETE)"' tools/ledger/web/src/api | grep -v client.ts | wc -l`,
and 11 files, from the same grep with `-l`.

**Options**

1. **The 34 sites, listed.** The builder rewords the line in its first commit to the
   write call sites in `web/src/api` at the branch base, lists them in the ticket,
   and writes one invalidation test for each.
2. One test per `api/` module (11).
3. Leave the line as written.

**Chosen: option 1, the 34 sites, listed.** This was the orchestrator's
recommendation. The owner chose it at an intake checkpoint on 2026-11-07, while
lg-98 was not in a batch.

The Done when line quoted above is superseded by that choice. It stays as written
until lg-98's builder rewords it in that builder's first commit. Status stays `ready`.

## Decision — answered again 2026-11-10 by the owner, at the batch's intake

**Question.** The same line, put again at intake with a recount at `a100f429`:
`grep -rhoE "method: *['\"](POST|PUT|PATCH|DELETE)['\"]" tools/ledger/web/src | sort | uniq -c`
→ `34 method: "POST"`. How should the line be scoped?

**Options**

1. **All 34 POSTs, listed.** Reword the line to "each of the 34 POST calls in
   `web/src/api/*.ts` at `a100f429`". The builder lists them in the Log, each mapped
   to a test, and writes sharing one invalidation key may share a test.
2. One write per `api/` module, the other writes out of scope.
3. Keep the wording.

**Chosen: option 1**, the orchestrator's recommendation, by the owner on
2026-11-10. It is the 2026-11-07 answer with two things added: the base is
`a100f429`, and writes that invalidate the same keys may share one test. The
question counted the calls in 10 files; `grep -rlE` over the same pattern lists
11 (`households`, `inbox`, `mortgage-splits`, `mortgage`, `periods`, `receipts`,
`rules`, `salaries`, `spending`, `statements`, `workbook`), as the 2026-11-07 count
did. The 34 are the same either way. The Done when line is reworded below, with
the line it replaces kept beside it, struck.

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
   parameters, and **the cache entry holds the route's whole response**. Each
   caller takes what it needs from it with `select`. People is the case that
   decides this. `fetchPeople` (`api/rules.ts`) returns a `string[]`, filtered by
   `who`. `fetchPeopleNames` (`api/people.ts`) returns the `names` map. Both read
   the one `ROUTES.people` URL with no parameter. One key holding either shape
   hands a caller the other's data, and neither the compiler nor the mocked tests
   catch it, because a query key is untyped. A key per shape asks `/api/people` up
   to three times, which fails Done when 2.
4. **Move each screen** from `useEffect` + `AbortController` to `useQuery`, one
   screen at a time. `queryFn` receives `{ signal }`, so most `fetch*` functions in
   `web/src/api/` stay as they are. The exceptions are the ones that reshape a
   response that another caller shares (step 3): those become a raw fetch plus a
   `select`. Keep each screen's loading and failure wording: the tests read it.
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
   into the next and a test passes on another test's data. Of the 25 web test
   files, 19 mock an `api/` module, and they keep doing that; the other six do not
   render screens.
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
- Each of the 34 POST calls in `web/src/api/*.ts` at `a100f429` has its
  invalidations tested: after the write, the affected screen shows the new data
  without a reload. The Log lists the 34, each with its file, its function, the keys
  it invalidates and the test that proves it; writes that invalidate the same keys
  may share a test (owner, 2026-11-10).
- ~~Every write's invalidations are tested: after the write, the affected screen
  shows the new data without a reload.~~ Superseded by the line above (owner,
  2026-11-07 and 2026-11-10).
- The lg-33 and lg-54 tests in `app.test.tsx` pass.
- A `RATE_LIMITED` query retries once after `retryAfterSec`, and any other failure
  is shown as before. Both are tested.
- `npm run e2e:ledger`'s layout spec passes, with its screenshots opened.

## Log

- 2026-11-08: maintenance dispatch. Recorded the owner's answer on the write
  invalidations (the Decision above, answered 2026-11-07). Re-ran the two greps at
  `origin/main` `08f78f69`: 34 lines, and 11 files with `-l`, both as the
  orchestrator counted. No Build or Done when line changed; status left `ready`.
  lg-98's builder rewords the Done when line in its first commit.

### 2026-11-10 — built

Branch `lg-98-tanstack-query`, from `a100f429`. The owner's 2026-11-10 answer is
recorded above (first commit). Everything else below is the build.

**What it is.**

- `@tanstack/react-query` `^5.105.3` in `web/package.json`. 5.105.3 and its
  `@tanstack/query-core` 5.105.3 were both published 2026-11-02 (`npm view … time`),
  eight days before the build. The lockfile was relocked with
  `npx -y npm@11.21.1 update @tanstack/react-query --before=2026-11-03 --package-lock-only --ignore-scripts`,
  then regenerated with npm 10.9.9 in a staging directory holding only the manifests
  and the lockfile, as `scripts/check-lockfile-sync.mjs` does, because the npm 11
  lockfile dropped 25 `"peer": true` lines that npm 10 writes back and the sync check
  failed on them. `node scripts/check-lockfile-sync.mjs` passes after.
  `npm audit --package-lock-only` → `found 0 vulnerabilities`.
- `web/src/query.ts`: the one client, made in `main.tsx`. `staleTime` 30 s, no
  refetch on focus or on reconnect, and `retry`: a `RATE_LIMITED` read once more
  after `details.retryAfterSec` capped at 15 s (10 s when none is named). Nothing
  else retries, `UNREACHABLE` and `TIMEOUT` included (see the open question below).
- `web/src/queries.ts`: every read as a query, keyed `[ROUTES.x, params]`, each key
  built by one function from one `queryFn`.
- `web/src/writes.ts`: the 34 writes, each with the routes it marks stale, sent
  through `useWrite`, which is a `useMutation`. On success, the write marks stale
  every query under those routes, and the queries a mounted screen shows are read
  again. A refused write marks nothing; Rules, Categories and the Inbox still read
  their lists again after a refusal that means someone else changed them, as they did
  before.
- Every screen reads through the cache. The shell no longer asks again on a change of
  tab. The inbox count is the inbox query's own length, and the names are `select`ed
  from the people query.

**What the brief had wrong, or left open.**

- Build 3, "the cache entry holds the route's whole response", is followed where it
  decides something: `people` and `me`, the two routes read in two shapes. Both are
  cached whole: `api/people.ts`'s `fetchPeople` now returns `PeopleResponse`, and
  `peopleIn`, `everyone` and `shownNames` are the `select`s. `rules.ts`'s
  `fetchPeople`, `people.ts`'s `fetchPeopleNames` and `periods.ts`'s `fetchMe` are
  gone. Every other key keeps its `fetch*` function's shape, as Build 4 says. That is
  safe because one function in `queries.ts` builds each key from one `queryFn`, so no
  key can hold two shapes.
- The paged lists (History's rows, the rows and card lines under a spending chart)
  are one cache entry each, without `offset` or `limit` in the key. Their `queryFn`
  asks for as many as the entry already holds, and "Show more" adds its page to the
  entry. So a read after a write keeps the pages the person opened, as lg-95's and
  lg-18's re-reads did.
- The dispatch's question counted the POSTs in 10 files. There are 11 (the Decision
  above).
- Four props are gone because the cache does their work: `Inbox`'s `onCount`,
  `StatementPaste`'s `onStored`, the `onChanged` of `PeriodRows` and `PeriodLines`,
  and `SpendingCard`'s `reload` counter.
- Two existing tests described the old cost and were changed to the new one.
  `stats-rows.test.tsx`: going back to a range read within `staleTime` now draws its
  cached answer, where it used to ask again and fail. `history.test.tsx`'s Clear
  filters test: the unfiltered list comes from the cache. Tests that waited
  synchronously for a write now `waitFor` it, because a mutation sends on the next
  tick (`salaries.test.tsx`).
- A write marks the inbox stale, and the shell's count is always mounted, so most
  writes on any tab cost one extra GET of `/api/inbox`. That is lg-54's guarantee,
  kept on every tab. An answer in the inbox costs no read at all: `classifyRow` and
  `setRowSpendingCategory` patch the inbox and the auto-filed review with their
  answers and only mark them stale. Classifying ten rows is ten requests, as it was
  before.

**Fold-ins.** Build 8, `receipts/Queue.tsx`: only its `fileReceipt` moved to
`useWrite`, because a filing has to mark the books stale. The queue's own wait on
`RATE_LIMITED` (lg-92) and its uploads and reads are untouched. `fetchReceiptMatches`
is not cached: it is read on a tap, per receipt, not when a screen opens. The
receipt screen's "read by" wording, which lg-105 rewords, is not touched. Nothing
else was free.

**The 34 writes** (the Done when line). Every row is proved by the case of the same
name in `web/test/writes.test.tsx` › "after each write, what it changes is read again
and shown, and nothing else is (lg-98)". The case mounts one screen per route, sends
the write through `useWrite`, and checks three things. Every route the write changes
is read again, and its screen shows the second answer. A route the write patches
holds the answer, unread, and is marked stale. Every other route is neither read nor
marked. The expected lists are written out in the test, apart from `writes.ts`.
`web/test/writes-source.test.ts` holds `WRITES` to the 34 `method: "POST"` calls in
`web/src/api/*.ts`. Where a screen test shows the same write on a real screen, it is
named as well.

The sets are as `writes.ts` names them:

- `BOOKS`: buckets, inbox, inbox/auto-filed, rows, periods, periods/open,
  period-lines, mortgage, spending-category-map and the eight `stats/*` routes.
- `RULES`: rules and inbox.
- `SPENDING`: spending-categories, spending-category-map, rows, inbox,
  inbox/auto-filed, period-lines and stats/spending.
- `DIRECTORY`: me, households/:id, admin/households and people.
- `EVERYTHING`: every route.

| #   | File                 | Function                 | Marks stale (patched instead of read)        | Screen test besides                                                                                                                                   |
| --- | -------------------- | ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `households.ts`      | `addHouseholdMember`     | `DIRECTORY` + `BOOKS`                        | `household.test.tsx` › adds a member, tells them the address must be admitted on Access, and shows the list again                                     |
| 2   | `households.ts`      | `renameHousehold`        | `DIRECTORY`                                  | `household.test.tsx` › titles the page by the household's name, and a member renames it there                                                         |
| 3   | `households.ts`      | `adminRenameHousehold`   | `DIRECTORY`                                  | —                                                                                                                                                     |
| 4   | `households.ts`      | `createHousehold`        | admin/households (patched with the answer)   | `writes.test.tsx` › the patches put the answer where the inbox and the admin list show it                                                             |
| 5   | `households.ts`      | `adminAddMember`         | `DIRECTORY` + `BOOKS`                        | —                                                                                                                                                     |
| 6   | `households.ts`      | `adminRemoveMember`      | `DIRECTORY` + `BOOKS`                        | —                                                                                                                                                     |
| 7   | `households.ts`      | `adminChangeAddress`     | `DIRECTORY`                                  | —                                                                                                                                                     |
| 8   | `households.ts`      | `adminRetirePerson`      | `DIRECTORY` + `BOOKS`                        | —                                                                                                                                                     |
| 9   | `households.ts`      | `adminRenamePerson`      | `DIRECTORY`                                  | `app.test.tsx` › the shell hands every screen the shown names, and a rename is on the next tab opened (lg-33)                                         |
| 10  | `inbox.ts`           | `classifyRow`            | `BOOKS` (inbox, inbox/auto-filed patched)    | `history.test.tsx` › a row answered by a person is filed again from the history, the list is read again, … (lg-95); `writes.test.tsx` › the patches … |
| 11  | `mortgage-splits.ts` | `fileMortgageSplit`      | mortgage-splits + `BOOKS`                    | —                                                                                                                                                     |
| 12  | `mortgage.ts`        | `saveMortgage`           | `BOOKS` (mortgage patched with the answer)   | —                                                                                                                                                     |
| 13  | `periods.ts`         | `closePeriod`            | `BOOKS`                                      | `periods.test.tsx` › the close button shows who deposits what, and closing sends the period as seen                                                   |
| 14  | `periods.ts`         | `addLine`                | `BOOKS`                                      | —                                                                                                                                                     |
| 15  | `periods.ts`         | `correctLine`            | `BOOKS`                                      | —                                                                                                                                                     |
| 16  | `periods.ts`         | `retireLine`             | `BOOKS`                                      | —                                                                                                                                                     |
| 17  | `periods.ts`         | `addRecurring`           | recurring + `BOOKS`                          | —                                                                                                                                                     |
| 18  | `periods.ts`         | `changeRecurring`        | recurring + `BOOKS`                          | —                                                                                                                                                     |
| 19  | `receipts.ts`        | `uploadReceipt`          | nothing                                      | —                                                                                                                                                     |
| 20  | `receipts.ts`        | `readReceipt`            | nothing                                      | —                                                                                                                                                     |
| 21  | `receipts.ts`        | `fileReceipt`            | `BOOKS`                                      | —                                                                                                                                                     |
| 22  | `rules.ts`           | `createRule`             | `RULES`                                      | —                                                                                                                                                     |
| 23  | `rules.ts`           | `editRule`               | `RULES`                                      | —                                                                                                                                                     |
| 24  | `rules.ts`           | `retireRule`             | `RULES`                                      | `rules.test.tsx` › retiring a rule asks the API and reloads what is in force                                                                          |
| 25  | `salaries.ts`        | `enterSalaries`          | salaries, ratios + `BOOKS`                   | —                                                                                                                                                     |
| 26  | `salaries.ts`        | `confirmRatio`           | salaries, ratios + `BOOKS`                   | —                                                                                                                                                     |
| 27  | `spending.ts`        | `addSpendingCategory`    | `SPENDING`                                   | —                                                                                                                                                     |
| 28  | `spending.ts`        | `renameSpendingCategory` | `SPENDING`                                   | —                                                                                                                                                     |
| 29  | `spending.ts`        | `retireSpendingCategory` | `SPENDING`                                   | —                                                                                                                                                     |
| 30  | `spending.ts`        | `setSpendingMapEntry`    | `SPENDING`                                   | —                                                                                                                                                     |
| 31  | `spending.ts`        | `setRowSpendingCategory` | `SPENDING` (inbox, inbox/auto-filed patched) | `writes.test.tsx` › the patches put the answer where the inbox and the admin list show it                                                             |
| 32  | `statements.ts`      | `importStatement`        | `BOOKS`                                      | `app.test.tsx` › the inbox tab's count changes when a paste is stored, with no change of tab (lg-54)                                                  |
| 33  | `workbook.ts`        | `describeWorkbook`       | nothing                                      | —                                                                                                                                                     |
| 34  | `workbook.ts`        | `confirmWorkbook`        | `EVERYTHING`                                 | —                                                                                                                                                     |

`writes.test.tsx` › "a refused write marks nothing stale" covers the refusal.
`npx vitest run tools/ledger/web/test/writes.test.tsx tools/ledger/web/test/writes-source.test.ts`
→ 38 of 38. As a mutation, `createRule` was cut to `[ROUTES.rules]` in `writes.ts`:
1 of 37 failed (`createRule`), and the file was then restored from `8a3aa6b0`.

**The other Done when lines.**

- **A tab switch back within `staleTime` sends no request.**
  `web/test/query-cache.test.tsx` › "a tab switch back to a screen opened within
  staleTime sends no request (lg-98)". It renders `<App/>` over the real `api/`
  modules and a stubbed `fetch` that records every request, opens every tab, then
  switches back across all 13 and on through six more: 0 requests. As a mutation,
  `STALE_MS = 0` in `query.ts` gave 72 requests on those switches, and the
  cold-start test below failed too. `query.ts` was then restored from `8a3aa6b0`.
  A third test in the file shows a screen asking again after `staleTime`, and for its
  own three reads only.
- **A cold start sends each distinct GET once.** The same file › "opening every tab
  once, in order, from a cold start sends each distinct GET once (lg-98)". No GET is
  sent twice. `/api/people` and `/api/spending-categories` are sent once each, and
  25 distinct routes or more are read.
- **lg-33 and lg-54.** In `app.test.tsx`, lg-54's test is unchanged apart from its
  comment. lg-33's test is reworded and now proves its guarantee through a rename:
  the admin renames alex on the Admin tab, and the Salaries tab opened next prints
  "Alex". It used to change the names fake between tabs and rely on the shell asking
  again on a change of tab. `npx vitest run tools/ledger/web/test/app.test.tsx` → 21
  of 21.
- **`RATE_LIMITED`.** `web/test/query-retry.test.tsx`, on the app's own client with
  retries on, 6 of 6. A read refused with `retryAfterSec: 4` is not asked again at
  3.5 s, is asked again by 4.5 s, and its screen shows the answer. A read refused
  twice is shown as refused after one retry, with two calls. `UNREACHABLE` and
  `INTERNAL` show their own words at once, with one call.

- **`npm run e2e:ledger`.** `E2E_PORT=8128 npm run e2e:ledger`, on a port of its
  own because a peer session was running the downloader's e2e: 37 passed (54.3 s),
  over a bundle built by the run. These screenshots in `e2e/.artifacts/layout/` were
  opened and are whole: Home-360, Paste (stored)-360, Inbox-360, Period-1280,
  Stats-1280 and History (stored change unread)-360. The last one shows the lg-99
  line, drawn through the new path in which the re-read is the write's own
  (`settledRead`). Vite now warns that the one chunk is over 500 kB: it is 541.11 kB
  minified, 158.31 kB gzipped. The shared checkout's bundle, built 2026-11-01 and
  so not this base, is 485 kB. This was not measured at `a100f429`.

**Open question for the owner, not settled here.** Build 2 says "don't retry
anything else that the taxonomy does not mark `retryable`". `UNREACHABLE` and
`TIMEOUT` are marked retryable, so the line allows retrying them, but it does not
require it. Done when 5 says any other failure is "shown as before", and before
nothing was retried. The build retries neither. The report puts the choice to the
orchestrator.

### 2026-11-10 — the owner's answers after gate 1

Relayed by the orchestrator in the dispatch of gate 1's fix round, 2026-11-10.

- **The retry, the open question above.** Answered by the owner: a `RATE_LIMITED`
  read is retried once, and `UNREACHABLE` and `TIMEOUT` are not retried. The
  options were the two the question named: retry neither (as built), or retry
  those two as well, since the taxonomy marks them retryable. The build already
  does what was chosen, so nothing changes. The dispatch said this answer was on
  the ticket already; at `70b129cc` it was not, so it is written here.
- **Gate 1's F3** (a paged list read again past 500 rows asks for more than the
  API's `limit` allows, and the refusal is not shown). Answered by the owner: fix
  it in this round. The options were: fix it in this round (chosen, the
  orchestrator's recommendation); record it unfixed in the gate's record; or file
  a ticket for it.
