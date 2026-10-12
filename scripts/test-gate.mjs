#!/usr/bin/env node
/**
 * A per-clone gate for the heavy test runs (repo-103).
 *
 *     node scripts/test-gate.mjs <command> [args...]
 *
 * Root `npm test` is `node scripts/test-gate.mjs vitest run`, so `npm test`,
 * `npm test -- --project <tool>` and every `npm test` preflight plans pass
 * through here. `vitest` as the command is resolved to the installed package's
 * own entry and run under this node, because a bare `vitest` is a `.cmd` shim
 * on Windows and cannot be spawned without a shell.
 *
 * **Why.** An orchestrator runs several builders and reviewers on one machine,
 * and every vitest starts `availableParallelism() - 1` workers whatever else is
 * running. Nothing knew about the other runs. The owner chose a mechanical gate
 * over assigning worker counts in prompts or over agents messaging each other
 * (repo-103's Why weighs all three): it needs no agent to coordinate and costs
 * no tokens.
 *
 * **What it does.**
 *  - Two runs hold a slot (`TEST_GATE_MAX`), one lock file per slot, in
 *    `<git-common-dir>/test-gate/`. `git rev-parse --git-common-dir` is the same
 *    directory for every worktree of one clone, and **only** for them: the gate
 *    limits the runs that share a clone's `.git`, not every run on the machine.
 *    A second clone has its own locks, and a lock written from another pid
 *    namespace (another container sharing the directory) names a pid this one
 *    cannot see, so it is always judged stale. A slot is claimed with an
 *    exclusive create, so two runs starting in the same instant cannot take the
 *    same one.
 *  - The child's `VITEST_MAX_WORKERS` is `max(1, floor((cpus - 1) / active))`,
 *    where `active` counts the live locks including this run's own, taken after
 *    a short settle so two runs started together both see each other. A lone run
 *    keeps every worker. **The count is fixed at start and nothing resizes a run
 *    going:** a run that starts alone keeps all 11 workers, so a second run that
 *    arrives more than the settle later gets 5 beside it, and the machine is
 *    oversubscribed (16 workers on 11 cores) for the whole time they overlap,
 *    not briefly. Measured (repo-103 gate 1): of 16 pairs launched 301 ms or
 *    more apart, 13 were 11 and 5 workers and 3 were 5 and 5, because the gap
 *    between two process launches is not the gap between their claims.
 *  - A third run waits, printing why every 15 s to stderr so an agent's Bash
 *    call does not look hung. The wait is bounded (`TEST_GATE_WAIT_MS`, 300 s)
 *    and ends in a run with one worker and **no slot**: it never deadlocks and
 *    never fails a run for having waited. So "at most two" holds only while
 *    runs are shorter than the wait, or a slot frees within it. A downloader
 *    run lasts minutes, so a third one that arrives while both others are
 *    mid-run usually reaches the fallback and then runs beside them; a
 *    one-worker downloader run took 1043 s here.
 *
 * **A lock records the pid and the process start time.** A pid alone proves
 * nothing, because pids are reused: the start time (field 22 of
 * `/proc/<pid>/stat`, in clock ticks since boot) is what tells the holder from
 * a stranger that inherited its number. A lock whose process is gone, or whose
 * start time differs, is stale and the next run reclaims it. The slot is
 * released on exit, on a signal, and when the child crashes. A SIGKILL on the
 * gate itself cannot be caught, so its lock stays until the next run finds it
 * stale. The child is in the gate's process group, not a group of its own
 * (repo-103 gate 1: a detached child survived a group SIGKILL), so a SIGKILL
 * sent to the group takes vitest with it; one sent to the gate's pid alone
 * leaves vitest running, uncounted.
 *
 * **Reclaiming a stale lock is serialised by a second exclusive file,**
 * `slot-N.lock.reclaim`. Re-reading a lock and then unlinking it is not atomic:
 * a run that had just judged the lock stale could unlink the fresh lock another
 * run created in between, and both then held one slot (measured: 7 of 60 trials
 * with a dead pid, 3 of 60 with two slots, before the guard). A run that cannot
 * take the guard leaves that slot to whoever holds it and tries the next. A
 * guard older than ten seconds belongs to a reclaimer that died and is removed.
 *
 * **It does nothing, and says nothing, when:**
 *  - `CI` is set. CI sizes its own workers (repo-99) and an environment variable
 *    would override that.
 *  - the caller set `VITEST_MAX_WORKERS` themselves.
 *  - `TEST_GATE_OFF=1`, the gate's own opt-out.
 *
 * **It runs the command straight through, saying so once,** where it cannot do
 * its job: no `/proc/<pid>/stat` (macOS, Windows), or no git repository to hold
 * the locks.
 *
 * **What it does not gate.** `npx vitest run <file>` is called directly by
 * agents and is not gated: those are the small runs (median 4 s) and one file
 * uses one worker anyway. `test:watch` is not gated. Everything project-wide
 * is: `npm test`, `npm test -- --project <tool>` and `npm run test:<tool>`.
 * A project-wide `npx vitest run --project <tool>` is a bypass, not a gated call.
 *
 * Preflight runs `npm test` with its output captured, so a wait message from a
 * preflight's test step reaches the log only when that step fails.
 *
 * `TEST_GATE_DIR`, `TEST_GATE_CPUS`, `TEST_GATE_MAX`, `TEST_GATE_WAIT_MS` and
 * `TEST_GATE_SETTLE_MS` exist so `scripts/test/test-gate.test.ts` can fix the
 * machine's shape; nothing else sets them.
 */

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOTICE_MS = 15_000;
const POLL_MS = 250;
/** A lock still being written (created, not yet filled) is live this long. */
const WRITING_GRACE_MS = 5_000;
/** After a signal, how long the child tree gets before it is killed outright. */
const KILL_GRACE_MS = 10_000;

