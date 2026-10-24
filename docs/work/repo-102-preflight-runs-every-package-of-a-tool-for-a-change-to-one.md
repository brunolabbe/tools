---
id: repo-102
tool: repo
title: Preflight runs every package's tests in a tool when only one package and its dependents can be affected
kind: work-package
status: done
milestone: null
depends_on: [repo-101]
difficulty: standard
---

# repo-102 — Preflight runs every package of a tool for a change to one

## Why

This follows [repo-101](./repo-101-preflight-runs-a-tools-whole-suite-for-a-markdown-only-change.md).
Preflight scopes tests by tool, and almost all of the cost is inside one tool.
CI run 38203804906 (2026-10-12) gives the summed test time per project:

| Project    | Summed test time |
| ---------- | ---------------- |
| downloader | 1,150 s          |
| repo       | 53 s             |
| planner    | 17 s             |
| ledger     | 17 s             |
| core       | 3 s              |

Within the downloader:

| Package   | Summed test time |
| --------- | ---------------- |
| resolvers | 741 s            |
| engine    | 218 s            |
| api       | 180 s            |
| web       | 10 s             |
| contract  | 0 s              |

Each `package.json` declares the dependencies between packages:

- `api` depends on `contract`, `engine` and `resolvers`;
- `engine`, `resolvers` and `web` each depend on `contract`.

So an api-only change can only break api's tests. It pays 1,150 s today and
would pay 180 s. A web-only change would pay 10 s.

**The measured effect.** For each of the 82 downloader commits on `main` since
2026-09-01 that changed `src/` or `test/`, the audit summed the test time of
the packages changed plus their reverse dependencies. Summed over all 82,
the local test time drops by about 43%:

| Change             | Commits | Before       | After               |
| ------------------ | ------- | ------------ | ------------------- |
| resolvers only     | 19      | 1,150 s each | 921 s each          |
| api only           | 17      | 1,150 s each | 180 s each          |
| touches `contract` | 17      | 1,150 s      | 1,150 s (unchanged) |

**The owner chose this on 2026-10-12.** CI keeps running everything, so a
coupling this graph misses shows up red on the pull request rather than
reaching `main`.

## Build

1. **Derive the graph, do not write it out.** For each tool, read
   `tools/<tool>/*/package.json`, and take the edges from its `dependencies` on
   the tool's own `@<tool>/*` workspaces.
   - Add an edge for any **test import across packages** that the declarations
     do not cover. Today `api` tests import `../../engine/test/helpers/media.ts`;
     api already depends on engine, but the scan must not rely on that. Scan
     `test/**` for relative imports into a sibling package.
   - A test that reads a sibling's fixture by path, not by import, is invisible
     to the scan. Grep for those, and record what you found in the Log.
2. **Plan.** The affected packages are the packages changed, plus all their
   transitive reverse dependencies. Run them as
   `npm test -- --project <tool> <tool path>/<pkg>/test ...`, or whatever
   filter shape vitest 4 accepts with `--project`. Prove that the filter
   actually narrows the run, with a test count.
3. **Fail open to the whole tool.** A path under `tools/<tool>/` that belongs
   to no package widens the plan back to `--project <tool>`. Examples:
   `Dockerfile`, `playwright*.config.ts`, `e2e/`, a tool-root `tsconfig`.
   `.md` paths are already ignored by repo-101. **Never narrow on an unknown
   path.**
4. **Check the guard.** Preflight refuses to spawn any `npm` command it does not
   recognise (repo-82, the `canonicalize`/`COVERED` logic). Check that the new
   command shape passes it, and that `deriveExtraCiCommands`' test still pins
   its output.
5. **Generic, not downloader-only.** Planner and ledger have
   `api`/`contract`/`web` packages too. The same derivation applies to them
   unchanged.
6. **Tests** in `scripts/test/preflight.test.ts`, against a fixture tool tree:
   - a change to the leaf package (api) plans only api;
   - a change to `contract` plans every package;
   - a change to `engine` plans engine and api;
   - a tool-root path plans the whole tool;
   - an undeclared cross-package test import adds its edge.

## Done when

1. For `origin/main`'s downloader:
   - an api-only diff plans api's tests and not resolvers';
   - a `contract` diff plans all five packages.
     Tests prove both against the real `package.json` files, not only against a
     fixture.
