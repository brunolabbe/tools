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

## Review

### Gate 1 — 2026-08-23 — CONCERNS

Reviewed at `1244bea`. The fix itself needed no change: 14 conditional and `??`
sites enumerated, 29 outcome branches, 29 mutations run, **27 killed, 2
survivors, both shown to be provably equivalent mutants — no genuine survivors.**
All nine of the builder's own mutation rows reproduced with identical red counts.
The verdict is CONCERNS on the strength of finding #1, which is a real gap in the
shipped behaviour, and #2–#5, which are claims in prose that were stronger than
what the code and the wire support.

**Citations below are resolved against the tip of this branch, not against
`1244bea`.** Addressing #2 lengthened a comment by six lines and pushed every
later line in `job-card.test.tsx` down with it — the failure dl-15's fifth gate
records, and the reason to re-resolve every citation in a record rather than only
the ones a round happens to touch.

| Done when                                                                          | Verdict  | Proof                                                                                                              |
| ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `probing` with bytes already downloaded renders "Downloading" as completed         | proven   | `job-card.test.tsx:321`, both arms of the `attempts: 2` loop                                                       |
| first `probing`, nothing downloaded, renders "Downloading" pending, asserted apart | proven   | `job-card.test.tsx:349`; and the premise holds — an unconditional mark reddens the test at `job-card.test.tsx:337` |
| the active step is identifiable by role, and the test queries it that way          | proven   | `job-card.test.tsx:331`, `:356`, `:294` via `activeStep()`; `chrome.test.tsx:99`                                   |
| dl-15's characterization test replaced by its inverse, dl-18 no longer named       | proven   | `job-card.test.tsx:298` replaces it in place; `git grep dl-18` in that file is empty                               |
| `npm run check` and `npm test -- --project downloader` green                       | verified | re-run by the reviewer: exit 0, 645 tests                                                                          |

**Findings, all seven, with dispositions.**

- **#1 (med) — the fix does not reach a client on a live stream.** Confirmed by
  rendering, not by reading: driven through the back-edge with only the frames
  the server emits, the live render is byte-identical to the first-probe render
  and "Downloading" goes pending. `JobEvent` (`contract/src/job.ts:167-176`) has
  seven members and none carries `attempts`; `applyJobEvent`
  (`job-reducer.ts:76-131`) never writes it in any of its seven arms. The
  builder's Log had already reported this from reading the source and was right
  in every particular. **Filed as
  [dl-20](./dl-20-reprobe-mark-on-the-live-stream.md)** — which is what makes
  `status: done` honest here, since a gap recorded only in a Log lives where
  nobody greps. Not fixed on this branch: it is a reducer change, outside this
  ticket's Build section.
- **#2 (med) — a comment documented the bug as though it were covered.** The
  `attempts: 2` loop was justified as "the transient a listening client holds
  between the `status` frame and the `progress` frame". That transient carries
  `attempts: 1`; it is the _other_ loop. As written the comment claimed coverage
  of exactly the case #1 says is uncovered. **Rewritten** at
  `job-card.test.tsx:306-317`, which now says plainly that the 41 MB arm is a
  negative control for the byte count and not the wire transient, and points at
  dl-20. The loop itself was correct and is unchanged.
- **#3 (low) — "the Why describes the fixture rather than the product" is
  false.** The reviewer rendered the wire transient — `status` frame applied,
  `progress` frame not yet — and the card does show "39 MB" beside the "Fetching
  fresh stream links" hint. `orchestrator.ts:189-192` names that window in its
  own comment. Only the `attempts: 2` beside those bytes is unreachable, and
  nothing in that test reads it. **Corrected in the Log.**
- **#4 (low) — misclassified fixture shape.** dl-15's gate-3 shape is _a fixture
  whose value makes a branch unobservable_; this is _a fixture describing an
  unreachable state_, and no branch here is unobservable. **Corrected in the
  Log**, with the reviewer's count: three impossible-state fixtures in the
  downloader `web` suite (`job-card.test.tsx:254` pre-existing, `:319` introduced
  by this branch, `:390` inheriting a 41 MB default from `fixtures.ts:128`), and
  two that are **not** impossible — `job-card.test.tsx:347` and
  `status.test.ts:29` are the live transient.
- **#5 (low) — "correct after a dropped connection" is too strong.**
  `reconcileJob` (`job-reducer.ts:149`) keeps the local copy when it is strictly
  newer, so a reconnect whose refetch races an inbound event discards the remote
  `attempts: 2` and the card stays wrong. **Corrected in the Log**, and carried
  into dl-20's Why and its third Build step.
- **#6 (info, no change) — the pre-existing `job("queued")` fixture.**
  `job-card.test.tsx:390` mounts a queued job carrying `fixtures.ts:128`'s 41 MB
  default, which a job that has downloaded nothing cannot have. It predates this
  branch, no assertion in that test reads the byte count, and changing a shared
  fixture default is how dl-15's gate 4 created a new blind spot while closing an
  old one. Left alone deliberately; recorded so the next reader finds it.
- **#7 (info, no change) — comparison asymmetry between the two lists.**
  `JobCard`'s pipeline is asserted as a whole-list `[label, state]` tuple;
  `AnalysingPanel`'s stages are asserted by two role helpers plus indexed class
  reads. The reviewer notes the second is the weaker form. It is also the one
  that survives a stage list whose contents are keyed to a clock rather than to
  an enum, and both mutations against it were killed. No change.

