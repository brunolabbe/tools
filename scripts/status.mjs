/**
 * The status tables, computed from the tickets rather than written by hand.
 *
 * A ticket's frontmatter is the only place its state is recorded. This script
 * is a lens over that: it parses every `tools/<tool>/docs/work/*.md`, and can
 * print the result, emit it as JSON, answer "what is ready", or write it back
 * into the generated region of that tool's `03-STATUS.md`.
 *
 * Nothing is cached and nothing is stored. A second store between the tickets
 * and this projection is exactly what ADR 001 removed and ADR 003 refuses to
 * bring back: a status change has to travel with the branch that earned it, and
 * only a file in the diff does that.
 *
 * **`--write` is for `main` only.** A branch that regenerates the region turns
 * a table every ticket touches back into a file every branch edits, which is
 * the conflict this exists to end. `--check` is what enforces that, and it runs
 * on every pull request.
 *
 * Plain `.mjs`, no dependencies, matching `commit-message.mjs` — the two are
 * the repo's tooling and neither should need a build step to answer.
 *
 * See docs/adr/003-the-status-page-is-generated.md.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Every field a ticket's frontmatter may carry, and whether it is required. */
const FIELDS = {
  id: { required: true },
  tool: { required: true },
  title: { required: true },
  kind: { required: true },
  status: { required: true },
  milestone: { required: true },
  depends_on: { required: true },
  // Optional, and the only editorial field: what the table should say when the
  // title reads badly in a column. Absent on almost every ticket, which is the
  // intended ratio — a title that needs a gloss is usually a title to fix.
  note: { required: false },
};

const KINDS = ["work-package", "fix", "chore"];
const STATUSES = ["ready", "in-flight", "done", "dropped"];

/** Statuses that mean the ticket is still work. `dropped` is neither. */
const OPEN = new Set(["ready", "in-flight"]);

const REGION_START = "<!-- generated:tickets -->";
const REGION_END = "<!-- /generated:tickets -->";

const DEFAULT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Parse a ticket's frontmatter.
 *
 * Deliberately strict, and for the reason `image-closure.test.ts` is: a parser
 * that shrugs at what it does not understand reports a clean status page while
 * having read half the tickets. A key nobody has agreed on, a status that is
 * not in the list, an id that disagrees with its own filename — each is a named
 * failure rather than a row quietly missing from a table.
 *
 * The grammar is the subset the tickets actually use: `key: value` per line,
 * plus one inline list for `depends_on`. Not YAML, and not pretending to be.
 *
 * @param {string} text The whole file.
 * @param {string} file Repo-relative path, for the error message.
 * @returns {Record<string, unknown>}
 */
export function parseFrontmatter(text, file) {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${file}: no frontmatter — the first line must be "---"`);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${file}: the frontmatter is never closed`);

  /** @type {Record<string, unknown>} */
  const fields = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const match = /^(?<key>[a-z_]+): ?(?<value>.*)$/.exec(line);
    if (match?.groups === undefined) {
      throw new Error(`${file}:${i + 1}: "${line}" is not "key: value"`);
    }
    const { key, value } = match.groups;
    if (!(key in FIELDS)) {
      throw new Error(
        `${file}:${i + 1}: "${key}" is not a ticket field. Use one of: ${Object.keys(FIELDS).join(", ")}`,
      );
    }
    if (key in fields) throw new Error(`${file}:${i + 1}: "${key}" is set twice`);
    fields[key] = key === "depends_on" ? parseList(value, file, i + 1) : parseScalar(value);
  }

  for (const [key, { required }] of Object.entries(FIELDS)) {
    if (required && !(key in fields)) throw new Error(`${file}: "${key}" is missing`);
  }
  return fields;
}

/** @param {string} value @returns {string | null} */
function parseScalar(value) {
  const trimmed = value.trim();
  return trimmed === "null" || trimmed === "" ? null : trimmed;
}

