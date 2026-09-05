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
 *   node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>] [--require-anchors]
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
 *
 * `--require-anchors` makes `unanchored` fatal, for a record that wants to hold
 * itself to the stricter standard before the default gets there. **It changes
 * the exit code and nothing else.** A citation's state is a fact about the
 * record, so the same citation reports `unanchored` either way; whether that is
 * a failure is the caller's policy, and a flag that repainted it `FAIL` would
 * destroy the one property these states have. The default stays exit 0, because
 * turning it on for everyone fails every run against all 965 citations already
 * in the tree.
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
 * with a test on it, not an oversight, and the reason it is narrow is better than
 * the frequency count that first justified it: **because the marker stays in the
 * haystack, an anchor produced by copy-paste keeps the marker too, and
 * verifies.** `"not what fixes // the collision"` matches; only
 * `"not what fixes the collision"` does not. So the failure needs an author
 * retyping across the break while silently dropping the marker — a far narrower
 * target than "anchors that cross a comment boundary", and the opposite of what
 * *cite what you read* pushes anyone toward.
 *
 * That also inverts the case for stripping. Stripping the haystack alone would
 * *break* the copy-paste case above, so the only coherent version is
 * strip-both-sides, whose false-positive surface is real: `#` is a markdown
 * heading, a shell comment and a CSS id; `*` is a bullet, a JSDoc continuation
 * and a glob. Building that for zero observed consumers is what the root
 * `CLAUDE.md` forbids. Frequency agrees — of the 13 anchors written by hand
 * before this script could read one, exactly one needs the join and none needs a
 * marker stripped — but frequency alone is only "we have not needed it yet".
 *
 * **Verified iff the anchor's text starts on a line inside `[start, end]`.** The
 * end is deliberately loose: an anchor may run past the cited range. The
 * dangerous direction is closed — text lying *entirely* outside the range cannot
 * read as verified, because the match's start line must be in it — and requiring
 * end-containment would make any wrapped anchor unverifiable unless the author
 * widened the range by computing an end line from the anchor's length. That is
 * the exact upstream error this ticket's Reproduction diagnoses (`143 = 149 − 6`)
 * and that `records.md` answers with *cite what you read, never compute one
 * citation from another*. Start-in-range is not a compromise; it is the only
 * predicate compatible with the repo's own authoring rule.
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
 * name matches several files. `moved` is a citation whose anchor does not
 * *start* on a line inside the range it names — containment of the whole anchor
 * is not required, and `locateAnchor` says why; the reason printed says where
 * the anchor actually starts, which is the half a reader needs to repoint it. `unanchored` resolves and is
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
 * `requireAnchors` is applied here rather than at the exit, so the one function
 * that knows the counts is also the one that says what they mean. It changes
 * `failed` and appends to `line`; it does not touch a single citation's state,
 * because whether an unchecked citation is tolerable is the caller's policy and
 * not a fact about the record.
 *
 * @param {ReturnType<typeof checkCitations>} results
 * @param {boolean} requireAnchors
 */
