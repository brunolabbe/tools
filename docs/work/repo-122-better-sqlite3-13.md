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
    Linux, Node 22.23.3, against the 13.0.3 binary.
  - **Not verified here, left to the draft's checks:** the Windows CI leg (repo-93's
    sqlite file tests), and the three container builds (`downloader.yml`, `planner.yml`,
    `ledger.yml`), which are the only readings of the `win32-x64` prebuilt and of the
    Linux prebuilt against each image's glibc. No Dockerfile line changed: each `npm ci`
    stage still carries the python3/make/g++ toolchain as the compile fallback, and the
    comments there ("its fallback when no prebuilt binary fits is a compile") stay true.
  - **Fold-in:** none. The `.devcontainer/Dockerfile` comment about the node-gyp fallback
    and the Dockerfile comments still describe the fallback correctly.
