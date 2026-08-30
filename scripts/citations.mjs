/**
 * Resolve the `file:line` citations in a gate record against the tree they
 * claim to describe.
 *
 * A gate names `file.ts:120`. The builder then fixes what the gate found, which
 * moves that line, and the record is committed afterwards — so by the time
 * anyone reads it the citation points somewhere else, often at plausible but
 * unrelated code, which is worse than a dangling one. That is only one of four
 * ways a record goes stale, and the dominant one is not drift at all: reviewers
 * mis-cite systematically, in a consistent direction per reviewer, which is why
 * a spot-check misses it and an enumeration does not.
 *
 * So this enumerates. It is deliberately a script and not an agent: the work is
 * mechanical, it must produce the same answer every time, and it was being
 * rebuilt ad hoc inside whichever builder happened to need it.
 *
 * It cannot tell you a citation is *semantically* right — for that it prints the
 * line so a reader can judge. It can tell you a citation cannot possibly be
 * right, which is the half that is checkable.
 *
 * Plain `.mjs`, no dependencies, matching `status.mjs` and
 * `commit-message.mjs`.
 *
 * Usage:
 *   node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>]
 *
 * `--rev` resolves against a commit rather than the working tree. Pinning the
 * record to the commit the gate actually reviewed is the cheaper answer to a fix
 * that moved the very lines the record cites — cheaper than remapping them.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * A path token that looks like a repo file. Deliberately narrow: it needs a
 * slash or a known extension, so prose like `10:30` or `PASS:1` is not a
 * citation.
 */
const INLINE =
  /(?<file>(?:[\w.@-]+\/)+[\w.@-]+\.\w+|[\w.@-]+\.(?:ts|tsx|mjs|js|json|md|yml|yaml|sh)):(?<start>\d+)(?:[-–](?<end>\d+))?/g;

/** A `file` cell in a table row: the first backticked path-looking token. */
const CELL_FILE =
  /`((?:[\w.@-]+\/)+[\w.@-]+\.\w+|[\w.@-]+\.(?:ts|tsx|mjs|js|json|md|yml|yaml|sh))`/;

/**
 * Extract every citation from a record.
 *
 * Two forms, and the second is the one naive regexes miss: a findings table with
 * a `line` column carries bare numbers that are citations too, and skipping the
 * column silently under-reports coverage. Two builders hit that independently.
 *
 * @param {string} markdown
 * @returns {{file: string, start: number, end: number, source: "inline" | "table", line: number}[]}
 */
