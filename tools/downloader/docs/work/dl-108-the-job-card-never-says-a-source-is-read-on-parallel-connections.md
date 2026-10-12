---
id: dl-108
tool: downloader
title: The job card never says when a throttled source is being read on parallel connections
kind: work-package
status: ready
milestone: null
depends_on: [dl-98]
difficulty: standard
---

# dl-108 — Show the origin connection count on the job card

## Why

[dl-98](./dl-98-parallel-ranges-for-a-throttled-progressive-source.md) splits a
progressive source that measures slower than its own bitrate into parallel
ranged reads, four connections by default. Nothing outside the API's logs says
it happened. The job card shows the speed and nothing about why it changed, so
the owner could not tell whether a job was split.

On 2026-10-12 the owner asked about a job then running in the devcontainer. The
answer took a socket listing. ffmpeg was reading
`http://127.0.0.1:<port>/<token>`, the loopback feeder. The API process held
four established `CONNECT` tunnels through its in-process egress proxy to the
same origin address on `:443`. So the job had split. A relay on one connection
would have held one tunnel. A page meant to explain a download should not need
`ss -tnp`.

**Decided by the owner, 2026-10-12**, from two options with their costs:

1. **Shape: a connection count, not a transfer mode.** The rejected option was
   `"single" | "parallel" | "fallen-back"`, which is the feeder's own `mode`.
   The chosen one is the number of origin fetches open right now. It is more
   literal. It can move between chunks (4, then 3, then 4), and it does not
   say _why_ a job went back to 1. The owner accepted both costs.
2. **Filed, not built now.** It goes to a later batch.

## Build

1. **Contract** (`contract/src/job.ts`, `contract/src/api.ts`). Add
   `originConnections: number | null` to `JobProgress` and to
   `jobProgressSchema`. Doc comment: the number of requests to the origin open at
   the moment of the snapshot, the relay included. `1` on a job the feeder reads
   and has not split. `null` when no feeder is in the path: HLS or DASH, a
   source that refused the seek probe, a host listed in
   `SINGLE_CONNECTION_HOSTS`, a remembered refusal, a separate audio rendition,
   a live capture. All of those are `splittable()`'s `false` in
   `engine/src/stream.ts`. `null` means "not measured", never `1`, so the field
   follows the contract's nullable-on-purpose rule rather than guessing.
2. **Feeder** (`engine/src/download/parallel-ranges.ts`). Expose the count it
   already keeps. `#inFlight()` counts fetches marked `inFlight` across every
   serve. Add `openFetches` to `FeederStats` from it, or add a cheap accessor if
   `stats()` builds too much per tick. **Check that the relay and the
   post-fallback continuation are counted as `inFlight`**, not only the ranged
   chunks. If the relay is not, a single-connection job reads 0. Count what
   reaches the origin, not what ffmpeg has open to the loopback.
3. **Engine** (`engine/src/stream.ts`, the `onProgress` handler of
   `streamFfmpeg` in `attempt`). Set
   `originConnections: feeder === null ? null : <the count>` on every snapshot.
   `toJobProgress` in `engine/src/ffmpeg/progress.ts` builds the rest. Set the
   field there too, as `null`, so every other producer of a `JobProgress`
   compiles and says "not measured".
4. **API.** `api/src/db/job-store.ts` reads `progress_json` with a bare
   `JSON.parse` cast, so a row written before this change has no
   `originConnections`. Either default it to `null` where the row is read, or
   make the web side treat `undefined` as `null`. Pick one and test it with a
   row that lacks the key. `initialProgress()` sets it to `null`.
5. **Web** (`web/src/components/JobCard.tsx`). While downloading, when
   `originConnections` is 2 or more, add one **progress message** under the
   bar: `progressMessages()` in `JobCard.tsx` builds the list that
   `ProgressMessages.tsx` renders (dl-109), and this is one more entry in it,
   after the status line, with the count as a text mark — `progressMessages`
   takes only the status today, so widen it to see `progress.originConnections` —
   `{ key: "connections", mark: { text: "4×" }, text: "Reading on 4 connections. This source throttles each one." }`.
   The list is already the card's `aria-live` region, so the line is announced
   when it appears. Show nothing at 1 or `null`: the line exists to explain a
   split, and "1 connection" on every job is noise. Add the field to every
   mock in `web/src/api/scenarios.ts`, and add one mock scenario that splits,
   so the mocked UI can show it. _(Rewritten by dl-109, 2026-10-12: the owner
   placed this line among the progress messages, not beside the speed.)_
