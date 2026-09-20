---
id: repo-51
tool: repo
title: One preflight command replaces the pre-PR checks the skill pages ask for by hand
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-51 — One preflight command replaces the pre-PR checks the skill pages ask for by hand

## Why

The orchestration history's recurring "what the skill got wrong" items are
mostly forgotten steps, each one command, each costing a round when missed:

- the citations gate not run before the push, so the pull request went red in
  CI (nineteenth session, item 1; recurred unchanged in the twentieth and the
  twenty-first);
- the `## Review` section not present on the branch when the pull request
  opened — `repo-29` reached an open PR carrying five gate rounds and no record
  (fourteenth session, item 4);
- a `feat` or `fix` title on a branch whose only `tools/` paths were markdown,
  which release-please routes to a tool's changelog (seventeenth session, item
  5; twentieth, item 12);
- two open branches in one batch that `git merge-tree` would have shown
  conflicting on a gate record, found only at merge (seventeenth, nineteenth
  and twentieth sessions).

On 2026-09-20 the sweep of those sessions wrote all four into `SKILL.md` step 9
and `builder.md`'s gate list as prose. Prose rules failed for eleven sessions;
the one instrument in this loop that stopped being wrong is the id sweep, and it
stopped when it became `scripts/next-id.mjs` with a test per guard. The same
argument applies here.

## Build

Add `scripts/preflight.mjs`, run from a branch's worktree with the base as an
argument, that performs in order and reports each with its own exit bit:

1. `npm run check`, and the project suite for each tool the diff touches (read
   the paths, not a flag);
2. `node scripts/citations-gate.mjs --against <base>`;
3. the `## Review` presence test — `git show HEAD:<ticket> | grep '^## Review'`
   for every ticket the branch marks `done`, and a distinct message for a
   `done` ticket with no record;
4. the title-type test — read the intended title from `--title` or the branch's
   last commit subject, run `scripts/commit-message.mjs` over it, then check
   whether the type is hidden in `release-please-config.json` and, if it is not,
   whether every `tools/<tool>/` path in `git diff --name-only <base>...HEAD` is
   markdown; fail with the reason when a changelog would be cut for a docs-only
   change;
5. `git merge-tree --write-tree HEAD <head>` against every other open pull
   request head (`gh pr list --json headRefName`), reporting the conflicting
   paths and which are gate records.

Print one line per check with its result, and the exit code as a bitmask the
way `citations.mjs` does, so a ship condition can be "preflight exits 0".

Then replace the prose: `SKILL.md` step 9's three checks and `builder.md`'s
gate list name the script and nothing else. Keep the measurements that explain
why each check exists; drop the instructions to run them by hand.

## Done when

- `node scripts/preflight.mjs --base origin/main` exits 0 on a clean branch and
  non-zero, naming the check, on each of: a moved citation in a merged record, a
  `done` ticket without `## Review`, a `feat` title over markdown-only `tools/`
  paths, and a gate record two open heads both edit. Each case is a test that
  plants the failure and reads the bit.
- A positive control for check 5: a test that opens no conflict exits 0 and
  says so, so an empty PR list cannot read as a pass.
- `SKILL.md` step 9 and `builder.md` name the script and no longer list the
  checks as separate instructions.

## Log

- 2026-09-20 — Filed from the owner's review of the orchestration history,
  after the sweep in #281 had written these checks as prose. Not built there:
  it is a script with tests, and #281 is scoped to the pages.
