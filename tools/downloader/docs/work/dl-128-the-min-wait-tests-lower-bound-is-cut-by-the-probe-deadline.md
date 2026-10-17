---
id: dl-128
tool: downloader
title: The min-wait test's lower bound is cut by the probe deadline, which dl-115's Log says cannot happen
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-128 — The min-wait test's lower bound is cut by the probe deadline

## Why

`resolvers/test/browser/browser-resolver-departure-and-floor.test.ts` › "the
quiet wait's minimum can be set, and defaults to 1200 ms (dl-115)" › "a resolver
given no minWaitMs hands the wait MIN_WAIT_MS, and holds it that long" asserts
`waitedMs >= MIN_WAIT_MS`, timed from the `network-quiet` stage to the
`settle-requests` stage. dl-115's gate 1 record says of that assertion: "The
lower bound `waitedMs >= MIN_WAIT_MS` cannot fail by timing, because the loop
guarantees it."

The loop does not guarantee it. `waitForQuiet` in
`resolvers/src/browser/provoke.ts` checks the floor and then the deadline:

```ts
if (waitedFor >= effectiveMinWaitMs && idleFor >= options.quietMs) return true;
if (remaining(options.deadline) <= 0) return false;
```

When the budget runs out before the floor is reached, the wait returns at the
deadline, short. `BrowserResolver` hands the wait `deadline - TEARDOWN_RESERVE_MS`,
and page load and `provokePlayback` are paid from the same budget before the
wait begins, so a slow page load under machine load leaves less than 1.2 s and
the floor assertion fails for a reason its message does not name. The lower
bound is a timing bound after all, through the deadline.

## Reproduction

dl-126's landing, 2026-10-17, `--land`'s full suites with a second test run
active on the machine, in a file dl-126 did not touch:

```
FAIL  |downloader| tools/downloader/resolvers/test/browser/browser-resolver-departure-and-floor.test.ts > the quiet wait's minimum can be set, and defaults to 1200 ms (dl-115) > a resolver given no minWaitMs hands the wait MIN_WAIT_MS, and holds it that long
AssertionError: expected 1001.709182999999 to be greater than or equal to 1200
```

The whole downloader project passed on the lander's rerun. dl-115's own gate
saw the sibling bound fail 1 in 10 (`expected 1616.77 to be less than 1200`) and
removed the upper bounds; the lower one stayed on the claim quoted above.

## Build

1. Read the budget the test's `options()` helper hands the probe, and how much
   of it page load and `provokePlayback` on `/mse.html` take here: the stage
   events give both times.
2. Give the floor tests a budget the deadline cannot reach under load — the
   `timeoutMs = 20_000` the dl-80 block in the same file already uses is the
   precedent — and assert in the same test that the probe did not end at the
   deadline, so a cut wait fails naming the deadline rather than the floor. Keep
   the `handedMs` equalities: they are the pin.
3. Do not add an upper bound back. dl-115's gate removed them because they
   measure the machine.
4. Append a dated correction to dl-115's Log, under its gate 1 record: the
   sentence "cannot fail by timing, because the loop guarantees it" is false
   through the deadline, citing this ticket and dl-126's failure. dl-115 is
   `done` with a `## Review`, so preflight allows the edit.

## Done when

1. `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver-departure-and-floor.test.ts -t "defaults to 1200"`
   passes ten sequential runs (dl-115's gate's own recipe), the load average
   noted beside the count in the Log.
2. With the budget forced below page load plus the floor, the test fails on the
   deadline assertion and not on `waitedMs` — shown once as a mutation in the
   Log, with the command and the assertion message.
3. dl-115's Log carries the dated correction.

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), which
  read dl-126's `land.log` against `waitForQuiet` and dl-115's gate 1 record.
  `records.md` on #521 carries the lander's side of it (rerun only what did not
  pass, with `--only`); this ticket carries the test's.
