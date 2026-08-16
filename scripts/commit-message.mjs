/**
 * The commit message convention, in one place.
 *
 * Two callers, deliberately sharing this file so they cannot drift:
 *
 *   - `.githooks/commit-msg`, which rejects a bad message while the author —
 *     usually an agent — still has the context to fix it. This repo merges with
 *     merge commits, so every commit on a branch reaches `main` and is read by
 *     release-please. There are no working notes; this hook is the real gate.
 *   - `.github/workflows/pr-title.yml`, which checks the pull request title.
 *     The title is not what lands, so that check is about a legible pull request
 *     list rather than about the changelog.
 *
 * Plain `.mjs`, no dependencies, no build step. The hook has to run in a fresh
 * clone before anyone has typed `npm install`, and anything needing `tsx` or a
 * `node_modules` tree could not. See docs/03-RELEASING.md.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * The types release-please understands, plus the ones that describe work it
 * should ignore.
 *
 * `feat` and `fix` are the only two that move a version on their own — minor
 * and patch respectively — so the taxonomy is really "does this change what a
 * user of the tool gets". Everything else lands silently and is fine.
 *
 * There is no `security` type, although this repo's history has one. A security
 * fix is a `fix`: it should bump the patch version and appear in the changelog,
 * which is exactly what a made-up type would prevent.
 */
export const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

/** Types whose changelog entry is ambiguous in a repo with more than one tool. */
const SCOPE_REQUIRED = new Set(["feat", "fix"]);

/**
 * Scopes that are not a tool.
 *
 * `core` is `packages/core`; `repo` is the toolchain, the conventions and the
 * documentation that belongs to no single tool; `ci` and `deps` are what they
 * look like.
 */
export const EXTRA_SCOPES = ["core", "repo", "ci", "deps"];

