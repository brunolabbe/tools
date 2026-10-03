/**
 * Splice a reviewer's returned `## Review` section (or a later `### Gate <n>`)
 * into its ticket, check it, format it, and hand back the disclosure note.
 *
 * Landing a gate is four things done by hand: find the right spot in the
 * ticket, paste the section in verbatim, run the formatter, then diff the
 * result against what was pasted to prove nothing but table padding moved.
 * (It was five until adr/006 retired the citation checker.) repo-55's Why
 * section names four incidents where one of those steps was skipped or
 * done wrong under a different context each time — a record spliced into the
 * middle of an earlier one because the insertion anchored on a heading string
 * quoted 500 lines above the real heading, three of four tickets in one batch
 * failing the gate the moment their record was committed, a gate record left
 * uncommitted twice on one ticket, and a formatter rewrap that split a
 * citation's coordinate from its anchor. None of that is judgement; it is one
 * procedure, done by hand, under pressure to move on to the next ticket.
 *
 * **The insertion point is found by heading form, never by searching for the
 * bare heading text.** `markdown.mjs`'s `extractSections` is used for
 * this: its heading regex only matches a line that syntactically *is* an ATX
 * heading, so a heading name quoted inline inside a sentence — the repo-13
 * mechanism — is never mistaken for the real thing. The first gate on a ticket
 * (no `--gate`) has no existing `## Review` to anchor on, so it anchors on the
 * ticket's `## Log` heading instead and inserts the whole new `## Review`
 * section directly above it; every later gate (`--gate <n>`) anchors on the end
 * of the `## Review` section that already exists, and appends its
 * `### Gate <n>` subsection there.
 *
 * **A failed check restores the ticket from `git show HEAD:<ticket>` — never
 * from an in-memory copy** — so a checker crash or an unexpected exception
 * between the write and the restore can never leave a half-spliced ticket
 * looking like a clean one; the working tree's own history is the only copy
 * trusted. That restore is only safe because the script refuses to run at all
 * when the ticket is not tracked by git yet, or already has uncommitted
 * changes against `HEAD` (both a ticket-reviewer gate, repo-55): without the
 * first guard an untracked ticket has no `HEAD` copy to restore from at all,
 * and without the second the restore would silently discard whatever was
 * uncommitted, not only the splice — trading a stale-memory hazard for a
 * lost-work one rather than closing it.
 *
 * **The formatter runs as `oxfmt`'s own `bin` entry under `process.execPath`,
 * never through `npx` or `node_modules/.bin/oxfmt`.** `testing.md` names the
 * reason: the `.bin` shim is a symlink whose only portability is a `#!` line,
 * so spawning it without a shell works on Linux and fails on Windows, where
 * npm writes `.cmd`/`.ps1` shims beside it that node refuses to run without a
 * shell — which this repo forbids outright. `npx` has its own failure mode,
 * reproduced while building this script: run from a directory with no
 * `node_modules` above it — the ordinary case for a ticket living in some
 * other checkout, which is exactly what this script's own test fixtures do —
 * it falls back to fetching *whatever the registry calls latest* over the
 * network rather than the version this repository pins (a bare
 * `npx oxfmt --version` run that way installed `0.68.0` against this tree's
 * pinned `0.62.0`). Resolving the package with `createRequire` and running its
 * `bin` file directly has neither problem: it is the exact package this
 * repository installed, however far from it the ticket file happens to sit,
 * and it has no platform-specific spelling at all.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { extractSections, selectSection, splitLines } from "./markdown.mjs";
import { parseFrontmatter } from "./status.mjs";

/**
 * Whether two spellings name one directory. `realpathSync.native` and not the
 * plain one, because only the native variant expands a Windows 8.3 short name.
 *
 * @param {string} a
 * @param {string} b
 */
