---
id: repo-34
tool: repo
title: Three Windows-only code paths that no assertion covers, and one of them is a security control
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-34 — The Windows-only paths nothing asserts

## Why

Filed out of [repo-31](./repo-31-the-windows-leg-is-almost-all-red.md)'s `Done
when` 4, which asked for the coverage gap its measurement 4 surfaced to be fixed
or filed rather than left as a paragraph. **The gap that ticket named does not
exist**; three narrower ones do, and they are what this ticket carries. The
correction is recorded in repo-31's Log and repeated here in short, because a
reader who arrives via this page should not have to take the premise on trust.

repo-31's measurement 4 said `killProcessTree`'s Windows branch "is exercised by
no test, on any platform, including `windows-latest` itself", having read
`tools/downloader/engine/test/ffmpeg-runner.test.ts` and found no kill, abort or
cancel case there. That file indeed has none. The test is in a different file:
`tools/downloader/engine/test/hls-e2e.test.ts`'s "cancelling kills the process
tree and leaves no artifacts", which `.github/workflows/ci.yml` has named in its
own comment as the reason the matrix exists all along.

Measured rather than argued, on this branch: `killProcessTree` was temporarily
instrumented to append its `pid` and `process.platform` to a file, and
`npx vitest run tools/downloader/engine/test/hls-e2e.test.ts -t "cancelling
kills the process tree"` was run. One line came back — `killProcessTree 26858
linux` — from a test that passed. The instrumentation was reverted; nothing of
it is in this branch. So the call really is reached from a real abort of a real
ffmpeg, and on `windows-latest` the same call takes `IS_WINDOWS` into
`killTreeWindows`, spawns the real `taskkill.exe`, and the two `fs.stat`
rejections that follow are the `EBUSY`-avoidance proof `kill.ts`'s docblock
argues the file's existence from.

What is left is smaller and real.

### 1. `taskkillPath` — a search-order control with no assertion

`tools/downloader/engine/src/ffmpeg/kill.ts` resolves `taskkill.exe`'s absolute
path from `SystemRoot`, falling back to `windir` and then to `C:\Windows`. Its
docblock says why in security terms: resolving it rather than trusting `PATH`
"removes a search-order hijack: PATH is inherited from whatever launched the
service." **No test asserts what it returns**, on any platform, and it takes its
`env` as a parameter specifically so one could — `grep -rn taskkillPath` over
`tools` and `packages` finds it in `kill.ts` only.

It is not wholly unexercised: the cancellation test above runs it for real on
`windows-latest`. But that test can only fail on the _consequence_ — the
`fs.stat` assertions — and `killTreeWindows` resolves quietly on a spawn error
after a `logger.warn`, so a wrong path degrades to "the tree was not killed"
rather than to a named failure. A control whose test is three layers away and
whose failure mode is a warning is the definition of a gap worth one direct
assertion.

This one is free of decisions: the function is pure, the `env` is injectable,
and the three branches are three `expect`s.

### 2. `findExecutable`'s `PATHEXT` branch — untested, and not testable today

`tools/downloader/resolvers/src/resolvers/ytdlp.ts` reads `process.platform` and
`process.env` directly rather than accepting them, so its Windows extension
search cannot be driven from a Linux test at all. Unlike `taskkillPath` this is
not free: making it testable is a small refactor of a function that runs on
every resolve, which is why it is in this ticket rather than folded into
repo-31's branch.

### 3. `assertPathInside` is OS-bound by an import, not by necessity

`tools/downloader/engine/src/storage.ts` imports `node:path`, which _is_
`path.win32` in a Windows process and `path.posix` everywhere else.
`tools/downloader/engine/test/storage.test.ts` already branches its fixture on
`process.platform`, so the assertion is correct either way it runs — but it only
_proves_ the Windows behaviour when the process is a Windows one. Node ships
`path.win32` for exactly this, and the function could accept an injectable path
module the way `taskkillPath` already accepts an injectable `env`.

**Why this matters more than it did last week:** repo-31's answer made the
`windows-latest` leg informational. Every path above whose only proof is "it runs
on the Windows runner" is now proven by a job that cannot fail the build. That is
not an argument against the answer — the leg was failing for a reason unrelated
to any of this — but it does move these three from "belt and braces" to "the
assertion".

## Build

1. **Unit-test `taskkillPath`** in `tools/downloader/engine/test/ffmpeg-args.test.ts`,
   beside `buildTaskkillArgs`, which is already there and already
   platform-independent. Three cases: `SystemRoot` wins; `windir` is used when
   `SystemRoot` is absent; `C:\Windows` when neither is set. Assert the exact
   expected string per case rather than a property — the point is the literal
   path. Note that `path.join` is POSIX-flavoured on a Linux test host, so the
   expectation has to be built the same way the function builds it, or the test
   asserts the separator instead of the logic. Say in the test which of those it
   is asserting.
2. **Make `findExecutable` testable** — take `platform` and `env` as parameters
   with defaults, the way `taskkillPath` does, then test the `PATHEXT` branch
   from any host. Keep the default call sites unchanged.
3. **Make `assertPathInside` testable** — accept an injectable path module
   defaulting to `node:path`, and add a case that drives it with `path.win32`
   from a Linux host: a drive-letter root with a `..\` escape, and a
   `C:\root-other\x` sibling-prefix case, mirroring the POSIX cases already
   there.
4. **Do not widen to `killProcessTree` itself.** It is covered, and the
   measurement above is the evidence. Anyone tempted should re-run the
   instrumentation first.

## Done when

1. `taskkillPath`'s three branches are asserted directly, and the test is shown
   red first — change the fallback constant, watch it fail, change it back, and
   say in the ticket's Log what the red actually said.
2. `findExecutable`'s `PATHEXT` branch is asserted from a Linux host, or this
   ticket records why the refactor was not worth it and drops that step
   explicitly rather than silently.
3. `assertPathInside` is asserted against `path.win32` from a Linux host, and
   the existing `process.platform` branch in `storage.test.ts` is either kept
   with a note saying what it still buys or removed as redundant — decided, not
   left ambiguous.
4. `npm test -- --project downloader` passes, and `npm run check` passes.
5. The claim in `.github/workflows/ci.yml`'s matrix comment — that the
   cancellation test is "the only execution of `taskkillPath()` anywhere" — is
   re-read and either still true or corrected in the same change.

## Review

**Gate: FAIL** — then fixed on the same branch; see the findings below and the
Log's finding-by-finding record — 2026-09-08 · `origin/main...cd00fb4` (gate 1)
· defect hunt with independent reproduction, no `code-review` delegate.
Builder: dispatched as `sonnet` by the orchestrator, from the ticket's
`difficulty: standard`. Reviewer (`ac0e54bd5e1d5ed92`): dispatched as `opus` —
the different-model rule held. Both values are the orchestrator's dispatch
parameter, decided before either agent ran, not either agent's self-report of
what it is — a record of the dispatch, not of what ran, since a fallback can
move a model mid-run without either of us seeing it. This section is authored
by the builder from the reviewer's findings message plus the builder's own
independent reproduction of every finding, per the coordinator's
instruction — it is not a transcription of the reviewer's
report.

| Done when                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `taskkillPath`'s three branches asserted directly, shown red first                                            | `tools/downloader/engine/test/ffmpeg-args.test.ts:306-323` "SystemRoot wins when both SystemRoot and windir are set" — three cases. Red-first reproduced twice, independently, character for character: mutating `kill.ts`'s `"C:\\Windows"` to `"C:\\Win"` gives `AssertionError: expected 'C:\Win/System32/taskkill.exe' to be 'C:\Windows/System32/taskkill.exe'`, 1 failed / 27 passed, exit 1. Both the builder's original run and gate 1's independent re-run got this exact text.                                                                                                                                                                                                                           |
| 2. `findExecutable`'s `PATHEXT` branch asserted from a Linux host                                                | `tools/downloader/resolvers/test/ytdlp.test.ts:903-952` "findExecutable's PATHEXT branch (repo-34)" — five cases, real temp-directory files, `platform`/`env` injected. Gate finding 6: the block did not disclose that `join` stays POSIX-flavoured even under `platform: "win32"` (so these prove extension selection, not Windows joining) — comment added, no test changed.                                                                                                                                                                                                                                                                                                                                    |
| 3. `assertPathInside` asserted against `path.win32`; existing `process.platform` branch kept or removed, decided | `tools/downloader/engine/test/storage.test.ts:108-130` "rejects a Windows-style escape when driven by path.win32" — three win32 cases now, not two: escape, sibling-prefix, and (gate finding 2) a cross-drive case added after the gate. All three shown red first against the unrefactored/undefended behaviour. The `process.platform` branch, `tools/downloader/engine/test/storage.test.ts:84` "rejects an absolute path elsewhere" (formerly line 75 on `origin/main` — line 76 there was the `const elsewhere` body one line below, which is what repo-31 cited and this branch's finding-3 repointing corrected), was **kept, with a note** explaining what it alone proves — decided, not left ambiguous. |
| 4. `npm test -- --project downloader` and `npm run check` pass                                                   | **verified twice** — before gate 1: 1204/1204, 73 files, `npm run check` exit 0. After applying gate 1's findings 1/2/6: 1205/1205 (73 files), full repo `npm test` 2317/2317 (135 files), `npm run check` exit 0 again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5. `ci.yml`'s "only execution of `taskkillPath()`" claim re-read, corrected if false                             | **Re-run twice, not merely re-read twice.** First pass (pre-gate) narrowed the claim to "only place the return value reaches a real spawn" — re-run at `cd00fb4` via gate 1's own instrumentation and came back **false**: two trace lines, not one, from two distinct callers (finding 1, now `high`). Corrected and re-measured **true** at `f6ab038`: `.github/workflows/ci.yml:264-285` "The unit and integration suites" now names both call paths — `runner.ts`'s `onAbort` (the cancellation test) and its `SIZE_LIMIT_EXCEEDED` stdout-handler branch (the size-cap test), both reachable because neither `hls-e2e.test.ts` case carries a `skipIf`.                                                       |

**Findings, gate 1, all independently reproduced by the builder before fixing anything:**

- **high, fixed** — the pre-gate `.github/workflows/ci.yml` comment (superseded; see Done-when 5's citation above for the current text) was still wrong after the first correction: `killProcessTree`'s one call site, `tools/downloader/engine/src/ffmpeg/runner.ts:164` "await killProcessTree(targetPid, { logger });", is reached from two callers on `windows-latest`, not one. Reproduced with fresh instrumentation (`appendFileSync` + full stack capture, reverted before commit): running the two `hls-e2e.test.ts` tests in isolation gave two distinct stacks, `tools/downloader/engine/src/ffmpeg/runner.ts:181-183` "function onAbort(): void {" (`onAbort`, the cancellation test) and `tools/downloader/engine/src/ffmpeg/runner.ts:204-208` "writtenBytes: snapshot.totalSize, limitBytes: options.maxOutputBytes" (the size-cap test). Comment rewritten to name both; see Done-when 5 above. **Regraded `med` → `high`** on the reviewer's own re-check of the rubric: Done-when 5 was not merely unproven, it was re-run and came back false — the acceptance line _is wrong_ rather than untested, which is the severity table's `high` case. The comment's own stated purpose is "so nobody deletes the wrong half" (`.github/workflows/ci.yml:266` "precisely so nobody deletes the wrong half") and it pins the process-tree rule in CLAUDE.md, so a false claim there is nearer to breaking an invariant than to misleading a reader: a maintainer trusting the false "only one execution" line could delete `tools/downloader/engine/test/hls-e2e.test.ts:358` "a runtime size cap stops the download even when no estimate was possible" as redundant, removing one of only two real-`taskkill.exe` executions this repo has on the Windows runner.
- **med, fixed** — `tools/downloader/engine/src/storage.ts:145` "pathModule.isAbsolute(relative)", the only clause reachable exclusively on Windows, was unexercised by either win32 case Build step 3 named (both hit only the `startsWith("..\\")` clause). Reproduced: deleting the clause left `npm test -- --project downloader` at 1204/1204. Added `tools/downloader/engine/test/storage.test.ts:126-128` "rejects a cross-drive Windows candidate, which only the isAbsolute clause catches" (`C:\storage` root, `D:\evil` candidate), confirmed it fails red against the same deletion, restored the clause, confirmed green. This is a gap in Build step 3's own brief (it named exactly two cases), not a deviation by the builder — recorded as such.
- **med, open decision, answered by the owner mid-review** — this branch shifted 11 citations in the merged `docs/work/repo-31-the-windows-leg-is-almost-all-red.md`. The owner chose **repoint over pin**: the 5 downloader citations this branch actually moved were repointed against this tree (see the Log below for the full old→new list); the 6 `.github/workflows/ci.yml` citations were left untouched, since `repo-29-citation-anchors` repoints those independently and owns that file's lines this round.
- **low, fixed** — this ticket's own Log wrongly said "(line 76 as the ticket cited; unchanged in position)": repo-34 never cited line 76 anywhere — repo-31 does, at `docs/work/repo-31-the-windows-leg-is-almost-all-red.md:204` "const elsewhere = process.platform" — and the position did move (75 at `b384033`, 84 on this branch before gate finding 2 added a further case after it). Corrected with a proper citation in the Log.
- **low, fixed** — this ticket's own Log carried three unqualified prose line references, which `citations.mjs` cannot check — exactly how the line-76 error above escaped a mechanical catch. Requalified as anchored `file:line` citations throughout the Log and this section.
- **low, fixed** — `tools/downloader/resolvers/test/ytdlp.test.ts:893-902` "they are not proof of Windows path joining" did not disclose that the block asserts extension selection rather than Windows path joining (the imported `join` stays POSIX-flavoured regardless of the injected `platform`). One comment added.
- **verified clean, no finding** — the `ci.yml` edit sits at `.github/workflows/ci.yml:264-285` "The unit and integration suites", inside the `test` job and clear of the `check` job (`.github/workflows/ci.yml:88` "check:") that a sibling session was sweeping concurrently on repo-29. `assertPathInside` has 8 production call sites, none passes a third argument, production behaviour unchanged on both platforms. `findExecutable` has 1 production call site, unchanged. No contract edits, no shell, `AppError` taxonomy intact.
- **not verified, flagged as such by the reviewer** — that `killTreeWindows` and a real `taskkill.exe` spawn actually execute on `windows-latest` is inferred from the `IS_WINDOWS` branch, not measured; nobody in this exchange can run that leg. Whether `windows-latest` has ever passed since being made informational is likewise unchecked.
- **findings** · defect hunt with independent reproduction returned 8; 6 carried as findings (1 high — 1; 2 med — 2, 3; 3 low — 4, 5, 6), 0 dropped, 2 recorded as non-findings (a clean-scope check and an explicitly-unverifiable claim, both above).

NFR: security ✓ — this branch closes rather than opens a gap in the path-confinement control (`assertPathInside`), and the gate itself found the remaining unexercised clause before merge · performance n/a · reliability ✓ — all counts reconcile (base 1194 → 1204 pre-gate → 1205 post-gate, 73 files; full repo 2316 → 2317) · maintainability ✓ — the gate's own findings 4/5 improved the Log's own citation discipline, which is the kind of correction this repo's citation checker exists to force.

## Log

- **2026-09-07** — Filed from repo-31's build, on the owner's answer to repo-31
  (option D). Id taken as `repo-34` on instruction: `node scripts/next-id.mjs
