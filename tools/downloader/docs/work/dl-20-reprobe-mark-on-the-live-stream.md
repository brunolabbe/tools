---
id: dl-20
tool: downloader
title: Carry the re-probe mark to a client that never reconnects
kind: fix
status: done
milestone: null
depends_on: [dl-18]
---

# dl-20 — The high-water mark never reaches a live listener

## Why

[dl-18](./dl-18-pipeline-high-water-mark.md) stopped `JobCard`'s pipeline list
walking backwards over dl-9's `downloading → probing` back-edge, by deriving a
high-water mark from `job.attempts`. It works, it is tested, and **it does not
reach the user it was written for.**

`attempts` only ever changes on the server. Every route by which the client
learns something about a job is one of these, and none of them carries it:

- **`JobEvent`** (`contract/src/job.ts:167-176`) has seven members — `status`,
  `progress`, `probed`, `completed`, `failed`, `canceled`, `heartbeat`. No
  member has an `attempts` field.
- **`applyJobEvent`** (`web/src/lib/job-reducer.ts:76-131`) never writes
  `attempts` in any of its seven arms, because it has nothing to write.

So a client following the event stream holds `attempts: 1` straight through the
back-edge. It only learns the true value from a whole-`Job` refetch:
`job-stream.ts` reconciles after every reconnect, and `useJobs` re-fetches every
unfinished job on page load. Which means dl-18's fix is live **after a reload or
a dropped connection, and inert for someone watching a healthy stream** — the
person in dl-18's own Why, staring at a 20-minute download.

The gate on dl-18 confirmed this by rendering rather than by reading: driven
through the back-edge with only the frames the server actually emits, the live
render is byte-identical to the first-probe render. "Downloading" goes pending.

**And the refetch path is narrower than dl-18's Log claims.** `reconcileJob`
(`web/src/lib/job-reducer.ts:149`) keeps the _local_ copy when it is strictly
newer than the remote one — which is exactly what happens when an event lands
while the reconcile fetch is in flight. That is the common case on a reconnect,
since reconnecting is when frames arrive in a burst. So a reconnect whose
refetch loses that race discards the remote `attempts: 2` and the card stays
wrong until the next refetch happens to win. "Correct after a dropped
connection" is true only of the reconnects that do not race.

## Build

`tools/downloader/web/src/lib/job-reducer.ts`, and the tests beside it.

**A backwards `status` frame is itself the evidence.** The reducer is the one
place in the client that observes the _move_ rather than the resulting state:
`withStatus` is handed both the job's current status and the next one. A frame
that moves the job to a lower position in `STATUS_ORDER` can only be the
back-edge, because that edge is the only one in `JOB_TRANSITIONS` — so the
reducer can record the mark itself, with no new field on the wire.

1. **Decide where the mark lives, and say why in a comment.** `Job` is a
   contract type and must not grow a field locally. The two candidates are
   bumping `attempts` — honest in effect, dishonest in name, since the client
   would be reporting a server counter it did not observe — and a separate
   client-side record keyed by job id, which is truthful but has to be threaded
   from `useJobs` down to `JobCard` beside `streamState`, which already makes
   that trip. Prefer the second unless it turns out worse than it looks; either
   way the reasoning is the deliverable.
2. **Infer it in the reducer, not in the component.** `statusHighWaterMark` in
   `lib/status.ts` stays the single rule; what changes is that it is given a
   better-informed input. Keep it a pure function of its arguments.
3. **The reconcile race is part of this ticket, not a footnote.** Whatever the
   mark is, `reconcileJob` must not lose it when it keeps the local copy — and
   must not lose it when it takes the remote one either, since a remote job
   fetched fresh knows `attempts` but nothing about what this client watched.
   The mark is monotonic; merging two of them is a max, not a choice.
4. **Prove it against frames, not against hand-built jobs.** The test that
   matters drives `applyJobEvent` with the exact sequence the orchestrator emits
   over the back-edge — `status: probing` then `progress` with
   `initialProgress("probing")` — starting from a `downloading` job, and asserts
   the rendered card still marks "Downloading" done. dl-18's tests all mount a
   job built by hand, which is why none of them caught this.

