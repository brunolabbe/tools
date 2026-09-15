---
id: repo-45
tool: repo
title: The worktree farm links a stale shared install into every worktree, and nothing says so
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-45 — The worktree farm links a stale shared install into every worktree, and nothing says so

## Why

Every dispatched agent gets its dependencies from
`.claude/scripts/worktree-farm.sh`, which symlinks the entries of the **shared
checkout's** `node_modules` into the agent's worktree rather than installing
anything. That is the right trade: it is why a dispatch does not start with
minutes of `npm install`. It does mean the farm can only be as fresh as the shared
install. **When a merge adds a dependency and nobody reinstalls the shared
checkout, every worktree set up after that merge is missing the package, and
nothing reports it.** The farm succeeds and the first sign is a compiler error.

It happened with pl-39 (#229, `de3b3f8`), which added `@anthropic-ai/sdk`
`^0.125.0` to `tools/planner/agent/package.json` and to `package-lock.json`. The
shared checkout `/workspaces/tools` was not reinstalled afterwards.

### What the orchestrator measured in the shared checkout, before reinstalling it

Quoted as captured:

```
taken 2026-09-14T22:46:10+00:00 at 95c6403
ls: cannot access 'node_modules/@anthropic-ai/sdk': No such file or directory
35:    "node_modules/@anthropic-ai/sdk": {
```

`npm install --dry-run --ignore-scripts --no-audit --no-fund` there reported
`add: 109`, `change: 0`, `remove: 0`. The only non-platform packages were
`@anthropic-ai/sdk 0.125.0`, `json-schema-to-ts 3.1.1`,
`standardwebhooks 1.1.1`, `ts-algebra 2.0.0`, `@stablelib/base64 1.0.1` and
`fast-sha256 1.3.0`. The other 103 entries in that output are optional platform
builds (`fsevents`, `@typescript/typescript-<os>-<arch>`). The real `npm install`
then printed `added 6 packages`. **The shared checkout is fixed now**, so this
defect can no longer be seen there.

### What agents in that batch reported (relayed, not re-observed)

- Two builders' `npm run build` failed with TS2307 in
  `tools/planner/agent/src/providers/anthropic.ts`. Both hand-extracted the
  packages from the npm cache with `npm pack --offline`.
- A third builder's `npm run check` exited 2 and 25 planner test files failed
  to load. It reported the branch green anyway, on the grounds that the failures
  were pre-existing.

The reproduction below produces exactly those symptoms, down to the count of 25
test files.

## The reproduction

Done by the builder that filed this, on 2026-09-14, at `95c6403`. Nothing in
`/workspaces/tools` was written.

### A trap first: a worktree under `/workspaces/tools` hides the defect

Worktrees live at `/workspaces/tools/.claude/worktrees/agent-<id>/`, inside the
shared root's own path (the mechanism of
[repo-43](./repo-43-a-worktree-nested-path-shadows-the-shared-root.md)). Node and
`tsc` both walk up the directory tree looking for `node_modules`. A package
missing from the worktree's farm is therefore resolved from the shared root's
`node_modules`, whenever the shared root has it.

**The first attempt at this reproduction was in the builder's own worktree, and
it did not reproduce.** After farming that worktree from a stale copy of the
install that lacked the six packages:

```
$ ls node_modules/@anthropic-ai/sdk
ls: cannot access 'node_modules/@anthropic-ai/sdk': No such file or directory
$ npm run build            → exit 0
$ npm run check            → exit 0
$ npm test -- --project planner
 Test Files  55 passed (55)
$ (cd tools/planner/agent && node -e 'console.log(require.resolve("@anthropic-ai/sdk"))')
/workspaces/tools/node_modules/@anthropic-ai/sdk/index.js
```

In the pl-39 batch the shared root was stale as well, so the walk-up found
nothing and the build failed. **The practical consequence is for whoever builds
the fix.** A test of the fix run inside a nested worktree passes whether or not
the check works, as long as the shared root is healthy. It has to run in a tree
outside `/workspaces/tools`, as below.

### The reproduction that holds

1. **A stale stand-in for the shared checkout.** Build a directory
   `stale-root/node_modules` that mirrors `/workspaces/tools/node_modules`
   entry by entry, using the farm's own rule (a symlink's target string copied
   verbatim, anything else linked absolutely). Leave out the six packages. Scope
   directories left empty (`@anthropic-ai`, `@stablelib`) are omitted too, as
   they would have been before the install. Copy
   `node_modules/.package-lock.json` in with the six `node_modules/<name>`
   entries deleted. **That hidden lockfile is constructed, not captured.** The
   real pre-install copy was not preserved, so option B's result below is
   measured against a stand-in.
2. **A checkout outside `/workspaces/tools`.** Run
   `git archive --format=tar HEAD | tar -x -C <scratch>/tree`, then
   `git -C <scratch>/tree init -q`. The init is needed because the farm finds
   its destination with `git rev-parse --show-toplevel`. There is no
   `node_modules` in any ancestor of the scratch path (checked with `ls -d` on
   each ancestor, from `/` down).
