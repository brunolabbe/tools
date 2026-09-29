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
 * `node_modules/<name>/node_modules/<dep>` is a transitive dependency bundled
 * inside another package's own tree, not something the farm's top-level loop
 * ever looks for at `$SHARED/<name>`, so it is not this check's business.
 *
 * Two kinds of entry are declared but never installed on purpose, and both are
 * excluded or every healthy run would warn:
 *
 * - **`optional: true`** — platform-specific optional dependencies
 *   (`fsevents`, the per-OS `@typescript/typescript-*` builds) that npm only
 *   installs on a matching platform. 111 of 442 top-level entries in this
 *   repo's own lockfile, measured 2026-09-29.
 * - **`link: true`** — a workspace's own packages (`@planner/api`, and so on),
 *   whose `resolved` is a relative path into the checkout rather than
 *   anything npm fetches. Two of these disagree in *version* between
 *   `package-lock.json` and npm's hidden `node_modules/.package-lock.json`
 *   (`repo-45`'s Decision section measured it), which is exactly why this
 *   reads the declared lockfile and not that hidden one: a version check
 *   would warn on every run over those two.
 */

import { existsSync, readFileSync } from "node:fs";
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
 * problem, and the farm's own existence check already covers it).
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
 * 0 clean, 1 stale. `worktree-farm.sh` calls this and discards the exit code
 * on purpose: the decision above is to warn, not to refuse, so a stale shared
 * checkout never blocks a dispatch.
 *
 * @param {string} sharedRoot
 * @returns {number}
 */
export function warnIfStale(sharedRoot) {
  const missing = findMissingPackages(sharedRoot);
  if (missing === null || missing.length === 0) return 0;
  process.stderr.write(
    [
      `warning: ${sharedRoot} is missing ${missing.length} package(s) that ` +
        `${path.join(sharedRoot, "package-lock.json")} declares:`,
      ...missing.map((name) => `  ${name}`),
      `remedy: run \`npm install\` in the shared checkout (${sharedRoot}), then re-run the farm.`,
    ].join("\n") + "\n",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sharedRoot = process.argv[2];
  if (!sharedRoot) {
    process.stderr.write("usage: node check-farm-freshness.mjs <shared-root>\n");
    process.exitCode = 1;
  } else {
    process.exitCode = warnIfStale(sharedRoot);
  }
}
