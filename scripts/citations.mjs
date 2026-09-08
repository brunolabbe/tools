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
 * Hence there is no `N/N resolve` line any more. Six states are counted
 * separately, because a total that cannot tell them apart is the defect
 * (repo-18): a run over a record whose fix moved the cited lines printed
 * `9/9 resolve` with three citations pointing at unrelated code.
 *
 * **A reference this cannot check is still counted** (repo-25). Detecting a
 * citation only in the `file.ts:12` shape meant a record carrying five
 * references and three citations reported three, and read as full coverage — the
 * same could-not-tell-them-apart failure one layer earlier, in the denominator
 * rather than in the verdict. So two more shapes are read:
 *
 *   - **shorthand**, a bare `` `:27` ``, resolved against the nearest preceding
 *     qualified citation. This is not a hypothetical form: 564 of them are
 *     written across the 107 work records, against 0 before this could read one.
 *     A shorthand with nothing before it is `unresolvable`, never a skip.
 *   - **prose**, a `line 367` phrase, reported `unchecked` and never resolved.
 *     Resolving it against the current file would guess — "line 3" in a
 *     paragraph about a fixture is not a pointer — so it is counted, printed and
 *     left for a human, which is the whole of the complaint answered.
 *
 * `unchecked` is never fatal, for the same reason: 99 such phrases sit in the
 * existing records, one reference in 19, and most are ordinary sentences
 * containing a number.
 *
 * **Neither rule is exact, and the inexactness is in opposite directions.** A
 * shorthand's file is a guess — see `extractCitations` — and the syntax collides
 * with a backticked port: `` `:443` `` in a paragraph about TLS reads as a line,
 * inherits whatever file was named above, and fails loudly against a file with
 * fewer lines. Thirteen such sit in `dl-38` and `dl-21`. That is a false failure,
 * it is visible rather than silent, and the declaration mechanism below suppresses
 * it where a record wants it suppressed; there is no lexical rule that separates a
 * port from a line, so a narrower regex cannot fix it.
 *
 * **A record can declare a citation deliberately unresolvable**, which is the one
 * thing the carve-out below could not say to a machine:
 *
 *     <!-- citations: evidence index.ts:440, hls.ts:367 -->
 *
 * Those are reported `evidence` and do not fail the run, so a record whose
 * citations are its own evidence is distinguishable *by exit code* from a broken
 * one. A declaration that matches no failing citation is itself an error —
 * otherwise the marker is a rubber stamp, which is the failure mode every other
 * refusal in this file exists to prevent.
 *
 * **A declaration names a qualified location**, `file.ts:120`, and a shorthand is
 * named by the file it inherited. So the one thing that cannot be declared is a
 * reference this could not attach to a file at all — which is the rule, not a
 * gap: you may only excuse a citation you can name, and a shorthand with nothing
 * above it is fixed by qualifying it, not by waiving it.
 *
 * Plain `.mjs`, no dependencies, matching `status.mjs` and
 * `commit-message.mjs`.
 *
 * Usage:
 *   node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>] [--require-anchors] [--require-distinct-anchors]
 *
 * `--rev` resolves the citation **targets** against a commit rather than the
 * working tree. Pinning the record to the commit the gate actually reviewed is
 * the cheaper answer to a fix that moved the very lines the record cites —
 * cheaper than remapping them.
 *
 * **The record itself is always read from the working tree, and that is correct
 * rather than an oversight**: a gate record is written *after* the commit it
 * reviews, so it does not exist at the sha it pins to and reading it from there
 * would fail every run of the flag's main use. What was wrong (repo-24, folded
 * in here) is that nothing said so. `--rev` answers "do these citations point at
 * the right thing at that sha", not "what did this document claim at that sha",
 * and a reader who assumed the second got no error — so the header line now
 * names both sides, and where the record *does* exist at the rev and cited
 * something different, the run says which references it has that the record did
 * not have then. Reproduced before fixing: a record that gained a citation after
 * the pinned sha has that citation reported `unresolvable` against the old tree,
 * blaming the record for a claim it never made.
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
 *
 * `--require-distinct-anchors` makes a *verified* anchor fatal when its fragment
 * starts on more than one line of the file it points at. Same contract as the
 * flag above and for the same reason: it changes the exit code and nothing else,
 * because how many lines a fragment occupies is a fact about the fragment, not a
 * different verdict about the record.
 *
 * **It exists because `verified` is weaker than it reads, and that was measured
 * rather than supposed** (repo-29). An anchor is verified when *some* occurrence
 * of it starts inside the cited range — see `locateAnchor` — so a fragment that
 * occurs five times verifies that one of the five is in range and not which. Two
 * live instances: `repo-31` cited a line of `ci.yml` anchored on
 * `"informational"`, a word on five lines of that file, and after an unrelated
 * 22-line insertion a *comment* slid into the cited position and the citation
 * went on reporting `ok`; and it reproduces from nothing in a four-line fixture.
 * `Done when` 3 of repo-29 asks authors not to do this, and until this flag
 * there was no way to hold anyone to it.
 *
 * **Off by default, and not folded into `--require-anchors`, which is a
 * measurement and not caution.** repo-21's live CI step runs
 * `--require-anchors` over `orchestrate-tickets/SKILL.md`, and that file anchors
 * a citation on `"model: sonnet"`, which occurs twice in `ticket-reviewer.md`.
 * Folding the rule into the existing flag would have turned that step red on a
 * file nobody in repo-29 touched — the precise failure mode repo-29 exists to
 * stop shipping.
 *
 * **A declaration cannot excuse an indistinct anchor**, and that is deliberate:
 * `citations: evidence` waives a citation that *cannot* be made to pass, and this
 * one always can — by quoting a longer fragment. A waiver that stands in for a
 * one-line edit is the rubber stamp `applyDeclarations` refuses.
 *
 * **The exit code is a bitmask** (`EXIT`), because the failure classes are not
 * alike and one code cannot say which happened — a citation that cannot be
 * resolved, one that resolves to the wrong content, one nothing checked under
 * `--require-anchors`, and a record whose own evidence declaration is wrong. A
 * record whose failures are all declared evidence exits 0. The code and the
 * names of the bits set are printed under the summary, so a CI log says what the
 * number meant next to the number.
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