3. **Farm, then build, check and test, as a dispatched agent would.**

Run from `<scratch>/tree`:

```
$ bash /workspaces/tools/.claude/scripts/worktree-farm.sh <scratch>/stale-root
farm built: 247 top-level entries in <scratch>/tree/node_modules
now run: npm run build   (without dist, suites fail with packageEntryFailure)
farm exit=0
$ ls node_modules/@anthropic-ai/sdk
ls: cannot access 'node_modules/@anthropic-ai/sdk': No such file or directory
$ grep -n '"node_modules/@anthropic-ai/sdk": {' package-lock.json
35:    "node_modules/@anthropic-ai/sdk": {

$ npm run build                                   → exit 2
> @planner/agent@0.1.0 build
> tsc --build

src/providers/anthropic.ts(62,8): error TS2307: Cannot find module '@anthropic-ai/sdk' or its corresponding type declarations.
src/providers/anthropic.ts(63,37): error TS2307: Cannot find module '@anthropic-ai/sdk/helpers/beta/zod' or its corresponding type declarations.
src/providers/anthropic.ts(68,8): error TS2307: Cannot find module '@anthropic-ai/sdk/resources/beta/messages/messages' or its corresponding type declarations.

$ npm run check                                   → exit 2   (8 `error TS` lines, from `typecheck`)
$ npm test -- --project planner                   → exit 1
 FAIL  |planner| tools/planner/agent/test/anthropic-provider.test.ts [ tools/planner/agent/test/anthropic-provider.test.ts ]
Error: Cannot find package '@anthropic-ai/sdk/helpers/beta/zod' imported from <scratch>/tree/tools/planner/agent/test/anthropic-provider.test.ts
 Test Files  25 failed | 30 passed (55)
      Tests  482 passed (482)
```

**Nothing warns before the TS2307.** The farm prints the two lines above and
exits 0. In the build log, a case-insensitive grep for
`warn|missing|lockfile|package-lock` over everything before the first
`error TS` line returns nothing. The build compiles every workspace ahead of
`@planner/agent` successfully, so the failure surfaces as a type error in one
provider file, some way into the build.

**The control is the same tree, farmed from the real, now-healthy shared
checkout:** 253 entries, build exit 0, check exit 0, `Test Files 55 passed (55)`.

### Where a check could go, and does not

The farm has exactly two preconditions, and neither looks at freshness:

```
28  SHARED_ROOT="${1:-/workspaces/tools}"
33  [ "$DEST" != "$SHARED" ] || { echo "refusing: this is the shared checkout" >&2; exit 1; }
34  [ -d "$SHARED" ] || { echo "no shared node_modules at $SHARED" >&2; exit 1; }
```

`.claude/scripts/worktree-farm.sh:34 "no shared node_modules at"` checks that the
source directory exists. Nothing after it compares the source against the
lockfile. The linking loop at
`.claude/scripts/worktree-farm.sh:45 "for e in $(ls -A"` links whatever the
source holds. The success line at
`.claude/scripts/worktree-farm.sh:53 "farm built:"` counts entries, and has no
way to know what count to expect. The count differed in this reproduction (247
stale, 253 healthy), but both runs printed the same message.

A check fits after that existence check and before the loop: the source is known to exist by
then, and nothing has been linked yet. `$SHARED_ROOT/package-lock.json` is the
natural lockfile to read, because it is the lockfile that install was made from.
Reading the worktree's own `package-lock.json` instead would also catch a
worktree whose branch adds a dependency the shared checkout never had. **That is
a second scope, and choosing it is part of the decision below.**

The existing guidance does not cover this either.
`.claude/skills/orchestrate-tickets/reference/worktree-hygiene.md:268 "Verify a farm the same way rather than trusting it"`
checks that a workspace link points into the worktree and that one suite runs.
Only a suite that imports the missing package would catch this. The third
builder's run shows a failing suite can still be reported as pre-existing.

## Decision: how the farm should detect a stale source

**Open.** Each candidate was run against the stale stand-in and the healthy
shared checkout. Whether it should _warn_ or _refuse_ (exit non-zero) is a
separate choice that applies to every option. Refusing stops a builder
reporting green on a broken tree. It also stops every dispatch on a false
positive, until someone reinstalls the shared checkout or fixes the check.

- **A. Presence check against the lockfile.** For every
  `package-lock.json` `packages` entry under `node_modules/` that is top-level,
  not `optional`, and not a workspace `link`, test that
  `$SHARED/<name>` exists. Measured with a ~15-line `node` script: 299 entries
  checked. **Stale: exactly the six named above. Healthy: none.** Both exclusions
  are required. Without `optional`, the platform builds absent on this OS would be
  reported every run. Without `link`, the workspace links, whose relative targets
  do not resolve from outside a checkout, were misreported in a first draft.
  Needs `node`, which every consumer of the farm already has. Misses a package
  that is present but at the wrong version.
