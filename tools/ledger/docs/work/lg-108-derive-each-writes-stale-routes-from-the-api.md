---
id: lg-108
tool: ledger
title: Derive each write's stale routes from the API, not from a hand-typed table
kind: work-package
status: ready
milestone: null
depends_on: [lg-98]
difficulty: hard
---

# lg-108 — Derive each write's stale routes from the API, not from a hand-typed table

## Why

lg-98 moves the ledger web onto TanStack Query (`@tanstack/react-query`). It is landed on
branch `lg-98-tanstack-query`, PR #785, head `ef71bd11` (it was a draft at
`5cba3623` when this was filed), and not yet merged. On that branch, `web/src/writes.ts` lists each of the 34 `POST`
calls in `web/src/api/` with the routes it marks stale once it succeeds. Its test,
`web/test/writes.test.tsx` on the same branch, compares that list with an
`EXPECTED` table typed out by hand from the same intent. So a missing
invalidation passes in both places: a list and a table written from one judgement
agree with each other, and the test shows that they agree, not that the list is
complete.

lg-98's gate 1 (Sonnet 5.5, 2026-11-10) recorded this as finding F7, `low`,
`nfr:maintainability`:

> The case that carries Done when 3 compares `WRITES` with an `EXPECTED` table
> typed out from the same intent, so a wrong list passes in both places; both F1
> and F2 passed through it. It proves the mechanism and the lists' internal
> consistency, not that a list is complete. Shares its mechanism with F1 and F2.

F1 was `closePeriod` not marking `/api/people` and `/api/admin/households`. F2 was
the three rule writes (`createRule`, `editRule`, `retireRule`) not marking
`/api/rows`. lg-98's round fixed both, with screen tests grounded in API tests,
and left the other 30 rows of `EXPECTED` as a hand copy.

## Decision — answered 2026-11-10 by the owner

**Question.** The remaining 30 rows of `EXPECTED` restate `WRITES`. What should
happen?

**Options**

1. Leave it. The lg-98 round builder's recommendation.
2. **File a follow-up ticket to derive each write's changed routes from the
   in-process API.**
3. Cite an API test for each row in lg-98.

**Chosen: option 2.** The owner chose it on 2026-11-10. The choice overrode the
round builder's recommendation, which was option 1. The Build below is the
derivation design as lg-98's round builder stated it in its report.

**Question 2 — where each write's request comes from. Answered 2026-11-10 by the
owner.** The Build left this open; the owner settled it on the same day.

**Options**

1. **The web's own `tools/ledger/web/src/api/*.ts` functions, called against the
   in-process API exactly as the screens send them. (Chosen. Recommended by the
   orchestrator and by the builder.)**
2. A request table written in the test (method, path and body for each write). A
   second hand copy, of 34 requests.
3. The builder decides.

**Chosen: option 1.**

**Question 3 — what becomes of `EXPECTED` in `web/test/writes.test.tsx`. Answered
2026-11-10 by the owner.** The Build left this open; the owner settled it on the
same day.

**Options**

1. **Retire it, since the derived comparison replaces it. (Chosen. Recommended by
   the orchestrator.)**
2. Keep it beside the derived comparison.
3. The builder decides.

**Chosen: option 1.**

**Question 4 — where the harness lives. Answered 2026-11-10 by the owner**, after
gate 1 found that the placement the Build first implied (`web/test`) cannot reach
the API's seeding helpers (F2).

**Options**

1. **Probe the `api/test` placement and adopt it if it is clean. (Chosen.)** The
   rule: in a scratch worktree, put a throwaway probe test under
   `tools/ledger/api/test/` that imports `tools/ledger/web/src/writes.ts` and one
   `api/test/helpers` seeding helper, adding only the minimal reference to
   `tsconfig.tests.json` that this needs. It is clean if the typecheck has 0 errors
   and `npx vitest run <probe>` runs green. If clean, the Build names `api/test` and
   that one reference; if not, it names `web/test`, with a `@vitest-environment
   node` harness file and its own seeds built through the web's api functions.
   The probe is discarded.
2. Leave it to the builder.

