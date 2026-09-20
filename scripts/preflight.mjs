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
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runCommand } from "./next-id.mjs";
import { EXTRA_SCOPES, releasingTypes, toolScopes, validate } from "./commit-message.mjs";
import {
  SCOPE,
  SELF as CITATIONS_GATE_SELF,
  compareAgainst,
  gate as citationsGate,
  parseGrandfathered,
} from "./citations-gate.mjs";

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
 * lists them. `setup` is not a check's bit — it is what a missing or
 * unresolvable `--base` sets, before any check could even run, and is kept
 * outside 1–16 so it is never mistaken for one of the five.
 *
 * **`setup` used to be aspirational rather than true.** Repo-51's second gate
 * measured a bad `--base` exiting `128` — git's own status for an unresolvable
 * ref, propagated unchanged because nothing validated `base` before computing
 * a diff against it. `preflight`'s own prelude now verifies `base` resolves
 * before any check runs and raises `setup` itself when it does not, which is
 * what makes this docblock's claim true rather than merely intended.
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

/** @param {string} candidate */
export function isTicketPath(candidate) {
  return TICKET_PATTERNS.some((pattern) => pattern.test(candidate));
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
 * Root-level only — a nested `tools/<tool>/tsconfig.json` is that tool's own
 * and must not force the full suite, so a path carrying a `/` never matches
 * here whatever its basename. `tsconfig.*json` is a pattern rather than a
 * literal `tsconfig.json`/`tsconfig.tests.json` pair, so a third root
 * `tsconfig*.json` this repo adds later is shared config on the day it is
 * added, with nothing here to update — the same reasoning `commit-message.mjs`
 * gives for reading `TYPES` off `release-please-config.json` rather than a
 * second list.
 *
 * @param {string[]} diffPaths
 */
export function sharedConfigTouched(diffPaths) {
  const SHARED_FILES = new Set([
    "package.json",
    "package-lock.json",
    "vitest.config.ts",
    ".oxlintrc.json",
    ".oxfmtrc.json",
  ]);
  return diffPaths.some((p) => {
    if (p.startsWith("packages/")) return true;
    if (p.includes("/")) return false;
    return SHARED_FILES.has(p) || /^tsconfig.*\.json$/u.test(p);
  });
}

/**
 * `scripts/` is this script's own kind, and repo-51's second gate found the
 * gap: a branch touching only `scripts/` (this one, at its first gate) ran
 * `npm run check` alone and never its own suite, the `repo` vitest project —
 * so preflight could exit 0 on a branch that broke `scripts/test/next-id.test.ts`.
 * `scripts/test/` is named in the Build section but is already covered, since
 * every path under it starts with `scripts/` too.
 *
 * @param {string[]} diffPaths
 */
export function scriptsTouched(diffPaths) {
  return diffPaths.some((p) => p.startsWith("scripts/"));
}

/**
 * `npm run check`, plus whichever `npm test` a diff's own paths call for: the
 * full suite when shared config moved, the `repo` project when `scripts/`
 * moved, and one project per tool the diff touches — all three read from the
 * diff's own paths, never from a flag.
 *
 * @param {string[]} diffPaths
 * @returns {[string, string[]][]}
 */
export function testPlan(diffPaths) {
  const commands = [["npm", ["run", "check"]]];
  if (sharedConfigTouched(diffPaths)) {
    commands.push(["npm", ["test"]]);
    return commands;
  }
  if (scriptsTouched(diffPaths)) {
    commands.push(["npm", ["test", "--", "--project", "repo"]]);
  }
  for (const tool of touchedTools(diffPaths)) {
    commands.push(["npm", ["test", "--", "--project", tool]]);
  }
  return commands;
}

/** How many lines of a failing build command's own output to keep. */
const BUILD_FAILURE_TAIL = 40;

/**
 * Run one of `testPlan`'s commands and hand back its combined stdout and
 * stderr — `oxlint`, `oxfmt --check` and `vitest` all report on stdout, so a
 * runner that keeps only stderr (`runCommand`'s, right for git/gh plumbing)
 * would drop the diagnostic and leave only the command line and its status.
 * Reproduced on repo-51's own first gate: a failing `npm run check` printed
 * two sentences about a partial list of ids — `runCommand`'s own message,
 * written for `next-id.mjs`'s guard against a truncated sweep — and nothing
 * about what actually broke. That wording is `next-id.mjs`'s alone and must
 * never appear here, which is this function's whole reason to exist rather
 * than reusing `runCommand`.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 */
export function runBuildCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd });
  if (result.error) throw fail(`${command}: ${result.error.message}`, 127);
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    const tail = combined.split("\n").filter(Boolean).slice(-BUILD_FAILURE_TAIL).join("\n");
    throw fail(`${command} ${args.join(" ")} exited ${result.status}\n${tail}`, result.status ?? 1);
  }
  return combined;
}

