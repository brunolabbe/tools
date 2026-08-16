---
id: pl-16
tool: planner
title: The plan run — a job, its progress, and the plan it writes
kind: work-package
status: done
milestone: P2
depends_on: [pl-5, pl-9]
---

# pl-16 — The plan run

**Packages:** `contract` (a decision first), `api`, `web`

## Why

[pl-5](./pl-5-orchestrator-and-fan-out.md) built the fan-out and stopped at a
seam it was told not to cross. `runFanOut` turns a brief into a candidate set and
`compose` turns a candidate set into a revision, and **the only place those two
meet is a unit test** — nothing starts a run over HTTP, nothing persists what
comes back, and nobody watching a page can tell that seven specialists are
working. A tool whose output exists only inside `vitest` has not produced a plan.

This is pl-5's Build step 4 and its `web` half, split out rather than left as a
checklist on a ticket whose other seven steps are done — [docs/01-TICKETS.md](../../../../docs/01-TICKETS.md)'s
own advice. It is split rather than finished because **the first step is a
decision about `@planner/contract`**, and pl-5's instructions were explicit that
the contract is not edited unilaterally. That decision is step 1 below, and it is
deliberately not pre-made here.

Everything downstream of it is ordinary: a table, a queue, a route, a component.
`01-ARCHITECTURE.md`'s _A plan run is a job_ section and its configuration table
already describe the whole thing.

## Build

1. **Decide what the contract carries, and add exactly that.** Four things want a
   home and each is a separate call:
   - **`RunStatus` and its `TransitionTable`**, on `@webtools/core`'s machinery.
     The states are in the architecture's job diagram. The downloader keeps its
     job FSM in its contract because `web` renders the state and `api` enforces
     it; the same argument applies here, and it is still an argument rather than
     a foregone conclusion.
   - **A `RunEvent` union and its zod schema** — the SSE frames. `@planner/agent`
     already has `FanOutProgress`, tested, carrying exactly the per-specialist
     information a UI needs. **Do not map between two shapes.** Either the
     contract's type replaces it and the agent imports it, or the agent's stays
     and `api` wraps it — pick one, because two names for one event is how a
     frame gains a field on one side only.
   - **`ROUTES.plans`, `ROUTES.plan`, `ROUTES.runEvents`** and their url helpers,
     beside the intake's.
   - **A `Run` summary** for what `POST /api/plans` answers with.

   None of the four changes anything that exists, which is the argument for
   adding them; that they are four more types in a package with no runtime logic
   is the argument for weighing each one.

2. **Migration 4 — `plan_runs`.** Migration 2 already has `plans`,
   `plan_candidates`, `plan_revisions`, `plan_days` and `plan_items`, and its own
   comments anticipate this ticket adding the run a candidate came from. A run
   needs its status, its plan, its roster size, when it started and finished, and
   its error when it has one. Never edit a shipped migration.

3. **The run orchestrator in `api`.** Brief in from the intake, plan row created
   **before** the fan-out so the run has somewhere to report to,
   `runFanOut` → `compose` → `appendRevision`, statuses moved through the table
   on the way. `latestRevision` returns `null` for a plan whose first run has not
   finished and the contract says so on purpose — that state is reachable from
   the moment the plan row is written.

4. **`GET /api/runs/:id/events`, SSE.** The downloader's `routes/events.ts` is the
   working implementation and the three things it gets right are the three worth
   copying: a heartbeat, teardown of _both_ the subscription and the timer on
   disconnect, and a terminal frame that ends the stream. Send the current state
   immediately so a client that connected late is not staring at `queued`.

5. **The budget, from the environment.** `RunBudget` is already a required
   argument to `runFanOut`; this is the layer that fills it from
   `MAX_SPECIALISTS`, `RUN_TOKEN_BUDGET` and `MAX_OUTPUT_TOKENS`, plus
   `MAX_CONCURRENT_RUNS` on the queue. **A plan run is expensive enough to be a
   trivial DoS vector**, so rate-limit run creation per client — the downloader's
   `rate-limit.ts` is the second-consumer question to answer while you are there.

6. **Progress in the UI.** "4 of 7 specialists done", because the roster's size is
   fixed before the fan-out starts and that is genuinely knowable. Where a total
   is not knowable, `null` and an indeterminate state — never a percentage.

