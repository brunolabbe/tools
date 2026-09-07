/**
 * The next free ticket id, and every claimant of every id above the merged
 * high-water mark.
 *
 * This was a bash snippet in `.claude/skills/orchestrate-tickets/reference/
 * concurrency.md` until repo-30. It was wrong for months in two ways that both
 * produced a *confident* answer — it read only `tools/<tool>/docs/work/`, so
 * for a `repo-` prefix its merged half matched nothing at all, and no command
 * in it checked an exit status, so a failed `gh` shortened the list instead of
 * stopping. Two id collisions on 2026-09-06/07 are the reproduction.
 *
 * It is a script and not a snippet for the reason `citations.mjs` gives about
 * itself: the work is mechanical, it must produce the same answer every time,
 * and a snippet has nowhere to put a test. Every guard below has one in
 * `scripts/test/next-id.test.ts`, and each of those tests was watched failing
 * against a build with that guard removed — a spec over a sweep never shown
 * failing is the same defect one layer up.
 *
 * **The exit codes are deliberately the child's own**, so the failure table in
 * `concurrency.md` keeps meaning what it said when it was measured against the
 * shell version: `gh` absent is 127, `gh` failing auth is 1, running outside a
 * repository is 128.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE = "usage: node scripts/next-id.mjs <prefix> [--repo <dir>] [--rev <ref>]";

/**
 * The two roots the ticket format actually has.
 *
 * `docs/work/` for repo-wide work and `tools/<tool>/docs/work/` for a tool
 * prefix. Reading one of them is the original defect, and it is silent: there is
 * no `tools/repo/`, so the merged half of a `repo-` sweep simply came back
 * empty and the answer came from open pull requests alone.
 */
export const TICKET_ROOTS = /** @type {const} */ (["docs/work/", "tools/*/docs/work/"]);

/** Non-empty lines of a command's output — every reader here wants the same thing. */
const lines = (out) => out.split("\n").filter(Boolean);

/** An error carrying the exit status the CLI should leave behind. */
function fail(message, exit) {
  return Object.assign(new Error(message), { exit });
}

/**
 * Run a command and refuse to use the output of one that failed.
 *
 * `spawnSync` rather than `execFileSync` so that `status` and `stdout` are both
 * in hand and the discard is written down rather than implied. **A command that
 * exits non-zero may still have written some of its output**, and taking that
 * partial stdout is precisely the sweep's original defect wearing different
 * clothes — a shorter list of ids, indistinguishable from a genuinely shorter
 * one. So the stdout of a failed run is never read.
 *
 * Argument arrays and no shell, per the repo-wide rule; a prefix reaches this.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 * @returns {string}
 */
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd });
  // ENOENT and friends: the command never ran, so there is no status to carry.
  // 127 is what a shell leaves behind for this, and the recorded measurements
  // are in those terms.
  if (result.error) {
    throw fail(`${command}: ${result.error.message}`, 127);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim().split("\n").slice(0, 3).join("\n");
    throw fail(
      `${command} ${args.join(" ")} exited ${result.status}` +
        `${detail ? `\n${detail}` : ""}\n` +
        `Refusing to answer from a partial file list — a short list of ids is\n` +
        `indistinguishable from a correct one, which is the defect this exists to avoid.`,
      result.status ?? 1,
    );
  }
  return result.stdout;
}

/**
 * Ids named by a list of paths, deduplicated, in the order they were found.
 *
 * The match is deliberately permissive — any path containing `<prefix>-<n>`
 * counts, rather than only paths shaped like a ticket file. Over-reporting a
 * claim costs a reader one glance; under-reporting one is the entire failure
 * this script exists to prevent, so the two errors are not weighed equally.
 *
 * @param {string[]} paths
 * @param {string} prefix
 * @returns {number[]}
 */
export function idsIn(paths, prefix) {
  const quoted = prefix.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const pattern = new RegExp(String.raw`\b${quoted}-(\d+)`, "gu");
  const seen = new Set();
  for (const line of paths) {
    for (const match of line.matchAll(pattern)) seen.add(Number(match[1]));
  }
  return [...seen];
}

