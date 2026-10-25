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
- 2026-10-25: built on `origin/main` 558ce370, branch `repo-121-vite-8-vitest-5`.
  - **Versions, against the seven-day rule** (today 2026-10-25, cutoff 2026-10-18):
    vite **8.3.4** (2026-10-08), not 8.3.5 (published 2026-10-21, inside the week —
    the brief named it as latest); `@vitejs/plugin-react` **6.1.2** (2026-10-05);
    vitest **5.0.5** (2026-10-15). The ranges are `^8.3.4`, `^6.1.2`, `^5.0.5`, so
    nothing younger than 8.3.5's week can be pulled in by a plain `npm install`.
    The lockfile came from `npx -y npm@11.21.1 install --package-lock-only
    --ignore-scripts --before=2026-10-18`, then `npm update vite` and `npm dedupe`
    the same way (the first pass kept a root vite 7.3.7 for vitest, which accepts
    6, 7 or 8), then a plain `npm install --package-lock-only` on npm 10.9.9.
    41 lockfile entries changed version or were added, 78 removed (rollup, its 25
    `@rollup/*` platform binaries and `@napi-rs/lzma-linux-x64-gnu`, plugin-react
    5's babel tree, vitest 4's `@vitest/*`; the first draft of this line said 86
    and 27, counts nothing relied on); the
    newest added entry is vitest 5.0.5 at 2026-10-15, so none is inside the week and
    none needs the advisory exemption. rolldown 1.2.14 and its bindings
    (2026-10-14) and `lightningcss` 1.33.0 are new in the tree, as vite 8 brings them.
    `node scripts/check-lockfile-sync.mjs` exit 0. One vite, 8.3.4, at
    `node_modules/vite`; plugin-react hoisted once; no nested vite.
  - **The override is gone**: `overrides.vitest` and its sentence in
    `"// overrides"` removed from `package.json`.
  - **Breaking changes that reach this tree: none needed a config edit.** Read from
    vite's migration guide (rolldown for rollup, Oxc for esbuild, Lightning CSS for
    CSS minification, `build.rollupOptions` renamed `rolldownOptions`, `esbuild`
    optional) and vitest 5.0.0's release notes (43 breaking changes; the ones that
    could reach here are mocks cleared before each test, an un-awaited async
    assertion failing, inline projects extending the root config, hoisted-method
    errors). The three `vite.config.ts` set only `root`, `plugins: [react()]`,
    `server` and `build.{outDir,emptyOutDir,sourcemap}`; none of the renamed or
    removed keys appears. `vitest.config.ts` is unchanged except for two comment
    words. In vitest 5 an inline project extends the root config by default, so it
    inherits the root's `maxWorkers`, and `resolveConfig` falls back to
    `getDefaultMaxWorkers` (core count less one) only where none is set (both in
    `node_modules/vitest/dist/chunks/index.1TqnEahn.js`; `resolveMaxWorkers` there
    only parses a number or a percentage), so `scripts/test-gate.mjs`'s
    `VITEST_MAX_WORKERS` still works: the gate printed `11 workers` and vitest ran
    them. The first draft named `resolveMaxWorkers` as the resolver, which was
    wrong; gate 1 measured every project at 11 locally, 4 with `CI=1`, 3 with
    `VITEST_MAX_WORKERS=3`.
  - **Measured**, in a worktree with a real `npm ci --ignore-scripts` (the farm's
    links would have written through to the shared checkout), better-sqlite3's
    `build/Release` and ffmpeg-static's binary copied from the shared checkout:
    - `npm run build`: exit 0, every `vite build` printed `vite v8.3.4`, no
      warning or deprecation line (`grep -i "warn|deprecat|error"` printed nothing).
    - `npm run check`: exit 0.
    - `npm test`: exit 0, `313 passed | 1 skipped (314)` files, `6906 passed | 2
      skipped (6908)` tests, 111 s, `RUN v5.0.5`.
    - `npm run e2e:planner`: 10 passed of 10. `npm run e2e:ledger`: 12 passed of 12.
    - `npm run e2e:downloader`: **14 passed, 1 failed of 15** — `download.spec.ts:33
      paste a URL, pick a quality, and download the file`, at
      `await expect(job).toBeInViewport()` (line 82), `viewport ratio 0`. It fails
      the same way on three reruns here **and on the base**: a second tree at
      558ce370 (vite 7.3.7, vitest 4.1.12, built there) failed the same spec the
      same way on two runs (`Received: viewport ratio 0`). So it is not this
      change's; it is unexplained, and the `Done when` line's "the three e2e suites
      pass" is met for two and not for the downloader's one spec. Not filed: I have
      no reproduction beyond this environment (WSL devcontainer, Chromium
      headless shell 1248), and CI's reading of that spec on `main` is the
      orchestrator's to take. Read in this sandbox only: the owner's answer of
      2026-10-25 is below, and CI grades the line.
    - The three dev servers (`npm run dev -w @<tool>/web`, ports 5173, 5183, 5193)
      each answered `200` on `/` and `200 text/javascript` on `/src/main.tsx`.
    - `npm audit`: one high, `node-forge`, no fix available — dl-132's, as at base.
  - **Folded in, then dropped at landing (see the owner's answers below)**:
    `.claude/rules/testing.md` named
    `@rollup/rollup-win32-x64-msvc` as the native module a faked `win32` crashes
    on; rollup is not in the tree now, so it names `@rolldown/binding-win32-x64-msvc`
    (the entry exists in the lockfile; not run on Windows). `vitest 4`'s
    `--execArgv` sentence next to it and `reference/defect-shapes.md`'s `basic`
    reporter line are left: I did not re-measure either on vitest 5
    (`basic` is still absent from vitest 5's reporters, by grep).
  - **For repo-123 (jsdom 30)**: vitest 5.0.5 declares `jsdom: '*'` as a peer, so
    it does not constrain the major. jsdom 30.1.x declares `engines.node`
    `^22.22.2 || ^24.15.0 || >=26.0.0`; this sandbox runs 22.23.3, and CI and the
    two Dockerfiles ask for `22` / `22-bookworm`, which float to the latest 22.x.
    vitest 5 itself needs `^22.12.0 || ^24.0.0 || >=26.0.0`. The repo's own
    `engines.node` is `>=22.0.0`. Nothing was run against jsdom 30 here.
- 2026-10-25, owner's answers at the landing:
  - `.claude/rules/testing.md` fold-in: **dropped**, no ticket. The hunk is
    reverted so the file equals `origin/main`'s: rule pages change in the owner's
    review session, and the rolldown binding name is unmeasured on Windows.
  - The e2e `Done when` line: **graded by CI, the sandbox noted here, no ticket.**
    The local downloader failure (`download.spec.ts:33`, base reproduction at
    558ce370) is this sandbox's; CI's downloader `e2e (direct)` passed 15 of 15
    at e1b83883.
  - Vite 8's CSS baseline: **accepted**, not pinned. Vite 8 minifies CSS with
    Lightning CSS against its Safari 16.4 baseline, which rewrites `max-width`
    media queries to range syntax, so Safari 16.4 is the floor for the three web
    apps' built CSS; no `build.cssTarget` is set.
  - Gate 1's second and third lows: fixed at landing; the fifth stays recorded and
    unfixed.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the second low — "the
  comment names resolveMaxWorkers, which only parses a number or a percentage".
  The `vitest.config.ts` comment and the Log's worker-count sentence now name the
  inherited root config and `getDefaultMaxWorkers`. The diff from e1b83883 on
  `vitest.config.ts`, piped to `grep -c '^-.*resolveMaxWorkers in vitest'`, gives
  1, and the same on this file for `^-.*then the root's (` gives 1.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the third low — "86
  removed is 78, and rollup with 27 platform binaries is 25 `@rollup/*` plus
  lzma". Counted from both lockfiles: 78 removed against `origin/main`
  (5bd945c6), 25 `@rollup/*` entries, `@napi-rs/lzma-linux-x64-gnu` and
  `node_modules/rollup` itself. The diff from e1b83883 on this file, piped to
  `grep -c '^-.*86 removed (rollup and its 27'`, gives 1.
