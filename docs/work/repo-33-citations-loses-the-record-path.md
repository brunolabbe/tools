---
id: repo-33
tool: repo
title: `citations.mjs --rev` stops reporting drift when git and Node spell the record's path differently
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-33 — The citations checker loses the record's own path

## Why

`.github/workflows/ci.yml`'s unit matrix has been red on `windows-latest` since
2026-09-07T11:39 UTC, on one assertion, on every completed run — and nothing was
filed for it. [repo-31](./repo-31-the-windows-leg-is-almost-all-red.md)
measurement 1 counted eight consecutive failures and found all eight identical;
its `Done when` 2 requires the fix to be filed separately, which is this ticket.
repo-31 is not edited by this one and does not depend on it.

The failure, verbatim from `gh run view 34143225204 --log-failed` (sha `277a182`,
the last run on `main` that executed the matrix at all):

```
FAIL  repo  scripts/test/citations.test.ts > --rev names which record it read, and says when that record cited something else
AssertionError: expected '2 references in ..\..\..\..\..\RUNNER…' to match /This record exists at that rev and ci…/
+ Received:
"2 references in ..\\..\\..\\..\\..\\RUNNER~1\\AppData\\Local\\Temp\\citations-rev-ZPZHiR\\drift.md, read from the working tree and resolved against 15b49cc…
```

1 failed, 2,239 passed. It is the whole of the Windows leg's red.

### The mechanism, established rather than assumed

`main()` computed the record's repo-relative path by subtracting one string from
another:

`` `scripts/citations.mjs` `` — `path.relative(repo, path.resolve(file))`, where
`repo` came from `git rev-parse --show-toplevel`.

That is arithmetic between **a path git resolved** and **a path Node resolved**,
and it is only sound while the filesystem admits one spelling of each. The
Windows runner admits two: `os.tmpdir()` returns the 8.3 short name
`C:\Users\RUNNER~1\AppData\Local\Temp` while git resolves the long
`C:/Users/runneradmin/…`. The subtraction therefore walks up five levels and back
down a different branch — which is exactly the five `..` in the received string —
so the result **escapes the repository** instead of landing inside it.

The path is not merely printed. It is fed to
`` `scripts/citations.mjs` `` — `makeReader(repo, rev)(relative)`, which runs
`git show <rev>:<path>`. Git has no entry called `../../../../../RUNNER~1/…`, the
reader returns `null`, `recordDrift` is never called, and the drift paragraph is
never written. **The failure is a missing paragraph, not an error** — which is
why it survived eight completed matrix runs with nobody noticing.

### Two corrections to repo-31, recorded because it asked for them

repo-31 measurement 2 offers the mechanism as a hypothesis and says so. Both
halves of it turned out to be imprecise:

1. **It is not primarily about backslashes.** The record in the failing fixture
   is `drift.md` **at the repository root**, so its correct repo-relative path
   contains no separator at all and no amount of backslash normalisation would
   have fixed it. The separator problem is real and is fixed here too, but it is
   not what made this test red.
2. **The printed preview is a symptom, not the gate.** repo-31 says "the printed
   preview never reaches the `This record exists…` branch". The branch is gated
   by `drift !== null`, which is gated by the `git show` read above. The wrong
   string in the header and the missing paragraph are two symptoms of one bad
   value.

Third, on provenance: repo-31 attributes the regression's arrival to repo-25 (PR
#168, merge `4bc3e66`), and that is right about **when the red started** and
imprecise about the cause. `git show 4bc3e66 -- scripts/citations.mjs` shows the
same `path.relative(repo, path.resolve(file))` expression already present before
that commit, inline in the header line. It was display-only then, so a wrong
string on Windows was cosmetic. repo-25 hoisted it into `relative` and gave it a
load-bearing second use — reading the record out of a commit — and added the test
that asserts the result. **The defective expression predates repo-25; repo-25 gave
it teeth.**

## Build

1. Replace the arithmetic in `scripts/citations.mjs`'s `main()` with a
   `locateRecord(repo, file)` that asks **git** where the record sits —
   `git rev-parse --show-toplevel --show-prefix`, run with the cwd set to the
   record's own directory. That closes the general case rather than the two
   observed spellings, and settles the separator question for free: git always
   answers in forward slashes, which is the only spelling `<rev>:<path>` accepts.
