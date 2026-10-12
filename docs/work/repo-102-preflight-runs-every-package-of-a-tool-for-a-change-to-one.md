---
id: repo-102
tool: repo
title: Preflight runs every package's tests in a tool when only one package and its dependents can be affected
kind: work-package
status: ready
milestone: null
depends_on: [repo-101]
difficulty: standard
---

# repo-102 — Preflight runs every package of a tool for a change to one

## Why

This follows [repo-101](./repo-101-preflight-runs-a-tools-whole-suite-for-a-markdown-only-change.md).
Preflight scopes tests by tool, and almost all of the cost is inside one tool.
CI run 38203804906 (2026-10-12) gives the summed test time per project:

| Project    | Summed test time |
| ---------- | ---------------- |
| downloader | 1,150 s          |
| repo       | 53 s             |
| planner    | 17 s             |
| ledger     | 17 s             |
| core       | 3 s              |

Within the downloader:

| Package   | Summed test time |
| --------- | ---------------- |
| resolvers | 741 s            |
| engine    | 218 s            |
| api       | 180 s            |
| web       | 10 s             |
| contract  | 0 s              |

Each `package.json` declares the dependencies between packages:

- `api` depends on `contract`, `engine` and `resolvers`;
- `engine`, `resolvers` and `web` each depend on `contract`.

So an api-only change can only break api's tests. It pays 1,150 s today and
would pay 180 s. A web-only change would pay 10 s.

**The measured effect.** For each of the 82 downloader commits on `main` since
2026-09-01 that changed `src/` or `test/`, the audit summed the test time of
the packages changed plus their reverse dependencies. Summed over all 82,
the local test time drops by about 43%:

| Change             | Commits | Before       | After               |
| ------------------ | ------- | ------------ | ------------------- |
| resolvers only     | 19      | 1,150 s each | 921 s each          |
| api only           | 17      | 1,150 s each | 180 s each          |
| touches `contract` | 17      | 1,150 s      | 1,150 s (unchanged) |

**The owner chose this on 2026-10-12.** CI keeps running everything, so a
coupling this graph misses shows up red on the pull request rather than
reaching `main`.

## Build

1. **Derive the graph, do not write it out.** For each tool, read
   `tools/<tool>/*/package.json`, and take the edges from its `dependencies` on
   the tool's own `@<tool>/*` workspaces.
   - Add an edge for any **test import across packages** that the declarations
     do not cover. Today `api` tests import `../../engine/test/helpers/media.ts`;
     api already depends on engine, but the scan must not rely on that. Scan
     `test/**` for relative imports into a sibling package.
   - A test that reads a sibling's fixture by path, not by import, is invisible
     to the scan. Grep for those, and record what you found in the Log.
2. **Plan.** The affected packages are the packages changed, plus all their
   transitive reverse dependencies. Run them as
   `npm test -- --project <tool> <tool path>/<pkg>/test ...`, or whatever
   filter shape vitest 4 accepts with `--project`. Prove that the filter
   actually narrows the run, with a test count.
3. **Fail open to the whole tool.** A path under `tools/<tool>/` that belongs
   to no package widens the plan back to `--project <tool>`. Examples:
   `Dockerfile`, `playwright*.config.ts`, `e2e/`, a tool-root `tsconfig`.
   `.md` paths are already ignored by repo-101. **Never narrow on an unknown
   path.**
4. **Check the guard.** Preflight refuses to spawn any `npm` command it does not
   recognise (repo-82, the `canonicalize`/`COVERED` logic). Check that the new
   command shape passes it, and that `deriveExtraCiCommands`' test still pins
   its output.
5. **Generic, not downloader-only.** Planner and ledger have
   `api`/`contract`/`web` packages too. The same derivation applies to them
   unchanged.
6. **Tests** in `scripts/test/preflight.test.ts`, against a fixture tool tree:
   - a change to the leaf package (api) plans only api;
   - a change to `contract` plans every package;
   - a change to `engine` plans engine and api;
   - a tool-root path plans the whole tool;
   - an undeclared cross-package test import adds its edge.

## Done when

1. For `origin/main`'s downloader:
   - an api-only diff plans api's tests and not resolvers';
   - a `contract` diff plans all five packages.
     Tests prove both against the real `package.json` files, not only against a
     fixture.
2. Any path that belongs to no package plans the whole tool, and a test proves
   it.
3. The Log records how preflight's test step changed on one real api-only
   branch: its wall time and test count, before and after.

## Log

- 2026-10-12 — Filed from the suite-speed audit. vitest's own `--changed` was
  considered and not proposed: it follows the import graph only, so it misses
  fixture HTML, media files and config, which this repo's tests read by path.