function sameDirectory(a, b) {
  if (a === b) return true;
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

/**
 * Name the record the way **git** names it, so `git show <rev>:<path>` finds
 * it. String arithmetic between a path git printed and a path Node resolved is
 * only sound while the filesystem admits one spelling of each, so git is asked
 * and the arithmetic is the fallback.
 *
 * @param {string} repo
 * @param {string} file
 */
function locateRecord(repo, file) {
  const resolved = path.resolve(file);
  const arithmetic = path.relative(repo, resolved);
  let answer;
  try {
    answer = execFileSync("git", ["rev-parse", "--show-toplevel", "--show-prefix"], {
      cwd: path.dirname(resolved),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    }).split("\n");
  } catch {
    return arithmetic;
  }
  if (!sameDirectory(answer[0].trim(), repo)) return arithmetic;
  // `--show-prefix` is empty at the root and otherwise already ends in a slash.
  return `${answer[1].trim()}${path.basename(resolved)}`;
}

export const USAGE =
  "usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]";

/**
 * Parse argv into the ticket file, the section file, and the gate number.
 *
 * `--gate`'s value is validated here, so nothing downstream can consume a bad
 * one by mistake: a value that is not a positive integer is refused before it
 * ever reaches `String(gate)` in a regexp and quietly matches every gate at
 * once.
 *
 * @param {string[]} argv
 * @returns {{ticket: string, sectionFile: string, gate: number | null}}
 */
export function parseArgs(argv) {
  const positional = [];
  let gate = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--gate") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--gate needs a value\n${USAGE}`);
      if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(
          `--gate must be a positive integer, got ${JSON.stringify(value)}\n${USAGE}`,
        );
      }
      gate = Number(value);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option ${arg}\n${USAGE}`);
    positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const [ticket, sectionFile] = positional;
  return { ticket, sectionFile, gate };
}

/**
 * Refuse a section file whose first line does not match what `gate` promises —
 * ticket step 1. Without `--gate` the file must open a brand new `## Review`
 * section; with it, the file must open the `### Gate <n>` subsection `--gate`
 * named, and nothing shorter — `### Gate 1` must not accept a file that opens
 * `### Gate 10`, which is why this is a digit-boundary match and not a prefix.
 *
 * @param {string} sectionText
 * @param {number | null} gate
 */
export function validateFirstLine(sectionText, gate) {
  const firstLine = sectionText.split("\n", 1)[0].replace(/\r$/, "");
  if (gate === null) {
    if (firstLine !== "## Review") {
      throw new Error(
        `--gate was not given, so the section file's first line must be exactly "## Review"; got ${JSON.stringify(firstLine)}`,
      );
    }
    return;
  }
  if (!new RegExp(`^### Gate ${gate}(?!\\d)`).test(firstLine)) {
    throw new Error(
      `--gate ${gate} was given, so the section file's first line must start with "### Gate ${gate}"; got ${JSON.stringify(firstLine)}`,
    );
  }
}

/**
 * Find the line to insert the section above — ticket step 2 — and enforce the
 * refusal rules that keep a second call from either duplicating `## Review`,
 * appending a gate to a ticket that has none, or re-appending a gate number
 * that already exists under it (a ticket-reviewer gate, repo-55).
 *
 * Both anchors are heading-form matches from `extractSections`, so a heading
 * name quoted inline in the ticket's own prose is never mistaken for the real
 * section boundary — that confusion is repo-13's own reproduction, recorded in
 * `records.md`.
 *
 * @param {string} markdown
 * @param {number | null} gate
 * @returns {{anchorLine: number}}
 */
export function planInsertion(markdown, gate) {
  const sections = extractSections(markdown);
  const level2 = sections.filter((s) => s.level === 2);
  const review = level2.filter((s) => s.title.trim().toLowerCase() === "review");

  if (gate === null) {
    if (review.length > 0) {
      throw new Error(
        'the ticket already has a "## Review" section; pass --gate <n> to add another gate to it',
      );
    }
  } else {
    if (review.length === 0) {
      throw new Error(
        `--gate ${gate} was given but the ticket has no "## Review" section yet; omit --gate for the first gate`,
      );
    }
    if (review.length > 1) {
      throw new Error(
        `the ticket has ${review.length} "## Review" sections; fix the ticket by hand before splicing another gate into it`,
      );
    }
    const already = sections.filter(
      (s) =>
        s.level === 3 &&
        s.start >= review[0].start &&
        s.end <= review[0].end &&
        new RegExp(`^Gate ${gate}(?!\\d)`).test(s.title.trim()),
    );
    if (already.length > 0) {
      throw new Error(
        `the ticket already has a "### Gate ${gate}" heading under "## Review"; choose a different --gate number`,
      );
    }
  }

  let log;
  try {
    log = selectSection(level2, "Log");
  } catch (error) {
    throw new Error(
      `cannot find the "## Log" heading to anchor the splice on: ${/** @type {Error} */ (error).message}`,
      { cause: error },
    );
  }

  return { anchorLine: gate === null ? log.start : review[0].end + 1 };
}

/**
 * Insert `sectionText` unchanged, one blank line after it, right before the
 * line numbered `anchorLine`. Pure and unformatted — `oxfmt` is what turns
 * this into something that reads like the rest of the ticket.
 *
 * @param {string} markdown
 * @param {string} sectionText
 * @param {number} anchorLine
 */
export function insertSection(markdown, sectionText, anchorLine) {
  const lines = markdown.split("\n");
  const anchorIndex = anchorLine - 1;
  const sectionLines = sectionText.replace(/\n+$/, "").split("\n");
  return [...lines.slice(0, anchorIndex), ...sectionLines, "", ...lines.slice(anchorIndex)].join(
    "\n",
  );
}

/**
 * Find the block just inserted, in the *formatted* ticket — never by replaying
 * the line numbers `planInsertion` computed, because `oxfmt` can move every
 * line after the point it touches first (a table anywhere earlier in the
 * ticket re-pads too). Re-deriving the boundary from the formatted text's own
 * heading structure is what keeps that reflow from being mistaken for part of
 * the diff in step 4.
 *
 * **Bounded to the end of `## Review`, not to the matched heading's own
 * `extractSections` range** (a ticket-reviewer gate, repo-55): a gate's own
 * body can carry a `###` heading of its own — "what the builder should read
 * first" and the like — which would otherwise end the range early and diff
 * only the gate's tail against the whole section file the builder pasted,
 * reporting a false non-empty diff on a splice that landed correctly.
 *
 * @param {string} formattedMarkdown
 * @param {number | null} gate
 */
export function locateInsertedBlock(formattedMarkdown, gate) {
  const sections = extractSections(formattedMarkdown);
  const level2 = sections.filter((s) => s.level === 2);
  const review = selectSection(level2, "Review");
  if (gate === null) return review;

  const heading = sections.find(
    (s) =>
      s.level === 3 &&
      s.start >= review.start &&
      s.end <= review.end &&
      new RegExp(`^Gate ${gate}(?!\\d)`).test(s.title.trim()),
  );
  if (heading === undefined) {
    throw new Error(
      `could not find the inserted "### Gate ${gate}" heading under "## Review" after formatting`,
    );
  }
  return { start: heading.start, end: review.end };
}

/** A table rule cell, collapsed to its shortest form — alignment kept, width dropped. */
const collapseRuleCell = (cell) =>
  cell.startsWith(":") && cell.endsWith(":")
    ? ":-:"
    : cell.startsWith(":")
      ? ":-"
      : cell.endsWith(":")
        ? "-:"
        : "-";

/**
 * Collapse what `oxfmt` is allowed to change in a markdown table — cell
 * padding and rule width — so a diff against the pre-formatted section file
 * reports a real change and nothing else. Every non-table line, and every
 * trailing blank line the section boundary happens to carry, passes through
 * unchanged or is trimmed the same way on both sides of the diff.
 *
 * @param {string} text
 */
export function normalizeForDiff(text) {
  const lines = text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return line;
    const body = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
    const cells = body.split("|").map((cell) => cell.trim());
    if (cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))) {
      return `| ${cells.map(collapseRuleCell).join(" | ")} |`;
    }
    return `| ${cells.join(" | ")} |`;
  });
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/**
 * The normalised diff between two texts, as `git diff --no-index` renders it —
 * reused rather than reimplemented, so the disclosure note is produced by the
 * same diff engine every reviewer already reads.
 *
 * @param {string} oldText
 * @param {string} newText
 */
function buildDiff(oldText, newText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-diff-"));
  try {
    const before = path.join(dir, "section-file");
    const after = path.join(dir, "inserted-block");
    fs.writeFileSync(before, `${oldText}\n`);
    fs.writeFileSync(after, `${newText}\n`);
    const result = spawnSync(
      "git",
      [
        "diff",
        "--no-index",
        "--no-color",
        "--src-prefix=",
        "--dst-prefix=",
        "--",
        "section-file",
        "inserted-block",
      ],
      { cwd: dir, encoding: "utf8", shell: false },
    );
    if (result.error) throw result.error;
    // --no-index exits 0 when the files are identical and 1 when they differ;
    // anything else is git itself failing, not a diff to report.
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git diff --no-index failed: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The toplevel of the git repository containing `p`, whether `p` is a file or a directory. */
function repoRootFor(p) {
  const dir = fs.statSync(p).isDirectory() ? p : path.dirname(p);
  return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    shell: false,
  }).trim();
}

/**
 * `oxfmt`'s own `bin` entry, resolved from this repository's `node_modules`
 * rather than through `npx` or the `.bin` shim — see the module docblock.
 */
const OXFMT = (() => {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("oxfmt/package.json");
  const { bin } = /** @type {{bin: {oxfmt: string}}} */ (require("oxfmt/package.json"));
  return path.resolve(path.dirname(manifest), bin.oxfmt);
})();

