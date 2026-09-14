---
id: dl-50
tool: downloader
title: Tell a person from a script before a probe runs, without asking for an account
kind: work-package
status: ready
milestone: M5
depends_on: []
difficulty: hard
---

# dl-50 — A human check without an account

**Packages:** `packages/core` (the error code), `contract`, `api` and `web`.

## Why

Once [dl-49](./dl-49-open-without-a-login.md) removes the login, every request
to `POST /api/probe` is anonymous. A probe launches a real Chromium on a URL the
caller names: about 15 s and 300 MB, as the header of
`tools/downloader/api/src/rate-limit.ts` says. The per-minute bucket in front of
it is keyed on the client address, so it slows down one address. It does nothing
against a script spread across many addresses, which is the cheap way to use an
open fetch-anything browser.

A login was the defence against that, and the owner has ruled one out. **So this
ticket decides what replaces it.** The question has more than one reasonable
answer, and the costs differ a lot.

## Decision — answered 2026-09-13 by the owner, not open

Three answers, each the recommendation, so nobody was overridden:

1. **Option A, Cloudflare Turnstile**, on probe and job creation.
2. **The failed-check error code goes in `@webtools/core`,** not the
   downloader's contract. "Human check failed" means something to the planner,
   which has never heard of the downloader. That is the root `CLAUDE.md` test
   for core. The code is not retryable: an automatic retry sends the same spent
   token. `HUMAN_CHECK_FAILED` is a suggested name, not part of the decision.
3. **Fail closed.** When `siteverify` cannot be reached or does not answer in
   time, the probe or job is refused. The site is itself served through
   Cloudflare, so an outage that stops verification usually takes the page
   down too. Failing open would let a script get past the check by waiting for
   an outage.

**Added 2026-09-14, also the owner's:** Cloudflare Web Analytics counts the
downloader's visitors once it is public, and **its CSP change is made here**
rather than in a ticket of its own. Both widen the same `script-src` and the
same `e2e/csp.spec.ts`, and two branches editing those lines would conflict.
Offered beside it: a ticket of its own after this one, or folding it into
[dl-57](./dl-57-a-record-of-how-probes-and-downloads-end.md), which counts what
visitors do but never touches the CSP. Google Analytics was offered earlier and
not chosen. The owner ruled out ads, so nothing needed its dashboards, and it
would have widened `connect-src` to a third party.

The options as they were put, so the choice is not re-opened as an oversight:

**A — Cloudflare Turnstile on probe and job creation (chosen).** The UI renders
the widget. `POST /api/probe` and `POST /api/jobs` carry its token, and the API
verifies that token against Cloudflare's `siteverify` before any work starts.
Mostly invisible to a person, and it costs a script a solved challenge per
request. Costs:

- **A contract change.** The request schemas gain a token field, and a failed
  check needs an error code.
- **dl-35's CSP widens.** `routes/web.ts` enumerates `script-src 'self'`, and
  the widget needs `challenges.cloudflare.com` in `script-src` and `frame-src`.
  dl-35's comment says every widening is recorded there with its reason. So is
  `e2e/csp.spec.ts`, which measures the policy in a real browser.
- **A new outbound call from the API to a fixed host.** It is not a
  user-influenced URL, so the SSRF rule does not apply to it. It still needs a
  timeout.
- **Two secrets** (site key, secret key) in the host's `.env`, and a test
  seam: Cloudflare publishes always-pass and always-fail test keys.

**B — A Cloudflare challenge in front of the page, and no code.** A WAF rule
issues a managed challenge on the document. A challenge answers with HTML, and
the UI's `fetch` and `EventSource` cannot solve one. So it protects only the
page, and a script calls `/api/probe` directly. Not measured, because A was
chosen.

**C — Nothing beyond dl-51 and dl-52.** Rate limits and caps alone, which
accepts that a distributed script gets `MAX_CONCURRENT_BROWSERS` worth of the
host for as long as it cares to.

## Build

1. **Core:** add the code to `CORE_ERROR_CODES` and `CORE_ERROR_MESSAGES` in
   `packages/core/src/errors.ts`, and leave it out of `CORE_RETRYABLE_CODES`.
   Check whether the downloader's catalog needs its own wording.
2. **Contract:** add the token field to the probe and job request schemas.
3. **API:** verify the token before the probe gate and the job queue, not
   after. A refused check must not hold a concurrency slot. Give `siteverify` a
   bounded timeout, and treat a timeout, a network error or a non-2xx answer as
   a refusal. The token is a credential: it reaches no log line and no
   outcome record (dl-57, dl-58).
4. **Web:** render the widget, send the token, and handle its expiry. A token
   is single-use, and one analysis makes two calls.
5. **CSP:** widen it for two origins and nothing else. Record each reason
   beside the policy, and update `e2e/csp.spec.ts`.
   - `challenges.cloudflare.com` in `script-src` and `frame-src`, for the
     widget.
   - `https://static.cloudflareinsights.com` in `script-src`, for Cloudflare
     Web Analytics' beacon (added 2026-09-14, see the Decision). Cloudflare's
     automatic setup appends a `<script>` for it at the edge. On a proxied
     hostname the beacon reports to `/cdn-cgi/rum` on the same origin, which
     `connect-src 'self'` already allows. **Measure that rather than trust
     it.** If a browser refuses the report, add `cloudflareinsights.com` to
     `connect-src` and record why. Do not widen `connect-src` in advance.
   - **The document must never carry `Cache-Control: no-transform`.**
     Cloudflare does not rewrite such a response, so the beacon would vanish
     with no error. Today `routes/web.ts` sends `no-cache`.
6. **Settings:** add them to `.env.example` and the architecture's settings
   table. Leaving the check unset keeps today's behaviour, for a self-hoster
   behind Access.

## Done when

- A probe or job with no token, or verified with Cloudflare's always-fail test
  secret, is refused with the core code. A test proves no probe-gate or
  job-queue slot was taken.
- With the always-pass test keys, a probe and a job run as they do today.
- A `siteverify` that times out or cannot be reached refuses the request. A
  test stubs both cases.
- With the settings unset, no token is required, and a test says so.
- No log line and no stored record contains the token. A test asserts this
  over captured logger output.
- The CSP differs from dl-35's only by `challenges.cloudflare.com` in
  `script-src` and `frame-src`, and `https://static.cloudflareinsights.com` in
  `script-src`. `e2e/csp.spec.ts` asserts the new policy.
- `e2e/csp.spec.ts` loads a script from the beacon's URL, served by a
  Playwright route because the suite reaches no network, and proves it runs
  with no CSP violation. A script from any other origin is still refused.
- A test proves the document's `Cache-Control` never carries `no-transform`.
- In the browser, one analysis makes both calls (probe, then job) with a
  fresh token each time, and neither is refused.
- `npm run check` and `npm test` are green.

## Log

- 2026-09-13 — Filed as `needs-decision`. Nothing measured yet. Option B's
  plan-tier question is the one measurement to take before asking.
- 2026-09-13 — The owner chose A, the error code in core, and failing closed.
  Moved to `ready`, and Build and Done when written. B's measurement was not
  taken, because it was not chosen.
- 2026-09-14 — Cloudflare Web Analytics added to step 5 and to Done when, on
  the owner's decision recorded above. Not measured: whether automatic setup is
  already on for the zone. If it is, today's `script-src 'self'` is already
  refusing the beacon on every page load, with no visible error.
