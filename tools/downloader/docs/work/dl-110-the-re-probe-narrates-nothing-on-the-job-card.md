---
id: dl-110
tool: downloader
title: The job card cannot narrate the re-probe, because its stages never reach the job's event stream
kind: work-package
status: done
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
3. While re-analysing, the card's status line stays first, the latest stage's
   text is the second message above the browser note, and before any stage
   arrives the card shows the status line and the browser note only. Proven in
   `app.test.tsx` through the real `useJobs`.
4. A frame of a type an older client does not know does not fail or reconnect
   its job. Proven in `job-stream.test.ts`, or the brief's step 4 records why it
   cannot happen.

## Review

**Gate: CONCERNS** — 2026-10-12 · `0484ae71..d1370584` (head `d137058472797b1c8f63cd356a723a28d25d002e`, a merge of `main` at the base into `dl-110`) · Sonnet 5.5, depth full

The branch does what the owner's answers of 2026-10-12 say, and what I could construct against it did not break it: a real re-probe over HTTP and SSE, a cancel mid-stage, a late subscriber, the probe channel, an old tab. Two things are recorded below. The branch has no test that a job's stage frames reach only that job, and Done when 3 still carries the wording the owner's answer 2 replaced. Nothing I found is a `high`; read the second `med` for the one place where the letter of `gate.md` would say otherwise.

