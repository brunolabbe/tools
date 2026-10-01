---
id: repo-77
tool: repo
title: spawn-safety's explicit shell false check sees only spawn, not spawnSync or execFileSync
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-77 — spawn-safety's explicit `shell: false` check sees only `spawn(`

## Why

`packages/core/test/spawn-safety.test.ts`' test "every file that spawns says
`shell: false` explicitly" asks a file for a `shell: false` only when it calls
`spawn(` — its pattern is `\bspawn\s*\(`. A file calling `spawnSync`,
`execFile` or `execFileSync`, which take the same `shell` option, is never
asked. Found while measuring repo-75, which widened the scan to every source
file in the repository and left this half out on purpose.

**Measured on `repo-batch-defects-2026-09-27` at `1ed9e69`** (`1a8321c` plus
repo-73 and repo-74, neither of which adds a spawn), by a scratch script,
`/tmp/claude-1000/-workspaces-tools/204f0c5b-f296-4afb-a994-4ab00b701d2f/scratchpad/repo-73-76/r75-scan2.mjs`,
running the test's own comment stripper and checks over the 484 source files
`git ls-files --cached --others --exclude-standard` names, with the call
pattern widened to `\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(`: 27 files
import `node:child_process`, and **11 call one of the four without a
`shell: false` anywhere in the file**. The line numbers are every call in each:

- `scripts/citations-gate.mjs:395,411,489,794,800`
- `scripts/citations.mjs:845,861,895,2046,2064,2073`
- `scripts/next-id.mjs:87`
- `scripts/preflight.mjs:101,266,530,571,810` — since fixed by repo-75, which
  gave the three `spawnSync` calls `shell: false`; the file now passes
- `scripts/test/agent-cost.test.ts:152,225,273,281,291,315,357,381,390,404,417,437,494,516`
- `scripts/test/citations-gate.test.ts:31,63,286,297,373,521,591,653,666,694,758,832,836,1047,1055,1077,1113`
- `scripts/test/citations.test.ts:167,172,191,217,480,576,644,652,674,710,747,774,1288,1323,1541,1548,1579,1581,1779,1811,1812,1838,1856,1903,1937,1953,1984,1999,2050,2220,2237,2260,2284,2332,2353,2379,2383,2433,2460,2690,2726,2730,2741`
- `scripts/test/next-id.test.ts:463,496,577,685`
- `scripts/test/preflight.test.ts:61,689,795,824,849`
- `scripts/test/review-record.test.ts:183,268`
- `tools/downloader/api/test/ytdlp-in-the-image.test.ts:158`

So 10 remain after repo-75 — re-measured at `cf66f72`, repo-75's head: 484
files, 28 importing `node:child_process` (repo-75's own `repoSources` is the
new one, and says `shell: false`), `callNoShellFalse: 10`, the list above less
`preflight.mjs`. None of them passes a truthy `shell`: the other two checks
pass over the same files.

**Why its own pull request, not repo-75's.** The downloader test is under
`tools/downloader/`, and release-please routes a commit to a tool by path, so
changing it under repo-75's `fix(repo)` title would release the downloader.
And `scripts/test/preflight.test.ts` is edited by #303 (repo-71), whose record
cites its lines. repo-75 was answered as widening the roots; this half was put
to the owner separately on 2026-09-27 and filed here by their choice.

## Build

1. Widen the call pattern in "every file that spawns says `shell: false`
   explicitly" to `spawn`, `spawnSync`, `execFile` and `execFileSync`.
2. Add `shell: false` to the option objects of the calls in the files listed
   above, in place, keeping each call's line count so no cited line moves —
   several of these files are cited by merged records. Re-measure first: the
   list above is a snapshot.
3. The downloader test goes in its own pull request with a `downloader` scope,
   or this whole ticket waits for a release it may ride; decide which when
   building. Rebase over #303 before touching `preflight.test.ts`.

## Done when

- A file calling `spawnSync`, `execFile` or `execFileSync` without an explicit
  `shell: false` fails `spawn-safety.test.ts`, shown red before the calls are
  fixed.