2. **Keep `repo` derived from the process's cwd.** A record does not have to live
   in the repository being checked, and most of this script's own CLI tests
   depend on that: they check fixture records under `os.tmpdir()` with the cwd set
   to this repo. Take git's prefix only when the record's directory belongs to
   the _same_ repository, and fall back to the old `..`-path otherwise —
   otherwise a record sitting in some other checkout resolves to a plausible path
   in the wrong tree, which is the precise failure this script exists to catch.
3. Compare the two roots through one canonicaliser rather than two.
   `fs.realpathSync.native` is the variant that expands a Windows short name;
   the plain one does not, which is how the fixture's own
   `fs.realpathSync(fs.mkdtempSync(…))` failed to prevent this.
4. Reproduce the defect on this platform before fixing it. A symlinked directory
   is the same divergence on POSIX that a short name is on Windows, and gives a
   test that can go red here.

Do not touch the CI matrix. Whether `windows-latest` stays is repo-31's decision
and is not this ticket's to implement.

## Done when

1. `scripts/citations.mjs` derives the record's repo-relative path from git
   rather than by subtracting a Node-resolved path from a git-resolved one, and a
   test proves the two can disagree.
2. A test reproduces the defect **on Linux** — red against the pre-fix
   expression, green after — so the regression is not guarded only by a runner
   nobody can debug.
3. The forward-slash shape of that path is asserted, since that is the half of
   the defect only a Windows runner can exercise.
4. A record outside the repository being checked still resolves the way it did
   before, and a test says so.
5. `npm run check` and `npm test` pass.

## Review

**Gate: PASS** — 2026-09-07 · `origin/main...ab5e6fa` · defect hunt run directly by the reviewer (no `code-review` dispatch available to a `ticket-reviewer` subagent), two rounds, medium depth

| Done when                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `locateRecord` derives the path from git rather than subtracting a Node-resolved path from a git-resolved one, and a test proves the two can disagree | `scripts/citations.mjs:1237-1261` (`locateRecord`) + `scripts/test/citations.test.ts:1453` (`expect(path.relative(toplevel, viaLink)).not.toBe("drift.md")`) ✓                                                                                                                                                               |
| 2. A test reproduces the defect on Linux, red against the pre-fix expression and green after                                                             | `scripts/test/citations.test.ts:1440-1465` — reproduced independently: reverting `scripts/citations.mjs:1261` to `path.relative(repo, path.resolve(file))` gives `1 failed \| 64 passed`; restored, `65 passed` (verified at `a1c2a83`; the line moved to 1261 at `ab5e6fa` but is textually unchanged, confirmed by diff) ✓ |
| 3. The forward-slash shape of the path is asserted                                                                                                       | `scripts/test/citations.test.ts:1344-1351` — asserts against literal forward-slash string constants, not `path.join`-built values, so it fails on Windows if backslashes return and cannot fail on Linux ✓                                                                                                                   |
| 4. A record outside the repository being checked still resolves the way it did before, and a test says so                                                | `scripts/test/citations.test.ts:1362-1370` ✓                                                                                                                                                                                                                                                                                 |
| 5. `npm run check` and `npm test` pass                                                                                                                   | verified at `ab5e6fa`: `npm run check` exit 0 (pre-existing `no-await-in-loop` warnings outside this diff, unrelated); `npm test` → 133 files, 2268 passed, exit 0 (origin/main baseline 62 tests in this file; this branch adds 5 net, matching the two-commit diff)                                                        |