/**
 * Field 22 of a `/proc/<pid>/stat` line: the process's start time. The command
 * name (field 2) is parenthesised and may itself hold spaces and parentheses,
 * so the line is split after its last `)`, where field 3 comes first.
 *
 * @param {string} stat
 * @returns {string | null}
 */
export function parseStartTime(stat) {
  const close = stat.lastIndexOf(")");
  if (close === -1) return null;
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/u);
  // Field 3 is the state. A zombie has exited and is only waiting to be reaped:
  // it runs nothing and holds no slot, and a parent that never reaps (a
  // container's pid 1) would otherwise keep its lock live for ever.
  if (fields[0] === "Z") return null;
  return fields[19] ?? null;
}

/**
 * The start time of a live process, or null when it is gone, a zombie, or unreadable.
 *
 * @param {number} pid
 * @returns {string | null}
 */
export function startTimeOf(pid) {
  try {
    return parseStartTime(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {number} cpus
 * @param {number} active runs holding a slot, this one included
 */
export function workersFor(cpus, active) {
  return Math.max(1, Math.floor((cpus - 1) / Math.max(1, active)));
}

/**
 * @param {{pid?: unknown, start?: unknown} | null} lock
 * @returns {boolean}
 */
export function holderIsAlive(lock) {
  if (lock === null || typeof lock.pid !== "number" || typeof lock.start !== "string") {
    return false;
  }
  return startTimeOf(lock.pid) === lock.start;
}

/**
 * Read one lock. A lock is stale when its file is unreadable, unparsable and
 * old, or names a process that is gone or has a different start time; `exists`
 * is false only when the path is missing (ENOENT), which tells a released lock
 * from a stale one. A file that cannot be read for any other reason still
 * exists, so a stale one is reclaimed rather than starving its slot. A file
 * that is empty or half-written but young is a claim in progress and counts as
 * live.
 *
 * @param {string} file
 * @returns {{live: boolean, pid: number | null, raw: string, exists: boolean}}
 */
function inspect(file) {
  let raw = "";
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      return { live: false, pid: null, raw: "", exists: false };
    }
    // Present but unreadable (mode 000, a directory): raw stays empty and the
    // mtime decides, so a young one is a claim in progress and an old one is stale.
  }
  /** @type {{pid?: unknown, start?: unknown} | null} */
  let lock = null;
  try {
    lock = JSON.parse(raw);
  } catch {
    // fall through: unparsable
  }
  if (lock === null) {
    return { live: Date.now() - mtimeMs < WRITING_GRACE_MS, pid: null, raw, exists: true };
  }
  return {
    live: holderIsAlive(lock),
    pid: typeof lock.pid === "number" ? lock.pid : null,
    raw,
    exists: true,
  };
}

/**
 * @param {string} dir
 * @returns {string[]} every slot file in `dir`, whatever the current cap
 */
function slotFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /^slot-\d+\.lock$/u.test(name))
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * @param {string} dir
 * @returns {number[]} the pids of runs that hold a live slot
 */