**Chosen: option 1.** The probe was clean (Log, 2026-11-10), so the Build names
`api/test` and the one reference.

**Question 5 — what the screen case still proves. Answered 2026-11-10 by the
owner**, after gate 1 found that, with `EXPECTED` gone, the screen case compares
`WRITES` with itself for content (F4).

**Options**

1. **Keep step 6, say what the screen case no longer proves, and add a Done when
   line that holds it. (Chosen. The gate's recommendation.)**
2. Drop the screen case.

**Chosen: option 1.** The screen case stays as the proof of the mechanism (a changed
route is read again and shown, a patched one holds the answer and is marked stale,
every other route is untouched). It no longer proves that a list is complete;
the derived comparison does, and only as far as each write's fixture reaches.

Status is `ready`: the questions are answered and the Build below is complete enough
to start. It starts after lg-98 merges, because `WRITES` and `EXPECTED` are on
that branch and not on `main` (`depends_on`).

## Build

**Where the harness lives (Question 4).** In `tools/ledger/api/test/`: the cases in
`writes-derived.test.ts`, the inject-backed `fetch` and the read helper in
`helpers/inject-fetch.ts`. There is one ledger vitest project (`ledger`, in the root
`vitest.config.ts`, which includes `tools/ledger/*/test/**/*.test.{ts,tsx}` and
defaults to `environment: "node"`), so the placement is not a choice of project: it
is a choice of directory, which fixes the typecheck surface (the root
`tsconfig.tests.json`: NodeNext, no DOM), and of the file's `@vitest-environment`
docblock. `api/test` is node, and stays node. The only change outside the harness's
own files is one reference in `tsconfig.tests.json`, after the `api` line:

```json
{ "path": "./tools/ledger/web" }
```

With it the harness imports `WRITES` from `../../web/src/writes.ts` and the seeding
helpers from `./helpers/` (`startApp` and the paste, salary, period, receipt and
workbook builders the api tests share), and `npm run check`'s typecheck reports 0
errors (the probe, in the Log). The screen case stays where it is, in
`tools/ledger/web/test/writes.test.tsx` (jsdom, `web/test/tsconfig.json`); the two
files share nothing.

1. **Run each write against the in-process API, through its web function.** For
   each of the 34 writes in `WRITES`, on a fresh SQLite database and a seeded
   household, call the write's `tools/ledger/web/src/api` function (the one
   `WRITES` imports for it, for example `closePeriod` from `api/periods.ts`)
   exactly as the screen calls it. The request reaches the app `createApp` builds,
   as the api tests build theirs (`api/test/periods.test.ts`,
   `api/test/retire-person.test.ts`). The web's functions send relative URLs, which
   the real `fetch` refuses (`Failed to parse URL from /api/me`), so
   `helpers/inject-fetch.ts` replaces `globalThis.fetch` for the case with a
   function that turns `(url, init)` into `app.server.inject({ method, url, headers,
   payload })` and returns a `Response` (gate 1 ran this against `fetchMe` and
   `fetchPeriods`). It forwards whatever method the caller sent. No request is
   written by hand in the test. Assert that the write answered 2xx before anything
   else is read.
2. **Derive the changed routes.** Before the write, GET every read in `ROUTES`
   (`tools/ledger/contract/src/api.ts`); after it, GET them again; diff each
   answer, serialised with its keys sorted. The derived set is the routes whose
   answer changed. **Every read, before and after, is asserted 2xx** by the helper
   that makes it, which throws naming the route and the status on anything else:
   two failed reads serialise alike and would read as "unchanged". The reads are
   the routes the API registers for `GET` (22 `app.get(` sites under `api/src`, one
   of them the loop over the 8 stats routes), not every key of `ROUTES`; the keys
   left out are named in the Log with their reason. Each read that takes a value
   is given one:
   - a route with an `:id` (`household`, `adminMembers`, `receiptMatches` and the
     like) takes the id the case's own seed created, or the caller's household id
     from `GET /api/me`; the literal placeholder is a 404 and fails the 2xx
     assertion;
   - each stats route is read with no `from` and no `to`;
   - `rows` is read unfiltered and, again, with `spendingCategory=none` (the
     variant the spending writes change); `periodLines` is read for the period the
     case's seed has open.
     A variant added beyond these is named in the Log.