repo` reported `next free: repo-33`, and `repo-33` was held at that moment by
  a builder whose branch was not yet pushed, so the script could not see it.
  (That ticket was renumbered to `repo-36` on 2026-09-08, after a peer
  session's own `repo-33` merged first in #192; the measurement above is left as
  it was taken.)
  `repo-34` was checked free by grep over both ticket roots on this branch.

  Filed rather than folded into repo-31's branch for two reasons, both concrete.
  repo-31's change touches `.github/` and `docs/` only; steps 1–3 above touch
  `tools/downloader`, and a branch that lands both carries one squashed title
  that has to be written for one of them. And steps 2 and 3 are refactors of
  shipped functions, which is a different review than a workflow comment.

  **Step 1 was very nearly folded in anyway** — it is a pure function, an
  injectable `env` and three assertions, with no decision in it. It was left
  here because folding it would have put a `tools/downloader` path into a
  `repo`-scoped branch, which is the split CLAUDE.md names as the tell that
  there should have been two commits. Recorded so the deferral is visible rather
  than inferred.

- **2026-09-08** — Built. Base `origin/main` at `b384033`, branch
  `repo-34-windows-only-code-paths`.

  **Step 1 — `taskkillPath`.** Added three cases to `ffmpeg-args.test.ts`
  beside `buildTaskkillArgs`, asserting the exact string per branch (`SystemRoot`
  wins over `windir` and the literal default; `windir` used when `SystemRoot` is
  absent; falls back to `C:\Windows` when neither is set), built the same way
  the function itself builds it — `path.join(...)`, which is POSIX-flavoured on
  this host, so the assertion is checking the fallback _selection_, not the
  Windows separator; the test's own comment says so. Shown red first as the
  Done-when line asked: changed the fallback literal in `kill.ts` from
  `"C:\\Windows"` to `"C:\\Win"`, ran the file, and the red was
  `AssertionError: expected 'C:\Win/System32/taskkill.exe' to be
