---
id: dl-50
tool: downloader
title: Tell a person from a script before a probe runs, without asking for an account
kind: work-package
status: needs-decision
milestone: M5
depends_on: []
difficulty: hard
---

# dl-50 — A human check without an account

**Packages:** depends on the option chosen. Option A touches `contract`, `api`
and `web`, plus `packages/core` if the new error code belongs there.

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

## The decision

**A — Cloudflare Turnstile on probe and job creation (recommended).** The UI
renders the widget. `POST /api/probe` and `POST /api/jobs` carry its token, and
the API verifies that token against Cloudflare's `siteverify` before any work
starts. Mostly invisible to a person, and it costs a script a solved challenge
per request. Costs:

- **A contract change.** The request schemas gain a token field, and a failed
  check needs an error code. By the root `CLAUDE.md` test, "human check failed"
  would mean something to a tool that has never heard of this one, so the code
  is probably `@webtools/core`'s. That is its own decision to raise, not to
  make quietly.
- **dl-35's CSP widens.** `routes/web.ts` enumerates `script-src 'self'`, and
  the widget needs `challenges.cloudflare.com` in `script-src` and `frame-src`.
  dl-35's comment says every widening is recorded there with its reason. So is
  `e2e/csp.spec.ts`, which measures the policy in a real browser.
- **A new outbound call from the API to a fixed host.** It is not a
  user-influenced URL, so the SSRF rule does not apply to it. It still needs a
  timeout and a decided behaviour when Cloudflare is unreachable: fail closed,
  or let the rate limits stand alone.
- **Two secrets** (site key, secret key) in the host's `.env`, and a test
  seam: Cloudflare publishes always-pass and always-fail test keys.

**B — A Cloudflare challenge in front of the page, and no code.** A WAF rule
issues a managed challenge on the document. That costs nothing in the repo, but
a challenge answers with HTML, and the UI's `fetch` and `EventSource` cannot
solve one. It protects only the page, and a script calls `/api/probe` directly.
**Measure before choosing it:** whether a rule this plan tier allows can require
a passed challenge on `/api/` requests. If not, B protects nothing that matters.

**C — Nothing beyond dl-51 and dl-52.** Rate limits and caps alone. It is the
cheapest, and it accepts that a distributed script gets
`MAX_CONCURRENT_BROWSERS` worth of your host for as long as it cares to.

## Build

Written once the decision is recorded here. For A, in order:

1. Raise the error-code placement (core or tool) with the owner.
2. Contract change: add the token field and the error code.
3. API: verify the token before the probe gate and the job queue, not after.
   A refused check must not hold a concurrency slot.
4. Web: render the widget, send the token, and handle its expiry. A token is
   single-use, and one analysis makes two calls.
5. CSP widening with its reason, and the e2e CSP spec updated.
6. Settings in `.env.example` and the architecture's settings table. Leaving
   the check unset keeps today's behaviour for a self-hoster behind Access.

## Done when

Written with the decision.

## Log

- 2026-09-13 — Filed as `needs-decision`. Nothing measured yet. Option B's
  plan-tier question is the one measurement to take before asking.