**The alternative that was deliberately not taken:** adding `attempts` (or a
`reachedStatus`) to the `status` frame. That is a `contract` change, it would
make every client correct with no inference at all, and it is the cleaner answer
on the merits. It is not proposed here because dl-18 was scoped web-only and a
contract change needs the owner decision that dl-9 records needing. **If that
decision is available, take it instead of this** — and say so on this ticket
rather than building both.

**Traps.**

- `STATUS_ORDER` does not contain `failed` or `canceled`, and `statusIndex`
  returns the last index for anything it does not find. A terminal frame is not
  a backwards move; do not let it read as one.
- The reducer's whole docblock is about being total and monotonic so a late or
  duplicated frame cannot move a job backwards. A mark that any replayed frame
  can _lower_ reintroduces exactly what that docblock guards against.
- Do not touch `contract/src/job.ts` without the owner decision named above.

## Done when

- A `Job` driven through the back-edge by `applyJobEvent` alone — no refetch,
  no reload — renders "Downloading" as a completed step, and a test asserts it
  from the frame sequence rather than from a hand-built job.
- A job in its first `probing` state, reduced from the same code path, still
  renders "Downloading" as pending.
- A reconcile that keeps the local copy, and one that takes the remote copy,
  both retain the mark; both asserted.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

### 2026-08-23 — built

The mark is a **client-side record keyed by job id** — Build step 1's second
candidate — folded in `job-reducer.ts` and threaded `useJobs → App → JobList →
JobCard` beside `streamState`. `contract/src/job.ts` is untouched; the owner
decision the Build section names as the better answer was not available, so the
alternative it describes was not taken.

Three pieces:

- **`reachedStep(job)` in `lib/status.ts`** — the furthest pipeline step a `Job`
  proves _on its own_, or `null` for `failed` and `canceled`, which
  `STATUS_ORDER` has no step for. It carries dl-18's `attempts > 1 && probing`
  rule unchanged; the `null` is what keeps `statusIndex`'s fold of the two
  terminal statuses onto the last step from becoming a trail of four done steps.
- **`markWatched(watched, ...jobs)` in `lib/job-reducer.ts`** — a running
  `Math.max` over `reachedStep` of every state the client holds. Monotonic by
  construction, which is what the module's docblock demands.
- **`statusHighWaterMark(job, watched = 0)`** — unchanged in shape, now
  `Math.max` of the two witnesses. Neither alone is enough: a page load has only
  `attempts`, a live stream has only what it watched.

`useJobs` folds in two places, and **both are load-bearing** — each has a
mutation that only the other's test catches:

- `applyEvent` folds the job as it stood and the job the event produced. This is
  the live path, and the journey that reaches it with nothing else behind it is
  `start()` — paste a URL, watch it run in this tab — because `start` upserts the
  created job and attaches the stream without ever calling `mergeJob`. **Gate 1
  found this line covered by no test at all**; it is now covered by exactly one,
  `app.test.tsx`'s `a job started in this tab, never refetched, gets its mark