**On the class assertions.** Three sites still read a class name —
`job-card.test.tsx:286` and `chrome.test.tsx:103-104`, `:115` — plus two helpers
that read one, `stepStates()` and `stageClasses()`. All five are deliberate
companions rather than leftovers: the class and the ARIA attribute are set from
one expression in each component, so a suite watching only the accessible half
would let the stylesheet's hook drift silently, and the reverse. The role
assertions are what speak for a user; the class assertions are what keep the two
halves from separating.

**On the one negative assertion.** `chrome.test.tsx:102` asserts no stage claims
to be done at zero elapsed. It has a companion, per dl-15's gate-5 rule: deleting
the `<ol className="stages">` block reddens it, because `activeStage()` and the
indexed class reads beside it throw on an absent list rather than passing
vacuously.

**Two things the reviewer verified that the builder could not have.** The
acceptance premise "a fix that marks everything done cannot pass" is **real**:
making the mark unconditional reddens `job-card.test.tsx:337`. And the
accessibility change is **purely additive** — `listitem` is nameFrom-author-only,
so these items had no accessible name at all before this branch, and nothing a
screen reader previously received was replaced or overridden.

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
- **dl-15's own back-edge fixture describes a state nothing can reach** — and my
  first draft of this bullet overstated that twice, corrected in the gate above.
  `the downloading → probing back edge keeps the work, and is not an error`
  mounts a `probing` job carrying both `attempts: 2` and 41 MB. Only the
  combination is impossible: `attempts` reaches the client solely by refetch, and
  a refetch also brings the reset byte count.

  **The 41 MB on its own is real, and so is the Why.** I wrote that no re-probing
  card shows those bytes and that the ticket's Why therefore "describes the
  fixture rather than the product". That is wrong. The gate rendered the wire
  transient — the `status` frame applied, the `progress` frame that follows it
  not yet — and the card does show "39 MB" under the "Fetching fresh stream
  links" hint. `orchestrator.ts:189-192` names that window in its own comment,
  which is why the reset is emitted as a frame at all. The Why describes the
  product; only the `attempts: 2` beside those bytes is unreachable, and nothing
  in that test reads it. Untouched, as the brief instructs.

  I also filed it as "the eleventh instance of the shape dl-15's gate-3 entry
  names". **It is a different shape.** That one is _a fixture whose value makes a
  branch unobservable_ — a sorted list handed to a sorter, `"open"` for a stream
  state. This is _a fixture describing a state the system cannot be in_, and no
  branch here is unobservable: every arm the fixture reaches is asserted. The two
  fail differently. The first hides a defect behind a green test; the second
  proves a true thing about an untrue job, which is harmless until someone reads
  the fixture as documentation of the wire.

  The gate counted **three impossible-state fixtures** in the downloader `web`
  suite: `job-card.test.tsx:254` (pre-existing, dl-15's), `job-card.test.tsx:319`
  (introduced by this branch, and the negative control for the byte count), and
  `job-card.test.tsx:390`, where `job("queued")` inherits `fixtures.ts:128`'s
  41 MB default for a job that has downloaded nothing. Two others that look like
  the shape are **not**: `job-card.test.tsx:347` and `status.test.ts:29` both
  carry `attempts: 1` with bytes on the clock, which is precisely the live
  transient and precisely the case dl-20 exists for.

- **The fix does not reach a client that is watching live, and that is the one
  in the Why.** No `JobEvent` carries `attempts` — the union in
  `contract/src/job.ts` has `status`, `progress`, `probed` and the three terminal
  frames, none of them with the field — and `applyJobEvent` never writes it. So a
  client following the SSE stream holds `attempts: 1` straight through the back
  edge and only learns it is `2` on a refetch, which happens on reconnect
  (`job-stream.ts` reconciles after every one) and on page load (`useJobs`
  re-fetches every unfinished job). So the card is fixed on the refetch and reload
  paths and unchanged for the user staring at a 20-minute download with a healthy
  stream. The gate confirmed this by rendering rather than by reading: driven
  through the edge with only the frames the server emits, the live render is
  byte-identical to the first-probe render.

  **"Correct after a dropped connection" was itself too strong**, and the gate
  narrowed it. `reconcileJob` (`job-reducer.ts:149`) keeps the _local_ copy when
  it is strictly newer than the remote one — which is exactly what a reconnect
  produces, since reconnecting is when frames arrive in a burst. A reconnect
  whose refetch loses that race discards the remote `attempts: 2` and the card
  stays wrong. It is correct after the reconnects that do not race, and after a
  page load.

  Closing that needs one of two things, and both are outside this ticket:
  `attempts` on the `status` frame, which is a contract change the brief
  explicitly forbids here; or a client-side inference in `job-reducer.ts` — a
  status frame that moves the job _backwards_ along `STATUS_ORDER` is itself
  proof the edge was taken, and the reducer is the one place that sees the move.
  The second is web-only and would fit this ticket's spirit, but not its Build
  section, which names `JobCard.tsx` and the rule's home in `lib/`. **Filed as
  [dl-20](./dl-20-reprobe-mark-on-the-live-stream.md)**, which carries the
  reducer shape, the reconcile race, and the note that the contract change is the
  better answer if the owner decision is available.

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
