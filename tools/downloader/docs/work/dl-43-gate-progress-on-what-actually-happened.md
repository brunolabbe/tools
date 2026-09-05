---
id: dl-43
tool: downloader
title: Gate the analyse and download progress on events that actually happened
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-43 — a gated progress bar, and something real for the analyse gates to read

**Packages:** `web` (`components/AnalysingPanel.tsx`, `components/JobCard.tsx`,
`components/ProgressBar.tsx`, `styles.css`), plus — for the analyse half only —
`contract`, `resolvers` (`registry.ts`, `resolvers/*.ts`, `browser/pool.ts`) and
`api` (`routes/probe.ts`).

**This ticket was scoped as pure UI and was deliberately widened.** The UI it
asks for cannot be drawn honestly from what the client is told today, so the
server work to tell it came in rather than the UI being faked.

**The governing rule, from the request: show as many stages as possible, and
every one must be real.** "Real" here has a precise test — a stage may only
appear because code reached the point that emits it. A stage that appears
because a timer elapsed is the defect this ticket exists to remove, not a
cheaper version of the fix.

## Why

### The download's five gates are real

`STATUS_ORDER` ([`web/src/lib/status.ts:24`](../../web/src/lib/status.ts)) is
`queued → probing → downloading → muxing → completed`, validated against
`JOB_STATUSES` in [`contract/src/job.ts`](../../contract/src/job.ts) so the list
cannot drift from the type. They arrive as job events over SSE, they are facts
about where the job has been, and a gated bar drawn from them is honest with no
new machinery. **This half is pure UI.**

One trap already solved and not to be regressed: `downloading → probing` is a
real back-edge (signed URLs expire mid-download), so a job can be _at_ a gate it
has already passed. `JobCard` keeps a separate high-water mark for exactly this
([`JobCard.tsx:29`](../../web/src/components/JobCard.tsx), and `reachedStep` in
[`status.ts`](../../web/src/lib/status.ts), whose comment is worth reading before
touching either). A gated bar must keep showing both — where the job is, and how
far it got.

### The analyse panel's five stages are not real, and never were

[`AnalysingPanel.tsx:10-16`](../../web/src/components/AnalysingPanel.tsx) keys
five lines to `elapsed >= afterMs` on a client-side timer. `/api/probe` is a
single POST that returns only when the whole probe is finished
([`routes/probe.ts:37`](../../api/src/routes/probe.ts)) — the browser sends one
request and hears nothing until the answer. **The panel narrates a wait it cannot
observe.**

The cruel detail: **the stage names are already right.** They describe phases
that genuinely happen, in that order. Only the trigger is invented. This is
wiring, not authorship.

Three defects follow, and only the first was in the original report:

1. **The narration is spoiled from second zero.** All five stages render at once
   — state is a class name, and [`styles.css:452`](../../web/src/styles.css) lays
   `.stages` out as `display: flex; flex-wrap: wrap`. So copy written to reassure
   at second 16 — _"Still going — some sites are slow to start playing"_ — is on
   screen at second 0, where it reads as a warning instead.
2. **The live region is inert.** The `<ol>` carries `aria-live="polite"`, but
   advancing a stage changes only `className` and `aria-current`. No text
   changes, so nothing is announced: a screen-reader user hears all five stages
   once and then silence. The `aria-current` work from dl-18 is still correct —
   it is the announcement that never fires.
3. **The indeterminate bar cannot move.** [`styles.css:436`](../../web/src/styles.css)
   draws it as a static `repeating-linear-gradient` with no animation, so a
   stalled probe and a healthy one are pixel-identical — the one distinction an
   indeterminate bar exists to make. (The reduced-motion block at
   [`:444`](../../web/src/styles.css) only disables the _determinate_ bar's width
   transition, so it is not the cause; there is nothing to disable.)

## What is actually observable

Every row below is a distinct `await` in existing code. Nothing here needs
inventing — it needs emitting.