- **B. Compare `package-lock.json` with `$SHARED/.package-lock.json`, npm's
  hidden lockfile.** **A byte or hash comparison does not work.** Against the
  healthy install the sha256 values differ (`185c76deba2366c7` against
  `357bc1bc6259b9e3`, first 16 hex digits). The hidden lockfile has 104 fewer
  entries (455 against 351), because it omits uninstalled optional builds, and
  the two files disagree on the version of two workspace entries
  (`tools/downloader/api`, `tools/planner/api`). A hash check would therefore
  warn on every run. An entry-wise version, _non-optional `node_modules/` keys in
  the lockfile with no key in the hidden lockfile_, reports **0 healthy and the
  six stale**. That stale figure is against the constructed hidden lockfile from
  step 1, so its behaviour on the real incident is unmeasured. It relies on npm
  keeping the hidden lockfile accurate, which npm does not promise when
  `node_modules` is edited by hand, as the two builders' `npm pack` extraction
  did. Any version-sensitive variant would trip on the two workspace entries
  above.
- **C. Run `npm ls --depth=0` in the worktree after farming.** Stale:
  **exit 1** in 1,314 ms, with
  `npm error missing: @anthropic-ai/sdk@^0.125.0, required by agent@npm:@planner/agent@0.1.0`.
  Healthy: **exit 0** in 706 ms. It names only the direct dependency, not the
  five transitive ones, which is enough to act on. It needs no code of our own to
  maintain. `npm ls` exits non-zero for problems other than a missing package
  (`invalid`, `extraneous`), so it can fail for reasons unrelated to this defect.
  How often that happens here is unmeasured: it was exit 0 on the one healthy
  tree tried.
- **D. No check: document "reinstall the shared checkout after a merge that
  changes `package-lock.json`"** in the orchestration skill. This costs the least.
  It relies on the reinstall step being remembered, and nobody remembered it
  after pl-39.

**Recommendation, for whoever answers:** A, as a warning, in the farm. It is the
only option measured clean on the real healthy install and exact on the stale
one without relying on npm's internal file. It runs before anything is linked,
and a warning cannot block a batch on a false positive. C is the fallback if
maintaining a script is unwanted. This is the filer's reading, not a decision.

## Build

Once the decision above is answered, and whichever option it picks:

1. Implement the check in `.claude/scripts/worktree-farm.sh` (A, B or C), or in
   the orchestration skill's worktree guidance (D). It should name each
   absent package, and name the remedy: `npm install` **in the shared
   checkout**, since the farm refuses to run there. If the check reads
   `$SHARED_ROOT/package-lock.json`, handle a source root that has none.
2. Keep the farm's fixed cost small. It is sub-second today, and dispatches
   depend on that.
3. Verify with the reproduction above, **in a tree outside `/workspaces/tools`**.
   A nested worktree makes the stale case pass by walk-up, as shown above.
4. If a regression test is added, give it a fixture root whose `node_modules`
   lacks a declared package, and have it fail against today's farm first. No
   test currently exercises `worktree-farm.sh`: `grep -rln worktree-farm` over
   the repo's code and config files, with `node_modules`, `dist` and `.git`
   excluded, finds only the script itself and `.claude/settings.json`.

## Done when

1. Farming a tree outside `/workspaces/tools` from a source `node_modules` that
   lacks a non-optional package declared in `package-lock.json` names that
   package before the farm exits, and names the remedy.
2. Farming from the healthy shared checkout prints nothing new. That includes
   no report for optional platform builds, for workspace links, or for the two
   workspace entries whose versions differ between the lockfile and the hidden
   lockfile.
3. The farm still completes in under a second on the healthy shared checkout,
   measured.
4. `npm run check` passes.

## Log

- **2026-09-14 — filed.** Filed by a `builder` dispatched on Opus 5 (1M
  context), unrated at dispatch. The owner chose "Install, and file a repo
  ticket". The reproduction above is this filing's verification, so no gate ran
  on it. Its scratch files (the stand-in root, the archive trees, the scripts)
  were under a session scratchpad and are not preserved. The steps above are
  enough to rebuild them. Corrections to the dispatch brief:
  - **"Reproduce it in your own worktree or the scratchpad" is not a free
    choice.** In a worktree nested under `/workspaces/tools` it does not
    reproduce once the shared root is healthy: build and 55/55 test files green,
    resolution via walk-up. Only the scratchpad tree reproduced it.
  - **`add: 109` is not 109 missing packages.** 103 of them are optional
    platform builds, matching `added 6 packages` on the real install.
  - Outside this ticket, `package-lock.json` at `95c6403` carries three workspace
    entries marked `extraneous` (`packages/engine`, `packages/resolvers`,
    `packages/shared`) for directories that no longer exist. Noted, not
    investigated, and not part of this defect.
