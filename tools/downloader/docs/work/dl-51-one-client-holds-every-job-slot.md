---
id: dl-51
tool: downloader
title: One client can hold every job slot, and nothing bounds the queue behind them
kind: fix
status: done
milestone: M5
depends_on: []
difficulty: standard
---

# dl-51 — One client holds every job slot

**Packages:** `api` (the job route, the probe route, the queue, config), and
the settings lists in `.env.example` and `01-ARCHITECTURE.md`.

## Why

**Admission is per minute, and occupancy is not bounded per client.** This was
found by reading the code, not by running it. The first build step turns it
into a failing test.

- `POST /api/jobs` is behind a token bucket of `RATE_LIMIT_JOBS_PER_MINUTE`
  (default 5) keyed on the client address (`rate-limit.ts`). The bucket limits
  how fast a client _starts_ jobs, not how many it _has_.
- `InProcessQueueOptions` in `jobs/queue.ts` takes a `concurrency` and nothing
  else. There is no bound on how many jobs wait.
- `MAX_CONCURRENT_JOBS` defaults to 2 and `JOB_TIMEOUT_MS` to one hour.

So one address can run both slots and keep adding five jobs a minute behind
them, and every other visitor's download waits for all of it. Behind Access that
address was always the owner. Once [dl-49](./dl-49-open-without-a-login.md)
removes the login, it is anyone. The probe route has the same shape: a global
`probeGate`, a per-minute bucket, and no per-client count of probes in flight.

## Build

1. **Write the reproduction first**, as an API test with fixtures. With
   `MAX_CONCURRENT_JOBS=2`, one client key creates five jobs against a slow
   fixture download. Then show a second client key's job only waits, with no
   bound. Run it before the fix and record in the Log that it failed.
2. **Cap jobs in flight per client**, running and waiting together, with a new
   setting (suggested `MAX_JOBS_PER_CLIENT`, default 2). Refuse over the cap
   with `@webtools/core`'s `RATE_LIMITED`. Do not queue the excess. Use the
   bucket key the jobs limiter already uses (`clientKey(request.ip)`), so
   `TRUST_PROXY` means the same thing for both.
3. **Cap the waiting line globally** (suggested `MAX_QUEUED_JOBS`). Past it, a
   new job is refused immediately, not accepted to wait an hour.
4. **The same per-client cap for probes in flight**, sharing the pattern. A
   probe holds its gate slot for up to `PROBE_TIMEOUT_MS`.
5. Release the count on every exit path: success, failure, cancel, timeout and
   shutdown. A leaked count locks a client out until restart, which is worse
   than no cap. Test each path.
6. `0` disables each cap, like the rate limits. Add both to `.env.example` and
   the architecture's settings table.

**Trap:** CGNAT and shared offices put many people behind one address. The cap
counts jobs _in flight_, not per minute, so a busy shared address waits a moment
rather than being locked out for a minute. Say so in the setting's comment.

## Done when

- The step-1 test fails on `origin/main` and passes on the branch, and the Log
  records both runs.
- Tests prove a client over `MAX_JOBS_PER_CLIENT` gets `RATE_LIMITED` while a
  second client is admitted.
- Tests prove a job past `MAX_QUEUED_JOBS` is refused, not queued.
- Tests prove the per-client count is released after completion, failure,
  cancel and timeout.
- The probe route has the equivalent per-client cap, with its own test.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-13 — Filed from reading `jobs/queue.ts`, `rate-limit.ts` and
  `config.ts` on `origin/main` `1835657`. Not yet reproduced by a test, which is
  why that is step 1.
