---
id: repo-94
tool: repo
title: review-record --land reports a failed cleanup, and a pushed landing, as something they are not
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-94 — `--land` reports a failed cleanup, and a pushed landing, as something they are not

## Why

Two defects in `scripts/review-record.mjs --land`, both of the same kind: the
failure report says something false about the landing's result. Both were
reproduced before this was written.

### 1. The scratch clone's cleanup replaces the validation's result

`land()` clones the repository into a scratch directory with
`git clone -q --no-hardlinks`, which **copies the shared repository's loose
objects**. Git estimates its auto-gc threshold from `ls .git/objects/17 | wc -l`
× 256; on the shared checkout that was 28 × 256 = 7168, above the default
`gc.auto` of 6700. So the first `git commit` in the clone spawns a detached
`gc --auto` that writes into `.git` (it creates `gc.pid`, `gc.log.lock`, then
`gc.log`, and `info/refs` in the observed case) while the `finally` runs
`fs.rmSync(scratchDir, { recursive: true, force: true })`. When the two meet,
`rmSync` throws `ENOTEMPTY`, and **a throw from a `finally` replaces the
`return` it interrupts** — so the validation's own result, pass or fail, is
lost. Seen on dl-77's landing (tools-15, 2026-10-06):
`ENOTEMPTY: directory not empty, rmdir '/tmp/review-record-land-FdK4T6/.git'`,
exit 1, leaving only `.git/info/refs`. It is a race, so it is intermittent: lg-6
and dl-78 landed through it the same day.

**Reproduction** (`/tmp/.../repo-94/build/repro-gc.mjs`): a repo holding 16000
loose blobs (`objects/17` at 63 entries, estimate 16128 against 6700), a
`--no-hardlinks` clone, one empty commit, then `rmSync` at once — the same shape
as `land()`, repeated:

| Clone config                         | `rmSync` failures      |
| ------------------------------------ | ---------------------- |
| unchanged (control)                  | 1 of 60 (also 1 of 40) |
| `git config gc.auto 0` before commit | 0 of 60                |

The one control failure printed
`ENOTEMPTY: directory not empty, rmdir '/tmp/repro94-clone-seJ3Ku/.git'`. Watching
a clone after the commit confirms the cause: `.git` held `gc.pid` and
`gc.log.lock` 22 ms after `git commit` returned, and `gc.log` by 233 ms. Tools-15
measured the same control as `rm failed: ENOTEMPTY` and 3 of 3 `rm ok` with the
config set.

### 2. A preflight failure after the push prints the reset advice

`land()`'s `resetHint()` appends "The commit(s) already made for this landing are
not rolled back. Reset to the pre-landing state with: `git reset --hard <sha>`" to
the splice (real pass), push, verify **and preflight** failures. Preflight runs
after the push and after verify, when the landing is on origin and verified, so
the advice is wrong there: following it discards a good landing locally while
origin keeps it. Tools-79 saw this as exit 16 (the merge-tree probe against
sibling PRs) on dl-78 #371 and dl-79 #373.

**Reproduction:** the new test run against the unchanged source, with a
`runPreflight` that fails after a real push to a bare remote:

```
AssertionError: expected 'FAIL merge-tree: conflicts with PR #3…' not to match /git reset --hard/
+ Received:
"FAIL merge-tree: conflicts with PR #371

The commit(s) already made for this landing are not rolled back. Reset to the pre-landing state with:
  git reset --hard 9dde48a218b85d4eec88afb660f363e788519eb8"
```

The same test asserts `origin`'s branch equals the local `HEAD` first, so the
landing is shown to be pushed when the advice is printed. The existing test
`land() lands every commit and the push, then names "preflight" when it fails`
asserted exactly this advice and passed for the same reason.

### The owner's decision

On **2026-10-06** the owner decided to fix both now, in this one ticket. The
questions, with the options as they were put:

- **Defect 1.** Fix now as repo-94 (**chosen**, the orchestrator's
  recommendation) · leave it for the review session · prune the shared repo.
- **Defect 2.** Fold it into repo-94 (**chosen**, the orchestrator's
  recommendation) · file it separately as repo-95 · only log it.

## Build

1. In `land()`, set `gc.auto 0` in the scratch clone's config, beside the
   existing `user.email` / `user.name` calls.
2. Remove the scratch directory through an injectable `removeDir` option (default
   `fs.rmSync` with `recursive` and `force`), outside the `finally`. A failure to
   remove it becomes a passing step named `cleanup`, whose detail starts
   `WARNING` and names the leftover directory and the error, pushed **before**
   whatever step fails after it so `steps.at(-1)` still names the failed step. It
   never replaces the validation's result.
3. After a successful push, a preflight failure (a non-ok result or a throw)
   says the sections are landed and pushed to `origin/<branch>`, that verify
   passed, that only preflight's finding is left, and prints no reset command.
   Splice (real pass), push and verify failures keep `resetHint()`.
4. Update `land()`'s docblock for both, and the existing test that asserted the
   reset advice on a preflight failure.

## Done when

1. A test proves the scratch clone is created with `gc.auto=0` in its config.
2. A test proves that a cleanup failure after a passing validation leaves
   `--land`'s result as the validation's result, with the leftover path reported.
3. A test proves that a preflight failure after a successful push prints no
   `git reset --hard` advice, and says the landing is pushed.
4. Each new test fails with its fix reverted; the red and green outputs are in
   the Log.
5. `npm run check` and `npm test -- --project repo` pass.

## Log

- 2026-10-06 — Filed and built together, on the owner's decision recorded in
  Why. Both defects reproduced before any source change (tables and outputs in
  Why); no test depends on the shared repository's loose-object count.
- 2026-10-06 — Red and green, `npx vitest run scripts/test/review-record.test.ts
-t "repo-94"`. With all three fixes absent, the three new tests fail:
  `expected [ '' ] to deeply equal [ '0' ]` (the clone's `gc.auto` is unset),
  `expected [] to have a length of 1 but got +0` (no `removeDir` seam), and
  `expected 'FAIL merge-tree: conflicts with PR #3…' not to match /git reset
--hard/`. The cleanup test failing only for a missing seam proves little, so it
  was also run with the seam present and the warning replaced by a bare rethrow:
  `Error: ENOTEMPTY: directory not empty, rmdir '/tmp/review-record-land-IuVYJJ/.git'`
  thrown out of `land()`. With the fixes: `Tests 3 passed | 61 skipped (64)`;
  the whole file, `Tests 64 passed (64)`.
- 2026-10-06 — **Decision left open: should a verify failure after the push keep
  the reset advice?** It was left as it was. A verify failure means origin holds a
  record that is not the gate's text; the advice is not obviously wrong there, but
  a local reset leaves origin ahead and the tool never force-pushes, so it is
  incomplete. The options are in the builder's report to the orchestrator.
- 2026-10-06 — `.claude/skills/orchestrate-tickets/reference/records.md`,
  _Landing_: "a failure after the commits prints the reset command and rolls
  nothing back" is no longer true of a preflight failure. Not edited — rule pages
  change only in the owner's review session.
- 2026-10-06 — Fold-in considered. `scripts/test/review-record.test.ts` carries
  one other assertion of the old preflight advice, the one this change edits; no
  other piece was made free. `scripts/review-record.mjs`'s other `rmSync` sites
  (the `--verify` temp directories) do not clone a repository and are not
  exposed to this race, so they were not touched.
