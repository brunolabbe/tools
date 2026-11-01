---
id: repo-137
tool: repo
title: The farm's freshness remedy names an install the pages forbid, and has no case for a stacked branch
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-137 — The farm's freshness remedy names an install the pages forbid, and has no case for a stacked branch

## Why

`.claude/scripts/check-farm-freshness.mjs`, run by the farm in a worktree,
prints a remedy when the shared checkout lacks a package the worktree's lockfile
declares: _"If this branch's own diff adds the package, the one `npm install
--ignore-scripts` from `common.md` applies; otherwise, stop and report it"_.
Two things are wrong with it.

**The install it names is now forbidden.** On 2026-11-01 (tools-e6's log, item

1. a builder's `npm install --ignore-scripts` in a farmed worktree rewrote
   `node_modules/.bin` and `node_modules/.package-lock.json` for every concurrent
   agent, because the farm makes both of those symlinks into the shared checkout; a
   gate's build in the same minute read `sh: 1: tsc: not found`. The 2026-11-01
   review of the orchestration log rewrote `roles/common.md`'s dependency bullet
   around that measurement: never install in a farmed worktree; a version change
   or a new package is a relock (`--package-lock-only --ignore-scripts`), and the
   pull request's CI is the run on the new version. The script's remedy still
   sends an agent to the install.

**It has no case for a stacked branch.** A branch cut from a sibling that added
a package warns `missing N package(s)` with the parent's packages, and the
remedy's two cases — "your diff adds it" and "otherwise stop" — fit neither:
the diff against the parent adds nothing, and stopping is wrong when the parent
is the cause (repo-123 on repo-121, 2026-10-25; tools-5e's log, item 10).

## Reproduction

The remedy text, on `main` at `8ad4e91d`:

```
$ grep -n "npm install --ignore-scripts" .claude/scripts/check-farm-freshness.mjs
140:      "If this branch's own diff adds the package, the one `npm install --ignore-scripts` " +
$ grep -n "npm install --ignore-scripts" scripts/test/check-farm-freshness.test.ts
679:      expect(result.stderr).toContain("npm install --ignore-scripts");
```

The farm's two symlinks, in any farmed worktree (read 2026-11-01 in
`.claude/worktrees/agent-a8e5358889b5d274e`):

```
$ ls -la node_modules | grep -E '\.bin|package-lock'
lrwxrwxrwx  1 pwuser pwuser    35 Nov  1 13:04 .bin -> /workspaces/tools/node_modules/.bin
lrwxrwxrwx  1 pwuser pwuser    49 Nov  1 13:04 .package-lock.json -> /workspaces/tools/node_modules/.package-lock.json
```

The stacked case (relayed from repo-123's builder and lander, 2026-10-25, not
re-run): farming on a branch cut from `origin/repo-121-vite-8-vitest-5` →
`warning: … is missing 3 package(s)` and the remedy above.

## Decision — answered 2026-11-01 by the owner

**Answer: (a)**, no install in a farmed worktree, chosen from (a), (b) and (c)
below with (a) recommended; `roles/common.md`'s dependency bullet stands as the
review wrote it. Rated `mechanical` as filed. The options stay as they were put.

Which rule the remedy follows. `roles/common.md` was written under (a) by the
2026-11-01 review, pending this answer; (b) would change it back.

- **(a) No install in a farmed worktree, ever.** A dependency change is a
  relock, the tree runs the old version, and the draft pull request's CI runs
  the new one; a gate reads that CI. The remedy's cases become: the package is
  the one your relock added (expected, say so), or it is `main`'s or a parent
  branch's (stop and report, naming the packages). Recommended: it needs no
  script beyond this one, and it is what the two batches that followed the rule
  measured as safe. Its cost is that a `Done when` line about the new version
  is `unproven (gate)` until CI reads, for the builder and the gate alike.
- **(b) The farm learns to make an install local.** A `--own-deps` mode (or a
  flag on the install step) replaces `.bin` and `.package-lock.json` with real
  copies before an install, so npm writes in the worktree; native modules
  (`better-sqlite3`) still come out unbuilt and need their `build/` copied from
  the shared checkout. A branch can then run its new version locally. Cost: a
  farm change, its test, and a procedure with two more steps that every
  dependency builder pays; untested whether npm leaves the per-package symlinks
  alone when it reifies a changed version.

## Build

1. Rewrite the remedy in `.claude/scripts/check-farm-freshness.mjs` under the
   chosen option, with the stacked-branch case named: when the worktree's
   lockfile matches no `origin/main`, the packages are a parent branch's or
   the agent's own relock, and the text says which to do for each.
2. Update the assertions in `scripts/test/check-farm-freshness.test.ts` (the
   block around line 679) to the new text, and add one case for a worktree
   whose lockfile differs from the shared checkout's by a package the branch
   itself declares.
3. If (b): the farm mode, its header comment, and `roles/common.md`'s
   dependency bullet reworded to name it — that page edit is the owner's, in
   this ticket's pull request.

## Done when

1. The remedy printed for a worktree whose lockfile declares a package the
   shared checkout lacks names no `npm install`, and names what to do when the
   package is the branch's own relock and when it is a parent branch's.
2. `scripts/test/check-farm-freshness.test.ts` asserts 1 and
   `npm test -- --project repo` passes.
3. The text agrees with `roles/common.md`'s dependency bullet word for word on
   what is allowed.

## Log

- 2026-11-01 — Filed by the review of the orchestration log (tools-5e's items
  2 and 10, tools-18's item 2, tools-97's item 3, tools-54 third's item 2,
  tools-e6's items 1 to 3). The symlink reading and the remedy grep are re-run
  on `main` at `8ad4e91d`; the stacked case is relayed.
- 2026-11-01 — Owner chose (a) at the review session's checkpoint (asked beside
  repo-135's question); `status` moved to `ready` in the same commit. Build 3
  does not apply.
