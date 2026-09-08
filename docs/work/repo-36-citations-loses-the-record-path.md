---
id: repo-36
tool: repo
title: `citations.mjs --rev` stops reporting drift when git and Node spell the record's path differently
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-36 — The citations checker loses the record's own path

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
- Two corrections repo-36 makes to repo-31's account, both verified against actual git history rather than accepted on the ticket's word: the failing fixture's record sits at the repo root (`drift.md`, no subdirectory — `scripts/test/citations.test.ts:1279`), so backslash normalisation was never the actual fix; and the defective `path.relative(repo, path.resolve(file))` expression predates repo-25 (`git show 4bc3e66^:scripts/citations.mjs` line 661, display-only), with repo-25's merge (`4bc3e66`) hoisting it into a load-bearing second use rather than introducing it.
- NFR: security n/a (internal tooling, no user-influenced URL) · performance n/a (two extra short-lived `git` subprocess calls per invocation) · reliability ✓ (both the outer `locateRecord` try/catch and `sameDirectory`'s own try/catch fail closed to the pre-fix `..`-path rather than throwing or silently misresolving) · maintainability ✓ — the round-two docblock correction is itself the maintainability story: a wrong comment was caught and fixed rather than left to mislead the next reader, and the file now says explicitly when its own defensive branch should be deleted.
- Invariants checked (no shell — argument arrays only, `shell: false` implied and never overridden; no `console.`; `node:` protocol throughout; no `any`; nothing needing `import type`) — clean on both files in the diff.

**Builder's note on one coordinate, appended rather than folded silently into the record above.** The reviewer's record as sent cited `scripts/test/citations.test.ts:1278` for the fixture's root-level record. Line 1278 at `ab5e6fa` is **blank**; the line carrying the claim is 1279 — `const record = path.join(dir, "drift.md");`. Changed to 1279 above, on the orchestrator's instruction to re-resolve every `file:line` before committing, and disclosed here rather than passed off as verbatim. The reviewer was told; the claim itself is unaffected and holds.

**Every coordinate in the subsection above is pinned to `ab5e6fa` and most no longer resolve at the branch tip.** The round-two fix edited `scripts/test/citations.test.ts` in the middle, so `:1362`, `:1387`, `:1440`, `:1453` and `:1465` now land on a docblock asterisk, a comment, prose, another comment and a different test's name; `:1279`, `:1344` and `:1351` sit above the edit and still hold. Read that subsection with `--rev ab5e6fa`, which is what the flag is for. **The checker cannot tell you this**: `citations.mjs` over this file reports `0 moved, 0 unresolvable, exit 0` both against the tip and against `ab5e6fa` — the same clean answer for a set of coordinates that is right in one tree and wrong in the other — because an unanchored citation is checked for existence and nothing else.

That miss is worth more than the one character it cost, because it happened **in a gate record for the citation checker, and the checker cleared it**. `node scripts/citations.mjs` over this file reports `0 verified, 0 moved, 10 unanchored, 0 unresolvable, 2 unchecked — of 12 references` and **exit 0**, printing an empty preview line under `scripts/test/citations.test.ts:1278` without objecting to it. With `--require-anchors` the same file is exit 4 on all 10. Nothing here is a defect in the fix under review — it is repo-18's and repo-29's thesis reproducing itself on this very branch: a citation with no anchor text is a coordinate nobody checked, and only a human re-resolution catches it. The record is left unanchored because it is the reviewer's text and the gating run is the unflagged one, but the next reader should read those ten as unverified coordinates, not as checked ones.

### Round three — `ab5e6fa...1a774db`

**Gate: PASS** — 2026-09-07 · `ab5e6fa...1a774db` · defect hunt run directly by the reviewer, third round, following the `windows-latest` CI failure found after the `ab5e6fa` PASS

This round has no new `Done when` line of its own — it repairs a defect the round-two fix introduced in the test proving Done when 4, found by CI rather than by review. Re-affirming the two lines this delta touches:

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4. A record outside the repository being checked still resolves the way it did before, and a test says so | `scripts/citations.mjs:1237-1254` (`locateRecord`, unchanged this round — the defect was in the assertion, not the code) + `scripts/test/citations.test.ts:1372-1393` (`expect(locateRecord(REPO, outside)).toBe(path.relative(REPO, outside))` at `:1390`) ✓                                                                    |
| 5. `npm run check` and `npm test` pass                                                                    | verified at `1a774db`: `npm run check` exit 0; `npm test` → 133 files, 2269 passed, exit 0. **Measured directly on Windows for the first time this round, not reasoned**: `gh run view 34166587770` (the push CI run) — `test (windows-latest)` conclusion `success`, log shows `2267 passed \| 2 skipped (2269)`, zero failures |

- **the finding, and its correction** · `scripts/test/citations.test.ts:1372` (formerly `...keeps its ..-path...`, now `...is not given an in-tree name`) — the assertion added in round two to prove Done when 4, `.startsWith("..")`, was itself a POSIX path assumption: on `windows-latest`, where the checkout (`D:\a\tools\tools`) and `os.tmpdir()` (`C:\Users\RUNNER~1\…`) sit on different drive roots, `path.relative` has no `..`-form to return and gives the target absolute instead. Measured against the actual failing run, not reasoned: `gh run view 34165962251 --log` shows exactly one failure, at `scripts/test/citations.test.ts:1368:56`, `AssertionError: expected false to be true`, with the line above it (pinning `locateRecord`'s output to `path.relative`'s) passing — proving the production code was never wrong, only the test's second assertion. Builder's fix: deleted the platform-shaped assertion rather than replacing it with another claim about the same output's shape (tried `path.resolve(REPO, located) === outside` first; it couldn't fail on its own, since the surviving line already pins the value), leaving one assertion whose falsifiability I reproduced directly (`AssertionError: expected 'record.md' to be '../../../../../tmp/citations-outside-…'` when the fallback is made to borrow an in-tree name). Added `scripts/test/citations.test.ts:1418-1426`, a `path.win32`-driven reproduction of the actual CI failure using the real run's own constants (`D:\a\tools\tools`, `C:\Users\RUNNER~1\…`), honestly scoped in its own docblock as not exercising `locateRecord` itself and not catching a regression of the deleted assertion — a documented trade I agree with rather than a gap I'm carrying as a finding.
- **what this round upgrades from reasoned to measured, and what it doesn't** · Two things argued in round one are now observed on a real Windows host, twice: that the fix itself works (`--rev` regression test green on `windows-latest` at both `795dd1c` and `1a774db`), and that the round-two assertion was wrong (red at `795dd1c`, confirmed by the actual CI log, not inferred). **`sameDirectory`'s `fs.realpathSync.native` vs. plain `realpathSync` claim remains unmeasured** — nothing in this round's CI run exercises that branch (still unreached in production, its own symlink test still `skipIf(win32)`), so that caveat from the `ab5e6fa` gate stands exactly as recorded there.
- **dropped** · none.
- **findings** · defect hunt returned 1 (the CI-discovered POSIX assumption in the round-two test); 1 carried, resolved by the builder in this round (`1a774db`), 0 dropped.
- Citation hygiene, per the orchestrator's note on `moved` (`EXIT.moved = 2`, distinct from `unresolvable = 1`, `scripts/citations.mjs:662-667`): re-ran `node scripts/citations.mjs docs/work/repo-36-citations-loses-the-record-path.md` at the current tip — `0 moved, 0 unresolvable, exit 0`. Also ran it with `--rev ab5e6fa` per the builder's note on the prior subsection's coordinates: identical `0 moved, 0 unresolvable, exit 0`, confirming the checker cannot distinguish those now-stale coordinates from correct ones without anchor text — spot-checked five of them by hand and they do land on the wrong content, as the builder's note says.
- NFR: security n/a · performance n/a · reliability ✓ (the deleted assertion's failure mode was silent-until-CI, not silent-in-production — `locateRecord`'s actual behavior was never wrong) · maintainability ✓ — this round's own thesis is a maintainability lesson stated plainly in the test's docblock: an assertion added to prove a cross-platform fix carried the same class of assumption the fix removed, and the repair explains why the "obvious" replacement would have been a tautology rather than just swapping it in.
- Invariants checked (no shell — argument arrays only; no `console.`; `node:` protocol; no `any`; nothing needing `import type`) — clean; no changes to `scripts/citations.mjs` this round, only `scripts/test/citations.test.ts`.

