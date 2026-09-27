---
id: repo-74
tool: repo
title: citations.mjs's candidateFiles reports a false ambiguous during a merge conflict
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-74 — `citations.mjs`'s `candidateFiles` reports a false `ambiguous` during a merge conflict

## Why

Found by repo-48's gate (Sonnet), verbatim:

> `scripts/citations.mjs`'s `candidateFiles`
> (`scripts/citations.mjs:843 "export function candidateFiles"`) and
> `makeResolver` (`scripts/citations.mjs:824 "tracked.includes(file)"`) -- fed
> a tracked-files array with one path repeated
> three times (the shape a mid-merge `git ls-files` produces, reproduced in a
> throwaway repo: 3 entries mid-conflict, 1 after `git add`), the suffix form
> reports `ambiguous -- 3 tracked files match`, the full repo-relative path
> resolves clean -- exactly as claimed.

`git ls-files` prints a conflicted path once per index stage — three times for a
both-modified file — and `candidateFiles` concatenated that output unfiltered.
A merge conflict is exactly when someone runs the citations gate by hand to
check a resolution, and a bare-name citation of the conflicted file then fails
for a reason that has nothing to do with the record.

**Reproduced** at `1a8321c` with a scratch script driving the worktree's own
`citations.mjs` over a throwaway repository mid-conflict:

```
merge exit 1
ls-files: ["src/tls.ts","src/tls.ts","src/tls.ts"]
candidateFiles: ["src/tls.ts","src/tls.ts","src/tls.ts"]
tls.ts -> {"error":"ambiguous — 3 tracked files match (src/tls.ts, src/tls.ts, src/tls.ts)"}
src/tls.ts -> {"path":"src/tls.ts"}
after add, ls-files: ["src/tls.ts"]
```

## Build

De-duplicate what `candidateFiles` returns in the working-tree branch. The
finder called it one line; verify rather than assume — check every caller of
`makeResolver` for another source of repeated paths. Keep `citations.mjs`' line
count neutral: merged records cite `candidateFiles` and `makeResolver` by line.

## Done when

- `candidateFiles(dir, null)` lists a conflicted path once, and a bare-name
  citation of it resolves — a test drives a real conflict and asserts the
  three-entry `git ls-files` precondition.
- `npm run check`, the `repo` project's suite and
  `node scripts/citations-gate.mjs --against origin/main` pass.

## Review

**Gate: PASS** -- 2026-09-27 -- `1a8321ce0615059d9b9d338628b78a2d9552249a...a9a3d840c2dabeee30b637d4fe49f2a63ca0c2f6` -- code-review at high (dispatch named a detailed, per-ticket attack list; treated as above the medium default)

| Done when                                                                                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidateFiles(dir, null)` lists a conflicted path once, and a bare-name citation of it resolves -- a test drives a real conflict and asserts the three-entry `git ls-files` precondition | proven -- precondition: `scripts/test/citations-gate.test.ts:1115 "this cannot pass by the conflict never happening"`; dedup plus both resolutions: `scripts/test/citations-gate.test.ts:1119-1121 "files.filter((f: string) => f ==="`; reproduced against a real throwaway-repo merge conflict (not a synthetic array), red at base sha 1a8321c own citations.mjs (expected length 1, got 3), green at head |
| `npm run check`, the `repo` project suite and `node scripts/citations-gate.mjs --against origin/main` pass                                                                                 | verified -- preflight own check 1 and check 2 report ok; independently: npx vitest run --project repo -> 521 passed across 11 files; node scripts/citations-gate.mjs --against origin/main -> 118 enforced, 0 failing, 6 grandfathered, 0 raised, exit 0                                                                                                                                                      |

- **findings** -- code-review at high returned 0; 0 carried, 0 dropped.
- NFR: security n/a -- performance n/a, the added `Set` is one pass over an already-materialised array -- reliability: fixes a real false `ambiguous` a person hand-checking a merge conflict would hit -- maintainability: checked all four callers of `makeResolver`; `makeTrees` and the CLI-with-rev path call `candidateFiles(repo, commit)`, which runs `git ls-tree` and cannot repeat a path, so only the worktree path (`candidateFiles(repo, null)`) needed the fix, and that is the only branch changed.

## Log

- 2026-09-27 — Built, in one pull request with repo-73, repo-75 and repo-76.

  **One line, verified.** `makeResolver` has four callers: `citations.mjs`' CLI
  and `citations-gate.mjs` pass `candidateFiles(repo, null)` (the worktree —
  the defect); `citations.mjs`' `makeTrees` and the CLI with a rev pass
  `candidateFiles(repo, commit)`, which is `git ls-tree -r --name-only` and
  never repeats a path; tests pass literal arrays. `git ls-files --others` lists
  untracked files only, so it cannot repeat one the index holds. So only the
  first `ls-files` needs it:
  `return [...new Set(run(["ls-files"])), ...run(["ls-files", "--others", "--exclude-standard"])];`.
  Wrapping both calls in one `Set` is the obvious spelling, and oxfmt splits it
  over three lines, which would move every line below it.
  `git ls-files --deduplicate` would also do, from git 2.31; a `Set` asks
  nothing of git's version. The docblock's last two lines were rewritten to carry the reason
  without adding a line.

  Red, `npx vitest run scripts/test/citations-gate.test.ts -t "merge conflict"`:
  `1 failed | 46 skipped (47)`, failing on
  `expected [ 'src/tls.ts', 'src/tls.ts', …(1) ] to have a length of 1 but got 3`
  with the `ls-files` precondition assertion above it already passing. Green, both citations suites:
  `npx vitest run scripts/test/citations-gate.test.ts scripts/test/citations.test.ts`
  → `153 passed (153)`. The scratch reproduction after the fix prints
  `candidateFiles: ["src/tls.ts"]` and `tls.ts -> {"path":"src/tls.ts"}`.

  The test is at the end of `citations-gate.test.ts`, which no open pull
  request touches; `citations.test.ts`' end is claimed by repo-63's branch.
