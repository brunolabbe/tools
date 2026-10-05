---
id: dl-77
tool: downloader
title: A download the server refuses fails silently in the browser, and its card still says it will start
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-77 — a refused download says nothing in the page

**Packages:** `web` (`JobCard.tsx`), `api` (`routes/files.ts`), and possibly
`contract`, depending on the answer below.

## Why

Since dl-53, the job card's **Download** button is a plain `<a href download>`
(`LinkOffer` in `web/src/components/JobCard.tsx`). Following the link is what
starts the work. `routes/files.ts` can refuse it before the link is spent: the
per-client cap (`jobs-client-cap`, dl-51), a full wait line
(`jobs-queue-full`), and a shutdown all answer with an error status and a JSON
body. With the `download` attribute, the browser treats that answer as a file
download, and nothing in the page hears about it.

This becomes common at the owner's production values from dl-52: two job slots,
and `MAX_JOBS_PER_CLIENT` 2 keyed on the client address. A third video from one
household, or any download while a stranger holds both slots, ends this way.

## Reproduction

Run on 2026-10-05 against `origin/main` at `3a7d8a9`, in headless Chromium
through Playwright. The setup was the `e2e/download.spec.ts` journey with
`MAX_JOBS_PER_CLIENT=1`, direct tier only. The fixture HLS origin was put
behind a proxy that delays every `.ts` segment by 2.5 s, so the first download
stays open. Steps: analyse, press **Download** twice (two jobs), follow the
first card's link, and 1.5 s later follow the second card's link.

- **Server:** `{"level":"warn",...,"key":"127.0.0.1","limit":1,"msg":"download refused: per-client cap reached"}`.
- **Browser:** a `download` event fired for a file named
  `<link-token>.json`, and `download.failure()` returned `"canceled"`. The
  visitor sees a failed download named after a token, not a reason.
- **Page:** no `role="alert"`. Three seconds later, and again 20 s later, the
  second card still read `Queued`, with **Download** still offered ("works once
  · expires in 15 min") and "Starts when you open the download link. The link
  works once." That text describes exactly what the visitor just did.
- **The link was not spent.** The refusal comes before `claimLink`, so clicking
  again after the first download finishes works. Nothing tells the visitor to
  do that.

What headed Chrome or another browser shows in its download bar was not
checked. Only headless Chromium was run.

The throwaway spec and config were deleted after the run. Rebuilding them takes
about 60 lines: copy `playwright.config.ts`'s `webServer` with
`MAX_JOBS_PER_CLIENT: "1"` added to `env`, plus the delaying proxy above.

## The decision

How should the page learn that its download was refused? **Recommended: 1.**

1. **The API publishes the refusal on the job's event stream.** `files.ts`
   already holds `job.id` when it refuses, and the card already listens to that
   job over SSE. A `refused` event, carrying the error code and `retryAfterSec`,
   lets the card say why and when to try again, while the link stays offered.
   The link stays a plain anchor, so a successful download is unchanged. Cost:
   a new event shape in `@downloader/contract`, which is contract-adjacent and
   the reason this is a question. There is also a race: the browser's failed
   download and the event arrive independently.
2. **The page checks admission before following the link.** A new
   `GET /api/files/<token>/admission` (or `HEAD`) answers whether the link
   would be refused now, and the card only navigates when it would not. Cost:
   a second route, and it is check-then-act. The cap can fill between the check
   and the click, so the silent case stays possible, only rarer.
3. **The card times out on its own.** If the job has not reached
   `Re-analysing` a few seconds after the click, the card says the download did
   not start and to try again later. Cost: no reason given, a guessed timeout,
   and a slow re-probe can trip it wrongly. No API change.

## Build

Written with the decision.

## Done when

Written with the decision. Whatever the answer, it includes a Playwright
spec, under the downloader's e2e, of the reproduction above. It asserts what
the page shows after a refused download, and fails today.

## Log

- 2026-10-05 — Filed at the owner's direction ("reproduce, then file"), after
  they asked whether a visitor can download several videos at once. The
  reproduction is the orchestrator's own run, quoted above. Not built.