6. **Tests.** Add them at the **end** of each suite; inserting mid-file moves
   other tickets' cited lines.
   - `engine/test/parallel-ranges.test.ts`: the throttled fixture's progress
     snapshots reach `originConnections >= 2` after the split. The fast-origin
     fixture's never exceed 1 and are never `null`.
   - `engine/test/stream.test.ts` or equivalent: an HLS job reports `null`
     throughout.
   - `web/test/job-card.test.tsx`: the connections message renders at 4, and is absent at 1
     and at `null`.
   - The legacy-row case from step 4.

Traps worth knowing in advance:

- Progress ticks come from ffmpeg's `-progress` pipe, not from the feeder. The
  count is sampled when ffmpeg reports, so a split shows on the next tick, not
  the instant it happens. That is fine. Do not add a second emitter.
- The dl-98 fixtures are timing-sensitive (dl-105, dl-106). Assert on "ever
  reached" or "never exceeded" across the snapshots, never on the value at an
  instant. The Windows leg failed exactly that kind of assertion.

## Done when

1. A job the feeder splits reports `originConnections >= 2` in its progress
   after the split. A test fails if the engine stops setting the field.
2. A feeder job on a fast origin reports `1` throughout. A job with no feeder
   in the path reports `null` throughout.
3. A persisted job whose `progress_json` predates the field still loads and
   renders, with the field read as `null`.
4. The job card shows the connections message at 2 or more connections and nothing at 1 or
   `null`, proven by `web/test/job-card.test.tsx`.

## Log

**2026-10-12**: filed from the owner's question on a live job (Why). Shape and
timing decided by the owner (Why, 1 and 2). Nothing built.

**2026-10-12 (build)**: built on `dl-108`. What the brief had wrong or left open:

1. **"Relay counts as `inFlight`" holds, with one edge.** `Fetch.inFlight` is
   `started && !done && failure === null` (`parallel-ranges.ts`, class `Fetch`).
   `#accept` builds the relay's `Fetch` and `#begin` sets `started`, so a relay
   counts from the moment its request is sent until its body ends; a paused
   relay still counts. The post-fallback continuation counts the same way once
   `#begin` runs, and not during the wait for the dropped fetches to close. The
   edge: once the relay's body has ended the count is a true `0`. Measured on
   the fast-origin fixture, three runs gave `[1,1,1,0]` each time: the closing
   `progress=end` tick lands after the relay. So **Done when 2 ("reports `1`
   throughout") is not what the feeder says**: it reads 1 while it reads and 0
   on the last tick. I kept the honest count rather than clamp it to 1, because
   the field is documented as the requests open at the snapshot and the card
   shows nothing below 2 either way. The timing test asserts "never more than
   1, never null", and the relay's 1 is asserted directly on the feeder
   (`openFetches` is 1 while it reads, 0 after it ends).
2. **The persisted-row case was wider than the brief said.** Step 4 named only
   `job-store.ts`, but the web keeps jobs in `localStorage` under
   `downloader:jobs:v1`, and `loadJobs` keeps only records that parse
   `jobSchema` (the comment on `thumbnailPath` in `contract/src/api.ts` records
   what a bare `.nullable()` does there: it empties the list). The API's
   `rowToJob` goes through the same schema. So neither "default it where the
   row is read" nor "web treats undefined as null" covered all readers; the
   one place that does (the row, `localStorage`, an event frame from an older
   server during a deploy) is `jobProgressSchema`:
   `z.number().nullable().default(null)`. With the `.default` removed, both
   legacy-row tests fail (`web/test/job-store.test.ts` and
   `api/test/job-store.test.ts`: 2 failed of 49); with it, 49 of 49.
3. **The mocks are in `web/src/api/mock.ts`, not `scenarios.ts`.**
   `scenarios.ts` holds only the script (`JobScript.splitAtTick`) and the new
   `throttled` scenario; the progress objects are built in `mock.ts`
   (`idleProgress`, `downloadProgress`).
4. **Count source.** `FeederStats.openFetches` is `#inFlight()`. `stats()`
   builds six scalar fields, so no separate accessor was warranted.
5. **Fold-in.** None taken: nothing else specified became free. dl-110 edits
   the same `progressMessages()` on its own branch and reconciles onto this one.
6. **Not measured**: the rendered card in a browser. The web unit tests render
   it in jsdom; no screenshot was taken.
