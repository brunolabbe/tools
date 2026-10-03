/**
 * One command in place of the four pre-PR checks the orchestration history
 * kept forgetting by hand: the `## Review` record, the title's type against
 * its paths, and a merge-tree probe against every other open pull request. A
 * fourth, the citations gate, was check 2 until adr/006 retired the citation
 * checker; its exit bit is not reused.
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
 * **The exit code is a bitmask** (`EXIT`): the failure classes co-occur, and a ranking
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
import { EXTRA_SCOPES, TYPES, releasingTypes, toolScopes, validate } from "./commit-message.mjs";
import { hasGateRecord } from "./status.mjs";

export const USAGE =
  "usage: node scripts/preflight.mjs --base <ref> [--title <text>] [--repo <dir>]";

/** An error carrying the exit status the CLI should leave behind. */
function fail(message, exit) {
  return Object.assign(new Error(message), { exit });
}

/** Non-empty lines of a command's output. */
const lines = (out) => out.split("\n").filter(Boolean);

/**
 * Spawn a plumbing command (`git`, `gh`) and hand back its stdout, or throw
 * with its exit status attached and never read a failed command's partial
 * stdout.
 *
 * **Deliberately not `next-id.mjs`'s exported `runCommand`, which this file
 * used until round 3.** That function's failure message is `next-id.mjs`'s
 * own — two sentences about a truncated id sweep, written for a guard this
 * script does not have — and round 2's fifth med finding was already this
 * project's reason to stop routing check 1's `npm`/`vitest` output through it
 * (`runBuildCommand`, above). Round 3's low finding is the same wording
 * reaching a user a second way: `guarded()` prints a thrown error's message
 * verbatim, so a `gh` or `git` failure elsewhere in preflight still surfaced
 * `next-id.mjs`'s sentences on stdout or stderr. This keeps `runCommand`'s two
 * real guarantees — a failed command's stdout is never read, and a command
 * not on `PATH` is reported as "not found" at 127 — without importing its
 * prose along with them.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 */
function runGit(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd, shell: false });
  if (result.error) throw fail(`${command}: ${result.error.message}`, 127);
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim().split("\n").slice(0, 3).join("\n");
    throw fail(
      `${command} ${args.join(" ")} exited ${result.status}${detail ? `\n${detail}` : ""}`,
      result.status ?? 1,
    );
  }
  return result.stdout;
}

/**
 * Which bit of the exit code each check sets, in the order the Build section
 * lists them. `setup` is not a check's bit — it is what a missing or
 * unresolvable `--base` sets, before any check could even run, and is kept
 * outside 1–32 so it is never mistaken for one of the six.
 *
 * **`setup` used to be aspirational rather than true.** Repo-51's second gate
 * measured a bad `--base` exiting `128` — git's own status for an unresolvable
 * ref, propagated unchanged because nothing validated `base` before computing
 * a diff against it. `preflight`'s own prelude now verifies `base` resolves
 * before any check runs and raises `setup` itself when it does not, which is
 * what makes this docblock's claim true rather than merely intended.
 *
 * **`ciCommands` is repo-79's addition.** Checks 1–5 above reuse the tool that
 * already enforces the rule they check; this bit is what is left over once
 * that reuse is subtracted from `ci.yml`'s own `check` job — `npm ci` (setup,
 * not a check) and `npm run check` (check 1's own first command) have a
 * dedicated check already and are matched exactly, by name, in `COVERED`; what
 * is left is derived from `ci.yml` itself and spawned for real, so a step that
 * job gains later is caught by construction rather than by someone updating
 * this file to match it — which is exactly how #305 passed preflight twice and
 * then failed CI on a `citations.mjs --require-anchors` run this script did
 * not have.
 */
export const EXIT = /** @type {const} */ ({
  check: 1,
  // 2 was `citations`, retired with the citation checker (adr/006).
  review: 4,
  title: 8,
  mergeTree: 16,
  ciCommands: 32,
  setup: 64,
});

/**
 * A path this repository's ticket format could hold, per `TICKET_GLOBS`
 * below.
 *
 * Each glob is always one `*` per path segment standing in for "not a
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

/** Where a ticket lives: the repo's own work directory, and each tool's. */
const TICKET_GLOBS = ["docs/work/*.md", "tools/*/docs/work/*.md"];
const TICKET_PATTERNS = TICKET_GLOBS.map(globToRegExp);

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
 * a per-tool run the way the builder role's gate list already says: "full
 * `npm test` if shared config moved."
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
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd, shell: false });
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