2. Any path that belongs to no package plans the whole tool, and a test proves
   it.
3. The Log records how preflight's test step changed on one real api-only
   branch: its wall time and test count, before and after.

## Review

**Gate: FAIL** — 2026-10-12 · `b7069eca..2c9c11e3` · Opus 5.5, depth standard

| Done when                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Real downloader: an api-only diff plans api and not resolvers; a `contract` diff plans all five, against the real `package.json` files | `scripts/test/preflight.test.ts` › "testPlan on the real downloader: an api diff plans api only, a contract diff plans all five (repo-102)" ✓. The api plan equals `--project downloader tools/downloader/api/test/` and contains no `resolvers`. The contract plan equals the unfiltered `--project downloader`. The graph's keys are the five packages, and each has `test/`. Two mutations turn it red: dropping the reverse-dependency closure, and `testPlan` ignoring `repo`. |
| 2. Any path that belongs to no package plans the whole tool, and a test proves it                                                         | `scripts/test/preflight.test.ts` › "testPlan plans the whole tool for any path that belongs to no package (repo-102)" ✓. It covers six orphan shapes, each alone and each beside an api path. "testPlan runs the whole tool when it cannot read the tree, and when no repo is given (repo-102)" covers the unreadable tree. One of the two guards is untested (low, below).                                                                                                         |
| 3. The Log records wall time and test count, before and after, on one real api-only change                                                | **verified**. The Log has the table. Re-measured at `2c9c11e3`: `npm test -- --project downloader` ran 116 files (115 passed, 1 skipped) and 2,502 tests (2,500 passed, 2 skipped) in 561 s wall. `npm test -- --project downloader tools/downloader/api/test/` ran 54 files (53 passed, 1 skipped) and 839 tests (837 passed, 2 skipped) in 30.06 s (vitest Duration). The Log ran `e7db59c1`'s paths on this tree, not a branch carrying that commit, and says so.                |

- **high** · no `Done when` line depends on it · the `withoutComments`
  docblock in `scripts/preflight.mjs` states a bound the code does not keep:
  "Deliberately timid, so that a shape it does not recognise keeps its text and
  yields an edge rather than losing one." Code inside a string or a template
  literal loses its text in two cases. First, a ` //` inside a string deletes
  the rest of its line. Second, a template-literal line that starts with `/*`
  deletes everything up to the next `*/` anywhere below it. Either one hides a
  reader. Reproduction, in a disposable copy of the tree:
  `tools/downloader/engine/test/p5.test.ts` =
  `const note = "see //"; export const P = new URL("../../web/public/", import.meta.url);`.
  Then `testPlan(["tools/downloader/web/public/terms.html"], tree)` plans
  `--project downloader tools/downloader/api/test/ tools/downloader/web/test/`,
  without engine. The template form is
  ``export const glob = `\n/*.json`;`` followed by a `new URL("../../web/test/fixtures/", …)`
  line and a `/** end */` docblock. Planning `tools/downloader/web/test/fixtures/a.json`
  then gives `tools/downloader/web/test/` alone. **No live instance.**
  `@babel/parser`'s comment ranges, used as a second stripper over all 600
  scannable files of the three tools, gave zero edge differences. The fix is
  cheap. Strip `//` only at line start, `/^[ \t]*\/\/[^\n]*/gmu` in place of
  `/(^|\s)\/\/[^\n]*/gu`. Measured: the real graph is identical for all three
  tools, and P5 then plans api, engine and web. For the block form, either word
  the docblock to what the rule does, or keep a block only when its body is
  JSDoc-shaped.
