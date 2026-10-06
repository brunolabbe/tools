---
id: lg-12
tool: ledger
title: The dev API dies in a fresh checkout because nothing builds the contract
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-12 — the dev API dies in a fresh checkout

## Why

`npm run dev:ledger` brings the web app up and the API down. `@ledger/api`
imports `@ledger/contract` through its package exports, which resolve to
`dist/`, and the dev script ran `node --watch --import tsx src/main.ts` with
nothing building that `dist/` first. A checkout that has never run
`npm run build` has none:

```
[api] Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/workspaces/tools/node_modules/@ledger/contract/dist/index.js'
  imported from /workspaces/tools/tools/ledger/api/src/main.ts
[api] Failed running 'src/main.ts'. Waiting for file changes before restarting...
```

The owner hit it on 2026-10-06 in the shared checkout at `4907d9a`. The
downloader found and fixed the same shape in #151 (`npm run build &&` ahead of
the watcher); the fix never reached the ledger. The planner has the same defect
and is pl-54 — two tools, so two pull requests.

Once it starts, a second wall: every route but `/api/health` answers `403
UNAUTHENTICATED`, by design (lg-3). The way through, `DEV_IDENTITY`, is
documented only in `.env.example`, which nothing loads.

## Build

1. `tools/ledger/api/package.json`: `dev` becomes
   `npm run build && node --watch --import tsx src/main.ts`, with a `// dev` key
   saying why, adapted from the downloader's.
2. `tools/ledger/CLAUDE.md`, under Commands: the `DEV_IDENTITY` command line,
   and one sentence on the build.

## Done when

1. In a fresh worktree off `origin/main` with no `tools/ledger/*/dist`,
   `npm run dev` in `tools/ledger/api` reaches `listening` and `/api/health`
   answers 200, where before it died with `ERR_MODULE_NOT_FOUND`.
2. `tools/ledger/CLAUDE.md` shows the `DEV_IDENTITY` command.
3. `npm run check` passes.

## Log

- 2026-10-06 — Built in the session the owner reported it in, the owner
  choosing to fix ledger and planner now over filing them.
  - **Reproduced before the fix** in a fresh worktree off `4907d9a` (0 `dist`
    directories under `tools/ledger`): `node --import tsx src/main.ts` in
    `tools/ledger/api` died with `ERR_MODULE_NOT_FOUND` for
    `@ledger/contract/dist/index.js`.
  - **After:** `npm run dev` in the same tree built core, contract and books
    (`tsc --build` walks `api`'s project references), listened on 8100, and
    `/api/health` returned 200 `{"ok":true,…}`. No `ERR_MODULE` line in the log.
  - **`DEV_IDENTITY` measured in the shared checkout:** started with
    `ACCESS_PEOPLE=alex@example.test=alex DEV_IDENTITY=alex@example.test`,
    `/api/people` answered 200 `{"people":["alex"]}` both directly on 8100 and
    through Vite's proxy on 5193; without them, 403.
  - **The id is lg-12, not lg-11.** `next-id.mjs ledger` printed `lg-11`, but
    lg-4's Log names lg-11 as the rate-limiting follow-up the owner declined in
    favour of folding it in. Never filed, but taking it would attach this work to
    that conversation.
  - **No unit test.** What is wrong is a script, and the proof is starting it
    from a tree with no `dist`; a test pinning the string would prove the string.
    The downloader's #151 took the same view.
  - **The web app needs the contract's `dist` too** (`web/src/rules/*.tsx`
    import `@ledger/contract`) and gets it from this build. `concurrently` starts
    the two at once, so a page requested in the first seconds of a fresh
    checkout can still fail until the build lands, and a reload fixes it. That
    is the downloader's behaviour as well, and it was left alone.
