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

lg-98 moves the ledger web onto TanStack Query (`@tanstack/react-query`). It is on
branch `lg-98-tanstack-query`, PR #785, a draft, not merged when this was filed
(head `5cba3623`). On that branch, `web/src/writes.ts` lists each of the 34 `POST`
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

Status is `ready`: the question is answered and the Build below is complete enough
to start. It starts after lg-98 merges, because `WRITES` and `EXPECTED` are on
that branch and not on `main` (`depends_on`).

## Build

1. **Run each write against the in-process API.** For each of the 34 writes in
   `WRITES`, on a fresh SQLite database and a seeded household, send the write to
   the app `createApp` builds, as the api tests do (`api/test/periods.test.ts`,
   `api/test/retire-person.test.ts`). Assert that it answered 2xx before anything
   else is read.
2. **Derive the changed routes.** Before the write, GET every read in `ROUTES`
   (`tools/ledger/contract/src/api.ts`); after it, GET them again; diff each
   answer, serialised with its keys sorted. The derived set is the routes whose
   answer changed.
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

Traps worth knowing:

- A write that is refused changes nothing, so an empty diff passes for it. Step
  1's 2xx assertion is what stops that.
- `readReceipt` reads a photo through a model. No test calls a real model
  (`tools/ledger/CLAUDE.md`): hand the app a fake `receiptReader`.
- An answer that carries the time (a `now`, a `generatedAt`) differs on every
  read, and then every write derives every route. Pin the clock or leave that
  field out, and say which in the Log.
- `ROUTES` holds routes that are not reads (a `POST`-only route, or one that
  returns a file). Each one left out of step 2 is named in the Log with its reason.

Unknowns. The design does not settle these; the Build settles each one and records
it in its Log, with the reason:

- **Which vitest project.** `WRITES` is in `web/src/writes.ts`, the in-process app
  is in `api`, and the test needs both. Whichever project the test sits in reads
  the other side across a package boundary. Read the ledger's import rules
  (`tools/ledger/CLAUDE.md` and `.claude/rules/testing.md`) and state which project
  it is in and what it imports from where. The project choice is `api` or `web`
  (`npm test -- --project ledger` runs both).
- **Where each write's request comes from.** The web's `web/src/api/*.ts`
  functions send the request the screen sends, so a harness that calls them runs
  each write the way the screen does. A request table written in the test (method,
  path, body, per write) is a second hand copy, this time of the requests rather
  than of the routes. The Build states which it takes.
- **Whether the seeded state can be shared.** The design says a fresh SQLite per
  write. The seed could be built once and copied, or built again for each write.
  The Build measures the cost of each and records the choice.
- **What becomes of `EXPECTED`.** Once the derivation checks the lists, the design
  does not say whether `EXPECTED` in `web/test/writes.test.tsx` is removed, or
  whether the screen cases take each write's `changes` from `WRITES`. The Build
  states which, and why.

## Done when

- Each of the 34 writes in `WRITES` (`addHouseholdMember` through
  `confirmWorkbook`) has a case in the harness, run by `test.each` over the keys of
  `WRITES`, and each case passes at the build's head.
- For each of the 34 writes, the case asserts a 2xx answer before it reads the
  diff. This includes `uploadReceipt`, `readReceipt` and `describeWorkbook`.
- For each of the 34 writes, a route whose answer changed under the write and is
  not in its `WRITES` list fails the case, naming the write and the route. The run
  at the build's head reports the count of such routes across the 34 writes, and
  it is 0.
- For each of the 34 writes, the routes its list marks and the diff does not change
  are printed in the run and recorded in the Log. None of them fails a case.
- For each of the 31 writes whose marked list is not empty, the fixture changes at
  least one answer. For each of `uploadReceipt`, `readReceipt` and
  `describeWorkbook`, the derived set is empty. Both are asserted per write, and
  the counts are in the Log.
- Planted omission: with `ROUTES.people` removed from `closePeriod`'s list in
  `WRITES`, the `closePeriod` case fails and names `/api/people`. The mutation is
  committed first and restored with `git checkout <sha> -- <path>`, and the run's
  output is in the Log.
- Every entry of `ROUTES` is either read in step 2 or named in the Log with the
  reason it is not a read.
- `npm run check` passes, and so does the ledger suite (`npm test -- --project
  ledger`), which contains the harness.

## Log

- 2026-11-10: filed by a maintenance dispatch, from the owner's decision of the same
  day (the Decision above). Checked at lg-98's branch head `5cba3623` (PR #785,
  draft, open): `web/src/writes.ts` lists 34 `WRITES` entries, from
  `addHouseholdMember` through `confirmWorkbook`, and
  `git grep -E '"(POST|PUT|PATCH|DELETE)"'` in `web/src/api` at that head finds 34
  `POST` lines and no other write method, the count the lg-98 Decision gives at
  `main`. The `EXPECTED` table in `web/test/writes.test.tsx` on that branch restates
  the lists by hand, as F7 says. No code changed. Status `ready`; the Build starts
  after lg-98 merges.