3. **Compare with the marked list.** Compare the derived set with the write's
   entry in `WRITES`, its `changes` together with its `patch` routes.
   - A route that changed and is not marked fails the case, naming the write and
     the route.
   - A route marked and unchanged is allowed: over-invalidation costs a request,
     not correctness. Collect those per write, print them in the run, and record
     them as a list in the Log. They are not a failure.
4. **One fixture per write.** Each write runs under a seed in which it changes
   something. The three writes whose marked lists are empty (`uploadReceipt`,
   `readReceipt`, `describeWorkbook`) are the exception: their derived set must be
   empty.
5. **Planted omission.** See the Done when line.
6. **Retire `EXPECTED`.** Remove the `EXPECTED` table from
   `tools/ledger/web/test/writes.test.tsx` (on lg-98's branch). The harness builds
   its own arguments from its seed, because a real call needs the ids the seed
   created. The screen case keeps its own `args` and `answer` (the inputs and the
   mock answers its patchers need; neither is a list of routes), and takes each
   write's marked routes from `WRITES`, the list the derived comparison checks.
   Nothing else in that file restates a list. **What the screen case no longer
   proves** (Question 5): that a list is complete. For which routes a write marks it
   compares `WRITES` with itself. What it still proves is the mechanism: a changed
   route is read again and shown, a patched one holds the answer and is marked
   stale, every other route is untouched.
   Completeness is the derived comparison's, and only as far as each write's
   fixture reaches: a route dropped from `WRITES` that the fixture never changes
   is not caught, which is why the marked-and-unchanged lists of Done when 6 are
   printed.

Traps worth knowing:

- **A photo cannot go up from a jsdom file.** `uploadReceipt` in `api/src/receipts.ts`
  accepts a body only if `body instanceof Uint8Array`, and under jsdom
  `Buffer.alloc(1) instanceof Uint8Array` is `false`: a valid JPEG sent through the
  web's `uploadReceipt` is answered `RECEIPT_NOT_AN_IMAGE`. With a listening server
  and the real `fetch`, jsdom's `Blob` is not Node's, and the same call is
  `UNREACHABLE`. `readReceipt` and `fileReceipt` need an uploaded receipt in their
  seed, so they meet it too. The harness therefore stays in `api/test`, a node
  file, and no write is sent from a jsdom file (gate 1, F1).
- A write that is refused changes nothing, so an empty diff passes for it. Step 1's
  2xx assertion is what stops that, and step 2's stops the same for a read.
- **One app per write.** Step 2 reads about 28 routes twice, about 56 reads a write,
  against `RATE_LIMIT_READS_PER_MINUTE` (120 a minute per person by default): a
  shared app answers `429` from the second or third write. Give each write its own
  app, or raise `rateLimitReadsPerMinute` in the config the case builds.
- `readReceipt` reads a photo through a model, and `describeWorkbook` describes a
  workbook through one. No test calls a real model (`tools/ledger/CLAUDE.md`): hand
  the app a fake `receiptReader` for the first and a fake `layoutAsk` for the
  second.
- An answer that carries the time (a `now`, a `generatedAt`) differs on every
  read, and then every write derives every route. Pin the clock or leave that
  field out, and say which in the Log.
- **Which variant of a read is used decides what can be seen to change.** `rows`,
  `periodLines` and the stats routes answer differently by query, and a route whose
  variant the fixture does not touch looks unchanged. Step 2 names the variants; a
  write whose change shows only in another one is a fixture to widen, not a clean
  route.
- `ROUTES` holds routes that are not reads (a `POST`-only route, or one that
  returns a file). Each one left out of step 2 is named in the Log with its reason.

Unknowns. The design does not settle this; the Build settles it and records it in
its Log, with the reason:

- **Whether the seeded state can be shared.** The design says a fresh SQLite per
  write. The seed could be built once and copied (`booksTemplate` in `createApp` is
  how the api tests already do it), or built again for each write. Either way each
  write gets its own app (the rate-limit trap). The Build measures the cost of each
  and records the choice.

(The request source, the fate of `EXPECTED`, where the harness lives and what the
screen case still proves were open here until the owner answered them on
2026-11-10; they are steps 1 and 6 and the paragraph above step 1.)

## Done when

- Each of the 34 writes in `WRITES` (`addHouseholdMember` through
  `confirmWorkbook`) has a case in the harness, run by `test.each` over the keys of
  `WRITES`, and each case passes at the build's head. The run lists 34 cases, one
  named for each key.
- For each of the 34 writes in `WRITES`, the case sends the write by calling the
  `web/src/api` function that `WRITES` imports for it, and the harness file holds
  no write request. Both commands are run on the harness
  (`tools/ledger/api/test/writes-derived.test.ts`):
  `grep -nE '"(POST|PUT|PATCH|DELETE)"|method:|"/api/' <harness>` returns 0 lines,
  and `grep -c 'WRITES' <harness>` is at least 1. On `helpers/inject-fetch.ts`,
  `grep -nE '"(POST|PUT|PATCH|DELETE)"|"/api/'` returns 0 lines: the helper forwards
  the caller's method, and names only `GET`.
- `EXPECTED` is removed: `web/test/writes.test.tsx` contains no `EXPECTED` table
  (`grep -c EXPECTED` is 0, which a rename would defeat, so the clause that is
  graded is the next one), and the derived comparison covers each of the 34 writes
  in `WRITES`: the run reports one derived comparison per key of `WRITES`, 34 of 34,
  and no list is checked only against a hand copy in either file. A table of
  expected routes under another name is the same failure.
- Every request a case makes, the write and each read before and after it, is
  asserted 2xx by the helper that sends it, which throws naming the route and the
  status. This includes `uploadReceipt`, `readReceipt` and `describeWorkbook`.
  Proved by a mutation: with one read pointed at a route that answers 404 (an
  `:id` route left as its placeholder), the case fails and names that route.
- For each of the 34 writes, a route whose answer changed under the write and is
  not in its `WRITES` list fails the case, naming the write and the route. The run
  at the build's head reports the count of such routes across the 34 writes, and
  it is 0.
- For each of the 34 writes, the routes its list marks and the diff does not change
  are printed in the run and recorded in the Log. None of them fails a case.
- For each of the 31 writes whose marked list is not empty, the fixture changes at
  least one answer. For each of `uploadReceipt`, `readReceipt` and
  `describeWorkbook`, the derived set is empty. Both are asserted per write, over
  reads the 2xx line above has already passed, and the counts are in the Log.
- Planted omission: with `ROUTES.people` removed from `closePeriod`'s list in
  `WRITES`, the `closePeriod` case fails and names `/api/people`. The mutation is
  committed first and restored with `git checkout <sha> -- <path>`, and the run's
  output is in the Log.
- Every entry of `ROUTES` is either answered 2xx in step 2, with the value or range
  step 2 gives it, or named in the Log with the reason it is not a read.
- The screen case still runs for all 34 writes, with its read-count and
  patched-state assertions: `web/test/writes.test.tsx` has one case per key of
  `WRITES`, each asserts for every route that a changed one is read again, a
  patched one is marked stale and not read, and any other is read once, and the
  file passes at the build's head.
- The harness is in `tools/ledger/api/test/`, and the one change outside its own
  files is the `{ "path": "./tools/ledger/web" }` reference in `tsconfig.tests.json`.
- `npm run check` passes, and so does the ledger suite (`npm test -- --project
  ledger`), which contains the harness.

## Log

- 2026-11-10: filed by a maintenance dispatch, from the owner's decision of the same
  day (the Decision above). Checked at lg-98's branch head `5cba3623` (PR #785,
  draft, open): `web/src/writes.ts` lists 34 `WRITES` entries, from
  `addHouseholdMember` through `confirmWorkbook`, and
  `git grep -hF 'method: "POST"' -- tools/ledger/web/src/api | wc -l` at that head
  prints 34, the call sites, with no other write method (`git grep -hE
  '"(PUT|PATCH|DELETE)"'` there prints nothing); the count the lg-98 Decision gives
  at `main`. (The first version of this entry gave `git grep -E
  '"(POST|PUT|PATCH|DELETE)"'`, which prints 35 lines, the 35th being the type
  annotation `method?: "GET" | "POST";` in `client.ts`; gate 1, F6. Corrected in the
  round below.) The `EXPECTED` table in `web/test/writes.test.tsx` on that branch
  restates the lists by hand, as F7 says. No code changed. Status `ready`; the Build
  starts after lg-98 merges.
