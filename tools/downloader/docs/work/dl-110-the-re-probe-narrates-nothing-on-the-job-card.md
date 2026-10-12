---
id: dl-110
tool: downloader
title: The job card cannot narrate the re-probe, because its stages never reach the job's event stream
kind: work-package
status: ready
milestone: null
depends_on: [dl-109]
difficulty: hard
---

# dl-110 — Narrate the re-probe's stages on the job card

## Why

Opening a job's link re-probes the page before ffmpeg starts (dl-53), and that
is often the longest wait in a download: a browser-tier probe takes 10–20 s.
The browser shows nothing until headers arrive, so the job card is the only
sign the work is going on. Since [dl-109](./dl-109-the-job-list-still-describes-a-stored-file.md)
the card shows it as an indeterminate bar and a status-level progress message —
"Re-analysing the page for fresh stream links" — which stays fixed for the whole
wait.

The stages exist. The re-probe calls the same resolver chain as the first
analysis (`registry.resolve` in `api/src/jobs/orchestrator.ts`, in `#probe`,
which `#attempt` calls),
and the chain reports `resolver-start`, `page-load`, `provoke-playback`,
`manifest-fetch` and the rest through `ResolveOptions.onStage`. The first
analysis forwards them to `/api/probe/:id/events` (dl-43) and the analysis panel
narrates them with `probeStageText`. The re-probe passes no `onStage`, and
`JobEvent` has no frame that could carry one.

**Decided by the owner, 2026-10-12**, during dl-109: real stages, in a pull
request of their own after dl-109 rather than inside it, which shipped the
status-level line.

## Build

**Contract first** — raise the diff with the owner before editing, per the root
`CLAUDE.md`.

1. **Contract** (`contract/src/job.ts`, `contract/src/api.ts`). `JobEvent`
   gains `{ type: "stage"; jobId: string; stage: ProbeStage; resolver: string; at: string }`
   — the `ProbeStageEvent` the probe channel already carries, keyed by job. Add
   it to the event schema the client re-validates frames with. **Not
   persisted and not a status**: like `refused` (dl-77) it is a moment, and the
   job record does not change.
2. **API** (`api/src/jobs/orchestrator.ts`). Pass `onStage` to the re-probe's
   `registry.resolve` and publish each stage on the job's event hub. The
   registry already wraps a listener that throws; keep that guarantee.
3. **Web.** `job-reducer`'s `applyJobEvent` ignores `stage`. `useJobs` keeps
   the latest stage per job beside the list (the `refusals` map is the
   precedent) and drops it when the job leaves `probing`. The card's first
   progress message while `probing` becomes `probeStageText(stage)` once one
   has arrived, and stays the status line until then.
4. **Old pages.** A tab opened before the deploy runs the old bundle, whose
   schema does not know `stage`. Check what `job-stream` does with a frame that
   fails validation — if it reconnects or fails the job, the new frame breaks
   every old tab during a deploy, and the fix belongs here.

## Done when

1. A re-probe publishes at least `resolver-start` and one resolver stage on the
   job's event stream. Proven in the orchestrator's tests with a stub resolver.
2. A `stage` frame changes neither the job record nor what is persisted.
   Proven in `job-reducer.test.ts`.
3. The job card's first progress message while re-analysing is the text of the
   latest stage, and the status line before any stage arrives. Proven in
   `app.test.tsx` through the real `useJobs`.
4. A frame of a type an older client does not know does not fail or reconnect
   its job. Proven in `job-stream.test.ts`, or the brief's step 4 records why it
   cannot happen.

## Log

**2026-10-12**: filed from the owner's question during dl-109. Nothing built.
