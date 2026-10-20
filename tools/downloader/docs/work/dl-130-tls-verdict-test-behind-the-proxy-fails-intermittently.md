---
id: dl-130
tool: downloader
title: The dl-37 Done-when 2 browser test behind the terminating proxy fails intermittently
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-130 — The dl-37 Done-when 2 browser test behind the terminating proxy fails intermittently

## Why

`tools/downloader/api/test/tiers-on-the-terminating-proxy.test.ts`, the test
"still refuses a certificate the proxy could not verify — dl-37 Done-when 2"
inside the describe "the browser tier behind a proxy that terminates its TLS",
failed in one of ten isolated runs during
[dl-129](./dl-129-trim-the-browser-resolver-suite.md)'s gate 1, at dl-129's head
`0bda7625` (pull request #585). Its assertion is that a certificate the proxy
could not verify still comes back `TLS_VERIFICATION_FAILED`, which dl-37 built
and [dl-37](./dl-37-tiers-move-onto-the-terminating-proxy.md) names as the one
verdict the test file names as the one dl-37 could have regressed silently.

The verdict is reattached from a side channel. Chromium reports only a tunnel
failure, which the browser tier classifies as `UNREACHABLE`. The wrapper
`namingRefusedOrigins` reattaches `TLS_VERIFICATION_FAILED` only when
`TlsRejectionLog.since` finds a certificate refusal recorded for that host and
port inside the call's own window. When it does not find one, the test receives
the Chromium verdict, which is what it saw.

dl-129's diff does not change `navigate` or anything on this path. It changes
the sleeps that run after `navigate` returns, in the same file
(`resolvers/src/resolvers/browser.ts`), and touches no file under
`tools/downloader/api`. So the failure is not caused by dl-129. It is a defect
that dl-129's gate found in a test it ran, and it has a reproduction, so it gets
a ticket of its own.

## Symptom

The failing run's own lines, from gate 1's log `sw-tiers-9.log` (one of ten
isolated runs at `0bda7625`, each run with the test name as a filter):

```
 FAIL  |downloader| tools/downloader/api/test/tiers-on-the-terminating-proxy.test.ts > the browser tier behind a proxy that terminates its TLS > still refuses a certificate the proxy could not verify — dl-37 Done-when 2
AssertionError: expected 'UNREACHABLE' to be 'TLS_VERIFICATION_FAILED' // Object.is equality

Expected: "TLS_VERIFICATION_FAILED"
Received: "UNREACHABLE"

 ❯ tools/downloader/api/test/tiers-on-the-terminating-proxy.test.ts:253:26
```

The other nine isolated runs in the same sweep, `sw-tiers-1.log` to
`sw-tiers-10.log` without `-9`, each report `Tests 1 passed | 4 skipped (5)`.

## Code path

Read at `0bda7625`; named by function, not by line.

1. `tools/downloader/resolvers/src/resolvers/browser.ts`, `navigate`: calls
   `page.goto` with `waitUntil: "domcontentloaded"`. A non-timeout failure is
   thrown as `classifyNavigationError(...)`
   (`resolvers/src/browser/classify.ts`), which turns a navigation error that is
   not a certificate's into `UNREACHABLE`. The failure surfaces here, before
   `waitForPageLoad` and the sleeps dl-129 changed.
2. `tools/downloader/api/src/resolvers.ts`, `namingRefusedOrigins`: takes
   `startedAt = Date.now()` before the attempt. On an `UNREACHABLE` or
   `NO_MEDIA_FOUND` error (`REATTACHABLE_CODES`) it calls
   `rejections.since(url.hostname, portFor(url), startedAt)`, and rethrows the
   `UNREACHABLE` if that returns `undefined`. `buildRegistry` applies this
   wrapper only when `tierEgress` is given, which the test's `wired` registry
   does.
3. `tools/downloader/api/src/tls-rejections.ts`, `TlsRejectionLog.since`: returns
   `undefined` when there is no `#certificates` entry for the host, when that
   entry's `at` is older than `startedAt`, or when `#otherFailures` or
   `#successes` holds an entry for the endpoint at or after `startedAt`.
   `TlsRejectionLog.record` stamps `at` with the log's own clock, `Date.now` by
   default.
4. `tools/downloader/api/src/egress-proxy.ts`, the CONNECT handler's `open`:
   `terminateTls`'s `onRejected` calls `options.onCertificateRejected` **before**
   `fail(...)`, per the comment there, so a refusal that reaches the client as a
   502 should already be recorded. The other outcomes of the same CONNECT go
   elsewhere: `onFailed` and the `serverSocket` `error` handler call
   `onOtherConnectFailure`, and `onUnavailable` answers a different status.
5. What the test wires, read and not run: its `startEgressProxy` call passes
   `onCertificateRejected` only. It passes neither `onOtherConnectFailure` nor
   `onConnectEstablished`, so in this test the two conflict maps are never
   written, and `since` can return `undefined` only through the certificate
   branch. That leaves two readings of a miss: no refusal was recorded for this
   call's CONNECT, or a refusal was recorded with a timestamp older than
   `startedAt`.

**Not established.** A plausible reading, which nobody has tested, is that under
load the origin's handshake ends as a socket-level failure rather than a
verification error, so the proxy takes the `onFailed` or socket-error path, no
certificate refusal is written, and Chromium's CONNECT still returns the 502
that the browser tier reads as `UNREACHABLE`. Another is that Chromium's
navigation fails on a CONNECT the proxy answered by a path the record does not
cover. Neither is shown. Build step 2 is what shows which one it is.

## Measurements

Each rate is listed with who measured it. Rates from different conditions are
not summed.

- **Gate 1 of dl-129** (Opus 5.5, 2026-10-20), isolated runs at `0bda7625`:
  **1 of 10** failed (`sw-tiers-9.log`), the other nine passed. Each run was
  `npx vitest run` on the file with the test name as a filter, from the built
  dist of that head. Load: gate 1's report says "about 4". Its sweep file
  records load only at the sweep's start (5.02, with 3 foreign worker processes)
  and end (3.53), so the load at the failing run is not recorded. Base of that
  sweep: `da4673e1`, which the test was not run at.
- **Gate 1 of dl-129**, one whole-project run at `0bda7625`
  (`npm test -- --project downloader`): this file passed, 5 tests, 4222 ms, load
  3.62 at start and 7.01 at end. Exit 0, 2594 passed, 2 skipped. One run, which
  did not reproduce it.
- **The builder of dl-129** (relayed through the orchestrator and not verified
  by me or by the gate): **1 of 12** whole-project runs at dl-129's branch failed
  this test, at load about 18. **0 of 4** whole-project runs at the base failed
  it. Run alone, it passed **20 of 20** at the base.

The alone runs at head (gate 1, 1 of 10) and the alone runs at base (dl-129's
builder, 0 of 20) are the only isolated numbers, and they were taken on different
heads by different sessions.

## Build

Run one at a time, sequentially, through the repo's own commands. Do not start
a load generator to provoke the failure: the reading was taken on a shared
machine with other sessions running, and an induced load is not the condition
this ticket is about.

1. **Read the path first** (the Code path section above), at the head you were
   given. Do not form the cause from the reading alone.
2. **Name the branch from a failing run, using test-side instrumentation only.**
   In `tiers-on-the-terminating-proxy.test.ts`, wrap the proxy hooks in spies
   that log their arguments and forward nothing else: `onCertificateRejected`,
   `onOtherConnectFailure` and `onConnectEstablished`. A spy must not call any
   `TlsRejectionLog` method, because calling `recordOtherFailure` or
   `recordSuccess` from a spy changes what `since` reads. Wrap `since` for the
   rogue test's call so it logs its arguments and its return value. Run the
   single test alone, up to 20 times, recording `/proc/loadavg` before each run
   into a file in your scratch directory. Stop at the first failing run and read
   what the spies captured.
3. **Record the branch in the Log.** The captured values say which of these
   holds, and the Log says which one with the command and its output:
   - no `onCertificateRejected` call for the failing navigation's CONNECT, and
     which other hook fired instead, or none;
   - an `onCertificateRejected` call whose `at` is older than the `startedAt`
     `since` read, which means a stale record;
   - a conflicting `#otherFailures` or `#successes` entry, which this test as
     wired cannot write. If it appears, the wiring is not what this ticket reads,
     and that is itself a finding to report.
4. **A stop condition, not a choice.** If the named branch is the proxy taking a
   path that its own docs say is not a refusal (`onFailed`, `onUnavailable`, or a
   socket error), then making that path count as a certificate refusal changes
   what dl-37 means by `TLS_VERIFICATION_FAILED`, which is a contract question.
   Stop and report it as options with a recommendation. Do not pick one. The same
   applies if Chromium's failing navigation was never seen by the proxy at all.
5. **Fix the cause the Log names, and nothing else.** Add a test that drives
   that branch without a sleep and without load, red at the base and green at the
   fix, and record both results in the Log. Do not widen `TEST_TIMEOUT_MS` or
   `PROBE_TIMEOUT_MS`, do not retry the test, do not add a retry loop, and do not
   widen `since`'s window. Each of those would hide the verdict rather than
   restore it.
6. **Measure the base on this ticket.** Run the test alone 10 times at
   `da4673e1`, the base dl-129's gate used, and record the count with the loads.
   Ten is the bound: a clean run of ten does not show the defect absent.

A bounded sweep cannot prove absence at a rate near one in ten. Step 5's
deterministic test is the proof. The sweeps are only the measurement of the rate.

## Done when

1. **The cause is named from a failing run.** The Log holds the spies' captured
   values and the `since` read for a run that failed, with the command and the
   `/proc/loadavg` line before that run. Bounded at 20 isolated runs. If all 20
   pass, the Log says so, and this line stays open for the owner to choose the
   next step. Proof: the Log entry, quoting the command's output.
2. **A deterministic test drives the named branch.** A spec in
   `tools/downloader/api/test/` reproduces the miss with no timing and no load.
   The Log records it red at `da4673e1` and green at the fix. Proof: that spec
   file and its test's name, with both runs in the Log.
3. **The flaky test passes at a bounded count on the fixed head.**
   "still refuses a certificate the proxy could not verify — dl-37 Done-when 2"
   passes 20 of 20 isolated runs at the fixed head, one at a time, and passes 3
   of 3 whole-project runs (`npm test -- --project downloader`). This line bounds
   the rate. It does not prove the defect gone, which line 2 does.
4. **The base is measured on this ticket.** Ten isolated runs at `da4673e1` are
   in the Log with their loads, whatever they show.
5. `npm run check` and `npm test -- --project downloader` pass at the fixed head.

## Log

**2026-10-20 — filed** from a maintenance dispatch, with the reproduction in
hand, by the builder for this filing (model: Haiku 5.5). The `kind` is `fix`,
because `docs/01-TICKETS.md` lists no `defect` kind and `status.mjs` rejects
anything outside its list. `difficulty` is `hard`: the cause is not identified,
and the fix will depend on what step 2 names, which is the judgement the rating
means. The gate's figures under **Measurements** were read from its own logs in
its scratch directory. The dl-129 builder's figures were relayed by the
orchestrator and have not been checked by anyone.
