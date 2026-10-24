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
