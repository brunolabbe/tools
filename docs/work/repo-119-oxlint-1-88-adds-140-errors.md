---
id: repo-119
tool: repo
title: oxlint 1.88 reports 140 errors on main that 1.77 does not, so the lockfile holds 1.77
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-119 — oxlint 1.88 reports 140 errors on main that 1.77 does not

## Why

The 2026-10-24 dependency update took every in-range release at least seven days
old (`.claude/rules/dependency-updates.md`), and oxlint's was 1.88.0. With it,
`npm run lint` fails on a tree 1.77.0 passes, so the update held oxlint at 1.77.0
in the lockfile — `package.json` still says `^1.77.0`, and the next `npm update`
takes 1.88 or later again and fails the same way.

Measured on `5f9e3c0a` plus that update, `npx oxlint` at 1.88.0:

| Count | Rule                                          | Where, mostly                              |
| ----: | --------------------------------------------- | ------------------------------------------ |
|   113 | error `unicorn(consistent-function-scoping)`  | test helpers declared inside a `test` body |
|    12 | error `react(set-state-in-effect)`            | ledger and planner web screens             |
|     9 | error `react(exhaustive-effect-dependencies)` | ledger web, downloader `Preview.tsx`       |
|     4 | error `react(refs)`                           | web                                        |
|     2 | error `react(purity)`                         | web                                        |
|    15 | warning `eslint(no-await-in-loop)`            | e2e specs                                  |
|     4 | warnings, three other rules                   |                                            |

## Decision — answered

Which of the new rules does this repo adopt?

1. **Adopt all, fix every finding.** The 113 scoping errors are mechanical
   (hoist a helper to module scope). The 27 React errors each need reading: a
   `setState` in an effect is sometimes the right call and sometimes a derived
   value. Largest diff, touches every tool's web and tests — one pull request per
   tool, by the two-tools rule.
2. **Adopt the React rules, turn `consistent-function-scoping` off** in
   `.oxlintrc.json`. Test helpers scoped to the test that uses them are a
   readability choice here, not a defect; the React findings are the ones that can
   be bugs.
3. **Turn every new rule off** and take 1.88 as it is. Cheapest, and keeps nothing
   the release offers.

Recommended: 2.

## Build

After the decision: set the rules in `.oxlintrc.json`, update oxlint (with the
rule in `.claude/rules/dependency-updates.md`), fix what the adopted rules
report, and raise the `package.json` floor to the version adopted so a lockfile
cannot fall back.

## Done when

- `npm run check` passes with oxlint at the adopted version in the lockfile and
  as the `package.json` floor.
- `.oxlintrc.json` states each rule turned off with a comment saying why.

## Review

