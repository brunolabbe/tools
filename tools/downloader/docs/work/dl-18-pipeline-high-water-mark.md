---
id: dl-18
tool: downloader
title: Stop the pipeline list walking backwards when a job re-probes
kind: fix
status: done
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

   **`AnalysingPanel` has the identical gap at its own stage list**, found while
   testing it in dl-15: `stages__item--done` / `--active` with no `aria-current`
   and no name that changes, so `chrome.test.tsx`'s `activeStage()` helper reads
   the class for the same reason. It is a second component and arguably a second
   ticket — but it is the same three lines of fix, the two lists read as siblings
   to a user, and doing one without the other leaves the tool half-narrated.
   Take it here unless it turns out to be more than it looks.

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

### 2026-08-23 — built

`statusHighWaterMark(job)` in `web/src/lib/status.ts`, one ternary rewritten in
`JobCard.tsx`, the same three lines at `AnalysingPanel.tsx`'s stage list, and
four tests in a new `web/test/status.test.ts` beside the two rewritten in
`job-card.test.tsx`. `npm run check` green, 645 tests green under
`--project downloader`. Nothing outside `web` was touched; `contract/src/job.ts`
is untouched, as the brief requires.

The mark is `attempts > 1` while `status === "probing"`, and nothing else. Only
`probing` is inferred about, which is what keeps the failed-job trap shut: a
`failed` job carrying `attempts: 2` still reports `statusIndex("failed")`, so it
gains no trail of steps it never walked even though the list is not rendered for
it anyway.

**The accessible state is `aria-current="step"` on the active step and an
`aria-label` of `"<label>, done"` on the ones behind it**, rather than a
`visually-hidden` span carrying the same words. The span is the more usual
pattern and the class already exists here, but it changes `textContent`, which
reddens two
neighbouring assertions that have nothing to do with this ticket — the pipeline's
exact-label list, and gate 5's `getAllByText("Downloading")).toHaveLength(2)`,
which counts the pill and the step together and is load-bearing against deleting
the pills row. An attribute leaves the text alone and puts the state in the
accessible tree just as well. Both lists now answer
`getByRole("listitem", { current: "step" })`, so `chrome.test.tsx`'s
`activeStage()` reads a role instead of `.stages__item--active`.

### What the brief had wrong

- **`progress.downloadedBytes` is not one of two workable signals — it is dead.**
  Step 2 says to pick either it or `attempts` and write down why. There is no
  choice to make: dl-9's orchestrator patches `initialProgress("probing")` **as
  it takes the back-edge**, on the grounds that an abandoned attempt's bytes are
  not progress towards this one, so a re-probing job's `downloadedBytes` is `0`
  in the store and `0` again on any refetch. A mark read from the byte count
  would have been green in tests built on dl-15's fixture and inert in
  production. `attempts` is the only signal on the `Job` that survives the
  transition, and the comment in `status.ts` says so.
- **The first `Done when` line is phrased against that dead signal** — "a job in
  `probing` whose `progress` shows bytes already downloaded". Read literally it
  asks for the wrong rule. Both tests therefore loop over `downloadedBytes` of
  `0` and `41_000_000` and assert the same list either way: the literal wording
  is satisfied, and so is the claim that actually matters, which is that the byte
  count is not what is being read.
- **dl-15's own back-edge fixture is a shape the server cannot produce.** `the
downloading → probing back edge keeps the work, and is not an error` mounts a
  `probing` job still carrying 41 MB and asserts "39 MB" is on screen. The
  orchestrator resets that snapshot, so no real re-probing card shows those bytes
  — the sentence in the ticket's Why about "the bytes already fetched still on
  screen beside it" describes the fixture rather than the product. The brief says
  to leave that test untouched and it is untouched; it is the eleventh instance
  of the shape dl-15's gate-3 entry names, and it is recorded here rather than
  fixed because fixing it is a change to an assertion this ticket was told not to
  disturb.
- **The fix does not reach a client that is watching live, and that is the one
  in the Why.** No `JobEvent` carries `attempts` — the union in
  `contract/src/job.ts` has `status`, `progress`, `probed` and the three terminal
  frames, none of them with the field — and `applyJobEvent` never writes it. So a
  client following the SSE stream holds `attempts: 1` straight through the back
  edge and only learns it is `2` on a refetch, which happens on reconnect
  (`job-stream.ts` reconciles after every one) and on page load (`useJobs`
  re-fetches every unfinished job). The card is therefore correct after a reload
  or a dropped connection and unchanged for the user staring at a 20-minute
  download with a healthy stream.

  Closing that needs one of two things, and both are outside this ticket:
  `attempts` on the `status` frame, which is a contract change the brief
  explicitly forbids here; or a client-side inference in `job-reducer.ts` — a
  status frame that moves the job _backwards_ along `STATUS_ORDER` is itself
  proof the edge was taken, and the reducer is the one place that sees the move.
  The second is web-only and would fit this ticket's spirit, but not its Build
  section, which names `JobCard.tsx` and the rule's home in `lib/`. **It wants a
  ticket of its own** and does not have one yet.

- **`AnalysingPanel` was exactly what it looked like** — the same three lines,
  taken here as step 4 allows.
- The `dl-18` mentions in `job-card.test.tsx` were removed rather than reworded,
  including from the two comments this ticket wrote. The `Done when` line asks
  for that file to stop naming the ticket, and the explanation it used to point
  at now lives in `statusHighWaterMark`'s docblock, which is a better target than
  a ticket id anyway.

### Mutation checks

Nine, each applied to the source and reverted after. `npm test -- --project
downloader status.test job-card chrome` throughout (36 tests over three files).

| Mutation                                                | Red |
| ------------------------------------------------------- | --- |
| `statusHighWaterMark` returns `current` unconditionally | 2   |
| drop the `attempts <= 1` guard                          | 3   |
| drop the `status !== "probing"` guard                   | 1   |
| `index <= furthestStep` → `index <`                     | 1   |
| rank `done` above `active` in the ternary               | 3   |
| drop `JobCard`'s `aria-current`                         | 3   |
| drop `JobCard`'s done `aria-label`                      | 3   |
| drop `AnalysingPanel`'s `aria-current`                  | 1   |
| drop `AnalysingPanel`'s done `aria-label`               | 1   |

The third one is the trap the brief names: with only `attempts <= 1` guarding,
a `failed` job with a retry behind it reports `statusIndex("downloading")`
instead of the last index, and `a terminal job gains no trail of steps it never
walked` is the only thing that notices.
