---
id: dl-65
tool: downloader
title: Cancelling a download from the UI answers `INTERNAL` and leaves the download running
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-65 — Cancel from the UI never reaches the server's cancel route

## Why

Reported from use: cancelling a download showed "Something went wrong — This one
is on us", and the download still seemed to count, refusing the next one.

Reproduced on `origin/main` at `3be20cf`, with the real API and engine serving
the built UI, a throttled local origin (60 s clip, HLS and progressive) and
Chromium driving the page:

- The page's `POST /api/jobs/:id/cancel` answered **500**
  `{"code":"INTERNAL","message":"Something went wrong on our end."}`. The log
  line is `request failed` with `code: INTERNAL` — the cancel handler never ran.
- The same job, left alone, logged `engine download complete` and `job
completed` 13 s later. The download was never stopped.
- The card had been marked `failed` with that `INTERNAL`, and its event stream
  dropped, so the page showed a dead job while a live one held one of the
  client's `MAX_JOBS_PER_CLIENT` slots until it finished — that is the "won't
  allow a second download".

The same cancel sent with `curl` succeeded every time (running or waiting,
progressive or HLS), which isolated it to the request the page builds:
`web/src/api/http.ts` put `Content-Type: application/json` on **every**
request, and cancel is a `POST` with no body. Fastify refuses an empty body
declared as JSON (`FST_ERR_CTP_EMPTY_JSON_BODY`, a 400) before any route runs,
and `toErrorResponse` maps any error that is not an `AppError` to `INTERNAL` 500. `curl -XPOST -H 'content-type: application/json'` with no body reproduces
the 500 on its own; the same with `-d '{}'` cancels.

Nothing caught it because every web suite runs against a fake `ApiClient`, and
every API cancel test uses `inject` without that header.

## Build

1. `web/src/api/http.ts`: declare `Content-Type` only when the request has a
   body.
2. `web/src/hooks/useJobs.ts`: a failed cancel request is not a failed job. Ask
   the server for the job instead; keep the stream attached while it is still
   running, and fall back to marking it failed only when that read fails too.

Not here: the server reporting a client's malformed body as `INTERNAL` 500 is
its own defect with an open decision about the code — see
[dl-66](./dl-66-a-malformed-request-body-is-reported-as-internal.md).

## Done when

- A body-less request from the real transport carries no `Content-Type`, and a
  request with a body still declares JSON — `web/test/http-client.test.ts`.
- A cancel the server refuses leaves the card active and attached to its stream
  — `web/test/app.test.tsx`, "a cancel the server refused leaves the card
  following the job it could not stop".
- A cancel the server refuses for a job that finished meanwhile shows how it
  finished, not the cancel's error — `web/test/app.test.tsx`, "a cancel the
  server refused for a job that has since finished shows how it finished".
- A cancel the server accepts while the job is still running keeps the card
  attached until the `canceled` frame lands — `web/test/app.test.tsx`, "a cancel
  the server accepted before the job stopped keeps following it to canceled".
- `npm run check` and `npm test -- --project downloader` are green.

## Review

**Gate: PASS after one repair** — 2026-09-16, `ticket-reviewer` on `3754898`,
repaired in the following commit.

| Done when                                                                | Proof                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Body-less request declares no `Content-Type`; a body still declares JSON | `web/test/http-client.test.ts`, both tests ✓                                                            |
| A refused cancel leaves the card active and attached                     | `app.test.tsx`, "a cancel the server refused leaves the card following the job it could not stop" ✓     |
| A refused cancel for a finished job shows how it finished                | `app.test.tsx`, "a cancel the server refused for a job that has since finished shows how it finished" ✓ |
| An accepted cancel of a still-running job follows it to `canceled`       | `app.test.tsx`, "a cancel the server accepted before the job stopped keeps following it to canceled" ✓  |
| `npm run check`, `npm test -- --project downloader` green                | run on the repaired tip ✓                                                                               |

- **Premise** — verified independently by the reviewer against the API harness:
  a cancel `inject` carrying `content-type: application/json` and no body
  answers `500 INTERNAL`; without the header it reaches the route.
- **(med) The success path detached a job still running** — `cancel()` detached
  on any `200`, but the route answers before the abort unwinds, so a job
  canceled mid-probe comes back non-terminal and its `canceled` frame had no
  stream left to arrive on. Pre-existing, and the same symptom the browser run
  showed in its third round. **Fixed**: `if (!isTerminal(job)) return;` after
  `mergeJob`, with the test above; it fails with the line removed.
- Informational: no other web request had the header problem; the planner's
  client already gates `Content-Type` on a body.

## Log

- 2026-09-16 — Reproduced and fixed in one branch at the owner's choice (client
  header plus the stale card; the server mapping filed as dl-66). All three new
  tests fail with `web/src` reverted and pass with it. Re-ran the browser
  reproduction against a rebuilt UI: three consecutive download-then-cancel
  rounds, three `200` cancels, three `job canceled`, no `500` in the API log, and
  a new download accepted after each one. A cancel that lands while the job is
  still re-analysing shows on the card when the browser probe unwinds, not at the
  `200` — that is the route's documented behaviour (the orchestrator writes the
  terminal state), not a regression.
- The card gives no sign that a cancel request failed: it simply stays active
  with its Cancel button. That is deliberate — the one failure this fix knows of
  is gone, and inventing copy for an unknown one is worse than letting the user
  press Cancel again.
- 2026-09-16 — Gate found the success path detaching a job that the cancel's
  `200` still reported as running (see Review). Fixed in the same branch. The
  brief's "keep the stream attached while it is still running" applied to both
  paths, not only the failed one.