- **low** · no `Done when` line depends on it · `packageGraph` decides a scope
  from the literal text, not from what is on disk. In both cases below a
  plausible shape loses a reader. First, a filename prefix builds a scope
  longer than any file. ``new URL(`../../resolvers/test/fixtures/manifests/hls-${n}.m3u8`, …)``
  in an engine test scopes the edge to `resolvers/test/fixtures/manifests/hls-`.
  `narrowedFilters` requires `p === read || p.startsWith(read + "/")`, so a
  change to `…/manifests/hls-master.m3u8` plans api, resolvers and web, without
  engine. The segment form `"tools/downloader/resolvers/test/fixtures/page-" + n`
  does the same. Second, an extensionless code import, legal under the `web`
  packages' Bundler resolution, is read as data:
  `import … from "../../resolvers/test/helpers/mp4"` in a web test scopes to
  `resolvers/test/helpers/mp4`. A change to `mp4.ts` then plans api and
  resolvers, without web. No live instance: the real scoped edges are
  `web/public`, `resolvers/test/fixtures` and one complete fixture file name.
  The remedy is `p.startsWith(read)` (it errs wide), plus treating a
  path that resolves to an existing code file (`<path>.ts`, `<path>/index.ts`)
  as whole-package.
- **low** · no `Done when` line depends on it · positive control: the scan
  does not read a computed specifier or a `..`-segment join, and a new edge of
  either shape is caught by no local test. CI catches it, which is the backstop
  the owner accepted. Planted in a copy: a package `tools/downloader/probe`
  with no declared dependencies, whose test runs
  `await import(["@downloader", "contract"].join("/"))`. A contract change then
  plans five filters without probe. When the real `terms-page.test.ts` read is
  rewritten as `path.join(import.meta.dirname, "..", "..", "web", "public")`,
  a `web/public` change plans web alone. That one is caught:
  "testPlan on the real downloader…" fails on
  `expected undefined to deeply equal Set{ 'web/public' }`, because the test
  pins the existing edge. The other two plants (extensionless import, filename
  prefix) left all 12 repo-102 tests green.
- **low** · no `Done when` line depends on it · a real read across packages
  that neither the graph nor the Log's enumeration ("Three reads that no
  manifest declares") has. `tools/downloader/api/test/ytdlp-in-the-image.test.ts`
  › `pins()` walks every `.json`/`.ts`/`.mjs`/`.ya?ml`/`.sh`/`.toml` file in the
  repo, every downloader package included, and "every pin names the same
  release" asserts that they agree. Reproduction: write
  `export const YTDLP_VERSION = "2020.01.01";` to
  `tools/downloader/web/src/pin-probe.ts`. `testPlan` plans
  `--project downloader tools/downloader/web/test/` only, while
  `npx vitest run --project downloader tools/downloader/api/test/ytdlp-in-the-image.test.ts`
  gives `1 failed | 11 passed (12)`. The trigger is hypothetical, and an engine
  or resolvers change still runs api. The Log should name the read. Moving that
  assertion to a project that always runs is a separate ticket.
- **low** · `nfr:maintainability` · two guards in `narrowedFilters` survive
  mutation, out of 12 single mutations run against the 12 repo-102 tests.
  Deleting `if (slash < 0) return [];` leaves all 12 green, because the next
  guard catches every tool-root name the fixture uses. With it deleted,
  `tools/downloader/webs` plans `tools/downloader/web/test/` alone. Ignoring
  `hasTests` also leaves all 12 green, because no fixture package lacks `test/`.
- **low** · `nfr:maintainability` · on `main`, `roles/builder.md`'s preflight
  bullet says preflight runs "the suite of every tool the diff touches". After
  this change it runs a subset of that suite. This is the stale sentence that
  CLAUDE.md's "do it now" covers. The Log notes it and leaves it.
- **dropped** · a workspace renamed in its `package.json` drops its
  dependents' edges, because the graph is read from the post-change tree. Any
  workspace rename changes `package-lock.json`, which is shared config, so the
  full `npm test` runs; without an install, CI's `npm ci` fails. Not a gap.
- **dropped** · a filter that matches no file. `npm test -- --project downloader tools/downloader/nope/test/`
  exits 1, so it fails closed. A zero-match filter beside others drops nothing,
  because only a package with no tests yields one.
- **dropped** · the ledger `api` → `web{web/dist/app}` edge, a false scoped
  edge from a string in `config.test.ts`. `dist` is never in a diff, so it never
  fires.
- **dropped** · out of range · `terms-page.test.ts` reads
  `compose.downloader.prod.yaml`, and `ytdlp-in-the-image.test.ts` reads
  `.github/workflows/`. A diff that touches only repo-root files plans no
  downloader suite. That is `touchedTools` (repo-101), not this diff.
