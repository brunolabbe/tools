/**
 * One command in place of the four pre-PR checks the orchestration history
 * kept forgetting by hand: the citations gate, the `## Review` record, the
 * title's type against its paths, and a merge-tree probe against every other
 * open pull request.
 *
 * repo-51's Why names four recurring "what the skill got wrong" items, each
 * one command, each costing a round when missed — the citations gate not run
 * before the push (nineteenth session, recurred in the twentieth and
 * twenty-first), a `## Review` section absent from a branch that opened its
 * pull request anyway (`repo-29`, fourteenth session), a `feat`/`fix` title on
 * a branch whose only `tools/` paths were markdown (seventeenth and twentieth
 * sessions), and two open branches a `git merge-tree` would have shown
 * conflicting on a gate record (seventeenth, nineteenth, twentieth). The
 * argument for building this rather than adding a fifth reminder to a page is
 * `scripts/next-id.mjs`'s: prose rules failed for eleven sessions running, and
 * the one instrument in this loop that stopped being wrong is the one that
 * became a script with a test per guard.
 *
 * **Every check reuses the tool that already enforces it, rather than
 * re-deriving its judgement:**
 *
 *   - check 1 shells out to `npm run check` and, for each tool the diff
 *     touches, `npm test -- --project <tool>` — read from the diff's own
 *     paths, never from a flag, so a forgotten `--project` cannot silently
 *     skip a tool's suite the way a hand-typed one can.
 *   - check 2 imports `gate` and `compareAgainst` from `citations-gate.mjs`
 *     directly, over the same `SCOPE` that script enforces in CI, so a
 *     citation this failed on is the same citation CI's `check` job fails on.
 *   - check 3 reads a ticket's frontmatter and its `## Review` heading off
 *     `git show HEAD:<ticket>` — the same command
 *     `orchestrate-tickets/SKILL.md` step 9 names as this precondition today.
 *   - check 4 imports `validate` and `releasingTypes` from
 *     `commit-message.mjs` rather than re-implementing the convention, and
 *     reads which types are hidden off `release-please-config.json` **at run
 *     time**, in the repository this is checking — never a list copied here,
 *     which would drift the day that file changes and this one does not.
 *   - check 5 runs real `git merge-tree --write-tree`, not a heuristic: two
 *     branches genuinely conflict or they do not, and asking `gh` which pull
 *     requests are open is the only part that cannot be answered from the
 *     tree in hand.
 *
 * **The exit code is a bitmask** (`EXIT`), the same shape `citations.mjs`
 * chose for the same reason: the five failure classes co-occur, and a ranking
 * would collapse them exactly when there is most to say. The bit names are
 * printed with the number, so a CI log or a ship-condition check says what the
 * number meant next to the number.
 *
 * Plain `.mjs`, no build step, matching every other script under `scripts/`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runCommand } from "./next-id.mjs";
import { EXTRA_SCOPES, releasingTypes, toolScopes, validate } from "./commit-message.mjs";
import { GRANDFATHERED, SCOPE, compareAgainst, gate as citationsGate } from "./citations-gate.mjs";

export const USAGE =
  "usage: node scripts/preflight.mjs --base <ref> [--title <text>] [--repo <dir>]";

/** An error carrying the exit status the CLI should leave behind. */
function fail(message, exit) {
  return Object.assign(new Error(message), { exit });
}

/** Non-empty lines of a command's output. */
const lines = (out) => out.split("\n").filter(Boolean);

/**
 * Which bit of the exit code each check sets, in the order the Build section
 * lists them. `setup` is not a check's bit — it is what a bad `--base` or an
 * unreadable repository sets, before any check could even run, and is kept
 * outside 1–16 so it is never mistaken for one of the five.
 */
export const EXIT = /** @type {const} */ ({
  check: 1,
  citations: 2,
  review: 4,
  title: 8,
  mergeTree: 16,
  setup: 64,
});

/**
 * A path this repository's ticket format could hold, read off
 * `citations-gate.mjs`'s own `SCOPE.records` rather than a second copy of the
 * glob — the two must agree on where a ticket lives, or check 3 and check 5
 * could disagree with the gate that already enforces this shape in CI.
 *
 * `SCOPE.records` is always one `*` per path segment standing in for "not a
 * slash", which is what makes a textual translation to `RegExp` safe here; a
 * glob with a `**` or a character class would need a real glob library, and
 * repo-25's own note on why the pathspec is spelled `*.md` and not `work/` is
 * the reason none of these ever will be.
 *
 * @param {string} glob
 */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/gu, String.raw`\$&`).replace(/\*/gu, "[^/]*");
  return new RegExp(`^${escaped}$`, "u");
}

