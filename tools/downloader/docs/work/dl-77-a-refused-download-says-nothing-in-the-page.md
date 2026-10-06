---
id: dl-77
tool: downloader
title: A download the server refuses fails silently in the browser, and its card still says it will start
kind: fix
status: ready
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

**Answered 2026-10-06: option 1**, by the owner, asked through the orchestrator
(tools-15) from the three options above; it is the recommendation, so it
overrides nobody's.

1. **`@downloader/contract`.** `JobEvent` gains
   `{ type: "refused"; jobId; error: AppErrorPayload; at }`, and
   `jobEventSchema` the matching variant. It carries `error`, whose `code` is
   `RATE_LIMITED` (or `INTERNAL` at shutdown) and whose `details.retryAfterSec`
   is the same number the `429`'s `Retry-After` carries, rather than a second
   top-level field that could disagree with it. It is **not terminal**: the job
   stays `queued` and its link stays usable.
2. **`JobEventHub`** gets a `refused(jobId, error)` helper beside `failed`.
3. **`routes/files.ts`** publishes one frame, built from the same
   `toPublicPayload` the error response uses, at every refusal that comes before
   `claimLink` and leaves the link usable: the full wait line
   (`jobs-queue-full`), the per-client cap (`jobs-client-cap`), and shutdown.
   The bounded wait for a slot (`jobs-wait-timeout`) refuses the same way after
   giving the link back, so it publishes too. The ticket did not list it; it is
   the same silent failure, a few lines further down the same handler.
4. **Web.** `applyJobEvent` treats `refused` as a no-op on the `Job` (the record
   has no field for it, and `Job` is a contract type). `useJobs` keeps the
   refusal beside the job, as it does the watched mark, and `JobCard` renders it
   through `ErrorPanel` above the still-offered **Download**. Following the
   link clears the old refusal, so a stale "wait 30 s" is not left standing over
   a second attempt. A refusal older than the job's last frame, or for a job
   no longer `queued`, is dropped.
5. **Order.** The card never depends on the browser's failed download: the page
   cannot observe it. It reacts to the event alone, so either order of the two is
   the same card.

## Done when

- A Playwright spec under `tools/downloader/e2e` reproduces the run above
  (`MAX_JOBS_PER_CLIENT=1`, a delaying proxy in front of the fixture origin, two
  jobs, the second link followed while the first download is open) and asserts an
  alert naming the reason and a wait, with **Download** still offered. It fails
  on `origin/main` and passes on the branch, both outputs in the pull request.
- API tests show a `refused` frame on the job's stream for `jobs-client-cap`
  and `jobs-queue-full`, carrying the code and `retryAfterSec`; shutdown and
  `jobs-wait-timeout` too.
- A test shows the link is still usable after a refusal.
- The contract schema, the web reducer and `JobCard` have tests for the variant.
- `npm run check`, `npm test -- --project downloader` and
  `npm run e2e:downloader` pass.

## Log

- 2026-10-05 — Filed at the owner's direction ("reproduce, then file"), after
  they asked whether a visitor can download several videos at once. The
  reproduction is the orchestrator's own run, quoted above. Not built.
- 2026-10-06 — Owner's answer recorded: option 1, chosen from the three above
  (the API publishes the refusal on the job's stream; a check-then-act
  admission route; a card timeout). Asked by the orchestrator (tools-15) and
  answered by the owner the same day. Status moved to `ready`; Build and Done
  when written from it.
- 2026-10-06 — Built, option 1. Branch `dl-77-refused-download-event` off
  `origin/main` at `056aab7`. Gate pending.
  - **What changed.** `JobEvent` gained `refused` (`contract/src/job.ts`,
    `api.ts`); `JobEventHub.refused`; `routes/files.ts` publishes it through one
    local `refused(error)` that returns the error, so each refusal is
    `throw refused(...)` and cannot be written without being published; the web
    keeps the payload beside the job (`useJobs`'s `refusals`, folded by
    `refusalAfter` in `job-reducer.ts`) and `JobCard` renders it through
    `ErrorPanel` above the still-offered link. `applyJobEvent` returns the job
    untouched for it. The one switch over `JobEvent.type` is the reducer's (`grep -rn 'case "canceled"'`
    over api, web and contract src); `isTerminalEvent` in the API route and in
    `job-stream.ts` are positive lists and rightly do not name it, and the hub's
    `emit` keys on `jobId`, which the new frame has.
  - **The frame carries `error`, not a second `retryAfterSec` field.**
    `error.details.retryAfterSec` is the same number as the response's
    `Retry-After`, via the same `toPublicPayload`, so the card's existing "Wait 30 s
    before trying again." line works unchanged and the two cannot disagree. A test
    pins that the frame's number equals the header's.
  - **The brief had one refusal short.** `jobs-wait-timeout` (no slot in the
    bounded wait, the link given back, `429`) is the same silent failure and sits
    in the same handler, so it publishes too; it is `throw`-less (it rejects a
    deferred), and the frame goes out after `releaseLink`, so "Download still
    offered" is already true when the card reads it.
  - **Shutdown publishes too.** The route's shutdown branch is reachable only by a
    request already inside the server as it closes (a new connection is refused by
    Fastify before the route), so the frame is best-effort at best; it costs one
    line through the same helper and means the card says "The server is shutting
    down" instead of nothing. It carries `INTERNAL` and no `retryAfterSec`; the
    card shows no wait for it rather than inventing one.
  - **How the card handles either order of the browser's failed download and the
    event.** It never sees the browser's side: the failed download is invisible to
    the page, so the card reacts only to the event and there is no second input
    to race. What can race is the event against _other frames_, and
    `refusalAfter` covers that: a refusal is kept only for a job still `queued`
    and not older than the job's last frame, so a refusal that lands behind the
    next attempt's `status: probing` is dropped (tests: `job-reducer.test.ts`
    "is dropped when the job has moved on", `app.test.tsx` "a refusal that
    arrives after the job has moved on is not shown"). Following the link clears
    the old refusal (`onFollowLink`), so a stale "wait 30 s" does not stand over
    a second attempt, and a second refusal shows again.
  - **Not covered, and why.** The hub is not a replay log: a refusal sent while the
    card's stream is reconnecting, or before a reloaded page re-attaches, is
    lost, and the card then reads as it did before this change. The link is
    still good, so nothing is wrong, only silent. Not fixed here: replaying would
    mean the hub keeping history, which its header rules out.
  - **Reproduction, against `origin/main`.** The final spec with the source files
    restored to `origin/main` (`git checkout origin/main -- tools/downloader/{api,web,contract}/src`,
    contract rebuilt and `dist` grepped for `refused`: none):
    `npx playwright test -c tools/downloader/playwright.config.ts refused-download` →
    `✘ 1 ... a download refused at the per-client cap says why and stays usable (40.6s)`,
    `Locator: ...getByRole('alert')  Expected: visible ... element(s) not found`, and the
    server's own `download refused: per-client cap reached` in its log. On the
    branch: `✓ 1 ... (39.6s)  1 passed`.
  - **Checks on the branch.** `npm run check` clean. `npm test -- --project downloader`:
    98 files passed, 1 skipped; 1610 tests passed, 2 skipped. `npm run e2e:downloader`:
    10 passed.
  - **Config change worth knowing.** `playwright.config.ts` now sets
    `MAX_JOBS_PER_CLIENT=1` for the fast e2e server (the sniffer config is
    unchanged). The other specs open one link at a time, and all ten pass with it.
  - **Fold-in.** None beyond `jobs-wait-timeout` above; nothing else the
    change made free was already specified.