/**
 * Ticket steps 1-5, pulled out of `main` so `--land` (repo-80) can run the
 * same splice over more than one section without reimplementing the checks
 * — the formatter, the verbatim-after-formatting
 * comparison, and the restore-from-HEAD discipline all stay in one place.
 * `main` is the only other caller, and calling this with no `options`
 * reproduces its behaviour exactly.
 *
 * A refusal raised *before* the ticket is ever written — a bad section, an
 * untracked or dirty ticket — is a plain `Error`, exactly as it always was, so
 * it reaches a caller's own top-level `catch` unchanged. A refusal raised
 * *after* the write, once the ticket has already been restored from `HEAD`,
 * carries the formatter's or the checker's own `stdout`/`stderr`/`exitCode`,
 * so `main` can still print exactly what it printed before this was split out.
 *
 * @param {string} ticketAbsolutePath
 * @param {string} sectionFileAbsolutePath
 * @param {number | null} gate
 * @param {{requireClaudePins?: boolean}} [options] `requireClaudePins` is
 *   `--land`'s own addition (repo-78 gate 2, F2/G2-d): its splice refuses what
 *   CI refuses, not only what a plain splice has always checked.
 * @returns {{relative: string, diff: string, checkStdout: string}}
 */
export function spliceSection(ticketAbsolutePath, sectionFileAbsolutePath, gate) {
  const markdown = fs.readFileSync(ticketAbsolutePath, "utf8");
  const sectionText = fs.readFileSync(sectionFileAbsolutePath, "utf8");

  // Step 1.
  validateFirstLine(sectionText, gate);
  // Step 2.
  const { anchorLine } = planInsertion(markdown, gate);

  const ticketRepoRoot = repoRootFor(ticketAbsolutePath);
  const relative = locateRecord(ticketRepoRoot, ticketAbsolutePath);

  // Refuse before touching the file at all when the ticket is not tracked yet
  // — a ticket-reviewer gate, repo-55. `git diff --quiet HEAD -- <path>`
  // below reports a clean tree for a path HEAD has no record of at all, which
  // is indistinguishable from "committed and unchanged" to that command; an
  // untracked ticket would sail past the dirty check, splice, fail its check,
  // and then have no HEAD copy to restore from — the exact failure the dirty
  // check exists to prevent, reached through the one path it cannot see.
  const tracked = spawnSync(
    "git",
    ["-C", ticketRepoRoot, "ls-files", "--error-unmatch", "--", relative],
    { encoding: "utf8", shell: false },
  );
  if (tracked.error) throw tracked.error;
  if (tracked.status !== 0) {
    throw new Error(
      `${relative} is not tracked by git yet; commit it first. A failed check restores this file ` +
        `from HEAD, which has no copy of an untracked path to restore.`,
    );
  }

  // Refuse before touching the file at all when the ticket already carries
  // uncommitted changes against HEAD — the restore below overwrites the whole
  // file with HEAD's content on a failed check, which would silently discard
  // anything uncommitted, not only the splice (a ticket-reviewer gate,
  // repo-55).
  const dirty = spawnSync(
    "git",
    ["-C", ticketRepoRoot, "diff", "--quiet", "HEAD", "--", relative],
    { encoding: "utf8", shell: false },
  );
  if (dirty.error) throw dirty.error;
  if (dirty.status === 1) {
    throw new Error(
      `${relative} has uncommitted changes against HEAD; commit them first. A failed check ` +
        `restores this file from HEAD, which would discard anything not committed — not only the splice.`,
    );
  }
  if (dirty.status !== 0) {
    throw new Error(
      `could not check ${relative} against HEAD: ${dirty.stderr || "git diff failed"}`,
    );
  }

  // Step 3: insert, then format, then check — restoring from HEAD on either
  // formatter or checker failure, never from `markdown` above, which is this
  // process's memory and not the ticket's own history.
  fs.writeFileSync(ticketAbsolutePath, insertSection(markdown, sectionText, anchorLine));

  const restoreFromHead = () => {
    const show = spawnSync("git", ["-C", ticketRepoRoot, "show", `HEAD:${relative}`], {
      encoding: "utf8",
      shell: false,
    });
    if (show.status !== 0) {
      process.stderr.write(
        `could not restore ${relative} from HEAD after a failed check (${show.stderr || "git show failed"}).\n` +
          `The ticket on disk still carries the failed splice — restore it by hand with:\n` +
          `  git checkout HEAD -- ${relative}\n`,
      );
      return;
    }
    fs.writeFileSync(ticketAbsolutePath, show.stdout);
  };

  const fmt = spawnSync(process.execPath, [OXFMT, ticketAbsolutePath], {
    cwd: ticketRepoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (fmt.error) throw fmt.error;
  if (fmt.status !== 0) {
    restoreFromHead();
    throw Object.assign(new Error("oxfmt failed to format the spliced ticket"), {
      stdout: fmt.stdout,
      stderr: fmt.stderr,
      exitCode: fmt.status ?? 1,
    });
  }

  // Step 4.
  const formatted = fs.readFileSync(ticketAbsolutePath, "utf8");
  const block = locateInsertedBlock(formatted, gate);
  const blockText = formatted
    .split("\n")
    .slice(block.start - 1, block.end)
    .join("\n");
  const diff = buildDiff(
    normalizeForDiff(sectionText.replace(/\n+$/, "")),
    normalizeForDiff(blockText),
  );

  // Step 5 (repo-62): the block that landed must be the section file as the
  // formatter renders it and nothing more. The splice inserted it verbatim, so
  // this can only fail on the script's own locating or on the formatter doing
  // something context-dependent — but when it does, the ticket goes back to
  // HEAD before anyone can commit it.
  const comparison = compareRecord(sectionText, blockText, formatMarkdown(sectionText));
  if (!comparison.matches) {
    restoreFromHead();
    const message = describeMismatch(
      comparison,
      block.start,
      relative,
      "after splicing",
      sectionFileAbsolutePath,
    );
    throw Object.assign(new Error("the landed block is not the section file"), {
      stdout: "",
      stderr: message,
      exitCode: 1,
    });
  }

  return { relative, diff };
}

function main() {
  const { ticket, sectionFile, gate } = parseArgs(process.argv.slice(2));
  const ticketAbsolutePath = path.resolve(ticket);
  const sectionFileAbsolutePath = path.resolve(sectionFile);

  let result;
  try {
    result = spliceSection(ticketAbsolutePath, sectionFileAbsolutePath, gate);
  } catch (error) {
    const failure = /** @type {Error & {stdout?: string, stderr?: string, exitCode?: number}} */ (
      error
    );
    if (failure.stdout !== undefined || failure.stderr !== undefined) {
      if (failure.stdout) process.stdout.write(failure.stdout);
      if (failure.stderr) process.stderr.write(failure.stderr);
      process.exitCode = failure.exitCode ?? 1;
      return;
    }
    throw error;
  }

  // Before the disclosure note, never after it: everything below that header
  // is the diff a lander pastes into the Log.
  process.stdout.write(
    `\nOnce committed, check the record against the file it came from with:\n` +
      `  node scripts/review-record.mjs --verify ${ticket} ${sectionFile}${gate === null ? "" : ` --gate ${gate}`}\n`,
  );
  process.stdout.write(
    `\nSpliced into ${result.relative}.\n\n` +
      "Normalised diff against the section file (table padding and rule width ignored) — empty means\n" +
      "verbatim survived the formatter. Paste this into the Log as the disclosure note:\n\n",
  );
  process.stdout.write(result.diff);
}

// ---------------------------------------------------------------------------
// --verify — the committed record against the file it came from (repo-62)
// ---------------------------------------------------------------------------

/*
 * Everything from here down is appended below `main` rather than threaded
 * through `parseArgs` and the helpers above it. That order was forced while
 * merged gate records cited this file by line; it is only history now.
 *
 * Why a separate mode at all: the splice never commits. The lander commits,
 * and on 2026-09-26 two landers committed a gate record whose words were not
 * the reviewer's — three bullets reworded into the lander's own dispositions
 * (dl-69, ebd9649), a citation re-anchored onto text the lander's own fix had
 * written (repo-50, d0389bb). Nothing the splice checks can see an edit made
 * to the ticket after the splice ran. The only comparison that can is the
 * committed blob against the file the gate wrote — run by whoever holds that
 * file, which is the orchestrator, not the lander.
 */

export const VERIFY_USAGE =
  "usage: node scripts/review-record.mjs --verify <ticket-file> <section-file> [--gate <n>] [--rev <rev>]";

/**
 * Parse `--verify`'s argv: the same two positionals and `--gate` as a splice,
 * plus `--rev` — the commit whose copy of the ticket is compared, `HEAD` by
 * default, because the claim being checked is about what was committed, not
 * what is on disk.
 *
 * @param {string[]} argv
 * @returns {{ticket: string, sectionFile: string, gate: number | null, rev: string}}
 */
export function parseVerifyArgs(argv) {
  const positional = [];
  let gate = null;
  let rev = "HEAD";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify") continue;
    if (arg === "--gate") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--gate needs a value\n${VERIFY_USAGE}`);
      if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(
          `--gate must be a positive integer, got ${JSON.stringify(value)}\n${VERIFY_USAGE}`,
        );
      }
      gate = Number(value);
      continue;
    }
    if (arg === "--rev") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`--rev needs a value\n${VERIFY_USAGE}`);
      }
      rev = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option ${arg}\n${VERIFY_USAGE}`);
    positional.push(arg);
  }
  if (positional.length !== 2) throw new Error(VERIFY_USAGE);
  const [ticket, sectionFile] = positional;
  return { ticket, sectionFile, gate, rev };
}

