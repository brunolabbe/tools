---
id: dl-20
tool: downloader
title: Carry the re-probe mark to a client that never reconnects
kind: fix
status: ready
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

_Not started._
