---
id: repo-103
tool: repo
title: Concurrent local test runs each take every core, and nothing limits how many start at once
kind: work-package
status: done
milestone: null
depends_on: [repo-102]
difficulty: standard
---

# repo-103 — Concurrent local test runs each take every core

## Why

An orchestrator runs several builders and reviewers on one machine. Today every
`npm test` and every preflight run starts vitest with its default worker count,
`availableParallelism() - 1`, which is 11 workers on the 12-core devcontainer.
Nothing knows about the runs already going.

**Measured on 2026-10-12** from about 4,000 test runs in the session transcripts
since 2026-09-20, covering test commands that agents ran in the foreground:

| Runs active at once | Share of test-active time |
| ------------------- | ------------------------- |
| 1                   | 83%                       |
| 2                   | 13.6%                     |
| 3                   | 3.1%                      |
| 4                   | 0.5%                      |
| 5 or more           | never                     |

Heavy runs (preflight, `--project`, the full suite) overlapped for about 10% of
their time. So contention is real but occasional. It will grow after
[dl-117](../../tools/downloader/docs/work/dl-117-split-browser-resolver-test-so-one-file-is-not-the-whole-run.md):
splitting the browser file means one downloader run starts about five Chromiums
instead of one. On this 15 GB machine, four such runs at once is where memory
becomes the limit (inferred, not measured).

**The owner's decision, 2026-10-12, with the options weighed:**

- **Chosen: a mechanical, machine-wide gate** that every heavy run passes
  through.
- **Rejected: the orchestrator assigns worker counts in its prompts.** That
  fixes the split at dispatch time, sees neither other orchestrators nor the
  owner's own runs, and wastes cores for the 83% of the time only one run is
  active.
- **Rejected: orchestrators message each other to schedule tests.** Sessions
  read messages only between turns. A message to an idle agent resumes its whole
  transcript, session names have collided before, and a dead session never
  releases what it held.

The gate needs no agent to coordinate and costs no tokens.

## Build

1. **`scripts/test-gate.mjs`** wraps a test command. Root `package.json` becomes
   `"test": "node scripts/test-gate.mjs vitest run"`, or an equivalent. Preflight's
   `testPlan` commands reach it through `npm test`, so they are gated without
   changing them.
   - Check that preflight's npm guard (repo-82) and `deriveExtraCiCommands`' pinned
     output still hold.
   - The `npx vitest run <file>` calls agents make directly are not gated. They
     are the small runs (median 4 s) and a single file uses one worker anyway.
     The script's header comment says so.
2. **Slots.** Use one lock file per active run, in a directory every worktree
   shares. `git rev-parse --git-common-dir` is the same for all worktrees of
   this repository.
   - Each lock records the **pid and the process start time**: field 22 of
     `/proc/<pid>/stat` on Linux. **A pid alone proves nothing**, because pids
     are reused.
   - A lock whose process is gone, or whose start time differs, is stale.
     Reclaim it.
   - Release the slot on exit, on a signal, and on a crash of the child.
3. **Sizing.** At start, set `VITEST_MAX_WORKERS` in the child's environment to
   about `max(1, floor((availableParallelism() - 1) / (active + 1)))`. vitest
   4.1.10 reads that variable and lets it override the config (`coverage.*.js`:
   `if (process.env.VITEST_MAX_WORKERS) resolved.maxWorkers = …`).
   - A lone run keeps all 11 workers.
   - A run started third gets about 3.
   - The count is fixed at start. Do not try to resize a running vitest.
4. **Cap.** At most **two** gated runs at once. A third waits for a slot.
   - **It must print why it waits**: "waiting for a test slot: 2 runs active
     (pids …)", every 15 s or so. An agent's Bash call otherwise looks hung.
   - **The wait is bounded**, at about 5 minutes, well inside the 10-minute
     Bash ceiling. After that, run anyway with one worker and say so. Never
     deadlock, and never fail a run for having waited.
