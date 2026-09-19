---
id: dl-59
tool: downloader
title: Cancelling a still-queued job never moves its row past "queued"
kind: fix
status: done
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

## Review

### Gate 2 — re-check of the gate 1 findings

**Gate: PASS** — 2026-09-17 · `483ca7d...c70dd8a` (tip `c70dd8a`; branch range `20c8fd1...c70dd8a`) · narrow re-check of F1–F5 only, scoped by the orchestrator; no fresh defect hunt · reviewer: Opus

| Done when                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test cancels a job that cannot start and the store row reaches canceled                                                | `tools/downloader/api/test/pipeline.test.ts:796 "expect(stored.status).toBe("` ✓ · `tools/downloader/api/test/pipeline.test.ts:845 "expect(readJob(harness, third.id).status)"` ✓                                                                                                                                                                                                                                                                                                                                                |
| The cancel response body reports canceled, not stale queued                                                              | `tools/downloader/api/test/per-client-caps.test.ts:393 "(canceled.json() as JobResponse).job.status"` ✓ — the identical lines in pipeline.test.ts (793, 844) cannot carry a distinct anchor; the reviewer mutated each and each failed                                                                                                                                                                                                                                                                                           |
| A restart after cancelling a still-queued job does not report INTERNAL; reconcileInterruptedJobs never sees a queued row | `tools/downloader/api/test/pipeline.test.ts:945 "expect(afterRestart.status).toBe("` ✓ · `tools/downloader/api/test/pipeline.test.ts:946 "expect(afterRestart.error?.code).toBe("` ✓ — a real restart over a file-backed database; reviewer re-ran it: exit 0 at `c70dd8a`, exit 1 `expected 'failed' to be 'canceled'` at line 945 with `queue.ts` and `routes/jobs.ts` at `20c8fd1`. Second clause also `tools/downloader/api/test/pipeline.test.ts:801 "store.unfinished().map((job) => job.id)).not.toContain(second.id)"` ✓ |
| `npm run check` and `npm test -- --project downloader` green                                                             | **verified** — at `c70dd8a`: check exit 0; downloader 85 files / 1432 tests, exit 0, against 1429 at `20c8fd1` (+2 cancellation specs, +1 restart spec); `node scripts/citations-gate.mjs --against origin/main` exit 0 — 84 enforced, 0 failing; 85 enforced, 0 failing with this section inserted, measured by the reviewer                                                                                                                                                                                                    |

- **resolved** · F1 (med) — restart spec added at the end of pipeline.test.ts; red→green reproduced by the reviewer as above. The Log now records the earlier substitution.
- **resolved** · F2 (med) — dl-51's four moved citations repointed; citations gate exit 0 at `c70dd8a` (exit 1 at `483ca7d`). Remedy (a), repoint, was the orchestrator's call, recorded in dl-51's Log.
- **resolved** · F3 (low) — `tools/downloader/api/src/routes/jobs.ts:167 "A no-op for a job that never started"` now names the orchestrator's path, and `tools/downloader/api/src/routes/jobs.ts:175 "For outcome"` scopes the stale-status note to a running job.
- **resolved** · F4 (low) — the false sentence about the brief's path is removed and the correction logged.
- **resolved** · F5 (low) — `tools/downloader/api/src/index.ts:37 "CancelOutcome, InProcessQueueOptions"`.
- **findings** · re-check of 5 carried findings: 5 resolved, 0 new, 0 dropped. No fresh hunt this round.
- NFR: unchanged from gate 1.

### Gate 1

**Gate: FAIL** — 2026-09-17 · `20c8fd1...483ca7d` (tip `483ca7d`) · defect hunt run in-context by the reviewer (Opus), medium depth

| Done when                                                                                                                | Proof at `483ca7d`                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test cancels a job that cannot start and the store row reaches canceled                                                | pipeline.test.ts lines 796 and 845 ✓                                                                                                                                                                                                  |
| The cancel response body reports canceled, not stale queued                                                              | per-client-caps.test.ts line 393 ✓                                                                                                                                                                                                    |
| A restart after cancelling a still-queued job does not report INTERNAL; reconcileInterruptedJobs never sees a queued row | **unproven** — second clause proven by the `store.unfinished()` assertion at pipeline.test.ts line 801; the first clause, a restart, was never run, though the existing file-backed restart spec at line 305 showed it costs one test |
| `npm run check` and `npm test -- --project downloader` green                                                             | **verified** — check exit 0; downloader 85 files / 1431 tests vs 1429 at `20c8fd1`; test diffs tighten booleans to outcomes, none deleted                                                                                             |

