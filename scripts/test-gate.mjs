#!/usr/bin/env node
/**
 * A machine-wide gate for the heavy test runs (repo-103).
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
 *  - Two slots (`TEST_GATE_MAX`), one lock file per slot, in
 *    `<git-common-dir>/test-gate/`. `git rev-parse --git-common-dir` is the same
 *    directory for every worktree of this repository, which is what makes the
 *    gate machine-wide rather than per-checkout. A slot is claimed with an
 *    exclusive create, so two runs starting in the same instant cannot take the
 *    same one.
 *  - The child's `VITEST_MAX_WORKERS` is `max(1, floor((cpus - 1) / active))`,
 *    where `active` counts the live locks including this run's own, taken after
 *    a short settle so two runs started together both see each other. A lone run
 *    keeps every worker. The count is fixed at start: a run already going is
 *    never resized, so a late arrival briefly oversubscribes the machine.
 *  - A third run waits, printing why every 15 s to stderr so an agent's Bash
 *    call does not look hung. The wait is bounded (`TEST_GATE_WAIT_MS`, five
 *    minutes) and ends in a run with one worker and no slot: it never
 *    deadlocks and never fails a run for having waited.
 *
 * **A lock records the pid and the process start time.** A pid alone proves
 * nothing, because pids are reused: the start time (field 22 of
 * `/proc/<pid>/stat`, in clock ticks since boot) is what tells the holder from
 * a stranger that inherited its number. A lock whose process is gone, or whose
 * start time differs, is stale and the next run reclaims it. The slot is
 * released on exit, on a signal, and when the child crashes. A SIGKILL on the
 * gate itself cannot be caught, so its lock stays until the next run finds it
 * stale; the child it leaves running is not counted.
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
 * uses one worker anyway. `npm run test:<tool>` and `test:watch` are not gated
 * either; they are not what `npm test` and preflight call.
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
  return fields[19] ?? null;
}

/**
 * The start time of a live process, or null when it is gone or cannot be read.
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
 * Read one lock. `null` is a stale lock — unreadable, unparsable and old, or
 * naming a process that is gone or has a different start time. A file that is
 * empty or half-written but young is a claim in progress and counts as live.
 *
 * @param {string} file
 * @returns {{live: boolean, pid: number | null, raw: string}}
 */
function inspect(file) {
  let raw;
  let mtimeMs;
  try {
    raw = fs.readFileSync(file, "utf8");
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return { live: false, pid: null, raw: "" };
  }
  /** @type {{pid?: unknown, start?: unknown} | null} */
  let lock = null;
  try {
    lock = JSON.parse(raw);
  } catch {
    // fall through: unparsable
  }
  if (lock === null) {
    return { live: Date.now() - mtimeMs < WRITING_GRACE_MS, pid: null, raw };
  }
  return {
    live: holderIsAlive(lock),
    pid: typeof lock.pid === "number" ? lock.pid : null,
    raw,
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

/**
 * Take a free slot, reclaiming a stale one on the way. The create is exclusive,
 * so the filesystem picks the winner when two runs reach the same slot. Two
 * runs reclaiming the same stale lock can still race between the re-read and
 * the unlink; the worst outcome is a third concurrent run sized for two.
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = fs.openSync(file, "wx");
        try {
          fs.writeSync(fd, body);
        } finally {
          fs.closeSync(fd);
        }
        return file;
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      }
      const state = inspect(file);
      if (state.live) break;
      // Stale. Reclaim it only if it is still the lock just judged stale.
      if (inspect(file).raw === state.raw) {
        try {
          fs.unlinkSync(file);
        } catch {
          // someone else reclaimed it first; the retry sorts it out
        }
      }
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
 * Kill a child and everything under it. POSIX children are started as their own
 * process group, so one negative-pid signal reaches vitest's workers and any
 * browser they launched; Windows has no groups, and `taskkill /T /F` is the
 * tree kill.
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
  try {
    process.kill(-child.pid, signal);
  } catch {
    // the group is already gone
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
      detached: process.platform !== "win32",
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
