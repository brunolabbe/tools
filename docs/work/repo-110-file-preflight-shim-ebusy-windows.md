---
id: repo-110
tool: repo
title: The preflight test's gh shim cleanup throws EBUSY on the Windows leg
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-110 — the preflight test's gh shim cleanup throws EBUSY on the Windows leg

## Why

The informational `test (windows-latest, informational)` leg failed once in
four Windows legs measured on 2026-10-18, in a test that cannot reach the code
the change touched. The failing leg is PR #541 (`lg-33-rename-a-person`, head
`399c766f`), run `39094129753`, job `117576949695`. Its `npm test` step failed
at 03:43:50Z. Re-read from the log, with the terminal colour codes stripped:

```
FAIL  repo scripts/test/preflight.test.ts > the CLI's --only mergeTree exits 16 on a failed probe and prints no other check (repo-104)
Error: EBUSY: resource busy or locked, unlink 'C:\Users\RUNNER~1\AppData\Local\Temp\preflight-ghshim-1r9Ts8\gh.exe'
Test Files  1 failed | 288 passed | 2 skipped (291)
Serialized Error: { errno: -4082, code: 'EBUSY', syscall: 'unlink', path: 'C:\Users\RUNNER~1\AppData\Local\Temp\preflight-ghshim-1r9Ts8\gh.exe' }
```

Reproduce it with `gh run view 39094129753 --job 117576949695 --log | grep -E "EBUSY|FAIL|Test Files"`.

What was measured, and no more:

- **The branch does not reach the file.** PR #541's diff, `gh pr diff 541
--name-only`, lists only paths under `tools/ledger/`. None is under
  `scripts/`.
- **The same file passed on the same leg at the same time.** The three
  release-please runs `39094138876`, `39094138627` and `39094138222`, started
  between 03:36 and 03:39 UTC, each concluded `success` on
  `test (windows-latest, informational)`, and their `npm test` steps succeeded.
- **The sample is four readings.** One red, three green, from one window of
  about twelve minutes. That is enough to call the failure intermittent. It
  says nothing about its rate.

The cleanup is the shape of the defect. The three preflight shim tests each
remove their directory in a `finally` with
`fs.rmSync(shimDir, { recursive: true, force: true });`, after a
`fs.mkdtempSync(path.join(os.tmpdir(), "preflight-ghshim-"))`. The directory
holds a `gh.exe` that `plantFakeGh` makes by hard link to `process.execPath`,
falling back to a copy. The child that ran it is the process whose image that
file is. The hypothesis is that the image is still held when `spawnSync` returns
and the unlink hits `EBUSY`. That is unmeasured.

`force: true` does not retry `EBUSY`. The `maxRetries` option of `rmSync` does,
so it is a candidate direction, not a decided fix. Nothing here measured it.

Related history, as prose. `repo-80`'s gate recorded the same unhandled Windows
`EBUSY` class in review-record's scratch cleanup as **unproven (gate)**, and
noted that `EBUSY` is not retried there (`docs/work/repo-80-land-records-one-command.md`).
`repo-31` has the downloader's `EBUSY` history: `tools/downloader/engine/src/ffmpeg/kill.ts`
documents the symptom as `EBUSY` on `rm -r tmp/<jobId>`
(`docs/work/repo-31-the-windows-leg-is-almost-all-red.md`).

## Build

The population is the three shim cleanups in `scripts/test/preflight.test.ts`,
the ones whose `finally` calls `fs.rmSync(shimDir, { recursive: true, force: true })`.
Their tests are "the CLI's --only mergeTree exits 16 on a failed probe and
prints no other check (repo-104)", "the CLI prints the probe's failure first and
exits 16 alone, with no suite started (repo-104)", and "the CLI never leaks
next-id.mjs's id-sweep wording when gh fails inside check 5". Grep for
`rmSync(shimDir` finds exactly those three before the change.

1. Move the three cleanups behind one helper in the same file. Only the helper
   may call `fs.rmSync` on a shim directory afterwards.
2. Make the helper tolerate a shim file still held on Windows. The mechanism is
   the builder's to measure: the `maxRetries` option is the candidate direction,
   and a bounded retry loop that catches `EBUSY` only is the other. Whichever is
   chosen must meet `Done when` 2 to 4, which are the bar against hiding a leak.
   Do not swallow every error from the helper. That would be the leak hidden.
3. Leave `plantFakeGh` alone. Changing the hard link to a copy, or anything else
   about how the shim is planted, is a different change with a different
   reproduction. If the retry measurement shows the image is still held, record
   it in the Log and file the cause separately.
4. The other `fs.rmSync(..., force: true)` calls in the same file, in `makeRepo`'s
   cleanup, the tool fixture and the origin/peer fixture, are outside this
   population. Do not change them in this ticket.
5. The fix is verified on Linux by the mutation in `Done when` 3. The Windows
   behaviour is verified only by the informational leg, and the Log says so.

## Done when

1. `grep -n "rmSync(shimDir" scripts/test/preflight.test.ts` finds one line, in
   the helper. The three tests named in Build call the helper, not `fs.rmSync`.
2. A named spec in `scripts/test/preflight.test.ts` makes the shim's removal
   throw `EBUSY` once and then succeed, and the test still passes. The Review
   table names the spec and its run.
3. A leak still fails on Linux, where no `EBUSY` can occur. With the helper's
   call removed from any one of the three tests, a spec that counts
   `preflight-ghshim-*` directories in `os.tmpdir()` before and after goes red.
   Read it with the call removed and with it restored, once per site: three
   red and three green readings, named.
4. Persistent `EBUSY` does not pass silently. When the injected removal throws
   on every attempt, the test fails, and the failure names the directory left
   behind.
5. The Windows leg on the pull request that builds this ticket reads
   `scripts/test/preflight.test.ts` passing on its head sha, by run id. The gate
   grades one green reading of an intermittent failure as such, not as a fix.
6. `npm run check` passes, and `npx vitest run scripts/test/preflight.test.ts`
   reports every test in the file passing, with its count.

## Log

- 2026-10-18 — Filed from a maintenance dispatch, on a branch cut from
  `origin/main` at `e40a506a`. Reproduction and the CI readings are in Why.
  - `node scripts/next-id.mjs repo` (re-run before the commit): last line
    `next free: repo-110`. Its `clash: repo-93 is claimed by
branch/repo-93-sqlite-file-tests-windows-timeout, merged` line names a
    merged ticket, not a held id.
  - `npm run build` at the base: exit 0.
  - `grep -n "rmSync(shimDir" scripts/test/preflight.test.ts` on the base: three
    matches, each `fs.rmSync(shimDir, { recursive: true, force: true });`, one
    per test named in Build.
  - `npx oxfmt docs/work/repo-110-file-preflight-shim-ebusy-windows.md`: exit 0.
  - `npm run status -- --show repo-110`: shows `ready`, `difficulty standard`,
    and `unblocked`.
  - Difficulty is `standard`. The change is one helper in one file. The judgement
    it needs is the leak bar in `Done when` 3 and 4, and the Windows behaviour can
    only be read on the informational leg. This rating was made by the builder
    from the format page's definitions, not from a measurement of a fix.