/**
 * The block one gate occupies in a ticket that may already carry later gates.
 *
 * `locateInsertedBlock` runs right after a splice, when the gate just added is
 * always the last thing under `## Review`, so it can run to the end of the
 * section. A verify runs any time afterwards — gate 1 checked once gate 3 has
 * landed below it — so the block has to end where the next gate begins.
 *
 * **Bounded by counting the section file's own `###` headings, never by what
 * a heading's title says** (gate 1 on repo-62). A formatter does not touch a
 * heading, so a faithful record carries exactly the file's `###` headings, in
 * order, and the next one after them is the next gate's. The first version
 * read gate numbers out of titles instead, and a gate body with a sub-heading
 * such as `### Gate 2 style findings quoted from elsewhere` then made the
 * boundary skip the real `### Gate 2` — a false failure on a faithful record.
 * Counting also keeps a body's own heading (the repo-55 case
 * `locateInsertedBlock` documents) inside its block, and a lander who adds or
 * drops a heading moves the boundary, which the comparison then reports.
 *
 * **A later gate starts at the heading whose title is the file's own first
 * line**, for the same reason: `### Gate 2 style …` inside gate 1 is the first
 * heading that starts with `Gate 2`, and is not gate 2. Only when no title
 * matches exactly — the lander changed the heading itself — does it fall back
 * to the first `Gate <n>` heading, where the comparison fails on that change.
 *
 * @param {string} markdown
 * @param {number | null} gate
 * @param {string} sectionText
 * @returns {{start: number, end: number}}
 */
export function locateGateBlock(markdown, gate, sectionText) {
  const headings = extractSections(markdown);
  const review = selectSection(
    headings.filter((s) => s.level === 2),
    "Review",
  );
  const inReview = headings.filter(
    (s) => s.level === 3 && s.start > review.start && s.start <= review.end,
  );

  let start = review.start;
  if (gate !== null) {
    const firstTitle = /^###[ \t]+(.*\S)[ \t]*$/.exec(splitLines(sectionText)[0])?.[1];
    const candidates = inReview.filter((s) =>
      new RegExp(`^Gate ${gate}(?!\\d)`).test(s.title.trim()),
    );
    const heading = candidates.find((s) => s.title === firstTitle) ?? candidates[0];
    if (heading === undefined) {
      throw new Error(`there is no "### Gate ${gate}" heading under "## Review"`);
    }
    start = heading.start;
  }

  const ownHeadings = extractSections(sectionText).filter((s) => s.level === 3).length;
  const next = inReview.filter((s) => s.start >= start)[ownHeadings];
  return { start, end: next === undefined ? review.end : next.start - 1 };
}

/**
 * Render markdown the way `oxfmt` would render it inside the ticket, by
 * formatting it alone in a temporary `.md` file. `oxfmt` legitimately rewrites
 * more than table padding — `*` bullets to `-`, `*emphasis*` to `_emphasis_`,
 * `***` to `---` — so a committed record can differ from a reviewer's raw file
 * in all of those and still be every word the reviewer wrote.
 *
 * @param {string} text
 * @returns {string}
 */