const TICKET_PATTERNS = SCOPE.records.map(globToRegExp);

/** @param {string} path */
export function isTicketPath(path) {
  return TICKET_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The tools a diff touches, read from its own paths — never from a `--project`
 * flag a caller could mistype or forget.
 *
 * @param {string[]} diffPaths
 * @returns {string[]}
 */
export function touchedTools(diffPaths) {
  const found = new Set();
  for (const p of diffPaths) {
    const match = /^tools\/([^/]+)\//u.exec(p);
    if (match) found.add(match[1]);
  }
  return [...found].toSorted();
}

/**
 * Config shared by more than one tool's suite. Touching any of it invalidates
 * a per-tool run the way `builder.md`'s gate list already says: "full `npm
 * test` if shared config moved."
 *
 * @param {string[]} diffPaths
 */
export function sharedConfigTouched(diffPaths) {
  const SHARED_FILES = new Set([
    "package.json",
    "package-lock.json",
    "vitest.config.ts",
    "tsconfig.json",
    "tsconfig.tests.json",
    ".oxlintrc.json",
    ".oxfmtrc.json",
  ]);
  return diffPaths.some((p) => SHARED_FILES.has(p) || p.startsWith("packages/"));
}

/**
 * `npm run check`, plus whichever `npm test` a diff's own paths call for.
 *
 * @param {string[]} diffPaths
 * @returns {[string, string[]][]}
 */
export function testPlan(diffPaths) {
  const commands = [["npm", ["run", "check"]]];
  if (sharedConfigTouched(diffPaths)) {
    commands.push(["npm", ["test"]]);
  } else {
    for (const tool of touchedTools(diffPaths)) {
      commands.push(["npm", ["test", "--", "--project", tool]]);
    }
  }
  return commands;
}

/**
 * Check 1: the build and the suites the diff's own paths call for.
 *
 * @param {string} repo
 * @param {string[]} diffPaths
 * @param {typeof runCommand} [run]
 */
export function checkBuild(repo, diffPaths, run = runCommand) {
  const out = [];
  for (const [command, args] of testPlan(diffPaths)) {
    const label = `${command} ${args.join(" ")}`;
    try {
      run(command, args, { cwd: repo });
      out.push(`ok    ${label}`);
    } catch (error) {
      const message = /** @type {Error} */ (error).message;
      out.push(`FAIL  ${label}`, ...message.split("\n").map((l) => `      ${l}`));
      return { ok: false, bit: EXIT.check, name: "check", lines: out };
    }
  }
  return { ok: true, bit: 0, name: "check", lines: out };
}

/** The `state: count` half of a record's counts, for a one-line summary. */
const countLine = (counts = {}) =>
  Object.entries(counts)
    .map(([state, n]) => `${n} ${state}`)
    .join(", ") || "nothing";

/**
 * Check 2: `citations-gate.mjs`'s own verdict over the corpus, plus its ratchet
 * against `base` — the same two things `node scripts/citations-gate.mjs
 * --against <base>` reports, called as functions rather than spawned so a test
 * can point both at one fixture repository without a second copy of
 * `scripts/` inside it.
 *
 * @param {string} repo
 * @param {string} base
 * @param {Map<string, number>} [grandfathered]
 */
export function checkCitations(repo, base, grandfathered = GRANDFATHERED) {
  const result = citationsGate(repo, SCOPE, grandfathered);
  const problems = [];
  for (const r of result.failed) problems.push(`FAIL  ${r.record} — ${countLine(r.counts)}`);
  for (const r of result.regressed) {
    problems.push(`WORSE ${r.record} — ${r.failing} failing, its entry allows ${r.allowed}`);
  }
  for (const r of result.staleEntries) problems.push(`STALE ${r.record} — ${r.why}`);

  let history;
  try {
    history = compareAgainst(repo, base, grandfathered);
  } catch (error) {
    return {
      ok: false,
      bit: EXIT.citations,
      name: "citations",
      lines: [...problems, `FAIL  compareAgainst ${base}: ${/** @type {Error} */ (error).message}`],
    };
  }
  for (const r of history.raised) {
    problems.push(`RAISED ${r.record} — its GRANDFATHERED entry went from ${r.was} to ${r.now}`);
  }

  if (problems.length === 0) {
    return {
      ok: true,
      bit: 0,
      name: "citations",
      lines: [
        `ok    citation gate clean over ${result.inScope.length} record(s), ` +
          `${result.excused.length} grandfathered` +
          (history.skipped === null ? ` — checked against ${base}` : ` (${history.skipped})`),
      ],
    };
  }
  return { ok: false, bit: EXIT.citations, name: "citations", lines: problems };
}

/**
 * Check 3: every ticket this branch marks `done` carries a `## Review`
 * section — `git show HEAD:<ticket> | grep '^## Review'`, per ticket, with a
 * distinct message for the one that has none. `diffPaths` is the one already
 * computed against `${base}...HEAD`, filtered to the ticket roots
 * `citations-gate.mjs`'s own `SCOPE` names.
 *
 * @param {string} repo
 * @param {string[]} diffPaths
 * @param {typeof runCommand} [run]
 */
export function checkReview(repo, diffPaths, run = runCommand) {
  const changed = diffPaths.filter(isTicketPath);

  const out = [];
  let missing = 0;
  for (const ticket of changed) {
    let content;
    try {
      content = run("git", ["show", `HEAD:${ticket}`], { cwd: repo });
    } catch {
      // Deleted on this branch — nothing left to carry a Review section.
      continue;
    }
    const status = /^status:\s*(\S+)\s*$/mu.exec(content)?.[1];
    if (status !== "done") continue;
    if (/^## Review\b/mu.test(content)) {
      out.push(`ok    ${ticket} is done and carries a ## Review section`);
    } else {
      missing += 1;
      out.push(`FAIL  ${ticket} is marked done but has no ## Review section`);
    }
  }
  if (missing === 0) {
    return {
      ok: true,
      bit: 0,
      name: "review",
      lines: out.length > 0 ? out : ["ok    no ticket on this branch is newly marked done"],
    };
  }
  return { ok: false, bit: EXIT.review, name: "review", lines: out };
}

/**
 * Check 4: the intended title, read off `--title` or the branch's last commit
 * subject, checked by `commit-message.mjs`'s own `validate`, then — only when
 * the type reaches a changelog — checked against the diff's own `tools/`
 * paths. `releasingTypes` and `toolScopes` are both called against `repo`, the
 * repository under test, so a fixture repository's own
 * `release-please-config.json` decides the answer rather than this script's
 * own installation.
 *
 * @param {string} repo
 * @param {string[]} diffPaths
 * @param {string | undefined} title
 * @param {typeof runCommand} [run]
 */
export function checkTitle(repo, diffPaths, title, run = runCommand) {
  const subject = title ?? run("git", ["log", "-1", "--format=%s"], { cwd: repo }).trim();
  const types = releasingTypes(repo);
  const scopes = [...toolScopes(repo), ...EXTRA_SCOPES];
  const { ok, errors } = validate(subject, { scopes, releasingTypes: types });
  if (!ok) {
    return {
      ok: false,
      bit: EXIT.title,
      name: "title",
      lines: [`FAIL  "${subject}" is not a valid title:`, ...errors.map((e) => `      ${e}`)],
    };
  }

  const type = /^(?<type>[a-z]+)/u.exec(subject)?.groups?.type;
  // `types === null` means the config could not be read; treated the same as
  // "reaches a changelog", the conservative reading `validate` itself uses via
  // `SCOPE_REQUIRED_FALLBACK` for the same reason — assuming the quieter answer
  // when the source of truth cannot be read is how a changelog line gets cut
  // silently.
  const reachesChangelog = types === null || types.includes(type);
  if (!reachesChangelog) {
    return {
      ok: true,
      bit: 0,
      name: "title",
      lines: [
        `ok    "${type}" is hidden in release-please-config.json — no changelog line either way`,
      ],
    };
  }

  const toolPaths = diffPaths.filter((p) => /^tools\/[^/]+\//u.test(p));
  const allMarkdown = toolPaths.length > 0 && toolPaths.every((p) => p.endsWith(".md"));
  if (allMarkdown) {
    return {
      ok: false,
      bit: EXIT.title,
      name: "title",
      lines: [
        `FAIL  "${subject}" is type "${type}", which reaches a changelog, but every tools/ path`,
        `      in the diff is markdown (${toolPaths.join(", ")}) — release-please would cut a`,
        `      changelog line and a version for that tool over what is really a docs-only change`,
      ],
    };
  }
  return { ok: true, bit: 0, name: "title", lines: [`ok    "${subject}" — type and paths agree`] };
}

/**
 * Run a command and hand back its exit status and output whatever that status
 * is — unlike `runCommand`, which is right for plumbing that has exactly one
 * good outcome. `git merge-tree --write-tree` does not: exit 0 is a clean
 * merge and exit 1 is a **reported** conflict, both meaningful, and only
 * anything else is the kind of failure `runCommand` exists to catch.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 */
function spawnRaw(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd });
  if (result.error) throw fail(`${command}: ${result.error.message}`, 127);
  return result;
}

