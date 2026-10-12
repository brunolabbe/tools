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

**2026-10-12, later — stopped at the contract question (Build: "Contract
first").** Branch `dl-110` off `07acbb86`. No contract or source file is edited;
this entry is the proposal put to the owner, and the build waits on the answers.

_Proposed contract diff._ `contract/src/job.ts` imports `ProbeStage` from
`./resolver.ts` (which imports only `media.ts`, so no cycle) and `JobEvent` gains
one member, after `refused`:

```ts
  /**
   * The re-probe reached a point in the resolver chain (dl-110): the
   * `ProbeStageEvent` that `/api/probe/:id/events` carries, keyed by job. Sent
   * only while the job is `probing`. **Not persisted and not a status**: like
   * `refused` it is a moment, the job record does not change, and a client that
   * was not attached when it was sent never sees it.
   */
  | { type: "stage"; jobId: string; stage: ProbeStage; resolver: string; at: string }
```

`contract/src/api.ts`'s `jobEventSchema` gains the matching member, with
`stage: z.enum(PROBE_STAGES)` and `resolver: z.string().min(1)` exactly as
`probeEventSchema` validates them. Nothing else in the contract changes: no
error code, no `Job` field, no status, no route.

_What an old tab does with it._ Nothing, and nothing breaks. `web/src/api/http.ts`
`openJobEvents` runs every `data:` line through `parseJobEvent` and calls
`handlers.onEvent` only when it is not `null`; a frame that fails validation is
dropped there and never reaches `job-stream`, which therefore neither reconnects
nor fails the job. Measured against today's contract `dist` (the bundle an old
tab runs): `parseJobEvent` of a `stage` frame returned `null`, and a `status`
frame parsed beside it as the control. So Build step 4's failure case does not
occur, and the place that proves it is the transport in `http.ts`, not
`job-stream.test.ts`, which only ever receives parsed frames.

_Open decisions for the owner_, each with a recommendation:

1. **Where the stage text goes on the card.** The brief replaces the first
   progress message (the status line) with the stage text once one arrives. But
   the registry emits `resolver-start` before any resolver work, with no `await`
   before it in `ResolverRegistry.resolve`, and the only `await` between the
   `probing` status frame and it is `guard.assertAllowed` in `#probe` (a DNS
   check). So under the brief the status line — "Re-analysing the page for fresh
   stream links — signed links expire within minutes." — shows only for that
   check and is effectively never read. (Reasoned from the code, not timed.)
   - (a, recommended) Keep the status line first; the stage text is a second
     message under it, above the browser note: three messages while
     re-analysing. Keeps the "why"; costs one line on the card.
   - (b) As the brief: the stage text replaces the status line. Two messages;
     the "signed links expire" explanation is lost after the first instant.
2. **How Done when 4 is proven.**
   - (a, recommended) A test of `openJobEvents` in `web/test/http-client.test.ts`
     with a stubbed `EventSource`: a frame of an unknown type calls neither
     `onEvent` nor `onError` and does not close the source, and a known frame
     beside it does reach `onEvent` (the control). Pins the guarantee against a
     later refactor of the transport.
   - (b) Record the reasoning above and no test, as Done when 4 allows.
3. **The mock build narrates nothing.** `web/src/api/mock.ts` holds a job in
   `probing` for about 1.5 s (`buildSteps`) and emits no stage frame, so the UI's
   default dev mode — the mocked API, until `web/.env.local` points it at the
   real one — never shows the feature. The e2e suites run the real API and are
   unaffected.
   - (a, recommended) Fold in: the mock emits the scenario's existing stage script
     (`scenario.stages ?? DIRECT_STAGE_SCRIPT`) as job `stage` frames, scaled into
     its probing window, edited in `mock.ts` only (dl-108 edits `scenarios.ts`),
     with a case in `mock-api.test.ts`.
   - (b) Leave the mock silent and say so in this Log.
4. **The frame's name** (minor). `"stage"` sits beside `JobProgress.stage`,
   which is a `JobStatus`, not a `ProbeStage`, so `event.stage` and
   `job.progress.stage` would mean two different things in the same reducer.
   - (a, recommended) Keep `"stage"` as the brief says: it matches the probe
     channel's frame, and `probeStageText` takes the frame as it is.
   - (b) Name it `"probe-stage"`, so it cannot be confused with the progress field.

_Fold-in, decided here because it is implied:_ `STATUS_HINT`'s doc comment in
`web/src/lib/status.ts` says "the re-probe's own stages do not reach the job's
event stream", which this change makes false; it is rewritten with the build.

**2026-10-12, answered — decided by the owner**, through the orchestrator's
`AskUserQuestion`, relayed to the builder by message. Each choice was the
recommended option:

1. Contract diff and the frame's name — options: approve with `"stage"` /
   approve with `"probe-stage"` / not yet. **Approved as drafted above, named
   `"stage"`.**
2. Where the stage text goes — options: a second message above the browser note,
   three messages while re-analysing / replace the status line as Build step 3
   said. **A second message**; Build step 3's "becomes" is superseded.
3. Proof of Done when 4 — options: a test of `openJobEvents` in
   `web/test/http-client.test.ts` with a stubbed `EventSource` / the measurement
   in this Log only. **The test.**
4. The mocked API — options: `mock.ts` replays the scenario's stage script as job
   `stage` frames, with a case in `mock-api.test.ts` / leave the mock silent.
   **The mock sends stages.**
