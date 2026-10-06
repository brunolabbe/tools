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

## Review

**Gate: PASS** — 2026-10-06 · `4907d9a..0085a39` · Sonnet 5.5, depth medium

The ticket was filed on this branch, so its brief was read from the branch's copy down to `## Log`. Three files changed: `tools/ledger/api/package.json`, `tools/ledger/CLAUDE.md` and the ticket. No source file and no test file is in the diff.

| Done when                                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. In a fresh worktree with no `tools/ledger/*/dist`, `npm run dev` in `tools/ledger/api` reaches `listening` and `/api/health` answers 200, where before it died with `ERR_MODULE_NOT_FOUND` | **verified** — nothing asserts it, and the ticket's Log says why (a test would pin the string). Re-run by the gate in its own worktree, detached at the head, after the farm and before any build (`ls -d tools/ledger/*/dist packages/*/dist` found none). **Before:** with the base's `package.json` (`"dev": "node --watch --import tsx src/main.ts"`) checked out over the branch's for the run, `npm run dev` died with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<worktree>/node_modules/@ledger/contract/dist/index.js' imported from <worktree>/tools/ledger/api/src/main.ts`, then `Failed running 'src/main.ts'. Waiting for file changes before restarting...` — the same failure the ticket quotes, so the harness can produce it (positive control). **After:** the branch's `package.json` restored, same tree, still no `dist`: `npm run dev` ran `tsc --build`, then logged `"msg":"listening"` with `"port":8100`. `GET /api/health` → `200 {"ok":true,"shuttingDown":false,...,"database":{"open":true}}`. `dist` then existed under `packages/core`, `tools/ledger/contract`, `tools/ledger/books` and `tools/ledger/api`. The server was stopped by its process group (`kill -TERM -- -<pgid>`) and port 8100 was free afterwards. |
| 2. `tools/ledger/CLAUDE.md` shows the `DEV_IDENTITY` command                                                                                                                                  | **verified** — the file carries `ACCESS_PEOPLE=alex@example.test=alex DEV_IDENTITY=alex@example.test npm run dev:ledger`. Run verbatim from the repo root: the API logged `DEV_IDENTITY is set; every request is this person and no token is read` and `listening`; `GET :8100/api/people` → `200 {"people":["alex"]}`; the same through Vite's proxy on `:5193` → `200`. Without the two variables, `GET /api/people` → `403 UNAUTHENTICATED`. That matches `api/src/config.ts`: `loadAccessConfig` reads `DEV_IDENTITY` and `ACCESS_PEOPLE`, lower-cases both, and `checkAccessConfig` requires the identity to be a key of `ACCESS_PEOPLE` and refuses it when `NODE_ENV=production`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. `npm run check` passes                                                                                                                                                                     | **verified** — exit 0 on the head after `npm run build` (oxlint: only warnings, none in a file this diff touches; `oxfmt --check`: "All matched files use the correct format" on 892 files; typecheck clean). CI's `check` jobs on this head also pass. Also run, unrequired: `vitest run --project ledger` 28 files, 392 of 392 tests; `vitest run --project core --project repo` 20 files, 537 of 537. Not run at the base: the diff has no source or test file, so a base run would measure nothing the diff changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Premise checks the dispatch asked for**

- **(a)** Reproduced above, both directions. The failure is on `origin/main`'s script and the fix removes it.
- **(b)** `tsc --build` in `tools/ledger/api` walks `core`, `contract` and `books`: `api/tsconfig.json` lists all three as `references`, and one `npm run build` from a tree with no `dist` produced `dist` in all three plus `api`.
- **(c)** The `DEV_IDENTITY` command matches `config.ts`; see row 2.
- **(d)** Every claim in the `// dev` note was tested against the ledger rather than read across from the downloader's. `@ledger/contract`'s `exports` resolve to `./dist/index.js` (read). A fresh tree dies with `ERR_MODULE_NOT_FOUND` (run). One command covers core, contract and books (run). A stale `dist` is rebuilt: appending `export const GATE_PROBE = 1;` to `tools/ledger/contract/src/index.ts` left `dist/index.js` at 0 matches, one `npm run build` in `api` made it 1, and after reverting the source another build made it 0 again. A `dist` deleted by hand is not restored: after `rm -rf tools/ledger/contract/dist`, `npm run build` in `api` exited 0 and `contract/dist` was still absent, because `tsconfig.tsbuildinfo` sits beside `tsconfig.json`, not inside `dist`. `npm run clean` then `npm run build` brought it back. "It runs once, so `node --watch` does not rebuild" is true by construction (`--watch` restarts the `node` child, not the npm script) and I did not run it.
- **The Log's claim about the web app** (`web` needs the contract's `dist`, a page requested before the build lands fails, a reload fixes it) holds: with `dist` cleaned and only Vite up, `GET :5193/src/inbox/Inbox.tsx` → `500` (`Failed to resolve entry for package "@ledger/books"`); after `npm run build` in `api`, the same request → `200`.

