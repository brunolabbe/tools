---
id: dl-128
tool: downloader
title: The min-wait test's lower bound is cut by the probe deadline, which dl-115's Log says cannot happen
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-18 · `335efcd4..669b245f` · Opus 5.5, depth full

| Done when                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ten sequential runs of `-t "defaults to 1200"` pass, load average in the Log                                                               | **verified** — the gate's own ten sequential runs at `669b245f`: 10 of 10 exit 0, each `Tests 3 passed \| 14 skipped (17)`, 1-min load 4.14 to 6.63 on 12 cores. The Log carries the builder's ten with a load average beside each                                                                                                                                                                                                                                                           |
| 2. Budget forced below page load plus the floor fails on the deadline assertion, not on `waitedMs`, shown in the Log with command and message | **verified** — the gate's mutations of `quietWait`'s `options()` in `resolvers/test/browser/browser-resolver-departure-and-floor.test.ts`: `timeoutMs: 5000` (deadline gone before the wait) and `timeoutMs: 5500` (deadline mid-wait) each give `AssertionError: the wait ended at its deadline, not at quiet: expected false to be true`, `Tests 1 failed \| 2 passed \| 14 skipped (17)`. The Log records the message; its Done when 2 bullet names the mutation but not the command (F4) |
| 3. dl-115's Log carries the dated correction                                                                                                  | **verified** by reading — a 2026-10-18 entry at the end of dl-115's `## Log`; the branch's diff of that file is 11 insertions and 0 deletions, so its `## Review` is untouched. Its parenthetical overreaches (F1)                                                                                                                                                                                                                                                                           |

- **F1 · med** · no `Done when` line depends on it · the clock-step cause is put forward as seen on this machine, and what was seen cannot cause this failure. The branch's Log says "A second cause fits dl-126's number and was seen here", and dl-115's correction says dl-128 "measured which of the two it can be here (the deadline cannot…)", which reads as: the clock caused it. On this machine the system clock steps only **backwards** relative to `performance.now` and `/proc/uptime`: 60 of 60 steps in 900 s, about −300 and −430 ms in pairs every ~30 s, drift −22.6 s, no forward step at all. A backward step during the wait makes it last longer (one replay of the loop measured 2005.8 ms). Only a forward step of 200 ms or more gives dl-126's 1001.7. The Log's own iteration-5 reading (`Date.now` 730 ms behind) is this same backward step. The text is false in the unsafe direction: the open decision on moving `waitForQuiet` to a monotonic clock rests on it, and a reader trusting it stops looking. Rewording both passages to "the steps measured here run backwards and cannot shorten the wait; a forward step would, and none was observed" fixes it.
- **F2 · low** · `nfr:maintainability` · the test's comment over `quietWaitCalls` says a deadline-cut wait is "the one way the minimum is not held that a test can name". That is false: `waitForQuiet` also returns `true` early when its `stop` predicate fires (a departure or DRM). A mutation that makes `stop` fire 1000 ms in fails as `the wait lasted 1003 ms by performance.now and 1002 ms by Date.now`, with `reachedQuiet` `true`. The two clocks agreeing still tells this case apart from a clock step, so the message can be read correctly. The comment and the field name `reachedQuiet` say otherwise. No live call site: `/mse.html` neither navigates nor requests DRM.
- **F3 · low** · the test's comment says page load and provocation "take under 2 s on `/mse.html`". The gate measured `network-quiet` at 1580 to 2047 ms over 15 probes at load 8.8 to 11.5. That is false by 47 ms in the safe direction: the wait still started with 18 952 ms or more of budget left.
- **F4 · low** · the Log's Done when 2 bullet gives the mutation and the message but not the command the line asks for. It also says "the helper's `options()`", which could mean `helpers/browser-harness.ts` rather than the `options()` call in `quietWait`, and the restore it names covers only the spec file.
- **dropped** · the floor counted on integer `Date.now` against a `performance.now` stopwatch could read 1199.x. Measured minimum over 85 waits was 1200.28 ms and none fell below 1200. With no instance, this is not a defect.
- **dropped** · the wrapper's extra `Date.now` calls could disturb the dl-105 test's `Date.now` spy in the same file. The spy is offset-based, not call-count-based, and the whole file passed 17 of 17.
- **findings** · the hunt returned 6; 4 carried, 2 dropped.
- NFR: security n/a (test and docs only) · performance n/a · reliability — F1, F2 · maintainability — F2 to F4.

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), which
  read dl-126's `land.log` against `waitForQuiet` and dl-115's gate 1 record.
  `records.md` on #521 carries the lander's side of it (rerun only what did not
  pass, with `--only`); this ticket carries the test's.

