---
id: dl-122
tool: downloader
title: The dl-118 menu ceiling fails again on the Windows leg, at 4286 ms against 4000
kind: fix
status: done
milestone: null
depends_on: [dl-119]
difficulty: standard
---

# dl-122 — The dl-118 menu ceiling fails again on the Windows leg

## Why

[dl-118](./dl-118-three-age-gate-rows-spend-11-s-each-in-provoke-playback.md)
added `clickTimeoutMs`, and its cap test in `provoke.test.ts` bounds three rows by
a wall-clock ceiling. The menu row (a shell's 18+ menu button, where the two play
clicks are the blocked ones) has a ceiling of `MENU_CEILING_MS = 4000`, set by
[dl-119](./dl-119-the-dl-118-cap-ceiling-fails-on-a-slow-windows-runner.md)
after the same row failed on a Windows runner at 3584 ms against 3000.

On 2026-10-13 the same row failed again on the same leg, on `main` at `6d879b26`:
`expected 4286 to be less than 4000`. The leg is informational, so the run's own
conclusion is still `success`; the failure is visible only on the job.

Two readings of the row on the Windows leg since dl-119 raised the ceiling are on
record. They disagree, which points to an intermittent failure rather than a
constant slowdown. They are different quantities, so they are labelled:

- **Failed:** 4286 ms from the assertion's own timer around `provokePlayback`;
  vitest's per-test time for the same row is 4353 ms (it also covers `goto` and
  context creation). Run 38327148890 at `6d879b26`. The same run's two cookie
  rows read 2163 and 2167 ms, normal.
- **Passed:** 1892 ms, vitest's per-test time (the passing run's timer value is not
  in any log), run 38324641962 at `e240fbd1` (PR #467), 30 minutes earlier, on the
  same Windows leg. Its cookie rows read 2152 and 2111 ms.

The leg was not slow in the failing run; one row was, and its neighbours were
normal. That is dl-119's shape too (menu 3587 ms against cookie rows 2252 and
2239 ms).

The 4000 ms ceiling was set from a 3.6 s Windows reading and a 5.5 to 5.7 s
uncapped one-site regression on Linux. The Windows reading is now 4.3 s. A 4286 ms
reading is 1.2 s under the regression, so on its own it does not show that the
cap was working. Whether the
runner's uncapped path is also slower is unmeasured. Until someone measures it, a
wall-clock reading from a Windows runner cannot separate a slow cap from a partly
uncapped page. dl-119 left the same question open for its 3584 ms reading.

This is the second Windows failure of the menu row. dl-95 and dl-119 both chose a
wall-clock ceiling for a slow Windows runner, and this is the same kind of failure.

## Reproduction

Re-run on 2026-10-13, from the worktree at `6d879b26` (`origin/main`).

```
$ gh run view 38327148890 --json headSha,conclusion,event,name,jobs   (summarised)
headSha 6d879b2682e7e7cef34479cb944ce5e3413a0d69, event push, run conclusion success
job "test (windows-latest, informational)"  id 115068775760  conclusion failure
  step "Run npm test"  conclusion failure

$ gh run view --job 115068775760 --log-failed | grep -E "FAIL |AssertionError"
test (windows-latest, informational)	Run npm test	... FAIL  downloader tools/downloader/resolvers/test/browser/provoke.test.ts > clickTimeoutMs caps the clicks a covering layer blocks (dl-118) > a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms
test (windows-latest, informational)	Run npm test	... AssertionError: expected 4286 to be less than 4000
test (windows-latest, informational)	Run npm test	##[error]AssertionError: expected 4286 to be less than 4000
```

(ANSI colour codes removed, the repeated job-and-step prefix shortened.)

```
$ gh run view 38324641962 --json headSha,conclusion,event,name,jobs   (summarised)
headSha e240fbd1ce2bf36d386ad90034998c9f0e40f623, event pull_request, run conclusion success
job "test (windows-latest, informational)"  id 115060412701  conclusion success
  step "Run npm test"  conclusion success

$ gh run view --job 115060412701 --log | grep -a "menu button: the blocked clicks"
...✓ a shell's 18+ menu button: the blocked clicks wait for the cap, not 2000 ms 1892ms
```