5. **Off switches.**
   - **Do nothing when `CI` is set.** repo-99 sets CI's own `maxWorkers`, and an
     environment variable would override it.
   - **Do nothing when the caller set `VITEST_MAX_WORKERS` themselves.**
   - Give the gate its own opt-out variable, documented in the header.
   - On a platform where the start time cannot be read, do not gate. Run the
     command straight through and say so once.
6. **Repository rules that apply:**
   - spawn with an argument array and `shell: false` (the scan in
     `packages/core/test/spawn-safety.test.ts` enforces it);
   - forward Ctrl-C to the child's process tree, not just the child;
   - no `console` in source that the logger rule covers. Check whether
     `scripts/` follows it, and match what the other scripts do.
7. **Tests** in `scripts/test/test-gate.test.ts` (the `repo` project):
   - two concurrent fake runs get split worker counts;
   - a third run waits, then proceeds when a slot frees;
   - the bounded wait expires into a one-worker run;
   - a stale lock is reclaimed, both for a dead pid and for a reused pid with a
     different start time;
   - under `CI` the child's environment has no `VITEST_MAX_WORKERS` added;
   - a caller's own `VITEST_MAX_WORKERS` passes through untouched.

   Fake the child command, so the tests spawn no real vitest.

## Done when

1. Two local `npm test -- --project planner` runs started together each get
   about half the workers. A third waits with a visible message and then runs.
   Proof: the three outputs in the Log.
2. A run killed with SIGKILL leaves a lock that the next run reclaims. A test
   proves it.
3. On CI the gate changes nothing. Proof: the PR's CI run shows the same
   worker behaviour as `main`, and repo-99's setting is still in effect.
4. The tests listed in step 7 pass, and `npm run check` passes.

## Review

**Gate: FAIL** — 2026-10-12 · `0484ae71..148b67a2` · Opus 5.5, depth full

