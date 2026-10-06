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

## Review

**Gate: PASS** — 2026-10-06 · `4907d9a..cc6f77c` · Sonnet 5.5, depth medium

The ticket was filed on this branch, so its brief was read from the branch's copy down to `## Log`. Both row-1 measurements below ran in one detached worktree at `cc6f77c`, farmed with `worktree-farm.sh` (never `npm install`), with `find tools packages -name dist` returning nothing before each run, port 8090 free before and after, a private `TMPDIR`, a scratch `DATABASE_PATH`, and every server killed by process group.

| Done when                                                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. In a fresh worktree with no `tools/planner/*/dist`, `npm run dev` in `tools/planner/api` reaches `listening` and `/api/health` answers 200, where before it died with `ERR_MODULE_NOT_FOUND` | **verified**, not proven: nothing in `npm test` asserts it, and the ticket says so on purpose. Positive control first: with `tools/planner/api/package.json` set to its content on the base, `npm run dev` printed `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/node_modules/@planner/contract/dist/index.js' imported from …/tools/planner/api/src/main.ts` after 2 s and never listened. Then, in the same tree and with the same zero `dist` directories, the branch's script ran `tsc --build`, logged `"msg":"listening"` on port 8090 at 5 s, and `curl /api/health` returned `200` with `{"ok":true,…,"version":"0.8.0","agent":{"provider":"scripted"},"grounding":{"provider":"fixtures"}}`. Both of the Log's claims reproduced. |
| 2. `npm run check` passes                                                                                                                                                                       | **verified**: exit 0 in the worktree (written to a file, not read through a pipe): oxlint 14 warnings, none in a file this diff touches; oxfmt `All matched files use the correct format` over 892 files; `tsc --build --verbose` clean. CI's `check` job passed twice on `cc6f77c`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Premise checks, each run rather than read:

- **(a)** The failure is real on `main`'s script and gone on the branch's, per row 1. The control matters: the same harness shows the base script failing, so the pass on the branch is not a harness that cannot fail. One difference from the Done-when's wording: the tree is the branch tip with the base `package.json` checked out over it, not a tree at `origin/main`; the only other tracked differences are the `CLAUDE.md` sentence and the ticket file, neither of which `npm run dev` reads.
- **(b)** `tsc --build` in `tools/planner/api` builds everything the API imports. Starting from none, it left a `dist` and a `tsconfig.tsbuildinfo` in `packages/core`, `tools/planner/agent`, `tools/planner/api`, `tools/planner/contract`, `tools/planner/intake` and `tools/planner/itinerary`: the five projects named in `api/tsconfig.json`'s `references` plus the api itself, 5 of 5. Those five are also exactly the workspace dependencies in `api/package.json` (`@webtools/core`, `@planner/agent`, `@planner/contract`, `@planner/intake`, `@planner/itinerary`), so nothing the server imports is left unbuilt.
- **(c)** The `// dev` key's claims, one by one:
  - _Resolves to `dist/`, not `src/`_: true, the contract's `exports` is `./dist/index.js` and the error above names it.
  - _Fresh tree: dies on start with `ERR_MODULE_NOT_FOUND`_: true on the error; see the wording finding below on "dies".
  - _A stale `dist` starts the server against a stale contract_: reproduced for the planner. I built the contract's `dist` from the source one commit older in its history (before pl-47), restored `src`, and ran the old command (`node --import tsx src/main.ts`): `listening` after 3 s and `/api/health` 200, with `grep -c "briefOperationSchema\|currentBrief" tools/planner/contract/dist/plan.js` returning `0`. After `npm run build -w @planner/api` the same grep returned `3`, so the branch's script is what repairs it.
  - _Cannot restore a `dist` deleted by hand_: true. `rm -rf tools/planner/contract/dist`, then `npm run build` in the api: the directory did not come back and the build printed nothing. `npm run clean` then `npm run build` restored it.
  - _Runs once, so `node --watch` restarting does not rebuild_: true by the script's construction (`npm run build && node --watch …`); I did not edit a contract file under a live watcher, so that sentence is verified by reading, not run.
  - _The downloader's api carries the same script_: true, its `dev` is identical.
- **The `CLAUDE.md` sentence** says the script builds before it watches, that `@planner/contract` resolves to `dist/`, and that the reason is on the `// dev` key. All three are true of the tree.
- **The Log** was read last. Nothing in it is contradicted: the reproduction, the five built projects, port 8090 and the scripted provider with fixture grounding all matched. Its claim that `pl-54` is free also held: `node scripts/next-id.mjs pl` lists only this branch's PR as holding it and prints `next free: pl-55`.

Findings:

