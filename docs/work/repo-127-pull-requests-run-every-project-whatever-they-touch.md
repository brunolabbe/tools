---
id: repo-127
tool: repo
title: Pull requests run every tool's suite whatever they touch, and the downloader's is 77 % of it
kind: chore
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-25 · `7f8d7f4..80ee730` · Sonnet 5.5, depth full

Range `7f8d7f48...80ee7306`, two commits on the base (merge-base is the base sha). Pull request #658's checks were read at `80ee7306`: `changes`, `check`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `CodeQL`, `docker`, `e2e` all pass. Not run here: PowerShell (`pwsh` is not installed), and a runner's `$GITHUB_OUTPUT` semantics.

| Done when                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A pull request touching only `tools/planner/**` runs `core`, `repo`, `planner` and no others | `scripts/test/preflight.test.ts` › "projectsFor runs a planner-only change on core, repo and planner and nothing else (repo-127)" ✓ and › "ci.yml's changes step filters a pull request and runs every project on push, schedule and no base (repo-127)" (asserts `projects=planner repo core`) ✓. Probe #659's `changes` log (run 40223951225) printed `Projects: planner repo core` and its ubuntu step ran `--project planner --project repo --project core` (106 files, passed) ✓ |
| 2. `packages/**`, root config or `.github/**` runs every project                                | `preflight.test.ts` › "projectsFor runs every project for packages/, root config, .github/ and any path no tool owns (repo-127)" ✓; #658's own `changes` log, diff naming `.github/workflows/ci.yml` and `packages/…`, printed `Projects: core repo downloader ledger planner` ✓                                                                                                                                                                                                      |
| 3. `push`, `schedule`, `workflow_dispatch` run every project                                    | the `changes`-step case in `preflight.test.ts` (the test named in row 1) asserts the full list for `push`, `schedule` and `workflow_dispatch`; mutation "filter on every event" turns it red. `ci.yml`'s `on:` block names exactly those four events ✓                                                                                                                                                                                                                                |
| 4. A change of code with no diff base runs every project                                        | the same test: empty base on `schedule` and `workflow_dispatch`, all-zero `push` base, and an absent commit as a `pull_request` base each answer the full list; mutation "no-base branch forgets `projects=`" turns it red ✓. (The dispatch pairs "empty list never green" with this line; the ticket's line 4 is the no-base one and the empty-list rule is Build 4, graded in the second finding.)                                                                                  |
| 5. A cross-tool import fails a test that runs on every pull request                             | `packages/core/test/tool-isolation.test.ts` › "no source file or manifest reaches into a tool it is not part of" ✓. Positive control: an untracked `import type … from "@downloader/contract"` in `tools/planner/api/src` → `1 failed                                                                                                                                                                                                                                                 | 8 passed (9)`, naming the file; removed, `9 passed (9)`. `core` is in every list (mutation "drop core" fails 4 tests); the spec ran in both legs of #658 ✓ |
| 6. `status.test.ts` runs once per ubuntu CI run                                                 | `preflight.test.ts` › "ci.yml runs status.test.ts once, in check, and the matrix runs changes' list without it (repo-127)" ✓ (mutations dropping `--exclude` from either leg fail it); #658's logs: `check` ran `scripts/test/status.test.ts` (147 tests), the ubuntu matrix ran 314 files and none is that file ✓                                                                                                                                                                    |

- **low** · `nfr:security` · no `Done when` line depends on it · The project list is built from directory names under `tools/` and written to `$GITHUB_OUTPUT`, to vitest's argv and, on Windows, to `npm.cmd`, with no check on the characters. Run on the real `changes` and matrix-bash steps in temp repos: `x;touch pwn`, `$(id)` and a backtick name stay literal arguments and no file is created; an injected vitest flag fails closed, because every name follows `--project` and vitest dies `project.startsWith is not a function` (exit 1); but a directory whose name holds a newline puts a second line in `$GITHUB_OUTPUT` (`tools/z⏎code=false/` → outputs `code=true`, `projects=… z`, `code=false`; `tools/z⏎projects=core/` → matrix `--project core` only). Whether a later duplicate overrides is the runner's rule and was not measured here. A name with `&` into `npm.cmd` (a batch file) is **unmeasured**. Graded `low` on a premise: the pull request's own workflow and `scripts/` already run from its merge commit, so a hostile author gains nothing a `ci.yml` edit does not give (no secrets on these jobs). Direction, not a remedy: reject any `tools/` name outside a conservative charset in `allProjects` and in the touched-tool set, treating an unknown name as every project, and write the output with the delimiter form.
- **med** · no `Done when` line depends on it · The empty-list guards, Build 4's own words ("must never mean ran nothing, green"), and the Windows argument mapping are pinned by no test. Mutations in place on the detached tree, `-t repo-127`: deleting the `changes` step's `-z "${projects}"` guard, the bash matrix guard, or the PowerShell guard each leave `7 passed`; replacing the PowerShell `$projectArgs` line with the first project only also leaves `7 passed`. The guards do work (run by hand: `PROJECTS=""`, spaces, a lone newline → `::error::changes reported a code change and no project to test`, exit 1; `PROJECTS` unset → `unbound variable`, exit 1), but the shipped comment "no path through this job can run nothing and pass" is a guarantee only a reader's trust holds up. The PowerShell leg's guard was not run anywhere (no `pwsh`; #658's leg ran the full five-project list only, not a subset or an empty one). Fix direction: a case in the `changes`-step test with a non-markdown diff whose answer is empty, and one run of each matrix step's script with an empty value.
- **low** · `nfr:reliability` · Path text is read two ways, and two of the three results are off the owner's rule (i). (a) `git diff --name-only` quotes a non-ASCII path (core.quotePath), so `"tools/planner/caf\303\251.ts"` starts with `"` and reads as outside `tools/`: every project, where rule (i) says `planner repo core` (with `-c core.quotePath=false`, it does); `docs/café.md` alone is `code=true` and every project, where a markdown path should skip (the shell's `.md$` test is the old rule's, so the matrix ran before too). Wider, the safe direction. (b) `ciProjects` trims each line: a directory named ` tools` (leading space) holding `x.ts` answers `planner repo core`, where rule (i) says every project. The one narrowing; `core` still runs. Tracked paths today: 0 non-ASCII, 0 with leading or trailing space. No live call site.
- **low** · `nfr:reliability` · Where the shell and the script disagree about "markdown", the answer is an empty list and a red `changes` job, not a skip: `tools/foo.json` (a file directly under `tools/`) and `docs/note.md␠` (trailing space) both exit 1 with `::error::non-markdown paths changed, and --ci-projects named no project`. Fail-closed, as Build 4 wants, but `projectsFor`'s own comment, "An empty list means every path was markdown, and nothing else", is false for them (false in the safe direction), and a legitimate change would be blocked with that message. Tracked files directly under `tools/`: 0. No live call site.
- **low** · `nfr:maintainability` · `tool-isolation.test.ts` is blunt as its header says, and these plants were not caught: `createRequire(import.meta.url)("@downloader/contract")`, `import.meta.resolve("@downloader/contract")`, a `.css` `@import` and an `.html` `<script src>` into another tool (the extensions are not in `SOURCE_EXTENSION`); tsconfig `references` into another tool are read by neither scan (by reading, not run). Caught, from `tools/planner`: `import type`, dynamic `import()`, `export *`, `export {…} from`, multi-line `from`, `require()`, `import x = require()`, `vi.mock`, a template `import(`@downloader/${n}`)`, a relative `../../../downloader/…` and a relative `package.json` import, in `api/src`, `api/test`, `e2e`, `web/src` (`.tsx`), `web/test`, and in `.mjs`, `.cjs`, `.mts`, `.cts`, `.js`; any tool's import from `packages/` and `scripts/`; a devDependency in a manifest. No live call site; the header names the positions it matches.
- **low** · `nfr:maintainability` · Two pages say what a pull request's CI runs and will be stale once this lands, beyond the root `CLAUDE.md` and `testing.md` sentences already scheduled: `roles/builder.md` ("CI runs every project on the draft while the gate works") and `reference/dispatching.md` ("It runs `ci.yml`'s whole matrix too" for a probe pull request). Overstated coverage and cost, so false in the safe direction.
- **low** · The ticket's Log misstates two figures. (1) "A named list plus `.github/**` would have run every project on 7 of them … The other 10 are 6 release commits …, 1 `.env.prod.example`, 1 `.devcontainer/Dockerfile` and 2 under `.claude/`": over the same 100 commits, 17 run every project under rule (i), 13 would under the old named list plus `.github/**`, and only 4 are rule-(i)-only (2 compose/`.env.prod.example`/`.devcontainer`, 2 `.claude`); the release commits touch `package-lock.json`, so the named list already caught them. Rule (i)'s marginal cost is 4 of 100, not 10, so the settled choice stands on a smaller number. (2) "`npx vitest list --filesOnly` lists 314 files, and 313 with `--exclude`": at this head it is 315 and 314 (CI ran 314), a count that fits a tree before `tool-isolation.test.ts` was added.
- **dropped** · "a base that moved, or a stacked base, hides a path": seven scenarios in a temp repo (moved base, stale `base.sha`, main merged into the branch, stacked onto a parent) all list the pull request's own paths with a three-dot diff; a stale base can only widen; a missing merge base fails red (`fatal: … no merge base`, exit 128). Narrower than the merge by design — decision (a) puts every project on the `main` push.
- **dropped** · "an undeclared tool directory (`tools/newtool/x.ts`) is ignored by vitest": measured, `--project newtool --project repo --project core` exits 0 with a name left unmatched, and exits 1 when no name matches; an undeclared tool has no suite on `main` either, so nothing changes.
- **dropped** · "the Windows leg no longer runs `scripts/test/status.test.ts`": the ticket's Build 6 and 7 say so. Designed, not a defect.
- **dropped** · "`packages/ui/README.md` alone: `projectsFor` says every project, CI skips": the old markdown rule skips it and the comment says "except under `packages/`, as before". Pre-existing.
- **findings** · the hunt returned 11; 7 carried, 4 dropped.
- NFR: security — first finding · performance ✓ (`changes` job 7 s with `setup-node`; ubuntu `npm test` 252 s on the all-project list, `status.test.ts` run once) · reliability — third and fourth findings; Windows leg `pass` at `80ee7306`, same list and `--exclude` as ubuntu, 314 files both legs · maintainability — the three findings above.

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
    32 filtered, and 28 of those 32 skip the downloader. Over the same 100
    commits the old named list plus `.github/**` would have run every project on
    13 (the release commits touch `package-lock.json`, so the list already
    caught them), and only 4 are rule (i) alone: 2 under compose,
    `.env.prod.example` and `.devcontainer`, and 2 under `.claude/`. Rule (i)'s
    marginal cost is 4 of 100. Every one of the 17 runs every project today too.
  - Build 5's premise holds: nothing enforced the rule. With
    `import type { AppError } from "@downloader/contract"` planted in
    `tools/planner/api/test/helpers/`, `npx vitest run --project core` →
    `Tests  1 failed | 93 passed (94)`, and the one failure was the new
    `tool-isolation.test.ts`. `image-closure.test.ts` reads only `src`, and it
    asks only that an import be declared. The same plant under
    `tools/planner/api/src/` fails the new scan with
    `tools/planner/api/src/zz-repo127-probe.ts:1 imports @downloader/contract, which is tools/downloader's`.
    It passes once the plant is removed (`9 passed (9)`).

  Build 6: `npx vitest list --filesOnly` lists 315 files, and 314 with
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

- 2026-10-25: Done when 1's probe. PR #659 was a draft on
  `repo-127-probe-scratch`, based on this branch at `f7f32a8c`, and added only
  `tools/planner/repo-127-probe.txt`. `ci.yml`'s `pull_request` trigger has
  no branch filter, so the probe ran against a non-`main` base. Its `changes`
  job (run `40223951225`, job `121261277357`) printed
  `Changed files, f7f32a8c…...ca5f0096…:` / `  tools/planner/repo-127-probe.txt`
  / `Projects: planner repo core`. The ubuntu test step ran
  `npm test -- --project planner --project repo --project core --exclude scripts/test/status.test.ts`
  and the job passed in 1m28s. The PR was then closed and the branch deleted, and
  `git ls-remote --heads origin repo-127-probe-scratch | wc -l` → `0`.

  The probe found a defect in the first build. The Windows leg ran the test
  step under `shell: bash` and failed
  `next-id.test.ts > a command that is not on PATH exits 127 and says which one`
  (`expected 'git ls-tree HEAD docs/work/ --name-on…' to match /^gh:/mu`).
  On `main` the same leg passed at `7f8d7f48` (run `40222603997`) under
  PowerShell. Git Bash puts mingw64's `git.exe` first on PATH, and the
  test's `pathWithout` symlinks whichever `git` it finds, so this was the
  fixture measuring the shell. The test step is now two steps: bash on Linux,
  and PowerShell on Windows calling `npm.cmd` so the `--` reaches npm. Each
  leg keeps the shell `npm test` always ran under. Pull request #658's own
  Windows leg is the reading for the PowerShell step. pwsh is not installed
  here.

- 2026-10-25 — Fixed at landing by owner choice: gate 1, the first low (path
  reading) — "`git diff --name-only` quotes a non-ASCII path (core.quotePath)"
  and "`ciProjects` trims each line". `ci.yml`'s `changes` step and
  `preflight()`'s own diff read now pass `-c core.quotePath=false`, and
  `ciProjects` skips empty lines without trimming. Three new tests in
  `scripts/test/preflight.test.ts`, each red against `80ee7306`'s `ci.yml` and
  `preflight.mjs` and green after: "ciProjects reads a path as its own text",
  "ci.yml's changes step maps a non-ASCII path under tools/planner" and
  "preflight plans a non-ASCII path under a tool". With `-t repo-127`, red is
  `Tests  3 failed | 7 passed | 109 skipped (119)` and green is
  `Tests  10 passed | 109 skipped (119)`.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the second low
  (`projectsFor`'s comment) — "An empty list means every path was markdown, and
  nothing else". The comment now says a non-markdown path no tool owns and no
  shared rule covers also gives empty, and that `changes` then fails red.
  `git diff 80ee7306 | grep -c '^-.* empty list means every path'` → `1`.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the third low (Log
  figures) — "would have run every project on 7 of them" and "lists 314 files".
  Both are corrected in the Build entry above as the gate measured them: 13 of
  100 under the old named list plus `.github/**`, 17 under rule (i), 4
  rule-(i)-only; and 315 files, 314 with the `--exclude`, re-read at this head
  (`npx vitest list --filesOnly | grep -c .` → `315`, `314` with the
  `--exclude`). `git diff 80ee7306 | grep -c '^-.*on 7 of them'` → `1`, and
  `git diff 80ee7306 | grep -c '^-.*lists 314 files'` → `1`.
- 2026-10-25 — The owner's edit at landing: the sentence "CI runs lint,
  typecheck and every unit suite on every push." in the root `CLAUDE.md` and in
  `.claude/rules/testing.md` now ends "on every push to `main`; a pull request
  runs the projects its paths reach (repo-127)." This supersedes the Build
  entry's "It is not edited here". `git diff 80ee7306 | grep -c '^-CI runs lint'`
  → `2`.
- 2026-10-25 — Fixed at landing by owner choice: CodeQL on #658 at `4567fe30`,
  "Insecure temporary file" (high), "Insecure creation of file in the os temp
  dir", `scripts/test/preflight.test.ts` line 2792. The landing's own test
  introduced it: commit `8f870cc4` wrote the fake `GITHUB_OUTPUT` as
  ``path.join(os.tmpdir(), `${path.basename(dir)}-output`)``, a predictable name
  in the temp dir. The builder's `changes` step test built the same kind of name
  beside its directory, which CodeQL did not flag; both now create the file in
  its own `fs.mkdtempSync(path.join(os.tmpdir(), "preflight-output-"))`
  directory and remove that directory recursively in `finally`, and nothing they
  assert changed. Proof: `npx vitest run scripts/test/preflight.test.ts -t
  "changes step"` passes both tests, and CodeQL's reading of the new head is
  unmeasured here.
