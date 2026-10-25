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
