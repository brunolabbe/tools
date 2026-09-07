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
