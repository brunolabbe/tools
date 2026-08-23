---
id: dl-17
tool: downloader
title: Answer an unknown endpoint with NOT_FOUND, not JOB_NOT_FOUND
kind: fix
status: done
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

## Review

> **Reconstructed after the fact, on 2026-08-23, from the orchestrator's
> transcript — not transcribed at the time.** This ticket merged as #65 before
> `docs/01-TICKETS.md` said the builder commits the gate, so nothing was written
> here and no report was posted to the pull request thread. Read it as a record
> recovered from a scrollback, with the weaknesses that implies: the wording is
> the reviewer's, the decision to write it down is not.
>
> Two things it deliberately does **not** do. It does not back-fill an
> acceptance table — none was written at the time, and composing one now from
> the `Done when` lines would invent a link that nobody actually traced (the
> same reason repo-1's gate 4 declined to reshape its earlier rounds). And it
> records only the round it has: a **second** review round happened, and its
> finding is in the Log below — the first pass was a +3/−3 substitution inside
> existing assertions, so nothing pinned the distinction the ticket exists to
> establish, which is why `api/test/not-found.test.ts` was added. That round's
> gate was never captured either and is not reconstructed here.

### Gate 1 — 2026-08-23

**Gate: PASS** — 2026-08-23, range `origin/main...d007f27`. Gates reproduced by
the reviewer: `npm run check` exit 0; `npm test -- --project downloader` 543
tests / 37 files passed; `npx oxfmt --check` clean on the ticket; commit-message
check exit 0.

Verified: `NOT_FOUND` maps to 404 at `api/src/http-errors.ts` and is exercised
end-to-end in `api/test/web-serving.test.ts` (three assertions checking both
status and code); no genuine "no such job" case was converted — `JobStore.get`,
`routes/jobs.ts`, `routes/files.ts` and `routes/events.ts` still raise
`JOB_NOT_FOUND`; no consumer regression, since `web/src/lib/error-presentation.ts`
handled both codes already from pl-11 and nothing in `web/src` branches on either
literal.

- **low** — the brief predicted one test asserting `JOB_NOT_FOUND` on an unknown
  path; there were three, all in `web-serving.test.ts`, mirroring what pl-11
  found for the planner. The Log corrects the brief.
- **low** — `details: { path }` at the raise site is unobservable: `path` is not
  in `CLIENT_SAFE_DETAIL_KEYS`, and `registerNotFoundHandler` builds its own
  reply, so it neither reaches the wire nor a log line. Settled by the brief,
  which specified it; recorded so a reader knows it is dead weight, not a gap.
- **low, now resolved by repo-2** — stale prose in `03-STATUS.md` outside the
  generated region still described dl-17 as outstanding. That file no longer
  exists.

## Log

**2026-08-22 — done.** `registerNotFoundHandler` in `api/src/server.ts` now
raises `new AppError("NOT_FOUND", undefined, { details: { path: ... } })`,
dropping the `"No such endpoint."` override so the catalog's own message is
used — matching the `undefined`-message pattern already used elsewhere in this
file (`dispatcher.ts`, `ssrf.ts`, `routes/probe.ts`). `JOB_NOT_FOUND` is
untouched everywhere else: `JobStore.get`, the job/job-events routes, and their
tests all still mean "no such job" and still say so.

Both prerequisites named in the ticket were already in place from pl-11 — the
`NOT_FOUND` code, its `http-errors.ts` mapping, and its `error-presentation.ts`
copy — so this ticket was only the call site and its tests. One thing the brief
undersold: it named "`api/test/` has an unknown-path test asserting
`JOB_NOT_FOUND`" as singular, but — same as pl-11 found for the planner's
`web-serving.test.ts` equivalent — there were three, all in
`tools/downloader/api/test/web-serving.test.ts` (an unknown `/api` path with an
HTML `Accept`, the same with a JSON `Accept`, and an unknown path with no
`WEB_DIR` set). All three now assert `NOT_FOUND`. `routes.test.ts`'s "an
unknown job id" cases and `job-store.test.ts`'s lookup-miss case are genuine
`JOB_NOT_FOUND` and were left alone, as were `web/test/mock-api.test.ts`'s
`notReachableInTheMock` list (already carrying `NOT_FOUND`, per pl-11).

Also updated the stale comment in `api/src/http-errors.ts` that pointed at this
ticket as still-open ("Nothing raises it here yet ... which is dl-17's to
fix") — it now just says where `NOT_FOUND` is raised.

`npm run check` and `npm test -- --project downloader` (543 tests, 37 files)
are both green. Nothing in `packages/` was touched, so its suite was not
re-run.

**2026-08-22 — review follow-ups.** Review's point stood: the first pass was a
+3/-3 substitution inside existing assertions, and nothing pinned the
_distinction_ the ticket exists to establish — a refactor that quietly
re-merged the two codes would have left every existing suite green. Added
`tools/downloader/api/test/not-found.test.ts`, a small dedicated file with two
tests side by side: an unrecognised route (`GET /api/nope` → `NOT_FOUND`, 404)
and a recognised job route naming an id the store has no record of
(`GET /api/jobs/nope` → `JOB_NOT_FOUND`, 404). Chose a new file over folding
into `web-serving.test.ts` or `routes.test.ts` because the contrast is the
point of the test — splitting it across the two existing suites (which cover
route-serving and the HTTP surface respectively, for reasons of their own)
would bury the side-by-side read this ticket needs. `npm run check` and
`npm test -- --project downloader` re-run green: 545 tests, 38 files.

**`tools/downloader/docs/03-STATUS.md` was deliberately left alone.** Review
found stale prose below the generated region describing dl-17 as still open;
that cleanup belongs to repo-1's retirement of that hand-written narrative, not
to this ticket, and is being tracked there.

**2026-08-23 — the gate was reconstructed, and the absence is the point.**
`## Review` above was written months-late in
[repo-2](../../../../docs/work/repo-2-retire-the-status-page.md)'s branch, from
the orchestrator's transcript rather than from anything in the repo. This ticket
merged as #65 on 2026-08-22, hours before `docs/01-TICKETS.md` grew the rule that
**the builder commits the gate** — a rule `repo-1` earned by going through two
review rounds whose records were written into reviewer worktrees and thrown away
with them. dl-17 is the same loss one branch over: two rounds happened, the
second of them is why `not-found.test.ts` exists, and neither left a trace on
`main`. The pull request has no report comment either, so there is nothing to
hold the reconstruction against. That is exactly the gap the rule closes, and
this entry exists so the next reader knows the section above was recovered
rather than recorded.

The stale-prose finding in that gate is now moot: repo-2 deleted
`tools/downloader/docs/03-STATUS.md` outright. The page had gone on to list this
very ticket as `ready` for a week after it merged, because the job that was
supposed to regenerate it had never once been allowed to push.
