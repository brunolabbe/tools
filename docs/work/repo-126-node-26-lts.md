---
id: repo-126
tool: repo
title: Move the runtime from Node 22 to Node 26 LTS
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
note: not startable before 2026-10-28, when Node 26 enters LTS — read the release schedule first
---

# repo-126 — Move the runtime from Node 22 to Node 26 LTS

**Not before 2026-10-28.** The Node release schedule gives Node 26 `lts:
2026-10-28`. Until that date Node 26 is "Current", not LTS, and this ticket does
not start. Build step 1 is the check that it has.

## Why

The runtime pins say Node 22: the three tool workflows and the `check` and
`test` jobs of `ci.yml`, the planner and ledger images, the devcontainer, and
root `engines.node`. The downloader image takes its Node from its Playwright
base, which is not a pin in this repo: the base's build arguments carry
`NODE_VERSION=24` (a registry reading of the image config, not `node --version`
run in it), so the downloader image already runs Node 24 while CI tests the
tool on 22.

The release schedule (`nodejs/Release`, `schedule.json`, read on 2026-10-25;
the output is in the Log) gives: Node 22 in maintenance since 2025-10-21, end
of life 2027-04-30; Node 24 LTS since 2025-10-28, in maintenance since
2026-10-20, end of life 2028-04-30; Node 26 LTS from 2026-10-28, maintenance
from 2027-10-20, end of life 2029-04-30. The repo should land on the line that
is in active LTS, and that is 26 from 2026-10-28.