/** Anything git or an editor generates that was never meant to be conventional. */
const BYPASS = [/^Merge /, /^Revert "/, /^fixup! /, /^squash! /, /^amend! /];

/** The one bypassed subject whose *body* is still checked. See `mergeBodyErrors`. */
const MERGE = /^Merge /;

/** A line release-please would read as a commit in its own right. */
const CONVENTIONAL_LINE = new RegExp(`^(?:${TYPES.join("|")})(?:\\([^()]+\\))?!?: \\S`);

const HEADER_MAX = 100;

/**
 * The tools, read off disk rather than listed here.
 *
 * Adding a tool is meant to be "make a directory under `tools/`", and a scope
 * enum that had to be edited too would be one more thing to forget — and it
 * would fail at the least helpful moment, on the first commit of new work.
 *
 * @param {string} [repoRoot]
 * @returns {string[]}
 */
export function toolScopes(repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..")) {
  try {
    return fs
      .readdirSync(path.join(repoRoot, "tools"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    // No `tools/` directory means this is not the repo we think it is. Let the
    // scope check pass rather than blocking every commit on a bad guess.
    return [];
  }
}

/**
 * @param {string} message A full commit message, or a pull request title.
 * @param {{ scopes?: string[] }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validate(message, options = {}) {
  const scopes = options.scopes ?? [...toolScopes(), ...EXTRA_SCOPES];

  // Comments are what `git commit` appends to the buffer it opens; they are not
  // part of the message and must not be measured or parsed.
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const header = (lines[0] ?? "").trim();
  /** @type {string[]} */
  const errors = [];

  if (header === "") return { ok: false, errors: ["the commit message is empty"] };
  if (BYPASS.some((pattern) => pattern.test(header))) {
    return MERGE.test(header) ? mergeBodyErrors(lines.slice(1)) : { ok: true, errors: [] };
  }

  // GitHub appends " (#123)" to a squash merge's subject. The author did not
  // type it and cannot shorten it, so it does not count against the limit.
  const measured = header.replace(/\s*\(#\d+\)$/, "");
  if (measured.length > HEADER_MAX) {
    errors.push(`the subject line is ${measured.length} characters; keep it under ${HEADER_MAX}`);
  }

  const match = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<breaking>!)?: (?<subject>.+)$/.exec(
    header,
  );
  if (match?.groups === undefined) {
    errors.push(
      `"${header}" is not a conventional commit — expected "type(scope): subject", ` +
        `for example "fix(downloader): stop re-probing in place (dl-9)"`,
    );
    return { ok: false, errors };
  }

  const { type, scope, subject } = match.groups;

  if (!TYPES.includes(type)) {
    errors.push(`"${type}" is not a known type. Use one of: ${TYPES.join(", ")}`);
  }

  if (scope === undefined) {
    if (SCOPE_REQUIRED.has(type)) {
      errors.push(
        `"${type}" needs a scope — it is the only thing telling a reader which ` +
          `tool's changelog this belongs in. Use one of: ${scopes.join(", ")}`,
      );
    }
  } else if (scopes.length > 0 && !scopes.includes(scope)) {
    errors.push(`"${scope}" is not a known scope. Use one of: ${scopes.join(", ")}`);
  }

  if (subject !== subject.trimStart()) {
    errors.push("there is more than one space after the colon");
  }
  if (subject.endsWith(".")) {
    errors.push("the subject must not end with a full stop");
  }
  if (/^[A-Z][a-z]/.test(subject)) {
    errors.push(`the subject must start lowercase — "${lowerFirst(subject)}", not "${subject}"`);
  }

  // A breaking change is declared with `!` before the colon, a `BREAKING CHANGE:`
  // footer, or both. Anything that merely looks like the footer is a silent
  // no-op: release-please will not see it, and a major version will not happen.
  for (const line of lines.slice(1)) {
    if (/^breaking[ -]change/i.test(line) && !/^BREAKING[ -]CHANGE: /.test(line)) {
      errors.push(
        `"${line.trim()}" will be ignored — the footer has to read exactly ` +
          `"BREAKING CHANGE: " in capitals, or the major bump silently will not happen`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * A merge commit's subject is git's, and skipped — but release-please does not
 * stop at the subject. It reads the body too, and counts every line there that
 * parses as a conventional commit as a commit of its own. So a body carrying
 * the branch's message lands that message twice, under two SHAs, in one
 * changelog: exactly what downloader 0.2.0 was released with.
 *
 * GitHub writes that body itself when a repository's `merge_commit_message` is
 * `PR_TITLE`, which no hook can prevent — the setting is where that is fixed,
 * and docs/03-RELEASING.md says which switch. This is the backstop for a merge
 * made by hand, where the body is whatever the author left in the buffer.
 *
 * @param {string[]} body
 * @returns {{ ok: boolean, errors: string[] }}
 */
function mergeBodyErrors(body) {
  const errors = body
    .filter((line) => CONVENTIONAL_LINE.test(line))
    .map(
      (line) =>
        `"${line.trim()}" is a conventional commit inside a merge commit's body — ` +
        `release-please reads it as a second commit and writes the changelog entry ` +
        `twice. Leave the body empty; the commit on the branch is the record`,
    );

  return { ok: errors.length === 0, errors };
}

/** @param {string} value */
function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * CLI. Either `--text "<message>"` or a path to a file holding one, which is
 * what git hands a `commit-msg` hook.
 */
function main() {
  const argv = process.argv.slice(2);
  const textIndex = argv.indexOf("--text");
  const message =
    textIndex === -1
      ? argv[0] === undefined
        ? ""
        : fs.readFileSync(argv[0], "utf8")
      : (argv[textIndex + 1] ?? "");

  const { ok, errors } = validate(message);
  if (ok) return;

  const header = message.split("\n")[0] ?? "";
  process.stderr.write(
    `\ncommit message rejected:\n\n    ${header}\n\n` +
      errors.map((error) => `  · ${error}\n`).join("") +
      `\nThe convention, and why it is enforced here, is in docs/03-RELEASING.md.\n\n`,
  );
  process.exitCode = 1;
}

// Only when run directly: importing this file — the tests do — must not exit.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