| Stage                            | Where it already happens                                                                    | Shown today as               |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| Waiting for a free browser slot  | `#semaphore.acquire()`, [`browser/pool.ts:186`](../../resolvers/src/browser/pool.ts)        | "Opening a headless browser" |
| Launching / claiming the browser | `#launch` / `#shareBrowser`, [`browser/pool.ts:195`](../../resolvers/src/browser/pool.ts)   | same line                    |
| Loading the page                 | `navigate(page, url, …)`, [`browser.ts:202`](../../resolvers/src/resolvers/browser.ts)      | "Loading the page…"          |
| Provoking playback               | `provokePlayback`, [`browser.ts:208`](../../resolvers/src/resolvers/browser.ts)             | "Provoking playback…"        |
| Waiting for network quiet        | `waitForQuiet`, [`browser.ts:213`](../../resolvers/src/resolvers/browser.ts)                | "Waiting for the network…"   |
| Settling outstanding requests    | `collector.settle`, [`browser.ts:222`](../../resolvers/src/resolvers/browser.ts)            | nothing                      |
| Fetching the manifest            | `#loadManifest`, [`browser.ts:282`](../../resolvers/src/resolvers/browser.ts)               | nothing                      |
| Parsing the manifest             | `#parseManifest`, [`browser.ts:284`](../../resolvers/src/resolvers/browser.ts)              | nothing                      |
| Weighing a rendition             | `measureVariantSizes` (dl-30), [`browser.ts:303`](../../resolvers/src/resolvers/browser.ts) | nothing                      |
| Trying yt-dlp                    | `runProcess`, [`ytdlp.ts:191`](../../resolvers/src/resolvers/ytdlp.ts)                      | nothing                      |
| Trying the direct URL            | `#head`, [`direct.ts:129`](../../resolvers/src/resolvers/direct.ts)                         | nothing                      |

Two things fall out of that table.

**The first row is a real mis-report, not just a gap.** The pool is bounded by a
semaphore, so a probe arriving while every browser is busy _waits_ — and is told
"Opening a headless browser", which is not what is happening and does not explain
why it is slow. Concurrency makes this more likely exactly when the user is least
patient.

**Four phases at the end are invisible.** Settling, fetching the manifest,
parsing it and weighing a rendition all happen after the last narration line has
been shown, which is part of why the wait feels open-ended at the end.

## The open decision the builder must not resolve quietly

**Gates imply a known total, and analyse does not have one.** Two independent
reasons, and they pull against the request for a gated bar:

- **The tiers are a fallback chain, not a pipeline.** The download's five gates
  all happen, in order, every time — "3 of 5" means three-fifths done. The
  analyse tiers are alternatives: **exactly one succeeds and the rest never
  run.** If yt-dlp answers in two seconds, analyse finished having passed one
  gate of three. Reaching tier 3 is not 66% progress; it is the sign that the two
  cheaper paths failed. A bar that fills as the chain degrades says the opposite
  of what happened.
- **The stage count is not knowable in advance even within one tier.** The
  browser tier's manifest fetch and parse only occur if a manifest was seen;
  `measureVariantSizes` only if there is something to weigh.

So "more real stages" and "a gated bar" are both good and are in tension. Three
ways out:

- **A. Two widgets (recommended).** Gated bar for the download, where gates are a
  genuine pipeline and the total is fixed at five. For analyse, an indeterminate
  bar — properly animated per defect 3 — with the current real stage as a single
  line beneath it, replaced as it advances. Takes every row of the table above at
  full resolution, claims no total it does not have, and fixes defects 1 and 2
  for free: replacing the text _is_ a content mutation, so the polite live region
  starts working with no extra machinery.
- **B. Gated bar for both, analyse gates drawn as alternatives** — three doors,
  struck through as each is ruled out, with the fine-grained stages as the label
  inside the open one. Most informative and keeps one visual language. Needs real
  design work; there is no stock component for it.
