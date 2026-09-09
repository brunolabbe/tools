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
 *
 * **Three sources, and the third is repo-41's.** Merged files at a ref, open
 * pull request diffs, and every branch the remote itself has — because a branch
 * that is pushed and has no pull request yet is in neither of the first two, and
 * a ticket file committed on one was being handed out as free. It still cannot
 * see a peer's *local, unpushed* branch, and it says so rather than implying the
 * race is closed; see `branchSources` below.
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
 * One claimant: a label, the paths it holds, and — only when the sweep could
 * not read that source in full — a line saying so.
 *
 * `note` is not an error. A branch whose commit this checkout has never fetched
 * is the ordinary state, not a broken repository, and refusing to answer would
 * make the tool unusable exactly when a peer is working. It is also not folded
 * into `source`, because a label prints only when its source produced a row and
 * the dangerous branch is the one that produces none.
 *
 * @typedef {{source: string, paths: string[], note?: string}} Source
 */

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
 * @param {Source[]} sources
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
 * The remote's own branch list, and what each branch adds over `rev`.
 *
 * repo-41's source: a branch that is **pushed but carries no open pull
 * request** has not merged and has no PR diff, so a ticket file committed on it
 * claims an id the other two sources both report as free. Measured on `main` at
 * `a5e31c7`: the sweep printed `next free: repo-39` while
 * `docs/work/repo-39-….md` was already pushed on
 * `repo-37-anchor-planner-review-corpus`.
 *
 * Three choices here, each of which was the alternative to something worse.
 *
 * **`ls-remote`, not `refs/remotes/`.** The local mirror is wrong in both
 * directions at once: it keeps branches the remote has deleted (a plain
 * `git fetch` does not prune — twelve refs against the remote's five, measured
 * in repo-41's worktree), and it does not have a branch pushed since your last
 * fetch at all. Reading it is the "answering confidently from a different tree"
 * this file refuses to do everywhere else.
 *
 * **A diff, not an `ls-tree` — the same reason `gh pr diff` is a diff.** A tree
 * listing returns every ticket file a branch *contains*, so `main` itself and
 * any long-lived branch cut from it would each re-report the whole merged set
 * and clash with `merged` on every id. A three-dot diff is the branch's own
 * contribution, which makes the trunk head self-excluding with no special case.
 *
 * **The branch name counts too**, as a floor. It is the weaker kind of claim —
 * `concurrency.md` is about commit subjects and PR titles lying in opposite
 * directions, and a branch name is the same kind of thing — but it costs
 * nothing, it catches a branch created before its ticket file was committed,
 * and it is all that is left when the commit has not been fetched.
 *
 * **What it does not reach**: a peer's *local, unpushed* branch. That is the
 * state the 2026-09-06/07 collisions actually were, and no sweep of a remote
 * can see it. This removes one of the two ways to lose the race, not the race.
 *
 * @param {{run?: typeof runCommand, cwd?: string, rev?: string, remote?: string}} [options]
 * @returns {Source[]}
 */
export function branchSources(options = {}) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd;
  const rev = options.rev ?? "origin/main";
  // Hardcoded for the same reason the default `rev` is `origin/main`: this is a
  // repo script, and a remote nobody can name is a flag nobody would pass.
  const remote = options.remote ?? "origin";

  return lines(run("git", ["ls-remote", "--heads", remote], { cwd })).map((head) => {
    const tab = head.indexOf("\t");
    // Not skipped. A line this cannot parse means the sweep would answer from a
    // shorter branch list than the remote has, which is the whole defect.
    if (tab === -1) {
      throw fail(`git ls-remote --heads ${remote}: unreadable line ${JSON.stringify(head)}`, 1);
    }
    const sha = head.slice(0, tab);
    const name = head.slice(tab + 1).replace(/^refs\/heads\//u, "");
    const source = `branch/${name}`;
    const paths = [name];

    // Probed before the diff, so that any *other* git failure below is a real
    // one and propagates. `ls-remote` can name a sha this object store has never
    // heard of, and both `cat-file` and `diff` exit 128 on it — measured against
    // a fixture remote in `scripts/test/next-id.test.ts`.
    try {
      run("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd });
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      if (!/not a valid object name/iu.test(failure.message)) throw failure;
      return {
        source,
        paths,
        note:
          `unread: branch ${name} is on ${remote} at ${sha.slice(0, 7)}, which is not in this ` +
          `checkout — only its name was read; run \`git fetch ${remote}\` and re-run for its files`,
      };
    }

    try {
      paths.push(...lines(run("git", ["diff", "--name-only", `${rev}...${sha}`], { cwd })));
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      // An orphan branch — `gh-pages` and its kin — shares no history with
      // `rev`, and a symmetric difference with no merge base is fatal, which
      // would take the whole sweep down with it. Fall back to the plain
      // two-dot diff, which over-reports (every file that differs, not just the
      // branch's own) — and per `idsIn` above, over-reporting is the cheap
      // error here and under-reporting is the expensive one.
      if (!/no merge base/iu.test(failure.message)) throw failure;
      paths.push(...lines(run("git", ["diff", "--name-only", rev, sha], { cwd })));
      return {
        source,
        paths,
        note:
          `unrelated: branch ${name} shares no history with ${rev}, so every file that differs ` +
          `was read, not just the branch's own — expect it to over-claim`,
      };
    }
    return { source, paths };
  });
}

/**
 * Read both ticket roots at a ref, plus every open pull request's diff, plus
 * every branch the remote has.
 *
 * @param {string} prefix
 * @param {{run?: typeof runCommand, cwd?: string, rev?: string, remote?: string}} [options]
 * @returns {Source[]}
 */
export function collect(prefix, options = {}) {
  const run = options.run ?? runCommand;
  const cwd = options.cwd;
  const rev = options.rev ?? "origin/main";

  /**
   * `origin/main` is not present in every checkout, and the failure reads as a
   * bare `fatal: Not a valid object name` with no hint about what to do.
   *
   * A default `actions/checkout` fetches one commit and creates no
   * remote-tracking ref at all, so this is the *ordinary* state on a runner and
   * in any shallow clone — it is not an edge case. It is also how repo-30's own
   * spec first went red: the test asserting `gh`-absent-is-127 never reached
   * `gh`, because git failed 128 first, and locally it passed because this
   * worktree happened to have the ref.
   *
   * The status stays the child's own. Only the advice is added — falling back
   * to `HEAD` would answer confidently from a different tree, which is this
   * ticket's defect in one more costume.
   */
  const lsTree = (args) => {
    try {
      return lines(run("git", args, { cwd }));
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      if (/not a valid object name|unknown revision|bad revision/iu.test(failure.message)) {
        failure.message +=
          `\n\`${rev}\` is not in this checkout. A shallow clone and a default CI checkout have no` +
          `\nremote-tracking refs — run \`git fetch origin main\`, or pass \`--rev HEAD\` to sweep` +
          `\nthe tree you have. This does not fall back on its own: answering from a different tree` +
          `\nwithout saying so is the defect this command exists to prevent.`;
      }
      throw failure;
    }
  };

  const merged = [
    ...lsTree(["ls-tree", rev, "docs/work/", "--name-only"]),
    ...lsTree(["ls-tree", "-r", rev, "tools/", "--name-only"]).filter((p) =>
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

  /** @type {Source[]} */
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

  // Last, and the order is load-bearing for one test rather than for the
  // answer: `gh` is spawned before this reaches the network, so the case that
  // measures `gh`-absent-is-127 still dies at `gh` and not at `ls-remote`.
  sources.push(...branchSources({ run, cwd, rev, remote: options.remote }));
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

/**
 * The claims, then any clash, then anything the sweep could not read, then the
 * answer.
 *
 * `notes` sits immediately above `next free` on purpose: the last two lines a
 * caller reads are what this could not see and the number it is handing out
 * anyway. A note is printed whether or not its source produced a row, which is
 * the point — a branch named `wip-x` holding `repo-50-….md`, not yet fetched,
 * claims nothing at all, and the note is the only thing standing between that
 * and silence.
 *
 * @param {{source: string, id: number}[]} rows
 * @param {string} prefix
 * @param {string[]} [notes]
 */
export function render(rows, prefix, notes = []) {
  const out = rows.map(({ source, id }) => `${source} ${prefix}-${id}`);
  for (const { id, sources } of clashes(rows)) {
    out.push(`clash: ${prefix}-${id} is claimed by ${sources.join(", ")}`);
  }
  out.push(...notes);
  out.push(`next free: ${prefix}-${nextFree(rows)}`);
  return out.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const { prefix, repo, rev } = parseArgs(argv);
  const cwd = repo ?? path.resolve(import.meta.dirname, "..");
  const sources = collect(prefix, { cwd, rev });
  const rows = claims(sources, prefix);
  const notes = sources.flatMap((source) => (source.note ? [source.note] : []));
  process.stdout.write(`${render(rows, prefix, notes)}\n`);
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
