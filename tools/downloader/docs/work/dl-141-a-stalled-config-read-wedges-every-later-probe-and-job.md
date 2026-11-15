---
id: dl-141
tool: downloader
title: A stalled `GET /api/config` read leaves every later probe and job creation pending for the life of the page
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-141 — A stalled `GET /api/config` wedges every later probe and job creation

## Why

Found by dl-138's first gate (Opus 5.5) on 2026-11-15 and filed on the owner's
answer at the orchestrator's checkpoint the same day (options: file; record only.
Answer: file). dl-138 is PR #799 and is not merged at the time of writing, so
what follows about its timeouts is read from that branch and cited as prose.

dl-138 puts a client timeout on `ApiClient.probe` (90 s) and on
`ApiClient.createJob` (30 s), so that a request that never answers stops holding
its count on the page. **Each clock starts at the fetch.** The human-check wait
before the fetch is not counted, on purpose (dl-138's Done when 1), and `request()`
gains no bound, because the owner chose that in dl-138's Question 4
(answered 2026-11-10: on the two calls only; the alternative was a bound in
`request()` for every call).

That leaves one wait nothing bounds. `createHttpClient` hands the human check a
reader for `GET /api/config`, and `createTurnstileCheck` (`web/src/lib/human-check.ts`)
calls it from `next()`, before the probe's or the job's own request is made.
`humanCheck()` memoises the read **while it is pending**:
`config ??= readConfig().then(…)` clears `config` only when the read fails, so
a read that neither resolves nor rejects is the memo for every later call. One
stalled `GET /api/config` therefore leaves every later `probe` and `createJob`
waiting on the same promise, and no timeout starts, because none of them has
reached its fetch.

### The measurement

The gate's `zz-gate-dl138-web.test.ts`, test "attack 4: a GET /api/config that
never settles", run through `run-web.sh` on the dl-138 branch at `3efc62ba`
(`createHttpClient({ humanCheck: createTurnstileCheck })`, `fetch` stubbed to a
promise that never settles, fake timers):

```
attack 4 config read never settles, 30 min on: probe pending, probe pending, createJob pending; fetches ["/api/config"]
```

Two probes and one `createJob` were all pending 30 minutes (fake time) after
they were called, and the **only** fetch any of them made was `/api/config`:
none got as far as `POST /api/probe` or `POST /api/jobs`, so dl-138's two
timeouts never started. It is the same wedge dl-138 closes for a request that
never answers (its N2 and N3), reached through a call the fix leaves alone.

Not measured: whether the same shape exists after the config read, in the
script load (`loadTurnstileScript` listens for `load` and `error` and nothing
else) or in the widget's `take()` (a challenge that needs a person ends in the
widget's `timeout-callback`; one that never calls any callback does not end).
`next()` also queues behind a single `line`, so a `take()` that never settles
would hold every later call too. These are read from the code and not run.

### What changed since dl-138's Question 4

Question 4 chose no bound on `GET /api/config` for dl-138. What has changed is
the measurement above: a stalled config read now has a shown effect, a wedge of
every later probe and job creation, which dl-138's ticket did not have in front
of it when it chose. dl-138's own Log records the owner's answer at the 2026-11-15 checkpoint
that Question 4 stands for dl-138 and that this is filed separately, so nothing
here reopens that ticket's scope.

## Decision — open

**Where does the bound go?** The shared goal is that a stalled read cannot hold
a later analysis forever. The options differ in how much of the human check they
cover, and in whether a stall is reported as a failure or ignored.

- **A. Bound the config read in `createTurnstileCheck` (recommended).** The read
  that `humanCheck()` memoises gets a timeout (a figure for the owner or the
  builder to name; the call is a small same-origin `GET`, so seconds, not
  tens of seconds), aborting through `AbortSignal` and failing the memo, which
  `humanCheck()` already clears on a failure. The existing documented path for a
  failed read then applies: no token is sent and the server decides (the file
  header: "if it wanted one, the answer is `HUMAN_CHECK_FAILED`"). Costs: it
  covers the config read only, so a stalled script load or a widget that never
  calls back (both unmeasured) still wedge. It also changes what a slow config
  read does on a deployment that wants the check: the first analysis then fails
  with `HUMAN_CHECK_FAILED` instead of waiting, and a retry reads the config
  again.
- **B. Bound the whole human-check wait in `next()`.** One timeout around the
  read, the script load and the widget's `take()`. It covers every unbounded wait
  named above, the unmeasured ones too. Costs: the figure must clear a person
  answering a challenge Cloudflare shows (`appearance: "interaction-only"`),
  which the widget's own `timeout-callback` already bounds, and a figure that
  cuts a person off mid-challenge is worse than the wedge. It also needs `take()`
  to reset the widget when it gives up, or the next call meets a widget holding
  a pending callback.
- **C. A bound in `request()`, for every call.** The alternative dl-138's
  Question 4 passed over: it bounds `GET /api/config`, `getJob` and `cancelJob`
  as well. It reverses that answer, so it is the owner's to give again. Costs:
  dl-138 chose the narrower bound on purpose; and a shared timeout needs a
  figure that fits `getJob` polling as much as a config read.
- **D. Record only.** Leave the wedge, and say so in the Log. Cost: after one
  stalled config read every later `probe` and `createJob` on that page stays
  pending (the measurement above), and nothing in the page's code ends it. A
  reload as the way out is read from the memo, not measured.

Recommended: **A**, with the unmeasured script-load and `take()` stalls named in
the Log as a follow-up for whoever measures them. It fixes the measured wedge
and nothing wider, through a failure path that already exists.

## Build

Written for option A. Revise if another option is chosen.

1. **Start after dl-138 (PR #799) merges.** The bound reuses its choices: an
   `AbortSignal` timeout rejecting with core's `TIMEOUT`, and its test shape
   (fake timers, a `fetch` that never settles).
2. **Reproduce first**, in a committed test under `tools/downloader/web/test/`:
   `createHttpClient({ humanCheck: createTurnstileCheck })` with a `fetch` that
   never settles; call `probe` twice and `createJob` once; assert that after the
   bound each is no longer pending, and that a later call after the read fails
   makes a fresh `GET /api/config` (the memo clears, as it does on a failure
   today). It is red on `main` after dl-138: the gate's line above.
3. **The bound**, in `createTurnstileCheck`'s config read, as the owner decides.
   A timed-out read must clear the memo exactly as a rejected one does.
4. **What the caller sees.** A deployment that has the check on and a read that
   timed out: the probe is sent with no token and the server answers
   `HUMAN_CHECK_FAILED`. Assert it at the App level, on the box's message, not
   only at the client.
5. Name the figure, and why it clears a normal read on a slow phone connection,
   in the Log.

Trap: do not move the bound into `request()` unasked. That is option C and
reverses an answered question of dl-138.

## Done when

- A committed test shows a stalled `GET /api/config` no longer leaves a later
  `probe` or `createJob` pending, after the decided bound, and is red before the
  change.
- A read that timed out is not memoised: the next call reads the config again.
- On a deployment that wants the check, the box shows the `HUMAN_CHECK_FAILED`
  message rather than "Analysing" for a stalled read.
- `npm run check` exits 0 and `npx vitest run tools/downloader/web` passes.

## Log

- 2026-11-15 — Filed from dl-138's first gate (Opus 5.5), on the owner's answer
  at the orchestrator's checkpoint: file. The gate named two options (file; record
  only) and recommended filing; no recommendation was overridden. `status` is
  `needs-decision` because the placement of the bound is the owner's, as dl-138's
  Question 4 was: the gate's finding offered "the config read or the human-check
  wait" without choosing. The measurement is the gate's, from `web.txt` in its
  scratch directory; it was not re-run for this filing, since it reads the dl-138
  branch's `http.ts`, which is not on `main`.
