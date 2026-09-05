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
 * A citation may carry **anchor text** — a fragment of what it points at,
 * quoted straight after the location:
 *
 *     `tls-origin.ts:144-149` "Defence in depth"
 *
 * When it does, this checks the fragment is actually inside the cited range and
 * says where it went when it is not. That is the only thing here that verifies
 * the *claim* rather than the coordinates, so it is the only thing that reports
 * `verified`. A citation with no anchor still resolves, and is reported as
 * `unanchored` — never as verified, because nothing checked it.
 *
 * Hence there is no `N/N resolve` line any more. Four states are counted
 * separately, because a total that cannot tell them apart is the defect
 * (repo-18): a run over a record whose fix moved the cited lines printed
 * `9/9 resolve` with three citations pointing at unrelated code.
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
 * The anchor that may follow a location: a straight-double-quoted fragment,
 * after an optional closing backtick and at most one space.
 *
 * Both spellings are accepted because reviewers here already write the first
 * one — `` `rate-limit.test.ts:465` "refuses with a 429" `` — 13 times across
 * six records before this script could read any of them, which is why the
 * format is this and not a new one.
 *
 * **Straight quotes only, and no more than one space of separation.** Measured
 * over every record in the tree: 13 matches, all of them genuine anchors, zero
 * prose quotations caught; and zero citations followed by a typographic `“`, so
 * accepting those would buy nothing and would start catching quoted prose.
 */
const ANCHOR = String.raw`(?:\x60?[ \t]?"(?<anchor>[^"\n]{1,200})")?`;

/**
 * A path token that looks like a repo file. Deliberately narrow: it needs a
 * slash or a known extension, so prose like `10:30` or `PASS:1` is not a
 * citation.
 */
const INLINE = new RegExp(
  String.raw`(?<file>(?:[\w.@-]+\/)+[\w.@-]+\.\w+|[\w.@-]+\.(?:ts|tsx|mjs|js|json|md|yml|yaml|sh)):(?<start>\d+)(?:[-–](?<end>\d+))?` +
    ANCHOR,
  "g",
);

/**
 * The same rule inside a table's `line` cell, where the location is a bare
 * number. One lexical rule in both places rather than a new `anchor` column: a
 * cell may hold several citations (`465, 544`), and a column could only anchor
 * the row.
 */