- **low, found and resolved in this round** · `scripts/citations.mjs:1191-1194` (`sameDirectory`) — the `fs.realpathSync.native` comparison was never exercised by the first round's tests (the "outside the repo" test trips `locateRecord`'s outer try/catch before reaching `sameDirectory`; the symlink test called it but with operands already byte-identical, since both are git's own `--show-toplevel` answer for one cwd string). Reproduced directly (`git -C <realdir>` and `git -C <symlink-to-realdir>` both return the canonical path). The docblock at that point additionally misattributed the mechanism, describing one operand as `path.resolve`'s output rather than git's — a factually wrong comment, not just an untested branch. Builder's response: exported `sameDirectory` and added `scripts/test/citations.test.ts:1387-1416` testing it directly (false for two different directories, false on `ENOENT`, true through a symlink), corrected the docblock to state plainly that both operands are git's own output and the branch is unreached in production, and recorded five failed attempts (including a `PWD`-inheritance asymmetry that was a genuine candidate) to construct a reachable divergence. I independently reproduced the branch's own regression test (`return false` → `1 failed | 66 passed`). Two caveats the builder asked to be carried rather than overstated, and I agree with both: the branch is still unreached by `main()` itself — the new test proves the predicate's contract, not a path production takes, so this specific mechanism is **verified** at the predicate level but not exercised end-to-end; and the test does not establish that `.native` (vs. plain `realpathSync`) is actually required, since a POSIX symlink resolves under either — that half of the docblock's claim (the Windows 8.3 case) remains reasoned, not measured, same as several other claims already disclosed in the Log.
- **dropped** · none.
- **findings** · defect hunt returned 1 (round one); 1 carried, resolved by the builder in round two (`ab5e6fa`), 0 dropped.
- Two corrections repo-33 makes to repo-31's account, both verified against actual git history rather than accepted on the ticket's word: the failing fixture's record sits at the repo root (`drift.md`, no subdirectory — `scripts/test/citations.test.ts:1279`), so backslash normalisation was never the actual fix; and the defective `path.relative(repo, path.resolve(file))` expression predates repo-25 (`git show 4bc3e66^:scripts/citations.mjs` line 661, display-only), with repo-25's merge (`4bc3e66`) hoisting it into a load-bearing second use rather than introducing it.
- NFR: security n/a (internal tooling, no user-influenced URL) · performance n/a (two extra short-lived `git` subprocess calls per invocation) · reliability ✓ (both the outer `locateRecord` try/catch and `sameDirectory`'s own try/catch fail closed to the pre-fix `..`-path rather than throwing or silently misresolving) · maintainability ✓ — the round-two docblock correction is itself the maintainability story: a wrong comment was caught and fixed rather than left to mislead the next reader, and the file now says explicitly when its own defensive branch should be deleted.
- Invariants checked (no shell — argument arrays only, `shell: false` implied and never overridden; no `console.`; `node:` protocol throughout; no `any`; nothing needing `import type`) — clean on both files in the diff.

**Builder's note on one coordinate, appended rather than folded silently into the record above.** The reviewer's record as sent cited `scripts/test/citations.test.ts:1278` for the fixture's root-level record. Line 1278 at `ab5e6fa` is **blank**; the line carrying the claim is 1279 — `const record = path.join(dir, "drift.md");`. Changed to 1279 above, on the orchestrator's instruction to re-resolve every `file:line` before committing, and disclosed here rather than passed off as verbatim. The reviewer was told; the claim itself is unaffected and holds.

**Every coordinate in the subsection above is pinned to `ab5e6fa` and most no longer resolve at the branch tip.** The round-two fix edited `scripts/test/citations.test.ts` in the middle, so `:1362`, `:1387`, `:1440`, `:1453` and `:1465` now land on a docblock asterisk, a comment, prose, another comment and a different test's name; `:1279`, `:1344` and `:1351` sit above the edit and still hold. Read that subsection with `--rev ab5e6fa`, which is what the flag is for. **The checker cannot tell you this**: `citations.mjs` over this file reports `0 moved, 0 unresolvable, exit 0` both against the tip and against `ab5e6fa` — the same clean answer for a set of coordinates that is right in one tree and wrong in the other — because an unanchored citation is checked for existence and nothing else.

That miss is worth more than the one character it cost, because it happened **in a gate record for the citation checker, and the checker cleared it**. `node scripts/citations.mjs` over this file reports `0 verified, 0 moved, 10 unanchored, 0 unresolvable, 2 unchecked — of 12 references` and **exit 0**, printing an empty preview line under `scripts/test/citations.test.ts:1278` without objecting to it. With `--require-anchors` the same file is exit 4 on all 10. Nothing here is a defect in the fix under review — it is repo-18's and repo-29's thesis reproducing itself on this very branch: a citation with no anchor text is a coordinate nobody checked, and only a human re-resolution catches it. The record is left unanchored because it is the reviewer's text and the gating run is the unflagged one, but the next reader should read those ten as unverified coordinates, not as checked ones.

## Log

- **2026-09-07** — Filed and built in one branch,
  `repo-33-citations-windows-paths`, off `origin/main` at `4fad5f8`. Id re-checked
  with `node scripts/next-id.mjs repo` on the branch (`next free: repo-33`) and
  against every `repo-3x` mentioned in either ticket root's Logs (tops out at
  `repo-32`).

  **How the defect was made to fail here**, since the report is worth more than
  the diff. `path.resolve` keeps a symlinked directory in the path where
  `git rev-parse --show-toplevel` resolves it away, which is the same divergence
  the Windows runner produces with an 8.3 short name. Driving the CLI at a
  fixture record through a symlink, before the fix:

  ```
  === real path ===       first line: 2 references in drift.md, …   drift reported: true
  === symlinked path ===  first line: 2 references in ../link/drift.md, …   drift reported: false
  ```

  After the fix both lines read `2 references in drift.md` and both report drift.
  `../link/drift.md` is the Linux-shaped instance of CI's
  `..\..\..\..\..\RUNNER~1\…\drift.md`.

  The same reproduction is committed as a test. With the pre-fix expression
  restored in `main()` and everything else unchanged, the suite gave
  `1 failed | 64 passed`, on
  `AssertionError: expected '2 references in ../citations-rev-weA2…' to match /^2 references in drift\.md, /`;
  with the fix, `65 passed`.

  **What the brief for this work got wrong** — the first fix derived `repo` from
  the record's directory too, on the reasoning that one git call for both halves
  cannot describe two repositories. It is wrong: 13 of this file's own tests
  check a fixture record under `os.tmpdir()` against this repo, with the cwd
  carrying the repository, and they went red with
  `fatal: not a git repository`. That constraint is now in the docblock and has a
  test of its own, because it is exactly the kind of thing a later "just ask git"
  simplification deletes.

  **What is not measured, and is reasoned instead.** The Windows leg cannot be
  run from here, so that the original `--rev` test now passes on
  `windows-latest` is an argument, not a reading: in that fixture the cwd and the
  record's directory are the same directory, so both `rev-parse` calls return the
  same string, `sameDirectory` short-circuits on equality, `--show-prefix` is
  empty at the root, and the path becomes `drift.md`. Likewise, that
  git-for-windows rejects `<rev>:docs\work\x.md` is stated in the docblock as the
  reason forward slashes matter and was **not** run — the fix removes the
  question rather than answering it, since git's own answer is always forward
  slashes. The symlink test is skipped on Windows on purpose: producing a
  diverging spelling there means short names or case, not links, and whether git
  resolves a junction as it resolves a symlink is not measurable from Linux.

  The fixture's `fs.realpathSync(fs.mkdtempSync(…))` was **deliberately left
  alone**. `fs.realpathSync.native` there would expand the short name and make
  the Windows leg green without fixing anything; as it stands that test is the
  only thing in the repo exercising this mechanism on a real Windows host.

  `scripts/citations.mjs` was the only `path.relative` in `scripts/` —
  `grep -rn "path.relative" scripts/` returns one line, now inside
  `locateRecord` as the documented fallback.

