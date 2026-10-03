/**
 * Re-resolve every unpinned citation in a record by its anchor, and say what
 * each one should become (repo-84).
 *
 * During the 2026-09-29 batch one gate rebuilt this by hand in each of four
 * successive rounds of `repo-80`'s branch: take a record's unpinned citations,
 * look each anchor up again in the tree as it now stands, and list the ones
 * whose coordinate no longer holds — which is the list a builder then repoints
 * or pins. `citations.mjs` already says *that* a citation moved; it does not
 * say which of the three repairs the citation wants, and it cannot say the one
 * that needs a second tree. This does.
 *
 * **Every unpinned, anchored citation gets one of six verdicts**, and the
 * verdict is a recommendation, never a rewrite — this edits nothing:
 *
 *   - `holds`       the anchor starts inside the range the record cites.
 *   - `repoint`     it does not, and starts on exactly one other line of the
 *                   file: cite that line.
 *   - `ambiguous`   it does not, and starts on several lines: a human chooses.
 *   - `gone`        the file is there and the anchor is nowhere in it. Either
 *                   the text was deleted or reworded, or the citation described
 *                   something else; only a reader can say which.
 *   - `unresolvable` the file is not there, or names no single tracked file.
 *   - `pin`         only with `--base`: the anchor is in the file at `base`.
 *                   That is content that predates the branch, which `records.md`
 *                   says to pin to the base whether or not the branch moved it,
 *                   so this wins over every verdict above. `tip` says what the
 *                   citation does today, so a pin that is also a move is visible.
 *
 * **The anchor is searched over the whole file, never only the cited range.**
 * `checkCitations` resolves a range past the end of a shortened file as
 * `unresolvable` before it ever looks at the anchor, and a range the branch
 * moved is `moved` only by looking elsewhere; widening the range to the file is
 * what turns both into a line number. It is the same widening
 * `review-record.mjs`'s `unpinnedPreexistingCitations` does for the base; that
 * function is not reused because it answers only the base half, returns the pin
 * line inside a sentence, and `review-record.mjs` was being edited by two other
 * branches when this was written. A later change could lift the pair.
 *
 * **What is left out, and counted so it is not invisible.** A pinned citation is
 * read at its own commit by `citations.mjs` on every run and is never
 * re-resolved against the present; a citation with no anchor has nothing to
 * look up; a prose `line 367` names no file; a citation the record declares
 * `<!-- citations: evidence … -->` is deliberately wrong. Each is a count on the
 * summary line, and none of them sets the exit code.
 *
 * Exit 0 when every re-resolved citation holds, 1 when at least one wants a
 * change, 2 for a usage error or a ref that is not a commit.
 *
 * Plain `.mjs`, no dependencies, matching `citations.mjs`.
 *
 * Usage:
 *   node scripts/re-resolve-citations.mjs <record> [--section <name>] [--base <ref>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  candidateFiles,
  checkCitations,
  extractCitations,
  extractDeclarations,
  extractSections,
  locateRecord,
  makeReader,
  makeResolver,
  selectSection,
} from "./citations.mjs";

export const USAGE =
  "usage: node scripts/re-resolve-citations.mjs <record> [--section <name>] [--base <ref>]";

/** Hits listed for an ambiguous citation before the rest are elided. */
const SHOWN_HITS = 5;

/**
 * @param {string[]} argv
 * @returns {{file: string, section: string | null, base: string | null}}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let file = null;
  let section = null;
  let base = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--section" || arg === "--base") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw usageError(`${arg} needs a value`);
      }
      if (arg === "--section") section = value;
      else base = value;
    } else if (arg.startsWith("--")) {
      throw usageError(`unknown flag ${arg}`);
    } else if (file === null) {
      file = arg;
    } else {
      throw usageError(`one record at a time, got a second: ${arg}`);
    }
  }
  if (file === null) throw usageError("no record given");
  return { file, section, base };
}

function usageError(message) {
  return Object.assign(new Error(`${message}\n${USAGE}`), { exit: 2 });
}

/** The same key `review-record.mjs` compares declarations on. */
const keyOf = (c) => `${c.file}:${c.start}-${c.end}:${c.rev ?? ""}`;

const rangeOf = (start, end) => (start === end ? `${start}` : `${start}-${end}`);

