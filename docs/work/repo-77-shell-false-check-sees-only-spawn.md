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