'C:\Windows/System32/taskkill.exe'` on exactly the one test touching that
  branch (27 of 28 still passed). Reverted, reran, 28/28 green.

  **Step 2 — `findExecutable`.** Added `platform`/`env` parameters defaulting
  to `process.platform`/`process.env`; the one call site (the constructor) is
  unchanged. Five new cases in `ytdlp.test.ts` drive the `PATHEXT` branch from
  this Linux host with a real temp directory and real files (extension found;
  earlier `PATHEXT` entry preferred over a later one; default `PATHEXT` list
  used when the env has none; a non-Windows platform does _not_ try extensions
  even though the extensioned file exists; `;`-delimited `PATH` on Windows
  versus the `:`-delimited POSIX form). Not folded in as "not worth it" — the
  refactor was the small one the ticket predicted, so this branch of Done-when
  2 does not apply.

  **Step 3 — `assertPathInside`.** Added an optional `pathModule` parameter
  (`typeof path`, defaulting to `node:path`); no caller passes a third
  argument today, so both `assertRealPathInside`'s internal call and the four
  external call sites are unchanged. Two new cases in `storage.test.ts`, driven
  with `path.win32`: a drive-letter root with a `..\` escape, and a
  `C:\storage-other\x` sibling-prefix case. **Shown red first, and the ticket's
  own prediction was exact**: with the third argument dropped (i.e. calling
  `assertPathInside(winRoot, candidate)` with no path module — the
  pre-refactor behaviour, since the default is `node:path`, which is POSIX on
  this host), both new cases failed with `expected function to throw an error,
