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
