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

1. Two local `npm test -- --project downloader` runs started together each get
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
