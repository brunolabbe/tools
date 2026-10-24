---
id: repo-119
tool: repo
title: oxlint 1.88 reports 140 errors on main that 1.77 does not, so the lockfile holds 1.77
kind: chore
status: needs-decision
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

## Decision — open

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

## Log

- 2026-10-24: filed from the dependency update that held oxlint at 1.77.0.
