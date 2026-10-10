---
id: repo-46
tool: repo
title: Release commits never update package-lock.json, so every npm install rewrites two version lines
kind: fix
status: done
difficulty: standard
milestone: null
depends_on: []
---

# repo-46 — Release commits never update `package-lock.json`

**Packages:** `release-please-config.json`, `package-lock.json`, and — under one
of the options below only — `.github/workflows/ci.yml` or `release.yml`.

## Why

A release bumps each tool's `api/package.json` and never touches the root
lockfile, which records that same version for every workspace. So the lockfile
falls behind on every release, and the next `npm install` anywhere rewrites the
stale lines. Whoever ran it then has a lockfile diff their change did not cause,
and it lands in whatever they commit next.

That has already happened once: the lockfile caught up in `896806c`, a
`fix(downloader)` commit that also carried the planner's version line. It has
fallen behind again since. Nothing is broken at runtime, and CI does not notice
(measured below). The cost is the unrelated diff, plus a lockfile nobody can
trust to say what is on `main`.

### The configuration, as it stands on `95c6403`

Both tools are `release-type: simple`, and the only extra file either one stamps
is its API manifest:

`release-please-config.json@95c6403:15` "api/package.json"

`release-please-config.json@95c6403:21` "api/package.json"

Both lines read, in full,
`"extra-files": [{ "type": "json", "path": "api/package.json", "jsonpath": "$.version" }]`.

That stamp exists for a reason, and the options have to keep it: `/api/health`
reads the version from that manifest.

`tools/downloader/api/src/routes/health.ts@95c6403:65` "const manifest = fileURLToPath(new URL("

`docs/03-RELEASING.md` relies on it as well, saying `/api/health` "agrees with
`.env`, because release-please stamps both `version.txt` and `api/package.json`".

## The reproduction

Every command below ran in this ticket's worktree at `95c6403`
(`origin/main`), unless it says otherwise.

**1. A release commit touches four files, and the lockfile is not one of them.**

```
$ git show --name-only --format='%h %s' 5932f14
5932f14 chore(planner): release 0.5.1 (#203)

.release-please-manifest.json
tools/planner/CHANGELOG.md
tools/planner/api/package.json
tools/planner/version.txt
```

The downloader's latest release has the same shape:

```
$ git show --name-only --format='%h %s' a7f2c86
a7f2c86 chore(downloader): release 0.4.0 (#164)

.release-please-manifest.json
tools/downloader/CHANGELOG.md
tools/downloader/api/package.json
tools/downloader/version.txt
```

**2. No release commit has ever touched it.** There are eleven release commits
on `origin/main`, from `9885476` (`chore(downloader): release 0.1.1`) to `a7f2c86`,
listed with `git log --oneline --grep='^chore(.*): release' origin/main`. Scoping
that same query to the lockfile prints nothing, exit 0:

```
$ git log --oneline --grep='^chore(.*): release' origin/main -- package-lock.json
$
```

**3. The two versions disagree on `origin/main`.** Read with `node -e` from each
`api/package.json` and from `package-lock.json`'s `packages` map:

```
tools/downloader/api pkg=0.4.0 lock=0.2.0
tools/planner/api pkg=0.5.1 lock=0.4.0
```

`package-lock.json@95c6403:6216` "0.2.0"

`package-lock.json@95c6403:6294` "0.4.0"

**4. `npm install` rewrites exactly those two lines.** Reproduced outside any
checkout. I extracted `95c6403` with `git archive` into a scratch directory, then
ran npm 10.9.8 there:

```
$ git archive 95c6403 | tar -x -C <scratch>/lock-repro
$ cp package-lock.json ../package-lock.orig.json
$ npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund
up to date in 1s
exit=0
$ diff ../package-lock.orig.json package-lock.json
6216c6216
<       "version": "0.2.0",
---
>       "version": "0.4.0",
6294c6294
<       "version": "0.4.0",
---
>       "version": "0.5.1",
diff exit=1
```

The filer saw the same rewrite from a full `npm install` in the shared checkout
(`git diff --stat`: 2 insertions, 2 deletions) and reverted it. The scratch run
reproduces it without touching any checkout.

### Relayed facts, each checked here

