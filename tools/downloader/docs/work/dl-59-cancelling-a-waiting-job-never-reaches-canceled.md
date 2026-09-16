---
id: dl-59
tool: downloader
title: Cancelling a still-queued job never moves its row past "queued"
kind: fix
status: ready
milestone: M5
depends_on: []
difficulty: standard
---

# dl-59 — Cancelling a still-queued job never moves its row past "queued"

## Why

Found while building [dl-51](./dl-51-one-client-holds-every-job-slot.md), which
needed `InProcessJobQueue` to tell a caller when a task leaves the queue on
every path, and added `onSettle`. Writing the waiting-cancel case of that
mechanism exposed a pre-existing gap, reproduced against `origin/main` at
`95c6403` before this ticket touched anything:

- `InProcessJobQueue.cancel(jobId)` on a job still in the wait line (never
  started running) splices it out and aborts its controller, then returns
  `true` (`api/src/jobs/queue.ts`).
- `POST /api/jobs/:id/cancel`'s handler (`api/src/routes/jobs.ts`) treats
  `true` from `queue.cancel` as enough: it writes nothing to the store and
  relies on a comment — "the orchestrator writes the terminal state when the
  abort unwinds" — that is only true for a **running** job. A waiting job's
  `run()` is never invoked at all, so the orchestrator never runs, never
  catches the abort, and never calls `store.transition(...)`.

Reproduced directly: create a job while `MAX_CONCURRENT_JOBS=1` and a first job
already holds the one running slot, so the second sits waiting; `POST` its
cancel route; the response is `200` and its own body still reports
`status: "queued"`; the store row stays `"queued"` forever afterwards — polling
`GET /api/jobs/:id` never shows `canceled`, and nothing else in this codebase
ever revisits the row. A restart's `reconcileInterruptedJobs` only catches jobs
the store calls `unfinished()`, which `"queued"` is, so it eventually fails as
`INTERNAL` "the server restarted while this download was running" — a false
description of a job it never ran a byte of, and only on the next restart, not
on cancellation.

## Build

1. In `routes/jobs.ts`'s cancel handler, distinguish "was running" from "was
   waiting" — `InProcessJobQueue` already knows which internally
   (`#running.get(jobId)` vs `#waiting`); either have `cancel` return which one
   it found, or transition the store directly for the waiting case the same
   way the "not in the queue at all" branch already does (typed `JOB_CANCELED`
   error, `store.transition(..., "canceled", ...)`, `events.status`/
   `events.canceled`).
2. Match the running-job path exactly: same error payload shape, same events,
   `engine.removeJob` is a no-op for a job that never started but is safe to
   call to keep the two branches symmetric — verify rather than assume.
3. Cover both orderings your fix might touch: canceling a job that is
   currently the _only_ one waiting, and canceling one waiting job while
   another sits ahead of it in the line (position in `#waiting` must not
   matter).

## Done when

- A test creates a job that cannot start (concurrency already full), cancels
  it, and asserts the store row reaches `"canceled"` — polling or otherwise,
  not merely that the HTTP response was `200`.
- The cancel response body itself reports `status: "canceled"`, not a stale
  `"queued"` snapshot.
- A restart after cancelling a still-queued job does not report it as
  `INTERNAL`/"the server restarted while this download was running" —
  `reconcileInterruptedJobs` never sees a `"queued"` row for it.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-14 — Filed from dl-51's build. Reproduced on `origin/main` at
  `95c6403`: a temporary test (`createHarness` with `maxConcurrentJobs: 1`, a
  blocked resolver, two jobs, cancel the second) got a `200` response whose own
  `job.status` read `"queued"`, and the store row was still `"queued"` after a
  100 ms wait with nothing left to run. Not fixed here — dl-51's own scope is
  admission caps, and `onSettle` (dl-51) already gives a future fix here a
  clean signal to release per-client state from; this ticket is only about the
  store transition and the client-visible status.
