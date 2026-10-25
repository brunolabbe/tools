---
id: repo-120
tool: repo
title: Move the Anthropic SDK from 0.125 to 1.x in the planner and the ledger
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-120 — Move the Anthropic SDK from 0.125 to 1.x

## Why

`@anthropic-ai/sdk` reached 1.0.0 on 2026-10-21 (1.3.0 on 2026-10-23); this tree
is on 0.125.0. Three workspaces import it: `@planner/agent`, `@planner/api` and
`@ledger/receipts`. A major release means breaking changes nobody here has read
yet, and every model call — the planner's runs and the ledger's receipt and
layout reads — goes through it.

**Not before 2026-10-28**: the rule in `.claude/rules/dependency-updates.md` keeps
1.0.0 out for seven days, and any later 1.x for seven days after its own release.

## Build

1. Read the SDK's changelog and migration notes from 0.125 to the 1.x being
   taken. List every breaking change that touches an API this tree calls —
   `grep -rn "@anthropic-ai/sdk" tools/*/*/src` is the call sites.
2. Bump the range in each of the three `package.json` files together, so one
   copy stays in the tree.
3. Adapt the call sites. Error classes, streaming helpers and usage/thinking
   token fields are the likely seams: the planner's cost report (pl-49, pl-52)
   reads the usage fields, so a renamed field shows up as a wrong cost, not a
   type error, if a fixture hides it.
4. Run `npm test -- --project planner` and `--project ledger`. The suites run
   on fixtures; say in the Log whether any fixture had to change shape, because
   a fixture rewritten to fit the new SDK proves less than one that already fit.

## Done when

- The three workspaces resolve one `@anthropic-ai/sdk` 1.x, and `npm run check`
  and both tools' suites pass.
- The Log lists each breaking change the migration notes name and what this
  tree did about it (including "not called here").

## Log

- 2026-10-24: filed from the dependency audit; 0.125.0 → 1.3.0 was the gap.
