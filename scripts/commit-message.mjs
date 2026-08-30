/**
 * The commit message convention, in one place.
 *
 * Two callers, deliberately sharing this file so they cannot drift:
 *
 *   - `.githooks/commit-msg`, which rejects a bad message while the author —
 *     usually an agent — still has the context to fix it.
 *   - `.github/workflows/pr-title.yml`, which checks the pull request title,
 *     because this repo squash-merges and the *title* is what lands on `main`.
 *     That is the message release-please reads, so it is the one that must be
 *     right; the intermediate commits on a branch are working notes.
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
 * Four of them move a version on their own, not two: the four that are **not**
 * `hidden` in `release-please-config.json`. `feat` bumps the minor; `fix`,
 * `perf` and `revert` each bump the patch, because release-please names only
 * `feat` and a breaking change and falls through to a patch for everything it
 * did not skip. The other six are `hidden`, and a commit set made only of those
 * is skipped outright — that is what "lands silently" means and it is the
 * `hidden` flag that decides it, not this list. Measured for repo-10; the runs
 * are in docs/03-RELEASING.md. So the taxonomy is really "does this change what
 * a user of the tool gets".
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

/**
 * The set required to carry a scope when `release-please-config.json` cannot be
 * read.
 *
 * Same reasoning as `toolScopes`' empty return: a hook that cannot find its
 * config should not block every commit on a bad guess about where it is
 * running. It should not silently stop enforcing either, so the fallback is the
 * historical minimum rather than nothing — these two have been required since
 * the rule existed and are unambiguous whatever the config says.
 */
const SCOPE_REQUIRED_FALLBACK = ["feat", "fix"];

/**
 * The types that reach a changelog, computed from `release-please-config.json`
 * rather than listed here.
 *
 * **This is the rule read off the config, not off a list of type names.** A
 * type is in a changelog exactly when it is not `hidden` in
 * `changelog-sections` — measured for repo-10, with the runs in
 * docs/03-RELEASING.md — so a type added to that file without `hidden` starts
 * requiring a scope the day it is added, and nobody has to remember to edit
 * this file. A hand-written set went stale here once already: it said `feat`
 * and `fix` while `perf` and `revert` had been reaching a changelog all along.
 *
 * `null` rather than `[]` when the config cannot be read, so the caller can
 * tell "unreadable" from "everything is hidden".
 *
 * @param {string} [repoRoot]
 * @returns {string[] | null}
 */
export function releasingTypes(repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..")) {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "release-please-config.json"), "utf8"),
    );
    const sections = config["changelog-sections"];
    if (!Array.isArray(sections)) return null;
    return sections
      .filter((section) => section?.hidden !== true)
      .map((section) => section?.type)
      .filter((type) => typeof type === "string");
  } catch {
    return null;
  }
}

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
 * @param {{ scopes?: string[], releasingTypes?: string[] | null }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validate(message, options = {}) {
  const scopes = options.scopes ?? [...toolScopes(), ...EXTRA_SCOPES];
  // `undefined` means "not supplied, go and read the config"; `null` means
  // "the config could not be read", which is what `releasingTypes()` itself
  // returns in that case. Keeping them distinct is what lets anything at all
  // reach `SCOPE_REQUIRED_FALLBACK` — with a single `??` chain the fallback was
  // unreachable except on a machine where the repo's own config is missing, so
  // emptying it broke nothing that any test could see.
  const declared = options.releasingTypes === undefined ? releasingTypes() : options.releasingTypes;
  const releasing = new Set(declared ?? SCOPE_REQUIRED_FALLBACK);

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

  const { type, scope, subject, breaking } = match.groups;

  // What reaches a changelog is "not `hidden`, **and** not breaking" — the same
  // two-clause test docs/03-RELEASING.md states, because a `hidden` type
  // carrying `!` is not skipped: the `BREAKING CHANGES` heading makes the
  // changelog entry non-empty on its own. Measured for repo-10. Deriving the
  // scope rule from `hidden` alone would let `chore!: …` cut an unattributed
  // changelog line, which is the one thing the scope rule exists to stop.
  const isBreaking =
    breaking === "!" || lines.slice(1).some((line) => /^BREAKING[ -]CHANGE: /.test(line));

  if (!TYPES.includes(type)) {
    errors.push(`"${type}" is not a known type. Use one of: ${TYPES.join(", ")}`);
  }

  if (scope === undefined) {
    if (releasing.has(type) || isBreaking) {
      const reason = releasing.has(type)
        ? `it is not "hidden" in release-please-config.json, so it reaches a changelog`
        : "a breaking change reaches a changelog whatever its type";
      errors.push(
        `"${type}" needs a scope — ${reason}, and a changelog line is the only ` +
          `thing telling a reader which tool it belongs to. Use one of: ${scopes.join(", ")}`,
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
 * parses as a conventional commit as a commit of its own. So a body carrying a
 * branch's message lands that message twice, under two SHAs, in one changelog:
 * exactly what downloader 0.2.0 was released with, back when pull requests here
 * landed as merge commits.
 *
 * They no longer do — the repository is squash-only now — so nothing routine
 * produces a merge commit at all. This stays because the shape is silent: it
 * costs a released changelog to notice, and a `git merge --no-ff` on `main`
 * still reaches the hook. See docs/03-RELEASING.md.
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
        `twice. Leave the body empty`,
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
