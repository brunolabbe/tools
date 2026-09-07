---
id: dl-43
tool: downloader
title: Gate the analyse and download progress on events that actually happened
kind: work-package
status: done
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
| Waiting for a free browser slot  | `#semaphore.acquire()`, [`browser/pool.ts:234`](../../resolvers/src/browser/pool.ts)        | "Opening a headless browser" |
| Launching / claiming the browser | `#launch` / `#shareBrowser`, [`browser/pool.ts:246`](../../resolvers/src/browser/pool.ts)   | same line                    |
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

## Decision — answered 2026-09-06, not open

**The question was:** analyse's tiers are a fallback chain where exactly one
succeeds, so a gated bar there would report degradation as progress. What shape
should the two progress widgets take — two different widgets (A), one gated bar
with analyse's gates drawn as alternatives (B), or one gated bar for both drawn
identically (C)?

**The answer, from the owner, relayed through the orchestrator: option A.** It
was this ticket's own recommendation, so it overrode nobody. Recorded here from
the dl-40 branch on 2026-09-06; **nothing below has been built.**

**Carry the cost with the answer**, or the next builder rediscovers the
objection from scratch:

- **A takes every row of the stage table above at full resolution and claims no
  total it does not have.** It also fixes defects 1 and 2 for free: replacing the
  stage line _is_ a content mutation, so the polite live region starts working
  with no extra machinery.
- **B was not rejected as wrong.** It is the most informative option and it keeps
  one visual language. It costs real design work, and there is no stock component
  for it.
- **C stays rejected**, for the reason already recorded below: it reads as
  progress when it is degradation, and it would have to either hide most of the
  stage table or invent a denominator.

The reasoning that produced the question stands, and is kept because it is what
makes the answer legible:

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
ways out — **A is the answer; B and C are kept so neither is re-proposed as
new:**

- **A. Two widgets — chosen.** Gated bar for the download, where gates are a
  genuine pipeline and the total is fixed at five. For analyse, an indeterminate
  bar — properly animated per defect 3 — with the current real stage as a single
  line beneath it, replaced as it advances. Takes every row of the table above at
  full resolution, claims no total it does not have, and fixes defects 1 and 2
  for free: replacing the text _is_ a content mutation, so the polite live region
  starts working with no extra machinery.
- **B. Gated bar for both, analyse gates drawn as alternatives** — three doors,
  struck through as each is ruled out, with the fine-grained stages as the label
  inside the open one. Most informative and keeps one visual language. Needs real
  design work; there is no stock component for it. **Not chosen, and not wrong:**
  the cost was the reason, not the idea.
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
6. Apply the chosen analyse shape. **Settled by the decision above: option A** —
   an indeterminate bar with the current real stage as a single line beneath it,
   replaced as it advances. Left as written rather than rewritten into a new
   brief; that is the builder's job with the code in front of it.
7. Animate the indeterminate bar — a travelling band — and give
   `@media (prefers-reduced-motion: reduce)` something to say about it. The still
   fallback must remain visibly different from a determinate bar at 0%.
   **Settled by the same answer:** this is the animation option A requires, not
   an independent nicety, so it is no longer conditional on step 6's shape.
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
- **2026-09-06 — the decision was answered by the owner: option A.** Two widgets
  — a gated bar for the download, an indeterminate animated bar for analyse with
  the current real stage as a single line replaced as it advances. It was this
  ticket's own recommendation, so it overrode nobody; B was declined on the cost
  of the design work rather than on the idea, and C stays rejected. The section
  above is now `## Decision — answered 2026-09-06, not open`, and Build steps 6
  and 7 are marked as settled by it.

  **Recorded, not built.** This entry was written from the dl-40 branch by that
  ticket's builder, because a downloader worktree was already open and moving a
  few lines did not earn a dispatch of its own. Nothing in `src` was touched for
  dl-43 and `status` stays `ready`: the next reader should treat this as a brief
  whose last open question is closed, not as work in progress.