- **findings** · the hunt returned 10; 6 carried (1 high, 5 low), 4 dropped.
- Filters, enumerated: for each of the 15 packages, `vitest list --filesOnly`
  with its `tools/<tool>/<pkg>/test/` filter equals the files of that package
  in the unfiltered listing (downloader 116, planner 77, ledger 50). Runs:
  planner intake plan, 39 files and 621 tests (33 + 6); ledger books plan, 49
  files and 855 tests (25 + 11 + 13).
- Edges, independently: manifests, tsconfig `references`, vite configs,
  `new URL`/`path.join`/`import.meta` sites and directory walks in all 15
  packages. Every edge `packageGraph` returns was found, and nothing else was
  found except the pin scan above.
- CI on `3fbf841e` (`2c9c11e3` plus seven Log lines): check, test
  (ubuntu-latest), CodeQL, codeql and dependency-review pass; test
  (windows-latest, informational) pending.
- NFR: security ✓ (argv spawn with `shell: false` unchanged; the new arguments
  are `tools/<tool>/<dir>/test/`) · performance ✓ (api-only 561 s → 30 s
  measured) · reliability: fails open on every unplaced path; the misses are
  above · maintainability: above.

### Gate 2

**Gate: PASS** — 2026-10-12 · `2c9c11e3..9d753314`, round `3fbf841e` + `64f70095` (the merge from `main`, #444 and #448, not reviewed) · Opus 5.5, depth standard

| Done when                                                                       | Proof                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Real downloader: api-only plans api not resolvers; `contract` plans all five | `scripts/test/preflight.test.ts` › "testPlan on the real downloader: an api diff plans api only, a contract diff plans all five (repo-102)" ✓, unchanged by the round. The real graph of all three tools dumps byte-identical at `2c9c11e3` and `9d753314`.                                        |
| 2. A path in no package plans the whole tool                                    | `scripts/test/preflight.test.ts` › "testPlan plans the whole tool for any path that belongs to no package (repo-102)" ✓. Its two guards are now pinned by "testPlan widens for a file at the tool's root whose name begins with a package's, and ignores a package that owns no tests (repo-102)". |
| 3. Log records before/after wall time and test count                            | **verified** at gate 1 (561 s, 2,502 tests → 30 s, 839 tests); untouched by the round.                                                                                                                                                                                                             |

Gate 1's findings:

- **high, `withoutComments` loses code text** — **fixed**. Gate 1's six
  plants, re-run on a copy of `9d753314`: the `" //"`-in-a-string reader and
  the template line starting `/*` both now plan engine. A second stripper,
  `@babel/parser`'s comment ranges, gives zero edge differences across all 600
  scannable files in the three tools. On the gate-1 tree the same harness
  reports `LOST: web/public` and `LOST: web/test/fixtures` under the old rule,
  so it can fail. No real comment's text now invents an edge: the planner
  `contract` docblocks that name `@planner/intake` still strip, and the graph is
  unchanged. Mutations: putting back the old `//` rule or the old lazy block
  rule, or deleting any one of the three strips, each turns at least one
  repo-102 test red.
- **low, scope longer than any file** — **fixed** with `p.startsWith(read)`.
  Putting back `p === read || p.startsWith(read + "/")` fails "packageGraph
  scopes a name built at run time by its literal head…". The change only
  widens: `tools/downloader/web/publicity/a.ts` now also plans api (the
  `web/public` scope). That costs time and hides nothing. The leaf plans are
  unchanged (api → api; resolvers `src` → api, resolvers; web `src` → web).
- **low, extensionless code import read as data** — **fixed** (`namesCode`).
  Making `namesCode` read only extensions fails "packageGraph reads an
  extensionless specifier that resolves to a file as code…".
- **low, two mutation survivors** — **fixed**. Deleting `if (slash < 0) return [];`
  fails 1 of 17, and ignoring `hasTests` fails 1 of 17.
- **low, computed specifier / `..`-segment join** — **not fixed**, low, may
  land. The Log's line about the scan's reach is half right (see the new
  finding below).
- **low, `pins()` read** — named in the Log, by the owner's choice.
- **low, `roles/builder.md`** — recorded unfixed, by the owner's direction.

New in the round's lines:

- **low** · no `Done when` line depends on it · one half of the round's test
  asserts nothing of its own. "packageGraph reads an extensionless specifier
  that resolves to a file as code…" plants both `helpers/mp4` and the directory
  form `helpers2`, but only `mp4` reaches its assertions. Deleting the
  `index.<ext>` lookup from `namesCode` leaves all 17 repo-102 tests green.
- **low** · no `Done when` line depends on it · the Log says the scan reads
  "string literals and literal heads, not computed values" and that no fix
  exists for text. A `..`-segment join is literal and is not read:
  `path.join(import.meta.dirname, "..", "..", "web", "public")` in place of
  `terms-page.test.ts`'s `new URL(…)` plans `tools/downloader/web/test/` alone
  for a `web/public/terms.html` change. `segmentPath` could accept `".."` heads
  resolved from the file, as the relative scan does.
- **dropped** · a data directory that shares its stem with a sibling `.ts`
  becomes a whole-package edge under `namesCode` (`../../web/test/fixtures/`
  resolves beside `web/test/fixtures.ts`). That only widens, and no real edge
  changed.
- **findings** · the round's hunt returned 3; 2 carried (both low), 1 dropped.
  No `high`.
- Runs at `9d753314`: `npx vitest run --project repo scripts/test/preflight.test.ts`
  91 of 91; `npm run check` exit 0. CI on `9d753314`: check, CodeQL, codeql
  and dependency-review pass; test (ubuntu-latest) and test (windows-latest,
  informational) pending.
- NFR: security ✓ (`namesCode`'s `existsSync` only runs on paths already
  inside a package) · performance ✓ · reliability ✓ · maintainability: above.

## Log

- 2026-10-12 — Filed from the suite-speed audit. vitest's own `--changed` was
  considered and not proposed: it follows the import graph only, so it misses
  fixture HTML, media files and config, which this repo's tests read by path.
- 2026-10-12 — Built on `repo-101`'s merge, from `origin/main` `d759b80e`, code
  commit `0cbee975`. `testPlan(diffPaths, repo)` now narrows a tool's
  `--project <tool>` to path filters; `packageGraph(repo, tool)` derives the
  graph from the tree and `narrowedFilters` plans from it. Both are exported
  from `scripts/preflight.mjs`; `checkBuild` passes its `repo` through.
  - **The vitest 4 shape, proven by running it.** A positional argument after
    `--project` is a substring filter on the test file's path, so
    `npm test -- --project downloader tools/downloader/api/test/` narrows. Files
    listed by `npx vitest list --filesOnly --project downloader`: 115 whole, 53
    for `tools/downloader/api/test/`, 67 for the api and engine filters together.
    Run, `tools/downloader/web/test/` is 22 files and 286 tests. Each filter ends
    in `/test/` so `api/` cannot match a sibling that begins the same way.
  - **How the graph is derived, never written out.** Three kinds of edge, all in
    `packageGraph`: the workspaces named in a package's `dependencies`,
    `devDependencies`, `peerDependencies` and `optionalDependencies` (devDependencies
    count: `planner/agent` lists `@planner/itinerary` there); a package's files
    naming another package of the tool by `@<tool>/<name>` or by a relative path
    that resolves into it; and a `tools/<tool>/<package>` path built from segments.
    Comments are stripped first (`withoutComments`). Without that the planner's
    `contract` "depends on" every package, because its docblocks name `@planner/intake`
    and `@planner/itinerary`, and an edit to any package then runs every suite:
    measured on the first draft, a resolvers-only edit planned api, engine, resolvers
    and web.
  - **The test-reads-a-sibling-by-path grep, as asked.** Three reads that no
    manifest declares, each found by grepping `test/` for `../../<package>/` and
    `"tools", "<tool>", "<package>"`:
    `tools/downloader/api/test/terms-page.test.ts:19` reads `web/public/`;
    `tools/downloader/engine/test/mirror-failover.test.ts:201` reads
    `resolvers/test/fixtures/ytdlp/balancer-duplicate-ladder.variants.json`;
    `tools/downloader/web/test/fixtures.ts:141` walks up to
    `resolvers/test/fixtures`. A fourth, `api/test/ytdlp-in-the-image.test.ts:192`,
    reads `tools/downloader/e2e/container/ytdlp-proxy-trust.mjs`; `e2e/` is no
    package, so any e2e path already plans the whole tool. The one import across
    packages the brief named, `api` -> `engine/test/helpers/media.ts`, is
    declared too; the scan finds it anyway.
  - **The brief's "a test that reads a fixture by path is invisible" has a cost
    the brief did not price.** Treating those three reads as whole-package edges
    makes `engine` and `web` depend on `resolvers`, so a resolvers-only edit plans
    resolvers, api, engine and web, which is the 1,150 s the ticket wants to
    spare. So an edge from a path that names data is scoped to that path
    (`web/public`, `resolvers/test/fixtures`), fires only when a changed file is
    under it, and does not spread to the reader's own dependents. An edge from a
    path that names code (`.ts`, `.mjs`...), from the package root, or from a
    declared dependency or `@tool/name` mention is whole-package. Real downloader
    result: a resolvers `src/` edit plans resolvers and api only (the ticket's
    921 s row); a resolvers fixture edit also plans engine and web.
  - **Fails open.** A diff narrows only if every one of the tool's non-markdown
    paths is inside a package the tree can still read. `Dockerfile`,
    `playwright*.config.ts`, `e2e/`, a tool-root `tsconfig.json`, a loose
    `src/`, a package that was deleted, a tool with no readable package, and a
    call with no `repo` all plan `--project <tool>` whole. If the affected set is
    every package, the plan is the unfiltered project rather than four filters.
  - **The guard, checked.** repo-82's `canonicalize`/`COVERED` logic reads
    `ci.yml`'s `check` job through `deriveExtraCiCommands`; it never sees
    `testPlan`'s commands, which `checkBuild` spawns directly as an argv array
    with `shell: false`. So the new shape cannot trip it, and `deriveExtraCiCommands`'
    own test (`runs only what no other check already covers`) passes unchanged.
    The one new thing reaching `spawnSync` is `tools/<tool>/<dir>/test/`, built from a
    directory name under `tools/`, which cannot begin with `-`. The guard would
    still refuse the same `npm test` shape if someone put it in `ci.yml`'s check job.
  - **Tests**, appended at the end of `scripts/test/preflight.test.ts`, 12 new:
    `testPlan plans only the leaf package for a change to it`,
    `...plans every package for a change to contract, as the tool's whole project`,
    `...plans engine and api for a change to engine, and not web or contract`,
    `...plans the whole tool for any path that belongs to no package`,
    `...runs the whole tool when it cannot read the tree, and when no repo is given`,
    `packageGraph adds an edge for a test import the manifests do not declare`,
    `...counts a devDependency on a workspace and a bare @tool/package import`,
    `...does not read a comment's mention of a sibling as a dependency`,
    `...scopes a path that names data to that path...`,
    `checkBuild hands testPlan the repo it is checking...`, and two against this
    checkout's real manifests: `testPlan on the real downloader: an api diff plans
    api only, a contract diff plans all five` and `testPlan on the real tools: a
    leaf of planner and of ledger narrows the same way`.
    `npx vitest run scripts/test/preflight.test.ts`: 86 of 86 pass (74 before).
  - **Each test watched failing.** Three one-line mutations, each reverted:
    `if (!graph.has(dir)) return [];` -> `continue` fails the fail-open test (1
    failed, 11 passed of the 12); `text = withoutComments(text)` -> `text = text`
    fails the comment test and both real-tree tests (3 failed); forcing `named =
    false` (every path edge whole-package) fails the data-scope test and the real
    downloader test (2 failed).
  - **Done when 3, on one real api-only change.** `e7db59c1` (dl-84), whose
    non-markdown paths are `api/src/request-log.ts`, `api/src/server.ts` and
    `api/test/logging.test.ts`. Its plan, computed from those paths by `testPlan`
    against this tree, is `npm test -- --project downloader tools/downloader/api/test/`
    where `main` plans `npm test -- --project downloader`. Run on this tree:

    | Plan             | Command                                                       | Test files                    | Tests                            | Wall time |
    | ---------------- | ------------------------------------------------------------- | ----------------------------- | -------------------------------- | --------- |
    | Before (main)    | `npm test -- --project downloader`                            | 114 passed of 115 (1 skipped) | 2,459 passed, 2 skipped of 2,461 | 568 s     |
    | After (repo-102) | `npm test -- --project downloader tools/downloader/api/test/` | 52 passed of 53 (1 skipped)   | 804 passed, 2 skipped of 806     | 40 s      |

    The `check` and `core` steps are the same both ways and are not in the
    table. The commands ran here with the paths taken from `e7db59c1`'s diff, not
    on a branch carrying that commit.

  - Graph cost: `packageGraph` for all three tools takes 200 ms on this tree.
  - Not folded in: `roles/builder.md` still says preflight runs "the suite of
    every tool the diff touches" (also noted in `reference/history.md` for the
    repo-101 change); it is a role page outside this ticket's Build and no
    behaviour depends on it, and a builder who believes it loses nothing.
  - Not done, left to repo-103: any machine-sharing or worker-count change.
- 2026-10-12 — Open decision answered by the owner on 2026-10-12, relayed by the
  coordinator. Question: how should a path that names data become an edge in the
  package graph? Options: A, data paths are scoped edges (a changed file fires
  the reader only when it is under the named path, and the edge does not spread
  to the reader's dependents); B, every cross-package path is a whole-package
  edge. **Chosen: A**, the recommended option and what `2c9c11e3` implements, so
  no code changed.
- 2026-10-12 — Round 1 repairs after gate 1 (Opus) FAIL at `2c9c11e3`, one high
  and five lows. Each finding was reproduced against the old code before it was
  changed: the four new tests below fail on `2c9c11e3`'s `scripts/preflight.mjs`
  (`npx vitest run scripts/test/preflight.test.ts -t repo-102`: 4 failed, 13
  passed, with the old file restored) and pass on the new one.
  - High, `withoutComments` lost text it could not prove was a comment — _fixed_.
    A ` //` inside a string deleted the rest of its line, and a template-literal
    line starting with `/*` deleted up to the next `*/` anywhere below, so either
    could hide a reader. The `//` rule is now a whole line whose first non-blank
    characters are `//`. For the block form the choice was between rewording the
    docblock to what the old rule did and tightening the rule to what the
    docblock said; I tightened the rule, keeping a block only when it is
    JSDoc-shaped (it closes on its opening line, or every line between the opener
    and the closer starts with a star). Rewording would have kept the hazard and
    only described it, and the tightened rule costs nothing on this tree: the
    dump of all three tools' graphs, every package, every edge and scope, is
    byte-identical before and after (`diff` printed nothing, 15 lines each). A
    block comment whose body lines carry no leading star is now kept, which can
    only add an edge. Test: `packageGraph keeps a reader whose line holds a //
    inside a string, or follows a template line starting with a slash-star`, plus
    `packageGraph still strips a whole-line // comment and a JSDoc block, but
    keeps an unstarred block`. The docblock now says what the code does.
  - Low, a scope built from literal text longer than any file — _fixed_.
    `narrowedFilters` matched a changed path against a scope as `p === read ||
    p.startsWith(read + "/")`; it is now `p.startsWith(read)`, which errs wide, so
    `hls-${n}.m3u8` (scope `…/manifests/hls-`) fires on `…/hls-master.m3u8`. Test:
    `packageGraph scopes a name built at run time by its literal head, and a
    changed file under that head fires the reader`.
  - Low, an extensionless code import read as data — _fixed_. A relative or
    segment path that names no code extension is now whole-package when
    `<path>.ts` (or `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`) or
    `<path>/index.<ext>` exists on disk (`namesCode`). Test: `packageGraph reads
    an extensionless specifier that resolves to a file as code, so the edge is the
    whole package`.
  - Low, mutation survivors in `narrowedFilters` — _fixed_ by one test,
    `testPlan widens for a file at the tool's root whose name begins with a
    package's, and ignores a package that owns no tests`. Deleting `if (slash < 0)
    return [];` now fails it (1 failed, 16 passed of the 17 repo-102 tests), and so
    does ignoring `hasTests` (1 failed, 16 passed). The fixture gained `docsite`,
    a workspace with no `test/` directory that depends on `engine`.
  - Low, a computed specifier or a `..`-segment join is read by no scan —
    _not fixed_. The finding states no fix. Two shapes are unread: a specifier
    built at run time (`["@downloader", "contract"].join("/")`), which cannot be
    read from source, and a `..`-segment join such as
    `path.join(import.meta.dirname, "..", "..", "web", "public")`, which is
    literal but which `segmentPath` does not accept as a head. This is the gap
    the ticket's Why accepts: CI runs every suite, so a coupling the graph
    misses shows up red on the pull request. It is recorded here so the next
    reader knows the scan's reach: a quoted relative path, or a
    `tools/<tool>/<package>` path written whole or in `", "` segments; not a
    computed value and not a `".."` segment join. (Corrected at landing: this
    entry first said "none exists for text" and "not computed values" alone,
    which was wrong for the `..` join; gate 2 found it.)
  - Low, `tools/downloader/api/test/ytdlp-in-the-image.test.ts` › `pins()` — an
    undeclared cross-package read, _named here, nothing filed_. It walks every
    `.json`, `.ts`, `.mjs`, `.ya?ml`, `.sh` and `.toml` file in the repo,
    every downloader package included, and "every pin names the same release"
    asserts that they agree, so a yt-dlp version pin added under `web/src` is
    read by an api test the graph does not link to `web`. The gate's
    reproduction: `export const YTDLP_VERSION = "2020.01.01";` written to
    `tools/downloader/web/src/pin-probe.ts` plans `tools/downloader/web/test/`
    only, while `npx vitest run --project downloader
    tools/downloader/api/test/ytdlp-in-the-image.test.ts` fails (1 failed, 11
    passed of 12). I did not re-run it. The trigger is hypothetical and a change
    to engine or resolvers still runs api. Open decision, answered by the owner on
    2026-10-12 and relayed by the coordinator. Question: what to do about this
    read? Options: name it in the Log (the gate's recommendation), or name it in
    the Log and file a ticket to move the assertion to a project that always
    runs. **Chosen: name it in the Log, file nothing.**
  - Low, `roles/builder.md` still says preflight runs "the suite of every tool the
    diff touches" — _not fixed_. Role pages are changed only in the owner's
    review session, which has logged it there; this branch does not edit
    `roles/builder.md`.
- 2026-10-12 — **Gate 2's two lows, _fixed at landing_** (the owner chose that
  over leaving them recorded, with no re-gate). Gate 2 passed `9d753314`. The
  owner was asked "Land it how?" with three options: assert `helpers2` and fix
  the Log (recommended); also resolve `..` joins in `segmentPath`; land as is.
  **Chosen: assert `helpers2` and fix the Log.** `scripts/preflight.mjs` is not
  touched by this step.
  - Low, the directory-index half of the extensionless-specifier test asserted
    nothing — _fixed_. `helpers2` was read by the same `web` test as `mp4`, and a
    whole-package edge absorbs a scoped one, so the `mp4` edge stood in for it.
    The `helpers2` import now sits in a `contract` test, a different reader, and
    the test asserts that `contract` depends on `engine` as `new Set([""])`. Its
    control, with the `index.<ext>` lookup deleted from `namesCode` in
    `scripts/preflight.mjs` and the file then restored with `git checkout`:
    `npx vitest run scripts/test/preflight.test.ts -t repo-102` prints
    `× packageGraph reads an extensionless specifier that resolves to a file as
    code, so the edge is the whole package (repo-102)` and `Tests 1 failed | 16
    passed | 74 skipped (91)`. Unmutated: `Tests 91 passed (91)`. One assertion
    moved with it: an engine `mp4.ts` change now plans the whole tool, because
    `contract` reads `engine` in the fixture and every package depends on
    `contract`; the test says so.
  - Low, the Log said the scan cannot read a literal `..`-segment join — _fixed
    in the Log only_. Round 1's entry on the computed-specifier gap now names the
    `path.join(import.meta.dirname, "..", "..", "web", "public")` shape as
    unread though literal, and gives the scan's reach as a quoted relative path or
    a `tools/<tool>/<package>` path written whole or in `", "` segments. The gap
    stays; CI is the backstop the ticket's Why accepts. `segmentPath` is not
    changed, by the owner's choice.
  - Left recorded and unfixed: the computed-specifier and `..`-join gap above, and
    the stale "the suite of every tool the diff touches" bullet in
    `roles/builder.md`, which only the owner's review session edits.
