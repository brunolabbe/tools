/**
 * Warn a dispatched agent that the shared checkout `worktree-farm.sh` just
 * linked from is stale, before the agent finds out an hour later as a
 * TS2307.
 *
 * The farm symlinks whatever `$SHARED_ROOT/node_modules` already holds; it
 * never runs `npm install`, and it has no way to know that a merge since the
 * last shared-checkout install added a dependency. `repo-45`'s reproduction is
 * exactly that: `pl-39` added `@anthropic-ai/sdk` to a `package.json` and the
 * lockfile, nobody reinstalled `/workspaces/tools`, and every worktree farmed
 * after that merge got a clean farm, a clean `npm run build` for every
 * workspace ahead of the affected one, and a `TS2307` only once the compiler
 * reached the file that imports the missing package. Two builders in that
 * batch spent their dispatch hand-extracting the package from the npm cache;
 * a third reported its branch green over a suite that could not load 25 test
 * files.
 *
 * `repo-45`'s decision (2026-09-28, the owner): **a presence check against
 * `$SHARED_ROOT/package-lock.json`, and a warning, not a refusal.** A refusal
 * would stop every dispatch on a false positive until someone reinstalled the
 * shared checkout or fixed this script; a warning costs nothing when the
 * install is healthy and still names the exact package and the remedy when it
 * is not.
 *
 * ## What counts as "declared"
 *
 * Every `packages` entry in the lockfile whose key is `node_modules/<name>` or
 * `node_modules/@scope/<name>` **one level deep** — a nested
 * `node_modules/<name>/node_modules/<dep>` is skipped, but not because it is
 * bundled: none of the lockfile's 17 nested entries carries `inBundle` (they
 * are ordinary transitive dependencies npm placed one level down to resolve a
 * version conflict), and the farm links `<name>`'s directory absolutely, so a
 * package missing from `<name>`'s nested tree in the shared install is equally
 * missing from the worktree's. It is skipped because top-level presence is
 * the scope the owner decided (2026-09-28, option A); checking the nested
 * entries too would be a wider check nobody asked for.
 *
 * Two kinds of *top-level* entry are declared but never installed on purpose,
 * and both are excluded or every healthy run would warn:
 *
 * - **`optional: true`** — platform-specific optional dependencies
 *   (`fsevents`, the per-OS `@typescript/typescript-*` builds) that npm only
 *   installs on a matching platform. 111 of 425 top-level entries in this
 *   repo's own lockfile, measured 2026-09-29.
 * - **`link: true`** — a workspace's own packages (`@planner/api`, and so on),
 *   whose `resolved` is a relative path into the checkout rather than
 *   anything npm fetches. Two of these disagree in *version* between
 *   `package-lock.json` and npm's hidden `node_modules/.package-lock.json`
 *   (`repo-45`'s Decision section measured it), which is exactly why this
 *   reads the declared lockfile and not that hidden one: a version check
 *   would warn on every run over those two.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `node_modules/<name>` or `node_modules/@scope/<name>`, nothing nested. */
function topLevelPackageName(lockKey) {
  if (!lockKey.startsWith("node_modules/")) return null;
  const rest = lockKey.slice("node_modules/".length);
  if (rest.includes("node_modules/")) return null; // nested inside another package
  const depth = rest.startsWith("@") ? 2 : 1;
  if (rest.split("/").length !== depth) return null;
  return rest;
}

/**
 * The names declared in `sharedRoot`'s `package-lock.json` that are missing
 * from `sharedRoot`'s `node_modules`, or `null` if that root has no lockfile
 * to read (a shared root that was never installed at all is a different
 * problem, and the farm's own existence check already covers it). Throws
 * `JSON.parse`'s own error if the lockfile exists but does not parse;
 * `warnIfStale` is the one that catches it.
 *
 * @param {string} sharedRoot
 * @returns {string[] | null}
 */
export function findMissingPackages(sharedRoot) {
  const lockPath = path.join(sharedRoot, "package-lock.json");
  if (!existsSync(lockPath)) return null;

  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const packages = lock.packages ?? {};
  const missing = [];
  for (const [key, entry] of Object.entries(packages)) {
    const name = topLevelPackageName(key);
    if (name === null) continue;
    if (entry?.optional || entry?.link) continue;
    if (!existsSync(path.join(sharedRoot, "node_modules", name))) missing.push(name);
  }
  return missing.toSorted();
}

/**
 * Writes the warning to stderr and returns the exit code that reflects it —
 * 0 clean, 1 stale, and also 0 if the lockfile could not be parsed (a single
 * notice line takes the place of `findMissingPackages`'s raw `SyntaxError`).
 * `worktree-farm.sh` calls this and discards the exit code on purpose: the
 * decision above is to warn, not to refuse, so a stale shared checkout never
 * blocks a dispatch.
 *
 * `options.worktree` says `sharedRoot` is a farmed worktree rather than the
 * shared checkout (repo-117, gate 1 F4): the farm checks the worktree's own
 * lockfile against what it just linked, so a shared checkout that is behind
 * `main` cannot pass a worktree that declares a package it lacks. The remedy
 * differs, because `roles/common.md` forbids an install in a worktree — the
 * shared checkout is what is stale, and repairing it is the orchestrator's.
 *
 * @param {string} sharedRoot
 * @param {{ worktree?: boolean }} [options]
 * @returns {number}
 */
