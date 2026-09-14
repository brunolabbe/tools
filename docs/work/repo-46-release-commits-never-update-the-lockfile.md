---
id: repo-46
tool: repo
title: Release commits never update package-lock.json, so every npm install rewrites two version lines
kind: fix
status: needs-decision
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

## Options — none chosen

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

Blocked on the decision above. Whichever option is chosen:

1. Resync the two stale version lines in the same change, with
   `npm install --package-lock-only` in a scratch copy, **not** in a worktree
   or the shared checkout. Confirm the diff is exactly the two lines shown in
   reproduction 4.
2. Leave the three `extraneous` entries alone unless the decision says
   otherwise. Removing them is a separate edit with its own diff to review.
3. For A or D, the proof arrives with a release PR, not with this branch. Record
   it in `awaiting`.

## Done when

1. `git log --grep='^chore(.*): release' origin/main -- package-lock.json` lists
   the first release commit made after the fix lands, or, for C, that release
   PR's CI shows the new step failing before the lockfile is fixed and passing
   after.
2. After that release, `npm install --package-lock-only` in a scratch extraction
   of `main` leaves `package-lock.json` unchanged (`diff` exit 0).
3. `/api/health` still reports the released version for both tools.

## Log

- **2026-09-14 — filed by the owner's choice, through AskUserQuestion, taking the
  option marked recommended.** Every claim above carries the command that
  produced it. Everything about release-please's behaviour is labelled as read
  through WebFetch's summaries and not pinned to `release-please-action@v5`; none
  of it was run. The relayed claims were each checked, and two were sharpened.
  The lag before `896806c` is the same defect again, not a one-off. The
  `extraneous` entries survive a lockfile-only install, so they are not part of
  this drift and a routine install will not clear them.