/** @param {string} value @param {string} file @param {number} line @returns {string[]} */
function parseList(value, file, line) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`${file}:${line}: depends_on must be an inline list, "[]" when there is none`);
  }
  const inner = trimmed.slice(1, -1).trim();
  return inner === "" ? [] : inner.split(",").map((entry) => entry.trim());
}

/**
 * Every ticket in the repo, validated against every other one.
 *
 * The cross-ticket checks are here rather than in a test because this is the
 * only reader: a dangling `depends_on` is invisible until something walks the
 * graph, and by then it is a link in a table pointing at nothing.
 *
 * @param {string} [repoRoot]
 * @returns {Array<{id: string, tool: string, title: string, kind: string, status: string, milestone: string | null, depends_on: string[], note: string | null, file: string, number: number}>}
 */
export function readTickets(repoRoot = DEFAULT_ROOT) {
  const tickets = [];
  for (const { tool, docs } of ticketDirs(repoRoot)) {
    const dir = path.join(repoRoot, docs, "work");
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (error) {
      // A tool with no `work/` yet is a young tool, not a broken one. Anything
      // else — a permission error, a file where the directory should be — is
      // raised, because reading it as "no tickets" would silently empty a table.
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.toSorted()) {
      if (!entry.endsWith(".md")) continue;
      const file = `${docs}/work/${entry}`;
      const fields = parseFrontmatter(fs.readFileSync(path.join(dir, entry), "utf8"), file);
      tickets.push({ ...validate(fields, tool, entry, file), file, dir: docs });
    }
  }

  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  if (byId.size !== tickets.length) {
    const seen = new Set();
    const duplicate = tickets.find((ticket) => !seen.add(ticket.id));
    throw new Error(`${duplicate?.file}: "${duplicate?.id}" is used by more than one ticket`);
  }
  for (const ticket of tickets) {
    for (const dependency of ticket.depends_on) {
      if (!byId.has(dependency)) {
        throw new Error(`${ticket.file}: depends_on "${dependency}", which is not a ticket`);
      }
    }
  }
  return tickets.toSorted(byIdOrder);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} tool @param {string} entry @param {string} file
 */
function validate(fields, tool, entry, file) {
  const ticket = /** @type {ReturnType<typeof readTickets>[number]} */ (fields);
  if (ticket.tool !== tool) {
    throw new Error(`${file}: tool is "${ticket.tool}" but the file is under "${tool}"`);
  }
  if (!entry.startsWith(`${ticket.id}-`)) {
    throw new Error(`${file}: the id "${ticket.id}" does not match the filename`);
  }
  if (!KINDS.includes(ticket.kind)) {
    throw new Error(`${file}: "${ticket.kind}" is not a kind. Use one of: ${KINDS.join(", ")}`);
  }
  if (!STATUSES.includes(ticket.status)) {
    throw new Error(
      `${file}: "${ticket.status}" is not a status. Use one of: ${STATUSES.join(", ")}`,
    );
  }
  const match = /^[a-z]+-(?<number>\d+)$/.exec(ticket.id);
  if (match?.groups === undefined) throw new Error(`${file}: "${ticket.id}" is not "<prefix>-<n>"`);
  ticket.number = Number(match.groups.number);
  ticket.note ??= null;
  return ticket;
}

/** Ids sort by their number, so `pl-9` comes before `pl-10` rather than after. */
function byIdOrder(a, b) {
  return a.tool === b.tool ? a.number - b.number : a.tool.localeCompare(b.tool);
}

/** @param {string} repoRoot @returns {string[]} */
function ticketDirs(repoRoot) {
  const tools = fs
    .readdirSync(path.join(repoRoot, "tools"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ tool: entry.name, docs: `tools/${entry.name}/docs` }))
    .toSorted((a, b) => a.tool.localeCompare(b.tool));
  // `repo` is not a tool and never will be, but repo-wide work is still work
  // and had nowhere to be filed — ADR 002 said the third piece of it would be
  // the signal to give `docs/` a `work/`, and ADR 003 is it. It has no status
  // page of its own, so it is read into every view and written into none.
  return [...tools, { tool: "repo", docs: "docs" }];
}

