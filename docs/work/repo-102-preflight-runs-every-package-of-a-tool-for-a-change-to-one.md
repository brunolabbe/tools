---
id: repo-102
tool: repo
title: Preflight runs every package's tests in a tool when only one package and its dependents can be affected
kind: work-package
status: ready
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