| Done when                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Two `npm test -- --project downloader` runs started together each get about half; a third waits visibly, then runs | **unproven**: nobody ran the line as written. The Log ran it with `--project planner`, and this gate re-ran it the same way (`two-real.mjs <tree> <lockdir> 3 0 planner`: 5, 5 and 11 workers, with pool-process peaks of 6, 6 and 12; 1305/1305 tests each; load average 5.1 to 11.2). The downloader version was not run because the dispatch forbids concurrent downloader runs. On the downloader it would also behave differently: a run lasts longer than the 300 s wait, so the third run never gets a slot. It falls back to 1 worker and runs alongside the other two (see the second high finding below).                                                                                  |
| 2. A run killed with SIGKILL leaves a lock the next run reclaims; a test proves it                                    | `scripts/test/test-gate.test.ts` › "a run killed with SIGKILL leaves a lock the next run reclaims" ✓. After the kill, the lock is still there and its holder has a null start time. The next run gets `workers` "11" and holds `slot-0`. A mutant that treats every lock as live turns this test red, along with the dead-pid and reused-pid tests.                                                                                                                                                                                                                                                                                                                                                  |
| 3. On CI the gate changes nothing (same worker behaviour as `main`; repo-99's setting still in effect)                | **verified** from PR #454's run on `148b67a2`, compared with main's push run on `0484ae71`. On ubuntu: 535.68 s against 528.33 s, and the tests-time to duration ratio is 1.91 against 1.86. On Windows: 560.08 s against 548.45 s, ratio 2.29 against 2.23. Neither leg prints a `test-gate:` line. "under CI the child's environment gains no worker count and no lock is taken" ✓, and a mutant that adds a worker count under CI turns it red. The repo-99 clause has nothing to check: repo-99 is `status: ready`, and `vitest.config.ts` and `.github/workflows/` contain no `maxWorkers`. **The Windows leg is red on this head**, from the dl-98 throughput ratio (see the ci bullet below). |
| 4. Step 7's tests pass, and `npm run check` passes                                                                    | Proven: `npx vitest run scripts/test/test-gate.test.ts` gives 22 of 22, and `npm run check` exits 0. Step 7's six tests are covered by these: "a run started beside another gets half the workers and says so" together with "a run started during another's settle is counted before it sizes itself"; "a third run waits with a message, then proceeds when a slot frees"; "the bounded wait expires into a one-worker run with no slot"; "a lock whose process is gone is reclaimed"; "a lock whose pid was reused by another process is reclaimed"; "under CI the child's environment gains no worker count and no lock is taken"; "a worker count the caller set passes through untouched".     |

- **high** · No `Done when` line depends on it. When two runs reclaim the same stale lock, both can end up holding one slot, and the comment above `claimSlot` in `scripts/test-gate.mjs` understates what happens. The comment says "the worst outcome is a third concurrent run sized for two". Measured: both runs claim `slot-0`, each one counts only itself, both get 11 workers, and `slot-1` stays free for a third run. Reproduction: `node reclaim2.mjs <tree> <outdir> 60 dead`, run with `CAP=2` from this gate's scratch directory. That gives "3 of 60 trials ran both at once", with both runs printing `test-gate: slot-0, 1 of 2 runs active (pids 1470444): 11 workers`. With `TEST_GATE_MAX=1` (`reclaim.mjs`) the counts were: dead pid 7 of 60, empty file 1 of 30, garbage 1 of 30, reused pid 1 of 30. Cause: one run re-reads the lock and is about to unlink it, while the other unlinks the stale lock and creates its own. The first run's unlink then deletes the live lock. Fix: either reclaim with an atomic `rename` to a per-run name and check the moved content, or rewrite the comment so it states the outcome measured here.
- **high** · No `Done when` line depends on it. Shipped text claims limits the code does not keep. (a) The new `CLAUDE.md` line says "at most two run at once on a machine". After the 300 s wait a third run starts anyway with one worker, which is what the brief asked for. With the downloader project, a third run always reaches that fallback: a one-worker downloader run took 1043 s wall here, and an 11-worker one takes around nine minutes. The first high finding is a second way past the limit. "On a machine" is also too broad: the lock directory belongs to one clone's `.git`, and a lock written from another pid namespace is always judged stale. (b) The header says "a late arrival briefly oversubscribes the machine". Over 96 trials (`race.mjs`), whenever the second run started 300 ms or more after the first, the first kept 11 workers and the second got 5, for 16 in total. That lasts for the whole time the two runs overlap, not briefly.
- **med** · No `Done when` line depends on it. A `SIGKILL` sent to the run's process group no longer stops vitest. `runChild` uses `detached: true`, which puts vitest in a new session. Reproduction: `sig.mjs <tree> <lockdir> group SIGKILL 5000 npm test -- --project planner` leaves "survivors after 4000 ms: 3" (vitest, esbuild and a worker) and keeps `slot-0.lock`. The same command with `npx vitest run --project planner` (how `main` runs it) leaves "survivors after 4000 ms: 0". Ctrl-C works: SIGINT to the group leaves 0 survivors and an empty lock directory. So does SIGTERM sent to npm's pid alone. The open question is whether the group kill matters more than the detach.
- **med** · No `Done when` line depends on it. The brief's Decision says every heavy run passes through the gate. But `npx vitest run --project <tool>` with no file named is not gated, and it is heavy. The brief only exempted `npx vitest run <file>`. In 651 transcripts (56,644 Bash calls, counted by `callers3.mjs`) there are 264 such calls, against 808 `npm test` calls and 0 `npm run test:<tool>` calls. This finding and open decision 7 are one decision; the options are in the report.
- **low** · If the lock directory cannot be written, every `npm test` crashes without running a test. Reproduction: `chmod 555 <dir>; TEST_GATE_DIR=<dir> node scripts/test-gate.mjs node fake-child.mjs` fails with `Error: EACCES ... at claimSlot`, exit 1, and the child never runs. One run as root would leave `.git/test-gate` root-owned with mode 755 and trigger this. No such run has been seen.
- **low** · The tests catch some mutants only on some runs. A non-atomic claim (check, then write) fails "two runs started together never take the same slot" in 1 of 40 runs (`repeat.sh`). It fails 1 of 1 when the gap is widened to 100 ms. Removing the settle fails the settle test in 8 of 11 runs. The real claim is `openSync(file, "wx")` (O_EXCL), which is atomic, so nothing is broken today.
- **low** · No test runs the Windows `taskkill /T /F` branch of `killTree`. Every signal test is skipped off Linux, and the Windows CI leg only reaches the gate under `CI`.
- **low** · `nfr:reliability`. When `npm test` runs inside preflight, its wait is invisible. `runBuildCommand` captures the output, so each `npm test` step can sit silent for up to 300 s and then run with one worker. `preflight-wait.mjs` (a 32 s bound) gives `returned ok=true after 36.7 s`, and the three wait lines are captured and then thrown away. The header documents this. Preflight runs in the background (`common.md`), so it does not hit the Bash time limit. But a downloader step that reaches the fallback costs about 300 s + 1043 s.
- **ci** · `test (windows-latest, informational)` is red on `148b67a2`. The cause is `tools/downloader/engine/test/parallel-ranges.test.ts` › "a job that measures slow switches to 4 connections and finishes at least 3x faster": `expected 2.9703552721809867 to be greater than or equal to 3`. Not attributed to this branch: the leg was green on four recent runs that don't include the gate, and dl-98's own record shows this ratio drops under load. Unverified.
- **dropped** · A run keeps the worker count it computed at its start, even after other runs end or begin. The brief asks for exactly that ("Do not try to resize a running vitest"), so it is design, not a defect. Its wording is covered in the second high finding.
- **dropped** · A signal arriving between `claimSlot` returning and the settle handlers being registered leaves a stale lock. That gap is synchronous code, and the next run reclaims the lock. Negligible.
- **findings** · The hunt returned 11: 9 carried (one is the red CI leg) and 2 dropped.
- Invariants: no shell ✓. `spawn-safety.test.ts` turns red on `shell: true` and on a missing `shell: false` in `scripts/test-gate.mjs`. Process-tree kill: ✓ on POSIX (a child-only mutant fails "a signal reaches the child's whole tree"); Windows is untested (low finding above). Style ✓ (`npm run check` exit 0, no lint line for these files). Test registration ✓ (`scripts/test/tsconfig.json`). Skipped as not applicable: contract, AppError, redaction, SSRF, progress, Dockerfile.
- NFR: security: the low finding about the unwritable lock directory; the lock records only pid, start time, cwd and timestamp. Performance: the split measured as intended (5/5 together, 16 workers when the starts are staggered, against 22 before). Reliability: the first high and the SIGKILL med. Maintainability: the second high.

## Log

- 2026-10-12 — Filed from the suite-speed discussion. Depends on repo-102 only
  because repo-101 and repo-102 change how preflight invokes `npm test`.
  Building it after them avoids rebasing the same lines three times. The
  overlap figures exclude runs started in the background and the owner's own
  terminal runs, so they understate contention somewhat.

- 2026-10-12 — Built (`scripts/test-gate.mjs`, `scripts/test/test-gate.test.ts`, root
  `test` script). Measured on the shared 12-core machine at a load average of 13 to 19,
  four other builders running, so the durations below are noise-inflated and only the
  worker counts and the waiting are the result.
  - **Done when 1.** Three `npm test -- --project planner` runs, started at 0 s, 0 s and
    2 s (planner rather than downloader: the same path through `npm test`, without five
    minutes of Chromium on a busy box). Output lines, from the three logs:
    - run 0: `test-gate: slot-0, 2 of 2 runs active (pids 1218694, 1218688): 5 workers`
    - run 1: `test-gate: slot-1, 2 of 2 runs active (pids 1218694, 1218688): 5 workers`
    - run 2: three lines `test-gate: waiting for a test slot: 2 runs active (pids 1218694,
1218688); waited 0 s | 15 s | 30 s of at most 300 s`, then
      `test-gate: slot-1, 1 of 2 runs active (pids 1219098): 11 workers`.
    - All three ended `Test Files 77 passed (77)`, `Tests 1305 passed (1305)`. A process
      sampler counted the vitest worker processes under each run at its peak: 6 under
      each of the first two, 12 under the third and, alone, 12 under a lone run. That
      count includes one process that is not a pool worker (11 + 1, 5 + 1), so the
      ratio is the evidence, not the absolute figure. Wall time: 36.9 s and 36.8 s for
      the two sharing runs, 15.4 s of run time for the third once alone, 13.2 s for a lone
      run measured first; the sharing runs are slower per run and the box was loaded.
  - **Done when 2.** `scripts/test/test-gate.test.ts`, "a run killed with SIGKILL leaves a
    lock the next run reclaims". It also asserts the lock is still there after the kill,
    held by a pid that no longer exists, so the reclaim is the next run's doing.
  - **Done when 3 is not measurable from the branch.** Locally, "under CI the child's
    environment gains no worker count and no lock is taken" proves `CI=true` adds nothing
    and prints nothing, and "`vitest` resolves to the installed package and runs" proves
    the CI path still reaches a real vitest. The comparison with `main`'s CI run is the
    PR's CI, which the gate has not seen yet. repo-99 is not on `main` (no `maxWorkers`
    in `vitest.config.ts` or `ci.yml` at 07acbb86), so there is no setting of it to
    check survives; the gate's `CI` branch never touches the child's environment.
  - **Mutations**, each making the named test fail and the rest pass: comparing only
    "is the pid alive" fails the reused-pid test; signalling the child's pid instead of
    its group fails the process-tree test (its grandchild survives).
  - **The brief had nothing wrong that mattered.** Two adjustments, both to the
    mechanism and not to the contract: the settle (300 ms, then count) is not in the
    brief but is what makes "two runs started together each get half" true, since
    otherwise the first to claim counts one and keeps all 11; and `vitest` is spawned as
    `process.execPath` plus the package's `bin` entry, because a bare `vitest` is a
    `.cmd` shim on Windows that `shell: false` cannot start, and the gate wraps
    `npm test` on the Windows CI leg too.
  - **Other things that came up.** Preflight runs `npm test` with its output captured,
    so a wait message from a preflight test step is shown only if that step fails; the
    wait still ends in 5 minutes, so it cannot hang. A SIGKILL on the gate frees its slot
    while the vitest it started keeps running; the gate cannot catch that signal and
    the next run does not count the orphan. (Round 1 narrows this: a SIGKILL to the
    process group now takes vitest too; one to the gate's pid alone still orphans it.)
  - **Not folded in (superseded by the owner's answer 4 in the round-1 entry below):**
    `test:downloader`, `test:planner`, `test:ledger` and `test:repo` called
    `vitest run --project …` directly and were not gated. They are gated in round 1.

- 2026-10-12 — Round 1, after gate 1 at 148b67a2 (FAIL: two highs, two meds, four lows).
  The owner answered four questions through the orchestrator the same day, each the
  recommended option. Measurements below use a private `TEST_GATE_DIR` and gate 1's
  scripts (`reclaim.mjs`, `reclaim2.mjs`, `sig.mjs`), run from its scratch directory
  against this worktree. Load average 1 to 28 while they ran.
  - **Answer 1, Done when 1 reworded to `--project planner`.** Options: reword to planner,
    a gate runs the downloader as written, the owner runs it. The line now names
    `npm test -- --project planner`; its proof is the planner runs of the first entry above
    (5, 5 and 11 workers, 1305 of 1305 each) and gate 1's `two-real.mjs` run (5, 5 and 11,
    1305 of 1305 each). A downloader run lasts longer than the wait, so its third run would
    take the one-worker fallback; that is the wait bound below, not a defect.
  - **High 1, two runs reclaiming one stale lock both held the slot.** Reproduced by
    gate 1 (3 of 60 two-slot trials, 7 of 60 one-slot with a dead pid) and traced to
    re-read-then-unlink: the run about to unlink deletes the fresh lock the other run
    just created. Fixed atomically: a stale lock is removed only by the run holding
    `slot-N.lock.reclaim`, an exclusive-create guard, and a run that cannot take it leaves
    the slot to the holder and tries the next. A guard older than 10 s is a dead
    reclaimer's and is removed. After:
    `CAP=2 node reclaim2.mjs … 60 dead` gives `0 of 60 trials ran both at once`;
    `reclaim.mjs` (one slot) gives 0 of 60 dead, 0 of 30 empty, 0 of 30 garbage,
    0 of 30 reused pid. Tests: "a stale lock another run is reclaiming is left to it"
    (fails with the guard check removed), "a guard left by a reclaimer that died is
    removed, and the slot reclaimed", "the guard is not left behind by a reclaim". The
    "before" figures are gate 1's; I did not re-run the old tree.
  - **High 2, answer 2: keep 300 s and fix the text.** The script header and a new
    paragraph under the root `CLAUDE.md` commands now say that two runs hold a slot, that
    a third waits up to 300 s and then runs with one worker and no slot, that the lock is
    per clone (in its `.git`, and a lock from another pid namespace is always stale) and
    not per machine, and that a late arrival oversubscribes for the whole overlap. The
    header's "briefly" and "machine-wide" are gone, and the one-worker downloader figure
    (1043 s, gate 1) is recorded there.
  - **Med, answer 3: dropped `detached` on POSIX.** `sig.mjs <tree> <dir> group SIGKILL 5000
npm test -- --project planner` now gives `survivors after 4000 ms: 0`; the
    lock stays (SIGKILL cannot be caught) and is reclaimed by the next run. SIGINT and
    SIGTERM to the group: 0 survivors and an empty lock directory. SIGTERM forwarding walks
    `/proc` for the child's descendants; Windows keeps `taskkill /T /F`. Test: "a SIGKILL to
    the gate's process group leaves nothing running" (fails when `detached: true` is put
    back). SIGTERM or SIGKILL to npm's pid alone still leaves the run going, as it does
    on `main` with no gate: `AFTER_MS=60000 sig.mjs … pid SIGTERM` gives `survivors … 0`
    and an empty lock directory because the run finishes and releases its slot. One
    related fix: a zombie holder (exited, unreaped, as under a container's pid 1) read as
    alive from `/proc/<pid>/stat`; `startTimeOf` now treats state `Z` as gone.
  - **Med, answer 4: the `test:<tool>` scripts go through the gate.** `test:downloader`,
    `test:planner`, `test:ledger` and `test:repo` are `node scripts/test-gate.mjs vitest run
--project <tool>`; `npm run test:<tool> -- no-such-file-anywhere` prints
    `test-gate: slot-0, 1 of 2 runs active (pids …): 11 workers` for each of the four.
    In the root `CLAUDE.md` the package-wide line is now `npm test -- <package-dir>`
    (replacing `npx vitest run <package-dir>`) and `npx vitest run <spec-file>` is named as
    the one ungated call. `npx vitest run --project <tool>` stays an unguarded bypass, which
    the header says.
  - **Lows left recorded, not fixed:** an unwritable lock directory crashes `npm test`;
    two mutants are caught only on some runs; no test runs the Windows `taskkill` branch;
    a preflight test step's wait is invisible. The red Windows `dl-98` ratio on 148b67a2 is
    not attributed to this branch.

- 2026-10-12 — Round 2, after gate 2 at 98e3772a (FAIL: one new high from round 1's lines,
  two lows). The gate withdrew its gate-1 reading of SIGTERM to npm's pid alone, so the
  round-1 claim ("the same as `main`") stands.
  - **High, a missing file was unlinked under the guard.** Reproduced with gate 2's
    `release-race.mjs` against a copy of the tree with both busy-waits planted
    (`MUTANT_GAP0_MS=1000 MUTANT_GAP_MS=1000`): before, `A said: test-gate: slot-0, 1 of 1
runs active (pids 1836946): 11 workers`, `slot-0 after A finished: (none)`, `files: []`.
    `inspect` reported a missing file as `live: false`, so a run that claimed the slot between
    the guarded re-read and the unlink lost its lock. Fixed in code, which makes the
    comment true: `inspect` now says `exists`, and the guard holder unlinks only a file it
    found there and stale. That is sound: a path becomes free to a new claim only once it is
    gone, and the only removals of a stale lock hold the guard, so a stale file that exists
    cannot be replaced before the unlink. After, the gap now sits right after the guarded
    re-read (the unlink it used to sit before no longer runs for a missing file), with
    `TEST_GATE_WAIT_MS=3000` so A's wait is short: A waits (`waiting for a test slot: 1 runs
active`), then falls back (`no test slot after 3 s; running anyway with 1 worker and no
slot`), and `slot-0 after A finished: {"pid":…,"who":"second run"}` is the second run's
    lock, intact. Test: "a lock released mid-reclaim is not unlinked after another run has
    claimed it" (makes the claim at the guarded re-read, by wrapping `fs.readFileSync`); with
    `if (state.exists && !state.live)` reverted to `if (!state.live)` it fails, with the zombie
    mutant alongside it: `2 failed | 26 passed (28)`. `reclaim2.mjs` (two slots, 60 dead) and
    `reclaim.mjs` (one slot: 60 dead, 30 empty, 30 garbage, 30 reused pid) all give `0 of N
trials ran both at once`.
  - **Low, the zombie rule had no test.** The `Z` check moved into `parseStartTime`, where
    a stat-line fixture can reach it (a holder cannot be made a zombie from a test, since
    node reaps what it spawns). Test: "a zombie has no start time: it has exited and holds
    nothing"; fails with the check removed.
  - **Low, the header misquoted gate 1.** It now reads: of 16 pairs launched 301 ms or more
    apart, 13 were 11 and 5 workers and 3 were 5 and 5. "A third downloader run always
    reaches the fallback" now says "usually", and that a slot freeing within 300 s gives the
    third run a slot.
  - **Left recorded, unfixed:** the guard double-delete (two runs removing the same
    10 s-old guard); round 1's four lows.

- 2026-10-12 — Fixed at landing, the owner's decision, no re-gate: gate 3's low (`inspect`
  in `scripts/test-gate.mjs` set `exists: false` on any read error, so a stale lock the gate
  could not read, mode 000 for one, was never unlinked and its slot starved). `exists` is
  now false only on `ENOENT`; any other failure leaves it true with an empty `raw` and the
  mtime deciding, and the JSDoc says so. Before:
  `starve.sh <tree> a5b72ab9 98e3772a` printed, for the unreadable lock at a5b72ab9,
  `no test slot after 2 s; running anyway with 1 worker and no slot` and
  `left: ["slot-0.lock"]`. After, `starve.mjs` on this tree prints
  `unreadable: exit 0; test-gate: slot-0, 1 of 1 runs active (pids 1939658): 11 workers`
  (its trailing `chmod` throws `ENOENT` because the gate released the reclaimed file, the
  script's own artifact). New test "a stale lock this user cannot read is reclaimed, not
  left to starve its slot" fails with the fix reverted (`expected undefined` for the
  slot-0 pid) and `npx vitest run scripts/test/test-gate.test.ts` gives 29 passed (29)
  with it. A directory in the slot's place still starves, as on both earlier heads. The
  other recorded lows stay unfixed.
