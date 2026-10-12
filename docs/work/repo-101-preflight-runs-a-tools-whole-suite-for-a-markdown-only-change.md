---
id: repo-101
tool: repo
title: Preflight runs a tool's whole suite for a change that touches only markdown under that tool
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-101 — Preflight runs a tool's whole suite for a markdown-only change

## Why

On 2026-10-12 the owner asked whether agents could test only what they had
touched. `scripts/preflight.mjs` already does this per tool: `testPlan` runs
`npm test -- --project <tool>` for each tool that `touchedTools` finds in the
diff. But `touchedTools` matches any path under `tools/<tool>/`, ticket files
included.

**Reproduced on `origin/main` at `f52848a4`:**

```
testPlan(["tools/downloader/docs/work/dl-111-x.md"])
  -> run check | test -- --project downloader | test -- --project core
```

The downloader project is 1,150 s of summed test time on CI, and about 10
minutes locally while `browser-resolver.test.ts` is one serial file. A gate
record, a Log entry or a filed ticket pays all of it. 38 of the 120 downloader
commits on `main` since 2026-09-01 touched only markdown.

CI already skips the matrix for an all-`.md` change, through `ci.yml`'s
`changes` job. Preflight does not. Ticket files are still checked locally,
because preflight's `ciCommands` check derives `ci.yml`'s `check` steps:
`deriveExtraCiCommands` returns `status.mjs --json` and
`vitest run scripts/test/status.test.ts`.

**The owner chose this on 2026-10-12**, together with
[repo-102](./repo-102-preflight-runs-every-package-of-a-tool-for-a-change-to-one.md),
which narrows the run further.

## Build

1. In `touchedTools` (`scripts/preflight.mjs`), do not count a path ending in
   `.md` as touching its tool. Use the same rule as the `changes` job: a
   suffix test on the path, with no exceptions. Read that job's comment for why
   `--no-renames` matters there. Check that preflight's own diff does not
   report a renamed `.ts` file as its `.md` destination only, which would let a
   deleted source file skip its suite.
2. `core` runs last "whenever code moved" (repo-90). Check that an all-`.md`
   diff now plans no `npm test` at all, and that a diff mixing `.md` and code
   still plans `core`.
3. `scripts/` and shared-config detection are unchanged. A `.md` file at the
   root is not shared config today either.
4. Add the tests to `scripts/test/preflight.test.ts`:
   - an all-`.md` diff under a tool plans `npm run check` only;
   - `.md` plus one `.ts` under the same tool plans that tool and `core`;
   - a renamed `.ts` → `.md` still plans the tool.

## Done when

1. `testPlan` on a diff of only `tools/<tool>/**/*.md` returns
   `[["npm", ["run", "check"]]]`, and a test proves it.
2. A diff with any non-`.md` path under a tool still plans that tool's project
   and `core`, and a test proves it.
3. On a markdown-only branch, preflight's `ciCommands` check still runs the
   status suite. Proof: the preflight output pasted in the Log.

## Log

- 2026-10-12 — Filed from the suite-speed audit (dl-111 to dl-117, repo-99,
  repo-100). It is independent of all of them. repo-102 depends on it because
  both edit `testPlan`.
- 2026-10-12 — Built on `repo-101` from `origin/main` `bb4d2044`, commit
  `036e7ac6`. `touchedTools` skips a path ending in `.md`, the suffix rule
  `ci.yml`'s `changes` job uses. `preflight()` reads its committed diff with
  `git diff --no-renames`, so a `.ts` renamed to `.md` still lists its deleted
  source.
  - The rename case is the one the brief asked to watch fail. Applying only the
    `.md` skip, `npx vitest run scripts/test/preflight.test.ts -t repo-101`
    fails it: `expected [ 'npm run check' ] to include 'npm test -- --project
downloader'`. The `--no-renames` change turns it green. The brief's
    description of that case as a regression test is only half true: before the
    `.md` skip, the destination `.md` still counted as the tool, so the same
    test passes on `main`. It needs the `.md` skip first to be able to fail.
  - Done when 1 and 2 are tests in `scripts/test/preflight.test.ts`, appended
    at the end: `testPlan plans no npm test for a diff of only markdown under
tools/ (repo-101)` and `testPlan still plans the tool and core for markdown
mixed with one code path (repo-101)`. Before the fix the first fails with
    `expected [ [ 'npm', [ 'run', 'check' ] ], …(3) ] to deeply equal [ [
'npm', [ 'run', 'check' ] ] ]`.
  - `npx vitest run scripts/test/preflight.test.ts`: 74 of 74 pass after the
    fix.
  - Not folded in: repo-102, which edits the same `testPlan` area and depends on
    this ticket. It is its own design (a package graph, fail-open rules), not a
    small piece this change makes free.
  - Open, not changed: `sharedConfigTouched` still treats any path under
    `packages/` as shared config, `.md` included, so a markdown file added under
    `packages/` still plans the full `npm test`. The brief said shared-config
    detection stays unchanged, so it stays. Whether a `packages/**/*.md` should
    skip the full suite is a decision for the owner.
  - Full preflight at the branch head, against `origin/main`, exit 0:

    ```
    == check ==
    ok    npm run check
    ok    npm test -- --project repo
    ok    npm test -- --project core

    == ciCommands ==
    ok    node scripts/check-lockfile-sync.mjs
    ok    node scripts/status.mjs --json
    ok    npx vitest run scripts/test/status.test.ts

    == review ==
    ok    no ticket on this branch is newly marked done

    == title ==
    ok    "fix(repo): a tool's markdown does not plan its suite (repo-101)" — type and paths agree

    == mergeTree ==
    comparing HEAD against 2 other open pull request head(s)
    ok    #401 release-please--branches--main--components--ledger merges cleanly with HEAD
    ok    #398 release-please--branches--main--components--downloader merges cleanly with HEAD
    no conflicts with any other open pull request head

    preflight passed (exit 0)
    ```

  - Done when 3, the markdown-only branch. Its diff against `036e7ac6`, the
    code commit, is this ticket file alone (`git diff --name-only
036e7ac6...HEAD`). Run as `node scripts/preflight.mjs --base 036e7ac6
--title "fix(repo): a tool's markdown does not plan its suite (repo-101)"`,
    exit 0. The check job plans no tool suite, and the `ciCommands` check still
    runs the status suite:

    ```
    == check ==
    ok    npm run check

    == ciCommands ==
    ok    node scripts/check-lockfile-sync.mjs
    ok    node scripts/status.mjs --json
    ok    npx vitest run scripts/test/status.test.ts

    == review ==
    ok    no ticket on this branch is newly marked done

    == title ==
    ok    "fix(repo): a tool's markdown does not plan its suite (repo-101)" — type and paths agree

    == mergeTree ==
    comparing HEAD against 2 other open pull request head(s)
    ok    #401 release-please--branches--main--components--ledger merges cleanly with HEAD
    ok    #398 release-please--branches--main--components--downloader merges cleanly with HEAD
    no conflicts with any other open pull request head

    preflight passed (exit 0)
    ```
