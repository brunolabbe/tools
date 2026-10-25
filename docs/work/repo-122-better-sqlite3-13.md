---
id: repo-122
tool: repo
title: Move better-sqlite3 to 13 and its types to 9 in the three APIs
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-122 — better-sqlite3 13 and @types/better-sqlite3 9

## Why

All three APIs declare `better-sqlite3 ^12` (12.11.1 installed) and
`@types/better-sqlite3 ^7` (7.6.13). 13.0.0 shipped 2026-07-21 (13.0.3 latest) and
the types jumped to 9.6.0 on 2026-08-01. It is a native module: a major can change
the Node ABI it builds against, its prebuilt binaries and the build step in each
API's `Dockerfile`, so the container build is part of the test, not an
afterthought.

## Build

1. Read the 13.0.0 release notes; note any change to supported Node versions,
   prebuilt platforms, or the API this tree calls (`grep -rn better-sqlite3
   tools/*/api/src`).
2. Bump both packages in the three `package.json` files together.
3. `npm test` for all three tools, then build each tool's image (its
   `.github/workflows/<tool>.yml` container job is the reference) — the
   `image-closure` rule applies if the build step changes.
4. The Windows CI leg has a history with the sqlite file tests (repo-93); read its
   result rather than assuming Linux speaks for it.

## Done when

- One better-sqlite3 13.x and one @types/better-sqlite3 9.x in the lockfile; all
  three tools' suites and container builds pass, Windows leg included.

## Log

- 2026-10-24: filed from the dependency audit.
- 2026-10-25: built. Bumped `better-sqlite3` to `^13.0.3` and `@types/better-sqlite3` to
  `^9.6.0` in the downloader, planner and ledger `api/package.json`. The week-old rule
  holds: 13.0.3 was published 2026-08-05, types 9.6.0 (the only 9.x) 2026-08-01, and the
  one new transitive entry, `node-addon-api` 8.9.2, 2026-08-12 (cutoff 2026-10-18).
  - **Release notes (v13.0.0 to v13.0.3, GitHub releases page)** list no breaking change
    and no removed API. It is the first N-API release; `prebuild-install` is gone and the
    prebuilt binaries ship inside the package (`node_modules/better-sqlite3/prebuilds`
    holds `linux-x64`, `linuxmusl-x64`, `linux-arm64`, `win32-x64` and the macOS ones);
    a platform with no prebuilt still compiles. New: `db.explain()` and
    `statement.toString()`. `engines.node` goes from `20.x || 22.x || ...` to `>=22`,
    which this repo's `>=22.0.0` and CI's `node-version: 22` already satisfy. The notes
    do not state the glibc the Linux prebuilt needs; that is unmeasured here.
  - **The lockfile** loses `prebuild-install` and its dependency tree (`bindings`, `node-abi`,
    `tar-fs`, `rc`, ...) and gains `node-addon-api`. npm 10.9.9 placed the new
    `better-sqlite3` and `@types/better-sqlite3` nested under each of the three `api`
    directories (three copies, against the Done-when's "one"); npm 11.21.1
    (`npx -y npm@11.21.1 install --package-lock-only --ignore-scripts`) hoists them to
    the root, one 13.0.3 and one 9.6.0, and `node scripts/check-lockfile-sync.mjs`
    (which regenerates with npm 10) passes on that result, so the hoisted shape is stable.
  - `npm audit --package-lock-only`: one high, `node-forge` (no fix; filed as dl-132),
    unchanged by this branch.
  - **Source:** no `src` change. `npm run check` exit 0 and
    `npm test -- --project downloader --project planner --project ledger` exit 0
    (291 files passed, 1 skipped of 292; 6220 tests passed, 2 skipped of 6222), on
    Linux, Node 22.23.3, against the shipped prebuilt (installed with `--ignore-scripts`, no compile).
  - **The draft's checks (PR #636, head 0cf0f4d3) refuted the premise that 13 installs
    from a prebuilt binary.** `npm ci` compiles `better-sqlite3` 13.0.3 from source on
    every install, because the package ships no `install` script and carries a
    `binding.gyp`: npm then runs its default `node-gyp rebuild` unless the package's
    `package.json` says `"gypfile": false`, which 13.0.2 added. A fresh `npm install`
    reads that field from the registry manifest and skips the compile; a lockfile-driven
    `npm ci` builds its nodes from the lockfile, which has nowhere to record `gypfile`,
    and compiles. Reproduced outside the repo, in a directory holding only
    `{"dependencies":{"better-sqlite3":"13.0.3"}}`: `npm install --foreground-scripts`
    prints no gyp output; after `rm -rf node_modules`, `npm ci --foreground-scripts`
    prints `better-sqlite3@13.0.3 install` / `node-gyp rebuild` on npm 10.9.9 and on
    npm 11.21.1 alike. `npm ci --ignore-scripts` does not compile and the package then
    carries its `prebuilds/` (`linux-x64.node` among them), but that flag also skips every
    other package's install script.
  - **What that did to the checks** (`gh pr checks 636`): `docker` for the downloader
    failed at `RUN npm ci` with `gyp ERR! stack Error: not found: make` (its base is
    Playwright's `noble` image, which has no compiler; the planner and ledger images are
    the full `node:` image and passed, compiling); `test (windows-latest, informational)`
    failed in `Run npm ci` with `gyp ERR! stack Error: Could not find any Visual Studio
    installation to use`, so no Windows test ran; `test (ubuntu-latest)`, `check`,
    `e2e`, `dependency-review` and CodeQL passed. So the Linux suites ran against a
    binary compiled on the runner, and the prebuilds that 13 ships were never loaded by
    any CI leg.
  - **Not fixed on this branch**; the way out is a choice, put to the orchestrator in the
    report (hand-adding `"gypfile": false` to the lockfile entry does stop the compile
    in the experiment above, but npm drops the field on the next `npm install
    --package-lock-only`, which is the command that script regenerates with; unrun against the edited lockfile).
  - **Fold-in:** none made; the `.devcontainer/Dockerfile` and `Dockerfile` comments
    about the compile fallback are unchanged and are now the path every install takes.
