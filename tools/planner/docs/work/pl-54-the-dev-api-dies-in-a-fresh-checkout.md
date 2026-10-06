---
id: pl-54
tool: planner
title: The dev API dies in a fresh checkout because nothing builds the contract
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# pl-54 — the dev API dies in a fresh checkout

## Why

`@planner/api` imports `@planner/contract` through its package exports, which
resolve to `dist/`, and the dev script ran `node --watch --import tsx
src/main.ts` with nothing building that `dist/` first. A checkout that has never
run `npm run build` has none, and the API dies on start:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '…/node_modules/@planner/contract/dist/index.js'
  imported from …/tools/planner/api/src/main.ts
```

Found on 2026-10-06 through the ledger, which has the same script and is lg-12.
The shared checkout's planner started only because a `dist/` already existed in
it. The downloader found and fixed this shape in #151 (`npm run build &&` ahead
of the watcher), and the fix never reached the planner. A stale `dist/` is the
worse case: the server starts against an old contract.

## Build

1. `tools/planner/api/package.json`: `dev` becomes
   `npm run build && node --watch --import tsx src/main.ts`, with a `// dev` key
   saying why, adapted from the downloader's.
2. `tools/planner/CLAUDE.md`: one sentence beside the existing note on the dev
   script.

## Done when

1. In a fresh worktree off `origin/main` with no `tools/planner/*/dist`,
   `npm run dev` in `tools/planner/api` reaches `listening` and `/api/health`
   answers 200, where before it died with `ERR_MODULE_NOT_FOUND`.
2. `npm run check` passes.

## Log

- 2026-10-06 — Built alongside lg-12, the owner choosing to fix both now.
  - **Reproduced before the fix** in a fresh worktree off `4907d9a` (0 `dist`
    directories under `tools/planner`): `node --import tsx src/main.ts` in
    `tools/planner/api` died with `ERR_MODULE_NOT_FOUND` for
    `@planner/contract/dist/index.js`.
  - **After:** `npm run dev` in the same tree built core, contract, intake,
    itinerary and agent (`tsc --build` walks `api`'s project references),
    listened on 8090, and `/api/health` returned 200 with the scripted provider
    and fixture grounding. No `ERR_MODULE` line in the log.
  - **pl-54 is free** despite appearing in repo-49's Log: that is `next-id.mjs`
    output pasted into a measurement, not an id anyone promised.
  - **No unit test**, for lg-12's reason: the proof is starting the script from
    a tree with no `dist`.