/**
 * A **shorthand**: a location with no filename, meaning "the same file as the
 * last one I named". `` `:27` ``, `` `:121-129` ``.
 *
 * The backticks are required on both sides and that is the whole of the
 * false-positive defence. Every one of the 568 already written in the records
 * has them, and dropping the requirement would start reading `:80` out of a
 * port, a time, or a YAML value.
 *
 * Both anchor spellings, as `INLINE` accepts them, spelled out rather than
 * reusing `ANCHOR` because the closing backtick sits *between* the two
 * positions the anchor may occupy and there is no way to say that with one
 * optional group. Duplicate group names are avoided on purpose: they are ES2025
 * and this has to run on the pinned Node.
 */
const SHORTHAND = new RegExp(
  String.raw`\x60:(?<start>\d+)(?:[-–](?<end>\d+))?` +
    String.raw`(?:[ \t]?"(?<inner>[^"\n]{1,200})")?\x60` +
    String.raw`(?:[ \t]?"(?<outer>[^"\n]{1,200})")?`,
  "g",
);

/**
 * A **prose** reference: `line 367`, `lines 118-119`.
 *
 * Detected so it can be *counted*, never resolved. The nearest preceding file
 * would often be right and sometimes not — "line 3" turns up in paragraphs about
 * fixtures, diffs and quoted output — and a guess that lands on a real line of
 * the wrong file is the exact failure this script exists to catch, manufactured
 * by the script. So it is reported `unchecked` and left for a human, which is
 * what makes the gap visible without inventing a verdict.
 *
 * No backticks required, because the whole point is that this shape is written
 * as ordinary prose.
 */
const PROSE = /\blines?[ \t]+(\d+)(?:[ \t]*[-–][ \t]*(\d+))?\b/gi;

/**
 * A record declaring, in a form a CI job can read, that a citation's failure is
 * deliberate: `<!-- citations: evidence index.ts:440, hls.ts:367 -->`.
 *
 * An HTML comment rather than a frontmatter field or a marker on the citation
 * itself, and both alternatives were live. Frontmatter is parsed strictly by
 * `status.mjs`, so a new key there costs a change to two more files for a fact
 * that is about one record's citations and nothing else. A marker on the
 * citation edits the citation — and the citations that need this are *quotations
 * of a defect*, including ones inside a reproduction block whose text is the
 * evidence. This touches neither: the declaration sits beside them and names
 * them.
 */
const DECLARATION =
  /^[ \t]*<!--[ \t]*citations:[ \t]*evidence[ \t]+(?<list>[^>]*?)[ \t]*-->[ \t]*$/;

/** A location as a declaration writes it: a qualified `file:line`, no shorthand. */
const DECLARED_LOCATION = /^(?<file>[\w.@/-]+\.\w+):(?<start>\d+)(?:[-–](?<end>\d+))?$/;

/** A `file` cell in a table row: the first backticked path-looking token. */
const CELL_FILE =
  /`((?:[\w.@-]+\/)+[\w.@-]+\.\w+|[\w.@-]+\.(?:ts|tsx|mjs|js|json|md|yml|yaml|sh))`/;

/**
 * Extract every reference from a record.
 *
 * Four forms now, and every one of them was found by something being missed:
 *
 *  1. `file.ts:12` inline — the shape a naive regex gets right.
 *  2. A findings table with a `line` column, whose bare numbers are citations
 *     too. Skipping the column silently under-reports coverage; two builders hit
 *     that independently.
 *  3. `` `:27` `` shorthand, resolved against the last file named above it.
 *  4. `line 367` prose, counted and never resolved.
 *
 * The last two are repo-25, and the ordering is the mechanism: **matches are
 * processed in document order, left to right within a line**, because a
 * shorthand's file comes from the nearest *preceding* qualified citation and a
 * shorthand can sit on the same line as one. Scanning shape by shape instead
 * would resolve `` `:27` `` against a citation written after it.
 *
 * A shorthand or prose match falling inside a qualified match's span is dropped:
 * an anchor is quoted text, and `` `a.ts:12` "the line 44 guard" `` must not
 * report a reference to line 44.
 *
 * `file` is `null` for a reference this could not attach to one — a shorthand
 * with nothing before it, or any prose reference. That is not a skip: the caller
 * turns the first into `unresolvable` and the second into `unchecked`, and both
 * are in the count.
 *
 * A shorthand also carries `from`, the record line its file was named on, and
 * that is not decoration. Nearest-preceding is a **heuristic**: measured over the
 * 564 shorthands in the 107 work records, 180 sit after a citation on their own
 * line and 151 more within five lines of one, but 213 inherit from further up and
 * 20 have nothing above them at all. At least one of the 213 inherits the **wrong**
 * file and resolves anyway: `repo-23`'s record writes `` `:141` `` meaning
 * `docs/02-DEPLOYMENT.md`, inherits an ADR named 70 lines earlier, and prints that
 * ADR's line 141 as the cited text with exit 0. So the file is a guess, and a guess
 * a reader cannot see is the rubber stamp this whole script refuses. Both ends are
 * printed: the shorthand as written and the line the file came from.
 *
 * Resetting the inherited file at a heading is the obvious guard and the numbers
 * refuse it: 94 of the 465 shorthands that resolve inherit across one, and nearly
 * all are right — `repo-6`'s record is about `status.test.ts` throughout. Ninety-four
 * refusals to catch one is the worse trade, so the answer here is provenance, not a
 * verdict.
 *
 * @param {string} markdown
 * @returns {{file: string | null, start: number, end: number, anchor: string | null, source: "inline" | "table" | "shorthand" | "prose", line: number, from: number | null, nearby: boolean}[]}
 */