- **2026-09-07 — built.** Option A, all eight Build steps, plus the server half
  the ticket widened into. Branch `dl-43-gate-progress-on-what-actually-happened`
  off `origin/main` at `24e5bf7`.

  **What the brief had wrong.** Two line citations in the stage table pointed at
  the wrong thing: `browser/pool.ts:186` is `return this.#semaphore.max;` inside
  a getter and `:195` is inside the `stats` doc comment — neither is an `await`
  at all. The table now cites the tree being committed:
  `browser/pool.ts:234 "await this.#semaphore.acquire(options.signal)"` and
  `:246 "dedicated = await this.#launch(proxyUrl)"`. It has been corrected in
  place, since a done ticket
  that cites the wrong line is a trap rather than a record. Every other citation
  in the ticket was re-derived and holds. A relayed report that Build step 1's
  prose implied `contract/src/job.ts` did **not** reproduce — step 1 names
  `ResolveOptions` and no file, and `job.ts` appears only in the "Why" section,
  where it is correct (it is where `JOB_STATUSES` lives). `ResolveOptions` is in
  `contract/src/resolver.ts` and that is where the new types went.

  **The contract.** `PROBE_STAGES` (twelve entries, one per row of the table
  above plus `resolver-start`), `ProbeStageEvent`, the SSE frame union
  `ProbeEvent`, and an **optional** `ResolveOptions.onStage` — so every caller
  and test that predates this is unaffected. Beyond what step 1 authorised, the
  channel needed three more contract lines, all of them mechanical consequences
  of step 3 asking for an SSE endpoint modelled on `routes/events.ts`:
  `probeEventSchema` + `parseProbeEvent` (that route validates every frame with a
  shared schema, and the client re-validates), `probeIdSchema` and an optional
  `probeId` on `probeRequestSchema`, and `ROUTES.probeEvents`.

  **The probe id is minted by the client, which is the one place this differs
  from step 3's "a probe id minted on request".** The POST that starts a probe is
  the request that would have to hand a server-minted id back, and by then the
  first stages have happened; the alternatives were a round trip before every
  analysis, or a race in which the opening stages are emitted into an empty room.
  What it protects is weaker in kind than `ROUTES.file`'s token — a guessed id
  reveals which phase somebody else's probe is in and nothing else, and
  `PROBE_STAGES` is a closed vocabulary with no free text, so that stays true by
  construction rather than by review. The hub buffers up to 32 frames for a
  subscriber that has not attached yet, which is what makes the client free to
  open the `EventSource` and POST without ordering them.

  **Two defects found while building, both fixed here.** (1) `#open` refreshed a
  channel's deadline unconditionally, so a client attaching after `done` bought a
  finished probe another full TTL — caught by
  `api/test/probe-stages.test.ts:89 "reaches a subscriber that only arrives
afterwards"`, fixed at `api/src/probe-stages.ts:217 "if (!existing.ended)"`. (2) `.progress::-webkit-progress-bar` sets
  an opaque background and that pseudo-element paints _above_ the element's own,
  so in Chromium the static barber-pole this ticket was replacing had been
  invisible all along — the animated background would have been too. Only the
  indeterminate case is reset.

  **`browser-slot` is emitted only when the semaphore is actually full.**
  `Semaphore.acquire` returns without suspending whenever `active < max` and
  nothing can run between the read and the call, so a full semaphore at that
  instant means this lease _will_ wait. An unconditional emit would have put
  "waiting for a free browser" on screen for every uncontended probe, which is
  narration again by another name.

  **Checked by hand against the running app** (mock transport, `VITE_MOCK_SPEED=0.35`,
  real Chromium at 900×1000), because that is the one acceptance line no test
  reaches:

  - The analysing card measured **one height (213 px) and one top (303 px)
    across all fourteen narration lines** of the `slow` scenario — the line is
    replaced, the card does not move. `.stage` carries a `min-height` for the
    wrapping case.
  - The indeterminate bar's computed `animation-name` is `progress-travel` with
    one running animation, and its `background-position` was sampled advancing
    `-40.5% → -15.6% → +9.3% → +34.2%`. Under `prefers-reduced-motion: reduce`
    the computed `animation-name` is `none`, zero animations are running, and the
    hatch covers the whole track — visibly not a determinate bar at 0%, which
    would be an empty one.
  - The download card walked `Queued → Re-analysing → Downloading → Assembling →
Ready` (and `→ Failed` on `dlfail`) at a **constant 828 px** with five gate
    segments throughout, on `""`, `indeterminate`, `flaky`, `expired` and
    `dlfail`. Screenshots confirm the gated bar reads as intended: done segments
    green with a tick, the current one accented, the rest grey.

  **Not measured, and worth saying so.** The e2e suites were not run — they need
  `npm run e2e:install` and a fixture origin, and nothing in this change touches
  a path they cover that the unit suites do not. The probe channel has never been
  exercised over a real `EventSource`: the API tests drive it through Fastify's
  `inject`, and the web tests through the transport seam. Both are the shapes
  those suites already use for `/api/jobs/:id/events`, but neither is a browser
  talking to the API.

  **Folded in rather than filed:** the two stale citations above; the
  `::-webkit-progress-bar` reset, without which step 7 would have shipped an
  animation nobody could see; and `01-ARCHITECTURE.md`'s diagram and SSE
  decision, which listed every other client↔api route and would have gone stale
  the moment this merged. **Deliberately not folded in:** anchor text for this
  ticket's citations. `scripts/citations.mjs` reports the brief's as unanchored
  and repo-29 is filed for exactly that, so anchoring them wholesale here would do
  that ticket's work in the wrong branch; the four citations _this entry_ writes
  carry anchors, because an unanchored one is a claim nothing checks and these are
  claims about work that just moved.