but it didn't`. Concretely: `path.relative` under POSIX treats a `..\`-style
  candidate as one opaque path segment (backslash is not its separator), so
  neither the `relative === ".."` check nor the `relative.startsWith("..{sep}")`
  check ever fires — the exact "fixture never reached the Windows branch" gap
  the ticket names. Restored the `path.win32` argument, reran, both pass.

  The existing `process.platform`-branched "rejects an absolute path
  elsewhere" test — cited by repo-31 at
  `tools/downloader/engine/test/storage.test.ts:76` "const elsewhere =
  process.platform", now at `tools/downloader/engine/test/storage.test.ts:84`
  after this branch's edits — was **kept, with a note** rather than removed:
  it is the only case in the file that exercises the _default_ parameter (no
  injected module) against whichever `node:path` the host process actually
  has, so on the real `windows-latest` leg (repo-31: informational, still
  runs) it is the one assertion proving the default wiring resolves to
  `path.win32` there — the injected `path.win32` cases pass identically on
  every host and cannot prove that. Decided, not left ambiguous.

  **Step 4 — not touched.** No change to `killTreeWindows`, `killTreePosix` or
  `killProcessTree`. The instrumentation-based measurement in this ticket's
  "Why" was not re-run — re-running it was offered as a check for anyone
  tempted to widen scope, and nobody was tempted; taken as read rather than
  redone.

  **Done-when 5 — `ci.yml`.** The matrix comment's claim that the cancellation
  test is "the only execution of `taskkillPath()` anywhere" is now false (step
  1 added a direct execution), so it was corrected: `buildTaskkillArgs` is now
  listed alongside `taskkillPath`'s fallback chain as a pure-function case the
  matrix doesn't exist for. **First pass narrowed the surviving claim to "the
  only place `taskkillPath()`'s return value is ever handed to a real
  spawn" — gate 1 found that this was also false**, by instrumenting
  `killProcessTree` (its one call site is
  `tools/downloader/engine/src/ffmpeg/runner.ts:164`) and running the whole
  downloader project: two trace lines, not one, from two distinct callers —
  `runner.ts:182`'s `onAbort` (the cancellation test) and `runner.ts:206`'s
  `SIZE_LIMIT_EXCEEDED` branch in the stdout handler (the "a runtime size cap
  stops the download even when no estimate was possible" test). Reproduced
  independently before fixing it: same two-line result, same two stack
  traces. The comment now names both tests and both call paths, at
  `.github/workflows/ci.yml:210-231`. That block sits entirely inside the
  `test` job and is clear of the `check` job (`.github/workflows/ci.yml:88-166`,
  per gate 1's own verified-clean read) that a sibling session was sweeping
  concurrently on repo-29; no overlap in `git status`.

  **Fold-in exception** — nothing found. The three refactors are independent
  (different files, different functions) and none of the Build steps left an
  adjacent already-specified task free; nothing folded in beyond what the ticket
  already asked for.

  **Verification cost**, measured on this branch after `npm run build` (so
  `dist` exists and the full suite runs, not a fraction of it):
  - `npx vitest run tools/downloader/engine/test/ffmpeg-args.test.ts` — 28
    tests, 1 file, wall 1.14s.
  - `npx vitest run tools/downloader/resolvers/test/ytdlp.test.ts` — 48 tests
    (43 existing + 5 new), 1 file, wall 1.83s.
  - `npx vitest run tools/downloader/engine/test/storage.test.ts` (narrowest
    spec touching the security control) — 21 tests, 1 file, wall 0.96s (22
    tests after gate 1's finding 2 added a case; see below).
  - `npx vitest run tools/downloader/engine/test/` (its containing directory)
    — 164 tests, 14 files, wall 34.9s — most of that is the real
    `ffmpeg-static`/`hls-e2e` spawns this ticket explicitly left alone, not
    anything added here.
  - `npm test -- --project downloader` — 1204 tests, 73 files, wall ~40s
    (1205 after gate 1's finding 2).
  - `npm test` (full repo, run once at the end since no shared config moved)
    — 2316 tests, 135 files, wall ~41s (2317 after gate 1's finding 2).
  - `npm run check` — exit 0 (lint warnings present are pre-existing
    `no-await-in-loop` notices unrelated to this branch's files, none new);
    re-run after gate 1's fixes, still exit 0.

  None of these numbers are quoted from anywhere; each was run on this branch,
  on this host, after a real `npm run build`.

  **What the brief had right, almost in full.** The three Build steps, the
  exact fallback chain in step 1, the "pure function, no decision" read on
  step 1, and the win32-injection shape in step 3 all matched the code as
  found. **One gap, found at gate 1 rather than at build time**: Build step 3
  named exactly two win32 cases (a `..\` escape and a sibling-prefix), and
  `assertPathInside` has a third clause — `pathModule.isAbsolute(relative)` —
  reachable only on Windows, for a cross-drive candidate like `D:\evil`
  against a `C:\...` root. Neither named case exercises it. See gate 1,
  finding 2, below.

  ***

  **Gate 1** (`ac0e54bd5e1d5ed92`, on `cd00fb4`) returned FAIL on Done-when 5.
  Both red-first claims above reproduced exactly, byte for byte, including
  the assertion text. Six findings; three applied here (1, 2, 6), two more
  applied as cheap fixes (4, 5 — folded into the corrections above rather than
  kept as a separate pass), one left open for the owner (3). Reproduced every
  finding myself before touching anything, per this skill's own instruction —
  results below are mine, not a transcription of the gate's.

  - **Finding 1 (med at first report, regraded to high — see below —
    applied).** `ci.yml`'s corrected comment still claimed the cancellation
    test was "the only place `taskkillPath()`'s return value is ever handed
    to a real spawn." False: `killProcessTree`'s one call site
    (`tools/downloader/engine/src/ffmpeg/runner.ts:164`) is reached from two
    distinct callers on `windows-latest`, since neither `hls-e2e.test.ts` test
    that reaches it carries a `skipIf`. Reproduced independently with my own
    instrumentation (`appendFileSync` + a full stack capture in
    `killProcessTree`, reverted before committing): `KILLTRACE=...  npx vitest
run tools/downloader/engine/test/hls-e2e.test.ts` produced two lines, and
    isolating each test individually showed the two distinct stacks —
    `runner.ts:182`'s `onAbort` for "cancelling kills the process tree...",
    `runner.ts:206`'s `SIZE_LIMIT_EXCEEDED` branch for "a runtime size cap
    stops the download...". Comment rewritten to name both. **Regraded
    `med` → `high` after the gate re-checked its own verdict rubric**
    (`docs/01-TICKETS.md:237-243`) rather than accepting the coordinator's
    first reading of it: Done-when 5 was re-run and came back false, which is
    the severity table's `high` case (an acceptance line _is wrong_), not the
    `med` case (an acceptance line merely _unproven_). The gate verdict is a
    bare `FAIL` accordingly — see the header above and the coordinator's own
    message recording the correction.
  - **Finding 2 (med, applied).** `assertPathInside`'s `pathModule.isAbsolute`
    clause — the only clause reachable exclusively on Windows — was
    unexercised by either win32 case Build step 3 named. Reproduced: deleted
    the clause, ran `npm test -- --project downloader`, 1204/1204 still green.
    Added a third win32 case (`C:\storage` root, `D:\evil` candidate) and
    confirmed it red-first against the same deletion (`expected function to
throw an error, but it didn't`), then restored the clause and confirmed
    green again.
  - **Finding 3 (med, resolved by the owner).** This branch shifted 11
    citations in the merged `docs/work/repo-31-the-windows-leg-is-almost-all-red.md`
    (26 verified / 2 moved at `b384033`, 15 / 13 at this tip, per `node
scripts/citations.mjs docs/work/repo-31-the-windows-leg-is-almost-all-red.md`).
    **The question put to the owner**: repoint the 11 against this tree, or
    pin repo-31's record to the commit it reviewed with `--rev` and say so
    there. **The answer: repoint** — reasoned by the owner as "repo-31 is the
    evidence base your ticket's own premise rests on, so a reader will
    actually follow those lines"; pinning was declined here specifically
    because it is a change in how this repo treats merged records, and
    `repo-35` is open on exactly that broader question, so this ticket does
    not pre-empt it by picking a side.

    **Applied, downloader half only** — five of the eleven, the ones this
    branch's own test edits moved:

    | citation                                                                                                                                                                      | was    | now    |
    | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
    | `tools/downloader/engine/test/ffmpeg-args.test.ts` "so children die with the parent"                                                                                          | `:295` | `:296` |
    | `tools/downloader/resolvers/test/ytdlp.test.ts` "an abort kills the process instead of hanging"                                                                               | `:392` | `:399` |
    | `tools/downloader/resolvers/src/resolvers/ytdlp.ts` "const isWindows = platform ===" (was "... = process.platform ===", text itself changed by the `platform`/`env` refactor) | `:822` | `:830` |
    | `tools/downloader/resolvers/src/resolvers/ytdlp.ts` "const extensions = isWindows"                                                                                            | `:824` | `:832` |
    | `tools/downloader/engine/test/storage.test.ts` "const elsewhere = process.platform"                                                                                           | `:76`  | `:85`  |

    **Not touched, on the coordinator's explicit instruction**: the six
    citations pointing into `.github/workflows/ci.yml` (`:264` ×2, `:260`,
    `:272`, `:273`, `:339`) — `repo-29-citation-anchors` inserts 22 lines into
    that same file and repoints those six itself, to avoid two branches
    fighting over the same target lines. Reran `node scripts/citations.mjs
docs/work/repo-31-the-windows-leg-is-almost-all-red.md` after the
    repoint: 20 verified / 8 moved — the 8 remaining are exactly those six
    `ci.yml` citations plus two pre-existing `MOVED`s unrelated to either
    branch (`scripts/test/citations.test.ts:1319`,
    `tools/downloader/engine/test/hls-e2e.test.ts:366`, both already `moved`
    at `b384033`, before this ticket existed).

  - **Finding 4 (low, applied).** This Log's own "(line 76 as the ticket
    cited; unchanged in position)" was wrong twice — repo-34 never cited line
    76 anywhere (repo-31 does, at `docs/work/repo-31-the-windows-leg-is-almost-all-red.md:204`), and the position did move (75 at
    `b384033`, 84 on this branch, before finding 2 added a further test after
    it). Corrected above with a proper citation to repo-31's own reference.
  - **Finding 5 (low, applied).** This Log carried three unqualified prose
    line references ("line 76", "lines 209-224", "line 136"), which
    `citations.mjs` cannot check and which is exactly how finding 4 escaped a
    mechanical catch. Requalified as `file:line` citations above and in the
    Done-when 5 paragraph.
  - **Finding 6 (low, applied).** The new `findExecutable` test block in
    `ytdlp.test.ts` used the statically imported (POSIX-on-this-host) `join`
    even under `platform: "win32"`, so it proves extension selection, not
    Windows path joining — unlike `taskkillPath`'s cases, which disclose
    exactly that distinction. Added the same disclosure as a block comment.

  Full suite re-run after all fixes: `npm run build` clean; `npm test
-- --project downloader` 1205/1205, 73 files; `npm test` (full repo) 2317/2317,
  135 files; `npm run check` exit 0. Diff scope after the gate: `ci.yml`, this
  ticket file, `storage.test.ts`, `ytdlp.test.ts`, and (once finding 3 was
  answered) `docs/work/repo-31-the-windows-leg-is-almost-all-red.md` — no
  source file carries a net change; `storage.ts` and `kill.ts` were mutated
  and restored during reproduction, and `git diff` against `cd00fb4` on both
  is empty.

  **Finding 3 was carried to the orchestrator and came back answered**:
  repoint, not pin — see the finding-3 bullet above for the question, the
  answer and its reasoning, and the table of what moved. This ticket's own
  `## Review` section was additionally required to carry anchored citations
  throughout, ahead of `repo-29-citation-anchors`' CI enforcement of that on a
  grandfather list this ticket's record was not yet on when that list was
  computed; verified with `node scripts/citations.mjs --require-anchors
--section Review docs/work/repo-34-the-windows-only-code-paths-nothing-asserts.md`,
  exit 0.

  No open decisions remain. Committed, pushed, PR not opened — a second gate
  pass is the coordinator's call, not mine to skip past.
