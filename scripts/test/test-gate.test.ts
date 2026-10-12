/**
 * The test gate (repo-103): slots, worker counts, waiting, stale locks and the
 * ways it steps aside.
 *
 * **The machine is fixed by fixtures, not by what else is running on it.** Every
 * case points `TEST_GATE_DIR` at its own temporary directory and `TEST_GATE_CPUS`
 * at 12, so the worker counts are arithmetic, and the "other runs" a case needs
 * are lock files it writes itself: a live holder is this test process (its real
 * pid and start time), a dead one is a child that has already exited, a reused
 * pid is this process's pid with the wrong start time. Nothing here reads
 * another session's locks or counts another session's vitest.
 *
 * The gate's own command is faked as well: `node child.mjs` prints the
 * environment and the lock directory it was started in, so no case spawns a real
 * vitest. The single exception is `vitest --version`, because the command the
 * package script names has to resolve and nothing else proves that.
 *
 * Linux only, as the gate is: elsewhere it runs the command straight through,
 * which is the one thing a non-Linux run could assert and a Linux run cannot.
 */

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseStartTime, startTimeOf, workersFor } from "../test-gate.mjs";

const GATE = path.resolve(import.meta.dirname, "..", "test-gate.mjs");

/** What the fake command is. Written fresh into each case's directory. */
const CHILD_SOURCE = `
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.TEST_GATE_DIR;
const sync = process.env.FAKE_SYNC_DIR;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done) => {
  for (let i = 0; i < 600 && !done(); i += 1) await sleep(50);
};

// Two gated runs started together each wait here until the other has started,
// so "both held a slot at once" does not depend on how fast either one launched.
if (sync) {
  fs.writeFileSync(path.join(sync, "started-" + process.pid), "");
  await until(() => fs.readdirSync(sync).filter((n) => n.startsWith("started-")).length >= 2);
}

const locks = {};
if (dir && fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("slot-")) continue;
    try {
      locks[name] = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      locks[name] = null;
    }
  }
}

let grandchild = null;
if (process.env.FAKE_GRANDCHILD) {
  grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

process.stdout.write(
  JSON.stringify({
    workers: process.env.VITEST_MAX_WORKERS ?? null,
    pid: process.pid,
    grandchild: grandchild?.pid ?? null,
    locks,
  }) + "\\n",
);

// ...and neither exits until the other has looked, or the first to leave gives its slot
// back before the second reads the directory.
if (sync) {
  fs.writeFileSync(path.join(sync, "looked-" + process.pid), "");
  await until(() => fs.readdirSync(sync).filter((n) => n.startsWith("looked-")).length >= 2);
}

if (process.env.FAKE_HOLD) await until(() => fs.existsSync(process.env.FAKE_HOLD));
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`;

type Report = {
  workers: string | null;
  pid: number;
  grandchild: number | null;
  locks: Record<string, { pid: number; start: string } | null>;
};

const supported = startTimeOf(process.pid) !== null;

let work: string;
let lockDir: string;
let childFile: string;
const started: ChildProcess[] = [];

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "test-gate-"));
  lockDir = path.join(work, "locks");
  fs.mkdirSync(lockDir);
  childFile = path.join(work, "child.mjs");
  fs.writeFileSync(childFile, CHILD_SOURCE);
});