**Builder's note on this subsection.** One coordinate re-resolved before committing: the record as sent cited `scripts/test/citations.test.ts:1416-1426` for the `path.win32` test, which was right at `1a774db` and drifted when `e3c17f8` added two lines to that test's docblock — `1416` is now the docblock's last line and the test opens at `1418`. Changed to `1418-1426` above. Everything else in this subsection was checked line by line against `e3c17f8` and holds, including both `scripts/citations.mjs` ranges.

### Round four — `1a774db...e3c17f8`

**Gate: PASS** — 2026-09-07 · `1a774db...e3c17f8` · defect hunt run directly by the reviewer, fourth round, correcting a relayed "flaky" inference about the round-three fix

No new `Done when` line — this round corrects the round-three fix's own docblock and test fixture (an invented same-drive pair, replaced with the two real pairs from actual CI logs) after a claim that the Windows workspace drive varies between runs was checked and found false.

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4. A record outside the repository being checked still resolves the way it did before, and a test says so | `scripts/citations.mjs:1307` "export function locateRecord(repo, file) {" (unchanged since `ab5e6fa`) + `scripts/test/citations.test.ts:1403` "expect(locateRecord(REPO, outside)).toBe(path.relative(REPO, outside));" ✓                                                                         |
| 5. `npm run check` and `npm test` pass                                                                    | verified at `e3c17f8`: `npm run check` exit 0; `npm test` → 133 files, 2269 passed, exit 0. **Confirmed on the actual `windows-latest` runner**, not reasoned: `gh run view 34166832893` — all jobs `success`, `test (windows-latest)` log shows `2267 passed \| 2 skipped (2269)`, zero failures |