/**
 * Check 1: the build and the suites the diff's own paths call for.
 *
 * @param {string} repo
 * @param {string[]} diffPaths
 * @param {typeof runBuildCommand} [run]
 */
export function checkBuild(repo, diffPaths, run = runBuildCommand) {
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

/**
 * The grandfather list `repo` itself carries, not this script's own
 * checkout's. **Low finding 7 on repo-51's first gate**: `checkCitations`
 * used to default to the imported `GRANDFATHERED` constant, which is this
 * script's own installation's list — right for the ordinary case, where
 * `repo` *is* this checkout, and silently wrong for `--repo <fixture>`, where
 * every entry belongs to a corpus the fixture does not have and printed as
 * `STALE`. Reading `repo`'s own copy of `citations-gate.mjs` off disk, via the
 * same `parseGrandfathered` the ratchet itself uses to read a historical
 * commit, means the two can never disagree about whose list this is.
 *
 * A `repo` with no such file — a fixture with no `scripts/` at all, or the
 * bootstrap commit before this gate existed — has no debt to grandfather,
 * which is a real state and not an error; `new Map()` says so without
 * `parseGrandfathered` ever running on a file that is not there.
 *
 * @param {string} repo
 * @returns {Map<string, number>}
 */
export function grandfatheredFor(repo) {
  let source;
  try {
    source = fs.readFileSync(path.join(repo, CITATIONS_GATE_SELF), "utf8");
  } catch {
    return new Map();
  }
  return parseGrandfathered(source) ?? new Map();
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
export function checkCitations(repo, base, grandfathered = grandfatheredFor(repo)) {
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
  // `validate`'s own `BYPASS` lets a merge/revert/fixup/squash subject through
  // with `ok: true` and no type at all — a branch's *own* commits are working
  // notes and may include one, and the default title source is the branch's
  // last commit subject. Reproduced on repo-51's second gate: a `--title` of
  // `Merge branch 'main' into work` passed this check silently, printing
  // `ok    "undefined" is hidden …` — `type` was `undefined`,
  // `types.includes(undefined)` is `false`, and the branch this precisely never
  // gets a type-versus-paths check. This must fail instead of quietly reading
  // as "hidden".
  if (type === undefined) {
    return {
      ok: false,
      bit: EXIT.title,
      name: "title",
      lines: [`FAIL  no conventional subject found in "${subject}"; pass --title`],
    };
  }
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
 * tree in hand. Reads `headRefOid` alongside `headRefName`: repo-51's second
 * gate found that comparing against `origin/<headRefName>` compares against
 * whatever this checkout last fetched, not against the head itself, and a
 * clone that has not fetched since a peer pushed reports a stale branch as
 * clean. The oid is the head; the ref name is only ever a label for it here.
 *
 * @param {typeof runCommand} run
 */
function defaultListOpenHeads(run) {
  return (/** @type {string} */ repo) => {
    const out = run(
      "gh",
      ["pr", "list", "--state", "open", "--json", "number,headRefName,headRefOid"],
      { cwd: repo },
    );
    /** @type {{number: number, headRefName: string, headRefOid: string}[]} */
    const parsed = JSON.parse(out || "[]");
    return parsed.map((p) => ({ number: p.number, headRefName: p.headRefName, oid: p.headRefOid }));
  };
}

/**
 * Check 5: `git merge-tree --write-tree HEAD <head>` against every other open
 * pull request head's own commit oid, naming the conflicting paths and which
 * of them are ticket files — a conflict there is a gate record two branches
 * both touched, `orchestrate-tickets/SKILL.md` step 11's recurring failure.
 *
 * **Compared by oid, not by ref name, and excluded by oid too.** Two fixes in
 * one, from repo-51's second gate: comparing against `origin/<headRefName>`
 * went stale the moment a peer pushed since this checkout last fetched (med
 * finding 1), and excluding "the current branch's own pull request" by
 * `git rev-parse --abbrev-ref HEAD` returned the literal string `HEAD` in a
 * detached worktree, so a branch's own pull request was never excluded there
 * (low finding 6). `git rev-parse HEAD` — the oid, not the ref — has no
 * detached-or-not distinction to get wrong.
 *
 * **An oid this checkout does not have is a failure, not a skip.** A pull
 * request head genuinely cannot be compared without fetching it, and reporting
 * it clean because nothing was checked is the same silent gap the ref-name
 * comparison had, one layer down; naming the fetch to run is the repair, not
 * excusing the check.
 *
 * **The zero-heads case says so explicitly rather than reporting `ok` with no
 * further line.** An empty pull request list must not read like "checked
 * everything, found nothing" — repo-51's own Done when names this as the
 * positive control a silent pass would defeat.
 *
 * @param {string} repo
 * @param {{run?: typeof runCommand, spawn?: typeof spawnRaw, listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[]}} [options]
 */
export function checkMergeTree(repo, options = {}) {
  const run = options.run ?? runCommand;
  const spawn = options.spawn ?? spawnRaw;
  const listOpenHeads = options.listOpenHeads ?? defaultListOpenHeads(run);

  const headOid = run("git", ["rev-parse", "HEAD"], { cwd: repo }).trim();
  const heads = listOpenHeads(repo).filter((h) => h.oid !== headOid);

  const out = [`comparing HEAD against ${heads.length} other open pull request head(s)`];
  let problems = 0;
  for (const head of heads) {
    let reachable = true;
    try {
      run("git", ["cat-file", "-e", `${head.oid}^{commit}`], { cwd: repo });
    } catch {
      reachable = false;
    }
    if (!reachable) {
      problems += 1;
      out.push(
        `FAIL  #${head.number} ${head.headRefName} is at ${head.oid.slice(0, 7)}, which this ` +
          `checkout does not have — run \`git fetch origin\` and re-run; a head that cannot be ` +
          `compared is not clean`,
      );
      continue;
    }

    let result;
    try {
      result = mergeTreeConflicts(repo, "HEAD", head.oid, spawn);
    } catch (error) {
      problems += 1;
      const message = /** @type {Error} */ (error).message.split("\n")[0];
      out.push(`FAIL  #${head.number} ${head.headRefName} could not be compared: ${message}`);
      continue;
    }
    if (!result.conflict) {
      out.push(`ok    #${head.number} ${head.headRefName} merges cleanly with HEAD`);
      continue;
    }
    problems += 1;
    const gateRecords = result.paths.filter(isTicketPath);
    out.push(
      `FAIL  #${head.number} ${head.headRefName} conflicts on: ${result.paths.join(", ")}` +
        (gateRecords.length > 0 ? ` — gate record(s): ${gateRecords.join(", ")}` : ""),
    );
  }
  if (problems === 0) {
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
 * Run one check and never let it take the other four down with it.
 *
 * Repo-51's second gate: nothing wrapped an individual check's own internal
 * calls, so `gh` failing inside check 5 — an expired token, a repository with
 * no GitHub remote, a pull request head this checkout cannot fetch — aborted
 * the whole run before checks 1 through 4 printed anything, and the failing
 * child's own raw exit status (`gh`'s auth failure is `4`) landed in the exit
 * code, indistinguishable from `EXIT.review`. A thrown error now becomes that
 * check's own FAIL line and its own bit, so a `gh` outage costs check 5's
 * verdict and nothing else's.
 *
 * @param {string} name
 * @param {number} bit
 * @param {() => {ok: boolean, bit: number, name: string, lines: string[]}} run
 */
function guarded(name, bit, run) {
  try {
    return run();
  } catch (error) {
    const message = /** @type {Error} */ (error).message;
    return {
      ok: false,
      bit,
      name,
      lines: [`FAIL  ${name} threw:`, ...message.split("\n").map((l) => `      ${l}`)],
    };
  }
}

/**
 * Every check, in the Build section's order. `diffPaths` is computed once,
 * against `${base}...HEAD`, and handed to whichever checks read the diff —
 * check 1 and check 4 — rather than each recomputing it.
 *
 * `base` is verified to resolve before anything else runs. A `--base` that
 * does not exist in this checkout is not any one check's problem — every
 * check but check 5 reads `base` or the diff against it — so it is raised as
 * `EXIT.setup` here, before the per-check guard below, rather than surfacing
 * as whichever check happened to call `git` first with the bad ref.
 *
 * @param {string} repo
 * @param {{
 *   base: string,
 *   title?: string,
 *   run?: typeof runCommand,
 *   buildRun?: typeof runBuildCommand,
 *   spawn?: typeof spawnRaw,
 *   grandfathered?: Map<string, number>,
 *   listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[],
 * }} options
 */
export function preflight(repo, options) {
  const { base, title, run = runCommand, buildRun, spawn, grandfathered, listOpenHeads } = options;
  if (!base) throw fail(`--base is required\n${USAGE}`, EXIT.setup);

  let diffPaths;
  try {
    run("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd: repo });
    diffPaths = lines(run("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: repo }));
  } catch (error) {
    throw fail(
      `--base ${base} could not be read: ${/** @type {Error} */ (error).message}`,
      EXIT.setup,
    );
  }

  return [
    guarded("check", EXIT.check, () => checkBuild(repo, diffPaths, buildRun)),
    guarded("citations", EXIT.citations, () => checkCitations(repo, base, grandfathered)),
    guarded("review", EXIT.review, () => checkReview(repo, diffPaths, run)),
    guarded("title", EXIT.title, () => checkTitle(repo, diffPaths, title, run)),
    guarded("mergeTree", EXIT.mergeTree, () => checkMergeTree(repo, { run, spawn, listOpenHeads })),
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