| Done when                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A re-probe publishes at least `resolver-start` and one resolver stage on the job's event stream                       | **proven** — `api/test/pipeline.test.ts` › "resolver-start and the tier's own stage arrive between probing and downloading". The assertion that carries it is the exact frame order `probing`, `resolver-start by narrating`, `page-load by narrating`, `downloading`, `completed`, which also fixes "only while `probing`" for that path. With the orchestrator's `events.stage(jobId, event)` replaced by `void event`: 2 failed / 30 in `pipeline.test.ts` (this test and its sibling). I also ran it over a real listening server and the real `GET /api/jobs/:id/events` route, below.               |
| 2. A `stage` frame changes neither the job record nor what is persisted                                                  | **proven** — `web/test/job-reducer.test.ts` › "changes neither the job record nor what is persisted": `applyJobEvent` returns the same reference, `saveJobs` writes byte-identical storage, and `before` is non-empty, so "does not contain `page-load`" is not vacuous. The server half is not asserted by any branch test (the line, as worded, is the reducer's); I measured it: after stages, the stored job and `GET /api/jobs/:id` contain neither `page-load` nor `manifest-fetch`.                                                                                                                |
| 3. The card's first progress message while re-analysing is the latest stage's text, and the status line before any stage | **proven as decided, wording stale** — `web/test/app.test.tsx` › "a re-analysing card narrates the latest stage under its status line, and drops it when the job moves on" and "a stage sent back to back with the probing status is not lost to the render between them", both through the real `useJobs`; `web/test/job-card.test.tsx` › "a re-analysing card puts the latest stage under the status line, above the browser note". They assert the order of the owner's answer 2: status line, stage, browser note. The line as worded says the stage text is the first message. See the second `med`. |
| 4. A frame of a type an older client does not know does not fail or reconnect its job                                    | **proven** — `web/test/http-client.test.ts` › "a frame of a type this bundle does not know is dropped, and the stream carries on (dl-110)", the proof the owner chose. Carried by `onEvent` and `onError` never called, `source.closed` false, and the control `status` frame delivered (so "never called" is not vacuous). With `openJobEvents` changed to call `onError` on a frame that does not parse: 1 failed / 3. The integrated old-tab measurement is below.                                                                                                                                     |

**Measured, in the order the dispatch listed**

1. **Real re-probe over HTTP.** I listened on a port, opened real SSE streams, and drove jobs with a scripted tier behind the real registry and orchestrator (7 cases, 7 passed). Frames, as recorded:
   - Two concurrent jobs, A and B, with distinct stages interleaved: A's stream carries `queued, probing, progress:probing, resolver-start, page-load, manifest-fetch, probed, downloading, completed`; B's carries only B's frames. Each `stage` frame carries its own job id; no stage appears after the first non-`probing` status.
   - The real direct tier against a local origin: `resolver-start@direct`, `direct-head@direct`, between `progress:probing` and `probed`.
   - Cancel mid-stage, with a tier that also emits a stage while unwinding from the abort: `… page-load, settle-requests, status:canceled, canceled`. The unwinding stage is sent while the job is still `probing` (the orchestrator writes `canceled` after `registry.resolve` settles) and nothing follows the terminal frame.
   - A late subscriber, connected mid-probe: it receives `status:probing`, then only the stages emitted after it connected. Nothing is replayed.
   - A stage listener that throws: the existing hub subscriber case passes (`pipeline.test.ts`, the second dl-110 test). I added the orchestrator's own end: `events.stage` replaced with a function that throws, on the real app. The job still completed (1 of 1), through the registry's wrapper.
   - The retry over the `downloading → probing` back-edge: the second probe narrates again, after its own `status:probing` and `progress:probing`.
   - The probe channel `/api/probe/:id/events` is unchanged: its frames were `stage`, `stage`, `done`, each with `probeId` and none with `jobId`. `probe.ts`, `probe-stages.ts` and `routes/probe-events.ts` are not in the diff, and `probe-stages.test.ts` passes.
   - All 11 stage names plus `resolver-start` (12 frames), as the server writes them through `formatSseFrame`, parse with `parseJobEvent` and `jobEventSchema`.
2. **`stageAfter`, through the real reducer and `useJobs`** (9 sequences, all passed): a terminal frame then a late stage leaves the card with no messages at all; a stage before the `probing` status is lost (the server never sends that order); a stream that drops while a stage is held shows it through the gap, the connect-time `status` frame clears it, and the next stage shows; the back-edge's second `probing` starts from the status line; a `downloading` progress frame, a `canceled` pair, and a stage in one job's stream shown on one card only (two cards mounted). I could not leave a stale stage on a card that is not `probing`. The design depends on the route's first frame after every connect being a `status`; it is (`routes/events.ts`).
3. **Old tabs.** The `JobEvent` and `jobEventSchema` members are consumed by exactly one exhaustive switch (`applyJobEvent`, case added) and one non-exhaustive-by-construction function (`stageAfter`, see the first `low`); `isTerminalEvent` and the hub's `emit` are not switches over the union. In a scratch copy of the base tree with its own contract `dist`, I fed the base `createHttpClient().openJobEvents` and `createJobStream` the real stage frame: `parseJobEvent` returned `null`, the stream states stayed `connecting, open`, no reconnect was scheduled (0), no refetch ran (0), and the two `status` frames around the stage frames were delivered. **Positive control:** the same spec on this branch fails 2 of 2 (the stage is delivered).
4. **The mock.** I dumped every scenario's non-stage frames with their fake-clock offsets, base against branch, for all 15 scenarios (the default and 14 keywords). The only differences are the stage-frame counts (`0` becomes `2`, and `14` for `slow`); every other frame, type, status and offset is byte-identical. The web and contract suites pass at the head: 343 of 343 across 24 files.
5. **Owner answer 2.** The card shows, in order, the status line, the stage, then the browser note, and the status line is present before the first stage and after it (`app.test.tsx`; my sequences print the same three). It matches the Log.

**Positive control for isolation (as the dispatch asked), and the result**

- Mutation M1, the hub delivering a job's stage frame to every job's subscribers (`JobEventHub.stage`): 225 of 225 passed across `pipeline`, `refused-link`, `stream-link`, `routes`, `logging` and `probe-stages`. My real-run harness failed it (job A's stream received job B's frames), which proves the harness can see this fault.
- Mutation M2, the orchestrator forwarding each stage for every job in the store: 207 of 207 passed in the same suites minus `probe-stages`.
- Both survive, which is the first finding. The builder's own control (events.stage replaced by `void event`) does fail 2 of 30, as the Log says.

**Findings**

- **med** · no `Done when` line depends on it · **Nothing on the branch asserts that a job's stage frames reach only that job.** `JobEvent`'s own comment says the frame is "keyed by job", and two concurrent jobs is the default configuration, but the new `pipeline.test.ts` tests run one job. Reproduce: `bash <scratch>/run-gate.sh <tree> <out> M1` (R1 fails there: 1 failed / 7; with no mutation, 7 of 7 pass), or apply M1 with `node <scratch>/mutate.mjs <tree> M1` and run `npx vitest run tools/downloader/api/test/pipeline.test.ts` — it passes. The fix is fully stated: one test at the end of the dl-110 `describe` in `pipeline.test.ts`, which gates two jobs' resolvers on latches, subscribes to both on the hub, lets each emit a different stage, and asserts each subscriber's stage frames carry only its own job id and its own stages. It must fail under M1; check that, as the harness here did. This is a remedy and not a decision.
- **med** · **Done when 3 depends on it** · **The line's wording was not updated when the owner's answer 2 superseded Build step 3.** Done when 3 still reads "the job card's first progress message while re-analysing is the text of the latest stage", and three tests assert the opposite (status line first, the stage second). The Log records the owner's choice, its options and who gave it (answer 2, "a second message"), and says only that Build step 3's "becomes" is superseded; it says nothing about the line, and the Log's Done-when 3 entry proves it without noting the wording changed. By the letter of `gate.md`, a test that asserts the opposite of a line is a `high` and FAIL. I graded it `med` because the cause is the owner's recorded answer, not a build error, and I was told that answer is settled. If the orchestrator reads the letter as binding, this row is the one that moves the verdict to FAIL; the remedy is the same either way. Remedy, fully stated: reword the ticket's Done when 3 to "While re-analysing, the card's status line stays first, the latest stage's text is the second message above the browser note, and before any stage arrives the card shows the status line and the browser note only". That is the lander's or the author's edit to the brief; the gate does not make it.
- **low** · `nfr:maintainability` · **`stageAfter` has no compile-time exhaustiveness guard.** `applyJobEvent` returns `Job`, so a missing case is a type error; `stageAfter` returns `ProbeStageEvent | undefined`, so a missing case compiles and silently means "clear the stage". Reproduce in `web/src/lib/job-reducer.ts`: delete the `probed`, `refused` and `heartbeat` cases of `stageAfter`, then `npx tsc --noEmit -p tools/downloader/web/tsconfig.json` exits 0 with no output; delete the `stage` case of `applyJobEvent` and the same command prints `error TS2366: Function lacks ending return statement and return type does not include 'undefined'` and exits 1. No live call site today (all 9 members are covered); a tenth member will not be caught. Fix: end the switch with a `default` that assigns `event` to a `never` variable.
- **low** · `nfr:reliability` · **`stageAfter` and `useJobs.applyEvent` ignore `event.jobId` and `event.at`, which `applyJobEvent` checks for the job record.** A stage frame for `job-2` arriving on `job-1`'s stream shows on `job-1`'s card, and a stage older than the job's `updatedAt` is shown over a newer one (measured in two of my sequences). No live call site: the hub keys by job and SSE keeps order. It matters only with the first `med`, because the client is then not a second line behind the hub. `refusalAfter` has the same shape, so this is the precedent and not a regression.
- **dropped** · a probing-to-probing retry shows the first attempt's last stage until the next `resolver-start`, because that retry sends no `status` frame (measured by making a tier throw a re-probe-worthy code while `probing`). No live call site: only the engine raises `DOWNLOAD_FAILED`, `VARIANT_GONE` and `CONTAINER_UNSUPPORTED`, and only after the `downloading` transition, so every real retry crosses the back-edge and sends `status`.
- **dropped** · a stage frame after a terminal frame is held in `stages` (memory only, never rendered, and `clearSaved` does not drop it). The card reads a stage only while `probing`, and `refusals` behaves the same; not a defect.
- **dropped** · the card's second message sits in a `aria-live="polite"` list, so each stage change is announced. `AnalysingPanel` narrates the same stages the same way, so this is the existing behaviour for these stages.
- **dropped** · `01-ARCHITECTURE.md`'s "Two SSE channels" paragraph does not mention that the job channel now carries stage frames. It does not say it does not, so it is not false.
- **dropped** · the mock plays `slow`'s 14 browser beats inside the 800 ms probing window, which is fast for a reader. Owner answer 4 chose "scaled into its probing window".
- **findings** · the hunt returned 9; 4 carried (2 `med`, 2 `low`), 5 dropped.
- Invariants walked: contract edited with the owner's decision on record in the Log (met); no cross-tool import (met); no new error code and no bare `Error` (met); no shell, no URL or header logged, no SSRF surface (frame carries a stage name and a tier name only); no new workspace dependency, so no `Dockerfile` edit; no new test file, so nothing to register; style (`npm run check` exits 0 at the head). Skipped: process-tree kill, redaction (the diff touches neither).
- Branch `## Log`, read last: its three measured claims hold on re-running (`events.stage` dropped: 2 failed / 30; the stage judged against the rendered job: 1 failed / 27 in `app.test.tsx`; `openJobEvents` calling `onError`: 1 failed / 3), and its claim that today's contract rejects the frame holds (`parseJobEvent` returned `null`). Its "Done when 3" entry is the stale wording above.
- PR #453 at head `d137058472797b1c8f63cd356a723a28d25d002e`: all 11 checks pass — `check` (both), `test (ubuntu-latest)`, `test (windows-latest, informational)`, `e2e (direct)`, `e2e (sniffer)`, `docker`, `codeql`, `CodeQL`, `dependency-review`, `changes`. CodeQL needed no reading. No line depends on a CI leg alone.
- NFR: security ✓ (stage and tier names only) · performance ✓ (a handful of small frames per probe; `setStages` returns the same reference for heartbeats and progress ticks) · reliability ✓ (cancel, abort, throwing listener and late subscriber measured; one `low`) · maintainability — the first `med` and the first `low` above.

**Unmeasured:** the downloader project's full suite locally (CI's `test (ubuntu-latest)` ran it green at this head); a real browser tier, whose stages I stood in for with a scripted tier and the real direct tier; the `dl-108` reconciliation, which the dispatch excludes.