- **2026-09-07 — the gate's two low-severity findings, one of them repaired.**
  Second commit on the same branch, after `ticket-reviewer` passed the first.

  **The SSE endpoint's channel cap was not the defence its own comment claimed.**
  The finding arrived as "64 bare GETs with no POST can hold every slot"; it
  reproduced **worse than that**, and both of us measured it independently before
  anything was changed. `subscribe` creates a channel, and its unsubscribe
  dropped only the listener — nothing but the 180 s sweep reclaimed the channel
  itself. So the connections never had to be held: 64 requests that connect and
  hang up immediately left `channelCount` at 64, and the next real probe was
  refused a channel. Cost to an attacker was 64 one-shot requests every three
  minutes, not 64 concurrent sockets.

  Fixed with `Channel.claimed`, set only by `open()` — that is, only by the probe
  route. An unclaimed channel whose last listener leaves is deleted at once; a
  claimed one is not, because there a listener leaving is ordinary (a tab closed
  mid-probe) and the probe still has stages to publish. The normal client order,
  subscribe-then-POST, is unaffected: all three cases are pinned at
  `api/test/probe-stages.test.ts:127 "frees its channel immediately"`, and the
  first of them was run red against the unfixed hub (`expected 64 to be +0`).

  **What is left, and why it is not decided here.** 64 _concurrently held_
  connections still fill the cap, bounded by the server's own connection limits;
  the effect is that other users' analyses run unnarrated, never that an analysis
  fails. A per-IP limiter on `/api/probe/:id/events` is the obvious next step and
  is a policy call about `rateLimits`, whose buckets sit in `config.ts` beside the
  two that protect real work — so it is raised to the orchestrator as an open
  decision (add it now, or file a follow-up) rather than settled in this commit.
  `MAX_CHANNELS`'s docblock now states the residual instead of the claim it used
  to make.

  **The contract's new schemas had no direct test**, unlike every sibling in
  `contract/test/contract-schemas.test.ts`. `probeEventSchema`, `parseProbeEvent`
  and `probeIdSchema` now get one block each, matching what `jobEventSchema` and
  `parseJobEvent` already had. Two of them earn their keep rather than restating
  the compiler: `stage` being an enum is what makes an older bundle drop a stage
  it has never heard of instead of announcing an empty line into a live region,
  and `probeIdSchema`'s character class is what stops an id interpolated into
  `ROUTES.probeEvents` from naming a different path. Both were run red — against
  `z.string()` and against a bare `.min(1)` — and three tests failed.

  **Corrected from the first entry:** the back-edge acceptance is carried by
  `job-card.test.tsx:339 "a re-probe keeps Downloading marked done"`, which
  asserts the step-list high-water mark. `:288` covers the carried bytes and the
  label only, and citing it alongside overstated what it proves.
