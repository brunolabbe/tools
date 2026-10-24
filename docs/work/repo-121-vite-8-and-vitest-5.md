---
id: repo-121
tool: repo
title: Move the web toolchain to vite 8, @vitejs/plugin-react 6 and vitest 5
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-121 — vite 8, @vitejs/plugin-react 6 and vitest 5

## Why

The three web workspaces declare `vite ^7` and `@vitejs/plugin-react ^5`, and the
root declares `vitest ^4`. vite 8 (2026-03-12, 8.3.5 latest), plugin-react 6
(2026-03-12) and vitest 5 (2026-09-03, 5.0.5 latest) are out. They move together:
vitest runs on vite, and the plugin's `Plugin` type has to come from the same vite
the config is built with.

The 2026-10-24 dependency update showed what a half-move does. vitest accepts
vite 6, 7 or 8, so `npm update` hoisted vite 8 for it while the workspaces kept
7, and each `vite.config.ts` failed typecheck with TS2769 (plugin-react resolving
vite 8's `Plugin`). That update added `overrides.vitest.vite: ^7.3.7` to the root
`package.json` to keep one vite; this ticket removes it.

## Build

1. Read vite 8's, plugin-react 6's and vitest 5's migration guides; list the
   breaking changes that reach this tree (config keys in the three
   `vite.config.ts` and the root `vitest.config.ts`, the jsdom environment, the
   test gate in `scripts/test-gate.mjs`, which passes worker counts).
2. Bump all three in one change, drop the `vitest` entry from `overrides` and its
   sentence from `"// overrides"`.
3. `npm run check`, `npm test`, `npm run build`, and each tool's e2e — the web
   apps' dev server and build are vite, and e2e is the only thing that runs them.

## Done when

- One vite (8.x) in `package-lock.json`, no `vitest` override, and `npm run
  check`, `npm test`, `npm run build` and the three e2e suites pass.

## Log

- 2026-10-24: filed from the dependency audit.