**Hand-back scripts** (scratch directory `gate-1`, not committed): `run-gate.sh <tree> <out-dir> [M1|M2|M4]` runs the real-run spec on any tree and removes it; `mutate.mjs <tree> <name>` applies M1, M2 or M4; `old-tab.test.ts` is the old-tab spec for a base tree; `zz-attack-body.tsx` holds the nine `useJobs` sequences (assemble with the head of `web/test/app.test.tsx` and its `watchOneJob`).

### Gate 2

**Gate: PASS** — 2026-10-12 · `d1370584..58761234` (head `587612343b04cccf80a38a57a5b4dc2769ca5a76`; the round is `68d6d936`, `a830a5ec`, `d0d566a1`, and the merge `58761234` brings in main's `32f8a994` (lg-8 docs), which I left out) · Sonnet 5.5, depth full for the round's lines

Nothing I found is a `high`, and no `med` is left, so no third gate. The unit matrix on PR #453 was still running when I read it once (below); no `Done when` line depends on it alone.

**Verdicts on gate 1's findings**

- **`med` — nothing asserted that a job's stage frames reach only that job: fixed.** `api/test/pipeline.test.ts` › "a job's stage frames reach only its own subscribers, with another job probing" parks two jobs in `probing` on two latches (`maxConcurrentJobs: 2`, `maxJobsPerClient: 0`), subscribes a listener per job, and asserts each listener's `stage` frames exactly: job a's are `resolver-start` and `page-load` with a's id, job b's are `resolver-start` and `ytdlp-run` with b's id. Both expected lists are non-empty, so it cannot pass on silence. I ran it on the head and under both mutations, in the test and in my harness:
  - At the head: `pipeline.test.ts` 31 of 31; the harness (`run-gate.sh`, no mutation) 7 of 7. The new test also passed once alone with the order shuffled.
  - **M1** (the hub delivers a job's stage frame to every job's subscribers): `pipeline.test.ts` 1 failed / 30 passed (31), the new test; the extra frames in job a's list are job b's `resolver-start` and `ytdlp-run`, which is what the fixer reported. The harness failed `R1` (1 failed / 7).
  - **M2** (the orchestrator forwards each stage for every job in the store): `pipeline.test.ts` 1 failed / 30 passed (31), the new test; job a's list gains `resolver-start` and `ytdlp-run` keyed to a. The harness failed `R1` (1 failed / 7). Gate 1's six suites passed M2 (207 of 207); this one does not.
  - Each mutation was restored with `git checkout` of the head's file and the tree is clean.
- **`med`, Done when 3 — the line's wording was stale: fixed.** The ticket's line now reads "While re-analysing, the card's status line stays first, the latest stage's text is the second message above the browser note, and before any stage arrives the card shows the status line and the browser note only", which is the sentence gate 1 stated. Re-traced against the tests: `web/test/app.test.tsx` › "a re-analysing card narrates the latest stage under its status line, and drops it when the job moves on" asserts `[status line, browser note]` before any stage, then `[status line, "Trying a real browser", browser note]` and `[status line, "Loading the page", browser note]`; `web/test/job-card.test.tsx` › "a re-analysing card puts the latest stage under the status line, above the browser note" asserts the same three-message order. Every clause of the new line is asserted. **proven.** The web and contract suites pass at the head: 343 of 343 across 24 files.
- **`low` — `stageAfter` had no compile-time exhaustiveness guard: fixed, with one new `low` below.** With the `probed`, `refused` and `heartbeat` cases deleted, `npx tsc --noEmit -p tools/downloader/web/tsconfig.json` now exits 1 with `error TS2322: Type '{ type: "probed"; … } | { type: "refused"; … } | { type: "heartbeat"; … }' is not assignable to type 'never'`, the fixer's code. With them in place `npm run check` exits 0.
- **`low` — `stageAfter` and `useJobs` ignore `event.jobId` and `event.at`: not fixed, deliberately, and recorded.** Unchanged since gate 1: no live call site, and the isolation test now pins the server end, so the client is no longer the only thing keeping a foreign frame off a card.

**New in the lines this round touched**

- **low** · `nfr:reliability` · **The new `default` branch of `stageAfter` returns the frame itself as the stage.** It ends `const unhandled: never = event; return unhandled;`. That compiles, and it is unreachable in a green tree (a new `JobEvent` member is now a type error, and the transport drops an unknown type before it reaches the hook). But if a frame of a type the switch does not handle ever got there, for instance a test casting one in, the result is that frame object, which `probeStageText` would then read as a stage. Reproduce: `TMPDIR=<short dir> node --import tsx <scratch>/gate-2/default-branch.mts <tree>` prints `held -> {"type":"from-the-future","jobId":"j","at":"2026-10-12T12:00:00.000Z"}` and `is the frame itself: true`, where before the round the switch fell through to an implicit `undefined` (clear the stage), by reading it; I did not run the old file. No live call site. Fix, fully stated: keep the `never` assignment, which is what makes a missing case a type error, and return `undefined` after it, so an impossible frame clears the stage as it did.
- **dropped** · the Log's round entry says "the three `app.test.tsx` assertions were right and unchanged"; the file has two tests and five assertions on the card's message order. The count is loose wording in a Log; the assertions are unchanged, which I checked in the round's diff (`app.test.tsx` is not in it).
- **findings** · the round's lines returned 2 candidates; 1 carried (`low`), 1 dropped.
- Invariants walked for the round's diff: no contract edit, no cross-tool import, no new error code, no new test file to register, no workspace dependency, no `Dockerfile` change, style (`npm run check` exits 0 at the head). The round's diff outside the ticket is two files, `api/test/pipeline.test.ts` and `web/src/lib/job-reducer.ts`; the `contract` `dist` from gate 1 is unaffected, so no rebuild was needed.

**PR #453 at head `587612343b04cccf80a38a57a5b4dc2769ca5a76`, read once.** The head matches. Passing: `CodeQL`, `codeql`, `check` (both), `changes`, `dependency-review`, `docker`, `e2e (direct)`, `e2e (sniffer)`. Pending when I read it: `test (ubuntu-latest)` and `test (windows-latest, informational)`. No `Done when` line is proven only by those legs: the new isolation test and the reworded line's assertions ran here, and the head's `check` job passed. Whoever lands this should read the two unit legs green on this head first.

**Unmeasured:** the two pending unit legs; the full downloader project locally.

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

**2026-10-12, built** to the answers above. The contract is the diff proposed
above, unchanged. The API passes `onStage` to the re-probe's `registry.resolve`
and publishes each stage through a new `JobEventHub.stage`; the store is not
touched. The web keeps the latest stage per job in `useJobs` beside
`refusals`, and the card shows it as a second message while `probing`, under a
new `search` mark. The mock replays the scenario's beats inside its probing
window.

Done when, each with the test that proves it:

1. `api/test/pipeline.test.ts` › "resolver-start and the tier's own stage arrive
   between probing and downloading", which asserts the exact frame order:
   `probing`, `resolver-start by narrating`, `page-load by narrating`,
   `downloading`, `completed`. With the orchestrator's `events.stage` call
   replaced by `void event`, it and its sibling ("a subscriber that throws on a
   stage frame cannot fail the job or silence the others") both fail.
2. `web/test/job-reducer.test.ts` › "changes neither the job record nor what is
   persisted": `applyJobEvent` returns the same reference, and `saveJobs` writes
   the same bytes before and after.
3. `web/test/app.test.tsx` › "a re-analysing card narrates the latest stage under
   its status line, and drops it when the job moves on", through the real
   `useJobs`. It also covers the back-edge, where a second `probing` shows the
   status line again and not the first attempt's last stage.
4. `web/test/http-client.test.ts` › "a frame of a type this bundle does not know
   is dropped, and the stream carries on (dl-110)". It fails when `openJobEvents`
   is changed to call `onError` on a frame that does not parse.

What the brief had wrong, beyond the answers above. **"Drops it when the job
leaves `probing`" cannot be judged against the job as last rendered.** The
server sends `status: probing` and the first stage back to back, and React can
fold both before re-rendering. A stage checked against the job held in
`jobsRef` would then be checked against a job still `queued`, and dropped. So
`stageAfter` decides from the frames alone: any `status` frame clears it, and so
do a `progress` frame that is not `probing` and a terminal frame. The card reads
the stage only while the job is `probing`. `app.test.tsx` › "a stage sent back
to back with the probing status is not lost to the render between them" fails
against the status-gated version (measured: 1 failed / 27).

Fold-ins. `STATUS_HINT`'s doc comment was rewritten, as recorded above.
`http.ts` gained a comment on why a frame that does not parse is dropped
rather than treated as a broken stream. `useJobs`'s two map-removals now share
one `without` helper. Not folded in: `refusals` keeps the entry of a removed job,
which this branch's `remove` now clears for `stages` only. It is harmless, since
a removed card is never read, and it is no part of this ticket.

Expected conflict: dl-108 widens `progressMessages` in `JobCard.tsx`, and this
branch adds a `stage` parameter to it. It is resolved by hand when `main` is
merged in after dl-108 lands.

**2026-10-12, gate 1 round (fixer).** Three findings, one commit each.

- _Done when 3 reworded._ The line still said the card's first progress message is the latest stage's text, which the owner's answer 2 above superseded: "**A second message**; Build step 3's "becomes" is superseded." It now reads: the status line stays first, the latest stage's text is the second message above the browser note, and before any stage arrives the card shows the status line and the browser note only. Reworded to match that answer, at gate 1's finding; the three `app.test.tsx` assertions were right and unchanged.
- _Isolation test._ `api/test/pipeline.test.ts` › "a job's stage frames reach only its own subscribers, with another job probing" parks two jobs in `probing`, each after a different stage, and asserts each subscriber saw only its own job id and its own stages. With the hub fanning a stage frame out to every job's subscribers (gate 1's M1) it fails; otherwise 31 of 31 pass.
- _`stageAfter` exhaustiveness._ The switch ends in a `never` assignment. Deleting its `probed`, `refused` and `heartbeat` cases now fails `tsc -p tools/downloader/web/tsconfig.json` with TS2322; before, it exited 0.

**2026-10-12, landing (fixer).** Gate 2's low on `stageAfter`'s `default` branch (it returned the frame itself, not `undefined`) was fixed at landing, at the owner's choice of "apply at landing", in the commit that carries this line. The `never` assignment stays; the branch now returns `undefined` after it. `node --import tsx <scratch>/gate-2/default-branch.mts <tree>` printed `held -> {"type":"from-the-future",…}` and `is the frame itself: true` before, and `held -> undefined` and `is the frame itself: false` after. With the `heartbeat` case deleted, `npx tsc --build tools/downloader/web/tsconfig.json` exits 2 with TS2322 at the `never` assignment; restored, it exits 0. The other recorded low (`event.jobId`/`event.at`) is left unfixed. The merge from `main` after dl-108 (#451) resolved the expected conflict above by keeping both: `progressMessages(status, stage, originConnections)`.