export function warnIfStale(sharedRoot, options = {}) {
  let missing;
  try {
    missing = findMissingPackages(sharedRoot);
  } catch (err) {
    // findMissingPackages lets a lockfile that fails to parse (e.g. an
    // unresolved merge conflict) throw JSON.parse's own SyntaxError. Left
    // uncaught, that prints a raw stack trace into the farm's stderr that
    // reads as the farm crashing and says nothing about the freshness check
    // itself having been skipped; fail-open still holds either way.
    process.stderr.write(
      `warning: ${path.join(sharedRoot, "package-lock.json")} did not parse, skipping the freshness check (${err.message}).\n`,
    );
    return 0;
  }
  if (missing === null || missing.length === 0) return 0;
  const remedy = options.worktree
    ? "remedy: the shared checkout this worktree was farmed from is behind its lockfile. " +
      "Stop and report it to the orchestrator; do not install in a worktree. " +
      "Once the shared checkout is installed, re-run the farm."
    : `remedy: run \`npm install\` in the shared checkout (${sharedRoot}), then re-run the farm.`;
  process.stderr.write(
    [
      `warning: ${sharedRoot} is missing ${missing.length} package(s) that ` +
        `${path.join(sharedRoot, "package-lock.json")} declares:`,
      ...missing.map((name) => `  ${name}`),
      remedy,
    ].join("\n") + "\n",
  );
  return 1;
}

// --- workspaces (repo-117) ---------------------------------------------------
//
// The pass above reads the *shared* checkout and skips every `link: true`
// entry, so a workspace that `main` added after the shared checkout's last
// `npm install` (`packages/ui`, repo-108) was linked by nobody and warned about
// by nobody: the farm copies what the shared `node_modules` holds, and the
// check compared the shared checkout with its own lockfile. This pass reads the
// *worktree's* own root `package.json` `workspaces` globs instead, so a shared
// checkout that is behind `main` cannot hide a workspace `main` has.

/**
 * Expand one `workspaces` glob to directories under `root`. Only `*` as a whole
 * path segment is understood (a `packages` directory's children, or a `tools`
 * directory's grandchildren), which is every shape this repo's `package.json`
 * uses; npm's double star and negations are not emulated, and a pattern that
 * needs them yields what its plain segments match.
 *
 * @param {string} root
 * @param {string} pattern
 * @returns {string[]} paths relative to `root`, POSIX separators
 */
