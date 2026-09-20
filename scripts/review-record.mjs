/**
 * Splice a reviewer's returned `## Review` section (or a later `### Gate <n>`)
 * into its ticket, check it, format it, and hand back the disclosure note.
 *
 * `review-ticket` step 8 asks a builder to do five things by hand every time a
 * gate lands: find the right spot in the ticket, paste the section in
 * verbatim, run `citations.mjs --section Review --require-anchors
 * --require-distinct-anchors`, run the formatter, then diff the result against
 * what was pasted to prove nothing but table padding moved. repo-55's Why
 * section names four incidents where one of those five steps was skipped or
 * done wrong under a different context each time — a record spliced into the
 * middle of an earlier one because the insertion anchored on a heading string
 * quoted 500 lines above the real heading, three of four tickets in one batch
 * failing the gate the moment their record was committed, a gate record left
 * uncommitted twice on one ticket, and a formatter rewrap that split a
 * citation's coordinate from its anchor. None of that is judgement; it is one
 * procedure, done by hand, under pressure to move on to the next ticket.
 *
 * **The insertion point is found by heading form, never by searching for the
 * bare heading text.** `citations.mjs`'s own `extractSections` is reused for
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

import { extractSections, locateRecord, selectSection } from "./citations.mjs";

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
        "--src-prefix=section-file/",
        "--dst-prefix=inserted-block/",
        "--",
        before,
        after,
      ],
      { encoding: "utf8" },
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

function main() {
  const { ticket, sectionFile, gate } = parseArgs(process.argv.slice(2));
  const ticketAbsolutePath = path.resolve(ticket);
  const sectionFileAbsolutePath = path.resolve(sectionFile);

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
    { encoding: "utf8" },
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
    {
      encoding: "utf8",
    },
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
    process.stdout.write(fmt.stdout);
    process.stderr.write(fmt.stderr);
    process.exitCode = fmt.status ?? 1;
    return;
  }

  const citationsCli = path.join(path.dirname(fileURLToPath(import.meta.url)), "citations.mjs");
  const check = spawnSync(
    process.execPath,
    [
      citationsCli,
      ticketAbsolutePath,
      "--section",
      "Review",
      "--require-anchors",
      "--require-distinct-anchors",
    ],
    { cwd: ticketRepoRoot, encoding: "utf8" },
  );
  if (check.error) throw check.error;
  if (check.status !== 0) {
    restoreFromHead();
    process.stdout.write(check.stdout);
    process.stderr.write(check.stderr);
    process.exitCode = check.status ?? 1;
    return;
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

  process.stdout.write(check.stdout);
  process.stdout.write(
    `\nSpliced into ${relative}.\n\n` +
      "Normalised diff against the section file (table padding and rule width ignored) — empty means\n" +
      "verbatim survived the formatter. Paste this into the Log as the disclosure note:\n\n",
  );
  process.stdout.write(diff);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
