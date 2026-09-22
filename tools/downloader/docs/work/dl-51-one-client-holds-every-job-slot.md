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

## Review

### Gate 1 — `04c2fb7`

**Gate: CONCERNS** — 2026-09-14 · `95c6403...04c2fb7` · defect hunt run in-context by ticket-reviewer (Opus) at medium, plus source mutations and adversarial specs

**Disclosure:** transcribed verbatim from the reviewer's report by the builder (Sonnet 5); no severity, row, wording or verdict altered or dropped. The one mechanical change: this round's own repairs moved the lines several citations pointed at, so `@04c2fb7` was added to the 8 citations (and the fully-qualified citation each of 4 shorthand chains hangs off) that stopped resolving at the new tip — same reasoning as `dl-19`'s pre-existing `@da81902` pin, pointing at the pre-squash sha the gate actually reviewed. `node scripts/citations.mjs <this file> --section Review --require-anchors --require-distinct-anchors` reports 26/26 verified, 0 moved, exit 0 after the pins.

| Done when                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Step-1 test fails on `origin/main`, passes on the branch, Log records both  | `tools/downloader/api/test/per-client-caps.test.ts:107 "toEqual([201, 201, 429, 429, 429])"` ✓ — verified: the same body run against the `95c6403` api/src failed `expected [ 201, 201, 201, 201, 201 ] to deeply equal [ 201, 201, 429, 429, 429 ]`, and is green at `04c2fb7`. The Log records both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Over `MAX_JOBS_PER_CLIENT` gets `RATE_LIMITED`, a second client is admitted | `tools/downloader/api/test/per-client-caps.test.ts:124-142 "MAX_JOBS_PER_CLIENT gets a well-formed RATE_LIMITED"` ✓ · `:145 "createJob(harness, clientB)).statusCode"` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A job past `MAX_QUEUED_JOBS` is refused, not queued                         | `tools/downloader/api/test/per-client-caps.test.ts:147-174 "MAX_QUEUED_JOBS refuses a new job immediately"` ✓ — asserts the 429. Not queued follows from the throw coming before `store.create`, and the gate race spec confirmed `waiting` stays at the cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Count released after completion, failure, cancel and timeout                | completion `tools/downloader/api/test/per-client-caps.test.ts:205-229 "released after a job completes"` ✓ (see low below) · failure `:266-286 "released after a job fails"` ✓ · timeout `:311 "finished.error?.code).toBe("` ✓ · cancel while running `:323-357 "released when a running job is canceled"` ✓ · cancel while waiting `:399 "jobClientGate.count(clientKey(clientA))).toBe(1)"` ✓ · shutdown, the count-released-to-zero assertion in `tools/downloader/api/test/per-client-caps.test.ts` at the reviewed commit `04c2fb7` (line 389), reading `expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(0);` — that exact text now also occurs in an unrelated admission-throw spec added since the gate, so it can no longer be pointed at a single line ✓ |
| The probe route has the equivalent per-client cap, with its own test        | `tools/downloader/api/test/per-client-caps.test.ts:439-494 "MAX_PROBES_PER_CLIENT gets a well-formed RATE_LIMITED"` ✓ · `:491 "expect(other.statusCode).toBe(200)"` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run check` and `npm test -- --project downloader` green                | **verified** at `04c2fb7` — `npm run check` exit 0; downloader project 76 files / 1290 tests, exit 0, against 75 / 1265 with api/src and api/test at `95c6403`: +1 file, +25 tests, which is 19 in `per-client-caps.test.ts` and 6 in `queue-and-shutdown.test.ts`. The two existing tests that changed only set `maxJobsPerClient: 0` (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                         |

- **med** · `tools/downloader/api/src/routes/jobs.ts@20eb8ba:81 "const releaseJobSlot = context.jobClientGate.tryAcquire(key);"` takes the per-client slot before `context.store.create` (`tools/downloader/api/src/routes/jobs.ts` at the reviewed commit `04c2fb7`, line 96, reading `const job = context.store.create({`) and `tools/downloader/api/src/routes/jobs.ts@20eb8ba:112 "context.queue.enqueue({"`, and nothing releases it if either throws: the only release is the `onSettle` handed to `enqueue`. Reproduced with a gate spec, not committed: `maxJobsPerClient: 2`, `context.store.create` replaced by a function throwing `new AppError("DISK_FULL")`, two POSTs from one address (both 507), `create` restored, then a valid POST from that address answers `429` with `jobClientGate.count` at 2. Two storage failures lock that client out of job creation until restart, which step 5 of the brief calls worse than no cap. `enqueue` also throws once `close()` has begun, reachable across the `tools/downloader/api/src/routes/jobs.ts@20eb8ba:57 "await context.guard.assertAllowed"` suspension, but only during shutdown.
- **low** · two findings, one mechanism: duplicating either waiting-path release, `tools/downloader/api/src/jobs/queue.ts:119 "removed?.task.onSettle?.();"` or `tools/downloader/api/src/jobs/queue.ts:132 "entry?.task.onSettle?.();"`, turns no spec red in `per-client-caps.test.ts` or `queue-and-shutdown.test.ts`. The queue specs for those two paths assert a boolean (the "fires for a task canceled while it was still waiting" test in `tools/downloader/api/test/queue-and-shutdown.test.ts` at the reviewed commit `04c2fb7`, lines 332-358; and its "fires for every waiting task dropped at shutdown" sibling at the same commit, lines 394-415 — both titles have since gained an "exactly once" prefix), so the documented exactly-once is pinned on four of six exit paths. Harmless today only because the release is idempotent.
- **low** · `tools/downloader/api/test/per-client-caps.test.ts:31 "releasing twice does not free two"` cannot fail against the defect it names: deleting `tools/downloader/api/src/per-client-gate.ts:49 "if (released) return;"` leaves it green, because at `limit: 1` the second release lands on the `tools/downloader/api/src/per-client-gate.ts:51 "?? 1) - 1"` floor at zero. With a limit of 2 and two acquisitions, a double release would show.
- **low** · the completion spec waits on the `waitFor` in `tools/downloader/api/test/per-client-caps.test.ts` at the reviewed commit `04c2fb7` (lines 210-212), labelled `"job to finish"`, whose predicate accepts `failed` as well as `completed`, so that row would stay green if the completion path regressed into failure. Unverified here whether this spec completes today; the same stub completes in `pipeline.test.ts`.
- **low** · the Log says the new `onSettle` block holds 7 tests. It holds 6: `queue-and-shutdown.test.ts` has 15 `test(` calls at `95c6403` and 21 at the tip.
- **open decision** · queue-full raises `RATE_LIMITED` with its copy rewritten at `tools/downloader/api/src/routes/jobs.ts@20eb8ba:71 "working through as many jobs as it can hold"`. It is tool-wide capacity, not a client going too fast, and the web error panel titles every `RATE_LIMITED` Too many requests / Slow down, which is the repo stated tell of a wrong code. It is also exactly the shape the existing `probe-gate` refusal has on `95c6403`, which dl-57 records as a capacity signal, and core has no capacity code. (a) Keep `RATE_LIMITED`, consistent with `probe-gate`: recommended for this branch. (b) Add a core capacity code for both refusals: a core taxonomy change, its own ticket. Not counted toward the verdict.
- **dropped** · `TRUST_PROXY=true` keys on the leftmost, client-supplied `X-Forwarded-For` entry (gate spec: three spoofed first hops through one proxy, all admitted). That is the pre-existing meaning of `true`, warned against at `tools/downloader/api/src/config.ts@95c6403:215 "or better, to the"` and shared with every limiter. Not a dl-51 defect.
- **checked, no finding** · client identity: `TRUST_PROXY` off, three `X-Forwarded-For` values from one socket give `[201, 201, 429]`; behind a CIDR-trusted proxy the key is the forwarded client and a prepended spoofed hop is ignored, `[201, 201, 429, 201, 429]`; `::ffff:203.0.113.7` counts as `203.0.113.7`, and one /64 as one client. Races: 6 concurrent creates from one client at cap 2 admit 2; 5 concurrent at cap minus one admit 1; 5 concurrent distinct clients with the wait line at `MAX_QUEUED_JOBS` minus one admit 1 and `waiting` ends at the cap; 4 concurrent probes at cap 1 admit 1. There is no suspension between the checks and `enqueue`. Codes: the per-client job cap, the per-client probe cap and queue-full all raise core `RATE_LIMITED`, and the per-client probe refusal is thrown outside the handler body dl-57 records in, matching that agreement.
- **checked, no finding** · mutations, each run against `per-client-caps.test.ts` and `queue-and-shutdown.test.ts`: deleting the waiting-cancel release in `queue.ts` turns 2 specs red; the `close()` waiting-drop release, 2; the `#pump` finally release, 9; the `onSettle: releaseJobSlot` wiring in `jobs.ts`, 6; the outer `clientReleaseProbe()` in `probe.ts`, 3; duplicating the `#pump` release, 3. A leak loop (15 rounds of 2 failing jobs; 10 rounds of cancel-running plus cancel-waiting; one client, cap 2) is green at the tip and red under the waiting-cancel, `#pump` and wiring deletions, which is its positive control. Removing `maxJobsPerClient: 0` from the two changed existing tests turns both red with `expected 429 to be 201`; neither is about admission, and `MAX_CONCURRENT_JOBS is respected` keeps its meaning better with the cap off, since a cap of 2 would bound its peak by itself.
- **checked, no finding** · dl-59 reproduced on `95c6403`: cancelling a job waiting behind a blocked one answers 200 with body `queued`, and after 300 ms the store row and `GET` still read `queued` while the job is gone from the queue. Same at the tip, so not introduced here. `npm run status -- --json` exit 0. dl-53 changes only its `depends_on` line.
- **checked** · `citations-gate.mjs --against origin/main` at `04c2fb7` exits 1 on `repo-33` and `pl-38` only, the two records the owner directed pinned inside this branch after this gate.
- **findings** · in-context hunt returned 8; 7 carried (the two duplicate-release findings share a bullet), 1 dropped.
- Invariants: codes from core ✓ · contract untouched ✓ · no new workspace dependency, so no Dockerfile edit ✓ · new spec registered by glob and counted ✓ · no `console` or `any` ✓ · the client key in the new warn lines is already logged by the existing rate-limit hook ✓. Skipped as untouched by the diff: shell, URL redaction, SSRF, progress.
- NFR: security ✓ (identity above) · performance ✓ (the per-client map deletes a key at zero) · reliability — the med above · maintainability — the lows above.

### Gate 2 — `d331300`

**Gate: PASS** — 2026-09-14 · `04c2fb7...d331300`, whole branch `95c6403...d331300` · ticket-reviewer (Opus), repairs re-verified by source mutation

**Disclosure:** transcribed verbatim from the reviewer's report by the builder (Sonnet 5); nothing altered or dropped.

- Every Gate 1 Done-when row stands at `d331300`: its pinned citations resolve, and the completion row now waits on `tools/downloader/api/test/per-client-caps.test.ts:218-220 "job to complete"` alone.
- **med, repaired** · `tools/downloader/api/src/routes/jobs.ts@20eb8ba:122-123 "releaseJobSlot();"` releases the slot on any throw from `store.create` or `enqueue`, proven by `tools/downloader/api/test/per-client-caps.test.ts:235-261 "released when admission itself throws"` (`:260 "expect(third.statusCode).toBe(201)"`). Deleting that release turns the spec red, `expected 2 to be +0`.
- **low, repaired** · the two waiting-path releases are now counted, not flagged: `tools/downloader/api/test/queue-and-shutdown.test.ts:332-365 "fires exactly once for a task canceled while it was still waiting"` and `tools/downloader/api/test/queue-and-shutdown.test.ts:399-421 "fires exactly once for every waiting task dropped at shutdown"`. Duplicating the cancel-waiting release, or the `close()` waiting-drop release, turns the matching spec red, `expected 2 to be 1`.
- **low, repaired** · `tools/downloader/api/test/per-client-caps.test.ts:31-41 "releasing twice does not free two"` now runs at a limit of 2 with two acquisitions; deleting the gate idempotence guard turns it red, `expected +0 to be 1`.
- **low, repaired** · the completion predicate is narrowed as above, and the Log count reads 6.
- **low** · the repair-round Log entry at `d331300` gives the suite as 1290 tests with the same counts as before the round, and the citation gate as 80 records; measured 1291 tests and 81 records. To be corrected in the commit that records this gate.
- **open decision** · the queue-full code from Gate 1 is unchanged on this branch and sits with the orchestrator, settled by neither builder nor reviewer. Not counted toward the verdict.
- **verified** · at `d331300`: `npm run check` exit 0; downloader project 76 files / 1291 tests, exit 0 (1290 plus the admission-throw spec); `node scripts/citations-gate.mjs --against origin/main` exit 0, 81 records, 0 failing; `npm run status -- --json` exit 0. The `repo-33` and `pl-38` edits change only the moved citations, to `@95c6403`, line and anchor unchanged. The Gate 1 section as committed matches the reviewer text apart from table padding, the disclosure note and its `@04c2fb7` pins.
- **findings** · this round returned 1 new; 1 carried, 0 dropped.
- NFR: reliability ✓ now that the admission-time leak is closed; security, performance and maintainability as Gate 1.

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
  describe block (6 tests) and end-to-end through the routes in
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
  touch. **Superseded below**: the owner later chose to land both pins inside
  this branch anyway.

- 2026-09-14 — **Gate 1 repair round**, responding to the ticket-reviewer's
  findings at `04c2fb7` (Opus, medium effort, in-context defect hunt plus
  mutation testing and adversarial specs against the running app).

  **Repaired:**
  - **med** — the per-client job slot leaked if `store.create` or
    `queue.enqueue` threw between the acquire at `routes/jobs.ts` and the
    `onSettle` handed to `enqueue`, since neither call was guarded and no
    other release existed for that window. Reproduced the reviewer's repro
    (`store.create` mocked to throw `DISK_FULL` twice from one client, cap 2):
    before the fix, both throws answered `507` and the slot count stayed at
    `2` — the client would have been locked out until restart, which is the
    "worse than no cap" case Build step 5 warns against. Fixed by wrapping
    `store.create` and `queue.enqueue` in a `try`/`catch` that releases the
    slot and rethrows on any failure; ownership passes to `onSettle` only
    once `enqueue` returns without throwing. Test committed:
    `per-client-caps.test.ts` — "the per-client slot is released when
    admission itself throws, not just when the job later settles" (uses
    `vi.spyOn` on `context.store.create`, not a hand-rolled mock).
  - **low** — the two waiting-path `onSettle` releases in `queue.ts` (the
    cancel branch and the `close()` drop) were each covered only by a
    boolean flag, so a duplicate call at either site turned no spec red.
    Rewrote both specs in `queue-and-shutdown.test.ts` to count invocations
    and assert exactly `1`; reproduced the reviewer's mutation locally
    (duplicating either release line) against both the old and new spec
    versions — old: green under the duplicate; new: red,
    `expected 2 to be 1`, at both sites. Reverted the mutations after
    confirming.
  - **low** — `per-client-caps.test.ts`'s "releasing twice does not free
    two" used a limit-1 gate, where a correct single release and a buggy
    double release land on the same zero floor and the assertion cannot
    tell them apart. Reproduced: deleting `per-client-gate.ts`'s
    `if (released) return;` guard left the old spec green. Rewrote with a
    limit of 2 and two acquisitions, releasing only one of them twice; the
    same deletion now fails, `expected +0 to be 1`. Reverted the mutation
    after confirming.
  - **low** — the "released after a job completes" spec's `waitFor`
    predicate accepted `"failed"` as a terminal state alongside
    `"completed"`, so a regression into failure would have still passed.
    Narrowed to `"completed"` only; a real regression now times the
    `waitFor` out instead of passing.
  - **low** — this Log undercounted the `onSettle` describe block as 7
    tests; it holds 6. Corrected above.
  - **Owner-directed, not a finding:** push the branch after committing,
    every round — done below. And: pin `docs/work/repo-33-...`'s and
    `tools/planner/docs/work/pl-38-...`'s moved citations to `@95c6403`
    inside this branch, overriding my earlier caution about not touching a
    `repo-*` record or a `tools/planner/` file without asking — the owner
    decided to land both here, accepting a line in the planner changelog.
    Both re-verified individually with
    `node scripts/citations.mjs <record> --section Review --rev origin/main`
    (0 moved, exit 0 on both), and
    `node scripts/citations-gate.mjs --against origin/main` now reports
    **0 records failing** — 81 records once this ticket's own `## Review`
    section (below) is committed, where it reported 2 failing, across 80
    records, before this round.

  **Argued, not repaired — relayed to the orchestrator as an open decision,
  not settled here:** whether the queue-full refusal (and, by the same
  question, the pre-existing probe-gate refusal) should keep `RATE_LIMITED`
  with rewritten copy, or get a new core capacity code. The reviewer flagged
  this as tool-wide-capacity shaped, unlike the per-client caps' ordinary
  `RATE_LIMITED` use, and asked that neither of us change the code on this
  branch unilaterally. Recommendation from the reviewer, which I agree with
  for this branch: keep `RATE_LIMITED`, matching the existing `probe-gate`
  precedent on `95c6403` exactly — a new core code is a taxonomy change
  bigger than this ticket and belongs in its own ticket if the owner wants
  it. Not acted on here.

  **Re-verification after the repair round:** `npm run check` exit 0;
  `npx vitest run --project downloader` 76 files / 1291 tests, exit 0 — the
  same file count as before the round, and one more test than the 1290 at
  `04c2fb7`: the new admission-throw spec, added to an existing describe
  block. `node scripts/citations-gate.mjs --against origin/main` reports 81
  records once this ticket's own `## Review` section is committed, 0 failing.
  Pushed at the tip named to the reviewer.

- 2026-09-15 — **The open decision, answered by the owner.** Put to them as:
  the queue-full refusal (`routes/jobs.ts`) raises core `RATE_LIMITED` with
  its copy rewritten, the same shape the pre-existing `probe-gate` refusal
  already has on `main` (`probe.ts:112-115`) — tool-wide capacity, not one
  client going too fast, and the web UI titles every `RATE_LIMITED`
  "Too many requests / Slow down" (`web/src/lib/error-presentation.ts:157-161`).
  Options: **(a)** keep `RATE_LIMITED` for both refusals, consistent with the
  existing `probe-gate` precedent; **(b)** keep it for now and file a ticket
  for a new core capacity code covering both. Both builder and reviewer
  recommended (a). **The owner chose (a).** No code change and no ticket
  filed; the "Slow down" title on a capacity refusal is an accepted cost,
  not a defect to fix here.

- 2026-09-15 — Gate 1's citations pinned to `04c2fb7`, the branch commit this
  PR deletes on merge, were repaired on the owner's instruction. The 5 roots
  and 6 shorthand members that still resolve at the tip were re-pointed and
  unpinned; the 4 that no longer resolve anywhere (the code they described
  was fixed after the gate: `jobs.ts`'s admission code wrapped in a
  try/catch, the completion spec's `waitFor` label and predicate changed, and
  both `queue-and-shutdown.test.ts` titles gained an "exactly once" prefix),
  plus the one shorthand whose anchor text now matches two lines
  (`:389 "...toBe(0)"`, ambiguous rather than moved), were rewritten as prose
  naming the reviewed commit instead of guessed at. No finding, verdict or
  anchor text changed.

- 2026-09-15 — Merged `origin/main` (bringing in dl-60's own citation repair,
  #255) to add four pins of its own: this branch's code adds lines to
  `probe.ts`, `jobs.ts` and `config.ts`, which dl-60's merged Review section
  cites unpinned at the lines those files held before this branch. Same
  practice this ticket already used for six citations pinned to `@95c6403`
  — a branch that moves a cited line pins that citation. The four were
  pinned to `@cbfdbba` (#252's merge commit on main, where the cited lines
  and anchors are exact), in `dl-60-guard-embedded-ipv4.md`, not this
  ticket's own record.

- 2026-09-17 — dl-59's branch added lines to `per-client-caps.test.ts` and
  `queue.ts` ahead of four citations in this record's Review section, moving
  each down: `per-client-caps.test.ts:395`→`399`, `:487`→`491`,
  `queue.ts:114`→`119`, `queue.ts:127`→`132`. Repointed to their new lines —
  same anchor text, same verdict, nothing else changed. The orchestrator made
  this call itself (repoint rather than pin `@20c8fd1` or restructure the
  diff to avoid the move) as routine and reversible, the same repair dl-61
  made in the same batch, without asking the owner first.
