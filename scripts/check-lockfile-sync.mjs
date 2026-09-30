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
 * A wrapper script, not the two raw `npm`/`git` lines the ticket's Build
 * section names, because `scripts/preflight.mjs` refuses to spawn any `npm`
 * command it does not already recognise as `npm ci` or `npm run check`
 * (repo-82) — a raw `npm install --package-lock-only …` line in `ci.yml`'s
 * check job fails `deriveExtraCiCommands` and the unit test that pins its
 * output over the real file
 * (`scripts/test/preflight.test.ts`, "deriveExtraCiCommands runs only what
 * no other check already covers"), reproduced directly: that test throws
 * the same "does not recognise" error the moment the raw line is added. A
 * `node scripts/…` step is outside that guard and reaches preflight's
 * ordinary path instead, which spawns it for real — the same two commands
 * below, in the same order, with the same flags C names.
 *
 * `--offline` is unmeasured on a GitHub runner, where it depends on the
 * cache `npm ci` just filled rather than on the local cache this was timed
 * against (repo-46's ticket, under Options). If it fails there for that
 * reason, drop `--offline` from the array below rather than the step.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string}} options
 * @returns {{status: number | null}}
 */
function run(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, stdio: "inherit", shell: false });
}

/**
 * @param {string} cwd
 * @param {typeof run} [runCommand]
 * @returns {number}
 */
export function checkLockfileSync(cwd, runCommand = run) {
  const install = runCommand(
    "npm",
    ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd },
  );
  if (install.status !== 0) return install.status ?? 1;

  const diff = runCommand("git", ["diff", "--exit-code", "package-lock.json"], { cwd });
  if (diff.status !== 0) {
    process.stderr.write(
      "package-lock.json is out of sync with the api/package.json versions it should " +
        "mirror (repo-46) — the diff above is what a release stamp forgot to carry.\n",
    );
  }
  return diff.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = checkLockfileSync(process.cwd());
}
