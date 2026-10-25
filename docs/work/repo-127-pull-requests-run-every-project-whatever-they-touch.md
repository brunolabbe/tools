---
id: repo-127
tool: repo
title: Pull requests run every tool's suite whatever they touch, and the downloader's is 77 % of it
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-127 — Pull requests run every tool's suite whatever they touch

## Why

The test-suite audit of 2026-10-25 measured CI at `origin/main@d163853d` (run
`40210503276`, the latest `main` push whose matrix ran):

- `npm test` takes 265 s on `ubuntu-latest` and 380 s on `windows-latest`. Summed
  test time is 815 s on ubuntu, and **the downloader is 631 s of it**.
- Ubuntu is bound by total work (~1004 worker-seconds across 4 workers ≈ 251 s),
  not by its longest file (51 s). So removing a whole project removes its
  seconds from the wall clock almost one for one.
- Of the last 100 commits on `main`, 49 were documentation only and the matrix
  already skips them. Of the 51 code commits, **37 touched neither
  `tools/downloader/` nor shared config** (`packages/`, root `package*.json`,
  `tsconfig*`, `vitest.config.ts`, `.github/`). For those, the ubuntu `npm test`
  step would drop from ~266 s to ~55 s.

Separately, `scripts/test/status.test.ts` runs **twice** on every ubuntu run:
once in `ci.yml`'s `check` job (`npx vitest run scripts/test/status.test.ts`,
for repo-97's reason), and again in the matrix's `npm test`. That is ~7 s.

## Decision — answered 2026-10-25 by the owner

Options put: (a) filter projects on `pull_request` and keep the full suite on
`push` and `schedule`; (b) shard the ubuntu leg in two instead (~130 s sooner to
green, one extra 61 s setup per run, no loss of coverage); (c) both; (d) neither.
**Chosen: (a).** Sharding was not chosen and is not part of this ticket.

## Build

1. In `ci.yml`'s `changes` job, after the existing markdown rule, compute a
   project list for `pull_request` events and output it (for example
   `projects=core repo planner`). On `push`, `schedule` and `workflow_dispatch`,
   and whenever there is no usable diff base, output the full set. That path is
   already there for the markdown rule; reuse it.
2. Take the mapping from `scripts/preflight.mjs`, which already encodes it:
   `testPlan` (`:596`), `sharedConfigTouched` (`:220`), `scriptsTouched`
   (`:245`), and core added after any tool or `scripts/` change (repo-90). Call
   it rather than copying it, so the two cannot drift. If it cannot be called
   from the workflow as it is, export a small CLI entry from `preflight.mjs`
   and test that entry.
3. Widen `sharedConfigTouched` to cover `.github/**`. Today it does not, and a
   workflow change must run everything.
4. The matrix's test step runs `npm test -- --project <p>` for each listed
   project. **An empty list must never mean "ran nothing, green".** A code
   change always yields at least `core`.
5. Before relying on the rule, prove that a tool importing another tool fails
   somewhere. CLAUDE.md states the rule, but this audit did not find what
   enforces it. If nothing does, add the check (a source scan alongside
   `packages/core/test/image-closure.test.ts` is the house pattern) in this
   ticket. Project filtering is only sound if a cross-tool import cannot merge
   unseen.
6. Exclude `scripts/test/status.test.ts` from the matrix's run, since `check`
   always runs it. Keep it in the `repo` project for local `npm test`. A
   `--exclude` on the CI command is enough; do not drop it from
   `vitest.config.ts`.
7. Keep the Windows leg on the same project list as ubuntu.

## Done when

1. A pull request touching only `tools/planner/**` runs the `core`, `repo` and
   `planner` projects and no others: a test drives the mapping, and the
   `changes` job's output on a probe branch shows it.
2. A pull request touching `packages/**`, root config or `.github/**` runs every
   project (test).
3. `push` to `main`, the nightly `schedule` and `workflow_dispatch` run every
   project. Read from `ci.yml`, plus a test if the logic lives in a script.
4. A change of code with no diff base runs every project.
5. A cross-tool import (for example `@downloader/contract` imported from
   `tools/planner`) fails a test that runs on every pull request.
6. `status.test.ts` runs once per ubuntu CI run, not twice.

## Log

- 2026-10-25: Filed from the test-suite audit. The full report, with every
  measurement, was in the filing session's scratchpad and is summarised here and
  in [repo-128](./repo-128-repo-and-core-tests-spawn-what-they-could-import.md)
  and [repo-129](./repo-129-every-test-file-reimports-its-module-graph.md).
