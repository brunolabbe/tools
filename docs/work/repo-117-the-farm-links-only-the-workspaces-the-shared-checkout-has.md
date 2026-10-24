---
id: repo-117
tool: repo
title: The farm links only the workspaces the shared checkout has, and the freshness check cannot see a missing one
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-117 — The farm links only the workspaces the shared checkout has, and the freshness check cannot see a missing one

## Why

`.claude/scripts/worktree-farm.sh` recreates whatever `/workspaces/tools/node_modules`
holds, and `.claude/scripts/check-farm-freshness.mjs` compares that directory with the
shared checkout's own `package-lock.json`, skipping every `link: true` entry by the
repo-45 decision. So a workspace that `main` added after the shared checkout's last
`npm install` is linked by nobody and warned about by nobody: `packages/ui` (repo-108,
merged 2026-10-19 as `da4673e1`) was missing from every farmed worktree for two days,
and every agent of four batches — over twenty builders, gates and landers — hit
`Rollup failed to resolve import "@webtools/ui/tokens.css"` on `npm run build` and ran
`ln -s ../../packages/ui node_modules/@webtools/ui` by hand (orchestration log entries
tools-11, tools-dd, tools-8e, tools-cc and tools-49, 2026-10-20 to 2026-10-24). A link
appeared in the shared checkout on 2026-10-21 02:21 and the symptom stopped; the cause
stands, and recurs the next time a workspace is added.

Reproduction, recorded at the shared checkout on `00977771` and again on `2d1b22bb` and
`93bfa1f1`:

```
$ node .claude/scripts/check-farm-freshness.mjs /workspaces/tools; echo exit=$?
exit=0
$ ls /workspaces/tools/node_modules/@webtools/
core
$ grep -n '"node_modules/@webtools/ui"' package-lock.json
3090:    "node_modules/@webtools/ui": {
$ # in a farmed worktree at da4673e1 or later
$ bash /workspaces/tools/.claude/scripts/worktree-farm.sh
farm built: 402 top-level entries in …/node_modules
$ npm run build
… Rollup failed to resolve import "@webtools/ui/tokens.css" …
```

The check reads the shared checkout's lockfile, so a shared checkout behind
`origin/main` passes while a worktree on `main` misses a workspace:
`git show origin/main:package-lock.json | grep -c '"packages/ui"'` → `2` beside
`grep -c '"packages/ui"' package-lock.json` → `0` on 2026-10-20.

## Build

1. In `worktree-farm.sh`, after the copy loop, read the worktree's own root
   `package.json` `workspaces` globs, resolve each workspace directory's `name`,
   and create the `node_modules/<name>` link relative to the worktree
   (`../../packages/<dir>` or `../../tools/<tool>/<dir>`) wherever the copy loop
   left none. The shared checkout's links stay the template for everything else.
2. In `check-farm-freshness.mjs`, keep the repo-45 scope for fetched packages, and
   add a second pass over the worktree's workspaces: a workspace with no
   `node_modules/<name>` link after the farm is named in the warning with the
   `ln -s` that repairs it. Compare against the worktree's lockfile, not the shared
   checkout's, so a stale shared checkout cannot pass a worktree on `main`.
3. Update `roles/common.md` › _Your worktree_'s hand-link paragraph to say the farm
   links workspaces itself, keeping the hand-link as the fallback for a workspace
   the branch adds before its first commit.

Traps: the farm runs before `npm run build`, so a workspace link to a directory
with no `dist` yet is correct and expected. The copy loop recreates scope
directories as real directories; the new links go inside them.

## Done when

1. In a worktree at a commit whose shared checkout lacks one workspace link,
   `bash .claude/scripts/worktree-farm.sh` creates it, and `npm run build` exits 0
   with no hand `ln -s`. The test removes the link from a fixture shared root and
   farms from it.
2. `node .claude/scripts/check-farm-freshness.mjs <root>` exits 0 and prints the
   missing workspace's name and the repairing `ln -s` when the farmed tree lacks a
   workspace link, and prints nothing when none is missing. Both cases are tests.
3. `roles/common.md` › _Your worktree_ says the farm links workspaces, and names the
   hand-link only as the fallback for a workspace a branch adds.

## Log

- 2026-10-24 — Filed by the 2026-10-24 review of the orchestration log, from six items in five
  batch entries (tools-11 items 1–2, tools-dd item 2, tools-8e item 1, tools-cc item 1, tools-49
  item 6); the reproductions above are theirs, re-read against the shared checkout on 2026-10-24,
  where `ls node_modules/@webtools/` → `core ui` and the check exits 0.
- 2026-10-24 — Built (branch `repo-117-farm-links-missing-workspaces`).
  - `check-farm-freshness.mjs` gains `listWorkspaces`, `findMissingWorkspaceLinks`,
    `linkMissingWorkspaces` and `warnIfWorkspacesUnlinked`, and flags: `--packages`
    (the repo-45 pass, as before), `--workspaces` (the new warning), `--link` (create
    the links); `<root>` alone runs both checks on `<root>`. `worktree-farm.sh` calls
    `--packages` on the shared root before the copy loop, then `--link` and
    `--workspaces` on the worktree after it, so the link lands in the real scope
    directory the loop made. A scope directory that is itself a symlink is skipped, as
    writing through it would put the link in the shared checkout.
  - The brief's step 2 says to compare "against the worktree's lockfile"; the pass reads
    the worktree's `package.json` `workspaces` globs instead (step 1's own source), which
    needs no lockfile and cannot disagree with it. Only a whole `*` path segment is
    expanded (`packages/*`, `tools/*/*`), no `**` or negation.
  - Done when 2 says the workspace warning exits 0, unlike the fetched-package pass
    (exit 1); built as written. The farm discards both exit codes.
  - Fixture proof (scratch `build/real.sh`): a shared root whose `@webtools` held only
    `core`, farmed into this worktree with `node_modules` removed, printed
    `linked workspace @webtools/ui -> ../../packages/ui`, and `npm run build` exited 0
    with no hand `ln -s`. Against a healthy shared root the farm is silent about workspaces.
  - Not folded in: `reference/worktree-hygiene.md` › _Give a new worktree its
    dependencies_ still says the shared checkout "needs one `npm install`" after a new
    workspace merges, and `SKILL.md` step 1 runs `check-farm-freshness.mjs
/workspaces/tools`, which now also names an unlinked workspace there. Both are pages
    this ticket's dispatch put out of scope; the first sentence is now stale for the link
    (not for fetched dependencies).
