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
import {
  findMissingPackages,
  findMissingWorkspaceLinks,
  linkMissingWorkspaces,
  listWorkspaces,
  warnIfStale,
} from "../../.claude/scripts/check-farm-freshness.mjs";

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

// --- the parse-failure notice names itself, not just a line count ----------
//
// repo-45 gate 2, finding 1: a notice line that never printed at all still
// satisfies "one line" (`"".split("\n")` has length 1) and "no SyntaxError".
// These assert the notice's own wording reaches stderr, so a silent
// `warnIfStale` fails them even though it still fails open.

test("warnIfStale's stderr names the failure as a parse failure, on an unparsable shared lockfile", () => {
  const shared = makeUnparsableSharedRoot();
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string) => {
    captured += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    warnIfStale(shared.dir);
  } finally {
    process.stderr.write = originalWrite;
    shared.cleanup();
  }
  expect(captured).toContain("did not parse");
});

test("worktree-farm.sh's stderr names the failure as a parse failure, on an unparsable shared lockfile", () => {
  const shared = makeUnparsableSharedRoot();
  const tree = makeGitRepo();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.stderr).toContain("did not parse");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

// --- workspaces: repo-117 ----------------------------------------------------
//
// The farm copies whatever the shared checkout's `node_modules` holds, so a
// workspace `main` added after the shared checkout's last `npm install`
// (`packages/ui`, repo-108) was linked by nobody and every `npm run build`
// failed on it. The list of workspaces is the worktree's own `package.json`.

const CHECK_SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".claude",
  "scripts",
  "check-farm-freshness.mjs",
);

/** Workspace layout used by every case below: two `packages/`, one tool, one unscoped. */
const FIXTURE_WORKSPACES = [
  { name: "@webtools/core", dir: "packages/core" },
  { name: "@webtools/ui", dir: "packages/ui" },
  { name: "@demo/api", dir: "tools/demo/api" },
  { name: "plain-name", dir: "tools/demo/plain" },
];

/** A git repository whose root `package.json` declares `FIXTURE_WORKSPACES`. */
function makeWorkspaceTree() {
  const tree = makeGitRepo();
  fs.writeFileSync(
    path.join(tree.dir, "package.json"),
    JSON.stringify({ name: "root", workspaces: ["packages/*", "tools/*/*"] }),
  );
  for (const ws of FIXTURE_WORKSPACES) {
    fs.mkdirSync(path.join(tree.dir, ws.dir), { recursive: true });
    fs.writeFileSync(
      path.join(tree.dir, ws.dir, "package.json"),
      JSON.stringify({ name: ws.name }),
    );
  }
  // Not workspaces: a directory without a package.json, and a node_modules.
  fs.mkdirSync(path.join(tree.dir, "packages", "not-a-package"), { recursive: true });
  fs.mkdirSync(path.join(tree.dir, "packages", "node_modules"), { recursive: true });
  return tree;
}

/** Link every `FIXTURE_WORKSPACES` entry except `without`, as npm writes them. */
function linkWorkspaces(root: string, without: string[]) {
  for (const ws of FIXTURE_WORKSPACES) {
    if (without.includes(ws.name)) continue;
    const link = path.join(root, "node_modules", ...ws.name.split("/"));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), path.join(root, ws.dir)), link, "dir");
  }
}

/** A shared root whose `node_modules` links every workspace except `without`. */
function makeSharedWithWorkspaceLinks(without: string[]) {
  const shared = makeSharedRoot({ packages: { "": {} }, present: ["left-pad"] });
  linkWorkspaces(shared.dir, without);
  return shared;
}

/** A farmed-looking tree: workspace links present except those in `without`. */
function makeFarmedTree(without: string[]) {
  const tree = makeWorkspaceTree();
  fs.mkdirSync(path.join(tree.dir, "node_modules"), { recursive: true });
  linkWorkspaces(tree.dir, without);
  return tree;
}

/** Run the checker the way the skill and the farm do. */
function runCheck(args: string[]) {
  return spawnSync(process.execPath, [CHECK_SCRIPT, ...args], {
    shell: false,
    encoding: "utf8",
  });
}

