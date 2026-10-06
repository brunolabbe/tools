---
name: add-tool
description: Scaffold a new tool under tools/ — its contract, packages, tsconfig and vitest registration, CLAUDE.md, docs spine, CI workflow and release wiring. Use when adding a whole new tool to this repo, not when adding a package to an existing one.
disable-model-invocation: true
---

# Adding a tool

A seven-step procedure that runs roughly twice a year, so it lives here rather
than in every session's context. Work through it in order — steps 3 and 6 are
the ones that fail silently if skipped.


1. `tools/<name>/contract` — its types and its error catalog, built on
   `@webtools/core` (copy `tools/downloader/contract/src/errors.ts`, which is the
   worked example).
2. Its packages, scoped `@<name>/*`, each with a `tsconfig.json` referencing the
   ones it depends on. The `api`'s `dev` script builds before it watches —
   `npm run build && node --watch --import tsx src/main.ts`, with the `// dev`
   key from `tools/planner/api/package.json` saying why. Without it the API fails on start
   in any checkout that has never built, because `@<name>/contract` resolves to
   `dist/`; every tool so far shipped without it and was fixed by hand
   (#151, lg-12, pl-54).
3. Register each package's `src` project in the root `tsconfig.json`, and add a
   vitest project in `vitest.config.ts`. Its tests are already inside
   `tsconfig.tests.json`'s glob, so they need only a `references` entry there.
   A `web` package is the exception, and it announces itself: the glob picks its
   tests up too, and they fail loudly against the node surface — no DOM lib, no
   JSX. Give it its own `test/tsconfig.json` beside the downloader's, add its
   path to that glob's `exclude`, and reference it from the root. The `exclude`
   names `tools/downloader/web/test/**` and nothing wider on purpose — a pattern
   that pre-excluded every tool's `web` would drop a new one into no project at
   all, and pass green while checking nothing.

   An `e2e` package is the quieter exception: its specs are `*.spec.ts` and sit
   outside any `test/` directory, so the glob never sees them and nothing fails
   to tell you they are unchecked. Copy `tools/planner/e2e/tsconfig.json`, which
   also pulls in the tool's `playwright.config.ts` from a directory up, and add
   the reference from the root. Skipping this is silent, which is exactly why it
   is listed here.

   A new workspace also needs its entries in `package-lock.json`, and a
   worktree cannot `npm install` to write them. If you edit the lockfile by
   hand, check it with `node scripts/check-lockfile-sync.mjs`, not `npm ls`:
   the farm mirrors the shared checkout and lacks the new link, so `npm ls`
   reports the package missing (lg-1, 2026-10-01).

4. `tools/<name>/CLAUDE.md` — what the tool is, and only the rules specific to
   it. Do not restate anything on this page. Beside it, `tools/<name>/README.md`: what the
   tool does, how to run it on its own and how it deploys, with a table of its
   docs — the shape `tools/planner/README.md` has — plus a row in the root
   `README.md`'s tool table. The root README is what the tools share; a tool's own
   story never goes there.
5. `tools/<name>/docs/02-ROADMAP.md` and an empty `work/`, plus a row in
   [docs/00-TOOLS.md](../../../docs/00-TOOLS.md). The rest of the spine arrives when
   there is something true to put in it — a young tool with two documents is an
   honest young tool.
6. `.github/workflows/<name>.yml` for anything slow, path-filtered to that tool.
7. To make it releasable: `tools/<name>/Dockerfile`, a `version.txt`, and an
   entry in both `release-please-config.json` and
   `.release-please-manifest.json`: the manifest line at `"0.0.0"` and the config
   entry with `"initial-version": "0.1.0"`, or the first release is 1.0.0 — see
   [03-RELEASING](../../../docs/03-RELEASING.md). Nothing in `release.yml`
   changes — it builds whatever was released. Add the image gate in step 6 _before_ the first
   release, so that release is not the first time the image is built.

   Copy a `Dockerfile` from an existing tool and its two hand-kept workspace
   lists come with it. `packages/core/test/image-closure.test.ts` checks both
   against what your `api` actually resolves as soon as the file exists, so it
   will tell you what to delete and what you forgot — but **it finds your service
   by name, at `@<name>/api`**, and a tool that calls it something else has to
   teach the scan that; the test fails by name saying so. It also expects the two
   stages to be `AS build` and `AS runtime`. The scan proves the list, never the
   image: keep the workflow job.