/**
 * Check every candidate against one tree with its range widened to the whole
 * file, so the result carries every line the anchor starts on.
 *
 * A file that does not resolve, or cannot be read, keeps its own range and
 * comes back `unresolvable` either way.
 *
 * @param {ReturnType<typeof extractCitations>} candidates
 * @param {string} repo
 * @param {string | null} rev
 */
function checkWhole(candidates, repo, rev) {
  const resolve = makeResolver(candidateFiles(repo, rev));
  const read = makeReader(repo, rev);
  const widened = candidates.map((c) => {
    const resolved = resolve(/** @type {string} */ (c.file));
    if ("error" in resolved) return c;
    const content = read(resolved.path);
    if (content === null) return c;
    return { ...c, start: 1, end: Math.max(content.length, 1) };
  });
  return checkCitations(widened, read, resolve);
}

/**
 * @typedef {"holds" | "repoint" | "ambiguous" | "gone" | "unresolvable" | "pin"} Action
 * @typedef {{
 *   action: Action,
 *   line: number,
 *   file: string,
 *   start: number,
 *   end: number,
 *   anchor: string,
 *   hits: number[],
 *   baseLine: number | null,
 *   suggestion: string | null,
 *   detail: string,
 * }} Row
 */

/**
 * Re-resolve one record's unpinned citations.
 *
 * @param {{markdown: string, repo: string, section?: string | null, base?: string | null}} options
 *   `base` is a commit-ish; it is resolved here to the short sha a pin is
 *   written with. A citation into the record itself is re-resolved like any
 *   other, and is as meaningless here as it is in `citations.mjs`.
 * @returns {{rows: Row[], skipped: {pinned: number, malformed: number, unanchored: number, unchecked: number, declared: number}, scope: string, base: string | null}}
 */
export function reResolve({ markdown, repo, section = null, base = null }) {
  const chosen = section === null ? null : selectSection(extractSections(markdown), section);
  const inScope = (line) => chosen === null || (line >= chosen.start && line <= chosen.end);
  const citations = extractCitations(markdown).filter((c) => inScope(c.line));
  const declared = new Set(
    extractDeclarations(markdown)
      .filter((d) => inScope(d.line))
      .map(keyOf),
  );

  const skipped = { pinned: 0, malformed: 0, unanchored: 0, unchecked: 0, declared: 0 };
  /** @type {typeof citations} */
  const candidates = [];
  for (const c of citations) {
    if (c.malformed !== undefined) skipped.malformed++;
    else if (c.rev !== undefined) skipped.pinned++;
    else if (c.file === null) skipped.unchecked++;
    else if (c.anchor === null || c.anchor.trim() === "") skipped.unanchored++;
    else if (declared.has(keyOf(c))) skipped.declared++;
    else candidates.push(c);
  }

  const baseSha = base === null ? null : resolveCommit(repo, base);
  const tipResults = checkWhole(candidates, repo, null);
  const baseResults = baseSha === null ? null : checkWhole(candidates, repo, baseSha);

  /** @type {Row[]} */
  const rows = candidates.map((c, i) => {
    const tip = tipResults[i];
    const file = /** @type {string} */ (c.file);
    const anchor = /** @type {string} */ (c.anchor);
    const hits = tip.state === "unresolvable" ? [] : (tip.foundAt ?? []);
    const baseResult = baseResults?.[i];
    const baseLine =
      baseResult?.state === "verified" ? (baseResult.foundAt?.[0] ?? baseResult.start) : null;
    const width = c.end - c.start;
    const where = rangeOf(c.start, c.end);
    const inRange = hits.filter((n) => n >= c.start && n <= c.end);

    /** What the citation does against the tree as it stands. */
    const tipSays =
      tip.state === "unresolvable"
        ? `unresolvable — ${tip.reason}`
        : inRange.length > 0
          ? "holds"
          : hits.length === 0
            ? "the anchor is nowhere in the file"
            : `the anchor is at ${list(hits)}`;

    const row = { line: c.line, file, start: c.start, end: c.end, anchor, hits, baseLine };

    if (baseLine !== null) {
      return {
        ...row,
        action: "pin",
        suggestion: `${file}@${baseSha}:${baseLine}`,
        detail:
          `the anchor is already in ${file} at ${baseSha}, line ${baseLine} — content that predates ` +
          `the branch pins to the base, one line, the line the text starts on. At the tip: ${tipSays}`,
      };
    }
    if (tip.state === "unresolvable") {
      return { ...row, action: "unresolvable", suggestion: null, detail: tip.reason };
    }
    if (inRange.length > 0) return { ...row, action: "holds", suggestion: null, detail: "" };
    if (hits.length === 0) {
      return {
        ...row,
        action: "gone",
        suggestion: null,
        detail: `the anchor is not anywhere in ${tip.resolved}; it was deleted or reworded, or the citation described something else`,
      };
    }
    if (hits.length > 1) {
      return {
        ...row,
        action: "ambiguous",
        suggestion: null,
        detail: `the anchor starts on ${hits.length} lines of ${tip.resolved}: ${list(hits)}`,
      };
    }
    const to = hits[0];
    return {
      ...row,
      action: "repoint",
      suggestion: `${file}:${rangeOf(to, to + width)}`,
      detail:
        `the anchor is not in ${where}; it starts on line ${to} of ${tip.resolved}` +
        (width > 0 ? `, and the suggested range keeps the old width, so check its end` : ""),
    };
  });

  const scope = chosen
    ? ` under "${chosen.title}" (record lines ${chosen.start}-${chosen.end})`
    : "";
  return { rows, skipped, scope, base: baseSha };
}