- 2026-09-14 — Built on `dl-51-per-client-job-cap`, branched from `origin/main`
  at `95c6403`.

  **Step 1, run before the fix.** Wrote a throwaway spec depending only on
  pre-existing helpers (so it runs unchanged with or without the new source),
  then `git stash push -u` on just the seven source files this ticket touches
  (not the new test), leaving `95c6403`'s versions in the tree. Ran
  `npx vitest run tools/downloader/api/test/zzz-dl51-repro-temp.test.ts`:
  `AssertionError: expected [ 201, 201, 201, 201, 201 ] to deeply equal
[ 201, 201, 429, 429, 429 ]` — client A's five job creations against a slow
  fixture download all succeeded, exactly the reported bug. Restored with
  `git stash apply` (not `pop`), verified `git status` matched the pre-stash
  tree, dropped the stash entry, deleted the throwaway spec. The permanent
  version of this test lives at
  `tools/downloader/api/test/per-client-caps.test.ts:79` ("one client cannot
  hold every running slot and queue behind it without bound") and now passes.

  **What the brief left for the builder to decide, and how:**
  - `MAX_QUEUED_JOBS` had a suggested name but no suggested default. Derived
    it from `MAX_CONCURRENT_JOBS` the same way `MAX_CONCURRENT_PROBES` is
    derived from `MAX_CONCURRENT_BROWSERS` — `4 ×`, named
    `QUEUED_JOBS_PER_CONCURRENCY_SLOT` in `config.ts` — rather than a flat
    number, so raising concurrency does not silently starve the default queue
    depth. Ships as `8`.
  - The probe cap's setting name wasn't given; used `MAX_PROBES_PER_CLIENT`,
    default `2` (matching `MAX_JOBS_PER_CLIENT`'s reasoning: one client should
    not hold both of the default two running/browser slots).
  - These are ordinary application defaults, not policy for anonymous
    production traffic — dl-52 (`needs-decision`) already carries
    `MAX_JOBS_PER_CLIENT → 1` as its own proposed production value in
    `compose.downloader.prod.yaml`, which this ticket does not touch. No
    anonymous-traffic-specific value was picked here; see the "Open decision"
    note below for the one place this could have brushed against dl-52 and
    didn't.

  **The queue itself needed a new signal.** `InProcessJobQueue.enqueue`'s
  `run(signal)` only settles for a task that actually started — a job
  cancelled or dropped-at-shutdown while still _waiting_ never reaches `run`
  at all (existing test: "cancelling a waiting task stops it ever running").
  Added an optional `onSettle` to `QueuedTask`, called exactly once regardless
  of path (ran to success/failure/timeout, cancelled while running, cancelled
  while waiting, or dropped at shutdown), and used it in `routes/jobs.ts` to
  release the per-client slot uniformly. Covered in
  `tools/downloader/api/test/queue-and-shutdown.test.ts`'s new `onSettle`
  describe block (7 tests) and end-to-end through the routes in
  `per-client-caps.test.ts`.

  **Found and NOT fixed here — filed as
  [dl-59](./dl-59-cancelling-a-waiting-job-never-reaches-canceled.md):**
  writing the waiting-cancel path of `onSettle` exposed that cancelling a
  still-queued job (one that never started running) never moves its store row
  past `"queued"` — `routes/jobs.ts`'s cancel handler assumes the orchestrator
  will write the terminal state "when the abort unwinds", which is only true
  for a job that was running. Reproduced against `origin/main` at `95c6403`
  with a temporary test before filing, not against this branch, so it is not
  something dl-51 introduced. Out of scope here (this ticket is admission
  caps, not cancellation-state consistency), and `onSettle` gives dl-59's fix
  a clean signal to build on.

  **Fold-in, as directed:** `dl-53`'s frontmatter changed from
  `depends_on: []` to `depends_on: [dl-50, dl-51]`, since its Build step 3
  ("GET on the link takes the job slot (dl-51's per-client cap counts it)")
  presupposes both dl-50's check and this ticket's cap. Nothing else in dl-53
  touched.

  **Open decision — none needed.** Re-checked whether landing this would force
  an answer to dl-52's open question (a cap value or policy specifically for
  anonymous traffic): it does not. `MAX_JOBS_PER_CLIENT`'s default of `2` here
  is the same kind of application default every other setting in this file
  already ships with (`MAX_CONCURRENT_JOBS=2`, `RATE_LIMIT_JOBS_PER_MINUTE=5`,
  …), sized for the "single trusted user on a laptop" baseline
  `02-DEPLOYMENT.md` already describes, not for anonymous production traffic —
  dl-52 retunes it (to `1`) separately, in `compose.downloader.prod.yaml`,
  which this ticket does not edit. So there was nothing to put to the owner.

  **Verification.** `npm run check` (lint, format, typecheck) and
  `npx vitest run --project downloader` both green — 76 files / 1290 tests,
  run last at the tip of this branch after the citations-gate pass below. No
  test was weakened to make this pass; two pre-existing tests
  (`pipeline.test.ts`'s "MAX_CONCURRENT_JOBS is respected",
  `routes.test.ts`'s "a job id is not guessable") created several jobs from
  one simulated address with no `maxJobsPerClient` override and started
  failing under the new default; both now pass `maxJobsPerClient: 0`, since
  neither test is about per-client admission.

  **Citations gate.** `node scripts/citations-gate.mjs --against origin/main`
  found 8 records with a citation into a file this branch moved lines in (none
  under `docs/work/repo-*`... except one, `repo-33`, which the branch owner
  asked not to be touched here). Pinned 6 downloader-owned records
  (`dl-19`, `dl-32`, `dl-34`, `dl-43`, `dl-45`, `dl-46`) to
  `path@95c6403:line`, each re-verified individually with
  `node scripts/citations.mjs <record> --section Review --rev origin/main`
  (0 moved, 0 unresolvable, exit 0 on all six). Left `repo-33` and
  `tools/planner/docs/work/pl-38-...` alone on the orchestrator's instruction —
  the first is repo-wide and out of this ticket's ground by the standing rule,
  the second is under `tools/planner/`, which this dispatch was told not to
  touch.
