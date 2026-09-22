---
id: dl-50
tool: downloader
title: Tell a person from a script before a probe runs, without asking for an account
kind: work-package
status: done
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

**Added 2026-09-14, the owner's:** the always-pass and always-fail Done-when
lines are proven against Cloudflare's **real** `siteverify`, with the
devcontainer's egress firewall opened for the build, rather than against stubs.

**Added 2026-09-22, the owner's, each the recommendation:**

1. **The site key reaches the page through a new `GET /api/config`**, read at
   run time, not baked into the bundle and not folded into `/api/health`. One
   image serves every operator; a bundle carrying the key fails badly when
   built without it (every request refused behind a widget that never
   rendered); and health 503s while draining.
2. **The live proof is an opt-in suite**, committed and skipped unless asked
   for, so the proof is re-runnable and CI never depends on Cloudflare. That
   reconciles the 2026-09-14 decision with the repo's "fixtures, not live
   network calls".
3. **The widget is invisible and executed per request** — rendered with
   `appearance: "interaction-only"` and `execution: "execute"`, reset and
   executed again immediately before each checked call — not a visible
   checkbox in the form.

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
- 2026-09-22 — Built, on branch `dl-50-human-check-without-an-account`, by
  Claude Opus 5 working in its own session rather than as a dispatched builder
  (one `hard` ticket, so no orchestration). The owner answered three questions
  first, recorded under the Decision above. Before building, `siteverify` was
  measured reachable from the devcontainer with the firewall open: the
  always-pass secret answered `{"success":true,…,"result_with_testing_key":true}`
  in 0.15 s, and the always-fail secret `{"success":false,"error-codes":["invalid-input-response"],…}`.

  **What was built.** `HUMAN_CHECK_FAILED` in core (403, not retryable, and a
  note that it is not `BOT_CHALLENGE`, which is a _source_ challenging us). An
  optional `humanCheckToken` on both request schemas. `api/src/human-check.ts`,
  called first after the body parses in both routes, so before the SSRF guard,
  the cache, both gates and the queue. It fails closed on a timeout (5 s), a
  network error, a non-2xx or a body without a boolean `success`, and says which
  only in its `warn` line. `GET /api/config` for the site key. On the page,
  `web/src/lib/human-check.ts` inside the HTTP transport, so `App.tsx` and
  `useJobs` are unchanged and the mock never loads Cloudflare. The CSP gains the
  two origins, with each reason beside the policy. Settings in `.env.example`,
  the architecture table and a paragraph under its decisions.

  **Done when, line by line.**
  - No token, and the always-fail answer, are refused with the core code, and no
    slot is taken: `api/test/human-check.test.ts`, "a request without a passing
    token is refused before any slot is taken". The guard, both probe gates, the
    per-client job gate and `enqueue` are spied and never called. Live, against
    the real always-fail secret: `api/test/human-check.live.test.ts`.
  - The always-pass keys run a probe and a job: "a passing token changes nothing
    about the work", which runs the job to `completed`. Live:
    `human-check.live.test.ts`, 200 and 201.
  - A timeout and an unreachable verifier refuse: "failing closed", plus a
    non-2xx and three malformed bodies.
  - Unset, no token is required: "with no keys configured", which also covers
    `/api/config` answering `{"humanCheck":null}`.
  - No log line and no stored row carries the token: "the token is a
    credential". It captures every line at `debug` across pass, refusal and
    unreachable, where the thrown error's message contains the token, and dumps
    the job rows, options and outcome rows.
  - The CSP differs only by the two origins: `api/test/csp.test.ts`'s `EXPECTED`
    map, which is compared in both directions, and `e2e/csp.spec.ts`'s
    `EXPECTED_POLICY`.
  - The beacon runs from a Playwright route, and another origin is refused
    before it is fetched: `e2e/csp.spec.ts`, the last two tests.
  - The document's `Cache-Control` never carries `no-transform`, through either
    door: `api/test/csp.test.ts`, the last `describe`.
  - In the browser, one analysis makes both calls with a fresh token each and
    neither is refused: `e2e/turnstile/live-widget.spec.ts`, against Cloudflare's
    real widget, script and iframe and the real `siteverify`, with zero CSP
    violations, so the real widget needs nothing past the two widenings. The
    test site key hands out the same dummy token every time, so freshness is
    pinned in `web/test/human-check.test.ts`, whose fake widget, like the real
    one, gives no new token without a `reset`.
  - `npm run check` green. `npm test`: 3283 passed and 2 skipped (the live
    suite). The fast e2e ran 9 of 9.

  Mutations, each run and reverted: logging the token in the rejected path
  failed the credential test. Moving the job route's check behind the per-client
  gate failed four tests. Dropping the widget reset failed three web tests.

  **What the brief had wrong or left out.**
  - It gave the page no way to learn the site key. That became decision 1, and a
    route in the contract beyond the two schema fields the brief named.
  - `.env.example` and the table would not have let the owner turn the check on.
    `compose.downloader.prod.yaml` names every variable the container gets, so
    it now passes `TURNSTILE_*` through from the host's `.env`, and
    `.env.prod.example` documents them.
  - One key without the other is refused at boot. Either half alone fails
    silently at request time.
  - Build 1's "check whether the downloader's catalog needs its own wording":
    the contract keeps core's message. The UI's table needed its own entry
    anyway, because it is exhaustive, and it offers no retry button, because the
    token is spent. `mock-api.test.ts` asserts that every code is demonstrable,
    so the mock gained a `notaperson` scenario.
  - The Web Analytics log line of 2026-09-14 is still unmeasured, and cannot be
    measured from here. `downloader.oludoi.com` answered an unauthenticated `GET /`
    with `302` to Access on 2026-09-22, so neither the beacon nor its report
    can be seen from outside. `connect-src` was left unwidened, as Build 5 says.
    Checking the report on the live hostname is now a Done-when line on
    [dl-49](./dl-49-open-without-a-login.md).
  - dl-49 did not say the keys must be in place before Access comes out. With
    them unset, this ships the check _off_. That is now step 4 and a Done-when
    line on dl-49.

  **Not done, on purpose.** `remoteip` is not sent to Cloudflare, so a
  self-hosted deployment does not hand every visitor's address to a third party.
  `siteverify`'s `hostname` field is not checked. The widget's allowed-hostname
  list in the dashboard already restricts where our site key can mint tokens,
  and a check here would need a setting of its own. File it if that list is
  ever not enough.