export function extractCitations(markdown) {
  const out = [];
  const lines = markdown.split("\n");
  /** The last file named outright, which is what a shorthand below it means. */
  let currentFile = /** @type {string | null} */ (null);
  /** And the record line it was named on, so the inheritance can be audited. */
  let currentFileLine = /** @type {number | null} */ (null);
  /**
   * Which paragraph it was named in, which decides whether the inheritance is a
   * guess at all. A blank line is a real lexical boundary — not a tuned distance
   * — and inside one paragraph "the same file" is unambiguous English. Across
   * one, the author may have moved on in prose the scanner cannot read.
   *
   * **A paragraph is delimited by a blank line and nothing else, so a *tight*
   * markdown list is one paragraph however many bullets it has.** Nobody derives
   * that from the rule, so it is written here rather than left to be met: a
   * shorthand in one bullet inherits the file from the bullet above it, counts as
   * `nearby`, and is therefore fatal rather than downgraded. Loosen the list —
   * put a blank line between the items — and the same two bullets stop sharing a
   * file.
   *
   * The example is real and it is in this repository. repo-25's own gate record
   * has a tight list whose second bullet quotes `` `:8443` `` while the first
   * cites `scripts/citations.mjs`; the port is read as a line in that file and
   * fails, which is why that record carries an evidence declaration for it. The
   * reviewer writing that record hit this while reviewing the rule that causes
   * it — the tool caught its own gate record, which is the case for trusting the
   * rule rather than against it.
   */
  let paragraph = 0;
  let currentFileParagraph = /** @type {number | null} */ (null);

  let headers = /** @type {string[]} */ ([]);
  lines.forEach((text, index) => {
    const lineNo = index + 1;

    if (text.trim() === "") paragraph += 1;

    // A declaration is metadata about the citations, not one of them. Skipping
    // the whole line keeps the locations it names out of the count and out of
    // the shorthand's notion of the current file — a declaration that inflated
    // the denominator it exists to explain would be its own defect.
    if (DECLARATION.test(text)) return;

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
        currentFile = file;
        currentFileLine = lineNo;
        currentFileParagraph = paragraph;
        for (const num of cells[lineCol].matchAll(TABLE_LINE)) {
          out.push({
            file,
            start: Number(num[1]),
            end: Number(num[2] ?? num[1]),
            anchor: num.groups?.anchor ?? null,
            source: "table",
            line: lineNo,
            from: null,
            nearby: false,
          });
        }
        return;
      }
    }

    /** @type {{at: number, until: number, make: () => (typeof out)[number]}[]} */
    const found = [];

    for (const m of text.matchAll(INLINE)) {
      const g = /** @type {{file: string, start: string, end?: string, anchor?: string}} */ (
        m.groups
      );
      found.push({
        at: m.index,
        until: m.index + m[0].length,
        make: () => {
          currentFile = g.file;
          currentFileLine = lineNo;
          currentFileParagraph = paragraph;
          return {
            file: g.file,
            start: Number(g.start),
            end: Number(g.end ?? g.start),
            anchor: g.anchor ?? null,
            source: "inline",
            line: lineNo,
            from: null,
            nearby: false,
          };
        },
      });
    }

    const inQualified = (at) => found.some((f) => at >= f.at && at < f.until);

    for (const m of text.matchAll(SHORTHAND)) {
      if (inQualified(m.index)) continue;
      const g = /** @type {{start: string, end?: string, inner?: string, outer?: string}} */ (
        m.groups
      );
      found.push({
        at: m.index,
        until: m.index + m[0].length,
        make: () => ({
          file: currentFile,
          start: Number(g.start),
          end: Number(g.end ?? g.start),
          anchor: g.inner ?? g.outer ?? null,
          source: "shorthand",
          line: lineNo,
          from: currentFileLine,
          nearby: currentFileParagraph === paragraph,
        }),
      });
    }

    for (const m of text.matchAll(PROSE)) {
      if (inQualified(m.index)) continue;
      found.push({
        at: m.index,
        until: m.index + m[0].length,
        make: () => ({
          file: null,
          start: Number(m[1]),
          end: Number(m[2] ?? m[1]),
          anchor: null,
          source: "prose",
          line: lineNo,
          from: null,
          nearby: false,
        }),
      });
    }

    // Document order, so `make` sees the current file as a reader would.
    for (const f of found.toSorted((a, b) => a.at - b.at)) out.push(f.make());
  });
  return out;
}

/**
 * Read a record's evidence declarations, and refuse a malformed one.
 *
 * A declaration says "these citations fail on purpose". It is the only thing
 * here that can *suppress* a failure, so it is parsed strictly: a location that
 * is not a qualified `file:line` is an error rather than an entry that silently
 * matches nothing. A waiver nobody can read is the state this replaces.
 *
 * @param {string} markdown
 * @returns {{file: string, start: number, end: number, text: string, line: number}[]}
 */