**Findings**

- **low** · no `Done when` line depends on it · `nfr:maintainability` — a reader who follows `tools/ledger/README.md` "Getting started" (`npm run dev:ledger`) still meets `403` on every route but health, and nothing there says why or points at `DEV_IDENTITY`. It is only in `.env.example` (which the README links for "settings") and now `tools/ledger/CLAUDE.md`. The ticket's Build step 2 scoped the change to `CLAUDE.md`, so this is outside the brief. Proposed disposition: record, or add one sentence to the README beside the `.env.example` link. Not a decision with two remedies that differ in cost. **Fixed** in the commit that records this gate: one paragraph under the README's command block, giving the `DEV_IDENTITY` command and pointing at `.env.example`.
- **dropped** · "the `// dev` note says a stale `dist` is 'worse' and, unlike the downloader's, cites no incident": the mechanism is true (a stale contract is emitted by the build and loaded from `dist` by node); only the word is a judgement. Not a defect.
- **dropped** · "the new paragraph in `tools/ledger/CLAUDE.md` sits between the command block and the sentence about ports that describes it": cosmetic, reads correctly.
- **dropped** · "`ACCESS_PEOPLE=… npm run …` is POSIX-shell syntax": it is the shape `.env.example` already uses, and the repo's Windows leg is informational. Not this diff's defect.
- **dropped** · "the ticket's `Why` cites `pl-54`, which is not on `main`": it exists as an open pull request (#365, `pl-54-dev-builds-first`) and is cited in prose, not through `depends_on` (`npm run status -- --json` exits 0). Not a defect.
- **findings** · the hunt returned 5; 1 carried, 4 dropped.
- **Unmeasured** · the owner's report that the failure occurred in the shared checkout at the base (relayed, I did not run there); `test (windows-latest, informational)` was still pending on the head when I read `gh pr checks 363` — not an acceptance line, and the script shape is the downloader's from #151; the cost of the added `tsc --build` on an up-to-date tree was not timed; the planner's sibling change (PR #365, pl-54) was not reviewed here.
- **Invariants** · walked, none touched: a tool imports nothing from another (the downloader is named in a prose comment only), `AppError`, no shell, redaction, SSRF, progress, contract edits, test registration, `Dockerfile` workspaces (no new dependency), style. The diff adds no source branch, so there is no source file lacking a test file.
- NFR: security ✓ (`DEV_IDENTITY` is dev-only and refused under `NODE_ENV=production`; the documented command does not change that) · performance — one more `tsc --build` per `npm run dev`, untimed · reliability ✓ (the start-up failure is gone; a stale `dist` is rebuilt) · maintainability — above.

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
- 2026-10-06 — Gate 1 PASS at `0085a39`. Its one low finding, the README's
  Getting started meeting a 403 with no word on why, was folded in: one paragraph
  naming the `DEV_IDENTITY` command. Nothing left to decide, so no ticket.