/**
 * The conflicting paths out of `git merge-tree --write-tree`'s default
 * (non-`--name-only`, non-`-z`) output: a tree oid, then zero or more
 * `<mode> <oid> <stage>\t<path>` lines — one per conflicting path per stage —
 * ending at the first blank line, ahead of the informational messages.
 * Measured against real git 2.43: a clean merge prints only the oid, and a
 * conflicting one prints three stage lines per conflicted path followed by an
 * `Auto-merging`/`CONFLICT` pair.
 *
 * @param {string} output
 * @returns {string[]}
 */
export function parseMergeTreeConflicts(output) {
  const paths = new Set();
  for (const line of output.split("\n").slice(1)) {
    if (line === "") break;
    const match = /^\d{6} [0-9a-f]{40} [123]\t(.+)$/u.exec(line);
    if (match) paths.add(match[1]);
  }
  return [...paths];
}

/**
 * **The exit status alone cannot tell a conflict from a bad ref.** Measured
 * against real git 2.43: `git merge-tree --write-tree main no-such-ref` exits
 * `1` — the same status a genuine conflict leaves — with empty stdout and the
 * reason on stderr (`merge-tree: no-such-ref - not something we can merge`).
 * A real merge, clean or conflicting, always writes its tree oid as stdout's
 * first line; that is the discriminator this uses instead of the status code.
 *
 * @param {string} repo
 * @param {string} ours
 * @param {string} theirs
 * @param {typeof spawnRaw} [spawn]
 */
