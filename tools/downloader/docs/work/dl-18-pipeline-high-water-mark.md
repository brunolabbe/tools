---
id: dl-18
tool: downloader
title: Stop the pipeline list walking backwards when a job re-probes
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-18 — A re-probe reads as the job going backwards

## Why

[dl-9](./dl-9-fsm-reprobe-back-edge.md) gave the job FSM one back-edge —
`downloading → probing` — because a signed media URL that expires mid-download
is not a failure of the job, it is a reason to resolve the source again. The
edge is deliberate and the state is honest.

**`JobCard` renders it as regress.** The pipeline list is driven by
`statusIndex(job.status)`, and `statusIndex("probing")` is `1` while
`statusIndex("downloading")` is `2`. So when the back-edge fires, the
"Downloading" step loses its `steps__item--done` marker and "Re-analysing"
becomes the active one. A user watching a 20-minute download sees the progress
indicator retreat, with the bytes already fetched still on screen beside it.

Two things are wrong with that, and only the first is cosmetic:

1. **It contradicts what actually happened.** Those bytes are on disk. The
   download stage genuinely completed once, and the job is fetching fresh links
   in order to finish it. A step list that un-marks it is reporting the
   opposite of the truth — which is the same class of mistake as an invented
   progress total, just in a different widget.
2. **It reads as a failure.** Retreating progress is the universal signal that
   something went wrong and is being redone from scratch. dl-9's whole point was
   that a re-probe is routine; the card says it is a setback.

There is a third, smaller thing worth fixing while the file is open: **the step
list has no accessible state at all.** Done, active and pending are conveyed by
CSS class alone — no `aria-current`, no change to any accessible name. A screen
reader user gets five list items and no indication of which one the job is on,
which is why [dl-15](./dl-15-component-render-tests.md)'s characterization test
had to assert on `className` and said so in a comment. Whatever this ticket does
to the marking logic should leave the state legible to assistive technology too.

## Build

`tools/downloader/web/src/components/JobCard.tsx`, and the tests beside it.

1. **Track a high-water mark, not the current index.** A step whose index is
   below the furthest the job has reached stays `--done`. The current status is
   `--active`; everything beyond is pending. The existing `statusIndex` helper
   in `lib/status.ts` still gives the position — what is missing is the memory of
   the furthest position reached.

2. **Derive the mark from the job, not from React state.** `JobCard` is handed a
   `Job` and must render the same thing for the same job on any mount — a
   `useRef` high-water mark would reset on remount and disagree with itself
   after a page reload, and the job list is restored from `localStorage` on
   every load. The job already carries what is needed: a non-zero
   `progress.downloadedBytes`, or an `attempts` above one, says the download
   stage has been entered at least once. Pick one, write down why in a comment,
   and keep the rule in `lib/status.ts` beside `statusIndex` rather than inline
   in the component — it is a fact about the FSM, not about the markup, and
   there it can be tested without a DOM. `presentation-helpers.test.ts` is the
   existing node-surface home for `lib/` helpers; a `status.test.ts` beside it
   is equally fine and costs no config, since the glob in
   `tsconfig.tests.json` and the `downloader` vitest project both already cover
   the directory.

3. **`probing` before the first download is not the back edge.** A job in its
   _initial_ `probing` state has downloaded nothing and must render exactly as
   it does today: "Queued" done, "Re-analysing" active, the rest pending. Only a
   re-probe — one that follows a download — holds the mark. This is the case a
   naive fix gets wrong, and it is worth a test of its own.

4. **Give the step list accessible state.** `aria-current="step"` on the active
   item is the minimum; consider whether a done step should carry something a
   screen reader reads as completed. Once it does, the test in step 5 can query
   by role instead of by class, and the comment in `job-card.test.tsx` about
   there being nothing role-shaped to query comes out.

5. **Invert dl-15's characterization test.** `job-card.test.tsx` carries a test
   named `CHARACTERIZATION (dl-18): the step list walks backwards on a re-probe`
   that asserts today's wrong behaviour on purpose, so this ticket has something
   that goes red when it lands. Replace it — do not delete it — with the
   positive claim: after a re-probe, "Downloading" is still marked done. The
   test above it, `the downloading → probing back edge keeps the work, and is
not an error`, already holds the rest of the card's behaviour and should keep
   passing untouched.

**Traps.**

- `STATUS_ORDER` ends at `completed` and does not contain `failed` or
  `canceled`; `statusIndex` returns the last index for anything it does not
  find. Do not let a high-water mark turn a failed job's list into five done
  steps — the list is only rendered for an `active` job, and that must stay true.
- The `muxing → probing` transition does not exist in `JOB_TRANSITIONS`. Do not
  invent handling for it.
- This is a `web` change only. The FSM in `contract/src/job.ts` is correct as it
  stands and must not be touched.

## Done when

- A job in `probing` whose `progress` shows bytes already downloaded renders
  "Downloading" as a completed step, and a test asserts it.
- A job in its first `probing` state, with nothing downloaded, renders
  "Downloading" as pending — asserted separately, so a fix that marks everything
  done cannot pass.
- The active step is identifiable by role rather than only by class name, and
  the test queries it that way.
- dl-15's characterization test is replaced by its inverse rather than deleted,
  and the comment naming dl-18 is gone from `job-card.test.tsx`.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

_Not started._