export function extractDeclarations(markdown) {
  /** Tagged so the CLI can exit on the declaration bit rather than a generic 1. */
  const refuse = (message) =>
    Object.assign(new Error(message), { exit: /** @type {number} */ (EXIT.declaration) });
  const out = [];
  markdown.split("\n").forEach((text, index) => {
    const declaration = DECLARATION.exec(text);
    if (declaration?.groups === undefined) return;
    const lineNo = index + 1;
    const entries = declaration.groups.list
      .split(",")
      .map((entry) => entry.replaceAll("`", "").trim())
      .filter((entry) => entry !== "");
    if (entries.length === 0) {
      throw refuse(`${lineNo}: an evidence declaration names no citation:\n  ${text.trim()}`);
    }
    for (const entry of entries) {
      const location = DECLARED_LOCATION.exec(entry);
      if (location?.groups === undefined) {
        throw refuse(
          `${lineNo}: "${entry}" is not a citation an evidence declaration can name.\n` +
            `Write each one exactly as the record cites it, qualified: file.ts:120 or file.ts:120-130.`,
        );
      }
      const { file, start, end } = location.groups;
      out.push({
        file,
        start: Number(start),
        end: Number(end ?? start),
        text: entry,
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
const STATES = /** @type {const} */ ([
  "unresolvable",
  "moved",
  "unchecked",
  "unanchored",
  "evidence",
  "verified",
]);

/**
 * Which bit of the exit code each failure class sets.
 *
 * A bitmask rather than a ranking, because the classes co-occur and a ranking
 * collapses them exactly when there is most to say. The names are printed with
 * the number, so nobody has to hold this table in their head to read a CI log.
 *
 * `evidence` is deliberately absent: a declared citation is not a failure, and
 * exit 0 is the whole point of declaring one.
 */
export const EXIT = /** @type {const} */ ({
  unresolvable: 1,
  moved: 2,
  unanchored: 4,
  declaration: 8,
  indistinct: 16,
});

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
 * @param {(file: string) => {path: string} | {error: string}} [resolve] Annotated
 *   rather than inferred from the default, which typed the parameter as one that
 *   can only succeed — so `makeResolver`, the one implementation that exists, was
 *   not assignable to it and a test passing it failed to compile.
 */
export function checkCitations(citations, read, resolve = (f) => ({ path: f })) {
  const cache = new Map();
  return citations.map((c) => {
    // A reference with no file is still a reference, and which of the two
    // no-file cases it is decides everything. A shorthand *claims* a file — the
    // one above it — so a shorthand with nothing above it cannot be right, and
    // that is `unresolvable` by the same definition the rest of this uses. Prose
    // claims nothing, so the honest verdict is that nobody checked it.
    if (c.file === null) {
      const shorthand = c.source === "shorthand";
      return {
        ...c,
        state: shorthand ? "unresolvable" : "unchecked",
        reason: shorthand
          ? `shorthand :${c.start} has no qualified citation before it to take a file from`
          : "prose reference — no file named, so nothing here checked it",
        text: null,
        resolved: null,
        foundAt: null,
        occurrences: null,
      };
    }

    const resolved = resolve(c.file);
    const at = "error" in resolved ? null : resolved.path;
    const bad = (reason) => ({
      ...c,
      state: "unresolvable",
      reason,
      text: null,
      resolved: at,
      foundAt: null,
      occurrences: null,
    });

    /**
     * **A verdict derived from a guess may not be fatal — but only where the file
     * really was guessed.**
     *
     * A shorthand supplies the number; the inheritance supplies the file. "Line
     * 443 is past the end of this file" is a claim about the *pairing*, and where
     * the pairing is guesswork the tool cannot tell a genuinely stale citation
     * from something that was never a citation at all. `` `:443` `` in a
     * paragraph about TLS ports is the case that proved it: thirteen of those sit
     * in `dl-38` and `dl-21`, and reading them as lines into whatever file was
     * named above turned two already-merged, already-gated tickets red.
     *
     * **`nearby` is what keeps this from swallowing real failures**, and it was
     * missing from the first version of this rule. Written unconditionally, the
     * downgrade also excused a shorthand sitting in the *same paragraph* as the
     * citation it inherits from — where there is no guesswork at all, and a
     * number past the end of the file is simply a stale citation. A reviewer
     * built the case that proved it: ``from `citations.mjs:5` to `:99999` `` on
     * one line went from a hard failure to exit 0. So the downgrade applies only
     * across a paragraph boundary, which is a lexical fact about the document
     * rather than a tuned distance.
     *
     * Downgraded, it is `unchecked` — counted, printed with the file it guessed
     * and the line that named it, and fatal to nothing. **Ambiguity is
     * deliberately not routed here at all**: that is a fact about the *name*,
     * which the record wrote out in the qualified citation above, and that
     * citation fails ambiguous on its own.
     */
    const isGuess = c.source === "shorthand" && !c.nearby;
    const guessed = (reason) => ({
      ...c,
      state: isGuess ? "unchecked" : "unresolvable",
      reason: isGuess
        ? `${reason} — and this file was inherited from another paragraph, not written here, so nothing can tell a stale citation from something that was never one`
        : reason,
      text: null,
      resolved: at,
      foundAt: null,
      occurrences: null,
    });

    if ("error" in resolved) return bad(resolved.error);
    if (!cache.has(resolved.path)) cache.set(resolved.path, read(resolved.path));
    const content = cache.get(resolved.path);
    c = { ...c, resolved: resolved.path };
    if (content === null) return bad("file not found");
    if (c.start < 1 || c.start > content.length) {
      return guessed(`line ${c.start} is past end of file (${content.length} lines)`);
    }
    if (c.end > content.length) {
      return guessed(`range ends at ${c.end}, past end of file (${content.length} lines)`);
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
        // Null rather than zero: nothing was searched for, which is a different
        // fact from a fragment that was searched for and found nowhere.
        occurrences: null,
      };
    }

    const hits = locateAnchor(content, c.anchor);
    const inRange = hits.filter((n) => n >= c.start && n <= c.end);
    // `occurrences` is how many lines the fragment starts on in the whole file,
    // which is a different question from whether one of them is in range. A
    // `verified` anchor that matches five lines verified nothing in particular:
    // an unrelated edit can slide a *different* occurrence into the cited
    // position and the citation keeps reporting `ok` while pointing at the
    // wrong thing. Measured on this repo (repo-29, finding 3) rather than
    // supposed. Carried on the result rather than judged here, because whether
    // it is tolerable is the caller's policy — the same split
    // `--require-anchors` already draws.
    if (inRange.length > 0)
      return {
        ...c,
        state: "verified",
        reason: null,
        text,
        foundAt: inRange,
        occurrences: hits.length,
      };

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
      occurrences: hits.length,
    };
  });
}

/** The states a declaration may excuse — the ones that would otherwise fail. */
const FAILING = new Set(["unresolvable", "moved", "unchecked"]);

/** A location as both a citation and a declaration spell it, for matching. */
const key = (file, start, end) => `${file}:${start}${end === start ? "" : `-${end}`}`;

/**
 * Apply a record's evidence declarations, and report the ones that are wrong.
 *
 * A declaration excuses a citation that failed. It does **not** excuse one that
 * passed, and it does not excuse a citation the record does not contain: either
 * of those means the declaration has gone stale — the citation was repointed,
 * renamed or deleted and the waiver outlived it — and a waiver nobody has to
 * keep true is a rubber stamp, which is the failure `makeResolver` refuses for
 * an ambiguous filename and `selectSection` refuses for a missing heading.
 *
 * So a stale declaration is an error with its own bit in the exit code. Three
 * failure classes stay three: a citation that cannot be resolved, one that
 * resolves to the wrong content, and one that is deliberately unresolvable —
 * plus a fourth for the record lying about which is which.
 *
 * Matching is on the citation **as written**, `file:start[-end]`, so a
 * declaration names exactly what a reader sees in the record. `unchecked` is
 * excusable too: a prose reference is one of the shapes a reproduction is made
 * of, and it fails no run, but declaring it is how a record says it meant it.
 *
 * @param {ReturnType<typeof checkCitations>} results
 * @param {ReturnType<typeof extractDeclarations>} declarations
 */
export function applyDeclarations(results, declarations) {
  const excused = new Set(declarations.map((d) => key(d.file, d.start, d.end)));
  const used = new Set();

  const applied = results.map((r) => {
    if (r.file === null) return r;
    const at = key(r.file, r.start, r.end);
    if (!excused.has(at)) return r;
    if (!FAILING.has(r.state)) return r;
    used.add(at);
    return {
      ...r,
      state: "evidence",
      reason: `declared evidence — ${r.reason ?? "no reason given"}`,
    };
  });

  const stale = declarations
    .filter((d) => !used.has(key(d.file, d.start, d.end)))
    .map((d) => {
      const cited = results.some(
        (r) => r.file !== null && key(r.file, r.start, r.end) === key(d.file, d.start, d.end),
      );
      return {
        ...d,
        reason: cited
          ? `record line ${d.line}: "${d.text}" is declared evidence, but it does not fail — drop the declaration`
          : `record line ${d.line}: "${d.text}" is declared evidence, but this record does not cite it`,
      };
    });

  return { results: applied, stale };
}

/**
 * Count the states, and render the one line that replaces `N/N resolve`.
 *
 * Every bucket is printed even at zero. A summary that drops its empty buckets
 * reads as a smaller claim than it is — `9 verified` alone does not tell you the
 * script was capable of saying anything else — and the whole of repo-18 is a
 * count that could not distinguish two states.
 *
 * **Deliberately not exported, along with `locateAnchor` and `STATES`.** repo-18
 * kept this module's whole export list byte-identical so that its suite, run
 * against the *old* source, failed on an assertion rather than on a missing
 * export — a red reading `SyntaxError: does not provide an export named
 * 'summarize'` proves the API changed and proves nothing about the behaviour.
 *
 * **repo-25 added four exports — `extractDeclarations`, `applyDeclarations`,
 * `EXIT` and `recordDrift` — and the property survives them.** That was not
 * obvious and it was asserted wrongly first: this docblock claimed the suite
 * could no longer link against older source, on the reasoning that a missing
 * named export is an ESM link error. **Under vitest it is not.** The reviewer
 * measured it and it reproduces — the current 58-test suite run against
 * `b93e345` gives `3 failed | 55 passed`, no `SyntaxError`, because vite's
 * transform degrades an absent named export to `undefined` instead of refusing
 * to link. Two of the three fail on behaviour (`expected … to match /read from
 * the working tree…/`); only the third, which calls `recordDrift` directly,
 * fails as `TypeError: recordDrift is not a function`.
 *
 * So repo-18's standard still holds for the acceptances that matter, and the
 * remaining care is to keep asserting them through the CLI as well — the
 * reproduction's five references, the declared-evidence exit code, the stale
 * declaration. Those were also run against the pre-repo-25 script by hand:
 * `3 citations` where the reproduction has five, `exit 1` on a record that
 * declares its evidence, and `0 citations` on a record that is nothing but prose
 * references. `summarize` itself stays private for repo-18's reason.
 *
 * `requireAnchors` is applied here rather than at the exit, so the one function
 * that knows the counts is also the one that says what they mean. It changes
 * `failed`, sets `EXIT.unanchored` and appends to `line`; it does not touch a
 * single citation's state, because whether an *unanchored* citation is tolerable
 * is the caller's policy and not a fact about the record.
 *
 * @param {ReturnType<typeof checkCitations>} results
 * @param {boolean} requireAnchors
 * @param {{reason: string}[]} stale
 */
function summarize(results, requireAnchors, stale = [], requireDistinct = false) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const r of results) counts[r.state] += 1;

  // A `verified` anchor that starts on more than one line of its target. Not a
  // state: the citation really is verified, and which lines its fragment
  // occupies is a fact about the fragment rather than about the record — so
  // this is counted, reported, and fatal only when the caller asks, exactly as
  // `unanchored` is.
  const indistinct = results.filter((r) => r.state === "verified" && (r.occurrences ?? 1) > 1);

  // Each class sets its own bit, so a run with two of them says two. The names
  // are carried alongside because the number alone is the thing this file spent
  // repo-18 arguing against.
  /** @type {string[]} */
  const because = [];
  let exit = 0;
  const set = (bit, name) => {
    exit |= EXIT[bit];
    because.push(name);
  };
  if (counts.unresolvable > 0) set("unresolvable", `${counts.unresolvable} unresolvable`);
  if (counts.moved > 0) set("moved", `${counts.moved} moved`);
  if (requireAnchors && counts.unanchored > 0) set("unanchored", `${counts.unanchored} unanchored`);
  if (requireDistinct && indistinct.length > 0)
    set("indistinct", `${indistinct.length} anchor(s) not distinct`);
  if (stale.length > 0) set("declaration", `${stale.length} stale evidence declaration`);

  return {
    ...counts,
    indistinct,
    total: results.length,
    failed:
      counts.moved +
      counts.unresolvable +
      (requireAnchors ? counts.unanchored : 0) +
      (requireDistinct ? indistinct.length : 0),
    exit,
    // Deliberately never `N/N`: the pair that reads as "all fine" is the shape
    // this script printed while three citations pointed at unrelated code. The
    // suffix is on the same line as the counts so a CI log shows the policy that
    // judged them next to the numbers it judged.
    line:
      `${counts.verified} verified, ${counts.moved} moved, ` +
      `${counts.unanchored} unanchored, ${counts.unresolvable} unresolvable, ` +
      `${counts.unchecked} unchecked, ${counts.evidence} evidence` +
      ` — of ${results.length} reference${results.length === 1 ? "" : "s"}` +
      (requireAnchors ? ", anchors required" : "") +
      (requireDistinct ? ", distinct anchors required" : ""),
    // The number and what it meant, on one line. `exit 3` in a CI log is not
    // readable and `exit 0` is the claim a record makes about its own evidence,
    // so both get words next to them.
    exitLine: `exit ${exit} — ${because.length > 0 ? because.join(", ") : "nothing to fix"}`,
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
 * What this record cites now that it did not cite at `--rev`, and the reverse.
 *
 * Only meaningful when the record exists at the rev at all, which for a gate
 * record it usually does not — and that silence is the right output, not a gap.
 * Compared on the **reference list** rather than on the bytes, because a record
 * gains a Log entry constantly and almost none of that changes what a run
 * checked. The list changing is the only thing that changes the answer.
 *
 * Returns `null` when nothing moved, so the caller has one thing to test.
 *
 * The count at the rev is `atRev` and **not** `then`, which is what it was
 * called until oxlint's `no-thenable` refused it: an object carrying a `then`
 * property is a thenable, and one that reached an `await` would be unwrapped as
 * a promise instead of returned. A lint rule caught a defect here, so the name
 * is load-bearing rather than a style preference.
 *
 * @param {string} now The record as it stands, which is what was checked.
 * @param {string} before The same path's content at the rev.
 */
export function recordDrift(now, before) {
  const here = extractCitations(now);
  const there = extractCitations(before);
  const at = (c) => key(c.file, c.start, c.end);
  const thereKeys = new Set(there.map(at));
  const hereKeys = new Set(here.map(at));
  const added = here.filter((c) => !thereKeys.has(at(c)));
  const removed = there.filter((c) => !hereKeys.has(at(c)));
  if (added.length === 0 && removed.length === 0) return null;
  return { now: here.length, atRev: there.length, added, removed };
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
  ["--require-distinct-anchors", { option: "requireDistinct", takesValue: false }],
]);

/**
 * One usage string, shared by the docblock above, the missing-file error and the
 * unknown-flag error. They disagreed before — the docblock advertised
 * `--section` and the error did not — and a rejection that prints a usage line
 * omitting an accepted flag tells the reader that flag is invalid too, which is
 * repo-14's open question answered by an error message.
 */
export const USAGE =
  "usage: node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>] [--require-anchors] [--require-distinct-anchors]";

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
 * @returns {{file: string, rev: string | null, section: string | null, requireAnchors: boolean, requireDistinct: boolean}}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let file = null;
  /** @type {{rev: string | null, section: string | null, requireAnchors: boolean}} */
  const options = { rev: null, section: null, requireAnchors: false, requireDistinct: false };

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

/**
 * The same directory, whatever it was spelled.
 *
 * **Both callers pass git's own `--show-toplevel` answer**, one from the
 * process's cwd and one from the record's directory, and that is worth stating
 * plainly because an earlier draft of this comment claimed one side came from
 * `path.resolve` — which is the defect `locateRecord` exists to undo, described
 * in the wrong place. It was wrong, a gate caught it, and the correction is the
 * point: git resolves symlinks and short names before it answers, so two
 * invocations naming one directory agree byte for byte, and `a === b` is the
 * whole comparison in practice.
 *
 * **The `realpath` branch is therefore unreached today, and it is kept
 * deliberately rather than by oversight.** Attempts to construct a divergence,
 * all of which failed: `-C` against a symlinked root, an inherited cwd through
 * the same symlink, and `PWD` set to the symlinked spelling in four
 * combinations — git returned the resolved path every time and ignores `PWD`
 * outright. What keeps it is one link in the chain this ticket could not
 * measure: that git-for-windows' `getcwd` normalises a short name *identically*
 * for two separate invocations. If it ever does not, this branch is the
 * difference between a correct path and a silent return to the bug, and it
 * cannot produce a false positive — two different directories have two
 * different real paths. `realpathSync.native` and not the plain one, because
 * only the native variant expands an 8.3 short name.
 *
 * So: delete this branch and its tests the day someone confirms that
 * normalisation on a Windows host. Until then it is insurance against the one
 * assumption here that nobody has run.
 *
 * @param {string} a
 * @param {string} b
 */
export function sameDirectory(a, b) {
  if (a === b) return true;
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

/**
 * Name the record the way **git** names it, so `git show <rev>:<path>` finds it.
 *
 * This was `path.relative(repo, path.resolve(file))`, and string arithmetic
 * between a path git printed and a path Node resolved is only sound while the
 * filesystem admits one spelling of each. It does not always. Where the two
 * spellings differ the subtraction escapes the repository instead of landing
 * inside it; `makeReader` then asks for `<rev>:../../..`, git has no such entry,
 * the reader returns `null`, and `--rev` **silently stops reporting drift**. The
 * failure is a missing paragraph rather than an error, which is how it survived
 * eight completed matrix runs before anyone read one.
 *
 * Measured two ways (repo-36). On `windows-latest`, `os.tmpdir()` hands back the
 * 8.3 short name `C:\Users\RUNNER~1\…` while git resolves the long
 * `C:/Users/runneradmin/…`, and the subtraction produced
 * `..\..\..\..\..\RUNNER~1\…\drift.md`. On Linux, a directory reached through a
 * symlink produces `../link/drift.md` — the same mechanism, one spelling of the
 * filesystem's choosing rather than Windows'.
 *
 * So ask git, from the record's own directory. That closes the general case
 * rather than the two observed ones, and it settles the separator question for
 * free: git always answers in forward slashes, the only spelling `<rev>:<path>`
 * accepts, where `path.relative` answers in the platform's.
 *
 * **The arithmetic stays as the fallback, and that is not defensiveness.** A
 * record does not have to live in the repository being checked — this script's
 * own suite checks fixture records in a temp directory against this repo — and
 * for one of those a `..`-path is the honest answer, because there is no in-tree
 * name to give. So git's prefix is taken only when the record's directory
 * belongs to the *same* repository; otherwise a record in some other checkout
 * would resolve to a plausible path in the wrong tree, which is the exact
 * failure this whole script exists to catch.
 *
 * @param {string} repo
 * @param {string} file
 * @returns {string}
 */
export function locateRecord(repo, file) {
  const resolved = path.resolve(file);
  const arithmetic = path.relative(repo, resolved);
  let answer;
  try {
    answer = execFileSync("git", ["rev-parse", "--show-toplevel", "--show-prefix"], {
      cwd: path.dirname(resolved),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    return arithmetic;
  }
  if (!sameDirectory(answer[0].trim(), repo)) return arithmetic;
  // `--show-prefix` is empty at the root and otherwise already ends in a slash,
  // so the basename appends without a separator of this file's choosing.
  return `${answer[1].trim()}${path.basename(resolved)}`;
}

function main() {
  const { file, rev, section, requireAnchors, requireDistinct } = parseArgs(process.argv.slice(2));

  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const markdown = fs.readFileSync(file, "utf8");
  const relative = locateRecord(repo, file);

  // The record at the rev, when there is one. `makeReader` already returns null
  // for a path a commit does not have, which is the ordinary case for a gate
  // record and needs no branch of its own.
  const before = rev === null ? null : makeReader(repo, rev)(relative);
  const drift = before === null ? null : recordDrift(markdown, before.join("\n"));

  // Selected by line span rather than by re-extracting from a slice of the
  // markdown. `extractCitations` carries state across lines — a table's header
  // row sets the column map for the rows under it — so extracting from a slice
  // that began below a header would under-report the table silently. Filtering
  // afterwards leaves the extraction seeing exactly the document it always saw.
  const chosen = section === null ? null : selectSection(extractSections(markdown), section);
  const inScope = (line) => chosen === null || (line >= chosen.start && line <= chosen.end);
  const citations = extractCitations(markdown).filter((c) => inScope(c.line));

  // Declarations are filtered by the same span as the citations they excuse, so
  // `--section Review` cannot be failed by a stale declaration under `## Log`
  // — nor excused by one, since the citation it names is out of scope too.
  const declarations = extractDeclarations(markdown).filter((d) => inScope(d.line));

  const { results, stale } = applyDeclarations(
    checkCitations(citations, makeReader(repo, rev), makeResolver(candidateFiles(repo, rev))),
    declarations,
  );
  const summary = summarize(results, requireAnchors, stale, requireDistinct);

  // Both sides named, because naming one was the whole defect: a reader who
  // passed a sha and got a verdict had no way to see which document produced it.
  const where = rev
    ? `read from the working tree and resolved against ${rev}`
    : "resolved against the working tree";
  // The scope is named next to the count, so a filtered number can never be read
  // against the wrong denominator without the denominator being on screen.
  const scope = chosen
    ? ` under "${chosen.title}" (record lines ${chosen.start}-${chosen.end})`
    : "";
  process.stdout.write(`${citations.length} references in ${relative}${scope}, ${where}\n\n`);

  for (const r of results) {
    // Upper case is always a failure. Lower case usually is not — but under
    // `--require-anchors` a lowercase `unanchored` is a failure too, so the
    // column is a fast read rather than the whole answer; the summary line and
    // the exit code are. (This comment said "lower case is not" full stop until
    // `--require-anchors` made that conditionally false and nothing re-read it,
    // which is this branch's own thesis turning up inside the file arguing it.)
    // `unanchored` sets the width; the rest are padded.
    const mark = {
      verified: "ok",
      moved: "MOVED",
      unanchored: "unanchored",
      unresolvable: "FAIL",
      unchecked: "unchecked",
      evidence: "evidence",
    }[r.state].padEnd(10);
    const range = r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    // A reference is printed as the record wrote it — `line 367`, `:27` — so the
    // line a reader has to go and fix is the line they see. A shorthand prints
    // both ends: what it says, and the file it inherited with the record line
    // that named it, because that file is a guess and a guess has to be audible.
    const resolvedTo = r.resolved && r.resolved !== r.file ? ` -> ${r.resolved}` : "";
    const located =
      r.file === null
        ? `${r.source === "prose" ? "line " : ":"}${range}`
        : r.source === "shorthand"
          ? `:${range} in ${r.file}${resolvedTo} (named at record line ${r.from})`
          : `${r.file}:${range}${resolvedTo}`;
    const shown = r.anchor === null ? located : `${located} "${r.anchor.slice(0, 60)}"`;
    process.stdout.write(`  ${mark} ${shown}  (record line ${r.line}, ${r.source})\n`);
    // An unanchored citation prints both: the line, because a human judging it by
    // hand is the only check it has, and the reason, because that is the part
    // saying nobody has.
    if (r.text !== null && r.state !== "moved") {
      process.stdout.write(`             ${r.text.slice(0, 100)}\n`);
    }
    if (r.reason !== null) process.stdout.write(`             ${r.reason}\n`);
    // Printed whatever the policy, like every other fact here: a reader judging
    // an unanchored citation by hand wants to know its neighbour verified on a
    // fragment that matches half the file.
    if ((r.occurrences ?? 1) > 1) {
      process.stdout.write(
        `             anchor starts on ${r.occurrences} lines of ${r.resolved} — verified means one of` +
          ` them is in range, not which one\n`,
      );
    }
  }

  process.stdout.write(`\n${summary.line}\n${summary.exitLine}\n`);

  // Unanchored is advice on stdout and a failure on stderr, and which one it is
  // depends only on the flag. That keeps `stderr is empty` and `exit 0` meaning
  // the same thing — an invariant the suite asserts, and the reason this is not
  // simply always written to stderr.
  if (drift !== null) {
    const moved = [
      drift.added.length > 0 ? `${drift.added.length} it did not have then` : null,
      drift.removed.length > 0 ? `${drift.removed.length} it has since dropped` : null,
    ].filter(Boolean);
    process.stdout.write(
      `\nThis record exists at that rev and cited something different there: ${drift.now} reference(s)\n` +
        `now, ${drift.atRev} then — ${moved.join(", ")}.\n` +
        `Every reference above is the one this record carries NOW, checked against that tree, so a\n` +
        `citation the record did not have then can still be reported against it. That is what --rev\n` +
        `is for. To ask what the document claimed then, run against a copy extracted with\n` +
        `\`git show ${rev}:${relative}\` instead.\n`,
    );
  }
  if (summary.unchecked > 0) {
    process.stdout.write(
      `\n${summary.unchecked} reference(s) name a line without naming a file, in a shape nothing here can\n` +
        `resolve — a prose "line 367". They are counted so they are not invisible, and they fail nothing.\n` +
        `Qualify one as \`file.ts:367\`, or as \`:367\` after a citation that names the file, to have it checked.\n`,
    );
  }
  if (summary.evidence > 0) {
    process.stdout.write(
      `\n${summary.evidence} citation(s) are declared evidence by this record, so their failure is deliberate and\n` +
        `does not set an exit bit. Each is still printed with the reason it would have failed for.\n`,
    );
  }
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
  if (requireDistinct && summary.indistinct.length > 0) {
    advice.push(
      `${summary.indistinct.length} anchor(s) verify on a fragment that starts on more than one line of the file\n` +
        `they point at, and --require-distinct-anchors is in force. They are true today and cannot stay\n` +
        `true on their own: an unrelated edit can slide a different occurrence into the cited line and the\n` +
        `citation keeps reporting ok. Quote more of the line until the fragment is unique. There is no\n` +
        `evidence declaration for this — the fix is always available, so a waiver would be a rubber stamp.`,
    );
  }
  if (stale.length > 0) {
    advice.push(
      `${stale.length} evidence declaration(s) in this record are wrong, which is a failure of its own:\n` +
        `${stale.map((s) => `  ${s.reason}`).join("\n")}\n` +
        `A declaration excuses a citation that fails. One that excuses nothing is a rubber stamp, and a\n` +
        `citation whose failure was fixed should lose its declaration in the same edit.`,
    );
  }
  // The carve-out the footer used to describe in prose is a declaration now:
  // `<!-- citations: evidence file.ts:120 -->`. What still cannot be checked is
  // whether the record deserves one — a citation that is a finding's own
  // evidence must stay as written, and only a reader can say that it is one.
  if (advice.length > 0) process.stderr.write(`\n${advice.join("\n\n")}\n`);
  if (summary.exit !== 0) process.exitCode = summary.exit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const failure = /** @type {Error & {exit?: number}} */ (error);
    process.stderr.write(`${failure.message}\n`);
    // A malformed declaration is the record lying about its own citations, so it
    // carries the same bit as a stale one rather than collapsing into the
    // generic 1 that argument errors use.
    process.exitCode = failure.exit ?? 1;
  }
}