- 2026-11-10: fixer round on gate 1's findings (Sonnet 5.5; gate 1 at `5f9c6894`).
  The ticket is the only file changed. Both owner answers of the day are recorded
  under the Decision (Questions 4 and 5). lg-98 is landed at `ef71bd11`, PR #785, not
  merged; its `web/src/writes.ts`, `web/test/writes.test.tsx` and `web/src/api` are
  the same at `ef71bd11` as at `5cba3623` (gate 1's diff of the two: only
  `web/test/history.test.tsx` and lg-98's ticket changed). Per finding: F1 added to
  the Traps and settled by the placement; F2 answered by the probe below; F3 step 2
  asserts 2xx on every read and gives each parametrised read its value, and Done when
  4, 7 and 9 now fail on a failed read; F4 answered by Question 5, step 6 and one new
  Done when line; F5 Done when 2, 3 and 4 reworded as the finding asks; F6 the Log
  recipe above corrected (34 call sites by `method: "POST"`); F7 the Unknowns'
  vitest-project bullet replaced by the placement paragraph, since there is one
  project, `ledger`; F8 three Traps added. One consequence of the placement, not a
  finding: step 6 said `args` and `answer` move into the harness's fixture, but the
  screen case (jsdom, `web/test`) cannot import from `api/test`, and its patchers
  need mock answers a real call does not have, so step 6 now says the harness builds
  its own arguments and the screen case keeps its own.
- 2026-11-10: **probe of the `api/test` placement (Question 4).** Throwaway; nothing
  of it is committed. A detached second tree at `ef71bd11` (lg-98's head, which has
  `web/src/writes.ts`), farmed and built (`npm run build` exit 0). The farm warned
  that `@tanstack/query-core` and `@tanstack/react-query` are missing: the lg-98
  branch's own relock added them, so the shared checkout lacks them, which is
  expected. `writes.ts` imports `@tanstack/react-query`, so for the probe only I ran
  `npm install @tanstack/react-query@5.105.3` in a scratch directory outside the repo
  and linked its `@tanstack` into the probe tree's `node_modules`; the version is
  the one lg-98's lockfile asks for, and the probe says nothing about the
  seven-day rule. The probe,
  `tools/ledger/api/test/zz-probe.test.ts`, imports `WRITES` from
  `../../web/src/writes.ts` and `startApp` from `./helpers/classification.ts`,
  asserts `Object.keys(WRITES).length` is 34 and that `GET /api/me` through
  `app.server.inject` answers 200. The one config change, in `tsconfig.tests.json`:

  ```diff
  -    { "path": "./tools/ledger/api" }
  +    { "path": "./tools/ledger/api" },
  +    { "path": "./tools/ledger/web" }
  ```

  First run: `npm run typecheck` exit 1 with one error, my own,
  `zz-probe.test.ts(10,13): error TS2339: Property 'close' does not exist on type
  'App'` (the method is `shutdown`), and `npx vitest run
  tools/ledger/api/test/zz-probe.test.ts` failed on the same `app.close is not a
  function`. After the correction: `npm run typecheck` exit 0, `grep -c "error TS"`
  on its output 0; `npx vitest run tools/ledger/api/test/zz-probe.test.ts` exit 0,
  `Test Files  1 passed (1)`, `Tests  1 passed (1)`. So the placement is clean by
  the owner's rule, and the Build names `api/test` and that one reference. Not
  measured: a harness that runs a write through the web's functions (the probe
  imports `writes.ts` and one helper, as the rule asked, and sends nothing through
  `fetch`). The probe tree and the scratch install are removed.