The repo-45 filer passed on three claims, which are also recorded on that
branch (`repo-45-worktree-farm-stale-node-modules`, PR #241). Each was checked
before it went into this ticket.

- **The lockfile caught up once, in a non-release commit, and has lagged
  since. Confirmed.** `git show 896806c -- package-lock.json` changes
  `"version": "0.1.1"` to `"0.2.0"` for `tools/downloader/api` and `"0.3.0"` to
  `"0.4.0"` for `tools/planner/api`. `896806c` is
  `fix(downloader): build the contract before the dev server starts (#151)`,
  dated 2026-09-05 16:33. `git show 896806c:.release-please-manifest.json` reads
  `0.2.0` and `0.4.0`, so at that commit the lockfile matched. Four releases
  landed after it and none touched the lockfile: downloader 0.3.0 (`20f7336`,
  2026-09-05 16:42), planner 0.5.0 (`f8340b1`), planner 0.5.1 (`5932f14`) and
  downloader 0.4.0 (`a7f2c86`). The lag before `896806c` was the same defect: the
  lockfile still said `0.1.1` thirteen days after `7aa4b2e` released downloader
  0.2.0 on 2026-08-23. `git log origin/main -- package-lock.json` lists
  `de3b3f8` (pl-39) as the only lockfile commit since `896806c`, and it left both
  version lines alone.
- **Three workspace entries are marked `extraneous` for directories that no
  longer exist. Confirmed, but they are not this defect.** Reading every entry
  in `packages` with `"extraneous": true` returns exactly three:
  `packages/engine` (`@downloader/engine`), `packages/resolvers`
  (`@downloader/resolvers`) and `packages/shared` (named `@downloader/contract`).
  `ls packages/` prints only `core`. **The scratch `npm install` above did not
  remove them**, since its diff has only the two version lines. So a routine
  install does not clean them up, and nothing a release does would either. They
  are recorded here because a reader will find them next to the version lines,
  but the fix for this ticket does not depend on them.
- **Whether `npm ci` in CI tolerates the mismatch was unknown. It does, at least
  on `95c6403`.** `ci.yml`'s `check` job runs `npm ci` before anything else:

  `.github/workflows/ci.yml@95c6403:106` "- run: npm ci"

  and the nightly run on that exact commit passed every job:

  ```
  $ gh run view 34851547082 --json headSha,conclusion,jobs --jq '{headSha,conclusion,jobs:[.jobs[]|{name,conclusion}]}'
  {"conclusion":"success","headSha":"95c6403d457629bbbe6bfa853169578be5236a2c","jobs":[{"conclusion":"success","name":"changes"},{"conclusion":"success","name":"check"},{"conclusion":"success","name":"test (windows-latest, informational)"},{"conclusion":"success","name":"test (ubuntu-latest)"}]}
  ```

  Both workspaces are two releases behind there, so `npm ci` does not check a
  workspace's own version. **Not measured:** the `npm ci` in each tool's
  `Dockerfile`, which may run a different npm. `release.yml` has built images
  from this lockfile since 0.3.0 without anyone reporting a failure, but that is
  an observation, not a measurement.

## What release-please supports, and how much of it was checked

**Read from release-please's `main` branch through WebFetch, whose answers are
summaries rather than raw source, and not pinned to the version this repo runs**
(`.github/workflows/release.yml@95c6403:47` "googleapis/release-please-action@v5"). Treat all of it
as a lead to confirm against that version, not as a fact about it.

- **`extra-files` with `type: json` takes a `jsonpath`, and the path goes through
  `addPath`.** In `src/strategies/base.ts`, `addPath` joins a file to the
  package's own path, unless the file starts with `/`, in which case it strips
  the slash and resolves from the repository root. For this repo,
  `package-lock.json` would resolve to `tools/downloader/package-lock.json`,
  which does not exist, and `/package-lock.json` would resolve to the root
  lockfile. Read, not run.
- **`GenericJson` uses `jsonpath-plus`, with `resultType: 'all'`**, and it
  rewrites every node a path matches (`src/updaters/generic-json.ts`). Read, not
  run. **Unverified:** whether `jsonpath-plus` accepts a bracketed key containing
  `/`, such as `$.packages['tools/downloader/api'].version`, which is the path
  this fix needs.
- **The `node` release type updates `package-lock.json` through `addPath`**
  (`src/strategies/node.ts`, `buildUpdates`), meaning at the package path. It
  also updates `package.json` at the package path. Neither file exists under
  `tools/downloader/`, whose manifest is one directory down in `api/`. Read, not
  run.
- **The `node-workspace` plugin skips any package whose `releaseType` is not
  `node`**, and the summary found no code reading the root `workspaces` field.
  Read, not run. How it treats a root lockfile beyond one comment is
  **unverified**.

## Options — answered 2026-09-28 by the owner: A and C together

**A stamps the lockfile, and C proves that it did.** A alone can fail silently,
which is how this defect got in; with C beside it, a release PR whose stamp did
nothing goes red instead of drifting. D and E are not taken, and B is not taken.

Two facts changed between filing and answering, both measured on `a084170`:

- **There are three tools now.** `tools/ledger` is a third `release-type:
simple` package with the same `api/package.json` stamp, so A adds three
  lockfile entries, not two.
- **`jsonpath-plus` reads a bracketed key with `/` in it.** In a scratch
  install of `jsonpath-plus@10`, the range `release-please@latest` declares
  (`^10.0.0`), `$.packages['tools/downloader/api'].version` with
  `resultType: 'all'` over the root lockfile returned exactly one match,
  `$['packages']['tools/downloader/api']['version'] = 0.7.0`. One of A's two
  unknowns is settled. **The leading-`/` root path is still unverified**, and C
  is what catches it if it is wrong.

### A. Stamp the lockfile as a second extra file

Add `{ "type": "json", "path": "/package-lock.json", "jsonpath": "$.packages['tools/<tool>/api'].version" }`
to each tool's `extra-files`.

- The smallest change, and it keeps `simple`, `version.txt`, the manifest and the
  health endpoint exactly as they are.
- **Two things are unverified, and either one would make it do nothing
  silently, which is how this defect got in**: the leading-`/` root path at the
  release-please version this repo runs, and `jsonpath-plus` resolving a key with
  slashes in it. Neither can be tested without a release PR, so its `Done when`
  has to be the next real release PR's file list.
- `separate-pull-requests` is `true`, so both tools' release PRs would edit the
  same file. The two lines are 78 apart, so git should merge them cleanly, but
  that is inferred, not measured.
- `GenericJson` updates every match, and each path here names one key, so this
  should touch only the version line. Unverified.

### B. Change the release type

Move to `release-type: node`, possibly with the `node-workspace` plugin.

- According to the source as read above, it does not reach this lockfile. The
  `node` strategy looks for `package.json` and `package-lock.json` at the package
  path, and this repo keeps neither there. Taking this option would mean
  restructuring what a release-please "package" is (for example, pointing it at
  `tools/<tool>/api`), which moves `version.txt`, the changelog path and the tag
  component, all of which `release.yml` and adr/002 depend on.
- The most disruptive option, and the least checked. Listed so its cost is on
  record.

### C. Detect it in CI rather than prevent it

Add a step to `ci.yml`'s `check` job:
`npm install --package-lock-only --offline --ignore-scripts`, then
`git diff --exit-code package-lock.json`.

- Measured locally: that command runs in about 1 s and produces exactly the
  two-line diff above. **Not measured on a runner**, where `--offline` depends on
  the cache `npm ci` has just filled.
- **It fails every release PR on its own**, because release-please opens each one
  in this exact state. So C only works alongside a way of fixing the lockfile on
  the release branch: a human push, or D. On its own it turns a silent drift into
  a red release PR.
- It would also catch the drift this ticket does not cover, such as a dependency
  edited by hand without an install.

### D. Fix the lockfile on the release branch with a workflow

A job in `release.yml` that runs when release-please opens or updates its PR,
runs `npm install --package-lock-only` on that branch and pushes the result.

- Keeps release-please's config unchanged, and works whatever release-please
  supports.
- **Unverified:** a push made with the default `GITHUB_TOKEN` does not trigger
  other workflows, so the release PR's CI would run on the commit before the fix.
  How this repo's token and branch protection would handle it has not been
  checked, and checking it needs `gh api`, which is denied.
- It adds a second writer to a branch release-please rewrites whenever it
  updates the PR, so the two could race.

### E. Stop stamping `api/package.json`

Remove the `extra-files` entry, so a workspace's version never changes and the
lockfile never drifts.

- **It breaks what the stamp exists for**: `/api/health` would report a fixed
  version, and `docs/03-RELEASING.md`'s promise that it matches `.env` would
  become false. The health route would have to read `version.txt` instead, and
  the image would have to ship that file. Listed for completeness, and not
  recommended.

## Build

A and C, in one change:

1. Resync the two stale version lines in the same change, with
   `npm install --package-lock-only` in a scratch copy, **not** in a worktree
   or the shared checkout. Confirm the diff is exactly the two lines shown in
   reproduction 4.
2. Leave the three `extraneous` entries alone unless the decision says
   otherwise. Removing them is a separate edit with its own diff to review.
3. Add A's lockfile stamp to all three tools' `extra-files`.
4. Add C's step to `ci.yml`'s `check` job:
   `npm install --package-lock-only --offline --ignore-scripts`, then
   `git diff --exit-code package-lock.json`. If `--offline` fails on a runner
   because the cache lacks something, drop `--offline` rather than the step,
   and say so in the Log.
5. The proof of A arrives with a release PR, not with this branch. Record it
   in `awaiting`.

## Done when

1. `git log --grep='^chore(.*): release' origin/main -- package-lock.json` lists
   the first release commit made after the fix lands, and that release PR's
   `check` job ran C's step green.
2. On this branch, C's step is shown red against a lockfile with one version
   line reverted, and green on the fixed one.
3. After that release, `npm install --package-lock-only` in a scratch extraction
   of `main` leaves `package-lock.json` unchanged (`diff` exit 0).
4. `/api/health` still reports the released version for every tool.

## Review

**Gate: CONCERNS** — 2026-09-30 · `e79b04f...cff47a6` · code-review at medium, run by this gate in its own context (Opus, a different model from the Sonnet build) · `origin/main` still at `e79b04f` after fetch · unpinned coordinates below resolve at `f4c6f82`

_Re-issued at `f4c6f82` with its words, rows and verdicts unchanged. Round 2 deleted or corrected the text behind five citations, the two in the second med and the three in the second low, so they are now prose naming `cff47a6`, the sha this section gated._

| Done when                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. The first release commit after the fix touches `package-lock.json`, and its release PR's `check` job ran C green      | **unproven (gate)**: needs the first release PR after merge. What this branch can do toward it, verified by replaying release-please 17.6.0's `extra-files` path (the `release-please-action@v5` bundle: `addPath` strips the leading `/`, then `GenericJson` with `jsonpath-plus` 10.3.0) over the head tree. `release-please-config.json:20 "$.packages['tools/downloader/api'].version"`, `release-please-config.json:33 "$.packages['tools/planner/api'].version"` and `release-please-config.json:46 "$.packages['tools/ledger/api'].version"` each match exactly one node, and a same-version stamp writes both files back byte-identical. After a simulated downloader 0.8.0 stamp, C exits 0, including with an empty npm cache under `--offline`                                                                      |
| 2. On this branch, C is red against a lockfile with one version line reverted and green on the fixed one                 | **verified**: no test asserts it (see the second finding). Re-run in a scratch git-init extraction of `cff47a6` through `.github/workflows/ci.yml:125 "run: node scripts/check-lockfile-sync.mjs"`. It exits 1 on a planner 0.8.0 release whose lockfile stamp was skipped, and exits 1 on a ledger lock line moved from 0.0.0 to 0.0.1. It exits 0 once the resync is committed                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3. After that release, `npm install --package-lock-only` in a scratch extraction of `main` leaves the lockfile unchanged | **unproven (gate)**: needs a real release. In simulation, after the stamped downloader 0.8.0 commit npm prints `up to date` and the step's `git diff --exit-code package-lock.json` exits 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4. `/api/health` still reports the released version for every tool                                                       | **verified** on the branch side only. The diff touches no `api` source. Each route still reads its own manifest: `tools/downloader/api/src/routes/health.ts@e79b04f:62 "fileURLToPath(new URL("`, `tools/planner/api/src/routes/health.ts@e79b04f:46 "fileURLToPath(new URL("` and `tools/ledger/api/src/routes/health.ts@e79b04f:28 "fileURLToPath(new URL("`. Each tool's first `extra-files` entry (`api/package.json`, `$.version`) is byte-identical to the base, and the replay stamped it (1 match per tool). The tests assert only the version's shape: `tools/downloader/api/test/routes.test.ts@e79b04f:584 "expect(body.version)"` and `tools/ledger/api/test/health.test.ts@e79b04f:61 "expect(body.version)"`. The planner's health test asserts no version. A live `/api/health` after a release is not measured |

- **med** · **When preflight runs C's step locally, it writes into the shared checkout.** Preflight's `ciCommands` check spawns the new step for real, so every builder and gate that runs preflight also runs `npm install --package-lock-only` inside its farm worktree. That command rewrites npm's hidden lockfile, `node_modules/.package-lock.json`. In a farm worktree that file is a symlink to `/workspaces/tools/node_modules/.package-lock.json`. Measured in a scratch copy with the same symlink: the target was rewritten, and its content followed the worktree's manifests (a ledger version of `0.5.5` appeared in it). The shared file's mtime moved to 01:23:14 while this gate's own preflight run was in progress. npm rejected the rewritten file as `out of date` on its next `npm ls` in the scratch copy, so the only harm measured is the write itself. When the lockfile has drifted, the same command also rewrites the worktree's own `package-lock.json`. Preflight's guard against unrecognised npm commands, at `scripts/preflight.mjs@e79b04f:635 "an npm step this file does not recognise as"`, exists to keep a real install out of `a worktree the farm — not npm — built` (`scripts/preflight.mjs@e79b04f:614 "worktree the farm"`). The wrapper script gets past that guard only because preflight sees a `node` command instead of an `npm` one. **Open decision**, recommended first:
  1. Run the install in a temporary directory that holds only the root `package.json`, the lockfile and every workspace `package.json`, then compare the lockfile it produces with the committed one. Measured: this gives the same result (in sync: unchanged; ledger bumped to `0.3.0`: the one-line diff) and creates no `node_modules`.
  2. Add the step to preflight's `COVERED` list as a CI-only step, so preflight never spawns it. This loses the local signal.
  3. Keep it and document the write as harmless. That goes against `common.md`'s rule never to touch the shared checkout.
- **med** · **The new script has no test file of its own.** `scripts/check-lockfile-sync.mjs` has two branches: the install fails (`return install.status`, line 54 of `scripts/check-lockfile-sync.mjs` at `cff47a6`), or the diff fails and it prints its message. It exports `checkLockfileSync` with a `runCommand` parameter that could be replaced in a test, and nothing replaces it: `scripts/test/` has no `check-lockfile-sync.test.ts`. The repo project ran 620 tests at `e79b04f` and 620 at `cff47a6` (`npx vitest run --project repo`). The only test change is two entries added to lists that tests already assert (line 946 of `scripts/test/preflight.test.ts` at `cff47a6`). So Done when 2 rests on runs done by hand. A test with a scratch repository could make it **proven**.
- **med · open decision** · **The title check fails, and the builder has already raised this.** Preflight exits 8 at `cff47a6` on `title`. The 35 pin changes include one in `tools/downloader/docs/work/dl-72-…`, which makes a `fix` title release the downloader. The builder's options stand, with two corrections from what this gate measured. First, the cost of option 3: #284 (`chore(downloader): release 0.8.0`) is open, so a `fix` would add one line to that pending 0.8.0 changelog. It causes a new version only if #284 merges first. Second, the ordering in option 1: a pin to `e79b04f` resolves on `main` today, so the dl-72 change can always merge first. **Recommended: option 2**, `ci(repo):`. `node scripts/commit-message.mjs --text` accepts that title (exit 0), and `ci` is hidden in `release-please-config.json`.
- **low** · Three claims in the Log are wrong. It says C was added "as two steps"; it is one step. It says the dl-72 repoint is "Build step 1's own consequence"; it follows from step 3. And the cost it gives for option 3, and the merge order it gives for option 1, need the corrections in the finding above.
- **low** · Two comments say the wrapper uses "the same flags" as C: line 122 of `.github/workflows/ci.yml` and line 23 of `scripts/check-lockfile-sync.mjs`, both at `cff47a6`. The script also passes `--no-audit` and `--no-fund` (line 51 at `cff47a6`), which the Build section does not name. Both flags are harmless, and the order matches the Build section.
- **low** · Moving lines in `ci.yml` displaced 11 citations that carry an anchor, sit outside any enforced `## Review` section, and were correct at `e79b04f`: three in `orchestrate-tickets/reference/history.md`, two in `repo-24`, two in `repo-29`'s Log and four in `repo-31`. CI does not check any of them.
- **low** · The script never reads `install.error`. When the spawn itself fails (for example `npm` without its `.cmd` on Windows with `shell: false`), the script exits 1 and prints no message. Not measured on Windows.
- **dropped** · `--offline` could fail on a runner. Measured green with an npm cache holding only what `npm ci` filled, and with an empty cache, in both the in-sync case and the drifted case.
- **dropped** · The `json` updater could reformat the lockfile and turn C red on a release PR. Stamping the unchanged versions left every file byte-identical, all six writes.
- **dropped** · Two release PRs could conflict on the lockfile. The three version lines are 55 or more lines apart, and preflight's `mergeTree` is clean against #284 and #294. How the two regenerated PRs merge is inferred, not measured.
- **findings** · code-review at medium returned 10; 7 carried (one of them an open decision), 3 dropped.
- Citations: `node scripts/citations-gate.mjs --against origin/main` exits 0 with `135 enforced, 0 failing`. The branch's 35 pin changes across 10 records, all to `@e79b04f`, were each checked against a `git show` of the base file, not against the diff: 35 of 35 have their anchor on the pinned line, and on no other line of that file.
- Invariants: no shell (with `shell: false` removed, `packages/core/test/spawn-safety.test.ts` fails, naming the script), `node:` builtins ✓, no `console` ✓. Skipped because the diff touches none of them: tool imports, `AppError`, SSRF, redaction, progress, contracts, Dockerfiles.
- NFR: security n/a · performance ✓ (about 0.5 s per run) · reliability: the first finding · maintainability: the second finding.

### Gate 2

**Gate: CONCERNS** — 2026-09-30 · `cff47a6..484f0d2` only · re-gate of round 2 by gate 1's reviewer (Opus) · base `e79b04f`, and `origin/main` has not moved · unpinned coordinates below resolve at `f4c6f82`. The owner chose to rebase onto repo-47 and drop the dl-72 repoint, so preflight's `title` failure on the dl-72 path is expected at this head and is not graded. Done when 1 and 3 still wait for a release, as in gate 1. Done when 2 is now **proven** by `scripts/test/check-lockfile-sync.test.ts:116 "expect(checkLockfileSync(dir, quietRun)).toBe(0)"` and `scripts/test/check-lockfile-sync.test.ts:135 "expect(checkLockfileSync(dir, capturing)).toBe(1)"`.

_Re-issued at `f4c6f82` with its words, rows and verdicts unchanged. Round 3 corrected the claim behind the first low's one citation, so it is now prose naming `484f0d2`, the sha this section gated._

| Gate 1 finding                                | Verdict at `484f0d2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| med, C's step writes into the shared checkout | **fixed**. I took a read-only `stat` and `sha256sum` of `/workspaces/tools/node_modules/.package-lock.json` before and after both the step and a full preflight run in this farm worktree. Both times it read `01:23:14.500764343` / `d432f0b6…c80e`, unchanged. With the worktree drifted (ledger `api/package.json` set to 0.0.1), the step exits 1 and prints the one-line diff, and the worktree's `package-lock.json` hash is unchanged (`a19cec13…`). Staging is complete for this repository: the root manifest is copied whole, so `overrides` would come with it (there are none today); there is no `.npmrc` and no `npm-shrinkwrap.json`; all 15 link targets in the lockfile fall under the two workspace globs; and no dependency uses `file:`. A mutated copy that leaves out `tools/ledger/api/package.json` exits 1 on the in-sync tree, so a missing manifest is reported as drift rather than passing. In the tests, installing in the caller's directory turns `scripts/test/check-lockfile-sync.test.ts:163 "expect(fs.readFileSync(hidden,"` red |
| med, the new script has no test file          | **fixed**. Six tests, 626 in the repo project against 620. Each mutation turns at least one test red on the assertion that names its effect. Dropping the cleanup: `scripts/test/check-lockfile-sync.test.ts:181 "for (const dir of made)"`. Installing in the caller's directory: the hidden-lockfile assertion above. Ignoring `install.error`: `scripts/test/check-lockfile-sync.test.ts:190 "could not run npm: spawn npm ENOENT"`. Inverting the diff exit: both Done when 2 assertions cited in the header. Staging no workspace manifests: the in-sync assertion. Returning before the install: 5 of 6 red. The `tsconfig` include is needed: without it, `npx tsc -p scripts/test/tsconfig.json --noEmit` fails with TS6307 on the test's import                                                                                                                                                                                                                                                                                                              |
| low, Log claims                               | **fixed**. `as two steps` and the step-1 wording no longer appear (0 hits). The corrections are marked in place, and the option 1 and option 3 corrections are recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| low, "same flags" comments                    | **fixed**. 0 hits for `same flags` in either file. The comment at `.github/workflows/ci.yml:124 "and is outside that guard"` now names the two added flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| low, 11 displaced citations                   | **fixed**. 11 of 11 pins changed this round, all to `@e79b04f` (repo-24 ×2, repo-29 ×2, repo-31 ×4, `history.md` ×3). The word diff shows only the `@e79b04f` insertion, and each anchor sits on the pinned line when checked against a git show of the base `ci.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| low, `install.error` ignored                  | **fixed** for the install, where the mutation turns the spawn-error assertion red. See the new low below for the diff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

- **med** · **The tests that run npm for real cannot start it on Windows, and two of them pass without it (two findings, one mechanism).** `scripts/test/check-lockfile-sync.test.ts:85 "spawnSync(command, args, { cwd: options.cwd, encoding:"` and the script's own `scripts/check-lockfile-sync.mjs:57 "spawnSync(command, args, { cwd: options.cwd, stdio:"` spawn a bare `npm` with `shell: false`. On Windows `npm` is a `.cmd` shim, which cannot be spawned without a shell. This repository already records that rule at `.claude/rules/testing.md@e79b04f:70 "cannot spawn its"`, which asks tests to `.claude/rules/testing.md@e79b04f:83 "assert the spawn itself succeeded"`. The `npm test` matrix runs on `windows-latest`, so this happens on every code PR. I simulated it on Linux by running vitest with a `PATH` that holds only `node` and git. Two tests fail with messages that blame the verdict, not the spawn (`expected 1 to be +0`, `expected '' to match`), and the hidden-lockfile test and the temp-directory test pass without npm ever running. Windows itself is **not measured**. **Open decision**, recommended first:
  1. Skip the four real-npm tests on `win32` (`test.skipIf`, as `citations.test.ts` already does), and have `quietRun` assert `result.error` is undefined, so the tests cannot pass without npm.
  2. Have the script run npm as `process.execPath` plus `npm-cli.js`, resolved from `npm_execpath`, so the step and preflight also work on Windows. This takes more work.
- **low** · The new `diff.error` branch, `if (diff.error !== undefined)`, line 160 of `scripts/check-lockfile-sync.mjs` at `484f0d2`, has no test. With it replaced by `if (false)`, 6 of 6 still pass. Without the branch, a `git` that never starts would print the "out of sync" message.
- **low** · **The planned rebase will also need repins in repo-47's own record.** Preflight exits 24: `title` (8, expected) plus `mergeTree` (16). The scratch merge with #326 (`repo-47-enforce-changed-records`) fails the citations gate on 9 records. Replaying that merge under repo-47's gate, 5 of repo-47's own record's citations move because of this branch's round-1 lines: `ci.yml` 119, 173 and 185, and `preflight.test.ts` 2137 and 2204. The records this branch edits (repo-34, repo-65, repo-79, repo-82) fail mostly on `scripts/preflight.mjs` lines that repo-47 itself moves. The Log's rebase plan names only the second group.
- **dropped** · On the install-in-caller mutation, the temp-directory test also goes red, for an incidental reason: its spy records npm's working directory, which is now the caller's fixture, and that directory still exists. The mutation is caught for its own reason by the hidden-lockfile assertion, so this is not a defect.
- **dropped** · The pinned `history.md` citation of `ci.yml` line 151 at `e79b04f`, anchored on `--require-anchors`, has an anchor that occurs on two base lines. That anchor predates this round, and CI does not check `history.md`.
- **findings** · The hunt over `cff47a6..484f0d2` returned 6; 4 carried in 3 bullets (the med merges two findings with one mechanism), 2 dropped.
- Commands at `484f0d2`:
  - `npm run check`: exit 0.
  - `npx vitest run scripts/test/check-lockfile-sync.test.ts scripts/test/preflight.test.ts`: 93 of 93, exit 0.
  - `node scripts/citations-gate.mjs --against origin/main`: exit 0, `135 enforced, 0 failing`.
  - `node scripts/preflight.mjs --base origin/main --title "fix(repo): stamp the lockfile on release and catch drift in CI (repo-46)"`: exit 24. `check`, `ciCommands` (the new step included), `citations` and `review` are ok. `title` fails on dl-72, as expected. `mergeTree` fails only in the scratch merge with #326; the scratch merges with #325, #294 and #284 are clean.
- NFR: security n/a · performance ✓ (0.5 to 0.7 s) · reliability: the med above · maintainability ✓.

### Gate 3

**Gate: CONCERNS** — 2026-09-30 · round 3 only: the non-merge commits `d7a9b22` and `f4c6f82` in `484f0d2..f4c6f82`, plus merge `d56a840`, whose remerge diff is empty (no conflict was resolved by hand) · re-gate by gate 1's reviewer (Opus) · the landing base is now `b658179`, which is `origin/main` after fetch · unpinned coordinates below resolve at `f4c6f82`. CONCERNS only because Done when 1 and 3 are still **unproven (gate)** until a release. Nothing this round is at med or above.

| Gate 2 finding                      | Verdict at `f4c6f82`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| med, real-npm tests on Windows      | **fixed**. The skip, `scripts/test/check-lockfile-sync.test.ts:72 "test.skipIf(process.platform"`, wraps exactly the four tests that call the real runner. With the predicate flipped to `linux` and no npm on `PATH`, those four report skipped and the other three pass. Those three use injected runners and never spawn anything, so they cannot depend on npm starting. With the predicate intact and no npm on `PATH`, all four fail at `scripts/test/check-lockfile-sync.test.ts:86 "could not start"` (`spawnSync npm ENOENT`), so none passes without npm. Windows itself is **not measured** |
| low, `diff.error` untested          | **fixed**. Replacing the branch with `if (false)` turns `scripts/test/check-lockfile-sync.test.ts:212 "could not run git diff: spawn git ENOENT"` red, 1 of 7. The rest of gate 2's mutation set still goes red on its own assertions                                                                                                                                                                                                                                                                                                                                                                  |
| low, repins in repo-47's own record | **refuted as a requirement.** `node scripts/citations-gate.mjs --against origin/main` exits 0 with `137 enforced, 0 failing`, and repo-47's record is only reported, not failed. The measurement itself holds: at `b658179` repo-47's record has 0 moved citations, and at `f4c6f82` it has 5, from this branch's `ci.yml` and `preflight.test.ts` lines. See the first low below                                                                                                                                                                                                                      |

- **low** · **Landing adds 6 moved citations to records on `main` that CI reports but does not fail.** repo-47's record goes from 0 to 5 (`ci.yml` 119, 173 and 185; `preflight.test.ts` 2137 and 2204), and dl-72 goes from 0 to 1 (`release-please-config.json` 33, the owner's chosen route). I measured this by running `node scripts/citations.mjs <record> --section Review` at `b658179` and at `f4c6f82`. repo-50, repo-64, repo-67 and repo-75 were already moved at `b658179`. Under repo-47's rule this is by design, and the next branch that edits either record will repin them.
- **low** · The round-3 Log calls the six other reported records "the same kind". Only repo-47 and dl-72 are this branch's displacement; the other four predate it on `main`. The Log also calls the skip unmeasured; it is measured above by flipping the predicate.
- **dropped** · Under the return-before-install mutation, the hidden-lockfile test passes because it never checks the return value. The other six tests catch that mutation, so this is not a defect.
- **findings** · The hunt over round 3 returned 3; 2 carried, 1 dropped.
- Paths: `git diff --name-only origin/main...f4c6f82` lists 18 paths, none under `tools/`. dl-72's blob is `87cc370` at both `origin/main` and `f4c6f82`, so it is byte-identical.
- Pins: round 3 changed 20 citations to `@b658179` (repo-34 ×2, repo-65 ×4, repo-79 ×7, repo-82 ×7). All 20 were resolved against a git show of `b658179`, not the diff: each anchor sits in the pinned line or range and on no other line of the file. The word diff shows nothing else changed in those lines except the table rules oxfmt realigned.
- Commands at `f4c6f82`:
  - `npm run check`: exit 0.
  - `npx vitest run scripts/test/check-lockfile-sync.test.ts scripts/test/preflight.test.ts`: 97 of 97, exit 0.
  - `node scripts/citations-gate.mjs --against origin/main`: exit 0, `137 enforced, 0 failing`.
  - `node scripts/preflight.mjs --base origin/main --title "fix(repo): stamp the lockfile on release and catch drift in CI (repo-46)"`: exit 0, every check ok with `title` included, and `mergeTree` clean against #327, #294 and #284.
  - `/workspaces/tools/node_modules/.package-lock.json` read `01:23:14.500764343` / `d432f0b6…c80e` before and after that preflight run.
