---
id: dl-115
tool: downloader
title: The resolver's 1200 ms minimum wait cannot be set from a test, so the quietMs every test passes does nothing
kind: chore
status: ready
milestone: null
depends_on: [dl-114]
difficulty: standard
---

# dl-115 — The resolver's minimum wait cannot be set from a test

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

A normal browser probe takes about 2.8 s, and 2.6 s of that is fixed. The audit
measured the phases with `onStage` timestamps:

| Phase                                       | Time                  | Source                                                   |
| ------------------------------------------- | --------------------- | -------------------------------------------------------- |
| Page load, then a fixed sleep               | about 510 ms          | `LANDING_URL_SETTLE_MS = 500`, `browser.ts:115`          |
| Two provocation passes with a sleep between | about 1000 ms         | 900 ms at `provoke.ts:1838`                              |
| Quiet wait                                  | about 1200 to 1400 ms | `MIN_WAIT_MS = 1200` (`browser.ts:66`, passed at `:384`) |

**The quiet phase is held by `MIN_WAIT_MS`, not by `quietMs`.** The page's last
request lands at least 900 ms before the quiet wait starts. The 71 tests that
pass `quietMs: 1200` therefore pass a value with no effect. `quietMs: 200`
measured 2809 ms against 2761 ms. `MIN_WAIT_MS` is a constant.
`emptyMinWaitMs` (`browser.ts:150`) can be injected, but it only governs probes
that have captured nothing playable.

**The owner allowed this on 2026-10-12, with the default unchanged.** The two
sleeps above stay: dl-55 (tests 407 and 418) proves the 500 ms, and the 900 ms
covers players that mount late. Faking the clock was ruled out:

- the waits mix Node's `Date.now`, Playwright's own timers and Chromium's page
  timers;
- faking Node's timers would also fake Playwright's client timeouts.

## Build

1. **Add `minWaitMs?: number`** to the resolver's options, shaped like
   `emptyMinWaitMs`, with `MIN_WAIT_MS` as the default. Pin the default with a
   test that reads it through a probe's options or an exported constant, so a
   changed default fails.
2. **Use it only in tests that expect a stream.** In those tests a wait that is
   too short fails loudly: the stream is missing.
   - **Do not use it in negative tests:** `NO_MEDIA_FOUND`, `not.toContain` a
     beacon, nothing pressed. There a shorter wait makes the test pass more
     easily, which weakens it. That trade is the reason for this rule.
   - Choose a value at or above the 200 ms tick of the wait loop, and measure
     that the overlay revisit (`browser.ts:389–398`, first at least 1 s in)
     still runs in every test that depends on it.
3. **Remove the dead `quietMs: 1200`** from tests where it changes nothing. Or,
   if the value documents intent, replace it with the option that actually
   holds the wait. Leave the one `quietMs: 6000` test alone (the late modal at
   about line 535).
4. **No-media tests:** the audit found that shorter `emptyMinWaitMs` and
   `quietMs` values could save about 14 s. The `NO_EMPTY_FLOOR_MS` comment in
   the test file says the base rule is kept on purpose. **Do not change it**:
   the owner's rule is that shorter waits go only in tests that expect a stream.

## Done when

1. A test pins `minWaitMs`'s default at 1200, and production callers pass
   nothing new.
2. Every test given a shorter `minWaitMs` expects a stream. The Log lists them
   and shows no negative test among them.
3. Before and after durations for the browser suites are in the Log, and
   `npm test -- --project downloader` passes three times in a row locally. It
   should also pass on the Windows leg.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 0.9 s on
  each of about 40 or more stream-expecting tests across the browser files,
  about 35 s or more in total (inferred). Considered and not filed:
  - **Skipping `settle` once the probe has left the page.** `settle` runs
    before the departure check (`browser.ts:402–425`) and departure discards
    every hit, so the skip would save up to 3 s per departed probe in
    production too. It is a production behaviour change, which the owner's
    "defaults unchanged" rule excludes.