export function formatMarkdown(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-fmt-"));
  try {
    const file = path.join(dir, "section.md");
    fs.writeFileSync(file, text);
    const formatter = spawnSync(process.execPath, [OXFMT, file], {
      cwd: dir,
      encoding: "utf8",
      shell: false,
    });
    if (formatter.error) throw formatter.error;
    if (formatter.status !== 0) {
      throw new Error(
        `oxfmt could not format the section file: ${formatter.stderr || formatter.stdout}`,
      );
    }
    return fs.readFileSync(file, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Whether a landed block is the section file: equal, after table padding is
 * collapsed on both sides, to the raw file or to the formatter's rendering of
 * it. Anything else — a word, a coordinate, an anchor, a line added or
 * dropped — is a mismatch, and the diff is taken against the formatted file so
 * that it shows only that, never the formatter's own rewrites.
 *
 * @param {string} sectionText the file the gate wrote
 * @param {string} blockText the block as it stands in the ticket
 * @param {string} formattedSectionText `formatMarkdown(sectionText)`
 * @returns {{matches: boolean, diff: string}}
 */
export function compareRecord(sectionText, blockText, formattedSectionText) {
  const landed = normalizeForDiff(blockText);
  const raw = normalizeForDiff(sectionText.replace(/\n+$/, ""));
  const formatted = normalizeForDiff(formattedSectionText.replace(/\n+$/, ""));
  if (landed === raw || landed === formatted) return { matches: true, diff: "" };
  return { matches: false, diff: buildDiff(formatted, landed) };
}

/**
 * The ticket's own line numbers for every line a diff from `compareRecord`
 * adds or changes, and the section file's lines it drops — the lines a reader
 * has to go and look at. The normalisation changes no line count above the
 * trailing blanks it trims, so a line in the diff's new side is exactly line
 * `blockStart + n - 1` of the ticket.
 *
 * @param {string} diff
 * @param {number} blockStart
 * @returns {{ticket: {line: number, text: string}[], section: {line: number, text: string}[]}}
 */
export function differingLines(diff, blockStart) {
  const ticket = [];
  const section = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    // `\ No newline at end of file` is part of the unified format this parses.
    // `buildDiff` never emits it today, since it ends both sides with a
    // newline; skipping it keeps the numbering right for any diff handed in.
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      ticket.push({ line: blockStart + newLine - 1, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith("-")) {
      section.push({ line: oldLine, text: line.slice(1) });
      oldLine++;
    } else {
      oldLine++;
      newLine++;
    }
  }
  return { ticket, section };
}

/** One numbered line per entry, quoted so trailing whitespace shows. */
const showLines = (entries) =>
  entries.map((e) => `  ${e.line}: ${JSON.stringify(e.text)}`).join("\n") || "  (none)";

/**
 * The error a mismatch prints: which lines of the ticket differ, which lines
 * of the section file are missing from it, then the diff itself.
 *
 * @param {{diff: string}} comparison
 * @param {number} blockStart
 * @param {string} relative
 * @param {string} where
 * @param {string} sectionFile
 */
export function describeMismatch(comparison, blockStart, relative, where, sectionFile) {
  const { ticket, section } = differingLines(comparison.diff, blockStart);
  return (
    `the gate record in ${relative} ${where} is not ${sectionFile} — it differs beyond ` +
    `table padding and the formatter's own rewrites.\n` +
    `A gate record is committed as the file the gate wrote; a word, a coordinate or an anchor ` +
    `the gate did not write goes back to the gate for amendment, never into the record.\n\n` +
    `Lines of ${relative} that the section file does not have:\n${showLines(ticket)}\n\n` +
    `Lines of the section file (as formatted) missing from ${relative}:\n${showLines(section)}\n\n` +
    comparison.diff
  );
}

/**
 * `--verify`'s own steps, pulled out for the same reason `spliceSection` was
 * (repo-80): `--land` runs this once per section, right after pushing, and it
 * throws rather than printing so `land()` can fold the message into its own
 * step report instead of writing straight to `stderr`.
 *
 * @param {string} ticketAbsolutePath
 * @param {string} sectionFileAbsolutePath
 * @param {number | null} gate
 * @param {string} rev
 * @returns {{relative: string, block: {start: number, end: number}}}
 */
export function verifySection(ticketAbsolutePath, sectionFileAbsolutePath, gate, rev) {
  const sectionText = fs.readFileSync(sectionFileAbsolutePath, "utf8");
  validateFirstLine(sectionText, gate);

  // The ticket need not exist on disk: `--rev origin/<branch>` from a checkout
  // of main is the orchestrator's case, and a ticket filed on that branch is
  // only in the branch. Its directory is enough to find the repository.
  const ticketRepoRoot = repoRootFor(
    fs.existsSync(ticketAbsolutePath) ? ticketAbsolutePath : path.dirname(ticketAbsolutePath),
  );
  const relative = locateRecord(ticketRepoRoot, ticketAbsolutePath);
  const show = spawnSync("git", ["-C", ticketRepoRoot, "show", `${rev}:${relative}`], {
    encoding: "utf8",
    shell: false,
  });
  if (show.error) throw show.error;
  if (show.status !== 0) {
    throw new Error(`could not read ${relative} at ${rev}: ${show.stderr || "git show failed"}`);
  }

  const committed = show.stdout;
  const block = locateGateBlock(committed, gate, sectionText);
  const blockText = committed
    .split("\n")
    .slice(block.start - 1, block.end)
    .join("\n");
  const comparison = compareRecord(sectionText, blockText, formatMarkdown(sectionText));
  if (!comparison.matches) {
    throw Object.assign(new Error("the committed record does not match the section file"), {
      stderr: describeMismatch(
        comparison,
        block.start,
        relative,
        `at ${rev}`,
        sectionFileAbsolutePath,
      ),
    });
  }
  return { relative, block };
}

function verifyMain(argv) {
  const { ticket, sectionFile, gate, rev } = parseVerifyArgs(argv);
  const ticketAbsolutePath = path.resolve(ticket);
  const sectionFileAbsolutePath = path.resolve(sectionFile);

  let result;
  try {
    result = verifySection(ticketAbsolutePath, sectionFileAbsolutePath, gate, rev);
  } catch (error) {
    const failure = /** @type {Error & {stderr?: string}} */ (error);
    if (failure.stderr !== undefined) {
      process.stderr.write(failure.stderr);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { relative, block } = result;
  process.stdout.write(
    `the gate record in ${relative} at ${rev} (lines ${block.start}-${block.end}) is ${sectionFile}, ` +
      `up to table padding and the formatter's own rewrites.\n`,
  );
}

// ---------------------------------------------------------------------------
// --land — one command in place of the manual landing sequence (repo-80)
// ---------------------------------------------------------------------------

/*
 * Appended below `main` and `--verify` for the same reason those are appended
 * below the top-level helpers: `repo-55`, `repo-62`, `repo-63`, `repo-67` and
 * `repo-82`'s own merged gate records already cite this file by unpinned
 * line, so every one of them is repointed onto a `main` commit that holds the
 * cited text once this branch lands — see this ticket's own Log — rather than
 * chased line by line every time this file grows.
 *
 * The Why names seven manual mistakes across six landings: running `--verify`
 * before the commit, flipping status before the splice, missing
 * `node_modules` in a bare worktree. `--land` is that whole sequence —
 * splice, set status, commit, push, verify, preflight — as one command that
 * names which step failed rather than leaving a lander to notice a skipped
 * one three steps later.
 */

export const LAND_USAGE =
  'usage: node scripts/review-record.mjs --land <ticket-file> <section-file>... --base <ref> --status done|in-flight --title "<title>" [--branch <name>]';

/**
 * Parse `--land`'s argv: a ticket and one or more section files, in landing
 * order — gate 1's file first, each later one after it, exactly the order
 * `records.md`'s _The lander commits the last set as given_ already
 * prescribes — plus `--base`, `--status` and `--title`.
 *
 * There is deliberately no `--gate` here: each section file already carries
 * its own gate number on its first line (`## Review` for gate 1, `### Gate
 * <n>` for a later one), and `detectGate` reads it from there, the same
 * source `validateFirstLine` already trusts.
 *
 * @param {string[]} argv
 * `--branch` names the branch to push to. It is required from a detached
 * HEAD, which is where a lander works: the builder's worktree holds the
 * branch name.
 *
 * @param {string[]} argv
 * @returns {{ticket: string, sections: string[], base: string, status: "done" | "in-flight", title: string, branch: string | null}}
 */
export function parseLandArgs(argv) {
  const positional = [];
  let branch = null;
  let base = null;
  let status = null;
  let title = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--land") continue;
    if (arg === "--base" || arg === "--status" || arg === "--title" || arg === "--branch") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value\n${LAND_USAGE}`);
      if (arg === "--base") base = value;
      else if (arg === "--status") status = value;
      else if (arg === "--branch") branch = value;
      else title = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option ${arg}\n${LAND_USAGE}`);
    positional.push(arg);
  }
  if (positional.length < 2) {
    throw new Error(`--land needs a ticket file and at least one section file\n${LAND_USAGE}`);
  }
  const [ticket, ...sections] = positional;
  if (base === null) throw new Error(`--base is required\n${LAND_USAGE}`);
  if (title === null) throw new Error(`--title is required\n${LAND_USAGE}`);
  if (status !== "done" && status !== "in-flight") {
    throw new Error(
      `--status must be "done" or "in-flight", got ${JSON.stringify(status)}\n${LAND_USAGE}`,
    );
  }
  return { ticket, sections, base, status, title, branch };
}

/**
 * The gate a `--land` section file is for, read off its own first line —
 * `--land` takes section files in landing order rather than a `--gate` per
 * file, since the caller already has to list them in that order.
 *
 * @param {string} sectionText
 * @returns {number | null}
 */
export function detectGate(sectionText) {
  const firstLine = sectionText.split("\n", 1)[0].replace(/\r$/, "");
  if (firstLine === "## Review") return null;
  const match = /^### Gate (\d+)/.exec(firstLine);
  if (match) return Number(match[1]);
  throw new Error(
    `a --land section file's first line must be "## Review" (the first gate) or start with ` +
      `"### Gate <n>"; got ${JSON.stringify(firstLine)}`,
  );
}

/** A line with any trailing `\r` stripped — the one normalisation `setStatus` needs for CRLF. */
const stripCR = (line) => line.replace(/\r$/, "");

/**
 * Replace the ticket's frontmatter `status:` line — `--land`'s own status
 * change, made to the ticket on disk in the same commit as the first section
 * it splices (`records.md`, _The status goes in with the landing's first
 * record commit_). Refuses a frontmatter with no `status:` line, or with more
 * than one, rather than guessing which to change — the same discipline
 * `status.mjs`'s own `parseFrontmatter` holds the rest of the file to.
 *
 * **CRLF-safe, the same way `markdown.mjs`'s `splitLines` is (repo-82)**:
 * every line-anchored comparison below strips a trailing `\r` before
 * matching, never the whole line, so a frontmatter closed with `"---\r"`
 * still closes it. Reproduced before the fix: `split("\n")` on a
 * `core.autocrlf=true` checkout leaves that `\r` on every frontmatter line,
 * `lines.indexOf("---", 1)` never matches `"---\r"` at all, and the whole
 * file is reported as one whose frontmatter is never closed — even though it
 * is, and even though the untouched `"---"` was found correctly one line
 * above by the same, unaffected `.trim()` check.
 *
 * @param {string} markdown
 * @param {string} newStatus
 * @returns {string}
 */
export function setStatus(markdown, newStatus) {
  const lines = markdown.split("\n");
  if (lines[0] === undefined || stripCR(lines[0]).trim() !== "---") {
    throw new Error('no frontmatter — the first line must be "---"');
  }
  const end = lines.findIndex((line, i) => i >= 1 && stripCR(line) === "---");
  if (end === -1) throw new Error("the frontmatter is never closed");
  const statusLines = [];
  for (let i = 1; i < end; i++) {
    if (stripCR(lines[i]).startsWith("status:")) statusLines.push(i);
  }
  if (statusLines.length === 0) throw new Error('the frontmatter has no "status:" line');
  if (statusLines.length > 1) {
    throw new Error('the frontmatter has more than one "status:" line');
  }
  const hadCR = lines[statusLines[0]].endsWith("\r");
  lines[statusLines[0]] = `status: ${newStatus}${hadCR ? "\r" : ""}`;
  return lines.join("\n");
}

/** `git -C <repo> <args>`, `shell: false` said explicitly (repo-77's own rule). */
function runGit(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * `--land`'s own default `preflight` step: the real tool, resolved next to
 * this file rather than inside whatever `repo` the ticket lives in, since a
 * ticket's own checkout is exactly the checkout this script ships in for
 * every real use of `--land`. Injectable so a fixture repo with no
 * `node_modules` of its own — the `Done when` fixture — can stand in a
 * stub instead of failing on a check that has nothing to do with this
 * ticket.
 *
 * @param {string} repo
 * @param {string} base
 * @param {string} title
 * @returns {{ok: boolean, output: string}}
 */
/**
 * Splice and commit every plan, in order, into `ticketPath` inside `repoRoot`
 * — the mechanics `land()`'s scratch validation pass and its real pass share
 * (gate 1, F3), so a later section's own placement — its `### Gate <n>`
 * heading landing after the one already spliced, not colliding with it — is
 * checked by the very code that will actually commit it, never a hand-rolled
 * approximation of the same rule. Throws on the first failure, exactly as
 * `spliceSection`, `setStatus` or `run` itself would.
 *
 * @param {string} ticketPath
 * @param {string} repoRoot
 * @param {{path: string, gate: number | null}[]} plans
 * @param {string} ticketId
 * @param {string} tool
 * @param {"done" | "in-flight"} status
 * @param {(repo: string, args: string[]) => string} run
 */
function spliceAndCommitAll(ticketPath, repoRoot, plans, ticketId, tool, status, run) {
  plans.forEach((plan, index) => {
    // Every failure below is tagged with `sectionPath` (gate 2, G2-b) — a
    // caller reports which section file failed, never only the checker's own
    // text, which says nothing about which of several sections it came from.
    let result;
    try {
      result = spliceSection(ticketPath, plan.path, plan.gate);
    } catch (error) {
      throw Object.assign(/** @type {Error} */ (error), { sectionPath: plan.path });
    }

    if (index === 0) {
      try {
        const markdown = fs.readFileSync(ticketPath, "utf8");
        fs.writeFileSync(ticketPath, setStatus(markdown, status));
      } catch (error) {
        throw Object.assign(new Error(`setting status: ${/** @type {Error} */ (error).message}`), {
          sectionPath: plan.path,
        });
      }
    }

    const gateLabel = plan.gate ?? 1;
    const message =
      index === 0
        ? `docs(${tool}): record gate ${gateLabel} and set status ${status} on ${ticketId} (${ticketId})`
        : `docs(${tool}): record gate ${gateLabel} on ${ticketId} (${ticketId})`;
    try {
      run(repoRoot, ["add", "--", result.relative]);
      run(repoRoot, ["commit", "-m", message]);
    } catch (error) {
      throw Object.assign(
        new Error(`committing gate ${gateLabel}: ${/** @type {Error} */ (error).message}`),
        { sectionPath: plan.path },
      );
    }
  });
}

/**
 * `--land`'s own default `preflight` step, resolved next to this file rather
 * than inside whatever `repo` the ticket lives in — see `land`'s docblock.
 * `spawn` is injectable (default `spawnSync`) purely so a test can assert on
 * the argv this builds — gate 2, F2/M5 — without spawning a real process;
 * `land()` itself never overrides it.
 *
 * @param {string} repo
 * @param {string} base
 * @param {string} title
 * @param {(cmd: string, args: string[], options: {encoding: "utf8", shell: false}) => {status: number | null, stdout: string, stderr: string, error?: Error}} [spawn]
 * @returns {{ok: boolean, output: string}}
 */
export function runPreflightDefault(repo, base, title, spawn = spawnSync) {
  const preflightCli = path.join(path.dirname(fileURLToPath(import.meta.url)), "preflight.mjs");
  const result = spawn(
    process.execPath,
    [preflightCli, "--base", base, "--title", title, "--repo", repo],
    { encoding: "utf8", shell: false },
  );
  if (result.error) throw result.error;
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

/**
 * The whole of `--land`: splice every section (one commit per gate, the
 * first also setting `status`), push, verify each spliced section against
 * what actually landed, then preflight. Never throws — a caller reads `.ok`
 * and `.steps` to learn which step failed and why, which is what lets the
 * CLI "name the failed step" instead of printing a stack trace.
 *
 * Every step before `"splice"` runs before anything is written or
 * committed, so a refusal there — including `unpinnedPreexistingCitations`'s
 * own — touches nothing (this ticket's `Done when`: "refused before it is
 * spliced").
 *
 * **Every section is validated — spliced and committed, in order — against a
 * disposable scratch clone before any of them touches the real repository**
 * (gate 1, F3; the owner's chosen mechanism, 2026-09-29, corrected from an
 * earlier round of this ticket that ran the real commits section by section
 * and reached for `git reset --hard` in the real checkout on a later
 * failure — a mechanism the owner was never offered, and one that would
 * have discarded an unrelated uncommitted change in the same working tree
 * along with the failed landing). A later section's own placement — its
 * `### Gate <n>` heading landing after the one already spliced, not
 * colliding with it — can only be checked once the earlier ones already sit
 * in the ticket, which one section checked in isolation cannot see; cloning
 * the repository and running the exact real sequence there, once,
 * disposably, is what lets a failure on section 3 be caught before section 1
 * or 2 ever reaches a real commit. **Nothing in `ticketRepoRoot` is read for
 * writing, written to, or reset during validation** — only the scratch
 * directory this makes and then deletes. Once validation succeeds, the same
 * sequence (`spliceAndCommitAll`) runs again for real, so "a bad section
 * fails with nothing written" holds structurally rather than by cleanup.
 * **A failure after every section has really landed — push, verify,
 * preflight, or the vanishingly unlikely case where the real pass disagrees
 * with a validation that just passed — is never rolled back**: those steps
 * only make sense once the commits exist, undoing them would throw away real
 * work over a check that has nothing to do with the splice itself, and the
 * fix is usually on the far side of the failure (open a PR, wait for CI,
 * re-run preflight) rather than back at the ticket. Each such failure names
 * the pre-landing sha and the `git reset --hard` command instead, so whoever
 * holds the failure can undo it by hand if that turns out to be the right
 * call.
 *
 * @param {{
 *   ticket: string,
 *   sections: string[],
 *   base: string,
 *   status: "done" | "in-flight",
 *   title: string,
 *   branch?: string | null,
 *   run?: (repo: string, args: string[]) => string,
 *   verify?: (ticketAbsolutePath: string, sectionAbsolutePath: string, gate: number | null, rev: string) => {relative: string, block: {start: number, end: number}},
 *   runPreflight?: (repo: string, base: string, title: string) => {ok: boolean, output: string},
 * }} options
 * @returns {{ok: boolean, steps: {name: string, ok: boolean, detail: string}[]}}
 */
export function land(options) {
  const {
    ticket,
    sections,
    status,
    title,
    base,
    run = runGit,
    verify = verifySection,
    runPreflight = runPreflightDefault,
  } = options;

  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const steps = [];
  const fail = (name, detail) => {
    steps.push({ name, ok: false, detail });
    return { ok: false, steps };
  };
  const pass = (name, detail) => steps.push({ name, ok: true, detail });

  if (status !== "done" && status !== "in-flight") {
    return fail("status", `--status must be "done" or "in-flight", got ${JSON.stringify(status)}`);
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    return fail("sections", "at least one section file is required");
  }

  const ticketAbsolutePath = path.resolve(ticket);
  let ticketRepoRoot;
  try {
    ticketRepoRoot = repoRootFor(ticketAbsolutePath);
  } catch (error) {
    return fail("setup", /** @type {Error} */ (error).message);
  }

  try {
    execFileSync(
      "git",
      ["-C", ticketRepoRoot, "rev-parse", "--verify", "--quiet", `${base}^{commit}`],
      {
        encoding: "utf8",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    return fail("setup", `--base ${base} could not be read in ${ticketRepoRoot}`);
  }

  // Refuse a dirty tracked tree (gate 2, G2-a; the owner's answer, "Refuse
  // dirty tree", 2026-09-29): the scratch clone below is made from `HEAD`, so
  // an uncommitted change to any tracked file is invisible to validation but
  // very visible to the real pass, which reads the working tree — the two
  // could then disagree, either printing a false "commit(s) already made"
  // reset hint on a validation that never wrote anything, or committing a
  // real gate before a later one fails on content only the working tree
  // holds. Untracked files are not part of what lands, so they are not checked.
  let dirtyStatus;
  try {
    dirtyStatus = run(ticketRepoRoot, ["status", "--porcelain", "--untracked-files=no"]);
  } catch (error) {
    return fail("setup", /** @type {Error} */ (error).message);
  }
  if (dirtyStatus.trim() !== "") {
    // `trimEnd()`, never `trim()` (gate 3, G3-c): `git status --porcelain`'s
    // first column is blank for a change that is only in the working tree,
    // so its very first line can start with a real leading space — an
    // unstaged " M path" — and `trim()` strips exactly that space off the
    // *first* line of the whole string (every later line's own leading
    // space survives, untouched, since `trim()` only touches the string's
    // outer edges). The stripped form then reads as `M path`, which is the
    // *staged* shape, on the one line most likely to be misread as the
    // reason nothing here caught it.
    return fail(
      "setup",
      `${ticketRepoRoot} has an uncommitted change to a tracked file. The scratch clone this ` +
        `validates against is made from HEAD, so a dirty tree here means validation and the real ` +
        `pass could see two different trees. Commit or discard the change first:\n` +
        `${dirtyStatus.trimEnd()}`,
    );
  }

  let ticketId = ticket;
  let tool = "repo";
  let relative;
  try {
    relative = locateRecord(ticketRepoRoot, ticketAbsolutePath);
    const fields = /** @type {{id: string, tool: string}} */ (
      parseFrontmatter(fs.readFileSync(ticketAbsolutePath, "utf8"), relative)
    );
    ticketId = fields.id;
    tool = fields.tool;
  } catch (error) {
    return fail("setup", /** @type {Error} */ (error).message);
  }
  let preLandingSha;
  try {
    preLandingSha = run(ticketRepoRoot, ["rev-parse", "HEAD"]).trim();
  } catch (error) {
    return fail("setup", /** @type {Error} */ (error).message);
  }
  // Settle where the push goes before anything is committed. A lander works
  // on a detached HEAD, where `--abbrev-ref` answers "HEAD" and
  // `git push origin HEAD` is refused: every fixer landing on 2026-10-03
  // committed, failed at the push and pushed by hand.
  let branch = options.branch ?? null;
  if (branch === null) {
    try {
      branch = run(ticketRepoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    } catch (error) {
      return fail("setup", /** @type {Error} */ (error).message);
    }
    if (branch === "HEAD") {
      return fail(
        "setup",
        "HEAD is detached, so there is no branch name to push to; pass --branch <name>.",
      );
    }
  }
  pass("setup", `${ticketId} (${tool}) at base ${base}, pre-landing sha ${preLandingSha}`);

  let plans;
  try {
    plans = sections.map((s) => {
      const sectionAbsolutePath = path.resolve(s);
      const text = fs.readFileSync(sectionAbsolutePath, "utf8");
      return { path: sectionAbsolutePath, text, gate: detectGate(text) };
    });
  } catch (error) {
    return fail("sections", /** @type {Error} */ (error).message);
  }
  pass("sections", `${plans.length} section file(s), in landing order`);

  // A failure after every section has really landed prints the pre-landing
  // sha and the reset command — never an automatic reset. See the docblock.
  const resetHint = () =>
    `\n\nThe commit(s) already made for this landing are not rolled back. Reset to the ` +
    `pre-landing state with:\n  git reset --hard ${preLandingSha}`;

  // Validate every section — spliced and committed, in order — against a
  // disposable scratch clone before any of them touches `ticketRepoRoot`.
  // See the docblock for why a clone rather than a check per section.
  let scratchDir;
  try {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-record-land-"));
    const clone = spawnSync("git", ["clone", "-q", "--no-hardlinks", ticketRepoRoot, scratchDir], {
      encoding: "utf8",
      shell: false,
    });
    if (clone.error) throw clone.error;
    if (clone.status !== 0) throw new Error(`git clone failed:\n${clone.stderr}`);
    run(scratchDir, ["config", "user.email", "land-validation@localhost"]);
    run(scratchDir, ["config", "user.name", "review-record --land validation"]);
    spliceAndCommitAll(
      path.join(scratchDir, relative),
      scratchDir,
      plans,
      ticketId,
      tool,
      status,
      run,
    );
  } catch (error) {
    const failure =
      /** @type {Error & {stdout?: string, stderr?: string, sectionPath?: string}} */ (error);
    const label = failure.sectionPath ? `${path.basename(failure.sectionPath)} — ` : "";
    return fail(
      "splice",
      `${label}${failure.stderr || failure.stdout || failure.message}\n\n` +
        `Validated against a scratch clone before any real commit — ${ticketRepoRoot} is untouched.`,
    );
  } finally {
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  }

  // Validated — every section splices and commits in this exact sequence
  // without refusal, so this repeats it for real. A failure here (the
  // scratch clone and the real repository disagreeing, a filesystem error)
  // is reported like push/verify/preflight: the sha and the reset command,
  // never an automatic reset — some of these commits may already be real.
  try {
    spliceAndCommitAll(ticketAbsolutePath, ticketRepoRoot, plans, ticketId, tool, status, run);
  } catch (error) {
    const failure =
      /** @type {Error & {stdout?: string, stderr?: string, sectionPath?: string}} */ (error);
    const label = failure.sectionPath ? `${path.basename(failure.sectionPath)} — ` : "";
    return fail(
      "splice",
      `${label}${failure.stderr || failure.stdout || failure.message}${resetHint()}`,
    );
  }
  pass("splice", `${plans.length} commit(s), status set to ${status} in the first`);

  // Push, fast-forward only — never `--force`. Not rolled back on failure —
  // see the docblock above.
  try {
    run(ticketRepoRoot, ["push", "origin", `HEAD:refs/heads/${branch}`]);
  } catch (error) {
    return fail("push", `${/** @type {Error} */ (error).message}${resetHint()}`);
  }
  pass("push", `pushed ${branch} to origin`);

  // Verify each section against what actually landed. Not rolled back on
  // failure — see the docblock above.
  for (const plan of plans) {
    try {
      verify(ticketAbsolutePath, plan.path, plan.gate, "HEAD");
    } catch (error) {
      const failure = /** @type {Error & {stderr?: string}} */ (error);
      return fail(
        "verify",
        `${path.basename(plan.path)}: ${failure.stderr || failure.message}${resetHint()}`,
      );
    }
  }
  pass("verify", `${plans.length} section(s) verified against HEAD`);

  // Preflight. Not rolled back on failure — see the docblock above.
  let preflightResult;
  try {
    preflightResult = runPreflight(ticketRepoRoot, base, title);
  } catch (error) {
    return fail("preflight", `${/** @type {Error} */ (error).message}${resetHint()}`);
  }
  if (!preflightResult.ok) return fail("preflight", `${preflightResult.output}${resetHint()}`);
  pass("preflight", "exit 0");

  return { ok: true, steps };
}

function landMain(argv) {
  const { ticket, sections, base, status, title, branch } = parseLandArgs(argv);
  const result = land({ ticket, sections, base, status, title, branch });
  for (const step of result.steps) {
    process.stdout.write(`\n== ${step.name} ==\n${step.ok ? "ok" : "FAIL"}  ${step.detail}\n`);
  }
  if (!result.ok) {
    const failed = result.steps.at(-1);
    process.stderr.write(`\n--land failed at "${failed?.name}"\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("\n--land: landed.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--help")) {
      process.stdout.write(`${USAGE}\n${VERIFY_USAGE}\n${LAND_USAGE}\n`);
      process.exitCode = 0;
    } else if (argv.includes("--land")) landMain(argv);
    else if (argv.includes("--verify")) verifyMain(argv);
    else main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