**Gate: PASS** — 2026-10-25 · `7f8d7f48..eaa71a6d` (#657), with #654 `7f8d7f48..1edf40c4`, #655 `7f8d7f48..3d737bb0`, #656 `7f8d7f48..d8bffc9f` · Opus 5.5, depth medium

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` passes with oxlint at the adopted version in the lockfile and as the `package.json` floor | **verified** on a scratch merge of all four heads (no conflicts): oxlint 1.88.0 (scratch install, the farm holds 1.77.0) with the branch's `.oxlintrc.json` exit 0, 0 errors, 18 warnings; `npm run format:check` exit 0; `npm run typecheck` exit 0. Lockfile: `oxlint` and its 19 `@oxlint/binding-*` entries at 1.88.0, the root at `^1.88.0`, nothing else changed (21 entries of 21). `package.json` floor `^1.88.0`. On #657 alone 1.88.0 gives 27 errors, all in files #654–#656 fix, and CI's `check` on #657 at `eaa71a6d` fails with the same "Found 19 warnings and 27 errors": a merge-order fact, below |
| `.oxlintrc.json` states each rule turned off with a comment saying why                                    | **verified** by reading: the diff turns off one rule, `unicorn/consistent-function-scoping`, with a comment giving the reason and the owner's decision. Positive control: with the branch config, 1.88.0 reports a planted `useEffect(() => { setX(1) }, [])` in a ledger web component (`react(set-state-in-effect)`) and does not report a planted nested test helper; the base config reports that helper (`unicorn(consistent-function-scoping)`)                                                                                                                                                                |

**Merge order (not a finding):** #657's `check` cannot go green until #654, #655 and #656 have merged and `main` is merged into #657. Each of the three is green on its own head at the lockfile's 1.77.0, `check` included, so those three can merge in any order.

- **low** · no `Done when` line depends on it · `nfr:maintainability` — none of the four reset-during-render fixes (`ProbePanel`, `PlanView`, `History`, `Receipts` `useLoad`) has a test that tells it from the effect it replaced. The test #655 adds, `tools/planner/web/test/plan-view.test.tsx` › "goes back to loading, asks for the new plan, then shows it", passes against the base `PlanView` (1 passed) and fails only when the reset is removed altogether. It guards that the reset happens, not that it happens before paint, which `act()` cannot see. Nothing re-renders `ProbePanel` with a new probe or `Preview` with a new path after a failure, and no test sends a scroll event to `ColumnChart`, so the owner's chosen tip behaviour is untested.
- **low** · the ticket's Log says 1.88.0 printed "18 warnings" on `7f8d7f48`. At 1.88.0 there are 19: 15 `no-await-in-loop`, 2 `prefer-set-has`, 1 `prefer-array-find` and 1 `react(no-deriving-state-in-effects)` in `ProbePanel.tsx`. The same Log entry says that last warning went with the `ProbePanel` fix, so 18 is the count on the merge. The error is about a detail nothing relies on.
- **dropped** · all 13 `oxlint-disable-next-line` lines were checked against the code, and each reason holds. The six `refresh` callbacks (`Admin`, `Household`, `Inbox`, `Rules`, `MortgageSplit`, `Spending`) set state only after an `await` or inside the `catch`, and every fetcher they call is an `async function`, so no synchronous throw reaches the `catch` before the first await. The five triggers (`App` ×2, `Chart` `count`, `PeriodLines` and `PeriodRows` `version`) are triggers: the effects read only setters, refs and module functions. `JobCard`'s clock read sits behind the status comparison. `Stats`' `today` is re-read on purpose, and a discarded render's value is never committed.
- **dropped** · `Preview` going from path A to B and back to A keeps A hidden, where base retried it. That same token comes back only on a probe-cache hit within 60 s, and then it is the same image that failed. The comment's promise is a fresh chance for a _different_ image, and that still holds. A behaviour difference, not a defect.
- **dropped** · `useElapsed`'s `now` goes stale while `startedAt` is `null`. At both call sites `startedAt` is set at or after the last `now` read (`JobCard`'s mark is read in render, `AnalysingPanel` mounts with its start), so the clamp shows 0 for at most one interval, which is correct.
- **dropped** · `useJobs`' layout-effect sync: a child's layout effect runs before the parent's and would read the previous list. No other `useLayoutEffect` exists in `tools/downloader/web/src`. No live call site.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- NFR: security n/a (lint config and render timing, no new input path) · performance: `ColumnChart` re-renders on every scroll event, the owner's choice, unmeasured in a browser as the Log says · reliability ✓: no reset loops, since each one stores the value it compared against, and A→B→A resets each time; web suites downloader 321/321, planner 132/132, ledger 241/241 · maintainability: see the first low.

## Log

- 2026-10-24: filed from the dependency update that held oxlint at 1.77.0.
- 2026-10-25: the owner chose option 2. Adopt the React rules and turn
  `unicorn(consistent-function-scoping)` off in `.oxlintrc.json`, with a
  comment saying why. The 27 React findings are fixed one pull request per
  tool. Now `ready`.
- 2026-10-25: built as four pull requests. The React fixes are #654
  (downloader, 6 errors), #655 (planner, 2) and #656 (ledger, 19), each from
  `7f8d7f48` and each passing `npm run check` at the lockfile's oxlint 1.77.0,
  so they merge in any order. This one carries `.oxlintrc.json`, the
  `package.json` floor (`^1.88.0`), the lockfile and this entry, and merges
  last.
  - **Version.** `npm view oxlint time` gives 1.88.0 on 2026-10-13 and 1.89.0 on
    2026-10-19, six days before today, so 1.88.0 is the newest that clears the
    week. Lockfile by `npx -y npm@11.21.1 update oxlint --before=2026-10-18
    --package-lock-only --ignore-scripts`, then `npm install
    --package-lock-only --ignore-scripts` on npm 10.9.9. A comparison of every
    entry against `7f8d7f48`'s lockfile: 21 changed, the root package (the
    floor) plus `oxlint` and its 19 `@oxlint/binding-*`, all 1.77.0 to 1.88.0;
    `node scripts/check-lockfile-sync.mjs` printed `up to date`.
  - **The rule is live at 1.77.0 too.** A spec the planner branch added failed
    `npm run check` at 1.77.0 on `consistent-function-scoping` (an `arrive`
    placeholder arrow), so the planner pull request keeps its new test clear
    of it until this one turns it off. It is off in `.oxlintrc.json`
    with the reason beside it.
  - **Counts, 1.88.0 binary from a scratch install, on `7f8d7f48`.** 113
    `consistent-function-scoping`, 12 `set-state-in-effect`, 9
    `exhaustive-effect-dependencies`, 4 `refs`, 2 `purity` errors (the table
    above, to the digit), plus 19 warnings. On a scratch merge of this branch
    and the three (not pushed): `exit 0`, no error, 18 warnings, all
    `no-await-in-loop` (15), `prefer-set-has` (2) and `prefer-array-find` (1),
    which 1.77.0 also prints. `no-deriving-state-in-effects`, the fourth
    warning of the ticket's table, went with the `ProbePanel` fix. `npm run
    check` on the same merge at 1.77.0 exited 0.
  - **What the 27 were, by reading each.** Fixed in code (14): `Preview` (two
    findings), `ProbePanel`, `useElapsed`, `useJobs`, `PlanView` (two),
    `History`, `Receipts` `useLoad` (two), `MortgageSetting` and `Chart`'s three
    `refs` findings. Left with `oxlint-disable-next-line` and a reason (13): six
    `refresh` calls that set state only after an `await` (the rule reads them as
    synchronous; rewriting them as `.then` chains made the finding go and
    `promise/always-return` appear, which is dodging the heuristic, so not
    done), five dependency lists with a trigger the effect does not read, and
    `JobCard` and `Stats` clock reads in render.
  - **A behaviour change.** `Chart`'s tip offset now comes from state fed by
    `onScroll`, not a ref read in render, so the tip follows a wheel or swipe
    while the pointer is still. It costs a render per scroll event; unmeasured
    in a browser.
  - **Not done, and why.** The 15 `no-await-in-loop` warnings in e2e specs and
    the three other warnings do not fail `npm run lint`, are not in the Done
    when, and 1.77.0 prints them too; fixing e2e specs is a wider change than
    this ticket's answer. Oxlint's own `--version` in the farm is the shared
    checkout's 1.77.0, so `npm run check` here measures 1.77.0 and the 1.88.0
    lint is the scratch binary: unmeasured is `npm run check` with 1.88.0
    installed, which CI does on the merged tree.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the second low — "the ticket's Log says 1.88.0 printed "18 warnings" on `7f8d7f48`". The 2026-10-25 build entry above now says 19 on `7f8d7f48` (18 on the merge, as its next sentence already had it); `git diff eaa71a6d HEAD -- docs/work/repo-119-oxlint-1-88-adds-140-errors.md | grep -c '^-.*plus 18 warnings'` → `1`.