function expandWorkspaceGlob(root, pattern) {
  let dirs = [""];
  for (const segment of pattern.split("/").filter((s) => s !== "" && s !== ".")) {
    const next = [];
    for (const dir of dirs) {
      if (segment === "*") {
        let entries = [];
        try {
          entries = readdirSync(path.join(root, dir), { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          next.push(dir === "" ? entry.name : `${dir}/${entry.name}`);
        }
      } else {
        next.push(dir === "" ? segment : `${dir}/${segment}`);
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * The workspaces `root`'s own `package.json` declares: each directory its
 * `workspaces` globs match that holds a `package.json` with a `name`. Empty when
 * there is no `package.json` or it declares none (a bare fixture tree), and
 * throws `JSON.parse`'s own error on one that does not parse.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string }[]} `dir` relative to `root`, POSIX
 */
export function listWorkspaces(root) {
  const manifest = path.join(root, "package.json");
  if (!existsSync(manifest)) return [];
  const declared = JSON.parse(readFileSync(manifest, "utf8")).workspaces;
  // `workspaces` is an array, or `{ packages: [...] }` in npm's older form.
  const globs = Array.isArray(declared) ? declared : (declared?.packages ?? []);
  const found = new Map();
  for (const glob of globs) {
    if (typeof glob !== "string" || glob.startsWith("!")) continue;
    for (const dir of expandWorkspaceGlob(root, glob)) {
      const file = path.join(root, dir, "package.json");
      if (!existsSync(file)) continue;
      const name = JSON.parse(readFileSync(file, "utf8")).name;
      if (typeof name === "string" && name !== "") found.set(name, dir);
    }
  }
  return [...found].map(([name, dir]) => ({ name, dir })).toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/** True when `p` is anything at all on disk, a dangling symlink included. */
function existsAsEntry(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a workspace's link goes and what it points at, relative the way npm
 * writes them (`../../packages/ui` from `node_modules/@webtools/ui`), so the
 * link resolves from wherever it physically lives — inside the worktree.
 *
 * @param {string} root
 * @param {{ name: string, dir: string }} workspace
 */
function workspaceLink(root, workspace) {
  const link = path.join(root, "node_modules", ...workspace.name.split("/"));
  const target = path.relative(path.dirname(link), path.join(root, workspace.dir));
  return { link, target: target.split(path.sep).join("/") };
}

/**
 * The workspaces `root` declares that have no `node_modules/<name>` entry, each
 * with the `ln -s` (run from `root`) that repairs it.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string, command: string }[]}
 */
export function findMissingWorkspaceLinks(root) {
  const missing = [];
  for (const workspace of listWorkspaces(root)) {
    const { link, target } = workspaceLink(root, workspace);
    if (existsAsEntry(link)) continue;
    const rel = path.relative(root, link).split(path.sep).join("/");
    missing.push({ ...workspace, command: `ln -s ${target} ${rel}` });
  }
  return missing;
}

/**
 * True when `dir`, resolved through its nearest existing ancestor (it may not
 * exist yet), lands inside `rootReal`. A symlink anywhere on the way out — the
 * scope directory, or `node_modules` itself pointing at a shared one — fails it.
 *
 * @param {string} rootReal
 * @param {string} dir
 */
function staysInside(rootReal, dir) {
  let existing = dir;
  while (!existsAsEntry(existing)) {
    const up = path.dirname(existing);
    if (up === existing) return false;
    existing = up;
  }
  let real;
  try {
    real = realpathSync(existing);
  } catch {
    return false; // a dangling link: there is nothing safe to write into
  }
  const rel = path.relative(rootReal, real);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Create the link for every workspace of `root` that has none. The farm's copy
 * loop has already recreated each scope directory (`node_modules/@webtools`) as
 * a real directory, so the link goes inside it; a scope the shared checkout had
 * no entry for at all is created. Nothing is written through a symlink that
 * leaves `root` — a scope directory, or `node_modules` itself, linked to a
 * shared one — because the link would land in the shared checkout; the
 * workspace is then left for `warnIfWorkspacesUnlinked` to name.
 *
 * @param {string} root
 * @returns {{ name: string, target: string }[]} what was linked
 */
export function linkMissingWorkspaces(root) {
  const linked = [];
  const rootReal = realpathSync(root);
  for (const workspace of listWorkspaces(root)) {
    const { link, target } = workspaceLink(root, workspace);
    if (existsAsEntry(link)) continue;
    const parent = path.dirname(link);
    if (!staysInside(rootReal, parent)) continue;
    mkdirSync(parent, { recursive: true });
    symlinkSync(target, link, "dir");
    linked.push({ name: workspace.name, target });
  }
  return linked;
}

/**
 * Names each workspace of `root` with no link, and the `ln -s` that repairs it,
 * on stderr. Always returns 0: unlike a missing fetched package this is a
 * warning about a tree the farm just built, and the farm links these itself, so
 * what is left to name is a link it could not make. Prints nothing when none is
 * missing, or when `package.json` does not parse (a single notice replaces
 * `JSON.parse`'s stack, as `warnIfStale` does for the lockfile).
 *
 * @param {string} root
 * @returns {number}
 */
export function warnIfWorkspacesUnlinked(root) {
  let missing;
  try {
    missing = findMissingWorkspaceLinks(root);
  } catch (err) {
    process.stderr.write(
      `warning: could not read the workspaces of ${root}, skipping the workspace link check (${err.message}).\n`,
    );
    return 0;
  }
  if (missing.length === 0) return 0;
  process.stderr.write(
    [
      `warning: ${root} declares ${missing.length} workspace(s) with no node_modules link:`,
      ...missing.map((m) => `  ${m.name}`),
      `repair, from ${root}:`,
      ...missing.map((m) => `  ${m.command}`),
    ].join("\n") + "\n",
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `<root>` alone runs both checks against it. The farm splits them: the
  // fetched-package check against the shared checkout before anything is
  // linked, the workspace links against the worktree after, and the worktree's
  // own lockfile against what it holds (`--worktree-packages`, the same check
  // with the remedy a worktree may follow).
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const root = args.find((a) => !a.startsWith("--"));
  const known = ["--packages", "--worktree-packages", "--workspaces", "--link"];
  if (!root || flags.some((f) => !known.includes(f))) {
    process.stderr.write(
      "usage: node check-farm-freshness.mjs [--packages | --worktree-packages | --workspaces | --link] <root>\n",
    );
    process.exitCode = 1;
  } else if (flags.includes("--worktree-packages")) {
    process.exitCode = warnIfStale(root, { worktree: true });
  } else if (flags.includes("--link")) {
    try {
      for (const { name, target } of linkMissingWorkspaces(root)) {
        process.stdout.write(`linked workspace ${name} -> ${target}\n`);
      }
    } catch (err) {
      process.stderr.write(`warning: could not link the workspaces of ${root} (${err.message}).\n`);
    }
  } else {
    const both = flags.length === 0;
    let code = 0;
    if (both || flags.includes("--packages")) code = warnIfStale(root);
    if (both || flags.includes("--workspaces")) warnIfWorkspacesUnlinked(root);
    process.exitCode = code;
  }
}
