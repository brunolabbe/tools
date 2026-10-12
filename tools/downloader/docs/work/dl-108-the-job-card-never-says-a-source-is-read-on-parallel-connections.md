---
id: dl-108
tool: downloader
title: The job card never says when a throttled source is being read on parallel connections
kind: work-package
status: done
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
2. A feeder job on a fast origin never reports more than `1` and never `null`,
   and reports `1` while its relay reads (the closing tick, after the body has
   ended, is a true `0`). A job with no feeder in the path reports `null`
   throughout. _(Reworded 2026-10-12 by the owner's answer, Log, round 1.)_
3. A persisted job whose `progress_json` predates the field still loads and
   renders, with the field read as `null`.
4. The job card shows the connections message at 2 or more connections and nothing at 1 or
   `null`, proven by `web/test/job-card.test.tsx`.

## Review

**Gate: FAIL** — 2026-10-12 · `0484ae71..5670642d` · Opus 5.5, depth full

| Done when                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A split job reports `originConnections >= 2` after the split; a test fails if the engine stops setting it | `engine/test/parallel-ranges.test.ts` › "a job the feeder splits reports 2 or more connections, and never more than it allows" ✓ (`most >= 2`, `most <= 4`, never `null`). Positive control: `stream.ts` mutated to report `0` for every feeder job, and this test went red (1 failed of 4, `-t "dl-108"`). Measured sequence on the real feeder, 3 of 3 runs: `1, 4, 4, 4, 3, 0`                                                                                                                                                                                                                                                                                                               |
| 2. A feeder job on a fast origin reports `1` throughout; a job with no feeder reports `null` throughout      | **unproven (open decision)**, F2. The `null` clause is proven: `engine/test/stream.test.ts` › "reports originConnections as null on every snapshot, not as 0 or 1" (HLS) and `parallel-ranges.test.ts` › "a host listed as single-connection has no feeder, so the count is null throughout" ✓. The `1` clause does not hold: the last tick of every fast-origin run is `0` while the job is `downloading`. The Decision (the number of requests open right now) cannot give `1` once the origin's body has ended. No test asserts the opposite: "a fast origin never reports more than one connection, and never null" asserts `<= 1`, and it stays green when the relay is not counted at all |
| 3. A persisted `progress_json` from before the field loads and renders, read as `null`                       | `api/test/job-store.test.ts` › "a row with no originConnections still reads back, with the count null" ✓; `web/test/job-store.test.ts` › "still loads, with the count read as null (not measured)" ✓; rendering at `null` is covered by `web/test/job-card.test.tsx` › "one connection, none open between requests, and not measured all say nothing" ✓. Positive control: with `.default(null)` removed and contract rebuilt, both legacy tests failed (2 failed of 49)                                                                                                                                                                                                                        |
| 4. The card shows the connections message at ≥ 2 and nothing at 1 or `null`                                  | `web/test/job-card.test.tsx` › "a job read on 4 connections adds one message, after the status line, marked 4×", "the message follows the count: 2 connections read 2, and it goes when the count falls to 1", "one connection, none open between requests, and not measured all say nothing" ✓                                                                                                                                                                                                                                                                                                                                                                                                 |

- **high** · F1 · Done when 2 depends on it · The doc comment on `JobProgress.originConnections` in `contract/src/job.ts` states bounds the code does not keep. It says "`1` on a job the range feeder reads and has not split; `2` or more once it has", and "`0` in the gap between one request and the next". All three are a count of `Fetch.inFlight` across every serve, and that is not a statement about the split:
  - **`2` on a feeder that has not split.** Two requests from ffmpeg (a seek's overlap) on `mode: "single"`: `{"both":2,"later":2,"pausedB":2,"mode":"single","fanOut":0,"maxOpen":2}`. That is `feederFor("faststart.mp4", { durationSec: () => null })` with `GET bytes=0-` and `GET bytes=2000000-` at 200 kB/s, read through `stats().openFetches`.
  - **`0` mid-download on a job that has not split, outside any gap between requests.** On the real engine with an unthrottled origin and `moov-end.mp4`, the first tick read `n=0` in 2 of 5 runs, at `b=132371 p=0` and at `b=1299 p=0`. The relay's body had already ended into the feeder's queue, and ffmpeg was still being fed from it.
  - **`0` on the closing tick** of every fast-origin run, which F2 covers.

  Remedy: the comment should say what the count is (requests to the origin open right now, one per ffmpeg request outside a split), plus whatever F2 and F3 decide. Script: `scratchpad/dl-108/gate-1/probe-append-feeder.ts` and `probe-append.ts`, appended to `parallel-ranges.test.ts` by `probe.sh <tree> <outdir>`, which restores the file afterwards.

- **med** · F2 · **open decision** · Done when 2 depends on it · The line says "`1` throughout", and the literal count cannot give that. Measured on the real feeder and engine at 4 MB/s, `faststart.mp4`, 5 of 5 runs: `82ms n=1 p=0`, `582ms n=1 p=50`, `1083ms n=1 p=98`, `1103ms n=0 p=100`, then body end at `1113ms`, all at stage `downloading`. `moov-end.mp4` at 4 MB/s gave the same sequence in 5 of 5 runs. The card shows nothing at any of those points, because 0 and 1 both render only the status line. The Log says this openly. The engine-level tests do not hold the `1` clause either. With `#inFlight()` mutated to skip relays (`fetch.end !== null`), "a fast origin never reports more than one connection, and never null" still passed (1 passed). With `stream.ts` reporting `0` for every feeder job, it also passed. Only the feeder-level "the feeder counts its relay as one open connection…" catches the first mutation, and only the split test catches the second. **Options:**
  - (a) **Recommended.** The owner rewords the line to "never more than 1 and never `null`; 1 while the relay reads". The fast-origin test then asserts `samples.some((v) => v === 1)` beside `<= 1`, so an engine that reports 0 throughout fails. This keeps the literal count the owner chose.
  - (b) The engine clamps a feeder job to at least 1 until it ends. This meets the line as written, but contradicts "the number open right now".
- **med** · F3 · **open decision** · no Done-when line depends on it as measured · `progressMessages()` in `web/src/components/JobCard.tsx` shows "Reading on 2 connections. This source throttles each one." at any count ≥ 2. The feeder reports 2 without a split whenever ffmpeg holds two requests (F1's first bullet). On the real engine I did not catch a tick inside that overlap: 0 of 10 runs, because the moov seek finishes before the first progress tick. Whether a real source seeks while output is being written (a badly interleaved MP4) is unmeasured. **Options:**
  - (a) **Recommended.** In `attempt` in `engine/src/stream.ts`, report `openFetches` only while `stats().mode === "parallel"`, and `Math.min(openFetches, 1)` otherwise. This is one line, needs no contract change, and keeps the copy true.
  - (b) Drop "This source throttles each one." from the copy.
  - (c) Accept a rare transient false line.
- **low** · F4 · `web/test/job-card.test.tsx` › "a job that is not downloading shows no connection message, whatever the count says" asserts only an absence (`queryByText(...)` is `null`). Nothing in it checks that the card rendered anything, so an empty render would pass it too.
- **low** · F5 · `FeederStats.openFetches` ("Requests to the origin open right now") leaves out fetches being torn down: `#dropLookahead` and `#fallBack` splice them out before their sockets close (the fallback even awaits `closing`), and an error page piped by `#relayHead` empties `serve.fetches`. During a fallback, the count reads below what the origin sees. No reader depends on that precision today, so there is no live consequence.
- **dropped** · The count above the configured maximum: refuted in split mode. Sampling every 2 ms with a second relay open when the first split: `{"most":4,"max":4,"mode":"parallel","maxOpen":4}`. `#occupied()` bounds `#fillAll`, and `inFlight` is a subset of it. Outside a split, the count is one per ffmpeg request and is not bounded by `connections`, which F1 and F3 cover.
- **dropped** · The count dropping to 0–3 mid-split, with the message changing text or vanishing and the live region re-announcing. This happens when finished chunks wait in the queue under backpressure. The owner accepted that the count "can move between chunks", so this is a product decision. It is reasoned from `Fetch.inFlight`, not measured.
- **dropped** · The F9 flake ("a paused request ffmpeg closed does not keep the meter paused for the next one") was already on `main`: 9 of 10 at `0484ae71` (run 6: `expected 'parallel' to be 'single'`) and 10 of 10 at `5670642d`. It is outside the reviewed range.
- **findings** · the hunt returned 8; 5 carried, 3 dropped.
- Compatibility, through the real parse paths (`scratchpad/dl-108/gate-1/compat.mts <head tree> <base tree>`):
  - an old event frame through head's `parseJobEvent`, an old `GET /jobs/:id` body through head's `jobResponseSchema`, and an old stored record through head's `jobSchema` all give `originConnections: null`;
  - a new frame and a new response through base's schemas parse, with the key stripped;
  - a string count is rejected.
  - `rowToJob` (API) and `loadJobs` (web) both read through `jobSchema`, and a retry resets progress to `initialProgress("probing")`, so no stale count survives a back-edge.
  - Nothing maps exhaustively over `keyof JobProgress`.
  - Scope: the schema `.default(null)` is the Build step 4 choice, applied in the one place that covers all three readers. Nothing else changed behaviour.
- CI on `5670642d`: every check passes, `test (windows-latest, informational)` and `CodeQL` included.
- Invariants: no cross-tool import, no new error code, no spawn, no new logging or URL, unknown is `null` (not faked), the contract edit is decided in the ticket, the edited spec files are already registered, no new dependency, no `any` or `console` in added lines. Routes skipped: none changed.
- NFR: security n/a · performance ✓ (`stats()` once per progress tick, a handful of fetches) · reliability ✓ (old records keep parsing; F9 flake predates the branch) · maintainability: F1.

### Gate 2

**Gate: FAIL** — 2026-10-12 · `5670642d..69d90d53` (the round: `1a789dbc`, `69d90d53`) · Opus 5.5, re-gate

| Done when                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2 (reworded by the owner: never more than `1`, never `null`, `1` while the relay reads; `null` with no feeder) | `engine/test/parallel-ranges.test.ts` › "a fast origin never reports more than one connection, and never null" ✓, now with `samples.some((value) => value === 1)`. Positive control: with `#inFlight()` skipping relays it fails, `[0,0,0,0]: expected false to be true`. With `originConnectionsOf` reporting `0` outside a split it fails the same way. The `null` clause is unchanged from gate 1 ✓. Measured at 4 MB/s, 10 of 10 runs (`faststart.mp4` and `moov-end.mp4`): `1, 1, 1, 0`, with the `0` on the closing tick |

Earlier findings:

- **F1 (high)**: **fixed** for what it named. Outside a split the count is now capped at 1, so the 2 that gate 1 measured on an unsplit feeder never reaches a snapshot. The 0 mid-download is now covered by "`0` when none is open". The sentence the round wrote for the split case is a new `high`, below.
- **F2 (med)**: **fixed**. The line was reworded per the owner's answer (a). The test now fails on both mutations that gate 1's positive control showed staying green.
- **F3 (med)**: **fixed**. `originConnectionsOf` in `engine/src/stream.ts` caps the count at 1 unless `mode === "parallel"`. `engine/test/stream.test.ts` › "outside a split it never exceeds 1, even with two requests open (F3)" fails with the cap removed (`expected 2 to be 1`). See the `low` below for the call site.
- **F4 (low)**: **fixed**. The probing test asserts `messages()` has length 2 before it asserts the absence.
- **F5 (low)**: **fixed as a caveat**. The `FeederStats.openFetches` comment now matches `#dropLookahead` and `#fallBack`.

New in the round's lines:

- **high** · no `Done when` line depends on it · The rewritten doc comment on `JobProgress.originConnections` in `contract/src/job.ts` says "Once it has split it is `2` or more and moves between chunks (4, then 3, then 4)". The code does not keep that lower bound.
  - **The closing snapshot of a split job is `0`.** `mode` is still `"parallel"`, so `originConnectionsOf` passes the raw count. Measured: `1, 4, 4, 4, 3, 0` in 3 of 3 runs (`moov-end.mp4`, 500 kB/s per connection).
  - **A split the origin refuses reads `1` for the rest of the job.** `mode` is `"fallen-back"`, and the cap applies. Measured with `behaviour.refuse = "429"`: the fan-out request `bytes=229424-360495` went out, then 16 ticks of `1` and a closing `0`, 3 of 3 runs.

  The fix is one sentence: "In a split it is the requests open, up to the configured connections, and moves between chunks (4, then 3); it is `0` at the closing snapshot, and `1` for the rest of the job once a split falls back." Reproduction: `scratchpad/dl-108/gate-1/probe-split.sh <tree> <outdir>` and `scratchpad/dl-108/gate-2/probe-fallback.sh <tree> <outdir>`. Each appends a sampling test to `parallel-ranges.test.ts`, runs it, and restores the file.

- **low** · Nothing holds the call site in `attempt`. With `originConnections: feeder === null ? null : feeder.stats().openFetches` restored in `stream.ts`, which is exactly the pre-round code, all 8 dl-108 tests pass (`-t dl-108` over `parallel-ranges.test.ts` and `stream.test.ts`). The unit test proves `originConnectionsOf`, not that the engine calls it. No engine-level run here samples a tick inside a two-request overlap.
- **findings** · the round's lines returned 3: 2 carried, and 1 dropped. Dropped: the F5 caveat does not name the error page `#relayHead` pipes, which also leaves the count; a caveat need not list every case.
- Locally at `69d90d53`, after `npm run build`:
  - 9 affected spec files: 213 of 213 passed.
  - `stream.test.ts -t dl-108`: 4 passed of 79.
  - `parallel-ranges.test.ts`: 43 of 43 passed.
- CI on `69d90d53`, read once: every check passes except `test (ubuntu-latest)` and `test (windows-latest, informational)`, both **still pending**.
- NFR: security n/a · performance ✓ · reliability ✓ · maintainability: the `high` above.

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

**2026-10-12 (round 1, gate 1 at `5670642d`: FAIL)**: two decisions answered by
the owner on 2026-10-12, through the orchestrator, each from options the gate
gave with its recommendation first:

- **F2, the count on a fast origin.** Options: (a) reword Done when 2 to "never
  more than `1` and never `null`; `1` while the relay reads", and have the
  fast-origin test assert `samples.some((v) => v === 1)` as well as `<= 1`; (b)
  clamp a feeder job to at least `1` until it ends. **Chosen: (a).** The line
  above is reworded. The gate measured the real sequence five times on
  `faststart.mp4` and `moov-end.mp4` at 4 MB/s: `n=1` at 82, 582 and 1083 ms, then
  `n=0` at 1103 ms, just before the body end at 1113 ms.
- **F3, a false "throttles each one".** The feeder counts every request ffmpeg
  has open, so a seek's overlap reads 2 without any split (measured by the gate
  with two ranged reads on `mode: "single"`: `openFetches` was 2). Options: (a)
  report `openFetches` only while `mode === "parallel"` and cap it at 1
  otherwise; (b) drop "This source throttles each one." from the copy; (c)
  accept a rare transient false line. **Chosen: (a).** `originConnectionsOf` in
  `engine/src/stream.ts` does it; `engine/test/stream.test.ts`, "outside a split it
  never exceeds 1, even with two requests open (F3)", is red with the cap removed
  (`expected 2 to be 1`).

Findings and what changed:

- **F1 (high).** The doc comment on `JobProgress.originConnections` claimed `1`
  on an unsplit job and `0` only in a gap. Rewritten to what the count is: `1`
  while the one request is open and never more outside a split, `0` when none is
  open (which includes the closing snapshot), `2` or more only in a split.
  `FeederStats.openFetches` carries the F5 caveat too.
- **F2.** Done when 2 reworded (above); the fast-origin test now fails on an
  engine that reports `0` throughout. **The positive control the gate planted**:
  with `#inFlight()` skipping relays (`fetch.inFlight && fetch.end !== null`),
  "a fast origin never reports more than one connection, and never null" now
  fails (`[0,0,0,0]: expected false to be true`), together with the feeder-level
  relay test (`expected +0 to be 1`); before this round it passed. The new clause
  held in 5 of 5 reruns.
- **F4 (low).** The "not downloading" card test now asserts the card rendered its
  two messages before asserting the connection line is absent.
- **F5 (low).** Taken as a caveat on `FeederStats.openFetches`, not a code change:
  no reader depends on the precision and the card never shows below 2.
- **Not measured**: whether a real source seeks while output is being written. F3's
  cap makes the answer matter only to the split's own count.

**2026-10-12 (round 2, gate 2 at `69d90d53`)**: one `high`, the doc comment on
`JobProgress.originConnections` said a split job "is `2` or more", which is not a
lower bound. Measured by the gate's probes and reproduced here on the same head:
a split of four connections on `moov-end.mp4` reads `1, 4, 4, 4, 3, 0`, the
closing snapshot being `0` because `mode` is still `"parallel"`; and a split the
origin refuses (`behaviour.refuse = "429"`) reads `1` for the rest of the job and
a closing `0`, because `mode` is `"fallen-back"` and `originConnectionsOf` caps
it. The comment now says that. Nothing else on the branch states the bound:
`FeederStats.openFetches`, `originConnectionsOf` and this ticket's Decision prose
say only that a split moves between chunks, and Done when 1 asks for `>= 2` at
some tick of the split, which is what its test asserts. The gate's `low` (nothing
holds the call site in `attempt`) stays recorded and unfixed.