- 2026-10-18 — Built on branch `dl-128-min-wait-probe-deadline` from
  `335efcd4`, Sonnet 5.5. The brief's mechanism is real in the loop but does not
  reach this test, and the Why's last paragraph is wrong about the budget.
  - **The budget is already large.** Build 1 asked what `options()` hands the
    probe: `PROBE_TIMEOUT_MS = 25_000` (`helpers/browser-harness.ts:18`), so the
    wait's deadline is 25 000 − 4 000 = 21 000 ms after the call. Build 2's
    precedent, the dl-80 block's `timeoutMs = 20_000`, is the smaller number.
    Nothing to raise, and none raised.
  - **Page load plus provocation is under 2 s.** A scratch spec (not committed)
    ran `/mse.html` 15 times with `quietMs: 200`, stage times off
    `performance.now`, load average 3.0 to 3.2. `page-load` at 27 to 127 ms,
    `provoke-playback` at 555 to 693 ms, `network-quiet` at 1559 to 1727 ms,
    `settle-requests` at 2763 to 2929 ms. All 15 had `waitForQuiet` return
    `true`, `waited` 1202 to 1207 ms. The deadline leaves 19.3 s of slack
    against a wait that starts at under 1.8 s: a cut wait needs a page load an
    order of magnitude slower than anything here.
  - **A second cause would fit dl-126's number; none was observed here.** The wait counts
    its floor on `Date.now`; the test times it on `performance.now` (dl-105).
    In that scratch run, iteration 5 read `total=2803` on `performance.now` and
    `dateTotal=2071` on `Date.now`: the sandbox stepped the system clock back
    730 ms mid-run, the dl-105 mechanism. The steps measured here run backwards
    and cannot shorten the wait; a forward step would, and none was observed. Mutation, a `Date.now` spy
    adding 500 ms at 2000 ms after the call (the wait runs 1.6 s to 2.8 s):
    `AssertionError: the wait lasted 802 ms by performance.now and 1301 ms by
    Date.now: expected 801.9789369999999 to be greater than or equal to 1200`.
    That is dl-126's shape (a short stopwatch, the wait itself satisfied). It
    does not prove dl-126 was a step: a 200 ms step gives 1001.7 too, and the
    run is gone. Unmeasured: whether the landing's machine stepped its clock.
  - **What changed.** `browser-resolver-departure-and-floor.test.ts`, the dl-115
    block: the pass-through `waitForQuiet` mock now also records what the wait
    returned and its length on `Date.now`; the floor test asserts the wait
    returned `true` first, and its `>=` message carries both clocks. Build 2's
    "budget the deadline cannot reach" was already true and is not edited;
    Build 3 held: no upper bound.
  - **Done when 1.** `ten.sh` (scratch): `npx vitest run
    tools/downloader/resolvers/test/browser/browser-resolver-departure-and-floor.test.ts
    -t "defaults to 1200"`, 10 sequential runs, each `Tests  3 passed | 14
    skipped (17)`, 10 of 10 exit 0. Load average (1 min) before each run: 2.92,
    4.37, 6.84, 6.86, 6.39, 6.20, 5.47, 5.19, 4.47, 4.11 (other builders'
    suites were running).
  - **Done when 2.** Mutation: `timeoutMs: 5000` added to the `options({...})`
    call in `quietWait` in the spec file (not the one in
    `helpers/browser-harness.ts`; deadline 1000 ms after the call, before the
    wait starts). Command: `npx vitest run
    tools/downloader/resolvers/test/browser/browser-resolver-departure-and-floor.test.ts
    -t "defaults to 1200"` → exit 1, `Tests  1 failed | 2 passed | 14 skipped
    (17)`. The spec file was the only file mutated, restored with `git checkout
    64bcecb1 -- <that spec file>`. `× a resolver given no minWaitMs hands the
    wait MIN_WAIT_MS, and holds it that long`, `AssertionError: the wait ended
    at its deadline, not at quiet: expected false to be true`, at the new
    assertion, before the duration one.
  - **Done when 3.** The correction is in dl-115's Log, dated today. It sits at
    the end of the Log, not inside the `## Review`, which is the gate's record
    and is left as written.
  - **Not folded in, and why.** `waitForQuiet` reading `Date.now` rather than a
    clock a step cannot move is a `src` change in a resolver and the only thing
    that would remove the second cause; it is a decision (see the report), not
    a free piece of work, and its cause here is a hypothesis.

- 2026-10-18 — Owner's answer, on gate 1 (CONCERNS) and the builder's open
  decision on `waitForQuiet`'s clock: "No clock change; fix F1–F4 at landing".
  `waitForQuiet` keeps `Date.now`; no `resolvers/src` change, and the builder's
  open decision is closed. A recurrence of dl-126's failure is read off the
  floor test's two-clock message (clocks disagree: a clock step; agree with
  `reachedQuiet` `true`: `stop`; `reachedQuiet` `false`: the deadline).

- 2026-10-18 — Fixed at landing by owner choice: gate 1, F1 — "the clock-step
  cause is put forward as seen on this machine, and what was seen cannot cause
  this failure". The Log's "A second cause fits dl-126's number and was seen
  here" and dl-115's "measured which of the two it can be here" now say the
  steps measured here run backwards and cannot shorten the wait, and that a
  forward step would and none was observed. `awk '/^- 2026-10-18 — Fixed at
  landing/{exit} {print}' <this ticket> | grep -c "was seen here"` → 0;
  `grep -c "none was observed" <dl-115 ticket>` → 1.

- 2026-10-18 — Fixed at landing by owner choice: gate 1, F2 — "the test's
  comment over `quietWaitCalls` says a deadline-cut wait is 'the one way the
  minimum is not held that a test can name'". The comment now names the `stop`
  predicate as the other way and what tells it from a clock step.
  `grep -c "that is the one way the" <the spec file>` → 0.

- 2026-10-18 — Fixed at landing by owner choice: gate 1, F3 — "page load and
  provocation 'take under 2 s on `/mse.html`'". The comment says about 2 s,
  1.6 to 2.0 s measured at a load average up to 11.5. `grep -c "take under 2 s"
  <the spec file>` → 0.

- 2026-10-18 — Fixed at landing by owner choice: gate 1, F4 — "the Log's Done
  when 2 bullet gives the mutation and the message but not the command". The
  bullet now carries the `npx vitest run … -t "defaults to 1200"` command and its
  result, names the `options({...})` call in `quietWait` in the spec file rather
  than "the helper's `options()`", and says the spec file was the only file
  restored. `awk '/^- 2026-10-18 — Fixed at landing/{exit} {print}' <this
  ticket> | grep -c "the helper's"` → 0.