- **C. Gated bar for both, drawn identically.** Cheapest, most consistent
  looking. Rejected: it reads as progress when it is degradation, and it would
  have to either hide most of the table above or invent a denominator. Recorded
  so it is not re-proposed.

## Build

1. **Contract first, and not unilaterally** — get the shape agreed before
   writing it. An optional stage callback on `ResolveOptions` plus a probe-stage
   type. Optional, so every existing caller and test is unaffected.
2. Emit from the points in the table. [`registry.ts:58`](../../resolvers/src/registry.ts)
   is the one place that knows a tier is starting — fire **before**
   `resolver.resolve`, or the last tier is never announced. The rest are emitted
   inside their resolver, next to the `await` that already exists.
3. Give the probe route a channel. **`/api/jobs/:id/events`**
   ([`api/src/routes/events.ts`](../../api/src/routes/events.ts)) is the model to
   follow, not to reuse — a probe has no job id. The cheapest fitting shape is a
   probe id minted on request with its own SSE endpoint; if a different one is
   chosen, say why in the Log, because this is the part most likely to be
   regretted.
4. Split `.stages` from `.steps` in [`styles.css`](../../web/src/styles.css).
   One rule serves both today, so every visual change below would otherwise land
   on the download pipeline as a side effect.
5. Gated bar for the download, preserving the back-edge behaviour above.
6. Apply the chosen analyse shape.
7. Animate the indeterminate bar — a travelling band — and give
   `@media (prefers-reduced-motion: reduce)` something to say about it. The still
   fallback must remain visibly different from a determinate bar at 0%.
8. Visual pass over the download card's bar, speed and ETA line in every state it
   reaches: `percent: null` live capture, a re-probing job, a failure.
   [`web/src/api/scenarios.ts`](../../web/src/api/scenarios.ts) drives the mock
   API and already covers the slow probe (_"An 18-second browser probe — the case
   the analysing indicator exists for"_). Use it rather than inventing fixtures.

**A probe answered on tier 1 must not flash the other two on its way to done.**
That is the acceptance most likely to be missed, because the happy path is the
fast one and it is tempting to test only the slow one.

## Done when

- A test proves a probe answered by the first tier never reports the second or
  third — no stage the code did not reach is ever shown.
- A test proves a probe held at the pool semaphore reports waiting for a slot,
  and not "opening a browser".
- A test proves a stage not yet reached is absent from the document, rather than
  present and greyed. It fails on `main`.
- A test proves the text a screen reader is given changes when a stage advances.
- A test proves a job that took the `downloading → probing` back-edge still shows
  both where it is and how far it got.
- The indeterminate bar animates, with the reduced-motion fallback asserted.
- Every state in `scenarios.ts` renders without layout jump, checked by hand
  against the running app and noted in the Log.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05 — filed** as a pure-UI pass over the analyse and download
  progress. The three defects were found while grounding that against a
  screenshot; defects 2 and 3 are not visible in it and were not part of the ask.
- **2026-09-05 — widened, deliberately.** Asked for gates, on the reasoning that
  the steps are already known. Checking that: the download's five are real and
  server-driven, and the request was exactly right about them. The analyse
  panel's five are a client-side timer and report nothing that happened. Given
  the choice between faking the gates, splitting the server work into its own
  ticket, or widening this one, **this one was widened** — the pure-UI constraint
  in the original filing no longer holds.
- **2026-09-05 — the stage inventory.** Follow-up guidance: more analyse stages
  is better, provided every one is real. The table above is the result of looking
  for how many actually exist — eleven, against the five currently narrated, and
  the browser pool's semaphore wait turned out to be actively mis-reported rather
  than merely missing. The tension between "more real stages" and "a gated bar"
  is recorded under the open decision rather than resolved, because it is a
  design call: gates need a denominator that analyse genuinely does not have.
