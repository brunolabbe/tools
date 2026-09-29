/**
 * repo-45's regression: `worktree-farm.sh` links whatever a shared checkout's
 * `node_modules` already holds, with no way to know a merge added a dependency
 * since the last `npm install` there. The decision (2026-09-28, the owner): a
 * warning, not a refusal, from a presence check against the shared checkout's
 * own `package-lock.json`, read and reported by
 * `.claude/scripts/check-farm-freshness.mjs` and called from
 * `.claude/scripts/worktree-farm.sh` before anything is linked.
 *
 * `findMissingPackages` and `warnIfStale` are exercised directly against fixture
 * lockfiles and `node_modules` trees — no fixture is a copy of this repo's own
 * 461-entry lockfile, so a change to *this repo's* dependencies can never make
 * these cases drift. `worktree-farm.sh` itself is exercised end to end, through
 * a real temporary git repository, the way `preflight.test.ts`'s `makeRepo`
 * does for the same reason: the farm finds its destination with
 * `git rev-parse --show-toplevel`, which has no meaning against a bare
 * directory.
 *
 * Every `spawnSync` here sets `shell: false` explicitly, ahead of repo-77's
 * widening of `packages/core/test/spawn-safety.test.ts` to require it there too
 * (today it only enforces `spawn`).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { findMissingPackages, warnIfStale } from "../../.claude/scripts/check-farm-freshness.mjs";

const FARM_SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".claude",
  "scripts",
  "worktree-farm.sh",
);

/** A throwaway `<root>/node_modules` plus `<root>/package-lock.json`. */
function makeSharedRoot(options: {
  /** `packages` entries, keyed exactly as `package-lock.json` keys them. */
  packages: Record<string, { optional?: boolean; link?: boolean }>;
  /** Which of `packages`' `node_modules/...` names actually exist on disk. */
  present: string[];
  /** Skip writing a `package-lock.json` at all. */
  noLockfile?: boolean;
}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-freshness-")));
  if (!options.noLockfile) {
    fs.writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({ packages: options.packages }),
    );
  }
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  for (const name of options.present) {
    const dest = path.join(dir, "node_modules", name);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name }));
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A throwaway git repository, so `git rev-parse --show-toplevel` resolves. */
function makeGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-tree-")));
  const init = spawnSync("git", ["init", "-q", "-b", "main", dir], {
    shell: false,
    encoding: "utf8",
  });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// --- findMissingPackages / warnIfStale, against fixture lockfiles -----------

test("findMissingPackages names a non-optional, non-link package absent from node_modules", () => {
  const shared = makeSharedRoot({
    packages: {
      "": {},
      "node_modules/left-pad": {},
      "node_modules/@scope/present": {},
      "node_modules/@scope/missing": {},
    },
    present: ["left-pad", "@scope/present"],
  });
  try {
    expect(findMissingPackages(shared.dir)).toEqual(["@scope/missing"]);
  } finally {
    shared.cleanup();
  }
});

test("findMissingPackages does not report an optional package absent from node_modules", () => {
  const shared = makeSharedRoot({
    packages: {
      "": {},
      "node_modules/fsevents": { optional: true },
    },
    present: [],
  });
  try {
    expect(findMissingPackages(shared.dir)).toEqual([]);
  } finally {
    shared.cleanup();
  }
});

test("findMissingPackages does not report a workspace link absent from node_modules", () => {
  const shared = makeSharedRoot({
    packages: {
      "": {},
      "node_modules/@planner/api": { link: true },
    },
    present: [],
  });
  try {
    expect(findMissingPackages(shared.dir)).toEqual([]);
  } finally {
    shared.cleanup();
  }
});

test("findMissingPackages ignores a package nested inside another package's own tree", () => {
  const shared = makeSharedRoot({
    packages: {
      "": {},
      "node_modules/outer": {},
      "node_modules/outer/node_modules/inner": {},
    },
    present: ["outer"],
  });
  try {
    // "inner" is absent from $SHARED/node_modules/inner (it would live nested
    // inside outer's own tree, which the farm's top-level loop never reads),
    // so it must not be reported as missing at the top level.
    expect(findMissingPackages(shared.dir)).toEqual([]);
  } finally {
    shared.cleanup();
  }
});

test("findMissingPackages returns null for a shared root with no lockfile", () => {
  const shared = makeSharedRoot({ packages: {}, present: [], noLockfile: true });
  try {
    expect(findMissingPackages(shared.dir)).toBeNull();
  } finally {
    shared.cleanup();
  }
});

test("warnIfStale names the missing package and the remedy on stderr, and returns 1", () => {
  const shared = makeSharedRoot({
    packages: { "": {}, "node_modules/@anthropic-ai/sdk": {} },
    present: [],
  });
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string) => {
    captured += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    expect(warnIfStale(shared.dir)).toBe(1);
  } finally {
    process.stderr.write = originalWrite;
    shared.cleanup();
  }
  expect(captured).toContain("@anthropic-ai/sdk");
  expect(captured).toContain("npm install");
});

test("warnIfStale prints nothing and returns 0 when nothing is missing", () => {
  const shared = makeSharedRoot({
    packages: { "": {}, "node_modules/left-pad": {} },
    present: ["left-pad"],
  });
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string) => {
    captured += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    expect(warnIfStale(shared.dir)).toBe(0);
  } finally {
    process.stderr.write = originalWrite;
    shared.cleanup();
  }
  expect(captured).toBe("");
});

// --- worktree-farm.sh end to end, against today's script --------------------

test("worktree-farm.sh warns on stderr and still links and exits 0, given a stale shared root", () => {
  const shared = makeSharedRoot({
    packages: { "": {}, "node_modules/@anthropic-ai/sdk": {} },
    present: [],
  });
  const tree = makeGitRepo();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("@anthropic-ai/sdk");
    expect(result.stderr).toContain("npm install");
    expect(result.stdout).toContain("farm built:");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

test("worktree-farm.sh prints no warning, given a shared root with nothing missing", () => {
  const shared = makeSharedRoot({
    packages: { "": {}, "node_modules/left-pad": {} },
    present: ["left-pad"],
  });
  const tree = makeGitRepo();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("farm built:");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

// --- an unparsable shared lockfile: fail-open, without a raw stack trace ----

/** A shared root whose `package-lock.json` exists but is not valid JSON. */
function makeUnparsableSharedRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-freshness-")));
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{ not valid json");
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("findMissingPackages throws if the shared lockfile does not parse as JSON", () => {
  const shared = makeUnparsableSharedRoot();
  try {
    expect(() => findMissingPackages(shared.dir)).toThrow(SyntaxError);
  } finally {
    shared.cleanup();
  }
});

test("warnIfStale prints one notice line and returns 0, instead of a raw stack trace, when the shared lockfile does not parse", () => {
  const shared = makeUnparsableSharedRoot();
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string) => {
    captured += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    expect(warnIfStale(shared.dir)).toBe(0);
  } finally {
    process.stderr.write = originalWrite;
    shared.cleanup();
  }
  expect(captured).not.toContain("SyntaxError");
  expect(captured.trim().split("\n")).toHaveLength(1);
});

test("worktree-farm.sh warns without a raw stack trace when the shared lockfile does not parse", () => {
  const shared = makeUnparsableSharedRoot();
  const tree = makeGitRepo();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stdout).toContain("farm built:");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});
