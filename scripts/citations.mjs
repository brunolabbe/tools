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
 *
 * `--section` narrows the check to one heading's span — `--section Review` on a
 * gate record with four `##` sections. The name is matched case-insensitively,
 * exactly first and then by prefix. A name that matches nothing, or that matches
 * more than one section, is an **error**: a quiet whole-file answer wearing the
 * label of a filtered one is the failure this flag was reported for.
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

/**
 * The heading spans of a record, in document order.
 *
 * A heading owns every line down to the next heading of the same level or
 * higher, so `## Review` carries its `###` subsections with it. The alternative
 * stops at the first subheading and silently drops the citations under it, which
 * is this script's own failure mode reintroduced by its own flag.
 *
 * **Fenced code is not searched for headings**, and that is not defensive
 * coding: records here quote changelog fragments, and 40 heading-looking lines
 * sit inside fences across the work records as measured when this was written.
 * Reading `### Fixes` out of a quoted changelog would end the real section early
 * and drop every citation after it, reporting a smaller count as if it were the
 * answer.
 *
 * Only *heading detection* skips fences. `extractCitations` still reads every
 * line exactly as it did before, so `--section` can never change which citations
 * a record has — only which of them are reported.
 *
 * @param {string} markdown
 * @returns {{title: string, level: number, start: number, end: number}[]}
 */
export function extractSections(markdown) {
  const lines = markdown.split("\n");
  /** @type {{title: string, level: number, start: number}[]} */
  const headings = [];
  /** @type {{char: string, length: number} | null} */
  let fence = null;

  lines.forEach((text, index) => {
    // A closing fence matches the opening one's character and is at least as
    // long, which is what lets a fenced block quote a shorter fence.
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (mark) {
      const char = mark[1][0];
      const length = mark[1].length;
      if (fence === null) fence = { char, length };
      else if (char === fence.char && length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;

    const heading = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/.exec(text);
    if (heading) headings.push({ title: heading[2], level: heading[1].length, start: index + 1 });
  });

  return headings.map((h, i) => {
    const next = headings.slice(i + 1).find((other) => other.level <= h.level);
    return { ...h, end: next ? next.start - 1 : lines.length };
  });
}

/** A heading as it appears in the record, for an error message that can be copied. */
const showHeading = (s) => `${"#".repeat(s.level)} ${s.title}`;

/**
 * Pick the one section a `--section` name refers to.
 *
 * Case-insensitive, exact before prefix. Headings here read
 * `## Open question — do not settle it here` and `### Gate — 2026-09-01`, and
 * demanding the em dash on a command line would make the flag unusable; exact
 * winning outright is what keeps `Log` meaning `## Log` in a record that also
 * has `## Logging notes`.
 *
 * **A name matching more than one section fails** rather than taking the first
 * — the rule `makeResolver` already applies to an ambiguous bare filename, for
 * the same reason: quietly picking one is how a check becomes a rubber stamp.
 *
 * **A name matching nothing fails too**, and that is the one worth arguing.
 * `0/0 resolve` with exit 0 is already the honest output for a section that
 * exists and holds no citations, so a silent miss would be *indistinguishable
 * from a correct result*: a typo'd section name would report success having
 * checked nothing at all. That is a worse version of the wrong-denominator
 * failure this flag was reported for, reached through the fix for it.
 *
 * @param {ReturnType<typeof extractSections>} sections
 * @param {string} name
 */
export function selectSection(sections, name) {
  const wanted = name.trim().toLowerCase();
  const exact = sections.filter((s) => s.title.toLowerCase() === wanted);
  const matches =
    exact.length > 0 ? exact : sections.filter((s) => s.title.toLowerCase().startsWith(wanted));

  const [only] = matches;
  if (only && matches.length === 1) return only;
  if (matches.length === 0) {
    throw new Error(
      `no section matches "${name}". This record has:\n  ${sections.map(showHeading).join("\n  ") || "(no headings)"}`,
    );
  }
  throw new Error(
    `"${name}" matches ${matches.length} sections:\n  ${matches.map(showHeading).join("\n  ")}\n` +
      `Name one of them exactly.`,
  );
}

/** Every flag this CLI accepts, mapped to the option it sets. All take a value. */
const FLAGS = new Map([
  ["--rev", "rev"],
  ["--section", "section"],
]);

/**
 * One usage string, shared by the docblock above, the missing-file error and the
 * unknown-flag error. They disagreed before — the docblock advertised
 * `--section` and the error did not — and a rejection that prints a usage line
 * omitting an accepted flag tells the reader that flag is invalid too, which is
 * repo-14's open question answered by an error message.
 */
export const USAGE =
  "usage: node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>]";

/**
 * Parse argv into the ticket file and its options.
 *
 * A flag's **value** does not look like a flag, so the previous
 * `argv.find((a) => !a.startsWith("--"))` could not tell one from the positional
 * argument: `--rev HEAD <ticket>` read a file named `HEAD` and exited 1. Walking
 * the array and consuming each recognised flag's value is what fixes that, and
 * it is the same pass that can reject a flag it does not recognise — both
 * defects live on this one line of parsing, which is why they are one change.
 *
 * @param {string[]} argv
 * @returns {{file: string, rev: string | null, section: string | null}}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let file = null;
  /** @type {string | null} */
  let rev = null;
  /** @type {string | null} */
  let section = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Anything leading with `-` is a flag claim, not a filename. Letting `-r`
    // through as the ticket file would reproduce this ticket one dash over.
    if (!arg.startsWith("-")) {
      if (file !== null) throw new Error(`unexpected argument ${arg}\n${USAGE}`);
      file = arg;
      continue;
    }
    const option = FLAGS.get(arg);
    if (option === undefined) throw new Error(`unknown option ${arg}\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
    if (option === "rev") rev = value;
    else section = value;
  }

  if (file === null) throw new Error(USAGE);
  return { file, rev, section };
}

function main() {
  const { file, rev, section } = parseArgs(process.argv.slice(2));

  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const markdown = fs.readFileSync(file, "utf8");

  // Selected by line span rather than by re-extracting from a slice of the
  // markdown. `extractCitations` carries state across lines — a table's header
  // row sets the column map for the rows under it — so extracting from a slice
  // that began below a header would under-report the table silently. Filtering
  // afterwards leaves the extraction seeing exactly the document it always saw.
  const chosen = section === null ? null : selectSection(extractSections(markdown), section);
  const citations = extractCitations(markdown).filter(
    (c) => chosen === null || (c.line >= chosen.start && c.line <= chosen.end),
  );

  const results = checkCitations(
    citations,
    makeReader(repo, rev),
    makeResolver(candidateFiles(repo, rev)),
  );
  const bad = results.filter((r) => !r.ok);

  const where = rev ? `against ${rev}` : "against the working tree";
  // The scope is named next to the count, so a filtered number can never be read
  // against the wrong denominator without the denominator being on screen.
  const scope = chosen
    ? ` under "${chosen.title}" (record lines ${chosen.start}-${chosen.end})`
    : "";
  process.stdout.write(
    `${citations.length} citations in ${path.relative(repo, path.resolve(file))}${scope}, resolved ${where}\n\n`,
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
