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
- `npm run check` and `npm test -- --project downloader` are green.

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