The ceiling in the file:

```
$ grep -n "MENU_CEILING_MS" tools/downloader/resolvers/test/browser/provoke.test.ts
641:  const MENU_CEILING_MS = 4000;
653:      MENU_CEILING_MS,
```

Locally the row is not reproduced: a Linux run reads the capped menu row at 1.9 to
2.1 s (dl-119's table). The failure is the Windows runner's, so the test can only
be checked locally against the two regressions the row must keep catching.

## Build

**Decision: the form of the menu row's bound.** This is an open choice between
options with different costs, so it is the owner's to make, not the builder's.
Options, the recommended one first:

1. **Chosen (owner, 2026-10-13).** **Measure the mechanism, not the clock.** Assert that the menu row's blocked
   clicks were given the cap as their timeout, by observing the click calls,
   instead of asserting on total elapsed time. It does not depend on runner speed
   at all, and it takes the wall-clock threshold out of this row. Cost: a different
   test shape, and the title and comment change, since the row no longer proves a
   wall-clock bound; it also does not cover waits that are not click timeouts. The
   builder first checks that the cap reaches the click call as its timeout option.
   Two more qualifiers, from the gate's probe on the head. The observation point
   is Playwright's internal `Locator` class (wrap `click` on
   `Object.getPrototypeOf(page.locator("body"))`), which is not documented API,
   a cost this option carries. And the assertion cannot be "no click got 2000 ms",
   because the age-gate press and the video clicks legitimately carry 2000 and
   1500: key it by outcome, so that every click that **rejected** was given the
   cap, with a companion that fails on empty (at least one rejected click, not an
   exact count, which varies with timing) and the uncapped control at 2000. The
   gate's probe, which showed all three plants and the uncapped control, is a
   starting point: https://github.com/brunolabbe/tools/pull/470#issuecomment-6135917927
   (scratch, not committed; it takes `<worktree> <cap|none> <pathname>`). Wrap
   `click` by hand and restore it in `finally`, rather than `vi.spyOn`: the file
   imports no `vi`, and adding it would change the import line, outside the cap
   block that Done when 5 allows. Recommended because it removes the recurring cause rather than moving the
   threshold again.
2. **Not taken.** **Raise `MENU_CEILING_MS` to 4500 ms.** The smallest change, and the same form
   as dl-119. Cost: 4500 leaves 214 ms above the slowest Windows reading on record
   (4286 ms) and about 1 s under the one-site regression (5.5 s on Linux). A slower
   runner later needs the next raise, and the row's margin against its regression
   narrows with each one.
3. **Not taken.** **Skip or retry the row on Windows.** Cost: a Windows-only skip drops the only
   coverage that runs on the platform where the slow readings occur, and a retry
   hides a real regression. Not recommended.

Whichever option is chosen, the work is:

- Plant each regression and show the row it should fail does fail, as dl-119's
  Done when 2 required: consent click uncapped (both cookie rows), play selector
  click uncapped and play text click uncapped (menu row, each alone and both).
  Record each plant's time, or for option 1 the timeout each click was given.
