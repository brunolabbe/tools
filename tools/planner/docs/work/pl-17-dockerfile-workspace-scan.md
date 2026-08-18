---
id: pl-17
tool: planner
title: A Dockerfile's workspace list is maintained by memory
kind: chore
status: done
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

### 2026-08-18 — the gate is in, and it found nothing to fix

`packages/core/test/image-closure.test.ts`, beside `spawn-safety.test.ts` and in
the `core` vitest project. Six tests, no Docker, no build, no network, ~30ms.

#### What it asserts

- **The closure**, walked from `tools/<tool>/api`'s own manifest through
  `dependencies` — `api` → `agent` → `contract` → `@webtools/core` — with only
  workspace-scoped members kept.
- **The build-stage manifest list**, scoped to the lines _before_ `RUN npm ci`.
  That boundary is the whole point rather than a convenience: the build stage
  copies `tools/<tool>` wholesale further down, so every manifest is present by
  the end regardless — but `npm ci` is what creates the workspace symlinks, and
  it only sees what was copied before it ran. A check over the whole stage would
  have passed on the exact file that broke pl-16.
- **The runtime-stage pair** — `package.json` and `dist` — per closure member.
- **The reverse direction**, per stage: a workspace named in either list that is
  not in the closure fails, so one that stops being used stops being shipped.
- **The hygiene rule under it**: every `@webtools/*` / `@<tool>/*` specifier
  quoted anywhere under a workspace's `src` is in that package's own
  `dependencies`.

#### What the brief got right, and the one thing it did not anticipate

Every trap it names was real and every one of them was hit. The subpath case is
live — `@webtools/core/rate-limit` appears in `api/src` and normalises to
`@webtools/core`. `web` is in both Dockerfiles' lists and in neither closure, so
without the exemption the reverse direction fails on both tools; it is exempted
by name, in the type, with the reason beside it.

What the brief did not anticipate: **`dependencies` and not
`devDependencies`, and the reason is specific rather than stylistic.** The
runtime stage is built after `npm prune --omit=dev`, so a workspace import
declared as a dev dependency resolves in the repo, in CI and in the build stage
and is missing from the image _alone_ — the same failure as pl-16's with one
fewer place to notice it. `@planner/agent` depends on `@planner/itinerary` this
way today and legitimately: two test files use it and no production file does,
which is exactly why the scan reads `src` and not `test`.

#### It found nothing, and that is the honest outcome

Build step 4 says "fix whatever it finds", and it found nothing: pl-16 had
already fixed the planner by hand, and the downloader was correct. **So the value
here is entirely prospective**, and the only way to say anything true about a
gate that passes on arrival is to break the thing on purpose. Five mutations,
each reverted:

| Mutation                                                         | Result                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| drop `itinerary`'s `dist` from the planner's runtime stage       | ✅ red, naming the exact missing line                                            |
| drop `itinerary`'s manifest from before `npm ci`                 | ✅ red, the pl-16 regression proper                                              |
| drop `resolvers` from the downloader's Dockerfile                | ✅ red, three lines across both stages                                           |
| add `tools/planner/e2e` to the build-stage list                  | ✅ red, reverse direction                                                        |
| delete `@planner/itinerary` from `@planner/api`'s `package.json` | ✅ red: `orchestrator.ts imports @planner/itinerary, undeclared in @planner/api` |

The last one fails **two** tests, not one — with the dependency undeclared the
closure shrinks, so the Dockerfile's correct `itinerary` lines start reading as
stale. Both messages are true and the undeclared one names the cause, so this is
left as it is rather than papered over with a skip; a reader who sees only the
"ships a workspace the API does not resolve" failure should look above it.

#### What it does not do, kept deliberately

It is a scan, not a Dockerfile parser: lines are whitespace-normalised, filtered
to `COPY`, and matched as strings. It does not resolve `ARG`s, understand
`--from` targets beyond the literal `build`, or know a stage graph — it finds
`RUN npm ci` and `FROM … AS runtime` by regex and asserts both exist, which is
the one structural assumption and it fails loudly rather than silently if a
Dockerfile stops holding it.

**The image gate stays.** `.github/workflows/<tool>.yml` still builds, starts and
curls each container. This catches the commonest failure in seconds; it cannot
prove the native `better-sqlite3` binary meets its glibc or that `/api/health`
answers. A pointer to the test is now in both Dockerfiles, beside the hand-kept
lists, so the next person to add a workspace finds it where they are already
looking.

#### Green

`npm run check` passes. `npm test` is 1,098 tests across 80 files.
