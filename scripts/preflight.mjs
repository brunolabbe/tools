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
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EXTRA_SCOPES, TYPES, releasingTypes, toolScopes, validate } from "./commit-message.mjs";
import {
  SCOPE,
  SELF as CITATIONS_GATE_SELF,
  compareAgainst,
  gate as citationsGate,
  parseGrandfathered,
} from "./citations-gate.mjs";
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
 * not a check), `npm run check` (check 1's own first command) and
 * `citations-gate.mjs --against` (check 2, called as functions) all have a
 * dedicated check already and are matched exactly, by name, in `COVERED`; what
 * is left is derived from `ci.yml` itself and spawned for real, so a step that
 * job gains later is caught by construction rather than by someone updating
 * this file to match it — which is exactly how #305 passed preflight twice and
 * then failed CI on a `citations.mjs --require-anchors` run this script did
 * not have.
 */
export const EXIT = /** @type {const} */ ({
  check: 1,
  citations: 2,
  review: 4,
  title: 8,
  mergeTree: 16,
  ciCommands: 32,
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
 * The three commands `ci.yml`'s `check` job runs that already have a
 * dedicated, better check elsewhere in this file, and would only cost time to
 * repeat here for an identical verdict — `npm ci` (dependency installation,
 * not a check; this script's own precondition, `worktree-farm.sh` then
 * `npm run build`, already establishes the tree, and running it again would
 * need the network this repo's own worktree rule forbids reaching for),
 * `npm run check` (check 1's own first command, in every `testPlan` already)
 * and `node scripts/citations-gate.mjs --against …` (check 2, `checkCitations`,
 * which imports the very `gate`/`compareAgainst` this line would otherwise
 * spawn a second, slower time for the same answer).
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
 * @type {{guard: (raw: string) => boolean, exact: string}[]}
 */
const COVERED = [
  { guard: (raw) => raw === "npm ci" || raw.startsWith("npm ci "), exact: "npm ci" },
  {
    guard: (raw) => raw === "npm run check" || raw.startsWith("npm run check "),
    exact: "npm run check",
  },
  {
    guard: (raw) =>
      raw === "node scripts/citations-gate.mjs" ||
      raw.startsWith("node scripts/citations-gate.mjs "),
    exact: "node scripts/citations-gate.mjs --against \"origin/${{ github.base_ref || 'main' }}\"",
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
 * chains a second command, `|` pipes to one, and a trailing `# comment` is
 * text YAML's own reader would have stripped before the shell ever saw it.
 * None of the three is spawned with a shell here (the repo-wide rule this
 * file itself is scanned for), so none of the three can be honoured either —
 * this is what tells "cannot be run faithfully" from "can", and throws rather
 * than handing `&&`, `|` or a comment word to `spawnSync` as a literal,
 * meaningless argument.
 *
 * @param {string} raw
 */
export function assertSpawnable(raw) {
  if (raw.includes("${{")) {
    throw new Error(
      `ci.yml's check job has a templated command this parser cannot resolve: ${raw}`,
    );
  }
  if (raw.includes("&&") || raw.includes("|") || / #/u.test(raw)) {
    throw new Error(
      `ci.yml's check job has a command this parser cannot spawn faithfully (a shell operator ` +
        `or a trailing comment, never run through a shell here): ${raw}`,
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
 * @param {string} yamlText
 * @returns {[string, string[]][]}
 */
export function deriveExtraCiCommands(yamlText) {
  const out = [];
  for (const raw of extractCheckJobCommands(yamlText)) {
    const covered = COVERED.find((c) => c.guard(raw));
    if (covered) {
      if (raw !== covered.exact) {
        throw new Error(
          `ci.yml's check job runs "${raw}", which looks like ${JSON.stringify(covered.exact)} ` +
            `but is not that exactly — preflight will not guess whether the difference matters.`,
        );
      }
      continue; // matched exactly: covered elsewhere, never spawned here.
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
 * not an error, the same reasoning `grandfatheredFor` gives for a repository
 * with no `citations-gate.mjs`.
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
 * section, as `status.mjs`' `hasGateRecord` reads one (repo-73), per ticket, with a
 * distinct message for the one that has none. `diffPaths` is the one already
 * computed against `${base}...HEAD`, filtered to the ticket roots
 * `citations-gate.mjs`'s own `SCOPE` names.
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
 * Remove a scratch worktree — best-effort, and never the reason a check
 * throws. `git worktree remove` also deregisters it from `repo`'s own
 * `.git`, which a bare `fs.rmSync` alone would leave behind as a phantom
 * entry the next `git worktree list` still names.
 *
 * @param {string} repo
 * @param {string} dir
 */
function removeWorktree(repo, dir) {
  spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: repo, shell: false });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already gone, or `worktree remove` above already took it — either way
    // there is nothing left to clean up and nothing to report.
  }
}

/**
 * Fold every reachable other open head into one real working tree beside
 * `headOid`, sequentially, and hand back where it landed — or which head it
 * could not fold in, on a genuine merge conflict.
 *
 * A linked worktree, not `merge-tree --write-tree`'s tree object: the citation
 * gate reads files off disk and off the index (`makeReader`, `candidateFiles`
 * in `citations.mjs`), never off an arbitrary tree oid, so proving what it
 * would say about the folded state needs a real checkout.
 *
 * **Each fold is a real, committed merge, not `--no-commit`.** A worktree mid
 * merge refuses a second `git merge` outright — "You have not concluded your
 * merge (MERGE_HEAD exists)" — so folding in a second head needs the first
 * one finished first. The commits are as scratch as the worktree itself: nothing
 * here ever points a real branch at them, and `removeWorktree` discards the
 * whole directory once the caller is done reading it.
 *
 * **`--no-verify`, because this repo's own `commit-msg` hook runs here too.**
 * A linked worktree shares `core.hooksPath` with `repo`, and measured directly
 * against this repository: `git merge --no-ff -m "scratch merge: fold in …"`
 * exited 1 on "not a conventional commit", the tree merged cleanly and the
 * commit simply never happened — which this file then read as a content
 * conflict with no conflicting paths at all, the wrong verdict for the right
 * symptom. This commit is never pushed, never inspected for its message and
 * never becomes real history; the convention it would otherwise be held to
 * describes a change somebody reads, not a scratch fold nobody does.
 *
 * @param {string} repo
 * @param {string} headOid
 * @param {{number: number, headRefName: string, oid: string}[]} otherHeads reachable only
 * @returns {{ok: true, dir: string} | {ok: false, conflictHead: {number: number, headRefName: string, oid: string}, paths: string[]}}
 */
export function buildScratchMerge(repo, headOid, otherHeads) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-scratch-")));
  const added = spawnSync("git", ["worktree", "add", "--detach", "--quiet", dir, headOid], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
  });
  if (added.status !== 0) {
    removeWorktree(repo, dir);
    throw fail(
      `git worktree add ${dir} ${headOid} exited ${added.status}\n${(added.stderr ?? "").trim()}`,
      added.status ?? 1,
    );
  }
  for (const head of otherHeads) {
    const result = spawnSync(
      "git",
      [
        "merge",
        "--no-ff",
        "--no-verify",
        "-m",
        `scratch merge: fold in ${head.headRefName}`,
        head.oid,
      ],
      { cwd: dir, encoding: "utf8", shell: false },
    );
    if (result.status !== 0) {
      const conflicted = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], {
        cwd: dir,
        encoding: "utf8",
        shell: false,
      });
      const paths = lines(conflicted.stdout ?? "");
      spawnSync("git", ["merge", "--abort"], { cwd: dir, shell: false });
      // A non-zero `git merge` with no unmerged path is not a content conflict
      // at all — measured live, this repo's own `commit-msg` hook rejecting the
      // scratch commit's message read exactly this way before `--no-verify`
      // was added, reporting a clean tree as `FAIL … conflicts on: ` with
      // nothing after the colon. Anything else that can leave a merge
      // non-zero with no unmerged path — a missing commit identity, signing —
      // is the same misdiagnosis and gets the same repair: say so and stop,
      // rather than report a conflict that was never there.
      if (paths.length === 0) {
        removeWorktree(repo, dir);
        throw fail(
          `git merge --no-ff --no-verify ${head.oid} in a scratch worktree exited ` +
            `${result.status} with no conflicting path — not a content conflict, so this will not ` +
            `report one:\n${(result.stderr ?? "").trim()}`,
          result.status ?? 1,
        );
      }
      removeWorktree(repo, dir);
      return { ok: false, conflictHead: head, paths };
    }
  }
  return { ok: true, dir };
}

/**
 * Check 5's second half (repo-79): the citation gate over a scratch merge of
 * `HEAD` with each other reachable open pull request head **in turn** —
 * never with two of them at once — which is the check `git merge-tree`
 * cannot make. Two heads that touch no common line merge cleanly by git's
 * own definition and can still leave an anchored citation in one of them
 * pointing at the wrong line in the merged state — repo-79's own Why:
 * repo-60's record against repo-63's splice, `hasGateRecord` against
 * repo-63's unmerged record, and `preflight.mjs` line 410 against repo-67's
 * record, all clean merges by `git merge-tree`'s own reckoning and all found
 * only by a hand-built scratch merge until now.
 *
 * **One fold per head, not one fold of all of them, and that is a repair of
 * this function's own first shape, not the original design.** Folding every
 * reachable head into a single worktree tests whether *those heads* merge
 * with each other, which is nobody's question here and can be false for
 * reasons that have nothing to do with `HEAD` — the orchestrator measured it
 * live, sha for sha, against this repository's own two open release-please
 * pull requests: #284 and #294 each merge cleanly with `HEAD`, and conflict
 * with *each other* on `.release-please-manifest.json`, which the first
 * version of this function folded into one FAIL blamed on `HEAD`. Two open
 * release pull requests is an ordinary standing state here, so that
 * shape would have failed preflight for every branch in the repository
 * most of the time. Folding one head onto `HEAD` at a time asks the only
 * question this check exists to ask — "if this one landed beside mine,
 * would my citations still hold" — and can never itself report a conflict
 * between two heads that are not `HEAD`.
 *
 * An empty `otherHeads` says so explicitly, for the same reason the
 * zero-heads case above does: "checked everything, found nothing" and
 * "nothing to check" must not read alike.
 *
 * **Owner decision, 2026-09-28 (option B of three offered): the fold also
 * carries `base`'s current tip in, when `HEAD` does not already contain it.**
 * `git`'s own `pull_request` checkout defaults to the merge of the PR branch
 * with the base it targets — `refs/pull/<n>/merge` — so a branch that has
 * fallen behind `base` is not the tree CI actually checks, and this fold
 * quietly checked the stale one. `git merge-base --is-ancestor base headOid`
 * decides once per call, not once per head: true (the ordinary case, a
 * branch built recently off a `base` that has not since moved) folds nothing
 * extra; false folds `base`'s tip into the *same* worktree as the head under
 * test, ahead of it, so the tree matches what a real pull request run would
 * see. **A three-party gap is disclosed rather than closed**: two heads that
 * are each clean paired with `HEAD` (and with `base`, once folded) can still
 * break a citation only when *both* land beside `HEAD` together, and this
 * check — one other head at a time — cannot see that. Option C (fold every
 * mutually-clean head together, in addition to this) was not built: it
 * reintroduces exactly the shape option B's sibling repair (folding every
 * head together, full stop) just closed for two heads that conflict with
 * each other, one layer up for three that do not — this repository's own
 * orchestrator already runs a whole-batch scratch merge before a batch lands
 * (`.claude/skills/orchestrate-tickets/reference/records.md`), which is
 * where that question is answered today.
 *
 * @param {string} repo
 * @param {string} headOid
 * @param {{number: number, headRefName: string, oid: string}[]} otherHeads reachable only
 * @param {string} base
 * @param {Map<string, number>} grandfathered
 */
export function checkScratchMergeCitations(repo, headOid, otherHeads, base, grandfathered) {
  if (otherHeads.length === 0) {
    return {
      ok: true,
      lines: ["no other open pull request to fold into a scratch merge — nothing was checked"],
    };
  }

  // Resolved once: every head's fold reads the same answer, and a `base`
  // that does not resolve here is already `preflight()`'s own `EXIT.setup`,
  // never reached through this function in the ordinary pipeline.
  const baseAncestor = spawnSync("git", ["merge-base", "--is-ancestor", base, headOid], {
    cwd: repo,
    shell: false,
  });
  const baseIsAncestor = baseAncestor.status === 0;
  const baseOid = baseIsAncestor
    ? null
    : spawnSync("git", ["rev-parse", base], {
        cwd: repo,
        encoding: "utf8",
        shell: false,
      }).stdout?.trim();

  const out = [];
  let problems = 0;
  for (const head of otherHeads) {
    const foldingBase = !baseIsAncestor && baseOid;
    const label = foldingBase
      ? `HEAD with #${head.number} ${head.headRefName} (plus ${base}, which HEAD does not yet contain)`
      : `HEAD with #${head.number} ${head.headRefName}`;
    const toFold = foldingBase ? [{ number: 0, headRefName: base, oid: baseOid }, head] : [head];
    const merge = buildScratchMerge(repo, headOid, toFold);
    if (!merge.ok) {
      problems += 1;
      out.push(
        `FAIL  scratch merge of ${label} — folding in ${merge.conflictHead.headRefName} ` +
          `conflicts on: ${merge.paths.join(", ")}`,
      );
      continue;
    }
    try {
      const result = citationsGate(merge.dir, SCOPE, grandfathered);
      const headProblems = [];
      for (const r of result.failed)
        headProblems.push(`FAIL  ${r.record} — ${countLine(r.counts)}`);
      for (const r of result.regressed) {
        headProblems.push(
          `WORSE ${r.record} — ${r.failing} failing, its entry allows ${r.allowed}`,
        );
      }
      for (const r of result.staleEntries) headProblems.push(`STALE ${r.record} — ${r.why}`);

      let history;
      try {
        history = compareAgainst(merge.dir, base, grandfathered);
      } catch (error) {
        headProblems.push(`FAIL  compareAgainst ${base}: ${/** @type {Error} */ (error).message}`);
        history = null;
      }
      for (const r of history?.raised ?? []) {
        headProblems.push(
          `RAISED ${r.record} — its GRANDFATHERED entry went from ${r.was} to ${r.now}`,
        );
      }

      if (headProblems.length === 0) {
        out.push(
          `ok    scratch merge of ${label} is clean over ${result.inScope.length} record(s)`,
        );
      } else {
        problems += 1;
        out.push(`scratch merge of ${label}:`, ...headProblems);
      }
    } finally {
      removeWorktree(repo, merge.dir);
    }
  }
  return problems === 0 ? { ok: true, lines: out } : { ok: false, lines: out };
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
 * **Its second half, added by repo-79, is `checkScratchMergeCitations`
 * above**: each reachable head is folded onto `HEAD` on its own, in its own
 * scratch worktree, and the citation gate runs over the result — which is
 * what catches a citation two clean-merging heads move between them. Only
 * run when a `base` is given — every fixture in this suite that calls
 * `checkMergeTree` directly and does not pass one keeps this file's older,
 * narrower verdict.
 *
 * @param {string} repo
 * @param {{run?: typeof runGit, spawn?: typeof spawnRaw, listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[], base?: string, grandfathered?: Map<string, number>}} [options]
 */
export function checkMergeTree(repo, options = {}) {
  const run = options.run ?? runGit;
  const spawn = options.spawn ?? spawnRaw;
  const listOpenHeads = options.listOpenHeads ?? defaultListOpenHeads(run);

  const headOid = run("git", ["rev-parse", "HEAD"], { cwd: repo }).trim();
  const heads = listOpenHeads(repo).filter((h) => h.oid !== headOid);

  const out = [`comparing HEAD against ${heads.length} other open pull request head(s)`];
  let problems = 0;
  const reachableHeads = [];
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
    reachableHeads.push(head);

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

  if (options.base !== undefined) {
    const grandfathered = options.grandfathered ?? grandfatheredFor(repo);
    const scratch = checkScratchMergeCitations(
      repo,
      headOid,
      reachableHeads,
      options.base,
      grandfathered,
    );
    out.push(...scratch.lines);
    if (!scratch.ok) problems += 1;
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
 *   run?: typeof runGit,
 *   buildRun?: typeof runBuildCommand,
 *   spawn?: typeof spawnRaw,
 *   grandfathered?: Map<string, number>,
 *   listOpenHeads?: (repo: string) => {number: number, headRefName: string, oid: string}[],
 * }} options
 */
export function preflight(repo, options) {
  const { base, title, run = runGit, buildRun, spawn, grandfathered, listOpenHeads } = options;
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
    guarded("ciCommands", EXIT.ciCommands, () => checkCiCommands(repo, buildRun)),
    guarded("citations", EXIT.citations, () => checkCitations(repo, base, grandfathered)),
    guarded("review", EXIT.review, () => checkReview(repo, diffPaths, run)),
    guarded("title", EXIT.title, () => checkTitle(repo, diffPaths, title, run)),
    guarded("mergeTree", EXIT.mergeTree, () =>
      checkMergeTree(repo, { run, spawn, listOpenHeads, base, grandfathered }),
    ),
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