The owner decided this on 2026-10-25, during repo-123 (jsdom 30, PR #647). The
first question was whether the repo should move its runtime off 22. The options
were (1) file this ticket, with repo-123 raising only root `engines` to
`>=22.22.2` — recommended, chosen; (2) the same ticket, with repo-123 left
alone; (3) do the move inside repo-123. The owner first proposed Node 24 "since
it's the LTS", before the schedule above was read; after reading it the owner
chose **Node 26, from 2026-10-28** (the Log, 2026-10-25, answer 1, has the
options).

Facts that make this more than a version bump:

- jsdom 30.1.3 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, and the root
  `engines.node` on `main` still reads `>=22.0.0`. A `>=26.0.0` floor admits
  every lockfile entry that declares an `engines.node`: 0 of 363 entries on
  `main`'s lockfile and 0 of 358 at repo-123's head reject 26.0.0 (the Log has
  the scan). The floor also leaves Node 25 out, which five entries at
  repo-123's head already exclude and which is end of life.
- `better-sqlite3` is pinned at `^12.4.1` in three packages, and the repo-122
  Log (PR #636, branch `repo-122-better-sqlite3-13`) records that a lockfile
  `npm ci` compiles `better-sqlite3` 13.0.3 from source. Whether 12.x has a
  Node 26 prebuilt, or compiles there, is not measured anywhere in the repo.
  This is the likeliest stop in the ticket, so it is measured first (Build
  step 2).
- `ffmpeg-static` downloads its binary at install time; whether that works on
  Node 26 is likewise not measured.
- `@types/node` is `^26.1.2` (root `package.json`), so the types and the
  runtime disagree before this ticket starts and agree after it.
- Root `engines.node` is mirrored in the lockfile's root package entry
  (`package-lock.json`, `packages[""].engines.node`), and
  `scripts/check-lockfile-sync.mjs` fails on a `package.json` edit that the
  lockfile does not follow. Dry-run by gate 1 on its own tree (the base plus
  this ticket; its saved diff shows `-">=22.0.0"`): changing `package.json`
  alone exits 1, changing both files exits 0. The orchestrator ran the same
  dry run on a scratch worktree of repo-123's `8b96fbd9` on 2026-10-25:
  `package.json` alone gave sync exit 1, and both files gave exit 0. So the
  engines edit is a two-file edit.
- Node 26 bundles a different npm from Node 22's 10.9.9 (Build step 3 measures
  which). `.claude/rules/dependency-updates.md` describes a `libc` difference
  between npm 10's and npm 11's lockfiles, and `check-lockfile-sync.mjs` runs
  whichever `npm` is on PATH in the `check` job.

## Build

1. **Date and LTS check first, and stop if it fails.** The build day is on or
   after 2026-10-28. Take two readings and record both in the Log:
   `curl -s https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`
   (the `v26` entry has an `lts` date on or before the build day) and
   `curl -s https://nodejs.org/dist/index.json` (newest entry per major; the
   newest `v26` entry carries an `lts` name, not `false`). If the build day is
   before 2026-10-28, or either reading says Node 26 is not LTS, stop before
   any change and report; the owner's choice was Node 26 _as LTS_, not Node 26
   as Current. A Node 26 that has dropped out of the schedule's plan is the
   owner's decision to remake, not this ticket's.
2. **Native modules on Node 26, before anything moves.** Use Node 26 in a
   throwaway worktree (not the farm), a clean `npm ci`. Record, for
   `better-sqlite3` (locked at 12.x; `^12.4.1` in
   `tools/downloader/api/package.json`, `tools/ledger/api/package.json` and
   `tools/planner/api/package.json`), whether the install used a prebuilt or ran
   `node-gyp rebuild`, with the gyp line if it ran, and whether a `:memory:`
   database opens. For `ffmpeg-static` (`^5.2.0` in
   `tools/downloader/engine/package.json`), record whether its binary path
   exists and `-version` prints. **If `better-sqlite3` 12.x neither installs
   nor opens on Node 26, stop and report the options** (a newer
   `better-sqlite3` major, which repo-122 held back; a toolchain that compiles
   it; staying on 24 for the tools that load it): nothing after this step is
   worth doing on a runtime the databases cannot open on.
3. **Lockfile check under Node 26's npm, baseline.** Record `npm --version`
   under Node 26, then run `node scripts/check-lockfile-sync.mjs` against the
   unchanged tree. If it exits 0, go on. If it fails, read the diff it prints:
   a hunk on a `libc` field is the npm 10 against npm 11 difference that
   `.claude/rules/dependency-updates.md` describes, and the options are to pin
   npm in the `check` job or to regenerate the lockfile under Node 26's npm
   with the new fields accepted; stop and report them. A baseline failure on
   anything else is a finding to report.
4. **Move the pins to 26**, in these files and no others (plus
   `tools/downloader/Dockerfile` only if step 5's decision edits it):
   - `.github/workflows/ci.yml` lines 105 and 309 (`node-version: 22`, the
     `check` and `test` jobs);
   - `.github/workflows/downloader.yml` line 92, `.github/workflows/planner.yml`
     line 70, `.github/workflows/ledger.yml` line 64;
   - `tools/planner/Dockerfile` line 16 and `tools/ledger/Dockerfile` line 14
     (`ARG NODE_VERSION=22-bookworm` becomes `26-bookworm`; the runtime stage's
     `-slim` follows the same arg). The Docker Hub tags `node:26-bookworm`,
     `node:26-slim` and `node:26-bookworm-slim` exist (HTTP 200 on the tag API,
     2026-10-25);
   - `.devcontainer/Dockerfile` line 19 (`ARG NODE_MAJOR=22`) and
     `.devcontainer/devcontainer.json` line 19 (`"NODE_MAJOR": "22"`);
   - root `package.json` line 77, `engines.node` to `>=26.0.0`, **and the
     lockfile's root package entry** (`package-lock.json`, `packages[""]`,
     line 25 on `main`), the same value. Edit both in this step, before any
     script reads the result; that is the whole lockfile change this step
     makes.

   **The order with repo-123 does not matter, and the higher floor wins.**
   repo-123 (PR #647, branch `repo-123-jsdom-30`) raises the same two lines to
   `>=22.22.2`; at its head `c10d2814` both files read that. If it merged
   first, this step replaces its line in both files. If this lands first,
   repo-123's raise conflicts on those lines when it merges; keep `>=26.0.0`,
   never the lower floor.

5. **Downloader image.** `tools/downloader/Dockerfile` takes Node from its base,
   `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble` (line 22, with
   `PLAYWRIGHT_VERSION=1.62.1` on line 21), and the Dockerfile has no other
   Node reference. The base's build arguments say `NODE_VERSION=24` (Why), so
   expect Node 24, and that is not Node 26. Read the base's Node: from a
   `node --version` run in the image if a Docker daemon is available, or from
   the image config's build arguments through the registry if not, and say in
   the Log which one it was; the registry reading is not a `node --version`.
   Then stop and report the options for the owner: (a) keep the downloader on
   its base's Node 24 and record the mismatch with CI as the accepted state;
   (b) a newer Playwright base that carries Node 26, if one exists; (c) install
   Node 26 onto the base, as `.devcontainer/Dockerfile` does with NodeSource.
   If the reading is already v26.x, record it and go on.
6. **Devcontainer prose.** `.devcontainer/Dockerfile` line 39 reads "The repo
   pins Node 22 on purpose (see CLAUDE.md on type stripping)". No `CLAUDE.md`
   on `main` has a section on type stripping, so the reference dangles. Rewrite
   that comment to name the reason the pin is 26 now, or delete it if no reason
   remains. Then `.devcontainer/README.md` line 3 ("Node 22") and line 30
   ("Node 22 on Playwright's base") change; line 30 says what step 5's decision
   made true.
7. **Rule sentences.** `.claude/rules/testing.md` lines 48–49 say the pinned
   Node is 22.15 and "cannot strip TypeScript types without a flag". Put a
   one-line `.ts` file in the scratch directory, run `node <file>.ts` under
   Node 26 with no flag, record the command and output in the Log, and rewrite
   the sentence to the measured fact. `.claude/rules/dependency-updates.md`
   says "npm 10 rewrites the lockfile" (line 22), "the npm 10.9.9 Node 22
   ships" (line 27), "a plain `npm install` on npm 10" (line 31) and "CI's
   npm 10" (line 33); the whole recipe assumes CI's npm is the older one, so
   rewrite those four against step 3's `npm --version` and its outcome, not
   only the one on line 27. Read `CLAUDE.md` line 77 ("why npm 10.9.9 cannot do
   the update") afterwards; if the rewrite makes it false, put the proposed
   line in the report and do not edit `CLAUDE.md`.
8. **Types.** Keep `@types/node` at `^26.1.2` (root `package.json`, line 60)
   unless `npm run check` fails with it on Node 26. Record the major the tree
   carries after the move, and why. A change here changes `package.json` and
   the lockfile's root entry together, and the lockfile's
   `node_modules/@types/node` entry (`version`, `resolved`, `integrity`) moves
   with it; the Log names the lines.
9. **Lockfile check, after the edit.** Run `node scripts/check-lockfile-sync.mjs`
   on the tree with steps 4 and 8 applied, under Node 26's npm. A hunk on
   `engines` means a mirror edit was missed in step 4 or 8, not the `libc`
   difference; fix it and run again. A hunk on the `node_modules/@types/node`
   entry's `version`, `resolved` or `integrity` is expected when step 8 changed
   `@types/node`, and is named in the Log. A hunk on `libc` only is step 3's
   fork.
   The target is exit 0.
10. **Local checks.** `npm run build`, then `npm run check` on Node 26 (lint,
    format, typecheck). The build comes first: `api` reads `engine` and
    `contract` through their `dist`.
11. **e2e, by path.** Run `tools/downloader/e2e/layout.spec.ts`,
    `tools/planner/e2e/layout.spec.ts` and `tools/ledger/e2e/layout.spec.ts`
    on Node 26 and record each count. These are the three layout specs; the
    other downloader and planner e2e specs need a live service or browser
    session and are not run locally. They do run in CI: the workflows'
    `e2e` jobs are the only place the full suites run on the new Node (Done
    when 10).
12. **Devcontainer.** Build `.devcontainer/Dockerfile` if the sandbox allows it,
    and record its `node --version` line (the Dockerfile's own test on lines
    51–52). If it cannot be built here, say so in the Log. The sandbox has no
    Docker daemon (gate 1 measured `docker info`), so expect "unmeasured".
13. **CI readings on the PR head.** `test (windows-latest, informational)` in
    `ci.yml`'s `test` matrix is informational; read it on the PR head and do not
    grade it as blocking. The `e2e` jobs of the three tool workflows (Done when 10) are read the same way as the `check` and `docker` jobs: `gh pr checks`,
    naming the head sha.

## Done when

- The build day is on or after 2026-10-28, and the Log holds the release
  schedule and the release index read on it, with the newest `v26` entry's
  `lts` name and the schedule's `v26` `lts` date. If either says Node 26 is not
  LTS, Build step 1 applies and nothing else on this list is built.
- `git grep -n -E "node-version: 22|NODE_VERSION=22|NODE_MAJOR=22|\"NODE_MAJOR\": \"22\"" -- .github tools .devcontainer` prints nothing on the PR head, and `git grep -n -E "node-version: 26|NODE_VERSION=26|NODE_MAJOR=26|\"NODE_MAJOR\": \"26\"" -- .github tools/planner tools/ledger .devcontainer` prints 9 lines (the 9 the first grep prints on `main`).
- `git diff --name-only origin/main...HEAD` lists exactly these paths:
  `.github/workflows/ci.yml`, `.github/workflows/downloader.yml`,
  `.github/workflows/planner.yml`, `.github/workflows/ledger.yml`,
  `tools/planner/Dockerfile`, `tools/ledger/Dockerfile`,
  `.devcontainer/Dockerfile`, `.devcontainer/devcontainer.json`,
  `.devcontainer/README.md`, `package.json`, `package-lock.json`,
  `.claude/rules/testing.md`, `.claude/rules/dependency-updates.md`,
  `docs/work/repo-126-node-26-lts.md`; plus `tools/downloader/Dockerfile` only
  if Build step 5's decision edits it, and the Log says which.
- `node -p "require('./package.json').engines.node"` and `node -p
  "require('./package-lock.json').packages[''].engines.node"` both print
  `>=26.0.0`. The lockfile hunks `git diff origin/main...HEAD -- package-lock.json`
  prints are that engines line, plus the `@types/node` lines if Build step 8
  changed them, plus whatever Build step 3's decision forced, each named in the
  Log; no other hunk.
- `git grep -n -E "Node 22|22\.15|npm 10\.9\.9 Node 22|npm 10 rewrites|CI's npm 10|on npm 10|CLAUDE\.md on type stripping|cannot strip" -- .devcontainer .claude/rules` prints nothing on the PR head (it prints 9 lines on `main`).
- The Log holds the output of `node <file>.ts` under Node 26 with no flag (Build step 7), and the rewritten sentence in `.claude/rules/testing.md` states that result. The Log holds `npm --version` under Node 26, and the rewritten `.claude/rules/dependency-updates.md` names that npm and an update recipe consistent with the npm CI's `check` job runs.
- `ci.yml`'s `check` job and its `test (ubuntu-latest)` job conclude success on the PR head, with the head sha in the Log.
- `test (windows-latest, informational)` on the PR head is read: pass, or a red leg named with its failing test and the latest reading of that leg on `main`.
- The `docker` job of each of `.github/workflows/downloader.yml`, `planner.yml` and `ledger.yml` concludes success on the PR head, building `tools/downloader/Dockerfile`, `tools/planner/Dockerfile` and `tools/ledger/Dockerfile` respectively.
- These four `e2e` jobs conclude success on the PR head, the only runs of the full e2e suites on Node 26: `e2e (direct)` and `e2e (sniffer)` of `.github/workflows/downloader.yml`, `e2e` of `.github/workflows/planner.yml`, and `e2e` of `.github/workflows/ledger.yml`.
- The Log holds the Node version of `mcr.microsoft.com/playwright:v1.62.1-noble` and the Build step 5 decision taken, and either the version reads v26.x after it, or the owner's Build step 5 answer keeps the base's Node 24 and the Log records that reading (registry or `node --version`), or the Log names the downloader image's Node as unmeasured. A registry reading of the build arguments is named as that and not as `node --version`.
- The Log holds, for `better-sqlite3` and for `ffmpeg-static`, the install result on Node 26 (prebuilt or compiled), the command that showed it, and the open-the-binary check from Build step 2.
- `node scripts/check-lockfile-sync.mjs` exits 0 under the npm Node 26 bundles, and the Log names that npm version.
- `npm run check` exits 0 on Node 26, and the Log names the `@types/node` major the tree carries.
- `tools/downloader/e2e/layout.spec.ts`, `tools/planner/e2e/layout.spec.ts` and `tools/ledger/e2e/layout.spec.ts` each pass on Node 26, with each test count in the Log.
- Either `.devcontainer/Dockerfile` builds and its Node 26 test passes, or the Log names the devcontainer build as unmeasured.

## Log

- 2026-10-25: filed on the owner's decision, taken during repo-123 (PR #647,
  draft, stacked on `repo-121-vite-8-vitest-5`, PR #643). Options were: (1) this
  ticket, with repo-123 raising only root `engines` to `>=22.22.2`, recommended
  and chosen; (2) this ticket, repo-123 left alone; (3) the move inside repo-123.
  The owner proposed 24 because it is the LTS.
- 2026-10-25: release index, `curl -s https://nodejs.org/dist/index.json`,
  newest entry per major (the output is `version date lts`; majors 21 and below
  are omitted here; gate 1's F5 corrected "18"):

  ```
  v26.12.1 2026-10-21 lts=false
  v25.9.0 2026-03-31 lts=false
  v24.22.1 2026-10-20 lts=Krypton
  v23.11.1 2025-05-14 lts=false
  v22.23.4 2026-10-20 lts=Jod
  ```

- 2026-10-25: pins on `origin/main` at `9d5f7d26`, from `git grep`:

  ```
  .github/workflows/ci.yml:105:          node-version: 22
  .github/workflows/ci.yml:309:          node-version: 22
  .github/workflows/downloader.yml:92:          node-version: 22
  .github/workflows/ledger.yml:64:          node-version: 22
  .github/workflows/planner.yml:70:          node-version: 22
  package.json:77:    "node": ">=22.0.0"
  tools/ledger/Dockerfile:14:ARG NODE_VERSION=22-bookworm
  tools/planner/Dockerfile:16:ARG NODE_VERSION=22-bookworm
  tools/downloader/Dockerfile:21:ARG PLAYWRIGHT_VERSION=1.62.1
  tools/downloader/Dockerfile:22:ARG BASE=mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
  .devcontainer/Dockerfile:19:ARG NODE_MAJOR=22
  .devcontainer/devcontainer.json:19:      "NODE_MAJOR": "22",
  ```

  `.devcontainer/Dockerfile:39` carries the dangling "CLAUDE.md on type
  stripping" reference (Build step 6).

- 2026-10-25: the engines raise is not on PR #647 yet. Its head `8b96fbd9` still
  reads `"node": ">=22.0.0"` in `package.json`, and its body says the
  engines line is "Recorded in the ticket's Log, not changed here". The owner's
  option (1) has repo-123 make that change, so the raise is open, not merged.
  This ticket does not depend on it (`depends_on: []`).
- 2026-10-25: `@types/node` is `^26.1.2` at root `package.json` line 60, so the
  types already sit on a different major from the runtime.
- `difficulty: standard`, the value the dispatch named, because the format
  requires the field until `done`. The owner can re-rate it.
- 2026-10-25, owner's answers after gate 1 (CONCERNS at `f55141f6`). Each is
  recorded before the work it changes; the lines it supersedes are left above,
  unedited.
  1. **Runtime target.** The premise changed since filing. The release schedule,
     `curl -s https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`,
     read on 2026-10-25:

     ```
     v22 {"start":"2024-04-24","lts":"2024-10-29","maintenance":"2025-10-21","end":"2027-04-30","codename":"Jod"}
     v24 {"start":"2025-05-06","lts":"2025-10-28","maintenance":"2026-10-20","end":"2028-04-30","codename":"Krypton"}
     v25 {"start":"2025-10-15","maintenance":"2026-04-01","end":"2026-06-01"}
     v26 {"start":"2026-05-05","lts":"2026-10-28","maintenance":"2027-10-20","end":"2029-04-30","codename":""}
     ```

     Node 24 entered maintenance on 2026-10-20; Node 26 enters LTS on
     2026-10-28. Options: (a) Node 26 from 2026-10-28, recommended; (b) Node 24
     now; (c) the builder chooses at Build step 1's stop. **The owner chose (a)**,
     which matched the recommendation and overrode the owner's own earlier
     proposal of 24 "since it's the LTS", made before the schedule was read. The
     ticket is retargeted to Node 26 and is not startable before 2026-10-28.
     The Log lines above that say 24 are the filing's, superseded by this one.

  2. **`Done when` 8** (gate 1's F2: the proof needs a Docker daemon that the
     sandbox does not have and no CI job prints `node --version`). Options: (a)
     reword the line like the devcontainer line, "or the Log names it
     unmeasured"; (b) add a step to the downloader workflow's `docker` job that
     prints `node --version` (recommended); (c) read the image's build history
     from the registry. **The owner chose (a)**, which overrode the
     recommendation.
  3. **Round scope.** Options: gate 1's F1 plus the lows the dispatch stated
     (recommended); F1 plus every low (F3 to F8); F1 only. **The owner chose F1
     plus every low**, which overrode the recommendation.
- 2026-10-25, round 1 (the retarget to Node 26; gate 1's F1 to F8). Filename
  `repo-126-node-24-lts.md` became `repo-126-node-26-lts.md`: the format ties the
  `id` to the filename, not the slug, so the rename is free (`git mv`, no other
  file cites the old name; the branch keeps `repo-126-node-24-lts`). The
  `Done when` 8 of answer 2 is the line now headed "The Log holds the Node
  version of `mcr.microsoft.com/playwright:v1.62.1-noble`".
  - **F1** (the lockfile mirrors `engines.node`): Build step 4 edits
    `package.json` and `package-lock.json` together, `Done when` names the
    lockfile as a required path with its one expected hunk, and Build step 9
    reads the script's diff: an `engines` hunk is a missed mirror, a `libc`
    hunk is the step 3 fork.
  - **F2**: answer 2, reworded with the "unmeasured" exit.
  - **F3**: the Why now says the base carries `NODE_VERSION=24` in its build
    arguments, read from the registry, not `node --version`.
  - **F4**: three lines added. The type-stripping output is required in the Log
    and the sentence must state it. The `dependency-updates.md` grep now also
    matches `npm 10 rewrites`, `CI's npm 10` and `on npm 10`, and Build step 7
    names all four sentences. The four `e2e` jobs of the tool workflows are a
    `Done when` line.
  - **F5**: the omitted-majors note above reads "21 and below".
  - **F6**: answer 1; the ticket is not startable before 2026-10-28 and
    Build step 1 checks the schedule and the index on the build day.
  - **F7**: Build step 4 says the higher floor wins in either merge order.
  - **F8**: moot at `>=26.0.0`, which excludes Node 25 (stated in the Why).
- 2026-10-25: engines floor scan for Node 26.0.0, gate 1's
  `engines-scan.mjs <lockfile> <npm's semver dir> 26.0.0 24.15.0 25.0.0 22.22.2`
  (each lockfile read with `git show <ref>:package-lock.json`):

  ```
  origin/main 9d5f7d26     entries 638, with engines.node 363
    26.0.0: 0 rejecting   24.15.0: 0   25.0.0: 0   22.22.2: 0
  origin/repo-123-jsdom-30 c10d2814   entries 582, with engines.node 358
    26.0.0: 0 rejecting   24.15.0: 0   22.22.2: 0
    25.0.0: 5 rejecting (jsdom 30.1.3, @asamuzakjp/css-color 7.1.7,
            @asamuzakjp/dom-selector 10.0.4, w3c-xmlserializer 6.0.0, vitest 5.0.5)
  ```

  So `>=26.0.0` loses no declared engine on either tree.

- 2026-10-25: PR #647 moved since the filing entry above. Its head is now
  `c10d2814`, and there `package.json` line 74 and the lockfile's root entry
  both read `">=22.22.2"`: the raise is on the branch, still unmerged (PR #647 is
  an open draft on `repo-121-vite-8-vitest-5`). The 2026-10-25 entry that says
  it was not on the PR is true of `8b96fbd9` only.
- 2026-10-25: Docker Hub tag API, `https://hub.docker.com/v2/repositories/library/node/tags/<tag>`,
  HTTP 200 for `26-bookworm`, `26-slim` and `26-bookworm-slim`: the planner and
  ledger Dockerfiles' base and runtime tags exist for Node 26.
- 2026-10-25, owner's answers at landing, after gate 2 (CONCERNS at `f1fed037`;
  both gates' full reports are on the PR #650 thread, which is this ticket's
  record: the filing PR carries no `## Review` section and no `--land`, and the
  ticket stays `ready`). Each matched the recommendation.
  1. **`Done when` 11.** Options: (1) add an explicit exit for Build step 5's
     option (a), in `Done when` 16's "either ... or" shape (recommended); (2)
     leave it. **The owner chose (1).**
  2. **Not-before enforcement.** Options: leave `ready` with the note and
     dispatch on or after 2026-10-28 (recommended by the round builder and by
     gate 2); `needs-decision` until then. **The owner chose to leave `ready`.**
  3. **Gate 2's lows.** Options: fix at landing (recommended); record unfixed.
     **The owner chose to fix at landing.**
- 2026-10-25 — Fixed at landing by owner choice: gate 2, F2 remainder — "the
  version reads v26.x after it, or the Log names the downloader image's Node as
  unmeasured". `Done when` 11 now has the third exit, the owner's Build step 5
  answer keeping the base's Node 24 with the reading recorded.
  `git diff f1fed037 -- docs/work/repo-126-node-26-lts.md | grep -c '^-.*the version reads v26.x after it'` → `1`.
- 2026-10-25 — Fixed at landing by owner choice: gate 2, F1 remainder — "the
  lockfile's `node_modules/@types/node` entry (version 26.6.5, `resolved`,
  `integrity`) moves too, and step 9 has no rule for that hunk". Steps 8 and 9
  name that entry's hunk as expected.
  `git diff f1fed037 -- docs/work/repo-126-node-26-lts.md | grep -c '^-.*the lockfile.s root entry together, and the Log names the lines'` → `1`.
- 2026-10-25 — Fixed at landing by owner choice: gate 2, F9 — "Build steps 11 and
  13 say Done when 11 for the e2e jobs; that is Done when 10", and the Log's pin
  entry calls the dangling comment "Build step 4", which is step 6 now. Three
  references corrected in place: step 11, step 13 and the pin entry.
  `git diff f1fed037 -- docs/work/repo-126-node-26-lts.md | grep -c '^-.*stripping" reference (Build step 4)'` → `1`.
- 2026-10-25 — Fixed at landing by owner choice: gate 2, F10 — "Dry-run on
  repo-123's head by gate 1". The Why credits the dry run to gate 1's own tree
  and adds the orchestrator's dry run on repo-123's `8b96fbd9`.
  `git diff f1fed037 -- docs/work/repo-126-node-26-lts.md | grep -c "^-.*Dry-run on repo-123's head by gate 1"` → `1`.