- **2026-09-07, after the gate** — the reviewer's one finding was that
  `sameDirectory`'s `realpathSync.native` branch is not merely untested but
  looked unreachable, since both values it compares are git's own
  `--show-toplevel` answer for one directory and git normalises deterministically
  — so only the `a === b` line ever runs, under a docblock claiming the branch
  did real work. **The finding is right and the docblock was wrong**: it
  described one operand as coming from `path.resolve`, which is the defect
  `locateRecord` undoes, written into the wrong function. Corrected in place.

  I tried to disprove the unreachability before accepting it and failed. Beyond
  the reviewer's `-C`-against-a-symlink check, `git rev-parse --show-toplevel`
  was run in five configurations — cwd at the real directory and at a symlink to
  it, each with `PWD` unset, `PWD` set to the symlinked spelling, and from a
  subdirectory. All five returned the resolved path; **git ignores `PWD`
  entirely**, so the one asymmetry in this file's own code (`main()`'s call
  inherits the parent's environment and cwd, `locateRecord`'s inherits the
  environment but overrides the cwd) cannot produce a divergence either.

  Kept rather than deleted, and the reasoning is recorded in the docblock so the
  next reader can act on it: the equality rests on git-for-windows' `getcwd`
  normalising a short name identically across two invocations, which is
  precisely the class of claim this ticket got burned by and the one link here
  nobody has run. It cannot produce a false positive — two different directories
  have two different real paths — and if the assumption is wrong it is the
  difference between a correct path and a silent return to the bug. The docblock
  says to delete it, and its test, the day someone confirms that normalisation on
  a Windows host.

  Made reachable by contract instead of left unexamined: `sameDirectory` is now
  exported and tested directly — false for two different directories, false for
  paths that do not exist (the `catch`), and true through a symlink, which is
  the branch. Verified it can fail: replacing the branch body with `return false`
  gave `1 failed | 66 passed` on
  `AssertionError: expected false to be true`; restored, `67 passed`. **Still
  unreached in production**, and the test does not change that — it tests the
  predicate's contract, not a path `main()` takes. One thing the test does _not_
  prove, since a POSIX symlink is resolved by either variant: that `.native`
  rather than plain `realpathSync` is required. That claim is Windows-only and
  remains unmeasured.

