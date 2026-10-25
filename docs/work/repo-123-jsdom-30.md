---
id: repo-123
tool: repo
title: Move the web test environment from jsdom 27 to 30
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-123 — jsdom 27 to 30

## Why

The three web workspaces declare `jsdom ^27` (27.4.0) as their vitest
environment; 30.0.0 shipped 2026-07-27 (30.1.3 latest). Three majors of DOM
behaviour sit under every web unit test, and a test that passes on a DOM that
changed under it is the failure to look for.

## Build

1. Read the 28, 29 and 30 release notes for removed or changed behaviour this tree
   leans on: layout stubs, `matchMedia`, form validation, events.
2. Bump it in the three `package.json` files together; if repo-121 has landed,
   check vitest 5 states a jsdom range that admits 30.
3. `npm test -- --project downloader`, `planner`, `ledger`; in the Log, name every
   test that needed a change and why.

## Done when

- One jsdom 30.x in the lockfile and all three tools' suites pass.

## Log

- 2026-10-24: filed from the dependency audit.