/**
 * Every claim, with the source that holds it.
 *
 * Reporting only the maximum is what made the two collisions unreadable: `26`
 * with no source cannot be told from `26` when somebody else is sitting on 27.
 *
 * **Ties are broken by source name, never by input order.** The shell version
 * relied on GNU sort's last-resort whole-line comparison for this, and a gate
 * reviewer read the missing `-s` as a bug — it is the reverse, since `-s`
 * *disables* last-resort comparison and is what would have made two rows
 * holding one id swap between runs (measured, coreutils 9.4). That reasoning
 * does not survive a port, so the tie-break is explicit here instead.
 *
 * @param {{source: string, paths: string[]}[]} sources
 * @param {string} prefix
 * @returns {{source: string, id: number}[]}
 */
export function claims(sources, prefix) {
  const rows = sources.flatMap(({ source, paths }) =>
    idsIn(paths, prefix).map((id) => ({ source, id })),
  );
  return rows.toSorted(
    (a, b) => a.id - b.id || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
  );
}

/** The first id nobody holds: one past the highest claim, or 1 on an empty board. */
export function nextFree(rows) {
  return rows.length === 0 ? 1 : Math.max(...rows.map((r) => r.id)) + 1;
}

/**
 * Ids that more than one source claims — the thing a caller is actually looking
 * for, and the thing `sort -u` used to erase before anyone could see it.
 *
 * @param {{source: string, id: number}[]} rows
 * @returns {{id: number, sources: string[]}[]}
 */
export function clashes(rows) {
  const bySource = new Map();
  for (const { id, source } of rows) {
    bySource.set(id, [...(bySource.get(id) ?? []), source]);
  }
  return [...bySource.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([id, sources]) => ({ id, sources }));
}

/**
 * Read both ticket roots at a ref, plus every open pull request's diff.
 *
 * @param {string} prefix
 * @param {{run?: typeof runCommand, cwd?: string, rev?: string}} [options]
 */
export function collect(prefix, options = {}) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd;
  const rev = options.rev ?? "origin/main";

  const merged = [
    ...lines(run("git", ["ls-tree", rev, "docs/work/", "--name-only"], { cwd })),
    ...lines(run("git", ["ls-tree", "-r", rev, "tools/", "--name-only"], { cwd })).filter((p) =>
      p.includes("/docs/work/"),
    ),
  ];

  // Its own statement before the loop, and the ancestor of this line is why:
  // in the shell version the pull request list was inlined into a `for`, where
  // a failing command substitution has its status discarded even under
  // `set -e`. The sweep reported the merged half alone and exited 0 — the very
  // defect it had just been rewritten to fix.
  const prs = lines(
    run("gh", ["pr", "list", "--state", "open", "--json", "number", "--jq", ".[].number"], { cwd }),
  );

  const sources = [{ source: "merged", paths: merged }];
  for (const pr of prs) {
    // A pull request whose diff touches no ticket file is ordinary, and must
    // not shorten anything. In the shell version this was `grep`'s exit 1 on no
    // match, guarded with `|| true`; here an empty list is simply an empty list.
    sources.push({
      source: `PR#${pr}`,
      paths: lines(run("gh", ["pr", "diff", pr, "--name-only"], { cwd })),
    });
  }
  return sources;
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{prefix: string | null, repo: string | undefined, rev: string | undefined}} */
  const parsed = { prefix: null, repo: undefined, rev: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo" || arg === "--rev") {
      const value = argv[i + 1];
      if (value === undefined) throw fail(`${arg} needs a value\n${USAGE}`, 1);
      if (arg === "--repo") parsed.repo = value;
      else parsed.rev = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw fail(`unknown option ${arg}\n${USAGE}`, 1);
    } else if (parsed.prefix === null) {
      parsed.prefix = arg;
    } else {
      throw fail(`unexpected argument ${arg}\n${USAGE}`, 1);
    }
  }
  if (parsed.prefix === null) throw fail(USAGE, 1);
  return parsed;
}

/** @param {{source: string, id: number}[]} rows @param {string} prefix */
export function render(rows, prefix) {
  const out = rows.map(({ source, id }) => `${source} ${prefix}-${id}`);
  for (const { id, sources } of clashes(rows)) {
    out.push(`clash: ${prefix}-${id} is claimed by ${sources.join(", ")}`);
  }
  out.push(`next free: ${prefix}-${nextFree(rows)}`);
  return out.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const { prefix, repo, rev } = parseArgs(argv);
  const cwd = repo ?? path.resolve(import.meta.dirname, "..");
  const rows = claims(collect(prefix, { cwd, rev }), prefix);
  process.stdout.write(`${render(rows, prefix)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const failure = /** @type {Error & {exit?: number}} */ (error);
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = failure.exit ?? 1;
  }
}