from the frames alone`, and by nothing else in the repo.
- `mergeJob` folds the _reconciled remote_, before `reconcileJob` chooses. This
  is the race, below.

### On scope: five source files, not one

The Build section names `job-reducer.ts` and the tests beside it, and this branch
touches six source files. That is the ticket's own design, not drift:

| File          | Why the ticket cannot be done without it                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `status.ts`   | Build step 2: "`statusHighWaterMark` stays the single rule; what changes is that it is given a better-informed input" — a parameter |
| `useJobs.ts`  | Build step 1: the record "has to be threaded from `useJobs` down to `JobCard`" — this is where it is folded and held                |
| `JobList.tsx` | one of the two hops `streamState` already makes; the mark makes the same trip                                                       |
| `App.tsx`     | the other hop                                                                                                                       |
| `JobCard.tsx` | the reader — one call site, `statusHighWaterMark(job, watchedStep ?? 0)`                                                            |

The threading is the cost Build step 1 priced in when it preferred the truthful
record over bumping `attempts`, and it is not free: it is three new drop-points
for the very defect this ticket exists to fix. **That is why `app.test.tsx` is in
the diff.** Both new props are `T | undefined` and **required**, so a component
that forgets to pass one fails `npm run check` rather than rendering wrong.

No cleanups, no refactors, nothing unrelated. `contract/` is untouched.

### What the brief had wrong

- **Step 1's second candidate does not, on its own, make `reconcileJob` safe —
  and the brief's own step 3 half-notices.** Step 3 says "the mark is monotonic;
  merging two of them is a max, not a choice", which is written for a mark that
  lives _on_ the job. With a separate record `reconcileJob` cannot lose the mark,
  because the mark is not one of the two things it chooses between — so that
  acceptance line reads as vacuous. It is not. The max moved: `useJobs` folds the
  remote job into the mark **before** handing it to `reconcileJob`, so the
  copy that loses still contributes its `attempts`. That is the whole fix for the
  race, and dropping that one line reddens a test.
- **The reducer does not need to detect a _backwards_ move, and the design is
  better for not doing it.** The Build section's premise is that "a frame that
  moves the job to a lower position in `STATUS_ORDER` can only be the back-edge",
  so the reducer should recognise the edge. A running maximum over every state
  the client holds gets the same answer with no special case, no `failed`/
  `canceled` trap to dodge at the comparison site, and nothing to re-derive if a
  second back-edge is ever added. What the reducer contributes is not "I saw a
  backwards move" but "I saw this job at `downloading` once".
- **A consequence of that, recorded because it is a real weakness:** with the max
  formulation, `applyEvent`'s fold of the job _before_ the event is redundant in
  the shipped wiring, and no test kills it. Enumerated under the mutation table.
- **dl-18's Log does overclaim the refetch path, and the Why is right about
  why** — but the narrower truth is narrower still than "reconnects that race".
  The refetch path is _also_ fine whenever the client watched the download stage
  itself, because the mark then already holds it. The case where the refetch is
  the only witness is a client that was **disconnected through the entire
  download stage** — attached during the first probe, dropped, and reconnected
  after the back-edge, so the only frame it ever sees is the channel's opening
  `status: probing`. That is the scenario `app.test.tsx` drives, and it is the
  one where losing the race actually cost the user a correct card.
- **`fixtures.ts`'s `job()` builds the state the _server_ holds.** Every test
  dl-18 wrote mounts one, which is exactly why none of them caught this. The two
  new card tests build nothing: they fold the real frames onto a job the client
  already has, and assert `attempts` is still `1` at the point of render, so the
  premise cannot rot.

### The reconcile race: closed, not deferred

Build step 3 asked for a deliberate decision. It is **closed**, in `useJobs`'s
`mergeJob`, and asserted at the render level rather than only in a unit — the
reconnect that slept through the download stage, whose refetch knows
`attempts: 2` and _loses_ the merge, still renders "Downloading" done. No
follow-up ticket was filed and `dl-26` was not used.

### Deliberately not done

- **No cleanup of `watchedSteps` when a job is removed.** `streamStates` in the
  same hook has the identical shape and is not pruned either; both are one small
  number per job id this tab has seen. A pruner here would be code with nothing
  observable to assert against, which is how a mutation survivor gets born.
- **No `attempts` on the wire.** That is the contract change the Build section
  names as the better answer, and it needs the owner decision dl-9 records
  needing. If it is ever taken, `reachedStep`'s `attempts` clause becomes the
  only witness needed and `markWatched` can go.

### Verification

`npm run check` exit 0. `npm test -- --project downloader`: 48 files, **676
tests**, all passing. Repo-wide `npm test`: 101 files, **1,432 tests**, from a
measured baseline of 101 / 1,416 at `4e3c48e` — so sixteen tests added and none
removed or rewritten away.

**Neither gate proves the browser.** `e2e/download.spec.ts` and the container
build live in `.github/workflows/downloader.yml` and run nowhere else. This
branch is `web` only and changes what the bundle contains, so the e2e suite is
the proof I do not have.

### Mutation checks

Seventeen, each applied and reverted after, with the file `touch`ed on restore.
Sixteen mutate the source; **row 16 mutates a test** — `job-card.test.tsx`'s own
`watch()` helper — because what it probes is whether that helper's fold is
load-bearing, which is a fact about the test and not about the product. Command
throughout:
`npx vitest run tools/downloader/web --project downloader` — **16 files, 191
tests**. **Control run over the unmutated tree first: exit 0, nothing failed.**

| Mutation                                                     | Red      |
| ------------------------------------------------------------ | -------- |
| `statusHighWaterMark` ignores `watched`                      | 7        |
| `statusHighWaterMark` returns `watched` instead of maxing    | 7        |
| `reachedStep` places `failed`/`canceled` instead of refusing | 2        |
| `reachedStep` drops the `attempts > 1` witness               | 5        |
| `reachedStep` treats a first probe as a re-probe (`>= 1`)    | 7        |
| `reachedStep` infers about every status, not only `probing`  | 1        |
| `markWatched` folds nothing                                  | 7        |
| `markWatched` is last-wins instead of monotonic              | 5        |
| `markWatched` places every job, pipeline step or not         | 3        |
| **`useJobs`: `applyEvent` folds nothing**                    | **1**    |
| `useJobs`: `applyEvent` drops only the `before` argument     | survives |
| `useJobs`: `mergeJob` stops folding the reconciled remote    | 1        |
| `useJobs`: a job's mark starts at the last step instead of 0 | 3        |
| `JobCard` ignores the mark it is handed                      | 5        |
| `JobList` never hands a card its mark                        | 4        |
| `job-card.test.tsx`'s `watch()` folds nothing per frame      | 1        |
| `markWatched` null-guard rewrite                             | survives |

**The bolded row is the one gate 1 caught me not running**, and it is the one
that matters: it is dl-20's entire live-stream mechanism. My first table ran only
its strictly weaker sibling — the row below it — and I reasoned from that
sibling's survival instead of testing the real thing. Confirmed before fixing:
with `applyEvent`'s `watch` call replaced by a no-op, the tree as I first
committed it ran **16 files / 190 tests green** and `--project downloader` ran
**48 files / 675 tests green**. Nothing in the repo noticed.

Two mutations survive, and they are different in kind:

- **`applyEvent` drops only the `before` argument** — genuine, benign, and
  unchanged from the first round. Every route by which a job reaches
  `downloading` in this client already folds that state some other way: an event
  that lands on `downloading` folds it as the after-state; `restore` reconciles
  before it attaches (`useJobs.ts`), so a job restored from `localStorage` is
  folded by `mergeJob` before any frame can arrive; and `createJob` returns a
  `queued` job (`api/src/db/job-store.ts:186` — an earlier draft cited
  `api/src/routes/jobs.ts:57`, which is the `options,` line of the `store.create`
  call and proves nothing). The argument is kept anyway: it makes `applyEvent`
  self-sufficient instead of correct-because-`restore`-happens-to-reconcile-
  first, and that ordering invariant lives in a different function and is
  enforced by nothing. It is unkillable code and this is the reason, not an
  oversight.
- **`markWatched`'s null guard rewritten** as
  `if (step === null || step > mark) mark = step ?? mark;` — a **provably
  equivalent mutant**: the assignment is a no-op on the `null` branch. Gate 1
  confirmed the truth table independently. The behaviour it was meant to probe is
  covered by the two `markWatched` rows above it, which both go red.

### Gate 1 — what it caught, in my own words

The verdict was FAIL on the proof, not the code, and it was right. Three claims
on this branch stated the opposite of what was true, all one root:

1. **`app.test.tsx`'s first live test did not prove what its name said.**
   "with no refetch behind it", and a comment asserting that a single `getJob`
   call meant the mark "can only have come from the frames". `restore` calls
   `mergeJob` **before** `attach`, and `reachedStep` reads `attempts` only for
   `probing` — so a restored `downloading` job returns step 2 whatever its
   counter says. The one call I cited as ruling the refetch out **was** the
   refetch. Renamed, comment rewritten to say so, and the missing journey added
   as its own test.
2. **`job-card.test.tsx`'s `watch()` helper seeded the mark before the loop.**
   `markWatched(0, current)` reaches step 2 on its own for a `downloading` start
   job, so the frames were decoration; neutralising the per-frame fold left all
   191 green. The seed is gone — the helper now starts at `0` and raises only
   inside the loop, which is also what `useJobs` actually does — and the section
   header no longer claims "the render is a function of the wire".
3. **The Log said `applyEvent`'s fold was "the live path: the frames alone, no
   refetch".** True of the mechanism, false of the coverage.

**This is dl-18's failure shape one level up**, and I had already caught two
instances of it on this branch — which is the uncomfortable part: my own survivor
argument rests on the same two facts (`restore` reconciles before attaching;
`createJob` returns `queued`) that make the gap invisible, and I drew the
narrower conclusion from them. The habit that would have caught it is the one
this ticket is about: **mutate the line, do not reason about it.**
