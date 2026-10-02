---
id: dl-74
tool: downloader
title: Remove MUX_FAILED from the contract, now that nothing can raise it
kind: chore
status: ready
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
