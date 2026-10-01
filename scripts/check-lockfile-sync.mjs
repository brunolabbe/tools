/**
 * `ci.yml`'s check job, option C of repo-46: a release commit stamps each
 * tool's `api/package.json` with its new version and never touches
 * `package-lock.json`, whose own `packages` map mirrors that same version —
 * so the lockfile falls behind on every release until some unrelated
 * commit's `npm install` catches it up and carries the diff. This is C
 * beside repo-46's option A, the `extra-files` lockfile stamp in
 * `release-please-config.json`: A can fail silently if the stamp does
 * nothing, and this script is what turns that into a red release PR instead
 * of a quiet drift.
 *
 * A wrapper script, not the raw `npm install --package-lock-only …` line the
 * ticket's Build section names, for two reasons, both measured:
 *
 * 1. `scripts/preflight.mjs` refuses to spawn any `npm` command it does not
 *    already recognise as `npm ci` or `npm run check` (repo-82), and the
 *    unit test that pins its output over the real `ci.yml` throws the same
 *    "does not recognise" error the moment the raw line is added.
 * 2. Preflight therefore spawns this script for real, in every builder's and
 *    gate's farm worktree — and an install run *there* rewrites npm's hidden
 *    lockfile, `node_modules/.package-lock.json`, which in a farm worktree
 *    is a symlink into the shared checkout (repo-46 gate 1). So the install
 *    runs in a temporary directory that holds only what npm reads to resolve
 *    a lockfile — the root manifest, the lockfile and each workspace's
 *    `package.json` — and the lockfile it produces there is compared with
 *    the committed one. Nothing is written into `cwd`, and no `node_modules`
 *    is created anywhere.
 *
 * Flags: `--package-lock-only --offline --ignore-scripts` are the ones the
 * Build section names; `--no-audit --no-fund` are added here, and only stop
 * npm from reaching for the network or printing a banner.
 *
 * `--offline` is unmeasured on a GitHub runner, where it depends on the
 * cache `npm ci` just filled rather than on the local cache this was timed
 * against (repo-46's ticket, under Options). If it fails there for that
 * reason, drop `--offline` from the array below rather than the step.
 *
 * Workspace discovery understands only literal path segments and `*`, which
 * is all the root `package.json`'s `workspaces` field uses; a `**` or a
 * brace pattern there would need this to grow.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCKFILE = "package-lock.json";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string}} options
 * @returns {{status: number | null, error?: Error | undefined}}
 */
function run(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, stdio: "inherit", shell: false });
}

/**
 * Every directory a `workspaces` glob names that holds a `package.json`,
 * relative to `root`.
 *
 * @param {string} root
 * @param {string[]} patterns
 * @returns {string[]}
 */
function workspaceDirs(root, patterns) {
  /** @type {string[]} */
  const found = [];
  /**
   * @param {string} dir
   * @param {string[]} segments
   */
  const walk = (dir, segments) => {
    if (segments.length === 0) {
      if (fs.existsSync(path.join(root, dir, "package.json"))) found.push(dir);
      return;
    }
    const [head, ...rest] = segments;
    if (head !== "*") {
      walk(path.join(dir, head), rest);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        walk(path.join(dir, entry.name), rest);
      }
    }
  };
  for (const pattern of patterns) walk("", pattern.split("/"));
  return found;
}

/**
 * Copies what npm reads to resolve a lockfile into `into`: the root manifest,
 * the lockfile, an `.npmrc` if there is one, and every workspace manifest.
 *
 * @param {string} cwd
 * @param {string} into
 */
function stage(cwd, into) {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  const patterns = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
  const files = ["package.json", LOCKFILE, ".npmrc"];
  for (const dir of workspaceDirs(cwd, patterns)) files.push(path.join(dir, "package.json"));
  for (const file of files) {
    const from = path.join(cwd, file);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(into, file)), { recursive: true });
    fs.copyFileSync(from, path.join(into, file));
  }
}

/**
 * @param {string} cwd
 * @param {typeof run} [runCommand]
 * @returns {number}
 */
export function checkLockfileSync(cwd, runCommand = run) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-sync-"));
  try {
    stage(cwd, scratch);
    const install = runCommand(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: scratch },
    );
    if (install.error !== undefined) {
      process.stderr.write(`could not run npm: ${install.error.message}\n`);
      return 1;
    }
    if (install.status !== 0) return install.status ?? 1;

    const diff = runCommand(
      "git",
      [
        "diff",
        "--no-index",
        "--exit-code",
        "--",
        path.join(cwd, LOCKFILE),
        path.join(scratch, LOCKFILE),
      ],
      { cwd },
    );
    if (diff.error !== undefined) {
      process.stderr.write(`could not run git diff: ${diff.error.message}\n`);
      return 1;
    }
    if (diff.status !== 0) {
      process.stderr.write(
        "package-lock.json is out of sync with the package.json versions it should " +
          "mirror (repo-46) — the diff above (committed, then regenerated) is what a " +
          "release stamp forgot to carry.\n",
      );
    }
    return diff.status ?? 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = checkLockfileSync(process.cwd());
}
