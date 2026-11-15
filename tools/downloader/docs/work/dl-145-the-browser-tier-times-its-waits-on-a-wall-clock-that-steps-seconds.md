---
id: dl-145
tool: downloader
title: The browser tier times its waits and deadlines on a wall clock that steps by seconds in the dev container
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-145 — The browser tier times its waits on a wall clock that steps by seconds

## Why

Found by dl-144's second gate on 2026-11-15, while it explained an intermittent
failure of dl-105's test "a wall clock stepped back before the wait does not read
as a floor that returned early" (`expected 1410 / 1607 to be greater than or
equal to 3000`).

**The devcontainer's wall clock steps by seconds, every 30 s.** Measured by the
orchestrator the same day, sampling `Date.now()` against
`performance.timeOrigin + performance.now()` every 10 ms for 70 s:

```
 9.46 s  +2438 ms
 9.54 s  -4763 ms
39.46 s  +2438 ms
39.55 s  -4764 ms
69.46 s  +2437 ms
69.55 s  -4762 ms
final offset -6975 ms
```

That is a forward step of about 2.44 s, held for about 90 ms, then a backward
step of about 4.76 s: a net loss of about 2.33 s against the monotonic clock
every 30 s. Between steps the offset is flat.

**This is not what dl-105 measured, and it is what its decision rested on.** On
2026-10-11 dl-105's gate 1 measured forward steps of 58–71 ms every 30 s and none
backward. With that measurement, the owner chose **"Leave it"** for
`waitForQuiet`, the collector's `lastActivityAt` and the browser deadlines
reading `Date.now()`: no production change and no ticket (dl-105, Log, the
owner's two answers). dl-105 moved only its own test's stopwatch to the monotonic
clock. The step is now about 40 times larger and has a backward half, so the
premise of that answer no longer holds. The owner chose to file this ticket
(2026-11-15) rather than reopen dl-105.

**What a step does to code that reads `Date.now()`:**

- `waitForQuiet` (`resolvers/src/browser/provoke.ts`) measures its floor and
  quiet gap with `Date.now()`, against the collector's `#lastActivityAt`
  (`resolvers/src/browser/intercept.ts`). A tick inside the 90 ms forward window
  reads 2.4 s more elapsed than has passed, so an empty floor or a quiet gap can
  end about 2.4 s early.
- Deadlines are `Date.now() + timeoutMs`, read through `remaining()` and
  `budget()` (`resolvers/src/browser/abort.ts`), and `HitCollector.settle`
  builds its own. A backward step of 4.76 s gives a running probe about 4.8 s
  more than its budget. A forward step takes 2.4 s away for 90 ms, which is
  enough for a `remaining(deadline) < 1500` check to skip a step.
- `registry.ts` records each attempt's `durationMs` with `Date.now()`, so a
  `probe_outcomes` row can carry a duration that is off by seconds.

**Reproduction.** dl-144 gate 2's planted-step spec mocks `Date.now` so the wall
clock reads +2500 ms for 150 ms, starting 1 s into the empty-floor wait. It
measures the wait with `performance.now()` and uses `no-media.html`,
`quietMs: 1200` and `emptyMinWaitMs: 3000`. The wait then ends at about 1010 ms,
both at dl-144's head and on its base, against 3022–3087 ms without the step.
The gate's loop counts for dl-105's test were 2 of 40 runs on one tree against
0 of 40 on the other, and both failures fell in runs that spanned a forward step
(Fisher p ≈ 0.5). The flake belongs to the clock, not to either branch.

**Production is probably not affected the same way.** These steps are a property
of this devcontainer under WSL2, and the deployment host's clock was not
measured. The tests run here and in CI, and every downloader gate here reads a
flake of this test as a branch failure.

## Decision — open

How should the downloader stop reading a stepping wall clock as elapsed time?

- **A. Monotonic time in the browser tier (recommended).** Time `waitForQuiet`,
  the collector's `lastActivityAt`, the deadline helpers in `abort.ts`,
  `settle` and the registry's `durationMs` with `performance.now()`. Deadlines
  are already internal numbers, so nothing crosses the contract. Tests that mock
  `Date.now` to shape a wait move to `vi.useFakeTimers({ toFake:
  ['performance'] })`, or to an injected clock. It fixes the flake and the
  deadline overrun for real, and makes `durationMs` true. Cost: every timing
  test in the resolvers suite that mocks `Date.now` has to be read, and some
  rewritten. That is the larger part of the work.
- **B. Make the tests tolerate a step.** Leave production on `Date.now()`, and
  have dl-105's test, and any other floor or ceiling assertion, retry or skip
  when a step is detected inside its window. It is cheap and local, but the
  overrun and the false `durationMs` stay, and every new timing test has to
  remember it.
- **C. Fix the environment.** Find what steps the devcontainer's clock (WSL2's
  time sync against the host) and stop it. It removes the cause for every tool
  in the repo, but it is outside the repo, it is not reproducible in CI, and
  production code keeps the same exposure on any host whose clock steps.

Recommended: **A**, limited to the resolvers package. The engine and the web UI
read `Date.now()` too, for logs and display, and are out of scope unless the
builder finds a wait or deadline there.

## Build

To be written once the decision is answered. Whichever option is chosen, the
planted-step spec described under Why is the reproduction: a test that plants
the step must be red before the change and green after it.

## Done when

To be written once the decision is answered.

## Log

- 2026-11-15 — Filed from the dl-143/dl-144 session (tools-bd). The measurement
  above was taken in the devcontainer the same day. dl-144's gate 2 record, on that
  ticket's branch, holds the loop counts. The planted-step spec was a gate
  scratch file and is not in the repository, so Why describes it in enough
  detail to rebuild it. The files that read `Date.now()` in the resolvers package
  are `resolvers/browser.ts` (5),
  `browser/intercept.ts` (4), `registry.ts` (3), `browser/provoke.ts` (3),
  `browser/chunk-sniff.ts` (2) and `browser/abort.ts` (1).