- Time only `provokePlayback`, as dl-119 does.
- Change only the dl-118 cap block of `provoke.test.ts` (dl-113's edits to the other
  blocks merged in #450).
- Record in the Log the margin the bound leaves against the capped runs (including
  1892, 3584 and 4286 ms from the Windows leg) and against the regression, measured
  more than once locally. A Windows leg can show one reading per run, so the margin
  against Windows readings is a count of readings, not a measurement.

## Done when

1. The owner's answer to the decision above is recorded in the Log, with its date
   and the option it was chosen from, and `status` is `ready` in the commit that
   records it.
2. The menu row's check, in the form chosen, passes at the 4286 ms reading on
   record, and still fails each planted regression. For a wall-clock form, the bound
   sits above 4286 ms and below the one-site uncapped reading; for option 1, the
   Log shows the timeout each click was given, capped and uncapped.
3. Each planted regression fails the row it should, and the Log records each plant
   with its time or timeout: consent click uncapped fails both cookie rows; each
   play click uncapped, and both, fails the menu row.
4. The three rows pass with the cap in place:
   `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
   "clickTimeoutMs caps"` reports `Tests 3 passed`.
5. Nothing outside the dl-118 cap block of `provoke.test.ts` changes, other than
   this ticket.

## Review

**Gate: PASS** — 2026-10-13 · `2cb4e734..5c41f39d` · Opus 5.5, depth standard

| Done when                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Owner's answer recorded with date and option, `status: ready`                                        | **verified** — the Log's "Owner's answer, status `ready`" entry names 2026-10-13 and option 1 out of four; the frontmatter reads `ready` at the head                                                                                                                                                                                                                                                                                                   |
| 2. Menu row passes at 4286 ms and fails each plant; Log shows each click's timeout, capped and uncapped | `resolvers/test/browser/provoke.test.ts` › "a shell's 18+ menu button: the blocked clicks are given the cap, not 2000 ms" ✓. The menu row's ceiling is `null`, so `elapsedMs` is never asserted for it. What carries the line is `expect(rejected.filter((click) => click.timeout !== CAP_MS)).toEqual([])` plus the non-empty companion. The gate's plants failed the row (below). The Log gives 200 capped and 2000 uncapped for each rejected click |
| 3. Each plant fails the row it should, recorded in the Log                                              | same block, re-planted by the gate: consent uncapped → `Tests  2 failed \| 1 passed`, both cookie rows on `expected [ { timeout: 2000, rejected: true } ] to deeply equal []`. Play selector uncapped → 3 failed, menu at 5460 ms with 2 rejected clicks at 2000. Play text uncapped → 3 failed, 2 at 2000. Both → 3 failed, menu at 9073 ms with 4 at 2000. The Log's account agrees ✓                                                                |
| 4. `-t "clickTimeoutMs caps"` reports `Tests 3 passed`                                                  | gate ran it: `Tests  3 passed \| 261 skipped (264)` ✓                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5. Nothing outside the dl-118 cap block changes, other than the ticket                                  | **verified** — `git diff --stat 2cb4e734...5c41f39d`: 2 files, the ticket and `provoke.test.ts`. Both hunks lie inside the `describe("clickTimeoutMs caps …")` block, and the import line is untouched                                                                                                                                                                                                                                                 |

- **low** · no live call site · no `Done when` line depends on it · **Some clicks
  escape the observation.** The test wraps `Locator.prototype.click`. In
  Playwright 1.62.1, `Locator.click` is
  `return await this._frame.click(this._selector, { strict: true, ...options })`.
  `Page.click` also goes to `this._mainFrame.click`, and `ElementHandle.click` goes
  straight to its channel. So a play click rewritten as `frame.click`, `page.click`
  or `ElementHandle.click` is never recorded. Today `provoke.ts` has none: all 9 of
  its `.click(` sites are locator clicks (enumerated with
  `grep -nE "\.click\(" tools/downloader/resolvers/src/browser/provoke.ts`).
  Reproduction:
  `sed -i 's|^        await target.click({ timeout: options.timeoutMs });$|        await frame.click(\`${visibleQuery(selectors)} >> nth=${index}\`, { timeout: 2000 });|' tools/downloader/resolvers/src/browser/provoke.ts`,
  then the cap block. Result: `Tests 2 failed | 1 passed`. **The menu row passes,
  at 5464 ms**, with only 2 rejected clicks recorded, both at 200. The cookie rows
  fail only on their clock (`expected 5707 to be less than 3200`). Before this
  branch, the 4000 ms ceiling would have caught that run. Remedy, measured: wrap
  `Object.getPrototypeOf(page.mainFrame()).click`, with the signature
  `(selector, options)`. Every locator, frame and page click goes through it, and
  the class is just as internal, so the cost is unchanged. With that wrapper, the
  same plant fails all 3 rows (`Tests 3 failed`; menu: 4 rejected, two at 2000),
  and the capped run still reports `Tests 3 passed`. `ElementHandle.click`would
  still escape. — _fixed at landing_ (owner, 2026-10-13), commit`36383710b1368274400ffc582086574dfd4455d6`.
- **low · open decision** · no `Done when` line depends on it · **The cookie rows
  keep the same wall-clock shape that failed on the menu row.** The ticket does not
  require changing them: its Why, its Decision ("the form of the menu row's bound")
  and Done when 2 are about the menu row only. The builder's Log calls keeping them
  "Decision taken without the owner". The cookie rows read at most 2329 ms in 39
  Windows readings, against 3200: 0.87 s of margin. The menu row's outlier was
  about 2.1 s above its usual reading. A spike that size on a cookie row would
  read about 4.3 s and fail. In the gate's runs, the cookie ceiling is now
  redundant for the consent plant, which the click check fails first. But it is
  the only thing that caught the `frame.click` escape above. Options:
  (a) **keep them, as built**, and record a trigger: a cookie row that fails its
  clock on Windows gets `ceilingMs` set to `null`. Recommended, since 0 of 78
  cookie readings came near the ceiling, and the clock is the only backstop for
  waits that are not click timeouts.
  (b) Set both to `null` now. This removes the flake shape everywhere, and loses
  that backstop.
  (c) Raise `COOKIE_CEILING_MS`. This is the shape the owner did not choose for
  the menu row. — owner chose (a), 2026-10-13
- **low** · `nfr:maintainability` · **The block comment's reason for the
  asymmetry does not tell the rows apart.** It says the cookie rows keep a clock
  for "a wait that is not a click's timeout", and the menu row has none because
  "its play clicks are the only blocked ones, and they are click timeouts". On the
  cookie sheets, every blocked click is also a click timeout: the gate's probe
  recorded 5 rejected clicks per sheet, all through `Locator.click`, all at 200.
  The real difference is the decision's scope, not the mechanism, and the
  comment should say so. — _fixed at landing_ (owner, 2026-10-13), commit `36383710b1368274400ffc582086574dfd4455d6`.
- **dropped** · the wrapper leaking into other tests. Restore is in a `finally`
  that wraps only `provokePlayback`, and nothing that can throw sits between the
  assignment and the `try`. The root `vitest.config.ts` sets no `concurrent`,
  `isolate` or `sequence`, and the file has no `.concurrent`. The prototype
  belongs to one worker's module instance. Not a defect.
- **dropped** · a click the test keeps uncapped (the age press at 2000, the modal
  close at 1500) rejecting on a slow runner and failing the row. A rejected age
  press already fails `toContain(pressed)` at base, so this adds no new failure
  mode. No video click fired on any of the three pages in the gate's probes.
- **findings** · the hunt returned 5: 3 carried, 2 dropped.
- **CI at `5c41f39d`** (read once): `test (ubuntu-latest)` and
  `test (windows-latest, informational)` both **pending**. `check`, `changes`,
  `codeql`, `CodeQL`, `dependency-review`, `docker`, `e2e (direct)` and
  `e2e (sniffer)` passed. No acceptance line needs the Windows leg, but it is the
  only place the original defect occurs, and it has not run on this head.
- Invariants: the change is test-only. Style checked: no `any`, no `console`, the
  import line unchanged; `npm run check` exits 0. Skipped, because the diff
  cannot touch them: AppError, shell, process trees, redaction, SSRF, progress,
  contract, test registration (existing file), Dockerfile, routes.
- NFR: security n/a · performance ✓ (menu row 1871 to 1926 ms locally, unchanged)
  · reliability: the menu row no longer reads a clock; the cookie rows still do
  (above) · maintainability: internal `Locator` prototype, a cost the owner's
  option accepts; comment above.

## Log

- 2026-10-13 — Filed by a builder in a maintenance dispatch (model: Haiku 5.5,
  builder-mechanical), from the reproduction above, with no code or test change.
  - **Status `needs-decision` when filed, `ready` now.** The Build's form was an
    open choice between options with different costs, and the builder may not
    settle it.
  - **Difficulty `standard`**, rated for the work once an option is chosen. It is
    the same procedure as dl-119, which was rated `standard`. Option 1 is more
    judgement than option 2; the rating was left as filed when the answer landed,
    and the owner may re-rate it.
  - Commands run for the reproduction are in the Reproduction section, and their
    output is pasted there.
  - What the sibling said that this reading now contradicts: dl-119's Log says the
    slowest Windows capped reading (3.6 s) left 0.4 s to the 4000 ms ceiling. A
    4286 ms Windows reading is past it.
- 2026-10-13 — Gate (ticket-reviewer-sonnet, Sonnet 5.5, narrow): PASS, six low
  findings, all fixed in this pull request. The gate's record is the pull request
  thread, not a committed file (the ticket stays `ready`, so records.md commits
  none): https://github.com/brunolabbe/tools/pull/470#issuecomment-6135887121
  - **The gate measured what the filing called unmeasured.** Every `ci.yml` run
    since #456's merge: 39 Windows readings reached the cap rows. The menu row
    passed 38 times at 1887 to 2255 ms (median about 2010) and failed once, at
    4353 ms, which is the run named above. The cookie rows read at most 2329 ms
    against their 3200 ms ceiling. So the failure is one outlier in 39 readings,
    on one row, with its neighbours normal.
- 2026-10-13 — **Owner's answer, status `ready`.** The question was "the form of
  the menu row's bound", with the options (1) observe the click timeout, (2) raise
  `MENU_CEILING_MS` to 4500 ms, (3) skip or retry on Windows, (4) leave it
  `needs-decision`. The owner chose **option 1**, with the 1-in-39 measurement in
  front of them. That was the builder's recommendation, so none was overridden.
  The owner also chose to fix the gate's six lows in this pull request.
- 2026-10-13 — Built, option 1 (builder, Sonnet 5.5). The dl-118 cap block of
  `provoke.test.ts` now wraps `Locator.click` by hand on
  `Object.getPrototypeOf(page.locator("body"))`, restores it in `finally`, and for each
  row asserts that every click that **rejected** was given the cap (200), with a
  companion that fails on an empty list (at least one rejected click). The menu row has
  no wall-clock ceiling any more. Every Build qualifier is met: no `vi` (the import
  line is untouched), the assertion is keyed by outcome, not "no click got 2000".
  - **Wrapper reaches the click.** Probe (the gate's, from the PR #470 thread, run
    from this worktree on the unchanged `provoke.ts`), menu page. Capped at 200: the
    age press `timeout 2000` succeeded in 45 ms, then four rejected clicks, each
    `timeout 200`, 200 to 301 ms; `provokePlayback` 2002 ms. Uncapped: the age press
    2000 (39 ms, succeeded), then four rejected clicks at `timeout 2000`, 2000 to
    2002 ms; 9086 ms. That is the capped and uncapped timeout each click was given
    (Done when 2).
  - **Plants (Done when 3).** Each planted in `provoke.ts` (`git diff --stat` showed
    the one line, or two for "both"), the cap block run with the command below, then
    restored with `git checkout`:
    `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t "clickTimeoutMs caps"`
    - consent click uncapped (`dismissConsent(frame, 2000, scriptable)`): 2 failed, 1
      passed, of 264 (`Tests  2 failed | 1 passed | 261 skipped (264)`). Both cookie
      rows fail on `expected [ { timeout: 2000, rejected: true } ] to deeply equal []`;
      the menu row passes, as it must, since the consent click is not blocked there.
    - play selector click uncapped (`timeoutMs: 2000` in the `clickVisible` call):
      `Tests  3 failed | 261 skipped (264)`: the menu row and both cookie rows. The
      rejected clicks at 2000 are two.
    - play text click uncapped (`clickByText(frame, PLAY_TEXT, 2000)`): 3 failed of
      264, the same three rows, two rejected clicks at 2000.
    - both play sites uncapped: `Tests  3 failed | 261 skipped (264)`, four rejected
      clicks at 2000; the menu row at 9329 ms.
    - **The brief had one thing short:** the play plants fail the cookie rows too, not
      only the menu row, because the cookie sheets also have blocked play clicks.
      Vitest prints one assertion message per distinct text, so the log names the
      rejected clicks once for three failing rows; the rows are the `FAIL` lines.
  - **Passes at 4286 ms and beyond (Done when 2).** A 4286 ms reading cannot be
    replayed off the Windows runner, so the clock was slowed instead: a 2500 ms
    `setTimeout` inside the wrapper, before the real click (a scratch edit, restored).
    The menu row passed at 15178 ms, 3.5 times the failing reading, while both cookie
    rows failed `expected 19790 to be less than 3200` and `19902`. The menu row's
    verdict does not read the clock.
  - **Margin.** The menu row has no threshold, so it has no margin against a
    reading: a capped click is 200 ms and an uncapped one 2000 ms, a factor of ten
    that no runner speed moves. The Windows readings (1892, 3584, 4286 ms) are
    now irrelevant to this row. Locally: capped `provokePlayback` 1894 (gate's probe),
    2002 (mine), uncapped 9178 (gate's) and 9086 (mine), both planted 9329. Two
    readings per side from two sessions, not a distribution.
  - **Decision taken without the owner (reversible, one line):** the cookie rows keep
    their 3200 ms ceiling beside the new check. The ticket and the owner's answer are
    about the menu row; the cookie rows read at most 2329 ms in 39 Windows readings,
    0.87 s under, and the ceiling covers a wait that is not a click's timeout, which
    the mechanism cannot. The slowed run above shows that ceiling is still a clock: if
    a cookie row flakes the way the menu row did, the same removal is a one-line
    change (`ceilingMs` to `null`). Not done here, as nothing has failed.
  - **Internal API cost, as the Build says:** `Locator` is Playwright's internal client
    class. If an upgrade moves it, `expect(typeof original).toBe("function")` or the
    empty-list companion fails the row; neither lets it pass quietly.
  - **Fold-in considered:** the gate's six lows (the Build says to fix them in this
    pull request) were fixed in #470 before it merged; the Why and Build already read
    "1.2 s under", "dl-113's edits ... merged in #450", labelled per-test times, and
    the wrap-by-hand wording. Nothing further was free.
- 2026-10-13 — Gate 1 (Opus 5.5, PASS) answered, and two lows fixed at landing
  (fixer, Sonnet 5.5). The wrapper entry above says `Locator.click`; it is now
  `Frame.click`.
  - **Owner's answer on the cookie rows.** The question: the cookie rows keep the
    3200 ms wall-clock ceiling that failed on the menu row; what to do with them.
    The options were (a) keep them, as built, and record a trigger (the gate's
    recommendation), (b) set both to `null` now, (c) raise `COOKIE_CEILING_MS`. The
    owner chose **(a)** on 2026-10-13. **Trigger: a cookie row that fails its clock
    on Windows gets `ceilingMs` set to `null`.** The block comment in
    `provoke.test.ts` carries the same sentence.
  - **Owner's answer on the other two lows:** apply both at landing, with no second
    gate (2026-10-13).
  - **Escaping clicks, fixed.** The wrapper moved from `Locator.prototype.click` to
    `Object.getPrototypeOf(page.mainFrame()).click`, with the signature
    `(selector, options)`; every locator, frame and page click goes through it.
    `ElementHandle.click` still escapes, and the comment says so. Plant, the gate's:
    `sed -i 's|^        await target.click({ timeout: options.timeoutMs });$|        await frame.click(\`${visibleQuery(selectors)} >> nth=${index}\`, { timeout: 2000 });|' tools/downloader/resolvers/src/browser/provoke.ts`,
    then `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t "clickTimeoutMs caps"`:
    `Tests 3 failed | 261 skipped (264)`, each row on `expected [ …(2) ] to deeply
    equal []`(two rejected clicks at`timeout: 2000`). After
    `git checkout -- tools/downloader/resolvers/src/browser/provoke.ts`, the same
    command: `Tests 3 passed | 261 skipped (264)`. Against the unfixed wrapper the
    gate measured `Tests 2 failed | 1 passed` and the menu row passing at 5464 ms.
  - **Comment, fixed.** The block comment now says the cookie rows keep the clock as
    a backstop and that the menu row lacks one because the decision was about the
    menu row, not because its clicks differ: on the cookie sheets too every blocked
    click is a click timeout.