export function extractCitations(markdown) {
  const out = [];
  const lines = markdown.split("\n");

  let headers = /** @type {string[]} */ ([]);
  lines.forEach((text, index) => {
    const lineNo = index + 1;

    // A table header resets the column map; a separator row is skipped.
    if (text.trim().startsWith("|")) {
      const cells = text
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c));
      if (isSeparator) return;
      const looksLikeHeader = cells.some((c) => /^(file|path)$/i.test(c));
      if (looksLikeHeader) {
        headers = cells.map((c) => c.toLowerCase());
        return;
      }
      const lineCol = headers.findIndex((h) => /^lines?$/.test(h));
      const fileCol = headers.findIndex((h) => /^(file|path)$/.test(h));
      if (lineCol >= 0 && fileCol >= 0 && cells[lineCol] && cells[fileCol]) {
        // A `file` cell is normally a backticked path; fall back to the bare
        // cell text so a record that forgot the backticks still gets checked.
        const cellMatch = CELL_FILE.exec(cells[fileCol]);
        const file = cellMatch ? cellMatch[1] : cells[fileCol].replace(/`/g, "").trim();
        for (const num of cells[lineCol].matchAll(/\b(\d+)(?:[-–](\d+))?\b/g)) {
          out.push({
            file,
            start: Number(num[1]),
            end: Number(num[2] ?? num[1]),
            source: "table",
            line: lineNo,
          });
        }
        return;
      }
    }

    for (const m of text.matchAll(INLINE)) {
      const g = /** @type {{file: string, start: string, end?: string}} */ (m.groups);
      out.push({
        file: g.file,
        start: Number(g.start),
        end: Number(g.end ?? g.start),
        source: "inline",
        line: lineNo,
      });
    }
  });
  return out;
}

/**
 * Resolve a cited path against the tracked file list.
 *
 * Real gate records cite **bare filenames** — `valhalla.ts:398`, not
 * `tools/planner/api/src/grounding/valhalla.ts:398` — so a resolver that only
 * accepts repo-relative paths reports every citation in every existing record as
 * missing, which is worse than useless. Measured on `pl-28`: 23 of 23.
 *
 * So a bare name is resolved by suffix against the tracked files. If it matches
 * exactly one, that is the file. If it matches more than one it is **ambiguous
 * and fails** — a record citing `health.test.ts` when the repo holds three of
 * them is not a pointer, and quietly picking the first is how a check becomes a
 * rubber stamp.
 *
 * @param {string[]} tracked
 * @returns {(file: string) => {path: string} | {error: string}}
 */
export function makeResolver(tracked) {
  return (file) => {
    if (tracked.includes(file)) return { path: file };
    const suffix = file.startsWith("/") ? file : `/${file}`;
    const matches = tracked.filter((t) => t === file || t.endsWith(suffix));
    if (matches.length === 1) return { path: matches[0] };
    if (matches.length === 0) return { error: "no tracked file matches" };
    return {
      error: `ambiguous — ${matches.length} tracked files match (${matches.slice(0, 3).join(", ")}${matches.length > 3 ? ", …" : ""})`,
    };
  };
}

/**
 * Every file a citation could name.
 *
 * At a rev that is the tree. In the working tree it is the index **plus
 * untracked-but-not-ignored files**, because a record routinely cites a file the
 * branch under review has just added and which nobody has staged yet. Using
 * `ls-files` alone fails those, which this script demonstrated on itself.
 */
export function candidateFiles(repo, rev) {
  const run = (args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  if (rev) return run(["ls-tree", "-r", "--name-only", rev]);
  return [...run(["ls-files"]), ...run(["ls-files", "--others", "--exclude-standard"])];
}

/**
 * Read a file's lines, from the working tree or from a commit.
 *
 * @param {string} repo
 * @param {string | null} rev
 * @returns {(file: string) => string[] | null}
 */
export function makeReader(repo, rev) {
  return (file) => {
    try {
      if (rev) {
        const out = execFileSync("git", ["show", `${rev}:${file}`], {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return out.split("\n");
      }
      return fs.readFileSync(path.join(repo, file), "utf8").split("\n");
    } catch {
      return null;
    }
  };
}

/**
 * Resolve each citation. A citation fails only when it *cannot* be right — the
 * file is gone, or the line is past the end. Everything else is printed for a
 * reader to judge, because a citation whose content changed still resolves and
 * is not this script's to call wrong.
 *
 * @param {ReturnType<typeof extractCitations>} citations
 * @param {(file: string) => string[] | null} read
 */
export function checkCitations(citations, read, resolve = (f) => ({ path: f })) {
  const cache = new Map();
  return citations.map((c) => {
    const resolved = resolve(c.file);
    if ("error" in resolved)
      return { ...c, ok: false, reason: resolved.error, text: null, resolved: null };
    if (!cache.has(resolved.path)) cache.set(resolved.path, read(resolved.path));
    const content = cache.get(resolved.path);
    c = { ...c, resolved: resolved.path };
    if (content === null) return { ...c, ok: false, reason: "file not found", text: null };
    if (c.start < 1 || c.start > content.length) {
      return {
        ...c,
        ok: false,
        reason: `line ${c.start} is past end of file (${content.length} lines)`,
        text: null,
      };
    }
    if (c.end > content.length) {
      return {
        ...c,
        ok: false,
        reason: `range ends at ${c.end}, past end of file (${content.length} lines)`,
        text: null,
      };
    }
    return { ...c, ok: true, reason: null, text: content[c.start - 1].trim() };
  });
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const rev = argv.includes("--rev") ? argv[argv.indexOf("--rev") + 1] : null;
  if (!file) {
    throw new Error("usage: node scripts/citations.mjs <ticket-file> [--rev <sha>]");
  }

  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const markdown = fs.readFileSync(file, "utf8");
  const citations = extractCitations(markdown);
  const results = checkCitations(
    citations,
    makeReader(repo, rev),
    makeResolver(candidateFiles(repo, rev)),
  );
  const bad = results.filter((r) => !r.ok);

  const where = rev ? `against ${rev}` : "against the working tree";
  process.stdout.write(
    `${citations.length} citations in ${path.relative(repo, path.resolve(file))}, resolved ${where}\n\n`,
  );

  for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    const range = r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    const shown =
      r.resolved && r.resolved !== r.file
        ? `${r.file}:${range} -> ${r.resolved}`
        : `${r.file}:${range}`;
    process.stdout.write(`  ${mark} ${shown}  (record line ${r.line}, ${r.source})\n`);
    if (r.ok) process.stdout.write(`       ${r.text.slice(0, 100)}\n`);
    else process.stdout.write(`       ${r.reason}\n`);
  }

  process.stdout.write(`\n${results.length - bad.length}/${results.length} resolve\n`);
  if (bad.length > 0) {
    process.stderr.write(
      `\n${bad.length} citation(s) cannot be right. Re-resolve them against the tree you are committing, or pin the\n` +
        `record to the commit the gate reviewed with --rev and say so in the record.\n\n` +
        `Two things this cannot judge, and you must: a citation whose *content* changed still resolves, and a\n` +
        `citation that is a finding's own evidence ("the text is at :94-95, not :93-94") must stay as written.\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