/** Where `ci.yml`'s `check` job lives, relative to `repo`. */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/** A step's own list marker, at the fixed indent every job in this file uses. */
const STEP_START = /^ {6}- /u;

/** A top-level job key — `  <name>:` at exactly two spaces, nothing narrower. */
const JOB_HEADER = /^ {2}[A-Za-z0-9_-]+:\s*$/u;

/** A `run:` key, whether it is a step's first key (after `- `) or a later one. */
const RUN_KEY = /^ {6}- run:(.*)$|^ {8}run:(.*)$/u;

/** The block-scalar headers YAML recognises — chomping indicator included. */
const BLOCK_SCALAR_TOKENS = new Set(["|", "|-", "|+", ">", ">-", ">+"]);

/**
 * `ci.yml`'s `check` job, split into its steps — one entry per `- ` list item,
 * each carrying every line from its own start up to (not including) the next
 * step or the job's end. Comment and blank lines are dropped before grouping,
 * since a full-line `#` comment between two steps — this file's own style,
 * everywhere — would otherwise read as trailing content of the step above it.
 *
 * @param {string} yamlText
 * @returns {{startLine: number, lines: string[]}[]}
 */
function extractCheckJobSteps(yamlText) {
  const rows = yamlText.split("\n");
  const start = rows.indexOf("  check:");
  if (start === -1) {
    throw new Error(`${CI_WORKFLOW_PATH} has no top-level "check:" job`);
  }
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    if (JOB_HEADER.test(rows[i])) {
      end = i;
      break;
    }
  }
  /** @type {{startLine: number, lines: string[]}[]} */
  const steps = [];
  /** @type {{startLine: number, lines: string[]} | null} */
  let current = null;
  for (let i = start + 1; i < end; i++) {
    const line = rows[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (STEP_START.test(line)) {
      if (current) steps.push(current);
      current = { startLine: i + 1, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) steps.push(current);
  return steps;
}

/**
 * The raw `run:` command of every step in `ci.yml`'s `check` job that carries
 * one, in the order they run, read as text rather than parsed as YAML.
 *
 * **A step is read only in the one shape this trusts: `run:` as its sole key,
 * on one line, nothing above or below it.** A step with no `run:` key at all —
 * `uses: actions/checkout@v7` and its `with:` — carries no command and is
 * silently skipped, which loses nothing. A step that *does* carry `run:` but
 * is not that one shape — `name:` or `if:` ahead of it, a block scalar
 * (`run: |`, `run: |-`, `run: >-`, …), a `working-directory:` or `env:`
 * alongside it — throws, naming the step, rather than either silently
 * skipping it (the defect gate 1 measured for `name:`/`if:`-first steps: the
 * old single-line regex never matched their `run:` at all, so the step, its
 * command and any block scalar inside it vanished with nothing failing) or
 * silently running it missing the modifier that changes what it does
 * (`working-directory:`, `env:`). Gate 1's own reproduction, `extractCheckJobCommands`
 * over 16 mutations of the real file, is what this shape is built to close.
 *
 * @param {string} yamlText
 * @returns {string[]}
 */
export function extractCheckJobCommands(yamlText) {
  const commands = [];
  for (const step of extractCheckJobSteps(yamlText)) {
    const runLines = step.lines.filter((l) => RUN_KEY.test(l));
    if (runLines.length === 0) continue; // no `run:` key — not a command, nothing lost.
    const first = step.lines[0];
    const runMatch = RUN_KEY.exec(runLines[0]);
    const value = (runMatch[1] ?? runMatch[2] ?? "").trim();
    // Exactly one line, and it is `run:`'s: the one shape this trusts. Any
    // other line in the step — `name:`/`if:` ahead of `run:`, a block
    // scalar's own content below it, `working-directory:`, `env:` — makes
    // `step.lines.length` more than 1, whatever order they came in.
    if (step.lines.length > 1 || value === "" || BLOCK_SCALAR_TOKENS.has(value)) {
      const reason = BLOCK_SCALAR_TOKENS.has(value)
        ? "a block scalar"
        : "other keys (name, if, working-directory, env, …) or a value spanning more than one line";
      throw new Error(
        `${CI_WORKFLOW_PATH}'s check job has a run step this parser cannot read faithfully ` +
          `(${reason}), at line ${step.startLine}: ${first}`,
      );
    }
    commands.push(value);
  }
  return commands;
}

/**
 * `npm`'s own rewrite table for `npm ci`, read by `canonicalize` below: every
 * alias `npm ci --help` lists (`clean-install`, `ic`, `install-clean`,
 * `isntall-clean`) mapped to `"ci"`, so `canonicalize` can compare any of the
 * five spellings as one.
 *
 * **Used to know only the first (repo-79 gate 3's new low, closed by
 * repo-82).** `npm ci --help` lists `aliases: clean-install, ic,
 * install-clean, isntall-clean` — measured directly, this file's docblock is
 * not the source of truth for npm's own alias table — and the other three
 * matched no guard at all, so `npm ic`, `npm install-clean` and `npm
 * isntall-clean` in the check job would each have spawned a real install the
 * same way `npm clean-install` once did. All four now rewrite to `"ci"`.
 *
 * @type {Record<string, "ci">}
 */
const NPM_ALIASES = /** @type {const} */ ({
  "clean-install": "ci",
  ic: "ci",
  "install-clean": "ci",
  "isntall-clean": "ci",
});

/**
 * @param {string} raw
 * @returns {string}
 */
function canonicalize(raw) {
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  const [cmd, sub, ...rest] = collapsed.split(" ");
  if (cmd === "npm" && Object.hasOwn(NPM_ALIASES, sub)) {
    return [cmd, NPM_ALIASES[/** @type {keyof typeof NPM_ALIASES} */ (sub)], ...rest].join(" ");
  }
  return collapsed;
}

/**
 * The three commands `ci.yml`'s `check` job runs that already have a
 * dedicated, better check elsewhere in this file, and would only cost time to
 * repeat here for an identical verdict — `npm ci` (dependency installation,
 * not a check; this script's own precondition, `worktree-farm.sh` then
 * `npm run build`, already establishes the tree, and running it again would
 * need the network this repo's own worktree rule forbids reaching for),
 * and `npm run check` (check 1's own first command, in every `testPlan`
 * already).
 *
 * **Each entry both recognises a step and holds it to an exact form.**
 * `guard` is deliberately looser than `exact` — it is what lets this tell "an
 * attempt at the covered step, spelled differently" (fail loudly) apart from
 * "an unrelated step that happens to share no words with it" (fall through to
 * the generic path below). Gate 1 measured the cost of collapsing that
 * distinction into `guard` alone: `npm ci --ignore-scripts` used to fail
 * `raw === "npm ci"` and fall through *uncaught*, so preflight spawned `npm ci`
 * for real inside a worktree built on the farm — exactly what `common.md`
 * forbids and what "`npm ci` is never spawned" now guarantees can't happen
 * silently again, whatever the step's exact text.
 *
 * **Both `guard` and `exact` compare `canonicalize(raw)`, not `raw` itself —
 * gate 2's low.** Two spellings reached neither side of the pair, whitespace
 * matched nowhere it was collapsed and an alias `npm` itself defines was not
 * known to this file at all: `npm  ci` (two spaces) matched neither the guard
 * nor the exact form and fell through to `assertSpawnable`/`tokenize`, which
 * split it on whitespace anyway and spawned a real `npm ci`; `npm
 * clean-install` — `npm`'s own alias for `npm ci`, `npm help ci` names it —
 * matched no guard at all and spawned a real install under a different name.
 * `canonicalize` collapses whitespace runs to one space and rewrites the
 * alias to the name it stands for, so both now compare equal to `"npm ci"`
 * and are never spawned, the same as the plain spelling.
 *
 * @type {{guard: (raw: string) => boolean, exact: string}[]}
 */
const COVERED = [
  {
    guard: (raw) => {
      const c = canonicalize(raw);
      return c === "npm ci" || c.startsWith("npm ci ");
    },
    exact: "npm ci",
  },
  {
    guard: (raw) => {
      const c = canonicalize(raw);
      return c === "npm run check" || c.startsWith("npm run check ");
    },
    exact: "npm run check",
  },
];

/**
 * A raw command's own words, as argv — quote-aware but nothing fancier,
 * because every command that reaches this is a plain `node <script> --flag
 * value` line with no shell operator and no variable expansion of its own,
 * which `assertSpawnable` below verifies before this ever runs. A `>` token is
 * a shell redirection this file never spawns a shell to honour, so it and
 * everything after it (`/dev/null`) is dropped rather than handed to
 * `spawnSync` as a literal argument.
 *
 * @param {string} raw
 * @returns {[string, string[]]}
 */
export function tokenize(raw) {
  const tokens = [];
  const WORD = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  let match;
  while ((match = WORD.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  const redirect = tokens.indexOf(">");
  const argv = redirect === -1 ? tokens : tokens.slice(0, redirect);
  return [argv[0], argv.slice(1)];
}

/**
 * A command this parser did not already reject as unreadable (`extractCheckJobCommands`,
 * one line, one key) can still be one `spawnSync` cannot run faithfully: `&&`
 * chains a second command, `|` pipes to one, `;` sequences one, a trailing
 * `# comment` is text YAML's own reader would have stripped before the shell
 * ever saw it, a glued redirect (`>/dev/null`, `2>/dev/null`, no space either
 * side) is invisible to `tokenize`'s own "a lone `>` token" rule and would
 * reach `spawnSync` as a literal argument, `$VAR` is never expanded with no
 * shell to expand it, and a whole `run:` value wrapped in one pair of quotes
 * — YAML's own quoting, not an argument's — is read by `tokenize` as a
 * single, space-containing "command name" rather than the words inside it.
 * None of these seven is spawned with a shell here (the repo-wide rule this
 * file itself is scanned for), so none can be honoured either — this is what
 * tells "cannot be run faithfully" from "can", and throws rather than handing
 * any of them to `spawnSync` as a literal, meaningless argument.
 *
 * **Gate 2's low, disclosed rather than closed for the fully general case**:
 * this still trusts that a legitimate argument never itself contains one of
 * these characters quoted for a reason — `--message ";"` would be flagged as
 * a sequencing operator it is not. `ci.yml`'s own check job has no such
 * argument today, and the seven shapes above are exactly the ones gate 2
 * measured reaching `spawnSync` unrecognised; a quoted argument that
 * legitimately needs one of these characters is a real gap this does not
 * close, left for the day `ci.yml` actually needs one.
 *
 * @param {string} raw
 */
export function assertSpawnable(raw) {
  if (raw.includes("${{")) {
    throw new Error(
      `ci.yml's check job has a templated command this parser cannot resolve: ${raw}`,
    );
  }
  // A whole `run:` value quoted at the YAML level — `run: "node x.mjs --y"`
  // — rather than an unquoted plain scalar carrying its own internally
  // quoted argument (`node scripts/citations-gate.mjs --against "origin/…"`,
  // which starts with `node`, not a quote).
  const whollyQuoted = /^"[\s\S]*"$/u.test(raw) || /^'[\s\S]*'$/u.test(raw);
  // A `>` not surrounded by whitespace on both sides — the one shape
  // `tokenize`'s redirect-drop (an exact `>` token) does not see, since a
  // glued redirect never becomes its own token at all.
  const gluedRedirect = /(?<!\s)>|>(?!\s)/u.test(raw);
  if (
    raw.includes("&&") ||
    raw.includes("|") ||
    raw.includes(";") ||
    raw.includes("$") ||
    / #/u.test(raw) ||
    whollyQuoted ||
    gluedRedirect
  ) {
    throw new Error(
      `ci.yml's check job has a command this parser cannot spawn faithfully (a shell operator, ` +
        `a glued redirect, an unexpanded $VAR, a wholly quoted value or a trailing comment, ` +
        `never run through a shell here): ${raw}`,
    );
  }
}

/**
 * Every `check`-job command this file does not already run some other way,
 * parsed into `[command, args]` — a covered step (`COVERED` above) matched
 * exactly is dropped; a step whose text merely resembles one throws; anything
 * else is checked for a shell operator or comment this file cannot honour and
 * then tokenized.
 *
 * **Any other `npm` step throws too, never falls through to a real spawn**
 * (repo-82's low). `NPM_ALIASES` only rewrites the four spellings `npm ci
 * --help` lists, but npm resolves its own commands and aliases by
 * unambiguous prefix as well — `npm install-clea` and `npm isntall-cl` both
 * run a real `npm ci` under npm's own resolution, and `npm cit`
 * (`install-ci-test`) is a fifth, related alias this file never named at all.
 * Enumerating every prefix npm would accept is not this file's job; refusing
 * to spawn *any* `npm` step it cannot already name exactly is what keeps a
 * spelling nobody has measured yet from reaching a real install inside a
 * worktree the farm — not `npm` — built, the same guarantee `NPM_ALIASES`
 * gives the four spellings it does know.
 *
 * @param {string} yamlText
 * @returns {[string, string[]][]}
 */
export function deriveExtraCiCommands(yamlText) {
  const out = [];
  for (const raw of extractCheckJobCommands(yamlText)) {
    const covered = COVERED.find((c) => c.guard(raw));
    if (covered) {
      if (canonicalize(raw) !== covered.exact) {
        throw new Error(
          `ci.yml's check job runs "${raw}", which looks like ${JSON.stringify(covered.exact)} ` +
            `but is not that exactly — preflight will not guess whether the difference matters.`,
        );
      }
      continue; // matched exactly: covered elsewhere, never spawned here.
    }
    if (canonicalize(raw).split(" ")[0] === "npm") {
      throw new Error(
        `ci.yml's check job runs "${raw}", an npm step this file does not recognise as ` +
          `"npm ci" or "npm run check" — npm resolves its own abbreviations and aliases too ` +
          `(clean-install, ic, install-clean, isntall-clean, cit, and any unambiguous prefix of ` +
          `those), so preflight will not guess whether this one is safe to spawn.`,
      );
    }
    assertSpawnable(raw);
    out.push(tokenize(raw));
  }
  return out;
}

/**
 * Check 6 (repo-79): every `ci.yml` `check`-job command this file does not
 * already run through a dedicated check, spawned exactly as `ci.yml` spawns
 * it. A repository with no `ci.yml` at all — every fixture in this suite that
 * does not plant one — has nothing to check here, which is a real state and
 * not an error.
 *
 * @param {string} repo
 * @param {typeof runBuildCommand} [run]
 */
export function checkCiCommands(repo, run = runBuildCommand) {
  let yamlText;
  try {
    yamlText = fs.readFileSync(path.join(repo, CI_WORKFLOW_PATH), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return {
        ok: true,
        bit: 0,
        name: "ciCommands",
        lines: [`ok    no ${CI_WORKFLOW_PATH} here — nothing to check`],
      };
    }
    return {
      ok: false,
      bit: EXIT.ciCommands,
      name: "ciCommands",
      lines: [`FAIL  could not read ${CI_WORKFLOW_PATH}: ${/** @type {Error} */ (error).message}`],
    };
  }

  let commands;
  try {
    commands = deriveExtraCiCommands(yamlText);
  } catch (error) {
    return {
      ok: false,
      bit: EXIT.ciCommands,
      name: "ciCommands",
      lines: [`FAIL  ${/** @type {Error} */ (error).message}`],
    };
  }

  const out = [];
  for (const [command, args] of commands) {
    const label = `${command} ${args.join(" ")}`;
    try {
      run(command, args, { cwd: repo });
      out.push(`ok    ${label}`);
    } catch (error) {
      const message = /** @type {Error} */ (error).message;
      out.push(`FAIL  ${label}`, ...message.split("\n").map((l) => `      ${l}`));
      return { ok: false, bit: EXIT.ciCommands, name: "ciCommands", lines: out };
    }
  }
  return { ok: true, bit: 0, name: "ciCommands", lines: out };
}

/**
 * Check 3: every ticket this branch marks `done` carries a `## Review`
 * section, as `status.mjs`' `hasGateRecord` reads one (repo-73), per ticket, with a
 * distinct message for the one that has none. `diffPaths` is the one already
 * computed against `${base}...HEAD`, filtered to the ticket roots.
 *
 * @param {string} repo
 * @param {string[]} diffPaths
 * @param {typeof runGit} [run]
 */
export function checkReview(repo, diffPaths, run = runGit) {
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
    if (hasGateRecord(content)) {
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
 * @param {typeof runGit} [run]
 */
export function checkTitle(repo, diffPaths, title, run = runGit) {
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
  // `validate`'s own `BYPASS` lets a merge, revert, fixup, squash or amend
  // subject through with `ok: true` and no convention enforced at all — a
  // branch's *own* commits are working notes and may carry one, and the
  // default title source is the branch's last commit subject. Reproduced on
  // repo-51's second gate: a `--title` of `Merge branch 'main' into work`
  // passed this check silently, printing `ok    "undefined" is hidden …`.
  //
  // **`type === undefined` alone is not the whole guard, and gate 2 measured
  // the gap rather than assumed it.** `Merge ` and `Revert "` both start
  // uppercase, so `/^[a-z]+/` extracts nothing from either and `type` really
  // is `undefined` there. `fixup! `, `squash! ` and `amend! ` do not: they are
  // lowercase, and the regex happily reads `"fixup"`, `"squash"` and
  // `"amend"` out of them, none of which is a real type. Checked at gate 2:
  // `--title "fixup! feat(downloader): document a thing (dl-1)"` on the same
  // fixture that fails a `feat` title with bit 8 instead printed `ok
  // "fixup" is hidden in release-please-config.json` — a word that appears in
  // that file nowhere at all — and exited 0. So the type must also be a
  // member of `commit-message.mjs`'s own `TYPES`, the only types that can ever
  // be genuine, rather than merely present.
  if (type === undefined || !TYPES.includes(type)) {
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
  const result = spawnSync(command, args, { encoding: "utf8", cwd: options.cwd, shell: false });
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
 * @param {typeof spawnRaw} [run] not `spawn`: spawn-safety matches by name (repo-83)
 */
export function mergeTreeConflicts(repo, ours, theirs, run = spawnRaw) {
  const result = run("git", ["merge-tree", "--write-tree", ours, theirs], { cwd: repo });
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
 * **Every entry's `headRefOid` is checked before it is used.** Round 3's low
 * finding: a `gh` version, or a caller-supplied `listOpenHeads`, that omits
 * the field left `head.oid` as `undefined`, and `mergeTreeConflicts` calling
 * `.slice(0, 7)` on it surfaced a raw `TypeError` naming no PR and no fix —
 * a check 5 that still failed at the right bit, on the wrong words. This
 * fails here instead, naming the PR and the field that was missing.
 *
 * @param {typeof runGit} run
 */
function defaultListOpenHeads(run) {
  return (/** @type {string} */ repo) => {
    const out = run(
      "gh",
      ["pr", "list", "--state", "open", "--json", "number,headRefName,headRefOid"],
      { cwd: repo },
    );
    /** @type {{number: number, headRefName: string, headRefOid?: string}[]} */
    const parsed = JSON.parse(out || "[]");
    return parsed.map((p) => {
      if (typeof p.headRefOid !== "string" || p.headRefOid === "") {
        throw fail(
          `gh pr list did not report headRefOid for PR #${p.number} (${p.headRefName}) — pass ` +
            `--json number,headRefName,headRefOid explicitly, or upgrade gh`,
          1,
        );
      }
      return { number: p.number, headRefName: p.headRefName, oid: p.headRefOid };
    });
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
 * @param {{run?: typeof runGit, spawn?: typeof spawnRaw, listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[]}} [options]
 */
export function checkMergeTree(repo, options = {}) {
  const run = options.run ?? runGit;
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
  }

  return problems === 0
    ? { ok: true, bit: 0, name: "mergeTree", lines: out }
    : { ok: false, bit: EXIT.mergeTree, name: "mergeTree", lines: out };
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
 * Every path the working tree itself carries right now, beyond `HEAD` — the
 * union of what is staged, what is modified-but-unstaged and what is
 * untracked — read from `git status --porcelain=v1 -z` rather than the line
 * form, because a renamed path's line form (`R  old -> new`) is a string to
 * split on `" -> "`, which a path containing that exact substring would
 * break; `-z` gives each side of a rename as its own NUL-terminated field
 * instead.
 *
 * `--untracked-files=all` overrides two things a plain `git status` would
 * otherwise leave to the caller's own config, neither obvious from reading
 * this function alone (repo-65 gate 1, two lows, both measured): a
 * repository with `status.showUntrackedFiles=no` set returns nothing at all
 * for an untracked path without it (checked: an untracked file, that config
 * set, plain `git status --porcelain=v1 -z` → `""`; with the flag → the file,
 * named); and without it, an entirely untracked directory collapses to one
 * `dir/` entry rather than its files (checked: an untracked
 * `tools/planner/d.ts` with no tracked `tools/` above it → `tools/`
 * without the flag, `tools/planner/d.ts` with it). The returned set is
 * therefore paths, not always *file* paths, without this flag — with it,
 * every entry is a real file or a real directory's own path, never a stand-in
 * for "something changed under here."
 *
 * This is repo-65's fix, and it is deliberately narrow: it hands back paths,
 * never a verdict, and the caller decides which checks should see them.
 * Today that is check 1 alone (`testSelectionPaths`, below) — checks 3 and 4
 * keep reading `diffPaths`, committed-only, per repo-65's decision (b).
 *
 * @param {string} repo
 * @param {typeof runGit} run
 * @returns {string[]}
 */
export function workingTreePaths(repo, run) {
  const fields = run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: repo,
  }).split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (entry === "") continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // A rename or copy carries the original path as a second NUL-terminated
    // field right after this one — consume it here rather than leaving it to
    // be misread as its own, statusless entry on the next loop turn.
    if (status.includes("R") || status.includes("C")) {
      i += 1;
      paths.push(fields[i]);
    }
  }
  return paths;
}

/**
 * Every check, in the Build section's order.
 *
 * Two path sets, not one, since repo-65: `diffPaths` is `${base}...HEAD`,
 * committed history only, computed once and handed to whichever checks read
 * *committed* state — check 3 (`checkReview`) and check 4 (`checkTitle`).
 * `testSelectionPaths` unions `diffPaths` with `workingTreePaths` (above) and
 * is what check 1 (`checkBuild`) reads to decide which suites to run, so a
 * suite under active edit — staged, unstaged or untracked, not yet committed
 * — is still selected rather than silently skipped (repo-65's own
 * reproduction: an uncommitted edit under `scripts/test/` ran no `repo`
 * project suite at all). This still leaves two trees rather than one — checks
 * 1 alone on the working tree, checks 3–4 on committed state, check 2
 * (`checkCitations`) unconditional on disk for a record's contents but
 * index-based for which records it selects — repo-65's Why has the full
 * three-way split this narrows from. Widening checks 3–4 the same way was
 * repo-65's option (a), decided against: it would have meant refusing a dirty
 * tree outright, which costs three rewritten places across
 * orchestrate-tickets' own builder and fixer pages — the pre-report gate list
 * and both pages' fix-round steps run `preflight.mjs` ahead of a commit, by
 * design, and only those three would have needed to change. Their own Landing
 * sections do not: both commit first and run `preflight.mjs` second already,
 * which is why repo-65's own ticket, after two corrected drafts, priced
 * option (a) at three edits rather than a reversal of an order the whole
 * skill prescribes.
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
 *   run?: typeof runGit,
 *   buildRun?: typeof runBuildCommand,
 *   spawn?: typeof spawnRaw,
 *   listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[],
 * }} options
 */
export function preflight(repo, options) {
  const { base, title, run = runGit, buildRun, spawn, listOpenHeads } = options;
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

  // Its own try, not folded into the one above: `workingTreePaths` never
  // touches `base` at all, and repo-65 gate 1 measured what folding it in
  // costs — an injected `run` that throws on `git status` came back as
  // `--base <ref> could not be read`, blaming a ref that was never the
  // problem.
  let testSelectionPaths;
  try {
    testSelectionPaths = [...new Set([...diffPaths, ...workingTreePaths(repo, run)])];
  } catch (error) {
    throw fail(
      `the working tree could not be read: ${/** @type {Error} */ (error).message}`,
      EXIT.setup,
    );
  }

  return [
    guarded("check", EXIT.check, () => checkBuild(repo, testSelectionPaths, buildRun)),
    guarded("ciCommands", EXIT.ciCommands, () => checkCiCommands(repo, buildRun)),
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
    repoArg ??
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      shell: false,
    }).trim();

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