- **low** · no `Done when` line depends on it · **open decision**: `@planner/web`'s `dev` (`vite`) has the same shape when it is started alone. In the same tree with the contents of every `dist` removed by `npm run clean` (the empty directories remained), `npm run dev` in `tools/planner/web` answered `GET /src/main.tsx` with `500` and `Failed to resolve entry for package "@planner/contract"`, and `GET /` with `200` (a blank page), since the web imports `AppError` and `ROUTES` from the contract at runtime through the same `exports`. The headline command is unaffected: `npm run dev:planner` from the same emptied tree gave `GET /src/main.tsx` `200` and `GET /api/health` through the web's proxy `200`, because the api's build finished (about 4 s) before the page was requested; that is one run, not a guarantee of order, since vite reports ready in about 0.3 s. Nothing in the ticket claims the web, and the realistic fresh-tree paths all start the api first. Options: **(a)** record only (recommended: every path that starts the api already works, and a standalone UI start in a tree where no api has ever run is rare); **(b)** file a `pl-` ticket for the web's `dev`, with the downloader's and ledger's webs added to it, unmeasured; **(c)** widen this branch to the web's script, which turns a mechanical API fix into a design question about a watcher and a contract edited mid-session. **Owner, 2026-10-06: record only.** `dev:planner` is the documented entry point and works; the downloader's and the ledger's web have the same shape.
- **low** · no `Done when` line depends on it · the shape recurs and nothing keeps it from recurring: the same omission is now fixed by hand a third time (the downloader earlier, here, and the ledger in lg-12, PR #363, which is the live sibling and is not touched by this branch). Each was found by someone starting a dev server in a fresh worktree. A scan over `tools/*/api/package.json` in `packages/core/test`, of the kind `image-closure.test.ts` already is, would have failed on the ledger and would fail on the next tool. Options: **(a)** record only (recommended: lg-12 closes the only live instance, and a scan is a new test with its own false-positive surface); **(b)** file a `repo-` ticket for the scan. The `add-tool` skill carries no dev-script guidance either way (`git grep -n dev -- .claude/skills/add-tool` returns nothing about the script). **Owner, 2026-10-06: guard it in the `add-tool` skill**, not a scan — step 2 now names the build-first `dev` script and points at this package's `// dev` key. Folded into this pull request.
- **low** · no `Done when` line depends on it · wording: the ticket and the `// dev` key say the server "dies on start". Under `node --watch` it does not: the process prints `Failed running 'src/main.ts'. Waiting for file changes before restarting...` and stays alive, which is why my harness had to kill it by process group, and under `npm run dev:planner` `concurrently` would keep the web running and never report the api gone. The symptom to recognise is a quiet api with that line in its log, not an exit. Proposed disposition: reword to "fails on start and then waits for a file change", or leave; it misleads no one who greps for the error code. **Fixed:** the `// dev` key now says the server fails on start and `node --watch` sits waiting for a file change, here and in lg-12's.
- **dropped** · the `// dev` key's "a stale `dist` starts the server against a stale contract" looked unsupported for the planner, since it is borrowed from the downloader's evidence. Dropped after reproducing it for the planner (see (c)): the claim is true.
- **dropped** · `&&` in an npm script on Windows. The downloader's script has been the same shape since its fix, the Windows leg runs unit tests and never this script, and I did not run it on Windows: unverified, and not a defect on the evidence.
- **findings** · the hunt returned 6; 3 carried as bullets above, 2 dropped, 1 (the start-up race between the api's build and the web in `npm run dev:planner`) merged into the web bullet.

Pull request #365 on this head: `check` (twice), `codeql`, `CodeQL`, `dependency-review`, `docker` and `e2e` passed on `cc6f77c`. `test (ubuntu-latest)` and `test (windows-latest, informational)` were still pending when read; no `Done when` line is proven by them (the diff changes no source), but the unit matrix has not finished on this head.

NFR: security n/a (a script string and prose; the build spawns no user input) · performance ✓ (the build runs once before the watcher, not on each restart; an up-to-date `npm run build` took about 1 s, twice; cold, build plus start was 5 s) · reliability ✓ (removes a start failure and a silent stale-contract start; the two boundaries the `// dev` key names are measured above) · maintainability — the shape finding above.

Invariants skipped as untouched by the diff: tool imports, `AppError` taxonomy, shell and process trees, redaction, SSRF, progress, contract edits, test registration, `Dockerfile` workspace lists. The diff is `package.json`, one `CLAUDE.md` sentence and the ticket.

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
- 2026-10-06 — Gate 1 PASS at `cc6f77c`, three low findings. The owner chose
  record-only for the web dev server started alone, and a line in the
  `add-tool` skill over a source scan for the recurrence — after I had first
  told them, wrongly, that `add-tool` copies an existing `api/package.json`; it
  copies `errors.ts`, an e2e `tsconfig.json` and a `Dockerfile`, never the dev
  script, so the question was put again with that corrected. The `// dev`
  wording ("dies on start") was fixed.
