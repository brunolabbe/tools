---
id: dl-74
tool: downloader
title: Remove MUX_FAILED from the contract, now that nothing can raise it
kind: chore
status: done
milestone: null
depends_on: [dl-53]
difficulty: mechanical
---

# dl-74 — retire `MUX_FAILED`

**Packages:** `contract` (the code, its message), `api` (its HTTP status), `web`
(its presentation entry), and the tests that name it.

## Why

`MUX_FAILED` meant "ffmpeg exited non-zero while remuxing or concatenating",
and it was raised by the separate mux pass that joined a downloaded video and
audio into a file. [dl-53](./dl-53-finished-files-and-the-tunnel.md) removed
that pass: every stream is one ffmpeg that fetches its own inputs and writes
straight to the visitor, and any failure it has is `DOWNLOAD_FAILED`. dl-53's
second gate removed `runFfmpeg`, the last function whose default could raise
it, and narrowed `FfmpegFailureCode` in `engine/src/ffmpeg/runner.ts` to
`DOWNLOAD_FAILED` alone.

A code nothing can raise still costs a message, an HTTP status, a presentation
entry, and a line in `web/test/mock-api.test.ts` explaining why no scenario
reaches it. It also tells the next reader that a mux step exists.

Filed rather than done in dl-53 because removing a code is a contract change,
and the owner decided on 2026-09-27 (dl-53's Log, decisions of that round) to
file it rather than fold it in.

## Build

1. Remove `MUX_FAILED` from `DOWNLOADER_ERROR_CODES` and
   `DEFAULT_ERROR_MESSAGES` in `contract/src/errors.ts`.
2. Remove its entries in `api/src/http-errors.ts` and
   `web/src/lib/error-presentation.ts`.
3. Update the tests that name it: `api/test/pipeline.test.ts` (it uses it as a
   non-retryable engine failure — any other non-retryable code serves) and the
   `noLongerRaised` list in `web/test/mock-api.test.ts`.
4. **Check the persisted records before you delete.** A job row or a browser's
   `downloader:jobs:v1` record written before dl-53 may carry
   `error.code: "MUX_FAILED"`, and `errorCodeSchema` would then refuse it: a
   job row would throw `INTERNAL` on read, and a browser record would be
   dropped from the list. Decide, and say in the Log, whether a migration maps
   those rows to `DOWNLOAD_FAILED` or the code stays readable but unraised.

## Done when

- `grep -rn MUX_FAILED tools/downloader/*/src` finds nothing, or only the
  read-side mapping step 4 chose.
- A job row carrying `MUX_FAILED` from before the change still reads back, by
  whichever route step 4 chose, and a test says so.
- `npm run check` and `npm test` are green.

## Review

### Gate 1

_Re-issued at `2eb8f51`, the gated sha `b523d92` unchanged: coordinates re-resolved. Citations whose text the rounds after it deleted, or whose claim they corrected, are now prose naming `b523d92`: the `http.ts` mapping line in the first row and in finding 3, the `errorCodeSchema` line in finding 1, the three `as` casts and the fixture cast in finding 2, and the read-back test lines in the second row and in finding 4. The `appErrorPayloadSchema` coordinate is re-resolved to its new line. Every row, finding and verdict is as written at `b523d92`; gates 2 and 3 below give each finding a verdict, the last at `2eb8f51`._

**Gate: FAIL** — 2026-10-02 · `24acb04...b523d92` (origin/main was still `24acb04` after the fetch) · code-review at medium, run by hand (no Skill tool)

| Done when                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grep -rn MUX_FAILED tools/downloader/*/src` finds nothing, or only the read-side mapping step 4 chose                       | **unproven** — not met as written. The grep prints 7 lines in 3 files at the head: five comments, the retirement list `tools/downloader/contract/src/errors.ts:82 "const RETIRED_ERROR_CODES"`, and a second, display-time mapping in `tools/downloader/web/src/api/http.ts` at `b523d92` that is not the route the Log says was chosen (finding 6)                                                                                                                                                                                                             |
| A job row carrying `MUX_FAILED` from before the change still reads back, by whichever route step 4 chose, and a test says so | **proven for the API row** — the read-back test in `tools/downloader/api/test/job-store.test.ts` at `b523d92`, which asserted the stored code came back as `MUX_FAILED`, red with the read side removed (controls below). The browser record is asserted only at the schema, in `tools/downloader/web/test/mock-api.test.ts` at `b523d92`, never through `loadJobs`, and what `loadJobs` returns crashes the app (finding 1)                                                                                                                                    |
| `npm run check` and `npm test` are green                                                                                     | **verified** — `npm run check` exit 0 at the head. `npm test -- --project downloader`: head 1562 passed, 2 skipped (1564) in 92 files; base `24acb04` 1560 passed, 2 skipped (1562) in 92 files, so +2 is the two new tests. `--project core --project planner --project ledger` at the head: 1504 passed in 93 files. The `repo` project was not run (nothing under `scripts/` changed). The test-file diff has no deleted assertion: `pipeline.test.ts` swaps one non-retryable code, `mock-api.test.ts` shortens `noLongerRaised`, `fixtures.ts` adds a cast |

- **high** · finding 1 (five probes, one mechanism) — a stored `MUX_FAILED` is now accepted by every read, and the UI that presents it throws. `errorCodeSchema` takes the retired code (`errorCodeSchema` in `tools/downloader/contract/src/api.ts` at `b523d92`, a bare `z.enum(ALL_ERROR_CODES)`) while `ErrorCode` and the presentation table do not hold it. Five web paths hand the parsed value on typed `ErrorCode`: `loadJobs` (`tools/downloader/web/src/lib/job-store.ts@24acb04:51 "jobSchema.safeParse(candidate)"`), `getJob` (`tools/downloader/web/src/api/http.ts@24acb04:112 "getJob: (id: string)"`) with `createJob` and `cancelJob` beside it, and the SSE `failed` frame (`tools/downloader/web/src/api/http.ts@24acb04:120 "parseJobEvent(message.data)"`). `JobCard` gives `job.error` to `ErrorPanel` (`tools/downloader/web/src/components/JobCard.tsx@24acb04:160 "ErrorPanel error={job.error}"`), which indexes the table (`tools/downloader/web/src/lib/error-presentation.ts@24acb04:336 "const entry = ERROR_PRESENTATION[payload.code]"`) and dereferences the result (`tools/downloader/web/src/lib/error-presentation.ts@24acb04:354 "entry.allowRetry && payload.retryable"`). Rendered at the head, with the stored record seeded as the ticket describes it: `W1 loaded.length = 1 code = MUX_FAILED`, then `W1 JobCard threw: TypeError: Cannot read properties of undefined (reading 'allowRetry')`; the same TypeError from `presentError` directly (W2) and from `render(<App />)` over a seeded `downloader:jobs:v1` (`W6 App render threw: TypeError ...`); `W3 parseJobEvent -> failed` then `W3 reduced job.error.code = MUX_FAILED`; `W4 getJob error.code = MUX_FAILED`. The API serves it verbatim: `A3 GET job 200 error.code = MUX_FAILED` and `A3 SSE 200 1 frame(s) carry MUX_FAILED`. Web `src` has no error boundary (a search for ErrorBoundary, componentDidCatch and getDerivedStateFromError over `tools/downloader/web/src` matched nothing), so the jsdom render throwing is the whole tree unmounting in React; a blank page in a real browser is React behaviour I did not measure (no e2e run). The record would persist, because `useJobs` seeds its state from `loadJobs`. Before this branch the same record presented as "Could not assemble the file"; W1, W2 and W6 are green on `24acb04`. Reproduction: copy the two probes from `/tmp/claude-1000/-workspaces-tools/cb856cea-dbe3-4458-bbc5-7099727875c8/scratchpad/dl-74/gate-1/` (`probe-web.test.tsx` to `tools/downloader/web/test/zz-gate-dl74.test.tsx`, `probe-api.test.ts` to `tools/downloader/api/test/zz-gate-dl74.test.ts`), `npx vitest run` each; they assert what a fix should produce (no throw, `DOWNLOAD_FAILED`), so they are red now. Delete them after.
- **med** · finding 2 (one mechanism with the test fixture cast) — the contract widened what its schemas accept beyond `ErrorCode` and stopped checking it. `tools/downloader/contract/src/api.ts:137 "export const appErrorPayloadSchema = z.object({"` lost its `satisfies` outright; `jobSchema`, `jobEventSchema` and `errorResponseSchema` (and `jobResponseSchema`) in the same file became `as z.ZodType<...>` casts at `b523d92`, and `errorPayload` in `tools/downloader/web/test/fixtures.ts` took an `as AppErrorPayload` there, paying the same cost in a test. Measured on a scratch edit of each tree: widening `status: jobStatusSchema` to `z.string()` in `jobSchema` typechecks at the head (`tsc --build tools/downloader/contract` exit 0) and fails at the base with TS1360 (string not assignable to the status union); dropping a required field (`attempts`) still fails at the head with TS2352, so the cast is narrower than no check and wider than the read side needs. Consumers with an exhaustive map over `ErrorCode`, found by searching `tools/downloader/*/src` for `Record<ErrorCode`, `ErrorCatalog<ErrorCode>`, `ERROR_CODES` and `.code`: 3 maps and 1 catalog. Web `ERROR_PRESENTATION` (`tools/downloader/web/src/lib/error-presentation.ts@24acb04:42 "export const ERROR_PRESENTATION: Record<ErrorCode"`) is reachable and throws (finding 1). Api `STATUS_BY_CODE` (`tools/downloader/api/src/http-errors.ts@24acb04:14 "const STATUS_BY_CODE: Record<ErrorCode, number>"`) returns undefined for the retired code and Fastify then answers 500 `FST_ERR_BAD_STATUS_CODE` (rendered: `A1 statusForCode = undefined`, `A2 fastify answered 500`), but only `failureOf` feeds it a stored code and `files.ts` refuses first (`tools/downloader/api/src/routes/files.ts@24acb04:109 "link.usedAt !== null || job.status"` answers FILE_EXPIRED for any job that is not queued), so a stored failed row cannot reach it today. Contract `DEFAULT_ERROR_MESSAGES` (`tools/downloader/contract/src/errors.ts:99 "export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string>"`) and the `ERROR_CATALOG` the `AppError` constructor reads would give an undefined message; both are behind the table lookup above or behind INTERNAL only, so unreached. `RETRYABLE_CODES` is a set, not a map: `.has` answers false. Parse sites that can produce the wide value: 1 on the API side (`tools/downloader/api/src/db/job-store.ts@24acb04:196 "jobSchema.safeParse(job)"`, behind `get`, `find`, `GET /api/jobs/:id` and the SSE snapshot `tools/downloader/api/src/routes/events.ts@24acb04:94 "error: job.error, at: context.now()"`), 6 on the web side (`loadJobs`, the non-ok body, `createJob`, `getJob`, `cancelJob`, the SSE frame). `report.ts` reads `error_json` as raw text and a string, so it is unaffected.
- **med** · finding 3 — the one place the retired code is mapped, in `tools/downloader/web/src/api/http.ts` at `b523d92`, is on the one path that cannot carry it, and no test reaches it. It sits in the non-ok branch, which parses an error body built from a freshly raised `AppError`, and nothing raises the code now. Control B: with only that mapping removed and every other line at the head, `npx vitest run tools/downloader/web/test` is 264 of 264 green. W5 (a 500 body carrying the code) reaches it and gets `DOWNLOAD_FAILED`, so the line works where it is; W4 (the same code inside a 200 job body) shows it is not applied to the paths that carry the code. The ticket Log entry dated 2026-10-02, as it stood at `b523d92`, says the error "is mapped to DOWNLOAD_FAILED for display" in the web client, which is true of none of the three stored-record paths.
- **low** · finding 4 — the read-back tests are weaker than the line they carry. The API test sits inside the describe for probe outcomes (`tools/downloader/api/test/job-store.test.ts:442 "probe_outcomes (dl-57)"`) and at `b523d92` seeded a job that is still `queued` with an error attached, a shape no pre-dl-53 row had. At `b523d92` the browser test sat in the mock transport suite (`tools/downloader/web/test/mock-api.test.ts`) and called `jobSchema.safeParse`, not `loadJobs`. Both fail on the same single edit (control A), so they are one control, not one per store.
- **low** · finding 5 — the ticket Log entry dated 2026-10-02 says the downloader project passed 1560 tests; the head runs 1562 and the base runs 1560, so the figure is the base count.
- **low** · finding 6, open decision — Done when 1 is not met as written, and a build that documents the retirement cannot meet it, because five of its seven hits are the comments that explain it. Option A (recommended): amend the clause to "outside comments", keeping one read-side line. Option B: strip the code name from the comments so the clause holds literally, at the cost of comments that say "a retired code" and name nothing.
- **low** · finding 7 — this branch moves two anchors in a merged record, `tools/downloader/docs/work/dl-53-finished-files-and-the-tunnel.md`, whose `## Review` cites `tools/downloader/contract/src/errors.ts@24acb04:89 "This download link has expired or was already used"` (now line 103) and `tools/downloader/engine/src/ffmpeg/runner.ts@24acb04:117 "export function isTlsVerificationFailure"` (now line 116). `node scripts/citations-gate.mjs --against 24acb04` exits 0 (`144 enforced, 0 failing`, 48 moved citations in 17 unchanged records reported, not failed); the bare form exits 1 with 17 records failing. I attributed these two to the branch by reading each anchor at the base with `git show 24acb04:<path>`; the bare form at the base was not run. Two more were already moved at the base and shifted again, `tools/downloader/web/src/lib/error-presentation.ts@24acb04:314 "function readCancelReason("` (dl-53 cites 296) and `tools/downloader/api/src/http-errors.ts@24acb04:132 "raises its own 412"` (pl-51 cites 125); they are not this branch debt.
- **open decision (finding 1)** — two remedies, neither settled here. A (recommended): map on read, so `errorCodeSchema` becomes `z.enum(ALL_ERROR_CODES)` followed by a transform to `DOWNLOAD_FAILED` for the retired code, returning `ErrorCode`. Dry run on a scratch edit of the head: the contract typechecks (`tsc --build tools/downloader/contract` exit 0) with `satisfies` restored on all five schemas, and probes W1, W3, W4, W5, W6 and A3 go green (6 of 9); W2, A1 and A2 stay red because they call `presentError` or `statusForCode` directly with a cast value no parse can produce. It covers both stores (a server-side row migration cannot reach a browser), lets the web mapping in `http.ts` go, and turns the two read-back tests into asserting `DOWNLOAD_FAILED`; the row keeps its old text in the database until rewritten. B: keep it readable and unmapped and give the retired code a presentation entry, widening `Record<ErrorCode, ...>` consumers; that reverses Build step 2 (remove its presentation entry) and keeps the casts.
- **controls (item 2)** — A, the read side of both stores: only `errorCodeSchema` set back to `z.enum(ERROR_CODES)` (import changed to match), contract rebuilt and `dist` grepped for `z.enum(ERROR_CODES)`; `npx vitest run tools/downloader/api/test/job-store.test.ts tools/downloader/web/test/mock-api.test.ts` gives 2 failed, 56 passed (58): the API test fails on `INTERNAL` "A stored job could not be read.", the web test on `jobSchema.safeParse` returning false. Restored, `dist` grepped for `z.enum(ALL_ERROR_CODES)`, 58 of 58 green; 58 of 58 green before the mutation. B, the web mapping: finding 3, no test goes red.
- **dropped** · a finder-style report that `failureOf` can hand `STATUS_BY_CODE` a stored code: not reachable, `files.ts` answers FILE_EXPIRED before any run for a job that is not queued; kept only as a note in finding 2.
- **dropped** · the comment deleted in `tools/downloader/engine/src/ffmpeg/runner.ts` as out of scope: Done when 1 greps `engine/src`, so the edit follows from the ticket.
- **dropped** · `pipeline.test.ts` changing its non-retryable code to `SIZE_LIMIT_EXCEEDED` as a change of meaning: that code is not in `RETRYABLE_CODES`, and Build step 3 says any non-retryable code serves.
- **findings** · code-review at medium returned 10 (finding 1 was five probes of one mechanism); 7 carried as findings 1 to 7, 3 dropped.
- NFR: security n/a · performance n/a · reliability — findings 1 and 3 · maintainability — finding 2. Invariants skipped: spawn, redaction, SSRF, progress, Dockerfile, test registration (no source of that kind changed); the contract edit is within Build steps 1 and 4, but `ALL_ERROR_CODES` is a new public export through the barrel that the Build does not name.

## Log

- 2026-09-27 — Filed from dl-53's second gate, on the owner's answer of the
  same day. Not implemented.
- 2026-10-02 — Gate 1 (FAIL at b523d92) found that stored MUX_FAILED crashed the
  web UI (no ERROR_PRESENTATION entry). Raised two questions for the owner via
  AskUserQuestion, both answered 2026-10-02, both chose the recommended option:

  **Decision 1:** "How should a stored MUX_FAILED be handled?" Options were
  "map on read" (recommended) and "readable, unmapped, with presentation and
  status entries restored". **Chosen: map on read.** `errorCodeSchema` transforms
  MUX_FAILED to DOWNLOAD_FAILED during parse, so the output type is always
  `ErrorCode`. Covers both API job rows (via `jobSchema` parse) and browser
  `downloader:jobs:v1` records (same schema path). Tests verify transformation:
  API test reads a failed job with raw MUX_FAILED error_json; web test validates
  schema parse of old job record with MUX_FAILED code. Satisfies restored on
  jobSchema, jobEventSchema, jobResponseSchema, errorResponseSchema (compiler
  was widened, now checks exact type match). Fixture cast and http.ts mapping
  removed (mapping was in wrong path: non-ok branch carries only freshly raised
  errors, never stored codes).

  **Decision 2:** "Done-when #1's grep also matches comments that document the
  retirement." Options were "amend it to 'outside comments'" (recommended) and
  "strip the code's name from the comments". **Chosen: amend.** Done-when #1 is
  read as "outside comments", by this decision. Keep the comments documenting
  the retirement. Do not edit the Done-when line itself.

  Gate finding 3 (mapping in wrong path) is superseded by the transform, which
  handles conversion at the schema layer for all three data paths.

- 2026-10-02 — Gate 2 repairs. `errorCodeSchema` no longer casts its transform
  result to `ErrorCode`: with a second entry in `RETIRED_ERROR_CODES`,
  `npx tsc --build tools/downloader/contract` exits 2 with 5 errors, where the
  cast had let it exit 0 and pass the unmapped code through typed as `ErrorCode`
  (reverted after the measurement). The render spec
  `tools/downloader/web/test/mux-failed-render.test.tsx` now asserts the stored
  job is shown with the `DOWNLOAD_FAILED` presentation (heading and code), and
  went red on both of its cases with the schema made to reject `MUX_FAILED`;
  the API test asserts message and `retryable` again. This branch also pinned
  three citations in the merged dl-53 record to `@24acb04`, the ones whose
  coordinates the removals moved (`errors.ts:89`, `runner.ts:117`,
  `error-presentation.ts:296`, now `:314`), changing no words.
  Verified at this head: `npm test -- --project downloader` 1564 passed, 2
  skipped (92 files passed, 1 skipped), exit 0; `npm run check` exit 0.