- **med** (F1) · the restart Done-when line was replaced by an `unfinished()` assertion without the Log saying so. A scratch spec (tmpdir sqlite, cancel the waiting job, shutdown, reopen) read `canceled JOB_CANCELED` at `483ca7d` and `failed INTERNAL The server restarted while this download was running.` with the source reverted, in 525 ms.
- **med** (F2) · `node scripts/citations-gate.mjs --against origin/main` exited 1 at `483ca7d` (0 at `20c8fd1`): 4 moved citations in dl-51's record, from the assertions inserted mid-test in per-client-caps.test.ts and the `CancelOutcome` block inserted in queue.ts. ci.yml's check job runs this gate. Remedy was an open decision (repoint, pin or restructure).
- **low** (F3) · in `api/src/routes/jobs.ts` at `483ca7d`, the comment at line 168 named a running-job path above that is not in the handler (it is in orchestrator.ts), and the comment at line 173 held only for outcome running.
- **low** (F4) · the Log said the brief named `api/src/queue.ts`; the brief says `api/src/jobs/queue.ts`.
- **low** (F5) · `api/src/index.ts` line 37 at `483ca7d` exported `JobQueue` without the `CancelOutcome` type its method returns. No external consumer.
- **dropped** · race between `queue.cancel` returning waiting and `store.transition`: none. The handler has no await between them and `tools/downloader/api/src/jobs/queue.ts:114 "const [removed] = this.#waiting.splice(index, 1);"` is synchronous; seven interleavings of the first job finishing around the cancel never produced a canceled row whose resolver or engine then ran.
- **dropped** · a repeat cancel answers 200 with the canceled row unchanged (updatedAt equal), and a job that moved waiting→running before the cancel reaches canceled through the orchestrator. Measured; not defects.
- **dropped** · `engine.removeJob` on a never-started job: run against a real `Storage`, resolves with no warning and leaves the tree unchanged.
- **findings** · hunt returned 8; 5 carried, 3 dropped.
- NFR: security n/a · performance n/a · reliability ✓ (race measured) · maintainability — the comment and Log lows above.

**Transcription disclosure:** both subsections above (Gate 2 and Gate 1) were
drafted by the reviewer (`ticket-reviewer`, agent `afcd56ac89c6f3864`, Opus) and
relayed to me by message; I committed them verbatim. Nothing altered or dropped
from either subsection's text — the only change from what was sent is `npx
oxfmt`'s table-cell padding, which touches whitespace only. This note itself is
mine, not the reviewer's.

## Log

- 2026-09-14 — Filed from dl-51's build. Reproduced on `origin/main` at
  `95c6403`: a temporary test (`createHarness` with `maxConcurrentJobs: 1`, a
  blocked resolver, two jobs, cancel the second) got a `200` response whose own
  `job.status` read `"queued"`, and the store row was still `"queued"` after a
  100 ms wait with nothing left to run. Not fixed here — dl-51's own scope is
  admission caps, and `onSettle` (dl-51) already gives a future fix here a
  clean signal to release per-client state from; this ticket is only about the
  store transition and the client-visible status.
- 2026-09-17 — Fixed. `InProcessJobQueue.cancel` now returns a
  `"running" | "waiting" | "not-found"` `CancelOutcome` instead of a boolean
  (`api/src/jobs/queue.ts`), so `routes/jobs.ts`'s cancel handler can tell a
  waiting job apart from a running one. `"waiting"` now takes the same branch
  `"not-found"` already did: a typed `JOB_CANCELED` error, `store.transition`
  to `"canceled"`, `events.status`/`events.canceled`, and `engine.removeJob`
  (verified a no-op for a job that never started — `Storage.removeJob` is
  `fs.rm(..., { force: true })`, which does not error on a missing directory).
  Reproduced red first: two new tests in `api/test/pipeline.test.ts`
  ("cancelling a job that cannot start yet reaches canceled, not stuck at
  queued" and "…that is not first in line still reaches canceled") both failed
  with `expected 'queued' to be 'canceled'` against the unfixed source, then
  passed after the fix — full run in the report to the dispatcher, not
  reproduced here. Also updated the boolean-returning assertions in
  `api/test/queue-and-shutdown.test.ts` to the new three-way outcome, and added
  the two missing assertions (response body and store row both reach
  `"canceled"`) to the existing dl-51 test in `api/test/per-client-caps.test.ts`
  that exercised this exact path but never checked job status — a small piece
  of already-specified work this branch made free, folded in rather than left.
  `npm run check` and `npm test -- --project downloader` (85 files, 1431
  tests) both green.
- 2026-09-17 — Gate (below) found four things this entry corrects:
  (1) the restart Done-when line was proven only indirectly, through
  `store.unfinished()`, and never by an actual restart — added
  `"a restart over a real database reports a canceled wait-line job as
canceled, not the interrupted-restart INTERNAL"` at the end of
  `api/test/pipeline.test.ts`, file-backed (`databasePath`, two `createHarness`
  calls over one SQLite file, the same shape as "a restart does not lose the
  preview of a job whose file survived it" above it in the same file),
  reproduced red against the source reverted to `20c8fd1`
  (`failed`/`INTERNAL`/"the server restarted while this download was
  running") and green at the fix; (2) the citations gate
  (`node scripts/citations-gate.mjs --against origin/main`) went red because
  the assertions added to `api/test/per-client-caps.test.ts` and the
  `CancelOutcome` doc block added above `JobQueue` in
  `api/src/jobs/queue.ts` moved four lines dl-51's own record cites —
  repointed those four citations to their new lines (the orchestrator's
  call, made itself rather than the reviewer's alternative of pinning them or
  restructuring the diff to avoid the move, on the grounds that a repoint is
  routine, reversible, and the same repair dl-61 made in this batch); (3) two
  comments in `routes/jobs.ts` misdescribed which code path they meant, fixed
  in place; (4) this entry previously claimed the ticket's own brief named a
  stale path (`api/src/queue.ts`) — it did not; the brief already says
  `api/src/jobs/queue.ts`, and the wrong path was mine, not the ticket's.
  Also exported `CancelOutcome` alongside `JobQueue` from `api/src/index.ts`
  so an external caller could name the type the interface's method returns,
  even though none exists today.