Traps worth knowing in advance:

- **Cancel has to reach the provider.** `runFanOut` takes an `AbortSignal` and
  every in-flight `ModelRequest` carries it. A cancel route that only moves a row
  to `canceled` leaves the fan-out running and the bill accruing.
- **A cancellation is not a `PlanGap`.** pl-5 rethrows rather than recording one,
  precisely so a canceled draft cannot look like a completed one with holes. A
  run that catches at this layer must not undo that.
- **`ComposeResult.unchecked` does not survive a reload**, and this ticket is
  where it would be persisted if persisting is the answer. It is
  [pl-10](./pl-10-plan-view-and-provenance.md)'s decision, not this one's —
  coordinate rather than each solving half of it.
- **`no-candidates-found` now has two producers.** The orchestrator raises it for
  a specialist that ran and returned nothing; the composer raises it for one that
  returned candidates and got none of them onto a day. Same reason, different
  sentence, and both are already written for a reader — do not collapse them.
- **At `MAX_SPECIALISTS = 5` the budget specialist is dropped on every shape that
  rosters six.** That is the cap working, and it will be the most visible thing
  about the first real run. Decide whether the number is right before it becomes
  a bug report rather than after — the default was chosen before there was a
  roster to apply it to.

## Done when

- A run started over HTTP fans out, composes, and leaves a `PlanDetail` in the
  database that `GET` returns — asserted end to end against the scripted
  provider, with no key.
- The SSE stream reports the roster's size before the fan-out and one event per
  specialist after it, and ends on a terminal state.
- A run canceled mid-fan-out stops the provider calls, ends as `canceled`, and
  writes no revision — asserted.
- One specialist failing produces a plan that ships with its gap, over the wire
  and out of the database rather than only in memory.
- A roster over `MAX_SPECIALISTS` is degraded before the fan-out and the drop is
  on the stored revision.
- Run creation is rate-limited per client, asserted.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-08-16 — done

