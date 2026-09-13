---
id: dl-51
tool: downloader
title: One client can hold every job slot, and nothing bounds the queue behind them
kind: fix
status: ready
milestone: M5
depends_on: []
difficulty: standard
---

# dl-51 — One client holds every job slot

**Packages:** `api` (the job route, the probe route, the queue, config), and
the settings lists in `.env.example` and `01-ARCHITECTURE.md`.

## Why

**Admission is per minute, and occupancy is not bounded per client.** This was
found by reading the code, not by running it. The first build step turns it
into a failing test.

- `POST /api/jobs` is behind a token bucket of `RATE_LIMIT_JOBS_PER_MINUTE`
  (default 5) keyed on the client address (`rate-limit.ts`). The bucket limits
  how fast a client _starts_ jobs, not how many it _has_.
- `InProcessQueueOptions` in `jobs/queue.ts` takes a `concurrency` and nothing
  else. There is no bound on how many jobs wait.
- `MAX_CONCURRENT_JOBS` defaults to 2 and `JOB_TIMEOUT_MS` to one hour.

So one address can run both slots and keep adding five jobs a minute behind
them, and every other visitor's download waits for all of it. Behind Access that
address was always the owner. Once [dl-49](./dl-49-open-without-a-login.md)
removes the login, it is anyone. The probe route has the same shape: a global
`probeGate`, a per-minute bucket, and no per-client count of probes in flight.

## Build

1. **Write the reproduction first**, as an API test with fixtures. With
   `MAX_CONCURRENT_JOBS=2`, one client key creates five jobs against a slow
   fixture download. Then show a second client key's job only waits, with no
   bound. Run it before the fix and record in the Log that it failed.
2. **Cap jobs in flight per client**, running and waiting together, with a new
   setting (suggested `MAX_JOBS_PER_CLIENT`, default 2). Refuse over the cap
   with `@webtools/core`'s `RATE_LIMITED`. Do not queue the excess. Use the
   bucket key the jobs limiter already uses (`clientKey(request.ip)`), so
   `TRUST_PROXY` means the same thing for both.
3. **Cap the waiting line globally** (suggested `MAX_QUEUED_JOBS`). Past it, a
   new job is refused immediately, not accepted to wait an hour.
4. **The same per-client cap for probes in flight**, sharing the pattern. A
   probe holds its gate slot for up to `PROBE_TIMEOUT_MS`.
5. Release the count on every exit path: success, failure, cancel, timeout and
   shutdown. A leaked count locks a client out until restart, which is worse
   than no cap. Test each path.
6. `0` disables each cap, like the rate limits. Add both to `.env.example` and
   the architecture's settings table.

**Trap:** CGNAT and shared offices put many people behind one address. The cap
counts jobs _in flight_, not per minute, so a busy shared address waits a moment
rather than being locked out for a minute. Say so in the setting's comment.

## Done when

- The step-1 test fails on `origin/main` and passes on the branch, and the Log
  records both runs.
- Tests prove a client over `MAX_JOBS_PER_CLIENT` gets `RATE_LIMITED` while a
  second client is admitted.
- Tests prove a job past `MAX_QUEUED_JOBS` is refused, not queued.
- Tests prove the per-client count is released after completion, failure,
  cancel and timeout.
- The probe route has the equivalent per-client cap, with its own test.
- `npm run check` and `npm test -- --project downloader` are green.

## Log

- 2026-09-13 — Filed from reading `jobs/queue.ts`, `rate-limit.ts` and
  `config.ts` on `origin/main` `1835657`. Not yet reproduced by a test, which is
  why that is step 1.
