---
id: repo-103
tool: repo
title: Concurrent local test runs each take every core, and nothing limits how many start at once
kind: work-package
status: ready
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