afterEach(() => {
  for (const proc of started.splice(0)) {
    if (proc.pid !== undefined) {
      for (const target of [-proc.pid, proc.pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
});

/** The gate's environment, with nothing of this machine's or this run's in it. */
function gateEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CI" || key === "VITEST_MAX_WORKERS" || key.startsWith("TEST_GATE_")) continue;
    if (key.startsWith("FAKE_") || key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  const merged: Record<string, string | undefined> = {
    ...env,
    TEST_GATE_DIR: lockDir,
    TEST_GATE_CPUS: "12",
    TEST_GATE_SETTLE_MS: "0",
    ...extra,
  };
  // `undefined` means "leave it unset", which is how a case drops TEST_GATE_DIR.
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

type Gate = {
  proc: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Resolves when the gate itself has exited, whatever still holds its pipes. */
  exited: Promise<void>;
  report: () => Report;
};

function startGate(
  extra: Record<string, string | undefined> = {},
  command?: string[],
  cwd?: string,
  detached = false,
): Gate {
  const proc = spawn(process.execPath, [GATE, ...(command ?? [process.execPath, childFile])], {
    cwd,
    detached,
    env: gateEnv(extra),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  started.push(proc);
  let out = "";
  let err = "";
  proc.stdout?.on("data", (chunk) => (out += chunk));
  proc.stderr?.on("data", (chunk) => (err += chunk));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    proc.on("close", (code, signal) => resolve({ code, signal })),
  );
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  return {
    proc,
    exited,
    stdout: () => out,
    stderr: () => err,
    done,
    report: () => JSON.parse(out.split("\n")[0] ?? "") as Report,
  };
}

async function waitUntil(done: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A lock held by a process that is alive and is who the lock says it is. */
function liveLock(slot: number): void {
  fs.writeFileSync(
    path.join(lockDir, `slot-${slot}.lock`),
    JSON.stringify({ pid: process.pid, start: startTimeOf(process.pid) }),
  );
}

/** A lock whose process has exited: the pid of a child that has already finished. */
function deadLock(slot: number): number {
  const gone = spawnSync(process.execPath, ["-e", ""], { shell: false });
  const pid = gone.pid;
  expect(startTimeOf(pid)).toBeNull();
  fs.writeFileSync(
    path.join(lockDir, `slot-${slot}.lock`),
    JSON.stringify({ pid, start: "123456" }),
  );
  return pid;
}

/** A lock naming a pid that is alive, but not the process that took the lock. */
function reusedPidLock(slot: number): void {
  fs.writeFileSync(
    path.join(lockDir, `slot-${slot}.lock`),
    JSON.stringify({ pid: process.pid, start: "1" }),
  );
}

const slotFiles = () => fs.readdirSync(lockDir).filter((n) => n.startsWith("slot-"));

describe("the arithmetic", () => {
  test("a lone run keeps every worker, a second halves them, a third gets a third", () => {
    expect(workersFor(12, 1)).toBe(11);
    expect(workersFor(12, 2)).toBe(5);
    expect(workersFor(12, 3)).toBe(3);
  });

  test("never fewer than one worker", () => {
    expect(workersFor(2, 5)).toBe(1);
    expect(workersFor(1, 1)).toBe(1);
  });

  test("the start time is field 22, whatever the command name holds", () => {
    // Fields 3 to 52: 20 is the 20th after the name, the 22nd overall.
    const tail = Array.from({ length: 50 }, (_, i) => String(i + 3));
    const stat = `4242 (we ird) ) name) ${tail.join(" ")}\n`;
    expect(parseStartTime(stat)).toBe("22");
    expect(parseStartTime("no parenthesis")).toBeNull();
  });
});

describe.skipIf(!supported)("slots and worker counts", () => {
  test("a lone run keeps all the workers and gives its slot back", async () => {
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    const report = gate.report();
    expect(report.workers).toBe("11");
    expect(Object.keys(report.locks)).toEqual(["slot-0.lock"]);
    expect(report.locks["slot-0.lock"]?.pid).toBe(gate.proc.pid);
    expect(slotFiles()).toEqual([]);
  });

  test("a run started beside another gets half the workers and says so", async () => {
    liveLock(0);
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("5");
    expect(Object.keys(gate.report().locks)).toEqual(["slot-0.lock", "slot-1.lock"]);
    expect(gate.stderr()).toMatch(/slot-1, 2 of 2 runs active.*: 5 workers/u);
    expect(slotFiles()).toEqual(["slot-0.lock"]);
  });

  test("two runs started together never take the same slot", async () => {
    const sync = path.join(work, "sync");
    fs.mkdirSync(sync);
    const first = startGate({ FAKE_SYNC_DIR: sync });
    const second = startGate({ FAKE_SYNC_DIR: sync });
    await Promise.all([first.done, second.done]);
    // Each child looked at the lock directory once both were running.
    for (const gate of [first, second]) {
      expect(Object.keys(gate.report().locks)).toEqual(["slot-0.lock", "slot-1.lock"]);
    }
    const holders = Object.values(first.report().locks).map((lock) => lock?.pid);
    expect(new Set(holders)).toEqual(new Set([first.proc.pid, second.proc.pid]));
  });

  test("a run started during another's settle is counted before it sizes itself", async () => {
    // The settle is what lets two runs started together both see two. Here the
    // test plays the second run: it takes slot 1 once the gate holds slot 0,
    // inside the gate's settle window, and the gate must count it.
    const gate = startGate({ TEST_GATE_SETTLE_MS: "2500" });
    await waitUntil(() => slotFiles().includes("slot-0.lock"), "the gate to take slot 0");
    liveLock(1);
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("5");
  });
});

describe.skipIf(!supported)("waiting for a slot", () => {
  test("a third run waits with a message, then proceeds when a slot frees", async () => {
    liveLock(0);
    liveLock(1);
    const gate = startGate({ TEST_GATE_WAIT_MS: "60000" });
    await waitUntil(() => gate.stderr().includes("waiting for a test slot"), "the wait message");
    expect(gate.stderr()).toContain(
      `waiting for a test slot: 2 runs active (pids ${process.pid}, ${process.pid})`,
    );
    expect(gate.stdout()).toBe("");

    fs.rmSync(path.join(lockDir, "slot-0.lock"));
    expect(await gate.done).toEqual({ code: 0, signal: null });
    // One other holder is left, so this run is the second of two.
    expect(gate.report().workers).toBe("5");
    expect(gate.report().locks["slot-0.lock"]?.pid).toBe(gate.proc.pid);
  });

  test("the bounded wait expires into a one-worker run with no slot", async () => {
    liveLock(0);
    liveLock(1);
    const gate = startGate({ TEST_GATE_WAIT_MS: "600" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("1");
    expect(gate.stderr()).toContain("running anyway with 1 worker and no slot");
    // It never held a slot, and it left the two real ones as they were.
    expect(Object.values(gate.report().locks).map((lock) => lock?.pid)).toEqual([
      process.pid,
      process.pid,
    ]);
    expect(slotFiles()).toEqual(["slot-0.lock", "slot-1.lock"]);
  });
});

describe.skipIf(!supported)("stale locks", () => {
  test("a lock whose process is gone is reclaimed", async () => {
    const dead = deadLock(0);
    liveLock(1);
    const gate = startGate({ TEST_GATE_WAIT_MS: "0" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.stderr()).not.toContain("waiting");
    // Slot 0 was taken over, not waited for, and the other holder still counts.
    expect(gate.report().locks["slot-0.lock"]?.pid).toBe(gate.proc.pid);
    expect(gate.report().locks["slot-0.lock"]?.pid).not.toBe(dead);
    expect(gate.report().workers).toBe("5");
  });

  test("a lock whose pid was reused by another process is reclaimed", async () => {
    reusedPidLock(0);
    reusedPidLock(1);
    const gate = startGate({ TEST_GATE_WAIT_MS: "0" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.stderr()).not.toContain("waiting");
    // Both holders are strangers wearing a live pid, so this run is alone.
    expect(gate.report().workers).toBe("11");
    expect(gate.report().locks["slot-0.lock"]?.pid).toBe(gate.proc.pid);
  });

  test("an empty lock file that has been sitting there is stale", async () => {
    const file = path.join(lockDir, "slot-0.lock");
    fs.writeFileSync(file, "");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("11");
  });

  test("a run killed with SIGKILL leaves a lock the next run reclaims", async () => {
    const hold = path.join(work, "release");
    const victim = startGate({ FAKE_HOLD: hold, FAKE_GRANDCHILD: "1" });
    await waitUntil(() => victim.stdout().includes("\n"), "the victim's child to start");
    const orphan = victim.report();
    expect(slotFiles()).toEqual(["slot-0.lock"]);

    victim.proc.kill("SIGKILL");
    // Not `done`: the child it leaves behind still holds the pipes open.
    await victim.exited;
    // Nothing could run on the way out, so the lock is still there, held by a corpse.
    expect(slotFiles()).toEqual(["slot-0.lock"]);
    expect(startTimeOf(victim.proc.pid ?? 0)).toBeNull();

    const next = startGate();
    expect(await next.done).toEqual({ code: 0, signal: null });
    expect(next.report().workers).toBe("11");
    expect(next.report().locks["slot-0.lock"]?.pid).toBe(next.proc.pid);
    expect(slotFiles()).toEqual([]);

    // The child a SIGKILL leaves behind is the test's to clean up.
    for (const pid of [orphan.pid, orphan.grandchild ?? 0]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });
});

describe.skipIf(!supported)("leaving", () => {
  test("a child that fails hands its exit code back and releases the slot", async () => {
    const gate = startGate({ FAKE_EXIT: "3" });
    expect(await gate.done).toEqual({ code: 3, signal: null });
    expect(slotFiles()).toEqual([]);
  });

  test("a signal reaches the child's whole tree and the slot is released", async () => {
    const hold = path.join(work, "never");
    const gate = startGate({ FAKE_HOLD: hold, FAKE_GRANDCHILD: "1" });
    await waitUntil(() => gate.stdout().includes("\n"), "the child to start");
    const { pid, grandchild } = gate.report();
    expect(startTimeOf(pid)).not.toBeNull();
    expect(startTimeOf(grandchild ?? 0)).not.toBeNull();

    gate.proc.kill("SIGTERM");
    expect(await gate.done).toEqual({ code: 143, signal: null });
    await waitUntil(() => startTimeOf(pid) === null, "the child to die");
    await waitUntil(() => startTimeOf(grandchild ?? 0) === null, "the grandchild to die");
    expect(slotFiles()).toEqual([]);
  });

  test("a SIGKILL to the gate's process group leaves nothing running", async () => {
    // The shape of `kill -9 -<pgid>` on a terminal job. The child used to be
    // started in a group of its own, which this signal does not reach: vitest
    // and its workers survived, holding no slot (repo-103 gate 1).
    const hold = path.join(work, "never");
    const gate = startGate({ FAKE_HOLD: hold, FAKE_GRANDCHILD: "1" }, undefined, undefined, true);
    await waitUntil(() => gate.stdout().includes("\n"), "the child to start");
    const { pid, grandchild } = gate.report();
    expect(startTimeOf(pid)).not.toBeNull();
    expect(startTimeOf(grandchild ?? 0)).not.toBeNull();

    process.kill(-(gate.proc.pid ?? 0), "SIGKILL");
    await gate.exited;
    await waitUntil(() => startTimeOf(pid) === null, "the child to die");
    await waitUntil(() => startTimeOf(grandchild ?? 0) === null, "the grandchild to die");
    // The gate could not release the slot; the next run's reclaim is the other test.
    expect(slotFiles()).toEqual(["slot-0.lock"]);
  });
});

describe.skipIf(!supported)("two runs reclaiming one stale lock", () => {
  test("a stale lock another run is reclaiming is left to it", async () => {
    // Re-read-then-unlink is not atomic: a run that has judged the lock stale
    // can unlink the fresh one another run created in between, and both hold
    // the slot (gate 1 measured 3 of 60 trials). The guard file is what stops
    // the second run, so with the guard held the lock must be left untouched.
    const dead = deadLock(0);
    fs.writeFileSync(path.join(lockDir, "slot-0.lock.reclaim"), String(process.pid));
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().locks["slot-1.lock"]?.pid).toBe(gate.proc.pid);
    expect(gate.report().locks["slot-0.lock"]?.pid).toBe(dead);
    expect(gate.report().workers).toBe("11");
    // Neither the lock nor the guard belongs to this run, so neither is touched.
    expect(slotFiles().toSorted()).toEqual(["slot-0.lock", "slot-0.lock.reclaim"]);
  });

  test("a guard left by a reclaimer that died is removed, and the slot reclaimed", async () => {
    deadLock(0);
    const guard = path.join(lockDir, "slot-0.lock.reclaim");
    fs.writeFileSync(guard, "1");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(guard, old, old);
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().locks["slot-0.lock"]?.pid).toBe(gate.proc.pid);
    expect(slotFiles()).toEqual([]);
  });

  test("the guard is not left behind by a reclaim", async () => {
    deadLock(0);
    const gate = startGate();
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(slotFiles()).toEqual([]);
  });
});

describe.skipIf(!supported)("stepping aside", () => {
  test("under CI the child's environment gains no worker count and no lock is taken", async () => {
    const gate = startGate({ CI: "true" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBeNull();
    expect(gate.report().locks).toEqual({});
    expect(gate.stderr()).toBe("");
  });

  test("CI=false is not CI", async () => {
    const gate = startGate({ CI: "false" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("11");
  });

  test("a worker count the caller set passes through untouched", async () => {
    liveLock(0);
    const gate = startGate({ VITEST_MAX_WORKERS: "7" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("7");
    // It took no slot of its own, and left the other run's alone.
    expect(Object.keys(gate.report().locks)).toEqual(["slot-0.lock"]);
    expect(gate.stderr()).toBe("");
  });

  test("its own opt-out runs the command straight through", async () => {
    const gate = startGate({ TEST_GATE_OFF: "1" });
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBeNull();
    expect(gate.report().locks).toEqual({});
  });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  expect(result.status, result.stderr).toBe(0);
}

describe.skipIf(!supported)("where the locks live", () => {
  test("every worktree of a repository shares one lock directory", async () => {
    const main = path.join(work, "main");
    const second = path.join(work, "second");
    fs.mkdirSync(main);
    git(main, "init", "--quiet");
    git(
      main,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "x",
    );
    git(main, "worktree", "add", "--quiet", second);

    // A run holding a slot, as the main checkout's gate would have left it.
    const shared = path.join(main, ".git", "test-gate");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(
      path.join(shared, "slot-0.lock"),
      JSON.stringify({ pid: process.pid, start: startTimeOf(process.pid) }),
    );

    const gate = startGate({ TEST_GATE_DIR: undefined }, undefined, second);
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBe("5");
  });

  test("outside a repository it runs the command straight through and says so", async () => {
    const bare = path.join(work, "bare");
    fs.mkdirSync(bare);
    const gate = startGate({ TEST_GATE_DIR: undefined }, undefined, bare);
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.report().workers).toBeNull();
    expect(gate.stderr()).toContain("not inside a git repository");
  });
});

describe("the command the package script names", () => {
  test("`vitest` resolves to the installed package and runs", async () => {
    // The only real vitest in this file, and `--version` starts no worker.
    const gate = startGate({ CI: "true" }, ["vitest", "--version"]);
    expect(await gate.done).toEqual({ code: 0, signal: null });
    expect(gate.stdout()).toMatch(/^vitest\/\d+\.\d+\.\d+/u);
  });
});