export function mergeTreeConflicts(repo, ours, theirs, spawn = spawnRaw) {
  const result = spawn("git", ["merge-tree", "--write-tree", ours, theirs], { cwd: repo });
  const stdout = result.stdout ?? "";
  if (stdout.trim() === "") {
    throw fail(
      `git merge-tree --write-tree ${ours} ${theirs} exited ${result.status}\n` +
        `${(result.stderr ?? "").trim()}`,
      result.status ?? 1,
    );
  }
  if (result.status === 0) return { conflict: false, paths: [] };
  return { conflict: true, paths: parseMergeTreeConflicts(stdout) };
}

/**
 * `gh pr list`, the only part of check 5 that cannot be answered from the
 * tree in hand.
 *
 * @param {typeof runCommand} run
 */
function defaultListOpenHeads(run) {
  return (/** @type {string} */ repo) => {
    const out = run("gh", ["pr", "list", "--state", "open", "--json", "number,headRefName"], {
      cwd: repo,
    });
    /** @type {{number: number, headRefName: string}[]} */
    const parsed = JSON.parse(out || "[]");
    return parsed.map((p) => ({ ...p, ref: `origin/${p.headRefName}` }));
  };
}

/**
 * Check 5: `git merge-tree --write-tree HEAD <head>` against every other open
 * pull request head, naming the conflicting paths and which of them are
 * ticket files — a conflict there is a gate record two branches both touched,
 * `orchestrate-tickets/SKILL.md` step 11's recurring failure.
 *
 * **The zero-heads case says so explicitly rather than reporting `ok` with no
 * further line.** An empty pull request list must not read like "checked
 * everything, found nothing" — repo-51's own Done when names this as the
 * positive control a silent pass would defeat.
 *
 * @param {string} repo
 * @param {{run?: typeof runCommand, spawn?: typeof spawnRaw, listOpenHeads?: (repo: string) => {number: number, headRefName: string, ref?: string}[]}} [options]
 */