- NFR: security n/a · performance ✓ · reliability ✓ · maintainability ✓.

## Log

- **2026-09-14 — filed by the owner's choice, through AskUserQuestion, taking the
  option marked recommended.** Every claim above carries the command that
  produced it. Everything about release-please's behaviour is labelled as read
  through WebFetch's summaries and not pinned to `release-please-action@v5`; none
  of it was run. The relayed claims were each checked, and two were sharpened.
  The lag before `896806c` is the same defect again, not a one-off. The
  `extraneous` entries survive a lockfile-only install, so they are not part of
  this drift and a routine install will not clear them.
- **2026-09-28 — answered by the owner: A and C.** Moved to `ready`.
  Re-checked against `a084170` before asking. The config is unchanged apart
  from the ledger's third entry. The lockfile is in sync today, but only
  because the ledger scaffold `a9878ad` rewrote it, the same carried-by-an-
  unrelated-commit pattern as `896806c`. The defect is live right now: the two
  open release PRs, #284 (downloader 0.8.0) and #294 (planner 0.8.0), each
  change `.release-please-manifest.json`, the `CHANGELOG.md`, `version.txt`
  and `api/package.json`, and neither touches `package-lock.json`
  (`gh pr diff <n> --name-only`). Whichever merges first drifts it again, and
  Build step 1's resync covers that. The `jsonpath-plus` measurement is
  above, under Options.
