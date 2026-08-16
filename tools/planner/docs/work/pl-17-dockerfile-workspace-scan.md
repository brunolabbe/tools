---
id: pl-17
tool: planner
title: A Dockerfile's workspace list is maintained by memory
kind: chore
status: ready
milestone: null
depends_on: []
---

# pl-17 — Nothing checks that the image carries what the API imports

**Packages:** `packages/core` (the test), and both tools' `Dockerfile`s if it
finds anything

## Why

Each tool's `Dockerfile` lists its workspaces **by hand, twice** — the manifests
copied before `npm ci` in the build stage, and a `package.json` + `dist` pair per
workspace in the runtime stage. Both lists are prose. Nothing anywhere checks
either against what the API actually resolves at runtime, so adding a workspace
dependency to an `api` package silently costs two `Dockerfile` edits that no
compiler, linter or unit test will ask for.

**It has already happened.** [pl-16](./pl-16-the-plan-run.md) added
`@planner/itinerary` to `@planner/api` so the run orchestrator could compose a
plan. `npm run check` passed, 1,020 tests passed, and the container would not
boot:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@planner/itinerary'
  imported from /app/tools/planner/api/dist/runs/orchestrator.js
```

Three things make this worth a gate rather than a note:

**It is invisible until CI, and then it reads as something else.** The failure
surfaces in `.github/workflows/<tool>.yml`'s image job as thirty seconds of
`curl: (7) Failed to connect` and then "the service never became healthy", which
is what an infrastructure flake looks like. The actual error is one line at the
bottom of a log nobody opens first.

**The two lists fail differently, so fixing one is not fixing it.** Miss the
runtime pair and the image boots and throws on first use. Miss the build-stage
manifest and `npm ci` never created the workspace symlink, so there is nothing to
copy even if the runtime lines are right — the module was never installed at all.
A person who has just debugged the first will not necessarily find the second.

**The repo already owns the answer's shape.** `packages/core/test/spawn-safety.test.ts`
enforces a repo-wide rule — never invoke a shell — by reading source files as
text and failing in milliseconds. It was delivered under
[dl-6](../../../downloader/docs/work/dl-6-security-and-limits.md) even though it
lives in `packages/core` and covers every tool, which is the precedent this
ticket follows: the work is repo-wide, the ticket belongs to the tool that needed
it.

## Build

1. **The closure that must be in the image.** For each tool, start at
   `tools/<tool>/api/package.json` and walk `dependencies` through the workspace
   graph — `api` → `agent` → `contract` → `@webtools/core` — collecting every
   `@<tool>/*` and `@webtools/*` member. That is declarative, needs no build and
   no Docker, and is exactly the set Node has to resolve at runtime.
2. **Assert both lists against it, per tool and in both directions.** Every
   member of the closure has a build-stage manifest `COPY` and a runtime-stage
   `package.json` + `dist` pair; and every workspace named in either list is in
   the closure, so a workspace that stops being used stops being shipped.
3. **Close the hole under step 1.** A closure computed from `package.json` is
   only as good as those files, and pl-16 found `@planner/api` importing both
   `@planner/itinerary` and `@webtools/core` without declaring either — so the
   graph would have been wrong in exactly the case that matters. Assert
   separately that **every bare workspace specifier imported anywhere under
   `tools/*/*/src/**` is declared in that package's own `package.json`.** That is
   a hygiene rule worth having on its own, and it is what makes step 1 trustworthy
   rather than circular.
4. **Fix whatever it finds**, in both tools, in the same change.

Traps worth knowing in advance:

- **A subpath is not a package.** `@webtools/core/rate-limit` (pl-16) resolves
  through `@webtools/core`'s `exports` map and ships in that package's `dist`.
  Normalise a specifier to its package name before looking it up, or the scan
  reports a workspace that does not exist and blocks on it.
- **`web` is bundled, not resolved.** Vite inlines everything into
  `web/dist/app`, so the runtime never resolves a `@<tool>/*` specifier for it.
  The rule is about the API's resolution graph; `web`'s own two lines are a
  separate thing the Dockerfile does and are not this scan's business. Say so in
  the test rather than leaving a reader to wonder why `web` is exempt.
- **The two Dockerfiles are not the same file and must not become one.** The
  downloader's is built on Playwright's image and carries Chromium and ffmpeg;
  the planner's is a plain Node base and a twentieth of the size. Their workspace
  lists happen to have the same shape today, and the test must read each rather
  than assume one layout — the comment at the top of either file is explicit that
  sharing them is not wanted.
- **This does not replace the image gate.** A scan over text proves the list is
  complete; it cannot prove the image boots, that the native `better-sqlite3`
  binary matches its glibc, or that `/api/health` answers. Keep the workflow job.
  What this buys is that the _commonest_ way it fails is caught in seconds by
  `npm test` instead of in minutes by a container that will not start.
- **Do not make it clever.** `spawn-safety.test.ts` is the bar: read the files,
  match plainly, fail with a message naming the file and the missing line. A
  Dockerfile parser is a project; this is a scan.

## Done when

- Deleting either `itinerary` line from `tools/planner/Dockerfile` turns the
  suite red — the pl-16 regression, reproduced as a test rather than described.
- The same holds for a workspace removed from the downloader's Dockerfile, so the
  gate is not planner-only in principle and planner-only in practice.
- A workspace imported under `src` but undeclared in its `package.json` fails,
  with the package and the specifier named.
- The test needs no Docker, no build and no network, and runs in the `core`
  vitest project beside `spawn-safety.test.ts`.
- Both tools' Dockerfiles pass, or the change that makes them pass is in the same
  commit.
- `npm run check` and `npm test` pass.

## Log

_Not started._