- **the relayed claim, and why it doesn't stand** · a claim reached the builder that the Windows runner's workspace drive varies between runs, making the round-three deletion's replacement (`.startsWith("..")` being platform-wrong) a matter of flakiness rather than a deterministic fact about which two paths get subtracted. I checked the two cited runs myself rather than accept the correction on trust: `gh run view 34165962251 --job 101876958988 --log` and `gh run view 34166349722 --job 101878052522 --log` both show `Working directory is 'D:\a\tools\tools'`. The drive is stable in both; what differs is that the `--rev` fixture's operands are both under `C:\Users\…\Temp` (cwd set to the temp dir — `scripts/test/citations.test.ts`'s `at` helper), while the outside-the-repo test is the only one that crosses `D:` to `C:`. The correction is right, and I verified it independently rather than transcribing it.
- **what changed, and why it's a strict improvement** · `scripts/test/citations.test.ts:1431` "across drive roots the fallback is absolute" — the same-drive half of this test previously used an invented pair (`D:\a\_temp\…`); it now uses the two real pairs pulled from the actual failing runs' own log strings (`scripts/test/citations.test.ts:1436`, `tempRepo = "C:\\Users\\RUNNER~1\\…\\citations-rev-uh5dmk"`, and the `runneradmin` long-name counterpart), asserting `scripts/test/citations.test.ts:1451` "expect(sameDrive.startsWith" (temp-vs-temp, no `..`) and `scripts/test/citations.test.ts:1457` "expect(acrossShortName.startsWith" (short-name-vs-long-name, `..`-path) alongside the already-present cross-drive assertion at `scripts/test/citations.test.ts:1437` "expect(located.startsWith". This is a strictly better test than what it replaced: fewer invented constants, three real observed pairs instead of one real and one invented.
- **dropped** · none.
- **findings** · defect hunt returned 0 this round (the round was itself a correction, not a new finding); 0 carried, 0 dropped.
- Citation hygiene: `node scripts/citations.mjs docs/work/repo-36-citations-loses-the-record-path.md` at `e3c17f8` gives `0 moved, 0 unresolvable, exit 0`. Anchoring the citations above this time, per your request — `EXIT.moved` at `scripts/citations.mjs:692` "export const EXIT = /** @type {const} */ ({" is cited here too for the same reason.
- NFR: security n/a · performance n/a · reliability ✓ (no behavior change in `locateRecord`; only the round-three test's own fixture improved) · maintainability ✓ — the Log entry states the correction as a correction rather than silently rewriting round three's account, matching the standard the earlier "builder's note" paragraphs set for the coordinate fix.
- Invariants: no changes to `scripts/citations.mjs` this round; `scripts/test/citations.test.ts` changes are argument-array-free literal strings and `path.win32` calls, no shell, no `console.`, `node:` protocol unaffected, no `any`, nothing needing `import type` — clean.

**Builder's note on this subsection, and on the four together.** Round four is the first record on this ticket whose citations carry anchor text, and **anchoring immediately caught a defect that three rounds of unanchored citations had hidden**. As sent, four of its anchors escaped their inner quotes — `"test(\"across drive roots…\", () => {"`. The parser takes straight quotes only, so each anchor terminated at the escape and became a fragment like `test(\`, which appears nowhere. The run was `3 verified, 4 moved — exit 2`, this file's first non-zero exit and its first `moved` of any kind.

Re-anchored on quote-free fragments of the same lines (`across drive roots the fallback is absolute`, `expect(sameDrive.startsWith`, `expect(acrossShortName.startsWith`, `expect(located.startsWith`); the coordinates themselves were right and are unchanged. The file now reports **`7 verified, 0 moved, 0 unresolvable — exit 0`**, and all seven are in this subsection: the 29 `unanchored` are the three earlier rounds', still checked for nothing but existence.

That is the argument for anchors, made twice over on one page. Unanchored, an off-by-one onto a blank line and five coordinates that drifted onto unrelated content both passed at exit 0. Anchored, a malformed anchor failed loudly within one run. Every coordinate in this subsection was also re-resolved by hand against `e3c17f8`, and all hold.

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

- **2026-09-07, a second Windows run, and a relayed inference this does not
  support.** A second run was offered as evidence that the runner's workspace
  drive varies between runs, making `.startsWith("..")` _flaky_ on Windows rather
  than wrong. **Checked, and it is not what happened.** The workspace is `D:` in
  both:

  | Run           | Branch                       | Windows leg                      | Received path                         |
  | ------------- | ---------------------------- | -------------------------------- | ------------------------------------- |
  | `34165962251` | this one, at `795dd1c`       | fails on the new assertion       | absolute, `C:\…`                      |
  | `34166349722` | `07ca0a73`, without this fix | fails on the original regression | relative, `..\..\..\..\..\RUNNER~1\…` |

  `gh run view --job … --log` on each gives `D:\a\tools\tools` as the workspace
  in **both**. Nothing varied. What differs is **which two paths each failing
  test subtracts**:

  - the `--rev` fixture spawns the CLI with `cwd: dir`, the temp directory
    (`scripts/test/citations.test.ts`, the `at` helper), so both its operands are
    under `C:\Users\…\Temp` — same drive, `..`-path expressible, and the five
    `..` reach `RUNNER~1` because the only difference between the operands is the
    short name against the long one. That is the original defect, unchanged.
  - the outside-the-repo test compares `REPO` — the checkout, on `D:` — with
    `os.tmpdir()`, on `C:`. That is the only pair here that crosses drives.

  So `.startsWith("..")` was **deterministically wrong** on this runner image for
  the pair that test compares, not intermittently wrong. Both drives are stable;
  the assumption survived because the _other_ tests never subtract a pair that
  crosses them. The deletion is right either way, and the reason recorded above —
  that the assertion was implied by the line before it and bought no coverage —
  is unaffected by any of this.

  The `path.win32` test now pins both pairs rather than an invented same-drive
  one, and its docblock names both run ids. The `C:` side is still a deduction
  from the assertion pair and the `RUNNER~1` strings rather than a reading of
  `TEMP`, and stays labelled that way.

- **2026-09-08** — **Renumbered `repo-33` → `repo-36`, on the owner's decision.**
  A peer session, running while this batch was open, filed a different
  `repo-33` — `docs/work/repo-33-adr-004-rename-and-the-project-name.md`, "ADR
  004's rename is unfiled…" — and merged it to `main` in **#192**, so `origin/main`
  now carries a `repo-33` that is not this one. Two tickets claiming one id is
  not cosmetic: with both present `node scripts/status.mjs --json` **exits 1**,
  and that exit code is the board gate CI runs, so this branch could not have
  merged as it stood. Theirs is merged and belongs to another session; all of
  this batch's branches are unmerged and all its own, so the renumber landed
  here. `node scripts/next-id.mjs repo` was re-run and returned `next free:
repo-36` — `repo-34` is held by #187 and `repo-35` was taken minutes earlier by
  `records/repo-history-tools-09`.

  **`next-id.mjs` was not wrong.** The 2026-09-07 entry above records it
  reporting `next free: repo-33` at filing time, and that was correct _then_: the
  script reads ids out of open pull requests and merged history, and the peer's
  ticket was in neither yet — it had not been pushed, let alone opened. The
  window between filing an id and opening the pull request that publishes it is
  real, it is invisible to every session in it, and nothing in the tooling closes
  it. Nothing was misused; two sessions raced and the loser is renamed. Run _before_ the renumber,
  `node scripts/next-id.mjs repo` did surface the clash itself, unprompted —
  `clash: repo-33 is claimed by PR#186, merged` — so the script detects a
  collision once both sides are visible to it, even though it cannot prevent one.
  That line is **gone at this tip**, which is the check that the renumber worked:
  the same command now lists `PR#186 repo-36`, no `repo-33` clash, and
  `next free: repo-37`.

  **Past commit subjects on this branch still say `(repo-33)`** and are left
  alone — they are history across four open pull requests and could only be
  changed by a force-push to all four. A reader seeing `fix(repo): … (repo-33)`
  in this branch's log is looking at a commit made before the renumber, not at a
  reference to the peer's ticket. The pull request **title** was updated, since
  that is the line that reaches the changelog.

  **Observed but deliberately not fixed here**, as it is separate work and not
  this branch's: `scripts/status.mjs`'s duplicate-id error prints
  `"undefined" is used by more than one ticket` rather than naming the id that
  clashed. The message is what a reader gets when the board gate fails, and it
  names nothing actionable — the id had to be recovered by hand. Cosmetic, real,
  and worth its own ticket.

  Gate records above quote the checker being run against this file by its old
  `repo-33-…` path. Those paths were repointed to the new filename rather than
  left dangling: the file is the same file and the runs did happen, but a command
  naming a path that no longer exists is exactly the stale coordinate this ticket
  is about.
