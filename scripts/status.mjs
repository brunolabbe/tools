/**
 * The status view, computed from the tickets rather than written by hand.
 *
 * A ticket's frontmatter is the only place its state is recorded. This script
 * is a lens over that: it parses every `tools/<tool>/docs/work/*.md`, and can
 * print the result, emit it as JSON, answer "what is ready", describe one
 * ticket, or render the tables as markdown for pasting somewhere.
 *
 * Nothing is cached, nothing is stored, and **nothing is written to a file**.
 * A second store between the tickets and this projection is what ADR 001
 * removed and ADR 003 refused to bring back; a generated *file* is the same
 * mistake one step further out, and repo-2 removed that too. A projection kept
 * in version control needs a writer, and every writer available here turned out
 * to be unsafe, noisy or racy — so the projection is computed on demand and
 * never kept.
 *
 * Plain `.mjs`, no dependencies, matching `commit-message.mjs` — the two are
 * the repo's tooling and neither should need a build step to answer.
 *
 * See docs/adr/003-the-status-page-is-generated.md and its amendment.
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

const DEFAULT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Parse a ticket's frontmatter.
 *
 * Deliberately strict, and for the reason `image-closure.test.ts` is: a parser
 * that shrugs at what it does not understand reports a clean status view while
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
 * **A dangling `depends_on` is not raised from here** — see
 * `danglingDependencies`. Everything else still is: a ticket this function
 * cannot parse has no row to print, so there is nothing to fall back to.
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
      // raised, because reading it as "no tickets" would silently empty a view.
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.toSorted()) {
      if (!entry.endsWith(".md")) continue;
      const file = `${docs}/work/${entry}`;
      const fields = parseFrontmatter(fs.readFileSync(path.join(dir, entry), "utf8"), file);
      tickets.push({ ...validate(fields, tool, entry, file), file });
    }
  }

  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  if (byId.size !== tickets.length) {
    const seen = new Set();
    const duplicate = tickets.find((ticket) => !seen.add(ticket.id));
    throw new Error(`${duplicate?.file}: "${duplicate?.id}" is used by more than one ticket`);
  }
  return tickets.toSorted(byIdOrder);
}

/**
 * The `depends_on` entries that name no ticket, as data rather than an ending.
 *
 * This used to `throw` from inside `readTickets`, three lines into `main` and
 * before any view was selected — so one ticket naming an id that had not merged
 * yet cost every reader every ticket in every mode, stdout empty and exit 1
 * (repo-6). The check itself is right and stays: `depends_on` is documented as
 * "ticket ids that must land first", so an id nothing carries is either a typo
 * or a forward reference, and both are worth saying out loud.
 *
 * What changed is who decides. The reader reports; `main` prints the warning
 * beside the view instead of instead of it, and picks the exit code per mode —
 * see `EXIT_ON_PROBLEMS`.
 *
 * The message text is unchanged, deliberately: it is a good line, `ci.yml`'s
 * `--json` step and a person's terminal both surface it, and only where it is
 * printed was ever wrong.
 *
 * @param {ReturnType<typeof readTickets>} tickets
 * @returns {Array<{file: string, kind: string, id: string, dependency: string, message: string}>}
 */