- **2026-09-07, the Windows leg observed — superseding two claims above.** CI ran
  the matrix on PR #186 at `795dd1c` (run `34165962251`), which is the first time
  anything in this ticket was measured on a Windows host rather than argued for.
  Both results matter and they point opposite ways.

  **The fix works.** `test (windows-latest)` shows
  `✓ --rev names which record it read, and says when that record cited something else` —
  the assertion that was red on `main` across eleven runs. The entry above says
  that outcome "is an argument, not a reading". **It is now a reading**, and the
  argument it rested on was correct. `test (ubuntu-latest)` and `check` are green.

  **And the branch broke Windows in a new place, in the test asserting the fix.**
  The run's one failure is
  `a record outside the repo keeps its ..-path rather than borrowing another tree's`,
  at `scripts/test/citations.test.ts:1368:56`,
  `AssertionError: expected false to be true` — `1 failed | 2265 passed | 2 skipped`,
  the two skips being this branch's `skipIf(win32)` pair, as designed.

  The diagnosis is the assertion pair, because line 1367 passed and 1368 failed:
  `locateRecord` returned exactly `path.relative`'s output — **the production
  code is correct and was not changed** — and that output did not begin with
  `..`. On Windows the only way that happens is two different drive roots, where
  no relative path is expressible and `path.relative` returns the target
  absolute. The runner's checkout is `D:\a\tools\tools`, read out of that run's
  own log; `os.tmpdir()` on that image resolves under `C:\Users\RUNNER~1\…\Temp`.

  **The finding is the irony, and it is the most useful sentence here.**
  `.startsWith("..")` is a POSIX-shaped assumption about what a path outside a
  tree looks like — the exact class of defect this ticket exists to fix,
  introduced by the test asserting the fix, and green on Linux the whole time.

  Fixed in the assertion, not the code. The second assertion is **deleted rather
  than repaired**, which was not the first instinct: the replacement was going to
  be `path.resolve(REPO, located) === outside`, until making it fail showed it
  could not fail on its own. Given the line above it pins the result to
  `path.relative`'s output, _every_ further claim about that output's shape is a
  claim about `path.relative` rather than about this code — so the old assertion
  contributed no coverage and one platform assumption, and so would its
  replacement. The surviving line still catches the bug the test is named for,
  measured by making `locateRecord` borrow an in-tree name:
  `AssertionError: expected 'record.md' to be '../../../../../tmp/citations-outside-…'`.

  The cross-drive case is now reproduced **on Linux** rather than left as
  reasoning, in a second test driven by `path.win32` — Node's Windows path
  algebra on any platform — with the runner's real constants:
  `path.win32.relative("D:\\a\\tools\\tools", "C:\\Users\\RUNNER~1\\…\\record.md")`
  returns the target absolute, `startsWith("..")` is `false`, `isAbsolute` is
  `true`, and it still round-trips through `path.win32.resolve`. The same call on
  one drive _does_ return a `..`-path, which is why the old assumption held
  everywhere anyone had looked. That test pins a platform assumption; it is
  explicitly **not** a test of `locateRecord`, whose ambient `path` cannot be
  driven from here, and it would not catch someone re-adding `.startsWith("..")`.
  Its docblock says so, and says a reviewer would be within rights to strike it.