- Every file in the scan passes it.
- `npm run check`, the `core`, `repo` and `downloader` suites, and
  `node scripts/citations-gate.mjs --against origin/main` pass.

## Review

### Gate 1

**Gate: PASS** — 2026-09-29 · `2ffb72a...42e6405` · code-review at medium

Re-issued at `6418f17` with its words, rows and verdicts unchanged. Its unpinned coordinates still resolve there, and its pins to `2ffb72a` still read what they read. The round after it fixed the first and third lows and filed the fourth as repo-83, and gate 2 records those verdicts. Reviewed at `42e6405` against base `2ffb72a`; `origin/main` had moved to `6bfae8e` (#317, #318) by the fetch. Lines this branch introduces are cited unpinned against `42e6405`, and lines that already existed are pinned to `2ffb72a`. The Windows leg is named below and was not run. The landing's `repo-82` conflict was resolved in a scratch merge that was aborted afterwards.

| Done when                                                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A file calling `spawnSync`, `execFile` or `execFileSync` without an explicit `shell: false` fails `spawn-safety.test.ts`, shown red before the calls are fixed | **proven** — `packages/core/test/support/spawn-calls.ts:53 "execFileSync"`. Red reproduced: the tip's test over the base's nine offending files failed 1 of 5 and named all nine, while the base's own test over the same tree passed 5 of 5. One untracked fixture per function (`spawn`, `spawnSync`, `execFile`, `execFileSync`) was each named an offender, and a control that calls all four with `shell: false` passed                                                                                       |
| Every file in the scan passes it                                                                                                                               | **proven** — `packages/core/test/spawn-safety.test.ts@2ffb72a:78 "every file that spawns says"` passes at `42e6405`: 484 files scanned, 28 import `node:child_process`, 0 offenders                                                                                                                                                                                                                                                                                                                                |
| `npm run check`, the `core`, `repo` and `downloader` suites, and `citations-gate.mjs --against origin/main` pass                                               | **verified** — `npm run check` exit 0. `npx vitest run --project core --project repo --project downloader`: 105 of 106 files passed with 1 skipped, and 2117 of 2119 tests passed with 2 skipped, exit 0. The diff adds and removes no test, and its one changed `expect` only gains `shell: false`, so the count equals the base's. This was read from the diff, not run at the base. `citations-gate.mjs --against 2ffb72a` and `--against origin/main` (`6bfae8e`) each exit 0, with 131 enforced and 0 failing |

- **low** · Build step 2 is per call and the test is per file. The widened pattern matches 137 call sites across the scan, and 17 of them still carry no `shell: false` of their own. 10 of those are on the brief's list: 3 in `scripts/test/citations.test.ts` that the Log does not mention (`scripts/test/citations.test.ts@2ffb72a:1581 "]).status).not.toBe(0)"`, `scripts/test/citations.test.ts@2ffb72a:1985 "cwd: distinct.dir"`, `scripts/test/citations.test.ts@2ffb72a:2000 "cwd: repeated.dir"`), 5 in `scripts/test/preflight.test.ts`, which the Log discloses (for example `scripts/test/preflight.test.ts@2ffb72a:704 "spawnSync(command, args, { encoding:"`), and 2 in `scripts/preflight.mjs` (for example `scripts/preflight.mjs@2ffb72a:978 "ours, theirs], { cwd: repo }"`). The other 7 are in `scripts/review-record.mjs`, which is not on the list. None of them runs a shell, because `false` is Node's default.
- **low** · Build step 2 said to keep each call's line count "so no cited line moves". Instead the branch moves lines in 7 of the 10 files it edits and pins 63 citations in 12 merged records to `@2ffb72a`: 62 are in `## Review` sections and 1 is in `repo-64`'s Log. A word-level diff finds only 63 insertions of `@2ffb72a` and 9 table separator rows padded again. Every pin resolves `ok` under `citations.mjs`, except one Log shorthand in `repo-64` that was already unanchored. The Log gives the reason. The method differs from the brief's, but the goal of the brief holds for every CI-enforced citation. The owner should see this, and it does not need to be reverted.
- **low** · Two citations in other records now point at different lines, and they were not pinned. Neither is in a `## Review` section, so CI does not check them. `repo-65` (status `ready`) cites the `ls-files` call by a line number that now lands on a JSDoc line, at `docs/work/repo-65-preflight-diffpaths-does-not-see-uncommitted-changes.md@2ffb72a:63 "its records from the git index"`, and that call now sits at `scripts/citations-gate.mjs:492 "...pathspecs], GIT_EXEC_OPTIONS"`. `repo-60`'s Log cites a test comment by line number, at `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md@2ffb72a:456 "comment says either"`, and that comment is now line 2845. `citations-gate.mjs --displaced-since 2ffb72a` reports both. This contradicts the Log's statement that it "repointed the moved citations" (branch Log, 2026-09-29 entry).
- **low** · `nfr:maintainability`: nothing guards the widened pattern. Every file now passes either way, so narrowing the pattern back to `spawn(` alone would keep the test green. repo-75 added a guard of this kind for the scan's roots, and the pattern has none.
- **low** · Landing: `git merge-tree HEAD origin/main` conflicts on `repo-82`'s table rows 1–2. The branch's pinned rows have to win. In the merged tree the cited `not.toMatch(/no section matches/)` sits at line 3048, so taking main's unpinned row, which says 3054, would fail as MOVED. I resolved it that way in a scratch merge that was aborted afterwards. `citations-gate.mjs --against origin/main` exited 0 with 133 enforced, `citations.test.ts` and `spawn-safety.test.ts` passed 117 of 117, and `tsc -b scripts/test` exited 0. `citations.test.ts` auto-merges with #317.
- **unproven (gate)** · This is not a Done when line. Every edited call runs on the `windows-latest` leg, which does not gate the merge (`.github/workflows/ci.yml@2ffb72a:338 "continue-on-error: ${{ matrix.os"`). No pull request exists, so that leg has not run. I read the risk as nil: `shell: false` is already the default, no edited call set `shell` before, and the edited calls spawn only `git`, `gh`, `node` and `process.execPath`. None of those is a `.cmd` file.
- **dropped** · I ran each evasion from the dispatch as a fixture. It catches `cp.spawnSync(`, `child_process.execFileSync(`, and a `shell: false` that sits only in a comment. oxlint's `prefer-node-protocol` rejects an import from bare `child_process`. The test misses an aliased import (`spawnSync as run`), `require` and dynamic `import()`, a string literal that contains `shell: false`, and a second call in a file that already says it once. The base had the same limits for `spawn`, and the brief promised to widen the pattern, not to close these.
- **dropped** · `GIT_EXEC_OPTIONS` gives two calls `encoding` or `maxBuffer` they did not have: `rev-parse --show-toplevel` and a stdio-ignored `rev-parse --verify`. Neither change is observable. Every spread comes first and nothing after it sets `shell`, and `as const` is erased at compile time.
- **findings** · code-review at medium returned 7; 5 carried, 2 dropped.
- NFR: security ✓ (no runtime change, and the truthy-`shell` check passes) · performance n/a · reliability ✓ · maintainability — above.

### Gate 2

**Gate: PASS** — 2026-09-29 · `42e6405..6418f17` · re-gate of one round, code-review at medium over its lines only

Reviewed `git diff 42e6405..6418f17` only, against base `2ffb72a`. `origin/main` is still `6bfae8e`. Owner decisions relayed by the orchestrator: fix "The 3 line-neutral" calls, "File it" for a per-call ticket, and "Accept" the pinning. Nothing outside this round was re-swept. No refutation came back.

| Gate 1 finding                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per call, 3 brief-listed calls in `citations.test.ts` without their own `shell: false` | **fixed** — `scripts/test/citations.test.ts:1577 "], TEXT).status).not.toBe(0)"`, and the two `cwd: distinct.dir` and `cwd: repeated.dir` calls now spread `...TEXT`. `git diff --numstat` shows 3 added and 3 deleted, so no line moved. My per-call scan at `6418f17` finds 137 calls and 14 without their own `shell: false`, none of them in `citations.test.ts`. The other 14 stay by the owner's choice and are carried to repo-83                     |
| Pinning 63 citations instead of holding line counts                                    | **accepted by the owner**, recorded in the Log. There was no code change                                                                                                                                                                                                                                                                                                                                                                                     |
| Two moved citations outside Review, left unpinned                                      | **fixed** — `docs/work/repo-65-preflight-diffpaths-does-not-see-uncommitted-changes.md:63 "its records from the git index"` and `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md:456 "comment says either"` now pin `@2ffb72a`, and each changes coordinates only. At `2ffb72a` the two pins read the `ls-files` call and the carve-out comment. `citations-gate.mjs --displaced-since 2ffb72a` no longer names either record |
| Nothing guards the widened pattern                                                     | **filed**, not fixed, as the owner chose. Reproduced at `6418f17`: with the pattern narrowed back to spawn alone, the test still passes 5 of 5                                                                                                                                                                                                                                                                                                               |
| Landing conflict on `repo-82`                                                          | **unchanged** — `git merge-tree HEAD origin/main` still conflicts only on `repo-82`, and in the merged tree the cited line is still 3048                                                                                                                                                                                                                                                                                                                     |

- **low** · repo-83's reproduction cannot be re-run from the repository. Its per-call count comes from `docs/work/repo-83-shell-false-check-is-per-file-not-per-call.md:24 "gate1/percall.mjs"`, a script in one session's scratchpad that was never committed. Its narrowed-pattern result (`docs/work/repo-83-shell-false-check-is-per-file-not-per-call.md:37 "scratch copy of the test with the pattern narrowed"`) gives no command at all. The Log also dates the 14 to the wrong sha: `docs/work/repo-83-shell-false-check-is-per-file-not-per-call.md@b7fb3fb:108 "Reproduced both halves at repo-77"` says `42e6405`, where the count was 17. The 14 holds only at `6418f17`, which the Why calls only the pushed head. The numbers themselves reproduce: 484 files, 28 importing, 137 calls, 14 lacking, and 5 of 5 passing once narrowed. Only the path back to them is missing.
- **low** · The round's own repo-77 Log entry has a malformed pin. Run on the whole record, `citations.mjs` reports `MALFORMED @2ffb72a:1581` and exits 32. The entry's before-and-after quotes of the two repointed coordinates also report as displaced under `--displaced-since 2ffb72a`. Both sit in the Log, which CI's Review-only gate does not read, so neither turns anything red. I name this section rather than citing the ticket's own file.
- **dropped** · repo-83's reason why narrowing still passes is roundabout, but it is not wrong. A narrower pattern can only shrink the offender set, and that set is already empty.
- **findings** · code-review at medium over the round returned 3; 2 carried, 1 dropped.
- Checks at `6418f17`: `npm run check` exit 0. `npx vitest run packages/core/test/spawn-safety.test.ts scripts/test/citations.test.ts` passed 117 of 117 tests. `node scripts/citations-gate.mjs --against 2ffb72a` exit 0, with 131 enforced and 0 failing. `npm run status -- --show repo-83` reads `needs-decision`. `next-id.mjs repo` lists no clash on repo-83, and `origin/main` has no repo-83.
- NFR: security n/a (it changes only test options and docs) · performance n/a · reliability ✓ · maintainability — above.

## Log

- 2026-09-27 — Filed from repo-75's measurement, in repo-75's pull request, on
  the owner's choice of "Own ticket" over "Scripts part here" and "Drop it". No
  fix made here.
- 2026-09-29 — Built. Re-measured at dispatch (`2ffb72a`, the tip after #316/
  repo-82) with the widened pattern before touching anything: **9 files**, not
  10 — `scripts/preflight.test.ts` had already dropped out (#303/repo-71 gave
  its own new `spawnSync` `shell: false`, and the whole-file check does not
  care that the other four calls in that file still lack it explicitly, which
  is a known shape of this test, not something this ticket widens). Every
  other file on the snapshot was still there, plus two new `citations.test.ts`
  call sites #316 (repo-82) added, at `2959` and `3036` in that measurement.
  Fixed all 9 with `shell: false`, sharing one options object per file where
  three or more calls repeated it (`citations-gate.mjs`, `citations.mjs`,
  `agent-cost.test.ts`, `citations-gate.test.ts`, `citations.test.ts`) and
  adding it inline where there were one or two (`next-id.mjs`,
  `next-id.test.ts`, `review-record.test.ts`, `ytdlp-in-the-image.test.ts`).
  Kept every edited call's own line count where a merged record's citation
  sits on it, offsetting a shared constant's own line cost against a call it
  let collapse so nothing after it shifted; where that was not practical
  (`citations-gate.mjs`'s `main()`, and the bulk of `citations.test.ts`, whose
  46 calls could not all be zero-sum), repointed the moved citations to a
  `@2ffb72a` base pin instead, per `records.md`'s standing rule that content
  unchanged at the base pins there rather than churning the ticket that cited
  it — **WITHDRAWN — do not cite this paragraph:** "46 citations across 9
  merged tickets in total (repo-14, repo-29, repo-41, repo-50 x2, repo-52 x2,
  repo-60, repo-63, repo-64, repo-67, repo-74, repo-78)." Both numbers are
  wrong and the list is missing a ticket — that sentence only ever counted the
  `citations.test.ts` repointing pass, dropped `repo-82` from its own list,
  and mislabelled two tickets' "x2" as a citation count when it meant "this
  ticket appears twice in my working notes." The real count, measured by the
  orchestrator at this ticket's pushed head and independently reproduced
  here, is **12 tickets, 63 pinned citations, 43 added lines** (a table
  reflow can put more than one pin on a line, and one line, repo-77's own,
  matched the sha string in prose rather than a pin and does not belong in
  either count):
  `git diff --name-only 2ffb72a bdeb210 -- docs/work | grep -v repo-77` gives
  the 12 files; per file, `git diff 2ffb72a bdeb210 -- <file> | grep '^+' |
grep -c '@2ffb72a'` for the line count, and the same piped through
  `grep -o '@2ffb72a:[0-9]*' | wc -l` for the pin count, give lines/pins:
  repo-14 4/4, repo-29 2/2, repo-41 1/1, repo-50 15/22, repo-52 2/7, repo-60
  7/10, repo-63 2/5, repo-64 2/2, repo-67 1/1, repo-74 1/2, repo-78 3/3,
  repo-82 3/4 — summing to 43 lines, 63 pins, matching the orchestrator's 63
  exactly and its 44 once repo-77's own line is excluded.
  Every changed line is coordinate-only: a script pairing each removed line
  with its added counterpart, stripping `@2ffb72a` and collapsing whitespace,
  finds zero content mismatches across all twelve files — the only
  differences left are markdown table separator rows re-padded by `oxfmt` to
  the new (longer) column width, not a citation's own text. The downloader
  test's own PR question from Build step 3 was
  answered by the owner before this build started (dispatch record): one PR,
  `test(repo)`, since `test` is hidden from every tool's changelog including
  the downloader's. `next-id.test.ts`'s fourth call, `:685` in the ticket's
  snapshot, was never real — it is `magnitude per spawn (see the project's` in
  a doc comment, matched only because a throwaway scan script (mine, and by
  the shape of it probably the one this ticket's own snapshot came from too)
  found line numbers by re-scanning the original text instead of the
  comment-stripped one the test itself uses; the test's own three call sites
  were the whole population there.
  **Learned mid-build, unresolved, flagged for whoever lands this**:
  `origin/main` moved twice while this branch was open — #317
  (`test(repo): make the CRLF citations CLI test pass on a depth-1 checkout`)
  and #318 — both from a concurrent session sharing this checkout's remote
  refs. #317 rewrites the exact `citations.test.ts` test this ticket also
  touches (the CRLF `## Review` CLI test, `record` line ~90-91 area) to avoid
  a second, unresolvable citation on a depth-1 checkout; this branch, built
  from before #317 landed, still carries the pre-#317 shape of that test with
  only `shell: false` added to its one call. `git merge-tree HEAD origin/main`
  auto-merges `scripts/test/citations.test.ts` cleanly but conflicts on
  `docs/work/repo-82-citations-crlf-and-preflight-lows.md` (both branches
  touch its table/Log). Until this branch is rebased onto (or merged with) the
  post-#317 `main`, its own `test` job is exposed to the same depth-1 failure
  #317 exists to fix — an open decision for the orchestrator, not settled
  here: rebase now, or leave it to a fixer round after a gate names it.

- 2026-09-29 — **Mechanical round (fixer), on gate 1's findings, applied at
  the branch's head `42e6405`.** Owner decisions, taken via `AskUserQuestion`,
  relayed by the orchestrator:
  1. **What goes in the landing round?** Options: "The 3 line-neutral" (the
     orchestrator's recommendation), "All 8", "None, ship as is". **Chosen:
     The 3 line-neutral.** Gave the three calls in
     `scripts/test/citations.test.ts` gate 1 named unfixed
     (`scripts/test/citations.test.ts@2ffb72a:1581`/`1985`/`2000`, now
     `1577`/`1981`/`1996`) their own `shell: false` without moving any cited
     line — `git diff --stat` on that file shows 3 insertions, 3 deletions.
  2. **File a ticket making spawn-safety's check per call?** Options: "File
     it" (recommended) or "Don't file". **Chosen: File it.** Filed repo-83
     (`docs/work/repo-83-shell-false-check-is-per-file-not-per-call.md`,
     `status: needs-decision`), carrying the reproduction re-measured at this
     round's own head (137 calls, 14 lacking their own `shell: false`, down
     from the gate's 17 by the three calls this round fixed) and the gate's
     narrowed-pattern-still-passes result, independently reproduced with a
     scratch copy of the test.
  3. **Accept pinning 63 citations instead of holding line counts?** Options:
     "Accept" (recommended) or "Revert to held lines". **Chosen: Accept.** No
     change — record only.
  4. **Build step 3 (one PR, `test(repo)`) — already recorded** in the
     2026-09-29 entry above.

  Pinned the two citations gate 1's finding named as displaced but not
  pinned, coordinate only, after checking the content at `2ffb72a` matched:
  `docs/work/repo-65-preflight-diffpaths-does-not-see-uncommitted-changes.md`
  line 63, `scripts/citations-gate.mjs:489` → `scripts/citations-gate.mjs@2ffb72a:489`;
  `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md`
  line 456, `scripts/test/citations.test.ts:2851` →
  `scripts/test/citations.test.ts@2ffb72a:2851`. Reproduced red before, green
  after: `node scripts/citations.mjs <file> --displaced-since 2ffb72a` on the
  pre-fix copies reports `DISPLACED` for both (exit 128 for repo-65, exit 131
  for repo-60); on the fixed files, neither reports `displaced` at all.

  No landing in this round — no gate record committed, no pull request
  opened. `origin/main`'s drift past `2ffb72a` (#317, #318), flagged unresolved
  in the entry above, is unchanged by this round and still open for whoever
  lands this ticket.

- 2026-09-29 — **Landed at `6418f17`, ship authority from the orchestrator.**
  Gate 1's and gate 2's records above describe the branch as it stood at
  `6418f17` — gate 1 re-issued unchanged, gate 2 re-gating the fixer round
  against it. Fixed gate 2's two lows: the earlier Log entry's file-less pin
  (a bare `@2ffb72a` revision with no file ahead of the colon, at the 3
  brief-listed `citations.test.ts` line numbers) now names its file,
  `scripts/test/citations.test.ts@2ffb72a:1581`, and `node scripts/citations.mjs`
  no longer reports a malformed pin there. repo-83 gained an appended, dated
  reproduction section — the per-call and narrowed-pattern scripts inlined,
  each with its exact command and output at `6418f17` — so its numbers no
  longer depend on a session's scratchpad; nothing above that section moved,
  confirmed by `diff` on the first 105 lines.