/**
 * The tickets that could be started right now.
 *
 * "Ready" in the frontmatter means nobody has picked it up; it says nothing
 * about whether it *can* be picked up. A ticket waiting on one that is still
 * open is not work, it is a queue — so the two are separated here rather than
 * left for a reader to walk by eye.
 *
 * It still cannot see a branch. A ticket in review for four days reads as ready
 * until it merges, which is why CLAUDE.md says `gh pr list` first — `--prs`
 * folds that in.
 *
 * @param {ReturnType<typeof readTickets>} tickets
 */
export function readyTickets(tickets) {
  const done = new Set(tickets.filter((t) => t.status === "done").map((t) => t.id));
  return tickets.filter((t) => t.status === "ready" && t.depends_on.every((id) => done.has(id)));
}

/**
 * The rollup by milestone.
 *
 * Milestones come from the frontmatter, not from parsing the roadmap's prose.
 * A roadmap is an argument with headings; reading state out of it would make
 * this script fail whenever someone rewrote a sentence.
 *
 * @param {ReturnType<typeof readTickets>} tickets
 */
export function milestones(tickets) {
  /** @type {Map<string | null, ReturnType<typeof readTickets>>} */
  const groups = new Map();
  for (const ticket of tickets) {
    const key = ticket.milestone;
    groups.set(key, [...(groups.get(key) ?? []), ticket]);
  }
  const named = [...groups.keys()].filter((key) => key !== null).toSorted();
  return [...named, ...(groups.has(null) ? [null] : [])].map((milestone) => {
    const members = groups.get(milestone) ?? [];
    const done = members.filter((t) => t.status === "done").length;
    const dropped = members.filter((t) => t.status === "dropped").length;
    const open = members.filter((t) => OPEN.has(t.status)).length;
    const started = members.some((t) => t.status !== "ready");
    return {
      milestone,
      done,
      dropped,
      open,
      state: open === 0 ? "complete" : started ? "in progress" : "not started",
    };
  });
}

/**
 * The markdown that goes between the markers.
 *
 * Pure — no git, no clock. That is what makes `--check` a string comparison
 * rather than a judgement, and what lets the test assert the whole region
 * against a fixture.
 *
 * @param {ReturnType<typeof readTickets>} tickets All of them, for one tool.
 */
export function renderRegion(tickets) {
  const open = tickets.filter((t) => OPEN.has(t.status));
  const closed = tickets.filter((t) => !OPEN.has(t.status));
  const lines = [
    REGION_START,
    "",
    "<!-- Written by `node scripts/status.mjs --write`, which runs on `main` after a merge.",
    "     Do not edit this region: a ticket's frontmatter is what it is generated from, and a",
    "     branch that edits it here is the merge conflict ADR 003 exists to end. -->",
    "",
    "### Milestones",
    "",
    table(
      ["Milestone", "Done", "Open", "Dropped", "State"],
      milestones(tickets).map((row) => [
        row.milestone ?? "_no milestone_",
        String(row.done),
        String(row.open),
        String(row.dropped),
        row.state,
      ]),
    ),
    "",
    "### Open tickets",
    "",
  ];

  if (open.length === 0) {
    lines.push("None. Every ticket this tool has is closed.");
  } else {
    lines.push(
      table(
        ["Ticket", "Kind", "Status", "Milestone", "What it is"],
        open.map((ticket) => [
          link(ticket),
          ticket.kind,
          ticket.status,
          ticket.milestone ?? "—",
          ticket.note ?? ticket.title,
        ]),
      ),
    );
  }

  lines.push(
    "",
    "<details>",
    `<summary>Closed — ${closed.length} ticket${closed.length === 1 ? "" : "s"}</summary>`,
    "",
    table(
      ["Ticket", "Kind", "Status", "What it was"],
      closed.map((ticket) => [
        link(ticket),
        ticket.kind,
        ticket.status,
        ticket.note ?? ticket.title,
      ]),
    ),
    "",
    "</details>",
    "",
    REGION_END,
  );
  return lines.join("\n");
}

