---
id: repo-77
tool: repo
title: spawn-safety's explicit shell false check sees only spawn, not spawnSync or execFileSync
kind: fix
status: ready
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