test("worktree-farm.sh links a workspace the shared root has no link for, inside the scope directory the copy loop made", () => {
  const shared = makeSharedWithWorkspaceLinks(["@webtools/ui"]);
  const tree = makeWorkspaceTree();
  try {
    expect(fs.existsSync(path.join(shared.dir, "node_modules", "@webtools", "ui"))).toBe(false);
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("linked workspace @webtools/ui -> ../../packages/ui");

    const scope = path.join(tree.dir, "node_modules", "@webtools");
    // A real directory the loop made, not a link into the shared checkout.
    expect(fs.lstatSync(scope).isSymbolicLink()).toBe(false);
    const link = path.join(scope, "ui");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe("../../packages/ui");
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(tree.dir, "packages", "ui")));
    // The shared root was only read.
    expect(fs.existsSync(path.join(shared.dir, "node_modules", "@webtools", "ui"))).toBe(false);
    // A link the shared root did have still came from the copy loop.
    expect(fs.readlinkSync(path.join(scope, "core"))).toBe("../../packages/core");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

test("worktree-farm.sh creates the scope directory and an unscoped link when the shared root has neither", () => {
  const shared = makeSharedWithWorkspaceLinks(["@demo/api", "plain-name"]);
  const tree = makeWorkspaceTree();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(fs.readlinkSync(path.join(tree.dir, "node_modules", "@demo", "api"))).toBe(
      "../../tools/demo/api",
    );
    expect(fs.readlinkSync(path.join(tree.dir, "node_modules", "plain-name"))).toBe(
      "../tools/demo/plain",
    );
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

test("worktree-farm.sh prints no workspace line and no warning when the shared root links every workspace", () => {
  const shared = makeSharedWithWorkspaceLinks([]);
  const tree = makeWorkspaceTree();
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("linked workspace");
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

test("linkMissingWorkspaces leaves a scope directory that is itself a symlink alone", () => {
  const tree = makeWorkspaceTree();
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-scope-")));
  try {
    fs.mkdirSync(path.join(tree.dir, "node_modules"));
    fs.symlinkSync(elsewhere, path.join(tree.dir, "node_modules", "@webtools"), "dir");
    linkMissingWorkspaces(tree.dir);
    // Writing through the scope link would have put these in `elsewhere`.
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  } finally {
    tree.cleanup();
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("listWorkspaces reads the tree's own package.json globs, skipping directories with no package.json and node_modules", () => {
  const tree = makeWorkspaceTree();
  try {
    expect(listWorkspaces(tree.dir)).toEqual(
      FIXTURE_WORKSPACES.toSorted((a, b) => (a.name < b.name ? -1 : 1)),
    );
  } finally {
    tree.cleanup();
  }
});

test("listWorkspaces returns nothing for a tree with no package.json", () => {
  const tree = makeGitRepo();
  try {
    expect(listWorkspaces(tree.dir)).toEqual([]);
  } finally {
    tree.cleanup();
  }
});

test("check-farm-freshness.mjs <root> exits 0 and names the workspace with no link and the ln -s that repairs it", () => {
  const tree = makeFarmedTree(["@webtools/ui"]);
  try {
    const result = runCheck([tree.dir]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("@webtools/ui");
    expect(result.stderr).toContain("ln -s ../../packages/ui node_modules/@webtools/ui");
    // Only the one that is missing.
    expect(result.stderr).not.toContain("@webtools/core");
    expect(findMissingWorkspaceLinks(tree.dir).map((m) => m.name)).toEqual(["@webtools/ui"]);
  } finally {
    tree.cleanup();
  }
});

test("check-farm-freshness.mjs <root> prints nothing when no workspace link is missing", () => {
  const tree = makeFarmedTree([]);
  try {
    const result = runCheck([tree.dir]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  } finally {
    tree.cleanup();
  }
});

test("the workspace check reads the tree's package.json, so a lockfile that omits the workspace cannot hide it", () => {
  // The shared root's lockfile predates the workspace (repo-117: it had no
  // `packages/ui` entry) and its own check passes; the tree on main has it.
  const tree = makeFarmedTree(["@webtools/ui"]);
  fs.writeFileSync(
    path.join(tree.dir, "package-lock.json"),
    JSON.stringify({ packages: { "": {} } }),
  );
  try {
    const result = runCheck([tree.dir]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("ln -s ../../packages/ui node_modules/@webtools/ui");
  } finally {
    tree.cleanup();
  }
});

test("check-farm-freshness.mjs --workspaces names a missing link without running the package check", () => {
  const tree = makeFarmedTree(["@demo/api"]);
  // A stale lockfile that the package check would warn about.
  fs.writeFileSync(
    path.join(tree.dir, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, "node_modules/@anthropic-ai/sdk": {} } }),
  );
  try {
    const result = runCheck(["--workspaces", tree.dir]);
    expect(result.stderr).toContain("ln -s ../../tools/demo/api node_modules/@demo/api");
    expect(result.stderr).not.toContain("@anthropic-ai/sdk");
  } finally {
    tree.cleanup();
  }
});

// --- round 1 of the gate: the tree's node_modules as a symlink; worktree packages

test("linkMissingWorkspaces writes nothing through a node_modules that is itself a symlink to a shared one", () => {
  // The layout worktree-farm.sh's header forbids, which the guard exists for:
  // the link would otherwise land in the shared checkout (gate 1, F3).
  const shared = makeSharedWithWorkspaceLinks(["@webtools/ui"]);
  const tree = makeWorkspaceTree();
  try {
    fs.symlinkSync(
      path.join(shared.dir, "node_modules"),
      path.join(tree.dir, "node_modules"),
      "dir",
    );
    const before = fs.readdirSync(path.join(shared.dir, "node_modules", "@webtools"));
    expect(linkMissingWorkspaces(tree.dir)).toEqual([]);
    expect(fs.readdirSync(path.join(shared.dir, "node_modules", "@webtools"))).toEqual(before);
    expect(fs.existsSync(path.join(shared.dir, "node_modules", "@webtools", "ui"))).toBe(false);
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

/** A worktree whose lockfile declares `@anthropic-ai/sdk`, which no node_modules holds. */
function writeLockDeclaringSdk(dir: string) {
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, "node_modules/@anthropic-ai/sdk": {} } }),
  );
}

test("worktree-farm.sh names a package the worktree's lockfile declares and a healthy shared checkout lacks, without telling the reader to install in the worktree", () => {
  // The shared checkout's own lockfile predates the dependency, so its own
  // check passes; the tree on main declares it (gate 1, F4).
  const shared = makeSharedWithWorkspaceLinks([]);
  const tree = makeWorkspaceTree();
  writeLockDeclaringSdk(tree.dir);
  try {
    const result = spawnSync("bash", [FARM_SCRIPT, shared.dir], {
      cwd: tree.dir,
      shell: false,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("farm built:");
    expect(result.stderr).toContain("@anthropic-ai/sdk");
    expect(result.stderr).toContain(path.join(tree.dir, "package-lock.json"));
    // common.md forbids an install in a worktree: the remedy is the orchestrator's.
    expect(result.stderr).toContain("Stop and report");
    expect(result.stderr).not.toContain("npm install` in the shared checkout");
    expect(result.stderr).not.toContain("npm install` in " + tree.dir);
  } finally {
    tree.cleanup();
    shared.cleanup();
  }
});

test("check-farm-freshness.mjs --worktree-packages prints nothing when the worktree's lockfile declares nothing absent", () => {
  const tree = makeFarmedTree([]);
  fs.mkdirSync(path.join(tree.dir, "node_modules", "left-pad"));
  fs.writeFileSync(
    path.join(tree.dir, "package-lock.json"),
    JSON.stringify({ packages: { "": {}, "node_modules/left-pad": {} } }),
  );
  try {
    const result = runCheck(["--worktree-packages", tree.dir]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  } finally {
    tree.cleanup();
  }
});

test("check-farm-freshness.mjs --packages keeps the shared-checkout remedy", () => {
  const shared = makeSharedRoot({
    packages: { "": {}, "node_modules/@anthropic-ai/sdk": {} },
    present: [],
  });
  try {
    const result = runCheck(["--packages", shared.dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `remedy: run \`npm install\` in the shared checkout (${shared.dir}), then re-run the farm.`,
    );
  } finally {
    shared.cleanup();
  }
});