const TABLE_LINE = new RegExp(String.raw`\b(\d+)(?:[-–](\d+))?\b` + ANCHOR, "g");

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
 * @returns {{file: string, start: number, end: number, anchor: string | null, source: "inline" | "table", line: number}[]}
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
        for (const num of cells[lineCol].matchAll(TABLE_LINE)) {
          out.push({
            file,
            start: Number(num[1]),
            end: Number(num[2] ?? num[1]),
            anchor: num.groups?.anchor ?? null,
            source: "table",
            line: lineNo,
          });
        }
        return;
      }
    }

    for (const m of text.matchAll(INLINE)) {
      const g = /** @type {{file: string, start: string, end?: string, anchor?: string}} */ (
        m.groups
      );
      out.push({
        file: g.file,
        start: Number(g.start),
        end: Number(g.end ?? g.start),
        anchor: g.anchor ?? null,
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

/** Collapse every run of whitespace, so an anchor copied out of indented code matches. */
const normalize = (text) => text.replace(/\s+/g, " ").trim();

/**
 * An anchor is a *prefix* of what its author read, so a trailing ellipsis is a
 * truncation mark and not part of the text. Two of the anchors already written
 * by hand in this repo end in one (`"an existing row survives migration 3..."`),
 * and treating the dots as literal would report both as moved.
 */
const normalizeAnchor = (anchor) =>
  normalize(anchor)
    .replace(/(\.{3}|…)$/, "")
    .trim();

/**
 * Every line an anchor's text starts on, in a file.
 *
 * Matched against the file collapsed into **one** string rather than line by
 * line, because the text worth anchoring wraps. The case that earned this is
 * real: repo-7 cites `03-RELEASING.md:97-99` for `heads that release's
 * ### Features`, which runs across lines 118 and 119 of the target and is on
 * neither of them, so a line-by-line match reports it missing and is wrong.
 * Blank lines are dropped rather than joined, so a paragraph break does not
 * leave a double space in the middle of the haystack.
 *
 * **The lines are joined raw, so a comment's continuation marker stays in the
 * haystack.** An anchor spanning `... a mutation` / `// run proved it` therefore
 * does not match — there is a `//` in the middle of it. That is a known boundary
 * with a test on it, not an oversight: stripping `//`, `*` and `#` would be built
 * for a case nothing has asked for. Measured over every anchor written by hand in
 * this repo before the script could read one — 13 of them — exactly one needs the
 * join, and it is the markdown prose above; none needs a marker stripped. When it
 * does bite, the reason printed is `not anywhere in the file` and the fix is a
 * shorter anchor, which is what an anchor is for.
 *
 * Not exported, and that is deliberate — see the note above `summarize`.
 *
 * @param {string[]} content
 * @param {string} anchor
 * @returns {number[]} line numbers, ascending
 */
function locateAnchor(content, anchor) {
  const needle = normalizeAnchor(anchor);
  if (needle === "") return [];

  /** @type {{lineNo: number, at: number}[]} */
  const starts = [];
  let haystack = "";
  content.forEach((text, index) => {
    const normalized = normalize(text);
    if (normalized === "") return;
    if (haystack !== "") haystack += " ";
    starts.push({ lineNo: index + 1, at: haystack.length });
    haystack += normalized;
  });

  /** @type {number[]} */
  const hits = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    // The last line beginning at or before the match is the line it starts on.
    let lineNo = starts[0]?.lineNo ?? 1;
    for (const start of starts) {
      if (start.at > at) break;
      lineNo = start.lineNo;
    }
    hits.push(lineNo);
  }
  return hits;
}

/** How a citation came out, worst first. There is no boolean here on purpose. */
const STATES = /** @type {const} */ (["unresolvable", "moved", "unanchored", "verified"]);

/**
 * Resolve each citation, and where it carries anchor text, check the claim.
 *
 * Four states, because two of them were the defect. `unresolvable` is a citation
 * that *cannot* be right — the file is gone, the line is past the end, the bare
 * name matches several files. `moved` is a citation whose anchor is not in the
 * range it names; the reason says where the anchor actually is, which is the
 * half a reader needs in order to repoint it. `unanchored` resolves and is
 * printed for a reader to judge, exactly as everything did before this ticket —
 * it is **not** verified, because nothing checked it. `verified` is the only
 * state in which this script has an opinion about correctness.
 *
 * @param {ReturnType<typeof extractCitations>} citations
 * @param {(file: string) => string[] | null} read
 */
export function checkCitations(citations, read, resolve = (f) => ({ path: f })) {
  const cache = new Map();
  return citations.map((c) => {
    const resolved = resolve(c.file);
    const at = "error" in resolved ? null : resolved.path;
    const bad = (reason) => ({
      ...c,
      state: "unresolvable",
      reason,
      text: null,
      resolved: at,
      foundAt: null,
    });

    if ("error" in resolved) return bad(resolved.error);
    if (!cache.has(resolved.path)) cache.set(resolved.path, read(resolved.path));
    const content = cache.get(resolved.path);
    c = { ...c, resolved: resolved.path };
    if (content === null) return bad("file not found");
    if (c.start < 1 || c.start > content.length) {
      return bad(`line ${c.start} is past end of file (${content.length} lines)`);
    }
    if (c.end > content.length) {
      return bad(`range ends at ${c.end}, past end of file (${content.length} lines)`);
    }

    const text = content[c.start - 1].trim();
    const range = c.start === c.end ? `${c.start}` : `${c.start}-${c.end}`;
    if (c.anchor === null || normalizeAnchor(c.anchor) === "") {
      // Short on purpose. This repeats once per citation across a whole legacy
      // record, and the sentence explaining how to fix it is worth reading once,
      // so it is on stderr at the end instead.
      return {
        ...c,
        state: "unanchored",
        reason: "no anchor — nothing checked it",
        text,
        foundAt: null,
      };
    }

    const hits = locateAnchor(content, c.anchor);
    const inRange = hits.filter((n) => n >= c.start && n <= c.end);
    if (inRange.length > 0)
      return { ...c, state: "verified", reason: null, text, foundAt: inRange };

    const shown = normalizeAnchor(c.anchor).slice(0, 60);
    const elsewhere = `${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}`;
    return {
      ...c,
      state: "moved",
      reason:
        hits.length > 0
          ? `anchor "${shown}" is not in ${range} — it is at ${elsewhere}`
          : `anchor "${shown}" is not in ${range}, and not anywhere in ${resolved.path}`,
      text,
      foundAt: hits,
    };
  });
}

/**
 * Count the states, and render the one line that replaces `N/N resolve`.
 *
 * Every bucket is printed even at zero. A summary that drops its empty buckets
 * reads as a smaller claim than it is — `9 verified` alone does not tell you the
 * script was capable of saying anything else — and the whole of repo-18 is a
 * count that could not distinguish two states.
 *
 * **Deliberately not exported, along with `locateAnchor` and `STATES`.** This
 * module's export list is byte-identical to the one before repo-18, so the suite
 * that proves this ticket links against the *old* source and fails on an
 * assertion — `expected undefined to be "moved"` — rather than on a missing
 * export. A red reading `SyntaxError: does not provide an export named
 * 'summarize'` proves the API changed and proves nothing about the behaviour,
 * and repo-18 exists because a check that cannot fail informatively is worse
 * than no check. Both are covered through `checkCitations` and the CLI's own
 * output, which is the surface a reader actually reads.
 *
 * @param {ReturnType<typeof checkCitations>} results
 */
function summarize(results) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const r of results) counts[r.state] += 1;
  return {
    ...counts,
    total: results.length,
    // Deliberately never `N/N`: the pair that reads as "all fine" is the shape
    // this script printed while three citations pointed at unrelated code.
    line:
      `${counts.verified} verified, ${counts.moved} moved, ` +
      `${counts.unanchored} unanchored, ${counts.unresolvable} unresolvable` +
      ` — of ${results.length} citation${results.length === 1 ? "" : "s"}`,
  };
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
export const FLAGS = new Map([
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
  const summary = summarize(results);

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
    // Upper case is a failure and lower case is not, so the column is readable
    // before the words are. `unanchored` sets the width; the rest are padded.
    const mark = { verified: "ok", moved: "MOVED", unanchored: "unanchored", unresolvable: "FAIL" }[
      r.state
    ].padEnd(10);
    const range = r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    const located =
      r.resolved && r.resolved !== r.file
        ? `${r.file}:${range} -> ${r.resolved}`
        : `${r.file}:${range}`;
    const shown = r.anchor === null ? located : `${located} "${r.anchor.slice(0, 60)}"`;
    process.stdout.write(`  ${mark} ${shown}  (record line ${r.line}, ${r.source})\n`);
    // An unanchored citation prints both: the line, because a human judging it by
    // hand is the only check it has, and the reason, because that is the part
    // saying nobody has.
    if (r.text !== null && r.state !== "moved") {
      process.stdout.write(`             ${r.text.slice(0, 100)}\n`);
    }
    if (r.reason !== null) process.stdout.write(`             ${r.reason}\n`);
  }

  process.stdout.write(`\n${summary.line}\n`);

  // Not an error, so not on stderr: the run succeeded and this is part of what
  // it found. `stderr is empty` and `exit 0` mean the same thing here, which is
  // an invariant the suite asserts and which advice on stderr would break.
  if (summary.unanchored > 0) {
    process.stdout.write(
      `\n${summary.unanchored} citation(s) carry no anchor text, so nothing here checked them — they are printed\n` +
        `for you to judge by hand. Writing one as \`file.ts:120 "a fragment of the line"\` is what lets\n` +
        `this script tell a moved citation from a correct one.\n`,
    );
  }

  const advice = [];
  if (summary.moved > 0) {
    advice.push(
      `${summary.moved} citation(s) do not point at what they say. Repoint them against the tree you are\n` +
        `committing, or pin the record to the commit the gate reviewed with --rev and say so in the record.`,
    );
  }
  if (summary.unresolvable > 0) {
    advice.push(
      `${summary.unresolvable} citation(s) cannot be right at all: the file is gone, the line is past the end, or\n` +
        `the bare name matches more than one file.`,
    );
  }
  // The carve-out is still not checkable, and still yours: a citation that is a
  // finding's own evidence ("the text is at :94-95, not :93-94") must stay as
  // written even when this reports it moved.
  if (advice.length > 0) process.stderr.write(`\n${advice.join("\n\n")}\n`);
  if (summary.moved > 0 || summary.unresolvable > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
