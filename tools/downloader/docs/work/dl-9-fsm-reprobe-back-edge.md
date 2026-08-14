---
id: dl-9
tool: downloader
title: Give the job FSM a back-edge so a re-probe can be modelled honestly
kind: chore
status: done
milestone: null
depends_on: [dl-5]
---

# dl-9 — A back-edge for re-probing

**Package:** `tools/downloader/contract` (and one call site in
`tools/downloader/api`)

## Why

`JOB_TRANSITIONS` is strictly forward. [dl-5](./dl-5-api-and-orchestration.md)
required "on `VARIANT_GONE`, re-probe once and retry", but `downloading →
probing` is not a legal move, so the retry re-probes **in place**: the job stays
in `downloading`, `attempts` increments, and a fresh `probed` event is emitted.

That works and is tested. It is still a workaround: the job is doing one thing
and reporting another.

**This needs an owner decision before it can start.** The root `CLAUDE.md`
forbids editing a contract unilaterally, and this is a contract change with
siblings depending on it.

## Build

1. Add `probing` to `downloading`'s legal targets in
   `contract/src/job.ts`.
2. Have the orchestrator use it — see the note above `MAX_REPROBE_RETRIES` in
   `jobs/orchestrator.ts` — instead of re-probing in place.
3. Check the UI renders the resulting `downloading → probing → downloading`
   sequence sensibly. It should already: since
   [dl-7](./dl-7-ops-and-e2e.md), the client applies a status frame as a report
   rather than gating it on FSM adjacency.

## Done when

A job that hits `VARIANT_GONE` mid-download is observably in `probing` while it
re-probes, and the existing retry tests still pass against the new path.

## Log

Note from dl-7: the client no longer depends on the FSM's adjacency to interpret
a status frame, so the workaround is now invisible to the UI rather than merely
tolerable — a re-probe in place renders as a job still working. This is a
modelling improvement, not a bug the UI is papering over, which is why it is not
urgent.

**2026-08-14 — done.** Owner approved the contract change; the back-edge is in.

`downloading → probing` is now legal in `JOB_TRANSITIONS`, and the only
back-edge in the table. The orchestrator's probing block did not need
restructuring to use it: it already asked `canTransition(job.status, "probing")`
and fell back to a patch, so widening the table was enough to turn the retry
into a real status move. The fallback branch stays, and is now only reachable
for a failure that surfaces once `muxing` has begun — `muxing → probing` was
deliberately **not** added, because at that point the segments are already on
disk and there is nothing a fresh probe would fix.

Two things the brief did not mention, both found on the way:

- **Progress had to be reset with the transition.** Sending a job back to
  `probing` while its snapshot still carried the dead attempt's bytes would put
  a stale 50% under the "Re-analysing" label — a fabricated percentage of a
  download that was abandoned, which is exactly what the repo's "never fake
  progress" rule is about. The transition now patches
  `initialProgress("probing")`, **and emits a `progress` frame**: resetting the
  stored snapshot alone leaves a listening client showing the old bar, since it
  has no reason to re-fetch.
- **The UI needed no change**, as the brief predicted — but for a second reason
  beyond dl-7's report-not-request handling of status frames. `JobCard`'s
  stepper is driven by `statusIndex`, which is a plain lookup in
  `STATUS_ORDER`, so a backward move renders as the stepper stepping back.
  Nothing there assumed monotonicity.

Verification, all offline: `pipeline.test.ts` asserts the emitted sequence is
`downloading → probing → downloading → completed` and that the store reports
`probing` _at the moment the second probe runs_ (read from inside the stub
resolver, which is the only place that can observe it); a second test pins the
progress reset at `[512, 0]` on the wire. `job-store.test.ts` pins the edge at
the point it is enforced, including that `muxing → probing` still throws.

**The trap, for the next person:** the tests import `@downloader/contract`
through its package `exports`, which point at `dist`. A contract change is
invisible to every suite until `npm run build` runs — the first run here failed
with "Illegal job state transition" against a table that already had the edge in
its source. `npm run check` alone does not rebuild it.

509 tests pass (`--project downloader`), 547 across the repo, `npm run check` is
green.