export function activeRuns(dir) {
  const pids = [];
  for (const name of slotFiles(dir)) {
    const state = inspect(path.join(dir, name));
    if (state.live) pids.push(state.pid ?? 0);
  }
  return pids;
}

/** A reclaimer that has held its guard this long is dead. */
const GUARD_STALE_MS = 10_000;

/**
 * Write a lock with an exclusive create.
 *
 * @param {string} file
 * @param {string} body
 * @returns {boolean} false when the file already exists
 */
function tryCreate(file, body) {
  try {
    const fd = fs.openSync(file, "wx");
    try {
      fs.writeSync(fd, body);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * @param {string} guard
 * @returns {boolean} whether this run now holds the guard
 */
function takeGuard(guard) {
  if (tryCreate(guard, String(process.pid))) return true;
  let age = 0;
  try {
    age = Date.now() - fs.statSync(guard).mtimeMs;
  } catch {
    return false; // released under us: let the next poll try
  }
  if (age < GUARD_STALE_MS) return false;
  try {
    fs.unlinkSync(guard);
  } catch {
    // someone else removed it first
  }
  return tryCreate(guard, String(process.pid));
}

/**
 * Take a free slot, reclaiming a stale one on the way. The create is exclusive,
 * so the filesystem picks the winner when two runs reach a free slot. A stale
 * lock is removed only by the run holding that slot's reclaim guard, which
 * re-reads the lock under it and unlinks only a file it found there and stale.
 * A file that exists and is stale cannot be replaced before the unlink: the
 * path is free to a new claim only once it is gone, and the only runs that
 * remove a stale lock hold the guard, which this run does. A missing file is
 * not unlinked, because whatever is at that path next is someone's live lock.
 *
 * @param {string} dir
 * @param {number} cap
 * @returns {string | null} the lock file taken, or null when every slot is held
 */
export function claimSlot(dir, cap) {
  const body = JSON.stringify({
    pid: process.pid,
    start: startTimeOf(process.pid),
    cwd: process.cwd(),
    at: new Date().toISOString(),
  });
  for (let slot = 0; slot < cap; slot += 1) {
    const file = path.join(dir, `slot-${slot}.lock`);
    if (tryCreate(file, body)) return file;
    if (inspect(file).live) continue;
    const guard = `${file}.reclaim`;
    if (!takeGuard(guard)) continue;
    try {
      // Unlink only a file that is there and stale. A missing one was released
      // after the first create failed, and anything now at that path was put there
      // by a run that is not us: unlinking it would delete a live lock.
      const state = inspect(file);
      if (state.exists && !state.live) {
        try {
          fs.unlinkSync(file);
        } catch {
          // already gone
        }
      }
      if (tryCreate(file, body)) return file;
    } finally {
      fs.rmSync(guard, { force: true });
    }
  }
  return null;
}

/**
 * Give a slot back, but only if it is still ours: a stale lock this process
 * once held may since have been reclaimed by another.
 *
 * @param {string} file
 */
export function releaseSlot(file) {
  try {
    const lock = JSON.parse(fs.readFileSync(file, "utf8"));
    if (lock.pid === process.pid) fs.unlinkSync(file);
  } catch {
    // already gone
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} message */
function say(message) {
  process.stderr.write(`test-gate: ${message}\n`);
}

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 */
function intFrom(raw, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Where the locks live: the directory every worktree of this repository
 * shares, or null outside a repository.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function lockDirectory(env) {
  if (env.TEST_GATE_DIR) return env.TEST_GATE_DIR;
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || result.error) return null;
  return path.join(path.resolve(result.stdout.trim()), "test-gate");
}

/**
 * `vitest` as a command means the installed package's own entry under this
 * node. Anything else is spawned as written.
 *
 * @param {string[]} argv
 * @returns {[string, string[]]}
 */
function resolveCommand([command, ...args]) {
  if (command !== "vitest") return [command, args];
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("vitest/package.json");
  const bin = JSON.parse(fs.readFileSync(manifest, "utf8")).bin.vitest;
  return [process.execPath, [path.join(path.dirname(manifest), bin), ...args]];
}

/**
 * Every descendant of `root`, by walking parent pids in /proc. Empty where
 * /proc cannot be read.
 *
 * @param {number} root
 * @returns {number[]}
 */
export function descendantsOf(root) {
  /** @type {Map<number, number[]>} */
  const children = new Map();
  let names;
  try {
    names = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  for (const name of names) {
    if (!/^\d+$/u.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const list = children.get(ppid) ?? [];
      list.push(Number(name));
      children.set(ppid, list);
    } catch {
      // gone while we looked
    }
  }
  const found = [];
  const stack = [root];
  for (let pid = stack.pop(); pid !== undefined; pid = stack.pop()) {
    for (const child of children.get(pid) ?? []) {
      found.push(child);
      stack.push(child);
    }
  }
  return found;
}

/**
 * Signal a child and everything under it. The child stays in the gate's own
 * process group (it is not detached), so a signal to the group from outside
 * reaches vitest without this process's help. When the signal reaches only
 * this process, the tree is found by walking /proc, deepest first so a parent
 * cannot respawn what was just killed. Windows has no groups, and
 * `taskkill /T /F` is the tree kill.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {NodeJS.Signals} signal
 */
function killTree(child, signal) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
    });
    return;
  }
  for (const pid of [...descendantsOf(child.pid).toReversed(), child.pid]) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

const SIGNAL_NUMBERS = /** @type {const} */ ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 });

