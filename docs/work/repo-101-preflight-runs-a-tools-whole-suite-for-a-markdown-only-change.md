---
id: repo-101
tool: repo
title: Preflight runs a tool's whole suite for a change that touches only markdown under that tool
kind: fix
status: done
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

## Review

**Gate: PASS** — 2026-10-12 · `bb4d2044..983a3e09` · Sonnet 5.5, depth narrow (ticket is `mechanical`: acceptance table plus the four named attacks, no invariant sweep)

The pull request's `test (ubuntu-latest)` leg is red on this head and unread (last bullet); nothing the diff touches can have caused it, but the lander reads that leg's final state before the landing push.

| Done when                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `testPlan` on only `tools/<tool>/**/*.md` returns `[["npm", ["run", "check"]]]`, and a test proves it         | `scripts/test/preflight.test.ts` › "testPlan plans no npm test for a diff of only markdown under tools/ (repo-101)" ✓ — the assertion is `toEqual([["npm", ["run", "check"]]])` over two tools' ticket paths, plus `touchedTools(...)` equal to `[]`. It cannot pass on empty output, since `check` is always planned, and its companion below fails the other way. Positive control run: with the `.md` skip deleted the test goes red (output below)                                                                                                                                                                                                                                                                                                                |
| 2. A diff with any non-`.md` path under a tool still plans that tool's project and `core`, and a test proves it  | `scripts/test/preflight.test.ts` › "testPlan still plans the tool and core for markdown mixed with one code path (repo-101)" ✓ — `toEqual` on the exact three commands. Covers one tool, not two; the per-tool loop is unchanged code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3. On a markdown-only branch, `ciCommands` still runs the status suite; proof is the preflight output in the Log | **verified** — I ran it: `node scripts/preflight.mjs --base <the code commit> --title "fix(repo): a tool's markdown does not plan its suite (repo-101)"`, diff = the ticket file alone, exit 0, `check` plans `npm run check` and nothing else, `ciCommands` prints `ok    node scripts/status.mjs --json` and `ok    npx vitest run scripts/test/status.test.ts`. Also, with a recording `buildRun` on a real repository, a new `.md` under `tools/downloader/docs/work` recorded exactly `npm run check`, `node scripts/check-lockfile-sync.mjs`, `node scripts/status.mjs --json`, `npx vitest run scripts/test/status.test.ts`. `checkCiCommands` takes no path list, so it cannot depend on one. No test asserts this line; the brief names the Log as its proof |

`npx vitest run scripts/test/preflight.test.ts` at this head: **74 of 74** passed; `-t repo-101` selects the 3 new tests, 3 of 3 passed. `npx vitest run packages/core/test/spawn-safety.test.ts`: 18 of 18 (the added `git` call is an argument array).

### The four named attacks

**1. Every place preflight reads a changed-path list** — three, enumerated: `preflight()`'s committed `git diff --no-renames --name-only <base>...HEAD`; `workingTreePaths` (`git status --porcelain=v1 -z --untracked-files=all`, unioned into `testSelectionPaths` for check 1 only); and the consumers of `diffPaths`: `checkReview`, `checkTitle`. `checkMergeTree` reads no path list (it runs `rev-parse HEAD`, `merge-tree --write-tree`, `cat-file -e`). No other file imports `touchedTools` or `testPlan` (`grep` over `scripts/`, `.github/`, `.claude/`). The citations step is retired (`EXIT` comment).

Run, not read: the head tree's own `scripts/preflight.mjs` against a real git repository made of the tree (`git archive` to scratch, `git init`, one base commit), `preflight()` called with the real git runner and a recording `buildRun`; the same 13 scenarios against the base tree for comparison.