function summarize(results, requireAnchors) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const r of results) counts[r.state] += 1;
  return {
    ...counts,
    total: results.length,
    failed: counts.moved + counts.unresolvable + (requireAnchors ? counts.unanchored : 0),
    // Deliberately never `N/N`: the pair that reads as "all fine" is the shape
    // this script printed while three citations pointed at unrelated code. The
    // suffix is on the same line as the counts so a CI log shows the policy that
    // judged them next to the numbers it judged.
    line:
      `${counts.verified} verified, ${counts.moved} moved, ` +
      `${counts.unanchored} unanchored, ${counts.unresolvable} unresolvable` +
      ` — of ${results.length} citation${results.length === 1 ? "" : "s"}` +
      (requireAnchors ? ", anchors required" : ""),
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

/**
 * Every flag this CLI accepts, mapped to the option it sets and whether it takes
 * a value. The arity is data rather than a branch in the parser because
 * `--require-anchors` is the first flag here that takes none, and a parser that
 * assumed otherwise would swallow the ticket file as its value — which is
 * repo-14's defect, one flag over.
 */
export const FLAGS = new Map([
  ["--rev", { option: "rev", takesValue: true }],
  ["--section", { option: "section", takesValue: true }],
  ["--require-anchors", { option: "requireAnchors", takesValue: false }],
]);

/**
 * One usage string, shared by the docblock above, the missing-file error and the
 * unknown-flag error. They disagreed before — the docblock advertised
 * `--section` and the error did not — and a rejection that prints a usage line
 * omitting an accepted flag tells the reader that flag is invalid too, which is
 * repo-14's open question answered by an error message.
 */
export const USAGE =
  "usage: node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>] [--require-anchors]";

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
 * A flag that takes no value must not consume the next argument, which is the
 * same defect read from the other end — so the arity comes off `FLAGS` and the
 * destination comes off the option name. Assigning by key rather than by an
 * `if (option === "rev") … else …` chain is what keeps a fourth flag from
 * needing a fourth arm here.
 *
 * @param {string[]} argv
 * @returns {{file: string, rev: string | null, section: string | null, requireAnchors: boolean}}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let file = null;
  /** @type {{rev: string | null, section: string | null, requireAnchors: boolean}} */
  const options = { rev: null, section: null, requireAnchors: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Anything leading with `-` is a flag claim, not a filename. Letting `-r`
    // through as the ticket file would reproduce this ticket one dash over.
    if (!arg.startsWith("-")) {
      if (file !== null) throw new Error(`unexpected argument ${arg}\n${USAGE}`);
      file = arg;
      continue;
    }
    const flag = FLAGS.get(arg);
    if (flag === undefined) throw new Error(`unknown option ${arg}\n${USAGE}`);
    if (!flag.takesValue) {
      options[flag.option] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
    options[flag.option] = value;
  }

  if (file === null) throw new Error(USAGE);
  return { file, ...options };
}

function main() {
  const { file, rev, section, requireAnchors } = parseArgs(process.argv.slice(2));

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
  const summary = summarize(results, requireAnchors);

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
    // Upper case is always a failure. Lower case usually is not — but under
    // `--require-anchors` a lowercase `unanchored` is a failure too, so the
    // column is a fast read rather than the whole answer; the summary line and
    // the exit code are. (This comment said "lower case is not" full stop until
    // `--require-anchors` made that conditionally false and nothing re-read it,
    // which is this branch's own thesis turning up inside the file arguing it.)
    // `unanchored` sets the width; the rest are padded.
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

  // Unanchored is advice on stdout and a failure on stderr, and which one it is
  // depends only on the flag. That keeps `stderr is empty` and `exit 0` meaning
  // the same thing — an invariant the suite asserts, and the reason this is not
  // simply always written to stderr.
  if (summary.unanchored > 0 && !requireAnchors) {
    process.stdout.write(
      `\n${summary.unanchored} citation(s) carry no anchor text, so nothing here checked them — they are printed\n` +
        `for you to judge by hand. Writing one as \`file.ts:120 "a fragment of the line"\` is what lets\n` +
        `this script tell a moved citation from a correct one.\n`,
    );
  }

  // Ordered as the summary line orders them, so the numbers and their reasons
  // can be read down the screen in the same sequence.
  const advice = [];
  if (summary.moved > 0) {
    advice.push(
      `${summary.moved} citation(s) do not point at what they say. Repoint them against the tree you are\n` +
        `committing, or pin the record to the commit the gate reviewed with --rev and say so in the record.\n` +
        `Where the reason says the anchor is nowhere in the file, neither of those is the fix — the anchor\n` +
        `spans something the file has between its words, most often a comment's // or * continuation\n` +
        `marker. Shorten it to one line's worth, or quote the marker as it appears.`,
    );
  }
  if (summary.unanchored > 0 && requireAnchors) {
    advice.push(
      `${summary.unanchored} citation(s) carry no anchor text and --require-anchors is in force, so this run\n` +
        `failed on them. Write each as \`file.ts:120 "a fragment of the line"\`, or drop the flag to get the\n` +
        `default, which reports them and exits 0.`,
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
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