export function checkMergeTree(repo, options = {}) {
  const run = options.run ?? runCommand;
  const spawn = options.spawn ?? spawnRaw;
  const listOpenHeads = options.listOpenHeads ?? defaultListOpenHeads(run);

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo }).trim();
  const heads = listOpenHeads(repo).filter((h) => h.headRefName !== currentBranch);

  const out = [`comparing HEAD against ${heads.length} other open pull request head(s)`];
  let conflicts = 0;
  for (const head of heads) {
    const ref = head.ref ?? `origin/${head.headRefName}`;
    const result = mergeTreeConflicts(repo, "HEAD", ref, spawn);
    if (!result.conflict) {
      out.push(`ok    #${head.number} ${head.headRefName} merges cleanly with HEAD`);
      continue;
    }
    conflicts += 1;
    const gateRecords = result.paths.filter(isTicketPath);
    out.push(
      `FAIL  #${head.number} ${head.headRefName} conflicts on: ${result.paths.join(", ")}` +
        (gateRecords.length > 0 ? ` — gate record(s): ${gateRecords.join(", ")}` : ""),
    );
  }
  if (conflicts === 0) {
    out.push(
      heads.length === 0
        ? "no other open pull request to compare against — nothing was checked"
        : "no conflicts with any other open pull request head",
    );
    return { ok: true, bit: 0, name: "mergeTree", lines: out };
  }
  return { ok: false, bit: EXIT.mergeTree, name: "mergeTree", lines: out };
}

/**
 * Every check, in the Build section's order. `diffPaths` is computed once,
 * against `${base}...HEAD`, and handed to whichever checks read the diff —
 * check 1 and check 4 — rather than each recomputing it.
 *
 * @param {string} repo
 * @param {{
 *   base: string,
 *   title?: string,
 *   run?: typeof runCommand,
 *   spawn?: typeof spawnRaw,
 *   grandfathered?: Map<string, number>,
 *   listOpenHeads?: (repo: string) => {number: number, headRefName: string, ref?: string}[],
 * }} options
 */
export function preflight(repo, options) {
  const { base, title, run = runCommand, spawn, grandfathered, listOpenHeads } = options;
  if (!base) throw fail(`--base is required\n${USAGE}`, EXIT.setup);

  const diffPaths = lines(run("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: repo }));

  return [
    checkBuild(repo, diffPaths, run),
    checkCitations(repo, base, grandfathered),
    checkReview(repo, diffPaths, run),
    checkTitle(repo, diffPaths, title, run),
    checkMergeTree(repo, { run, spawn, listOpenHeads }),
  ];
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{base: string | null, title: string | undefined, repo: string | undefined}} */
  const parsed = { base: null, title: undefined, repo: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base" || arg === "--title" || arg === "--repo") {
      const value = argv[i + 1];
      if (value === undefined) throw fail(`${arg} needs a value\n${USAGE}`, EXIT.setup);
      if (arg === "--base") parsed.base = value;
      else if (arg === "--title") parsed.title = value;
      else parsed.repo = value;
      i += 1;
    } else {
      throw fail(`unknown argument ${arg}\n${USAGE}`, EXIT.setup);
    }
  }
  if (parsed.base === null) throw fail(`--base is required\n${USAGE}`, EXIT.setup);
  return parsed;
}

export function main(argv = process.argv.slice(2)) {
  const { base, title, repo: repoArg } = parseArgs(argv);
  const repo =
    repoArg ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

  const results = preflight(repo, { base, title });
  let bitmask = 0;
  for (const result of results) {
    process.stdout.write(`\n== ${result.name} ==\n`);
    for (const line of result.lines) process.stdout.write(`${line}\n`);
    bitmask |= result.bit;
  }

  const names = Object.entries(EXIT)
    .filter(([name, bit]) => name !== "setup" && (bitmask & bit) !== 0)
    .map(([name]) => name);
  process.stdout.write(
    `\n${bitmask === 0 ? "preflight passed" : `preflight failed: ${names.join(", ")}`} (exit ${bitmask})\n`,
  );
  process.exitCode = bitmask;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const failure = /** @type {Error & {exit?: number}} */ (error);
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = failure.exit ?? EXIT.setup;
  }
}