| Scenario                                                                                   | base                                              | head                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------- |
| committed `git mv tools/downloader/api/src/config.ts tools/downloader/docs/config-note.md` | downloader + core                                 | downloader + core    |
| committed `git mv` of that `.ts` to root `docs/config-note.md`                             | `npm run check` only (the source's suite skipped) | downloader + core    |
| **staged** `git mv` `.ts` to `.md` (porcelain `R  old -> new`)                             | downloader + core                                 | downloader + core    |
| **unstaged** `mv` `.ts` to `.md` (porcelain ` D old`, `?? new`)                            | downloader + core                                 | downloader + core    |
| staged `.ts` to `.md` with rewritten content (porcelain `D`, `A`)                          | downloader + core                                 | downloader + core    |
| committed `.md` to `.ts` rename; committed `.ts` deletion                                  | downloader + core                                 | downloader + core    |
| committed new `.md` under `tools/downloader/docs/work`                                     | downloader + core                                 | `npm run check` only |
| uncommitted edit to `tools/downloader/docs/02-ROADMAP.md`                                  | downloader + core                                 | `npm run check` only |
| root `README.md` alone                                                                     | `npm run check` only                              | `npm run check` only |

So a `.ts` renamed to `.md` still plans that tool's suite on all three readings (committed, staged, unstaged), and a markdown-only change plans none. `workingTreePaths` already pushed both sides of an `R` entry, so it needed no change. The base column's second row is a hole the branch closes beyond what its test asserts.

**2. Does the `.md` rule match `ci.yml`'s `changes` job?** The job's own pipeline (`git diff --no-renames --name-only <base>...HEAD | grep -v '\.md$'`, under `set -euo pipefail`) run beside preflight, one added file per case:

| Path                                                                                                                                      | `changes` job | preflight                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------- |
| `tools/downloader/docs/note.md`                                                                                                           | `code=false`  | no suite                        |
| `tools/downloader/docs/.md`                                                                                                               | `code=false`  | no suite                        |
| `tools/downloader/docs/a b.md`                                                                                                            | `code=false`  | no suite                        |
| `README.md`, `docs/note.md`, `tools/downloader/README.md`                                                                                 | `code=false`  | no suite                        |
| `tools/downloader/docs/NOTE.MD`, `Note.Md`                                                                                                | `code=true`   | downloader + core               |
| `tools/downloader/docs/note.mdx`                                                                                                          | `code=true`   | downloader + core               |
| `tools/downloader/docs/note.md.bak`                                                                                                       | `code=true`   | downloader + core               |
| `tools/downloader/docs/dir.md/inner.txt` and `inner.ts` (a directory named `*.md`; git lists files, never directories)                    | `code=true`   | downloader + core               |
| `tools/downloader/api/src/x.ts`                                                                                                           | `code=true`   | downloader + core               |
| `packages/core/NOTES.md`                                                                                                                  | `code=false`  | **`npm test` (the full suite)** |
| `scripts/NOTES.md`                                                                                                                        | `code=false`  | **`repo` + `core`**             |
| `tools/downloader/api/src/é.ts`, `docs/é.ts`, `docs/é.md` (default `core.quotepath`: git prints `"tools/downloader/api/src/\303\251.ts"`) | `code=true`   | **no suite**                    |

The suffix test itself agrees on every case: case, `.mdx`, a directory named `*.md`, root versus under `tools/`. The three bold rows are divergences, all outside `touchedTools` (first finding below).

**3. Does `--no-renames` change what another step consumes?** `checkReview`: a renamed ticket now lists the old path too; `git show HEAD:<old>` fails and the existing `catch` skips it ("Deleted on this branch"), so the output is identical to the base (a renamed `dl-1-…` ticket printed the same `FAIL … is marked done but has no ## Review section` at base and head, from the destination path). `checkMergeTree`: reads no path list. **`checkTitle` does change**, and no test asserts it: for a `feat(downloader):` title on a `.ts` renamed to `.md`, base prints `FAIL … every tools/ path is markdown` and head prints `ok … type and paths agree`; a `.ts` deleted with a `.md` added already passed at base, and a `.md` renamed to a `.md` still fails at both. The head's answer is the right one (the deleted source is a code change release-please would attribute), see the third finding.

**4. Positive control**, in place on the detached tree, restored with `git checkout 983a3e09 -- scripts/preflight.mjs` after each:

```
# --no-renames removed from preflight()'s git diff:
× preflight plans the tool's suite for a .ts renamed to .md, since its source was deleted (repo-101)
AssertionError: expected [ 'npm run check' ] to include 'npm test -- --project downloader'
Tests  1 failed | 73 passed (74)

# the `if (p.endsWith(".md")) continue;` line removed from touchedTools:
× testPlan plans no npm test for a diff of only markdown under tools/ (repo-101)
AssertionError: expected [ [ 'npm', [ 'run', 'check' ] ], …(3) ] to deeply equal [ [ 'npm', [ 'run', 'check' ] ] ]
Tests  1 failed | 73 passed (74)
```

Each mutation reddens exactly its own test and no other. The worktree is clean after the restore.

### Findings

- **low** · `nfr:maintainability` · no `Done when` line depends on it · the `touchedTools` docblock says the rule is "the same suffix test that job applies, with no exceptions, so the two cannot disagree about what counts as documentation". True of the suffix test (every row above that varies the suffix agrees). False of preflight as a whole, in both directions, by the table in attack 2: (a) `packages/core/NOTES.md` plans the full `npm test` and `scripts/NOTES.md` plans `repo` + `core`, where CI skips the matrix — stricter, by the brief's Build 3 ("`scripts/` and shared-config detection are unchanged"); (b) a source file with a non-ASCII name (`tools/downloader/api/src/é.ts`) plans **no suite** at base and at head, because `git diff --name-only` quotes it and `touchedTools`' `^tools/` pattern fails on the leading `"` — laxer than CI, pre-existing and not caused by this branch, with no live call site (0 tracked paths contain a non-ASCII byte: `git ls-files | grep -cP '[^\x00-\x7F]'` prints 0). I weighed `high` ("a comment stating a bound the code does not keep") and kept `low`: the sentence's subject is the rule, not the plan, and the rule does agree. Remedy: drop "so the two cannot disagree…" or scope it to the suffix test. The non-ASCII hole, if wanted, is `-z` on both `git diff` calls and is its own ticket.
- **open decision · low** · surfaced by the builder's Log, confirmed by measurement (`packages/core/NOTES.md` → `npm test`, full): should `.md` under `packages/` and `scripts/` skip the suite too? Options: (A) leave it, per Build 3 — **recommended**: 0 tracked `.md` files exist under `packages/` or `scripts/` today, so the rule has no live call site; (B) add the same `.md` skip to `sharedConfigTouched` and `scriptsTouched` — two lines and two tests, and `preflight` then matches `ci.yml` for markdown everywhere; costs: a markdown file there could one day be read by a `core` source scan, and `core` only runs when something else moved. Do not settle it in the branch.
- **low** · `nfr:reliability` · no `Done when` line depends on it · `--no-renames` also changes `checkTitle`'s answer for a rename pair (attack 3), a correct change that no test on the branch asserts and the Log does not mention. A `feat(downloader):` title on a `.ts` renamed to `.md` passed `checkTitle` only after this change. One test appended after the rename test closes it.
- **low** · `nfr:maintainability` · `.claude/skills/orchestrate-tickets/roles/builder.md` (the pre-report preflight bullet: "the suite of every tool the diff touches") and the file header of `scripts/preflight.mjs` (check 1: "for each tool the diff touches") now read as if a markdown-only change plans a tool's suite. Neither is edited by the branch. A builder who believes the page loses nothing: it runs fewer suites, never more.
- **low** · `nfr:maintainability` · the Log's reproduction pins three shas the branch's amend rewrote (the code commit and the two Log commits; the Log says so). `git branch -a --contains <the old code commit>` prints nothing: they resolve today only from the shared object store, and after the squash-merge deletes the branch they will not. The pasted preflight outputs stay readable; the `--base` command beside them will not run. This gate re-ran the same range from the surviving code commit and got the identical output (exit 0).
- **unattributed · not graded** · `gh pr checks 436` on head `983a3e09`: `test (ubuntu-latest)` **fail** at 17 s, `test (windows-latest, informational)` pending, `check` ×2, `changes`, `codeql`, `CodeQL` and `dependency-review` pass. The job page (`WebFetch` on its `detailsUrl`) names the failed step as **Run npm ci**, annotation "Process completed with exit code 1", and the log itself is behind sign-in. The same run's `check` job passed its own `npm ci` on the same sha and the diff touches no `package.json` or lockfile, so the diff is an unlikely cause — unverified, since the log was unreadable (`gh run view 38261686797 --job 114853864306 --log-failed` answers "run … is still in progress; logs will be available when it is complete"). The leg that would run `scripts/test/preflight.test.ts` in CI has therefore not run on this head; the 74 of 74 above is this gate's run, not CI's. Re-run the failed leg and read it on `983a3e09` before the landing push.
- **dropped** · rename detection hiding a `.md` source from `workingTreePaths`: asserted by nothing and false by measurement — all three working-tree rows in attack 1 plan the suite, because the function already pushes both sides of an `R`/`C` entry.
- **dropped** · the builder's claim that the rename test "passes on `main`" and needs the `.md` skip first: true as stated (a `.ts` renamed to a `.md` inside the same tool plans that tool at base, since the destination `.md` still matched `tools/<tool>/`), and the test's destination is inside the tool. Not a defect; the root-`docs/` destination row shows the case the test does not exercise but the fix covers.
- **findings** · the hunt returned 8; 5 carried (4 low + 1 open decision, low), 1 not graded (the CI leg), 2 dropped.
- NFR: security n/a (the added `git` call is an argument array; `spawn-safety` 18 of 18) · performance ✓ (the point of the ticket: a markdown-only diff drops from `--project <tool>` + `core` to `npm run check`) · reliability ✓ (the fail-open direction is kept: an unlisted source path is still code) · maintainability — above. Invariants skipped as untouchable by this diff: cross-tool imports, `AppError` taxonomy, redaction, SSRF, progress, contract edits, Dockerfile closure.

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

  - Note on the shas above. The `Co-Authored-By` trailer was added after these
    runs, by rebasing the three commits with `--amend`. The code commit
    `036e7ac6` is now `a0c9d9f6`, the build Log commit `68b4cd25` is now
    `90c45ca3`, and the commit that records the markdown-only run, `7dcc625f`,
    is now `fd7f25bd`. `git diff 7dcc625f fd7f25bd` is empty, so each tree is
    the one the runs measured. `036e7ac6` was the `--base` for the
    markdown-only run.
- 2026-10-12 — Landed by the fixer (Sonnet 5.5) after gate 1 PASS at `983a3e09`.
  The owner authorised four lows to be fixed at landing, with no re-gate. The
  gate section above is unchanged.
  - Gate 1 low, `touchedTools` docblock overclaim — _fixed at landing_. The
    sentence "so the two cannot disagree about what counts as documentation" is
    gone; the docblock now says only the suffix test is shared with `ci.yml`,
    and that a `.md` under `packages/` or `scripts/` still plans a suite through
    `sharedConfigTouched` and `scriptsTouched`.
  - Gate 1 low, unreachable shas in this Log — _fixed at landing_. The runs
    above pin `036e7ac6`, `68b4cd25` and `7dcc625f`, which the amend rewrote and
    which resolve from no branch. The surviving equivalents are `a0c9d9f6`,
    `90c45ca3` and `fd7f25bd`. The markdown-only run is reproduced from the
    surviving code commit with `node scripts/preflight.mjs --base a0c9d9f6
    --title "fix(repo): a tool's markdown does not plan its suite (repo-101)"`;
    its diff is this ticket file alone (`git diff --name-only a0c9d9f6...HEAD`)
    and the pasted output above is its result. These shas also stop resolving
    once the squash merge deletes the branch, so the pasted outputs are the
    record, not the commands.
  - Gate 1 low, stale wording — _fixed at landing_ for the file header of
    `scripts/preflight.mjs` (check 1 now says a markdown path does not count).
    Not changed: the same wording in
    `.claude/skills/orchestrate-tickets/roles/builder.md`, a role page that no
    one in this batch may edit. A builder who believes it loses nothing: preflight runs fewer suites, never more.
  - Open decision, `.md` under `packages/` and `scripts/` — owner's answer on
    2026-10-12: "Leave it" (option A, the recommended one). `sharedConfigTouched`
    and `scriptsTouched` stay as they are, so such a file still plans the full
    suite or `repo` + `core`. No `.md` file is tracked under either directory
    today, so the rule has no live call site. Extending the skip is the
    alternative, two lines and two tests, if one is ever added.
  - Gate 1, not graded, `test (ubuntu-latest)` red at `Run npm ci` on the first
    run of `983a3e09`: on the re-run `gh pr checks 436` shows every check
    passing, `test (ubuntu-latest)` at 12m27s and `test (windows-latest,
    informational)` at 12m49s.
  - Gate 1 low, `checkTitle` changes under `--no-renames` with no test — not
    in the owner's four authorised fixes, so left as the gate recorded it.