/**
 * Run the command with the given extra environment, forwarding signals to its
 * whole tree. Resolves with the exit code to leave with.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {(() => void) | null} release called once the child is gone
 * @returns {Promise<number>}
 */
function runChild(argv, env, release) {
  const [command, args] = resolveCommand(argv);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
      shell: false,
    });
    /** @type {NodeJS.Signals | null} */
    let forwarded = null;
    /** @type {NodeJS.Timeout | null} */
    let escalate = null;
    /** @type {Array<[NodeJS.Signals, () => void]>} */
    const handlers = [];
    for (const signal of /** @type {NodeJS.Signals[]} */ (Object.keys(SIGNAL_NUMBERS))) {
      const handler = () => {
        forwarded = signal;
        killTree(child, signal);
        escalate ??= setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
      };
      handlers.push([signal, handler]);
      process.on(signal, handler);
    }
    let finished = false;
    const finish = (/** @type {number} */ code) => {
      if (finished) return;
      finished = true;
      if (escalate) clearTimeout(escalate);
      for (const [signal, handler] of handlers) process.off(signal, handler);
      release?.();
      // oxlint-disable-next-line promise/no-multiple-resolved
      resolve(code); // guarded by `finished`: "error" and "close" can both fire
    };
    child.on("error", (error) => {
      say(`could not start ${command}: ${error.message}`);
      finish(127);
    });
    child.on("close", (code, signal) => {
      if (code !== null) finish(code);
      else finish(128 + (os.constants.signals[forwarded ?? signal ?? "SIGKILL"] ?? 9));
    });
  });
}