- 2026-10-25: Built on `repo-127-ci-project-filter` from `7f8d7f48`.
  `ci.yml`'s `changes` job now also outputs `projects`, read from
  `node scripts/preflight.mjs --ci-projects` (diff paths on stdin) on a pull
  request and from `--ci-projects --all` on every other event and every
  no-base fallback. The matrix runs `npm test -- --project <p>...` on that list,
  under `shell: bash` on both legs, with `--exclude scripts/test/status.test.ts`.
  An empty list is refused twice, once in `changes` and once in the test step.
  `projectsFor` in `preflight.mjs` is the one mapping, and `testPlan` calls it
  too. `packages/core/test/tool-isolation.test.ts` is the cross-tool scan.

  **What the brief had wrong:**
  - Build 2 said preflight's mapping "already encodes" the answer Done when 1
    names. It did not: `testPlan(["tools/planner/api/src/a.ts"])` planned
    `planner` and `core`, with no `repo`. `repo` belongs on that list because
    `scripts/test/preflight.test.ts` reads every tool's real package layout
    (`packageGraph(REPO_ROOT, …)` and `testPlan(…, REPO_ROOT)` on the
    downloader, the planner and the ledger), so a tool change can break it.
    Now `projectsFor` adds `repo` beside `core` after any tool change, locally
    as well, so the two cannot drift. The local cost is
    `npx vitest run --project repo` → `14 passed (14)`, `616 passed (616)`,
    18 s. Four existing `testPlan` expectations gained the `repo` row.
  - Build 3 widened `sharedConfigTouched` by `.github/**` alone. That leaves
    paths that suites read running fewer projects than reach them:
    `hooks.test.ts` reads `.claude/hooks/` and `.claude/settings.json`,
    `commit-message.test.ts` reads `release-please-config.json`,
    `cloudflare-setup.test.ts` and the downloader's
    `ytdlp-in-the-image.test.ts` read the root `compose*.yaml`, and
    `spawn-safety.test.ts` scans every tracked source file (`.claude/**/*.mjs`
    included). So `sharedConfigTouched` now fires on `packages/` and on every
    non-markdown path outside `tools/` and `scripts/`. The cost, measured over
    the last 100 first-parent commits of `main` (scratch script
    `history.mts` at `7f8d7f48`): 51 docs-only, 17 that run every project,
    32 filtered, and 28 of those 32 skip the downloader. A named list plus
    `.github/**` would have run every project on 7 of them (4
    `package-lock.json`, 3 `.github/workflows`). The other 10 are 6 release
    commits (`.release-please-manifest.json`), 1 `.env.prod.example`, 1
    `.devcontainer/Dockerfile` and 2 under `.claude/`. Every one of them runs
    every project today too.
  - Build 5's premise holds: nothing enforced the rule. With
    `import type { AppError } from "@downloader/contract"` planted in
    `tools/planner/api/test/helpers/`, `npx vitest run --project core` →
    `Tests  1 failed | 93 passed (94)`, and the one failure was the new
    `tool-isolation.test.ts`. `image-closure.test.ts` reads only `src`, and it
    asks only that an import be declared. The same plant under
    `tools/planner/api/src/` fails the new scan with
    `tools/planner/api/src/zz-repo127-probe.ts:1 imports @downloader/contract, which is tools/downloader's`.
    It passes once the plant is removed (`9 passed (9)`).

  Build 6: `npx vitest list --filesOnly` lists 314 files, and 313 with
  `--exclude scripts/test/status.test.ts`, none of them under `node_modules`.
  The matrix's exact command shape, run locally through the test gate
  (`npm test -- --project core --project repo --exclude scripts/test/status.test.ts`)
  → `Test Files  22 passed (22)`, `Tests  570 passed (570)`.

  The new `preflight.test.ts` cases sit just before the file's last test,
  not after it, because that test says it must stay last. They do not touch
  `makeRepo` or `makeTitleRepo` (repo-128's seam). The `changes`-step case
  cuts the `run: |` block out of the real `ci.yml` and runs it with bash in a
  temporary repository, once per event. It is skipped on Windows, where bash
  could resolve to WSL's, and the job runs only on ubuntu.

  Fold-in: none came free. The root `CLAUDE.md` line "CI runs lint, typecheck
  and every unit suite on every push" is still literally true, since `push` is
  `main` only. It is not edited here, and the report proposes a rewording.