A run started over HTTP now fans out, composes, and stores a revision; the SSE
stream shows it happening; cancelling reaches the provider. Branched off pl-5
(PR #32), which is itself on pl-15 (#31), because none of `runFanOut`, the roster
or the specialists is on `main` yet.

**The four contract additions, as landed.** All additive; nothing existing
changed shape, was renamed or was removed. Three of them are a new
`contract/src/run.ts`; the routes went into `api.ts` beside the intake's.

1. **`RunStatus` and its table.** `RUN_STATUSES`, `RUN_TRANSITIONS`,
   `TERMINAL_RUN_STATUSES` (derived, not listed) and `canRunTransition`, on
   `@webtools/core`'s `TransitionTable` — the downloader's `JOB_TRANSITIONS`
   shape exactly.
2. **One progress payload and one envelope.** `RunProgress` + `runProgressSchema`
   is the contract's, and **`FanOutProgress` is deleted**: `@planner/agent`'s
   `orchestrator.ts` imports and emits the contract's type. `RunEvent` +
   `runEventSchema` is the envelope `api` stamps the run id and the clock onto.
3. **`ROUTES.plans` / `.plan` / `.runEvents`** with `planUrl`, `runEventsUrl`,
   plus `CreatePlanRequest` / `createPlanRequestSchema` for the POST body.
4. **`Run` + `runSchema`** — what `POST /api/plans` answers with (202).

**Two additions beyond the four, both flagged rather than smuggled.**

- **`ROUTES.runCancel` and `runCancelUrl`** — a fourth route. "Done when" requires
  a run canceled mid-fan-out to stop the provider calls and end as `canceled`, and
  there is no way to assert that without something to POST to. Additive, and the
  brief's own first trap is what asks for it.
- **A `snapshot` frame on `RunEvent`**, carrying the whole `Run`. The route has to
  send the current state on connect, and there was no honest `RunProgress` to
  replay for a late client: every variant but `roster` names a specialist, and
  naming one to carry a count would be a frame the server made up. The `Run`
  already carries `rosterSize` and `specialistsDone`, so it is sent as itself.
  This also removed the need for a `GET /api/runs/:id`.

**What the brief got wrong, or did not know.**

- **The architecture's `reviewing` state has no observable boundary.** pl-9 built
  the critic _inside_ `compose()` — pack, critique, feed back, pack again, return
  once — so `api` cannot see the changeover. The state is kept (it is the
  architecture's, and a critic pass with its own cost is a thing we will want to
  show) and `composing → done` is a legal edge, so nothing has to emit `reviewing`
  to make a diagram come true. Recorded on `RUN_TRANSITIONS`, in the architecture,
  and in a test that names the reason.
- **`BRIEF_INCOMPLETE` had no HTTP status.** It fell through `STATUS_BY_CODE` to
  500, so the first "your intake is not ready" answered as a server error. Now
  400 — the request is well formed, the document behind it is not, and `details`
  names the missing slots so the wizard can go and ask them.
- **`RUN_TOKEN_BUDGET` has nowhere to live on `RunBudget`.** `RunBudget` is
  `{maxSpecialists, maxOutputTokens, maxAttemptsPerSpecialist}` and adding a
  fourth field would have been an `agent` change. It did not need one: the budget
  **divides down into a specialist count** and takes the lower of that and
  `MAX_SPECIALISTS`, which is §9's "degrade the roster rather than exceed it"
  read literally. A budget too small for even one specialist floors at zero
  rather than one — "run nothing, here are the gaps" is truthful; quietly running
  one anyway is not.
- **The plan store is `api`'s fifth package dependency.** `@planner/api` had no
  `@planner/itinerary` and no `@webtools/core`; both are now in its
  `package.json` and its `tsconfig` references. `capacityFor` assembling
  `TripCapacity` from `dayCapacity` + `tripSpan` is why — `agent` still does not
  import `itinerary`, exactly as the architecture's table says.

**The second-consumer question, answered twice and differently.**

- **The rate limiter moved.** `RateLimiter`, `clientKey` and `ConcurrencyGate` are
  now `@webtools/core/rate-limit`; the downloader imports them from there and
  keeps only `createRateLimitHook`, because refusing a request means throwing
  _that_ tool's `AppError` through _that_ tool's logger. A **subpath** rather than
  the barrel: it imports `node:net`, and core's root is in every `web` bundle's
  graph by way of the contracts — exporting it from `index.ts` put `node:net` in
  the browser build, which Vite said out loud.
- **The queue did not.** The downloader's `InProcessJobQueue` is the same shape,
  but its task is keyed on a `jobId` and it aborts with the downloader's
  `AppError`, and the error a cancellation carries is the one part of a queue that
  is not generic. `01-ARCHITECTURE.md` had already committed this tool to "an
  in-process queue, as the downloader chose" — the same decision, not the same
  code. `api/src/runs/queue.ts` says all of this at the top. Lift it on a third
  consumer.

**pl-16 changed `tools/downloader`, and that is worth saying plainly** — a
planner ticket editing another tool is exactly the thing this repo's layout
rules exist to prevent, so a reader of the downloader's history should be able to
find out why from here. The lift above is the whole of it, and nothing in the
downloader's behaviour changed:

- `tools/downloader/api/src/rate-limit.ts` lost `RateLimiter`, `RateLimitDecision`,
  `RateLimiterOptions`, `clientKey` and `ConcurrencyGate` to
  `@webtools/core/rate-limit` and kept `createRateLimitHook`.
- `context.ts`, `server.ts`, `index.ts` and `test/rate-limit.test.ts` import them
  from core instead; `api/package.json` and `api/tsconfig.json` gained the
  dependency and the project reference.
- The downloader's own tests are unchanged except for that one import line, and
  its CI gate is green.

It is scope beyond what the ticket asked for. The justification is the repo rule
it would otherwise have broken: the alternative was a second copy of a token
bucket in `tools/planner/api`, and "shared code moves to `packages/` on the
second real consumer" is the rule that copy would have violated — the ticket's
own Build step 5 names the question. If a reviewer would rather have had the
copy, the revert is one file plus five import lines.

**`MAX_SPECIALISTS` stays at 5, decided rather than overlooked.** The last trap
asked whether the number is still right now that a roster exists. It is: the cap
has to stay a constraint something actually reaches, the composer sums the cost
bands in code whether or not a budget specialist ran, and the drop is a
`specialist-dropped-for-budget` gap on the stored revision rather than a silence.
A test drafts a `multi-city` brief (six on the roster) and asserts the dropped
specialist is `budget` and that the gap survives to the database, so the
degradation path stays exercised.

**For pl-10.** `ComposeResult.unchecked` is still not persisted and this ticket
deliberately did not choose — the orchestrator says so at the call site. Neither
of pl-10's two options got harder: **re-deriving on read** is if anything cheaper
now, because `plan_candidates.run_id` (migration 4, the column migration 2
anticipated) means the exact candidate set a revision was composed from is
recoverable, and the brief snapshot beside it makes the composer's inputs
complete. **Persisting behind a new `PlanGapReason`** is unchanged in cost: gaps
are JSON on `plan_revisions`, so it is not a migration. The one thing pl-10
should know is that the run's SSE stream carries no `unchecked` today, so a
client sees it only by reading the plan — which is the reload case, and the
reason the decision is still open.

**Traps that held.** A cancellation is still rethrown rather than recorded: the
run's catch moves the row to `canceled` and writes **no revision at all**, and a
test asserts both that and that every in-flight `ModelRequest` saw the abort.
`latestRevision` returning `null` is a state three tests exercise — the plan row
is written before the fan-out, so it is reachable for the whole run. Nothing here
collapses the two producers of `no-candidates-found`.

**pl-12 conflict avoided.** No `tools/planner/web/test/` was added and
`tsconfig.tests.json` was not touched; the progress UI is asserted through the
API's SSE suite instead. The `web` change is `api/plan.ts`, `plan/RunView.tsx`,
the checkpoint's second button (whose placeholder comment said Phase 2 owned it)
and a `.run-progress` block in `styles.css`.

**Numbers.** 457 planner tests across 35 files, 1,020 repo-wide. `npm run check`
green. Migration 4 adds `plan_runs` and `plan_candidates.run_id`; the two
migration suites that pin `user_version` moved from 3 to 4.

### 2026-08-16 — the image gate, afterwards

`npm run check` and `npm test` were both green and the image still would not
boot. `.github/workflows/planner.yml` built it, started it, and the container
never became healthy:

    ERR_MODULE_NOT_FOUND: Cannot find package '@planner/itinerary'
      imported from /app/tools/planner/api/dist/runs/orchestrator.js

**`tools/planner/Dockerfile` lists its workspaces by hand, in two places, and
`itinerary` was in neither.** It has existed since pl-9, but nothing in `api`
imported it until this ticket put `compose` in the run orchestrator — so the
first consumer pays for the Dockerfile line, and that was me.

The rule worth carrying, now written above the lines themselves: **adding a
workspace to `api`'s dependencies costs two edits to that file, and the two fail
differently.**

- Miss the **runtime** pair (`package.json` + `dist`) and the container starts,
  reports nothing wrong, and throws `ERR_MODULE_NOT_FOUND` when the code path is
  first reached. That is the failure the existing comment above `intake`'s lines
  already described.
- Miss the **build-stage manifest** and `npm ci` never creates the workspace
  symlink at all, so there is nothing for the runtime stage to copy. That is the
  half that actually broke here, and it is why the manifest list is not merely a
  layer-cache optimisation.

Nothing else I added has the same shape. `@webtools/core/rate-limit` is a new
**subpath** on a package whose `package.json` and whole `dist` the runtime stage
already copies, and the subpath is what carries the `exports` map — confirmed by
importing it rather than assumed. The full set of workspaces the built API
imports is `@planner/{contract,intake,itinerary,agent}` and `@webtools/core`, and
all five now have all three lines.

**Docker is not available in the environment this was fixed in**, so the image
was not built and run here — this is verified by checking every bare workspace
specifier in `tools/planner/api/dist` against the Dockerfile's copy lines, and by
resolving `@webtools/core/rate-limit` for real. The gate is the actual proof.

A cheap way to stop this recurring, not built and offered rather than assumed
wanted: the check above is a dozen lines and is the same shape as
`packages/core/test/spawn-safety.test.ts` — a source scan asserting a rule the
comments currently carry. It would have failed on this PR before CI did.