const list = (hits) =>
  `${hits.slice(0, SHOWN_HITS).join(", ")}${hits.length > SHOWN_HITS ? ", …" : ""}`;

/**
 * A commit-ish as the 7-character sha a pin is written with.
 *
 * @param {string} repo
 * @param {string} ref
 */
function resolveCommit(repo, ref) {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", "--short=7", `${ref}^{commit}`],
      {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
      },
    ).trim();
  } catch {
    throw Object.assign(new Error(`--base ${ref}: no such commit`), { exit: 2 });
  }
}

const MARK = /** @type {const} */ ({
  holds: "ok",
  repoint: "REPOINT",
  pin: "PIN",
  ambiguous: "AMBIGUOUS",
  gone: "GONE",
  unresolvable: "FAIL",
});

/**
 * @param {ReturnType<typeof reResolve>} result
 * @param {string} record
 * @returns {{text: string, exit: 0 | 1}}
 */
export function render(result, record) {
  const { rows, skipped, scope, base } = result;
  const out = [];
  out.push(
    `${rows.length} unpinned anchored citation(s) in ${record}${scope}, re-resolved against the working tree` +
      (base === null ? "" : ` and ${base}`),
    "",
  );
  for (const r of rows) {
    const cited = `${r.file}:${rangeOf(r.start, r.end)} "${r.anchor.slice(0, 60)}"`;
    out.push(`  ${MARK[r.action].padEnd(9)} ${cited}  (record line ${r.line})`);
    if (r.action === "holds") continue;
    if (r.detail !== "") out.push(`            ${r.detail}`);
    if (r.suggestion !== null) out.push(`            -> ${r.suggestion}`);
  }
  const counts = Object.keys(MARK).map((a) => ({
    a,
    n: rows.filter((r) => r.action === a).length,
  }));
  const wanting = rows.filter((r) => r.action !== "holds").length;
  out.push(
    "",
    counts.map(({ a, n }) => `${n} ${a}`).join(", ") + ` — of ${rows.length} re-resolved`,
    `not re-resolved: ${skipped.pinned} pinned, ${skipped.malformed} malformed pin, ${skipped.unanchored} unanchored, ` +
      `${skipped.unchecked} prose or file-less, ${skipped.declared} declared evidence`,
    wanting === 0 ? "exit 0 — nothing to change" : `exit 1 — ${wanting} citation(s) want a change`,
  );
  return { text: `${out.join("\n")}\n`, exit: wanting === 0 ? 0 : 1 };
}

function main() {
  const { file, section, base } = parseArgs(process.argv.slice(2));
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    shell: false,
  }).trim();
  const record = locateRecord(repo, file);
  const result = reResolve({ markdown: fs.readFileSync(file, "utf8"), repo, section, base });
  const { text, exit } = render(result, record);
  process.stdout.write(text);
  if (exit !== 0) process.exitCode = exit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const failure = /** @type {Error & {exit?: number}} */ (error);
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = failure.exit ?? 2;
  }
}
