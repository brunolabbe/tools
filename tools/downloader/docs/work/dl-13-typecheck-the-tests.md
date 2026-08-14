---
id: dl-13
tool: downloader
title: Bring the test files and the e2e specs into the typechecker
kind: chore
status: ready
milestone: null
depends_on: []
---

# dl-13 — The tests are not typechecked

**Area:** every `tsconfig.json` in the repo, plus `tsconfig.json` at the root
and whatever the fixes turn out to be under `test/`.

> **Why this is a downloader ticket.** The mechanism is repo-wide, the same way
> dl-10's was. `work/` exists only under a tool, and inventing a `repo-`
> namespace for the second time is worse than the precedent. The downloader owns
> it because it holds the largest untypechecked surface — 39 test files plus
> `e2e/` — and because [03-STATUS.md](../03-STATUS.md) is where the gap is
> written down. Applying the same pattern to `packages/` and to the planner is
> part of the ticket, not a follow-up: a convention that half the repo follows
> is not a convention.

## Why

Every project's `include` is `src/**`. Nothing else. So `npm run check` — which
is what the repo means by "done" — typechecks no test file in any workspace:

| Project                           | Test files |
| --------------------------------- | ---------- |
| `tools/downloader/api/test`       | 12         |
| `tools/downloader/engine/test`    | 12         |
| `tools/downloader/resolvers/test` | 7          |
| `tools/downloader/web/test`       | 7          |
| `tools/downloader/contract/test`  | 1          |
| `tools/downloader/e2e`            | 2          |

`e2e/` is in the worse position of the two: it is in no `tsconfig.json` at all,
and Playwright transpiles it without checking, so a selector helper that has
drifted from the component it selects fails after a browser has launched and a
clip has been segmented, rather than in a second at the terminal.

The cost is not hypothetical. `helpers.ts`, the fake clock, the fixture servers
and the fake binaries are _shipping code that only tests consume_ — a fake with
a signature that no longer matches the real thing silently tests nothing, and
that is exactly the failure a compiler catches for free. dl-12's log records
`ytdlp.ts` needing no code change but "never having been tested"; the same
blind spot applies one level up, to the tests themselves.

The repo already pays for the answer. `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` are on in `tsconfig.base.json`, and the test files
have never once been held to them.

## Build

1. **A test project per package.** `<package>/test/tsconfig.json`, extending
   `tsconfig.base.json`, including `test/**/*.ts` (`.tsx` too where the package
   has React — see dl-15), and referencing its own `src` project plus whatever
   else its tests import. Register each in the root `tsconfig.json` so
   `tsc --build` reaches them and `npm run check` stays the single gate. Do not
   add a second npm script: a check someone has to remember to run is a check
   that does not run.
2. **Decide the emit question and write it in the Log.** `tsc --build` wants
   composite projects, composite wants declarations, and nothing should be
   emitting `.d.ts` for a test file. Whatever you choose — a throwaway `outDir`
   that `.gitignore` covers, or whatever the pinned TypeScript (7.x, the native
   compiler) supports for a checked-but-not-emitted project — say which and why,
   because the next person will be tempted by the other one. What is not
   negotiable: no test artefact reaches a package's published `dist`, and
   `npm run build` does not get slower.
3. **`e2e/` gets one too**, with `@playwright/test` types and the `web`
   project's DOM lib. It references `engine` — `hls-origin.ts` imports
   `resolveFfmpegPath` — so it is a real consumer of the build graph, not a
   loose folder.
4. **Fix what it finds, without weakening anything.** Expect a pile of
   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` failures; they
   are the point. Do not add `any`, do not relax a compiler option for tests,
   and do not sprinkle `!` to make the list go away — an index that a test knows
   is populated is a test that should assert it is populated. Where a test
   deliberately passes a wrong-typed value to prove a guard rejects it, cast at
   that one call with a comment saying so.
5. **`scripts/test/` is a judgement call.** The `repo` vitest project tests
   `scripts/commit-message.mjs`, which is plain `.mjs` and deliberately outside
   the `tsc --build` graph. Either bring the test in with `allowJs` and no
   `checkJs`, or leave it out on purpose. Either is defensible; leaving it out
   silently is not.
6. **Then the other workspaces**, `packages/core` and every `tools/planner/*`,
   by the same pattern. If the pattern does not transfer, the pattern is wrong.

**Traps.**

- Tests import `test`/`expect` from `vitest` explicitly — globals are off — so
  no ambient type package is needed and none should be added. If a test project
  needs `types: ["vitest/globals"]`, something has gone wrong upstream of it.
- Relative imports carry `.ts` extensions (`allowImportingTsExtensions` plus
  `rewriteRelativeImportExtensions`); test projects inherit that from the base
  and must not fight it.
- `web` is `moduleResolution: "Bundler"` and `emitDeclarationOnly` while every
  other project is `NodeNext`. Its test project has to follow `web`, not the
  base's default.
- A test that imports a sibling package's _test_ helper is the one import this
  should not make easy. If one exists, that is a finding for the Log.

## Done when

- `npm run check` typechecks every file under every `test/` directory and under
  `e2e/`, and fails when a test does something the compiler should refuse.
- Proved by doing it rather than asserted: break a fake's signature, run
  `npm run check`, watch it fail, put it back.
- `npm test` and `npm run e2e:downloader` pass unchanged — this ticket fixes
  types, not behaviour. Any test whose _behaviour_ had to change is called out
  in the Log, because that means it was passing for a reason nobody knew.
- `npm run build` emits nothing new into any package's `dist`.
- The "test files are still not typechecked" entry in
  [03-STATUS.md](../03-STATUS.md) is gone rather than reworded.

## Log

_Not started._
