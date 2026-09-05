---
id: dl-39
tool: downloader
title: Make the analyse and download progress show what is happening, not the whole script
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-39 — progress that narrates the future, in a bar that cannot move

**Packages:** `web` only (`components/AnalysingPanel.tsx`,
`components/JobCard.tsx`, `components/ProgressBar.tsx`, `styles.css`). **Pure UI:
no contract change, no API change, no resolver or engine work.** If this ticket
starts wanting one, it has gone out of scope — file that separately.

## Why

Reported from a session on 2026-09-05, roughly five seconds into a browser
probe. Everything the panel will ever say was already on screen:

```
✓ Opening a headless browser   ✓ Loading the page and dismissing consent banners   Provoking playback and watching network requests
Waiting for the network to go quiet   Still going — some sites are slow to start playing

Browser probes usually take 10–20 seconds.
```

Three separate defects produce that, and they are worth separating because only
one of them is about taste.

### 1. The narration is fully spoiled from second zero

[`AnalysingPanel.tsx:10-16`](../../web/src/components/AnalysingPanel.tsx) keys
five lines to the clock, and the component renders **all five, always** — state
is a class name, and [`styles.css:452`](../../web/src/styles.css) lays `.stages`
out as `display: flex; flex-wrap: wrap`. So a message written as reassurance for
second 16 — _"Still going — some sites are slow to start playing"_ — is on screen
at second 0, where it does not reassure, it warns. The user is told the probe is
slow before it has had a chance to be quick.

**This is where the analyse panel differs from the download pipeline, and the
shared CSS class hides it.** `JobCard`'s `.steps`
([`JobCard.tsx:79`](../../web/src/components/JobCard.tsx)) walks `STATUS_ORDER`
— a real state machine, whose future steps are facts about what will happen, so
showing them ahead of time is informative. `AnalysingPanel`'s `.stages` are
_time-keyed guesses about one opaque wait_. They share a selector and should not
share a behaviour.

### 2. The live region is inert

The `<ol>` carries `aria-live="polite"`, but a stage advancing changes only
`className` and `aria-current` — **no text content changes**, and a live region
announces content mutations. So a screen-reader user is read all five stages once
and then hears nothing for the rest of the probe, while the visible UI is
updating. The `aria-current`/`aria-label` work from dl-18 is still correct; it is
the announcement that never fires.

### 3. The indeterminate bar cannot move

[`styles.css:436`](../../web/src/styles.css) renders the indeterminate state as a
static `repeating-linear-gradient`. There is no animation on it. A stalled probe
and a healthy one are pixel-identical, which is the one thing an indeterminate
bar exists to distinguish. (The reduced-motion block at
[`:444`](../../web/src/styles.css) only disables the _determinate_ bar's width
transition, so it is not the cause — there is simply nothing to disable.)

Note that `percent: null` reaching the bar is correct and must stay: a browser
probe genuinely has no total, and CLAUDE.md forbids inventing one. This ticket
changes how the unknown is _drawn_, never what is reported.

## The open decision

**How much should the analyse panel show at once?** Two shapes, and they lead to
materially different components.

- **A. One line at a time, replaced as it advances (recommended).** The panel
  shows the current stage only, with the elapsed clock already beside the title
  carrying the sense of duration. Fixes defect 1 outright, and makes defect 2
  fall out for free — replacing the text _is_ a content mutation, so the polite
  live region starts working with no extra machinery. Loses the sense of "we got
  three steps in", which the tick marks currently give.
- **B. Reveal progressively — done and current stages only, future ones hidden
  until reached.** Keeps the accumulated-progress feeling and still stops the
  spoiler. Costs more: the list growing needs a transition or it jumps, and the
  live region needs the announcement handled deliberately rather than getting it
  for free.

A is recommended because the analyse wait is short and opaque; a five-item
checklist for a fifteen-second wait is more ceremony than the wait deserves. B is
the better answer if the stage list ever becomes real progress reported by the
probe rather than narration on a timer — which is a different ticket, and not
this one.

**The download pipeline is not part of this decision.** Its steps are a genuine
state machine and should keep showing what is ahead. What it needs from this
ticket is only the shared-selector split and whatever the visual pass yields.

## Build

1. Split `.stages` from `.steps` in [`styles.css`](../../web/src/styles.css).
   They are one rule today, and every change below would otherwise land on the
   download pipeline as a side effect.
2. Apply the chosen shape to
   [`AnalysingPanel.tsx`](../../web/src/components/AnalysingPanel.tsx).
3. Give the indeterminate bar a real animation — a travelling band — and put it
   behind `@media (prefers-reduced-motion: reduce)`, which currently has nothing
   to say about it. A static fallback for reduced motion must still differ
   visibly from a determinate bar at 0%.
4. Visual pass over the download side in
   [`JobCard.tsx`](../../web/src/components/JobCard.tsx): the step list, the
   progress bar and the speed/ETA line, keeping every state it can be in — the
   `percent: null` live capture, a re-probing job sitting at a step it has
   already passed ([`JobCard.tsx:29`](../../web/src/components/JobCard.tsx)),
   and a failed job.
5. `tools/downloader/web/src/api/scenarios.ts` already drives the mock API and
   covers the slow-probe case (`"An 18-second browser probe — the case the
analysing indicator exists for."`). Use it rather than inventing fixtures, and
   check the states there that are hard to reach by hand.

## Done when

- A component test asserts that a stage not yet reached is not in the document
  at second 0 — specifically that the 16-second copy is absent early. It fails on
  `main`.
- A component test asserts the text a screen reader would be given actually
  changes when a stage advances.
- The indeterminate bar animates, and a reduced-motion test or an explicit CSS
  assertion covers the still fallback.
- Every state in `scenarios.ts` renders without layout jumping, checked by hand
  against the running app and noted in the Log.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05 — filed.** Asked for as "improve all visual progression of both
  the analyse and download process, pure UI". The three defects above were found
  while grounding that request against a screenshot; defects 2 and 3 are not
  visible in the screenshot and were not part of the original ask, but they are
  the same surface and cost nothing extra to fix while it is open. The shared
  `.stages`/`.steps` rule is the trap: the analyse panel and the download
  pipeline look like the same widget and are not the same thing.