/**
 * @param {string[]} argv the command to run, `vitest run ...`
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, env = process.env) {
  if (argv.length === 0) {
    say("usage: node scripts/test-gate.mjs <command> [args...]");
    return 2;
  }
  const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "false" && env.CI !== "0";
  if (ci || env.VITEST_MAX_WORKERS || env.TEST_GATE_OFF === "1") {
    return runChild(argv, env, null);
  }
  if (startTimeOf(process.pid) === null) {
    say(`cannot read process start times on ${process.platform}; running without a gate`);
    return runChild(argv, env, null);
  }
  const dir = lockDirectory(env);
  if (dir === null) {
    say(
      "not inside a git repository, so there is nowhere shared to keep locks; running without a gate",
    );
    return runChild(argv, env, null);
  }
  fs.mkdirSync(dir, { recursive: true });

  const cap = Math.max(1, intFrom(env.TEST_GATE_MAX, 2));
  const cpus = intFrom(env.TEST_GATE_CPUS, os.availableParallelism()) || 1;
  const waitMs = intFrom(env.TEST_GATE_WAIT_MS, 5 * 60_000);
  const settleMs = intFrom(env.TEST_GATE_SETTLE_MS, 300);

  const started = Date.now();
  let lastNotice = -Infinity;
  /** @type {string | null} */
  let slot = null;
  while (slot === null) {
    slot = claimSlot(dir, cap);
    if (slot !== null) break;
    const waited = Date.now() - started;
    if (waited >= waitMs) break;
    if (Date.now() - lastNotice >= NOTICE_MS) {
      lastNotice = Date.now();
      const pids = activeRuns(dir);
      say(
        `waiting for a test slot: ${pids.length} runs active (pids ${pids.join(", ")}); ` +
          `waited ${Math.round(waited / 1000)} s of at most ${Math.round(waitMs / 1000)} s`,
      );
    }
    // oxlint-disable-next-line no-await-in-loop
    await sleep(POLL_MS);
  }

  if (slot === null) {
    say(
      `no test slot after ${Math.round((Date.now() - started) / 1000)} s; ` +
        "running anyway with 1 worker and no slot",
    );
    return runChild(argv, { ...env, VITEST_MAX_WORKERS: "1" }, null);
  }

  const held = slot;
  // Released on every way out: the child's end, a signal while settling, and
  // this process dying of anything catchable.
  process.on("exit", () => releaseSlot(held));
  /** @type {Array<[NodeJS.Signals, () => void]>} */
  const settling = [];
  for (const signal of /** @type {NodeJS.Signals[]} */ (Object.keys(SIGNAL_NUMBERS))) {
    const handler = () => {
      releaseSlot(held);
      process.exit(128 + SIGNAL_NUMBERS[/** @type {keyof typeof SIGNAL_NUMBERS} */ (signal)]);
    };
    settling.push([signal, handler]);
    process.on(signal, handler);
  }
  // Let a run started in the same instant claim its slot before counting, so
  // both size themselves for two.
  await sleep(settleMs);
  for (const [signal, handler] of settling) process.off(signal, handler);

  const pids = activeRuns(dir);
  const active = Math.max(1, pids.length);
  const workers = workersFor(cpus, active);
  say(
    `${path.basename(held, ".lock")}, ${active} of ${cap} runs active ` +
      `(pids ${pids.join(", ")}): ${workers} workers`,
  );
  return runChild(argv, { ...env, VITEST_MAX_WORKERS: String(workers) }, () => releaseSlot(held));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