export function danglingDependencies(tickets) {
  const known = new Set(tickets.map((ticket) => ticket.id));
  const problems = [];
  for (const ticket of tickets) {
    for (const dependency of ticket.depends_on) {
      if (known.has(dependency)) continue;
      problems.push({
        file: ticket.file,
        kind: "dangling-dependency",
        id: ticket.id,
        dependency,
        message: `${ticket.file}: depends_on "${dependency}", which is not a ticket`,
      });
    }
  }
  return problems;
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
  // the signal to give `docs/` a `work/`, and ADR 003 is it.
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
 * One ticket: its fields, what is actually blocking it, and where it lives.
 *
 * The blockers are the `depends_on` entries that are **not** `done`, which is a
 * different list from `depends_on` and the one worth printing — most of a
 * mature ticket's dependencies landed months ago, and listing them all buries
 * the one that has not.
 *
 * `missing` is the second half, and it is separate from `blockers` on purpose:
 * an id no ticket carries has no status, no title and no file, so there is
 * nothing to put in a list of tickets. It used to be one — `byId.get` returned
 * `undefined`, the filter read `.status` off it, and `--show` on the offending
 * ticket died with an anonymous `TypeError` naming no file (repo-6). Keeping
 * the two apart means `blockers` stays exactly what its name says and every
 * caller that only cares about real tickets is unaffected.
 *
 * @param {ReturnType<typeof readTickets>} tickets All of them; the graph needs it.
 * @param {string} id
 */
export function describeTicket(tickets, id) {
  const ticket = tickets.find((t) => t.id === id);
  if (ticket === undefined) throw new Error(`no ticket called "${id}"`);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  /** @type {ReturnType<typeof readTickets>} */
  const blockers = [];
  /** @type {string[]} */
  const missing = [];
  for (const dependency of ticket.depends_on) {
    const found = byId.get(dependency);
    if (found === undefined) missing.push(dependency);
    else if (found.status !== "done") blockers.push(found);
  }
  return { ticket, blockers, missing };
}

/**
 * The ticket tables, as markdown.
 *
 * This is what used to be written into a `03-STATUS.md`, and the difference is
 * where it goes: into a pull request body or a message, at the moment someone
 * wants it, rather than into a file somebody then has to keep true. Links are
 * **repo-root-relative**, because the destination is no longer a page sitting
 * beside `work/`.
 *
 * @param {ReturnType<typeof readTickets>} tickets
 */
export function renderMarkdown(tickets) {
  const lines = [];
  for (const tool of new Set(tickets.map((t) => t.tool))) {
    const mine = tickets.filter((t) => t.tool === tool);
    const open = mine.filter((t) => OPEN.has(t.status));
    const closed = mine.filter((t) => !OPEN.has(t.status));
    lines.push(
      `## ${tool} — ${open.length} open of ${mine.length}`,
      "",
      "### Milestones",
      "",
      table(
        ["Milestone", "Done", "Open", "Dropped", "State"],
        milestones(mine).map((row) => [
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
    );
    if (open.length === 0) {
      lines.push("None. Every ticket this tool has is closed.", "");
      continue;
    }
    lines.push(
      table(
        ["Ticket", "Kind", "Status", "Milestone", "What it is"],
        open.map((ticket) => [
          `[${ticket.id}](${ticket.file})`,
          ticket.kind,
          ticket.status,
          ticket.milestone ?? "—",
          ticket.note ?? ticket.title,
        ]),
      ),
      "",
      `${closed.length} closed ticket${closed.length === 1 ? "" : "s"} not listed.`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

/**
 * A markdown table, padded.
 *
 * oxfmt formats markdown in this repo, so an unpadded table pasted into a
 * document is a `npm run check` failure the moment it lands.
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const FLAGS = ["ready", "json", "prs", "markdown"];

/**
 * `--root` is the seam the CLI tests needed and did not have.
 *
 * `main` used to hardcode `DEFAULT_ROOT`, so every end-to-end case ran against
 * the real tickets — which meant no test could ever ask what the CLI does with
 * a malformed one, short of committing a malformed ticket to the repo. repo-6
 * is a defect about exactly that, per mode, so the alternative was to prove its
 * acceptance by hand and leave nothing behind that would catch it coming back.
 *
 * It is a plain option rather than a hidden one: a flag the parser refuses to
 * name is a flag the next reader finds by reading the source.
 */
const OPTIONS = ["--tool", "--show", "--root"];

/**
 * Unknown flags are refused rather than ignored.
 *
 * `--write` and `--check` were real until repo-2 retired the file they wrote,
 * and a reader with muscle memory for either must be told they are gone. A
 * parser that shrugs at an unknown flag would hand them the default view and
 * let them believe a page had just been regenerated.
 *
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const flags = new Set();
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (OPTIONS.includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      values[arg.slice(2)] = value;
    } else if (FLAGS.includes(arg.slice(2)) && arg.startsWith("--")) flags.add(arg.slice(2));
    else {
      throw new Error(
        `unrecognised argument "${arg}". Use one of: ${[...OPTIONS, ...FLAGS.map((f) => `--${f}`)].join(", ")}`,
      );
    }
  }
  return { flags, values };
}

/**
 * Which views a dangling `depends_on` fails, and which merely warn.
 *
 * The payload and the exit code are separable and are separated: every view
 * prints what it could read, and only `--json` also ends non-zero.
 *
 * `.github/workflows/ci.yml`'s `check` job runs
 * `node scripts/status.mjs --json > /dev/null`, and it is **the only thing in
 * CI that reads the tickets at all**. It discards stdout, so the exit code is
 * the whole of that gate — and an all-markdown pull request, which is exactly
 * what filing a ticket is, skips the unit matrix and leaves that step as the
 * only check the change gets. Make `--json` exit 0 here and the strict parser
 * stops being enforced anywhere.
 *
 * The interactive views exit 0 because a person asked a question and got the
 * answer to it, with the warning on stderr beside the table. `npm run status`
 * exiting non-zero also buys an `npm ERR!` block under every table, which
 * teaches the reader to ignore the tail of the output — the opposite of what a
 * warning is for.
 */
const EXIT_ON_PROBLEMS = ["json"];

function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const repoRoot = values.root ?? DEFAULT_ROOT;
  const all = readTickets(repoRoot);
  const problems = danglingDependencies(all);

  renderView(all, problems, flags, values, repoRoot);

  // stderr, after the view: a pipeline reading stdout is unaffected, and a
  // person reads it last rather than watching it scroll off the top.
  for (const problem of problems) process.stderr.write(`${problem.message}\n`);
  if (problems.length > 0 && EXIT_ON_PROBLEMS.some((flag) => flags.has(flag))) {
    process.exitCode = 1;
  }
}

/**
 * @param {ReturnType<typeof readTickets>} all
 * @param {ReturnType<typeof danglingDependencies>} problems
 * @param {Set<string>} flags
 * @param {Record<string, string>} values
 * @param {string} repoRoot
 */
function renderView(all, problems, flags, values, repoRoot) {
  // `--show` is about one ticket and its blockers can be under another tool, so
  // it reads the whole graph and ignores `--tool` — narrowing first would
  // report that a ticket which exists does not.
  if (values.show !== undefined) {
    printTicket(describeTicket(all, values.show));
    return;
  }

  const selected = values.tool ? all.filter((t) => t.tool === values.tool) : all;
  if (values.tool && selected.length === 0) {
    throw new Error(`no tickets for a tool called "${values.tool}"`);
  }
  const byTool = [...new Set(selected.map((t) => t.tool))];

  // `problems` is always present, empty included. A consumer that ignores it
  // sees what it saw before; one that reads it can tell "the board is clear"
  // from "a ticket would not parse" from "the script never ran" — which an
  // empty stdout and an exit code cannot, and all three used to look alike.
  // It is not narrowed by `--tool`: a dangling edge anywhere is a fact about
  // the graph the reader is being handed a slice of.
  if (flags.has("json")) {
    process.stdout.write(`${JSON.stringify({ tickets: selected, problems }, null, 2)}\n`);
    return;
  }

  if (flags.has("markdown")) {
    process.stdout.write(`${renderMarkdown(selected)}\n`);
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

/** @param {ReturnType<typeof describeTicket>} described */
function printTicket({ ticket, blockers, missing }) {
  process.stdout.write(`\n${ticket.id}  ${ticket.title}\n\n`);
  for (const [key, value] of [
    ["tool", ticket.tool],
    ["kind", ticket.kind],
    ["status", ticket.status],
    ["milestone", ticket.milestone ?? "—"],
    ["depends on", ticket.depends_on.length === 0 ? "nothing" : ticket.depends_on.join(", ")],
    ["note", ticket.note ?? "—"],
    ["file", ticket.file],
  ]) {
    process.stdout.write(`  ${key.padEnd(11)} ${value}\n`);
  }
  // A dangling id is printable here and nowhere else: it has no status to
  // report, so it says what it is. Beside the real blockers rather than instead
  // of them — a ticket can easily have one of each.
  const holding = [
    ...blockers.map((blocker) => `${blocker.id} (${blocker.status})`),
    ...missing.map((dependency) => `${dependency} (not a ticket)`),
  ];
  // `unblocked` and `blocked by` are both statements about work that has not
  // happened yet, so neither can be the verdict on a ticket that is over: an
  // agent reads this closing line, takes `unblocked` for "pickable", and builds
  // a ticket that was deliberately taken out of the queue (repo-3). The closed
  // branch goes *in front of* the pair rather than in place of them — a closed
  // ticket can still carry a real blocker or a dangling id, and repo-6 put both
  // on this line, so they are kept where they can be read as history instead of
  // as an obstruction. `dropped` also carries its `note`, duplicating the row
  // above deliberately: the reason it was dropped belongs in the line a reader
  // acts on, not four rows higher.
  if (!OPEN.has(ticket.status)) {
    const why = ticket.status === "dropped" && ticket.note !== null ? ` (${ticket.note})` : "";
    const stale = holding.length === 0 ? "" : `; depends_on still lists ${holding.join(", ")}`;
    process.stdout.write(`\n  ${ticket.status} — nothing to pick up${why}${stale}\n\n`);
    return;
  }
  process.stdout.write(
    holding.length === 0 ? "\n  unblocked\n\n" : `\n  blocked by  ${holding.join(", ")}\n\n`,
  );
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
