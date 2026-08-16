---
id: pl-16
tool: planner
title: The plan run — a job, its progress, and the plan it writes
kind: work-package
status: ready
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

_Not started._