/** A link relative to the tool's `docs/`, where `03-STATUS.md` sits. */
function link(ticket) {
  return `[${ticket.id}](./${path.posix.relative(ticket.dir, ticket.file)})`;
}

/**
 * A markdown table, padded.
 *
 * oxfmt formats markdown in this repo, so an unpadded table is a `npm run
 * check` failure the moment it lands. Padding here means the workflow's format
 * pass has nothing to do rather than producing a second commit.
 *
 * @param {string[]} headers @param {string[][]} rows
 */
function table(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
  return [
    line(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/**
 * Replace the generated region of a status file.
 *
 * A file with no markers is an error rather than a file to append to: the
 * region's position is editorial — it sits under the hand-written orientation
 * and above "Running things" — and guessing it would rewrite someone's page.
 *
 * @param {string} text @param {string} body @param {string} file
 */
export function replaceRegion(text, body, file) {
  const start = text.indexOf(REGION_START);
  const end = text.indexOf(REGION_END);
  if (start === -1 || end === -1) {
    throw new Error(`${file}: no "${REGION_START}" … "${REGION_END}" region to write into`);
  }
  if (end < start) throw new Error(`${file}: the region markers are the wrong way round`);
  return text.slice(0, start) + body + text.slice(end + REGION_END.length);
}

/** @param {string} text @returns {string | null} */
export function extractRegion(text) {
  const start = text.indexOf(REGION_START);
  const end = text.indexOf(REGION_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + REGION_END.length);
}

/** @param {string} repoRoot @param {string} tool */
function statusPath(repoRoot, tool) {
  // `repo` has no status page. Its tickets are repo-wide work — a toolchain, a
  // convention — and a dashboard for them would be a third place saying what
  // `npm run status` already says.
  if (tool === "repo") return null;
  return {
    relative: `tools/${tool}/docs/03-STATUS.md`,
    absolute: path.join(repoRoot, "tools", tool, "docs", "03-STATUS.md"),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * `git show <ref>:<path>`, or null when the path did not exist at that ref.
 *
 * Argument array, never a shell — the repo-wide rule, and `ref` here comes off
 * a workflow input.
 *
 * @param {string} repoRoot @param {string} ref @param {string} file
 */
function showAtRef(repoRoot, ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const flags = new Set();
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base" || arg === "--tool") values[arg.slice(2)] = argv[++i];
    else if (arg.startsWith("--")) flags.add(arg.slice(2));
    else throw new Error(`unrecognised argument "${arg}"`);
  }
  return { flags, values };
}

function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const repoRoot = DEFAULT_ROOT;
  const all = readTickets(repoRoot);
  const selected = values.tool ? all.filter((t) => t.tool === values.tool) : all;
  if (values.tool && selected.length === 0) {
    throw new Error(`no tickets for a tool called "${values.tool}"`);
  }
  const byTool = [...new Set(selected.map((t) => t.tool))];

  if (flags.has("json")) {
    process.stdout.write(`${JSON.stringify({ tickets: selected }, null, 2)}\n`);
    return;
  }

  if (flags.has("ready")) {
    const ready = readyTickets(selected);
    for (const ticket of ready) {
      process.stdout.write(`${ticket.id}\t${ticket.tool}\t${ticket.title}\n`);
    }
    if (ready.length === 0) process.stdout.write("nothing is ready and unblocked\n");
    return;
  }

  if (flags.has("write")) {
    for (const tool of byTool) {
      const page = statusPath(repoRoot, tool);
      if (page === null) continue;
      const { relative, absolute } = page;
      const before = fs.readFileSync(absolute, "utf8");
      const after = replaceRegion(
        before,
        renderRegion(all.filter((t) => t.tool === tool)),
        relative,
      );
      if (before !== after) {
        fs.writeFileSync(absolute, after);
        process.stdout.write(`wrote ${relative}\n`);
      }
    }
    return;
  }

  if (flags.has("check")) {
    const base = values.base ?? "origin/main";
    const complaints = [];
    for (const tool of byTool) {
      const page = statusPath(repoRoot, tool);
      if (page === null) continue;
      const { relative, absolute } = page;
      const head = extractRegion(fs.readFileSync(absolute, "utf8"));
      if (head === null) {
        complaints.push(`${relative}: has no generated region — add the markers`);
        continue;
      }
      const atBase = showAtRef(repoRoot, base, relative);
      const baseRegion = atBase === null ? null : extractRegion(atBase);
      // Two branches have no base region to be unchanged from, and both are
      // legitimate: a status file this branch invents for a new tool, and the
      // one that first adds the markers to an existing page. For those the only
      // honest bar is that the region is already what `--write` produces.
      const expected = baseRegion ?? renderRegion(all.filter((t) => t.tool === tool));
      if (head !== expected) {
        complaints.push(
          baseRegion === null
            ? `${relative}: this branch adds the generated region, so it must be exactly ` +
                `what \`node scripts/status.mjs --write\` produces`
            : `${relative}: the generated region was edited on this branch. Revert it — ` +
                `it is written on \`main\` from the tickets, and editing it here is what ` +
                `makes every branch conflict`,
        );
      }
    }
    if (complaints.length > 0) {
      for (const complaint of complaints) process.stderr.write(`${complaint}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`the generated regions are untouched (base ${base})\n`);
    return;
  }

  // The default view: what a human or an agent asks for when they want to know
  // where things are. Open work first, because that is the question.
  for (const tool of byTool) {
    const mine = selected.filter((t) => t.tool === tool);
    const open = mine.filter((t) => OPEN.has(t.status));
    process.stdout.write(`\n${tool} — ${open.length} open of ${mine.length}\n\n`);
    for (const row of milestones(mine)) {
      process.stdout.write(
        `  ${(row.milestone ?? "—").padEnd(4)} ${row.state.padEnd(12)} ${row.done} done, ${row.open} open\n`,
      );
    }
    if (open.length > 0) process.stdout.write("\n");
    const unblocked = new Set(readyTickets(mine).map((t) => t.id));
    for (const ticket of open) {
      const mark = ticket.status === "in-flight" ? "»" : unblocked.has(ticket.id) ? "•" : "·";
      const blocked =
        unblocked.has(ticket.id) || ticket.status === "in-flight"
          ? ""
          : ` (waits on ${ticket.depends_on.join(", ")})`;
      process.stdout.write(`  ${mark} ${ticket.id.padEnd(6)} ${ticket.title}${blocked}\n`);
    }
  }

  if (flags.has("prs")) printOpenPullRequests(repoRoot);
  process.stdout.write("\n");
}

/**
 * What is in review, which no ticket file knows.
 *
 * A ticket says `ready` until something merges, so the file and the branch
 * disagree for as long as a review takes — CLAUDE.md's "`gh pr list` first".
 * Opt-in and best-effort: `gh` is not a dependency of this repo, and a missing
 * or unauthenticated one must not fail the view someone asked for.
 *
 * @param {string} repoRoot
 */
function printOpenPullRequests(repoRoot) {
  let output;
  try {
    output = execFileSync("gh", ["pr", "list", "--json", "number,title,baseRefName"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    process.stdout.write("\nin review: `gh` did not answer — skipping\n");
    return;
  }
  const prs = JSON.parse(output);
  process.stdout.write(`\nin review — ${prs.length}\n\n`);
  for (const pr of prs) {
    // A pull request based on another branch disappears when that branch does,
    // and its own page still says merged. CLAUDE.md names this; it is worth
    // seeing in the list rather than discovering later.
    const base = pr.baseRefName === "main" ? "" : `  ← based on ${pr.baseRefName}`;
    process.stdout.write(`  #${pr.number} ${pr.title}${base}\n`);
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
