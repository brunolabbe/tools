/**
 * `scripts/check-lockfile-sync.mjs`, repo-46's option C: the step that turns a
 * release stamp that did nothing into a red pull request.
 *
 * Two layers. The real one runs the script's own `npm` and `git` against a
 * scratch workspace with no dependencies, so it is offline and takes about a
 * second; it is what proves the two verdicts (in sync, drifted) and the
 * property gate 1 found missing — nothing is written into the directory the
 * script is run in. The injected one replaces the runner, for the paths a real
 * `npm` cannot be made to take on demand: a failed install, and a spawn that
 * never started.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { checkLockfileSync } from "../check-lockfile-sync.mjs";

const scratch: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A one-workspace repository whose lockfile records `lockVersion` for it. */
function fixture(lockVersion: string, manifestVersion = "1.0.0"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-sync-test-"));
  scratch.push(dir);
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
  };
  write("package.json", {
    name: "fx",
    version: "0.0.0",
    private: true,
    workspaces: ["packages/*"],
  });
  write("packages/a/package.json", { name: "a", version: manifestVersion });
  write("package-lock.json", {
    name: "fx",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "fx", version: "0.0.0", workspaces: ["packages/*"] },
      "node_modules/a": { resolved: "packages/a", link: true },
      "packages/a": { version: lockVersion },
    },
  });
  return dir;
}

/** The script's own runner, with output captured instead of inherited. */
function quietRun(command: string, args: string[], options: { cwd: string }) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", shell: false });
  return { status: result.status, error: result.error, output: result.stdout + result.stderr };
}

/** A spawn that never started: `status` is null and `error` says why. */
const neverStarted = () => ({ status: null, error: new Error("spawn npm ENOENT") });

/** Every file under `dir` with its bytes, to prove nothing was written. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

test("a lockfile that matches every manifest passes and leaves the directory as it was", () => {
  const dir = fixture("1.0.0");
  const before = snapshot(dir);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  expect(checkLockfileSync(dir, quietRun)).toBe(0);

  expect(stderr).not.toHaveBeenCalled();
  expect(snapshot(dir)).toEqual(before);
});

test("a lockfile one workspace version behind fails, names the drift, and is not rewritten", () => {
  const dir = fixture("0.9.0");
  const before = snapshot(dir);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let diffOutput = "";
  const capturing = (command: string, args: string[], options: { cwd: string }) => {
    const result = quietRun(command, args, options);
    if (command === "git") diffOutput = result.output;
    return result;
  };

  expect(checkLockfileSync(dir, capturing)).toBe(1);

  expect(diffOutput).toMatch(/-\s+"version": "0\.9\.0"/u);
  expect(diffOutput).toMatch(/\+\s+"version": "1\.0\.0"/u);
  expect(String(stderr.mock.calls[0]?.[0])).toMatch(/out of sync/u);
  // The property gate 1 found missing: the script reports drift, it does not
  // repair it in the caller's tree.
  expect(snapshot(dir)).toEqual(before);
});

test("nothing npm writes lands in the directory it was run from, hidden lockfile included", () => {
  // In a farm worktree `node_modules/.package-lock.json` is a symlink into the
  // shared checkout, and npm rewrites it whenever it installs beside it. A
  // regular file stands in for the symlink: what matters is that it is not
  // touched, and a rewrite of a regular file is as visible as one through a link.
  const dir = fixture("0.9.0");
  const hidden = path.join(dir, "node_modules", ".package-lock.json");
  fs.mkdirSync(path.dirname(hidden));
  fs.writeFileSync(hidden, "sentinel\n");
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(hidden, old, old);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  checkLockfileSync(dir, quietRun);

  expect(fs.readFileSync(hidden, "utf8")).toBe("sentinel\n");
  expect(fs.statSync(hidden).mtimeMs).toBe(old.getTime());
  expect(fs.existsSync(path.join(dir, "node_modules", "a"))).toBe(false);
});

test("its temporary directory is removed, whatever the verdict", () => {
  const made: string[] = [];
  const spy = (command: string, args: string[], options: { cwd: string }) => {
    if (command === "npm") made.push(options.cwd);
    return quietRun(command, args, options);
  };
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  checkLockfileSync(fixture("1.0.0"), spy);
  checkLockfileSync(fixture("0.9.0"), spy);

  expect(made).toHaveLength(2);
  for (const dir of made) expect(fs.existsSync(dir)).toBe(false);
});

test("a spawn that never started says so and fails, instead of exiting silently", () => {
  const dir = fixture("1.0.0");
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  expect(checkLockfileSync(dir, neverStarted)).toBe(1);

  expect(String(stderr.mock.calls[0]?.[0])).toMatch(/could not run npm: spawn npm ENOENT/u);
});

test("an install that fails passes its own exit status through and never reaches the diff", () => {
  const dir = fixture("1.0.0");
  const commands: string[] = [];
  const failing = (command: string) => {
    commands.push(command);
    return { status: 7 };
  };

  expect(checkLockfileSync(dir, failing)).toBe(7);

  expect(commands).toEqual(["npm"]);
});
