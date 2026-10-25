---
id: repo-126
tool: repo
title: Move the runtime from Node 22 to Node 24 LTS
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-126 — Move the runtime from Node 22 to Node 24 LTS

## Why

The runtime pins say Node 22: the three tool workflows and the `check` and
`test` jobs of `ci.yml`, the planner and ledger images, the downloader image's
Playwright base, the devcontainer, and root `engines.node`. The release index
names Node 24 as an LTS line (`Krypton`) and Node 22 as one too (`Jod`); the
index measured on 2026-10-25 is in the Log. Node 26 is out but not LTS on that
date.

The owner decided this on 2026-10-25, during repo-123 (jsdom 30, PR #647). The
question was whether the repo should move its runtime to Node 24 LTS. The
options were (1) file this ticket, with repo-123 raising only root `engines` to
`>=22.22.2` — recommended, chosen; (2) the same ticket, with repo-123 left
alone; (3) do the move inside repo-123. The owner proposed Node 24 because it is
the LTS.

Three facts make this more than a version bump:

- jsdom 30.1.3 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, and the root
  `engines.node` still reads `>=22.0.0`. Recorded on repo-123's Log (PR #647,
  branch `repo-123-jsdom-30`).
- `better-sqlite3` is pinned at `^12.4.1` in three packages, and the repo-122
  Log (PR #636, branch `repo-122-better-sqlite3-13`) records that a lockfile
  `npm ci` compiles `better-sqlite3` 13.0.3 from source. Whether 12.x has a
  Node 24 prebuilt is not measured anywhere in the repo.
- `@types/node` is already `^26.1.2` (root `package.json`), so the types and
  the runtime disagree before this ticket starts.

## Build

1. **Stop check first.** Take the release index (`curl -s
   https://nodejs.org/dist/index.json`, newest entry per major) and record it in
   the Log. If a Node 26 entry carries an `lts` name when you build, stop before
   any change and report it. Whether the move goes to 24 or 26 is the owner's
   choice, not this ticket's. Options: (a) 24 LTS now, as filed (recommended,
   the owner's decision); (b) 26 now, outside the owner's decision and not LTS
   on 2026-10-25; (c) hold until 26 is LTS and decide then.
2. **Move the pins to 24**, in these files and no others (plus the lockfile
   only if steps 7 or 8 force it):
   - `.github/workflows/ci.yml` lines 105 and 309 (`node-version: 22`, the
     `check` and `test` jobs);
   - `.github/workflows/downloader.yml` line 92, `.github/workflows/planner.yml`
     line 70, `.github/workflows/ledger.yml` line 64;
   - `tools/planner/Dockerfile` line 16 and `tools/ledger/Dockerfile` line 14
     (`ARG NODE_VERSION=22-bookworm` becomes `24-bookworm`; the runtime stage's
     `-slim` follows the same arg);
   - `.devcontainer/Dockerfile` line 19 (`ARG NODE_MAJOR=22`) and
     `.devcontainer/devcontainer.json` line 19 (`"NODE_MAJOR": "22"`);
   - root `package.json` line 77: `engines.node` to `>=24.15.0`, the floor jsdom
     30 needs on the 24 line. If repo-123 has merged first, its `>=22.22.2`
     line is replaced here.
3. **Downloader image.** `tools/downloader/Dockerfile` takes Node from its base,
   `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble` (line 22, with
   `PLAYWRIGHT_VERSION=1.62.1` on line 21). Measure `node --version` inside that
   base and record it. If it is not v24.x, stop and report the options: a
   Playwright base that carries Node 24, or installing Node 24 onto the base.
4. **Devcontainer prose.** `.devcontainer/Dockerfile` line 39 reads "The repo
   pins Node 22 on purpose (see CLAUDE.md on type stripping)". No `CLAUDE.md`
   on `main` has a section on type stripping, so the reference dangles. Rewrite
   that comment to name the reason the pin is 24 now, or delete it if no reason
   remains. Then `.devcontainer/README.md` line 3 ("Node 22") and line 30
   ("Node 22 on Playwright's base") change to 24.
5. **Two rule sentences.** `.claude/rules/testing.md` lines 48–49 say the pinned
   Node is 22.15 and "cannot strip TypeScript types without a flag". Measure on
   Node 24 whether `node` runs a `.ts` file with no flag, and rewrite the
   sentence to the measured fact. `.claude/rules/dependency-updates.md` line 27
   says "the npm 10.9.9 Node 22 ships"; rewrite it to the npm that Node 24
   bundles, from `npm --version` under Node 24.
6. **Types.** Keep `@types/node` at `^26.1.2` (root `package.json`, line 60)
   unless `npm run check` fails with it on Node 24. Record the major the tree
   carries after the move, and why.
7. **Native modules, on Node 24.** Do a clean install in a throwaway worktree,
   not the farm. Record, for `better-sqlite3` (locked at 12.x; `^12.4.1` in
   `tools/downloader/api/package.json`, `tools/ledger/api/package.json` and
   `tools/planner/api/package.json`), whether the install used a prebuilt or ran
   `node-gyp rebuild`, with the gyp line if it ran, and whether a `:memory:`
   database opens. For `ffmpeg-static` (`^5.2.0` in
   `tools/downloader/engine/package.json`), record whether its binary path
   exists and `-version` prints.
8. **Lockfile check under Node 24's npm.** `scripts/check-lockfile-sync.mjs`
   runs whichever `npm` is on PATH. CI's `check` job runs it under the npm that
   Node 22 carries, 10.9.9 per `.claude/rules/dependency-updates.md`. Measure
   `npm --version` under Node 24 and whether `node scripts/check-lockfile-sync.mjs`
   exits 0 against the unchanged lockfile. If it fails on the libc difference
   that rule describes, stop and report the options: pin npm in the `check` job,
   or regenerate the lockfile under npm 10 with the difference accepted.
9. **Local checks.** `npm run build`, then `npm run check` on Node 24 (lint,
   format, typecheck). The build comes first: `api` reads `engine` and
   `contract` through their `dist`.
10. **e2e, by path.** Run `tools/downloader/e2e/layout.spec.ts`,
    `tools/planner/e2e/layout.spec.ts` and `tools/ledger/e2e/layout.spec.ts`
    on Node 24 and record each count. These are the three layout specs; the
    other downloader and planner e2e specs need a live service or browser
    session and are not named here.
11. **Devcontainer.** Build `.devcontainer/Dockerfile` if the sandbox allows it,
    and record its `node --version` line (the Dockerfile's own test on lines
    51–52). If it cannot be built here, say so in the Log.
12. **Windows leg.** `test (windows-latest, informational)` in `ci.yml`'s
    `test` matrix is informational. Read it on the PR head; do not grade it as
    blocking.

## Done when

- `git grep -n -E "node-version: 22|NODE_VERSION=22|NODE_MAJOR=22|\"NODE_MAJOR\": \"22\"" -- .github tools .devcontainer` prints nothing on the PR head.
- The PR's changed paths are the files Build steps 2, 4, 5 and 6 name, plus `docs/work/repo-126-node-24-lts.md`, plus `package-lock.json` only if steps 7 or 8 forced it. The Log says which.
- `package.json` reads `"node": ">=24.15.0"` under `engines`.
- `git grep -n -E "Node 22|22\.15|npm 10\.9\.9 Node 22|CLAUDE\.md on type stripping" -- .devcontainer .claude/rules` prints nothing.
- `ci.yml`'s `check` job and its `test (ubuntu-latest)` job conclude success on the PR head, with the head sha in the Log.
- `test (windows-latest, informational)` on the PR head is read: pass, or a red leg named with its failing test and the latest reading of that leg on `main`.
- The `docker` job of each of `.github/workflows/downloader.yml`, `planner.yml` and `ledger.yml` concludes success on the PR head, building `tools/downloader/Dockerfile`, `tools/planner/Dockerfile` and `tools/ledger/Dockerfile` respectively.
- The Log holds `node --version` measured inside `mcr.microsoft.com/playwright:v1.62.1-noble` (Build step 3), and it reads v24.x.
- The Log holds, for `better-sqlite3` and for `ffmpeg-static`, the install result on Node 24 (prebuilt or compiled), the command that showed it, and the open-the-binary check from Build step 7.
- `node scripts/check-lockfile-sync.mjs` exits 0 under the npm Node 24 bundles, and the Log names that npm version.
- `npm run check` exits 0 on Node 24, and the Log names the `@types/node` major the tree carries.
- `tools/downloader/e2e/layout.spec.ts`, `tools/planner/e2e/layout.spec.ts` and `tools/ledger/e2e/layout.spec.ts` each pass on Node 24, with each test count in the Log.
- The Log holds the release index read on the build day and says whether a Node 26 entry carries an `lts` name. If it does, Build step 1 applies.
- Either `.devcontainer/Dockerfile` builds and its Node 24 test passes, or the Log names the devcontainer build as unmeasured.

## Log

- 2026-10-25: filed on the owner's decision, taken during repo-123 (PR #647,
  draft, stacked on `repo-121-vite-8-vitest-5`, PR #643). Options were: (1) this
  ticket, with repo-123 raising only root `engines` to `>=22.22.2`, recommended
  and chosen; (2) this ticket, repo-123 left alone; (3) the move inside repo-123.
  The owner proposed 24 because it is the LTS.
- 2026-10-25: release index, `curl -s https://nodejs.org/dist/index.json`,
  newest entry per major (the output is `version date lts`; majors 18 and below
  are omitted here):

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
  stripping" reference (Build step 4).

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