- **2026-09-30 — built on `repo-46-lockfile-stamp` from `origin/main` at
  `e79b04f`.** Build step 1's resync was a no-op: at `e79b04f` the lockfile
  already matches every `api/package.json` (downloader 0.7.0, planner 0.7.0,
  ledger 0.0.0) — confirmed with a scratch `git archive` extraction and
  `npm install --package-lock-only --offline --ignore-scripts --no-audit
--no-fund`, `diff` against the pre-install copy exits 0. This is the same
  "in sync only because an unrelated commit rewrote it" state the 2026-09-28
  entry names; #284 and #294 are still open and still touch no lockfile
  (unchanged from that entry), so the drift is still live and will land on
  whichever merges first — after this branch merges, that release PR's
  `extra-files` stamp (A) is what should keep it caught up, with CI's new
  step (C) behind it.

  Added A's second `extra-files` entry to all three tools in
  `release-please-config.json`, `$.packages['tools/<tool>/api'].version`
  against `/package-lock.json`, per the Build section and the `jsonpath-plus`
  measurement already recorded under Options. Added C as one step (corrected in round 2: this said "two steps") in
  `.github/workflows/ci.yml`'s `check` job, right after `npm ci` and before
  `npm run check` — kept clear of the citations-gate step at the end of that
  job, which repo-47 edits concurrently, so the two branches' diffs sit in
  different parts of the file.

  **Proved C red-then-green (`Done when` 2) in a throwaway git repo**, not in
  this worktree or the shared checkout: archived this branch's tree,
  `git init` there, committed it as `base`, edited
  `tools/downloader/api`'s lockfile entry from `0.7.0` to `0.6.0` and
  committed that as `stale` (simulating a release commit that stamped
  `api/package.json` but not the lockfile), then ran C's two commands.
  Against `stale`: `npm install --package-lock-only --offline
--ignore-scripts --no-audit --no-fund` exits 0 and rewrites the line back to
  `0.7.0`, then `git diff --exit-code package-lock.json` exits 1 (red),
  printing exactly that one-line diff. Committing that fix and re-running
  both commands: `git diff --exit-code package-lock.json` exits 0 (green).
  Left no trace in this worktree — the throwaway repo lived under this
  ticket's scratch directory and this worktree's own `package-lock.json` was
  restored to match `HEAD` before continuing (`git diff --stat
package-lock.json` prints nothing).

  **Not done, and not this ticket's to do**: `Done when` 1 and 3 need a real
  release PR after this merges, and `Done when` 1 also needs C to have run on
  a GitHub runner, where `--offline`'s dependence on the cache `npm ci` just
  filled is unmeasured (flagged already, under Options and in the new CI
  step's own comment). Status stays `ready` per the builder role page, so this
  branch does not set `awaiting` — that is a `done`-ticket field
  (`docs/01-TICKETS.md`), and Build step 5 is an instruction for whoever lands
  this: write an `awaiting` line naming Done when 1 and 3 — that the next
  release PR's `check` job runs C green and touches `package-lock.json` —
  once the status flips to `done`.

  **Fold-in considered and declined**: nothing else in front of me was small
  and already specified enough to fold in. The `extraneous` workspace entries
  the ticket names are explicitly out of scope for this fix (Build step 2),
  and I found no other already-specified piece of work this change makes
  free.

  **C's step is a script, not the two raw lines the Build section names, and
  this is a change I made rather than asked about.** A raw
  `- run: npm install --package-lock-only …` line in `ci.yml`'s `check` job
  fails `scripts/preflight.mjs`'s own guard, which refuses to spawn any `npm`
  command it does not already recognise as `npm ci` or `npm run check`
  (repo-82) — measured directly: with the raw line in place,
  `npx vitest run scripts/test/preflight.test.ts -t "deriveExtraCiCommands
runs only what no other check already covers"` fails with `ci.yml's check
job runs "npm install --package-lock-only …", an npm step this file does
not recognise …`, the same error `node scripts/preflight.mjs --base
origin/main` reported under `== ciCommands ==`. That guard is deliberate
  and heavily tested (12+ tests in `scripts/test/preflight.test.ts` defend
  it against exactly this shape of unrecognised npm command), so rather than
  weaken it I wrapped C's two commands, in the same order and with the same
  flags, in `scripts/check-lockfile-sync.mjs` — a plain `spawnSync` with
  `shell: false`, no shell operators — and pointed `ci.yml` at
  `node scripts/check-lockfile-sync.mjs` instead. That step is outside the
  npm guard and reaches preflight's ordinary spawn-it-for-real path instead:
  `== ciCommands ==` now reads `ok node scripts/check-lockfile-sync.mjs`.
  Updated the two tests in `scripts/test/preflight.test.ts` that assert the
  exact command list read off the real `ci.yml`
  (`extractCheckJobCommands reads this repo's own ci.yml check job, in
order` and `deriveExtraCiCommands runs only what no other check already
covers`) to include the new step; both pass,
  `npx vitest run scripts/test/preflight.test.ts` — 87 passed (87).

  This is a judgment call, not something I could ask about mid-build, and I
  am flagging it rather than treating it as free: the alternative was to
  leave the raw two-line form and let `ciCommands` fail on every future
  `node scripts/preflight.mjs` run in this repo (and the pinned-output unit
  test fail in `npm test -- --project repo`) until someone else fixed it.
  If the wrapper script is judged wrong — for instance if this repo would
  rather widen `COVERED` itself, or accept the two raw lines and teach
  `ciCommands` to actually spawn a narrow allowlist of safe `npm` commands —
  that is a preflight.mjs design change I did not make and did not want to
  make unreviewed.

  **The wrapper script's own diff moved lines in `scripts/test/preflight.test.ts`
  that three already-merged records cite by line number** (repo-65, repo-79,
  repo-82), a `+2`-line shift from the two array entries I added. Repointed
  all 25 affected citations (7 + 16 + 2) to `scripts/test/preflight.test.ts@e79b04f:<original
line>`, `e79b04f` being the base I branched from, which the citations-gate
  itself confirms still holds every one of those lines' content unchanged —
  the same repair already applied above to the citations `.github/workflows/ci.yml`
  and `release-please-config.json` displaced. `node
scripts/citations-gate.mjs --against origin/main`, re-run as the last
  action after the final `npm run format`: `135 enforced, 0 failing; 6
grandfathered, holding 1 unresolvable, 19 unanchored. 6 entr(y/ies)
compared against origin/main: 0 raised.`

  `npm run check`: exit 0. `npx vitest run --project repo`: 620 passed
  (620). `node scripts/preflight.mjs --base origin/main --title "fix(repo):
stamp the lockfile on release and catch drift in CI (repo-46)"`: `check`
  ok (`npm run check`, `npm test -- --project repo`, `npm test -- --project
downloader` all ok — the downloader suite ran because this branch also
  touches `tools/downloader/docs/work/dl-72-…md`), `ciCommands` ok (all
  three commands, including the new script), `citations` ok (0 failing),
  `review` ok, `mergeTree` ok against both open release PRs (#284, #294)
  alone and scratch-merged — but **`title` fails**, and this is an open
  decision rather than something I resolved:

  ```
  FAIL  "fix(repo): stamp the lockfile on release and catch drift in CI (repo-46)" is type "fix", which reaches a changelog, but every tools/ path
        in the diff is markdown (tools/downloader/docs/work/dl-72-youtube-finds-no-video-because-the-image-has-no-yt-dlp.md) — release-please would cut a
        changelog line and a version for that tool over what is really a docs-only change
  ```

  This is Build step 3's consequence (corrected in round 2: this said step
  1), not something new: adding A's
  second `extra-files` entry to all three tools shifts every line below the
  first edit in `release-please-config.json`, including dl-72's `"Fixes"`
  citation at line 33 (repointed above, under the 2026-09-28-adjacent entry).
  So this branch's diff necessarily touches one file under `tools/downloader/`
  — purely a citation repoint, no functional downloader change — alongside
  the real repo-level fix, and `fix` is a releasing type
  (`release-please-config.json`'s `changelog-sections` does not hide it), so
  release-please would attribute this commit's subject to downloader's
  `CHANGELOG.md` and cut it a version, over a change that touched nothing of
  downloader's but one citation's line number. **Options, recommended
  first:**

  1. **Split the dl-72 repoint into its own tiny pull request**, titled with
     a hidden type scoped to downloader (`docs(downloader): repoint dl-72's
citation displaced by repo-46's config edit`), landing separately from
     this one. Keeps this branch's own title (`fix(repo): …`) accurate and
     clean — its own diff would then touch no `tools/` path at all — at the
     cost of a second small pull request whose merge has to be sequenced so
     `main` is never left with dl-72's citation `MOVED` (this branch's own
     `release-please-config.json` edit is what displaces it, so the two
     either merge in the same window or the repoint merges first).
     **Corrected in round 2:** the pin to `e79b04f` resolves on `main`
     today, so the dl-72 change can always merge first.
  2. **Give this whole branch a hidden type** (`build` or `ci` both fit: the
     change is `.github/workflows/ci.yml` and release tooling config,
     nothing shipped to an end user) instead of `fix`. Costs nothing
     functionally — `release-please-config.json` has no `tools/repo`
     package, so a hidden-type commit here loses no changelog anywhere that
     would otherwise have gained one — but it means this ticket's own
     `kind: fix` does not read straight off its commit type, and a reader of
     `git log` sees `ci`/`build` for what the ticket itself calls a defect.
  3. **Leave it as `fix(repo)` and accept the spurious downloader changelog
     line and version bump.** Not recommended: it is exactly what `checkTitle`
     exists to catch, and CLAUDE.md's own rule ("a commit that touches two
     tools lands in both changelogs under one sentence written for one of
     them … meaning two pull requests") names this shape directly.
     **Corrected in round 2:** the cost was overstated as a version bump.
     #284 (`chore(downloader): release 0.8.0`) is open, so a `fix` adds one
     line to that pending 0.8.0 changelog; it causes a new version only if
     #284 merges first.

  I did not choose one: **I have no ship authority on this branch, and the
  real pull request title is chosen at landing, not by this commit's own
  subject** — `node scripts/preflight.mjs --base origin/<base>` with no
  `--title` falls back to `git log -1 --format=%s`, which is this branch's
  own last commit right now, but that is a fallback for an unspecified
  title, not a claim that this commit's subject is the one that ships.
  Left the commit as `fix(repo): …` — an accurate description of the change,
  matching the ticket's own `kind: fix` — rather than pre-empting the
  decision by mistyping it.

- **2026-09-30 — round 2, after gate 1 at `cff47a6` (CONCERNS: three meds,
  four lows) and the owner's three answers.** Built from `cff47a6`.
  - **The title decision, answered by the owner:** rebase onto `main` after
    repo-47 merges, drop only the dl-72 repoint (keep the nine `repo-`
    pins), and land as `fix(repo): stamp the lockfile on release and catch
drift in CI (repo-46)`. repo-47 makes the citations gate enforce only
    records a branch changes, so an untouched dl-72 is excused. This
    overrode the builder's option 1 and the gate's option 2 (`ci(repo):`).
    **Not done yet, on purpose:** the rebase waits for repo-47's merge, and
    at it the records this branch edits (repo-29, repo-31 and the others)
    become enforced under repo-47's rule, so any citation there that
    repo-47's own changes moved fails the gate until pinned. Until then
    `node scripts/preflight.mjs --base origin/main --title "fix(repo): …"`
    still fails `title` (exit 8), as expected.
  - **M1 reproduced, then fixed.** Reproduced in a scratch copy whose
    `node_modules/.package-lock.json` is a symlink to a scratch stand-in for
    the shared file: running round 1's `check-lockfile-sync.mjs` moved that
    file's mtime (`01:42:15.176` to `01:42:24.485`); its hash did not change
    because this manifest set matched the one it was built from. Fixed by
    the owner's option (the gate's option 1): the script now stages the root
    `package.json`, the lockfile, an `.npmrc` if any, and every workspace
    `package.json` into an `os.tmpdir()` directory, installs there, and
    compares the regenerated lockfile with the committed one
    (`git diff --no-index`); the directory is removed in a `finally`.
    **From outside the script:** in this farm worktree,
    `node scripts/check-lockfile-sync.mjs` exit 0, 0.59 s, and
    `stat`/`sha256sum` of `/workspaces/tools/node_modules/.package-lock.json`
    before and after read `2026-09-30 01:23:14.500764343` /
    `d432f0b6…c80e` both times; `ls -d /tmp/lockfile-sync-*` is empty
    after. Drifted case on the real tree (`package-lock.json:6228` set to
    `0.6.0`): exit 1, the diff shows only that line, and the worktree
    lockfile still says `0.6.0` afterwards (not repaired in place); reverted.
  - **M2, `scripts/test/check-lockfile-sync.test.ts`, 6 tests**, plus one
    `include` line in `scripts/test/tsconfig.json` (TS6307 otherwise).
    Cases: in sync (exit 0, directory byte-identical); one version behind
    (exit 1, diff names both versions, stderr says out of sync, caller's
    files unchanged); a sentinel `node_modules/.package-lock.json` with an
    old mtime untouched and no `node_modules/a` link created; the temp
    directory gone after both verdicts; a spawn that never started (`error`
    set, `status` null) exits 1 naming it; an install that exits 7 returns 7
    and never runs `git`. **Red first against round 1's script**
    (`git show HEAD:scripts/check-lockfile-sync.mjs` swapped in, then
    restored): 5 of 6 fail, `npx vitest run
scripts/test/check-lockfile-sync.test.ts`. Two of the five (in sync, and
    drifted) fail there with exit 129 because round 1 ran `git diff` in the
    fixture, which is not a git repository; that is not the behaviour they
    are meant to pin, so the honest red cases are the other three — the
    hidden lockfile rewritten (`expected '{ "name": "fx", …' to be
'sentinel\n'`), the temp-directory case, and the missing spawn-error
    message. Green now: 6 of 6.
  - **L1** Log claims corrected in place above (each marked "corrected in
    round 2"): "two steps" is one step; the dl-72 repoint follows from Build
    step 3, not 1; option 3's cost is one line in #284's pending 0.8.0
    changelog, not a new version unless #284 merges first; option 1's merge
    order can always put dl-72 first, since the `e79b04f` pin resolves on
    `main` today. The title decision above is recorded beside them.
  - **L2** "same flags": the script and its two comments now say
    `--no-audit --no-fund` are additions to the Build section's flags.
    `ci.yml`'s comment kept its line count, so no citation moves.
  - **L3** Eleven anchored citations outside any enforced `## Review`,
    correct at `e79b04f`, are now pinned to it: `repo-31` lines 16, 274,
    275, 299; `repo-24` 53, 369; `repo-29` 271, 1024; `history.md` 1521,
    1522, 3826. `node scripts/citations.mjs <file>` reports the `@e79b04f`
    ones `ok` in each of the four files. `repo-29:1096` (`ci.yml:326`) is not
    among them: that coordinate was already wrong at `e79b04f`, so a pin
    would fail, and it is left alone.
  - **L4** `install.error` and `diff.error` are read; a spawn that never
    started prints `could not run npm: <message>` and exits 1. Windows
    itself is **unmeasured**: the check job runs on Linux and the tested
    path is the injected error.
  - `npm run check` exit 0. `npx vitest run
scripts/test/check-lockfile-sync.test.ts scripts/test/preflight.test.ts`:
    93 passed (93). `npm test -- --project repo`: 626 passed (626), 620
    before. `node scripts/citations-gate.mjs --against origin/main` exit 0,
    `135 enforced, 0 failing`. `node scripts/preflight.mjs --base origin/main --title "fix(repo): stamp the lockfile on release and catch drift in CI (repo-46)"` at `d8fdb3d`: exit 8, `title` only
    (the expected dl-72 failure, unchanged); `check`, `ciCommands` (incl. `ok
node scripts/check-lockfile-sync.mjs`), `citations` and `mergeTree` ok,
    `mergeTree` now also against #325. Across that whole run the shared
    `node_modules/.package-lock.json` read `2026-09-30 01:23:14.500764343` /
    `d432f0b6…c80e` before and after.

- **2026-09-30 — round 3, after gate 2 at `484f0d2` (CONCERNS: one med, two
  lows; M1, M2 and L1–L4 verified fixed) and repo-47 merging (#326 as
  `9fadda7`, then #325 as `b658179`).**
  - **Merged `origin/main` (`b658179`), not rebased**, clean, with a
    conventional message. Farm and build per `common.md`; `npm run build`
    exit 0.
  - **The dl-72 repoint is dropped**, as the owner decided: the file is
    restored to its content on `origin/main`. `git diff --name-only
origin/main` over the working tree, filtered for `^tools/`, matches 0
    lines. Preflight's `title` now reads `ok "fix(repo): stamp the lockfile
on release and catch drift in CI (repo-46)" — type and paths agree`.
    `node scripts/citations-gate.mjs` reports dl-72 as `MOVED`
    (`release-please-config.json:33`) under "Moved in records not changed
    since the merge base", reported and not failed, exactly as the owner's
    dry run predicted.
  - **Pins changed, only what the gate failed in records this branch edits**
    (first run after the merge: 4 records, 20 citations; after: `137
enforced, 0 failing`). All resolved by running the gate, at the
    coordinate it reported. The content is unchanged; repo-47 moved it.
    `scripts/preflight.mjs` ones pinned to `b658179` at the line the gate
    named: repo-65 record lines 173 (`1580`→`1623`), 198 (`1486`→`1529`),
    201 (`1574`→`1617`), 219 (`1470`→`1513`); repo-79 76 (`402`→`403`), 78
    (`1091`→`1124`, `1128`→`1161`), 115 (`1235`→`1268`), 116
    (`625`→`626`), 124 (`432`→`433`), 125 (`1230`→`1263`); repo-82 92
    (`432`→`433`), 93 (`1231`→`1264`, `1247`→`1289`), 121 (`633`→`634`),
    123 (`432`→`433`, `489`→`490`), 128 (`605`→`606`). repo-34 lines 153
    and 163: `ci.yml:264-285` became `ci.yml@b658179:264-285` (the anchor is
    inside that range at `b658179`; the gate's "at 294" is this branch's
    own +15-line `ci.yml` edit on top). The earlier `e79b04f` pins are kept.
  - **Gate 2's third finding, corrected by measurement:** the claim that
    repo-47's own record needs repins does not hold. Its five moved
    citations (`ci.yml` 185, 119, 173; `preflight.test.ts` 2204, 2137) are
    in a record this branch does not edit, so they are reported and not
    failed, and I pinned none. The gate's other 6 reported items
    (repo-50, 64, 67, 75, dl-72) are the same kind. Preflight's `citations`
    and `mergeTree` print them as `note`, exit 0.
  - **Gate 2's med, the Windows spawn:** owner's choice, skip and assert.
    `scripts/test/check-lockfile-sync.test.ts` now declares
    `realNpm = test.skipIf(process.platform === "win32")` for the four tests
    that run `npm` for real, with a comment saying why they are skipped and
    not resolved and citing `.claude/rules/testing.md`, the paragraph whose
    bold lead is "A test that runs a tool out of `node_modules` cannot spawn
    its `bin` directly, because Windows does not honour a shebang" (it is a
    bold lead, not a heading). `quietRun` asserts
    `expect(result.error).toBeUndefined()`. **Red before:** `PATH` holding
    only `node` (`/usr/bin/node node_modules/vitest/vitest.mjs run
scripts/test/check-lockfile-sync.test.ts`): 2 failed, 4 passed, the two
    failures being `expected 1 to be +0` and `expected '' to match`. **After,
    same `PATH`:** 4 failed, 3 passed, all four failures
    `could not start npm: expected Error: spawnSync npm ENOENT … to be
undefined`. The skip itself is **unmeasured**: it gates on
    `process.platform`, which I did not fake, and Windows was not run.
  - **Gate 2's first low, `diff.error`:** new last test, "a git that never
    started says so and fails, instead of reading as a clean diff".
    **Red first by mutation:** `if (diff.error !== undefined) {` replaced by
    `if (false) {`, `npx vitest run scripts/test/check-lockfile-sync.test.ts`:
    1 failed, 6 passed; restored, 7 of 7.
  - `npm run check` exit 0. `npx vitest run
scripts/test/check-lockfile-sync.test.ts scripts/test/preflight.test.ts`
    exit 0, 97 of 97. `npm test -- --project repo` exit 0, 648 of 648
    (before the last lint-only move of a test helper to module scope; the two
    spec files above were re-run after it). `node scripts/citations-gate.mjs
--against origin/main` exit 0, `137 enforced, 0 failing`. `node
scripts/preflight.mjs --base origin/main --title "fix(repo): stamp the
lockfile on release and catch drift in CI (repo-46)"` at `d7a9b22`:
    **exit 0**, every check ok, title included, `mergeTree` ok against #294
    and #284 (#325 has merged).

- **2026-10-05 — `awaiting` added, from the review of repo-88's answer (PR
  #357).** Gate 3 left Done when 1 and 3 waiting on a release, and the ticket
  landed `done` with nothing recording that. `git log c07f984..origin/main
--grep='^chore(.*): release'` printed nothing today, so no release has
  happened since #328 and both lines are still owed. Whoever reads the first
  release commit deletes the line.

- 2026-10-10 — The `awaiting` line closed. Done when 1 and 3 waited on the
  first release commit after #328 (`c07f984c`). That is `b0cb014b`,
  `chore(downloader): release 0.8.0 (#284)`, the oldest commit printed by
  `git log --reverse --grep='^chore(.*): release' c07f984c..origin/main`.
  **1:** `git show --stat b0cb014b` lists `package-lock.json`; #284's head
  (`1fa0ef17`) contains `c07f984c` (`git merge-base --is-ancestor`), and its
  CI run's `check` job ran `node scripts/check-lockfile-sync.mjs` with
  conclusion `success` (`gh run view 37148143142 --json jobs`). **3:** in a
  detached scratch worktree at `b0cb014b`, `npm install --package-lock-only
--ignore-scripts` exited 0 and `git diff --stat` printed nothing. All four
  later release commits (#294, #337, #369, #360) also touch the lockfile.
