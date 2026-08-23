import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  describeTicket,
  milestones,
  parseFrontmatter,
  readTickets,
  readyTickets,
  renderMarkdown,
} from "../status.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "status.mjs");

/**
 * A throwaway repo root with the tickets a case needs.
 *
 * Fixtures here are a directory tree rather than a checked-in file, because
 * what is under test is the walk as much as the parse — a `work/` that does not
 * exist, a filename that disagrees with its own id, two tools side by side.
 */
function repoWith(tickets: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "status-"));
  for (const [file, body] of Object.entries(tickets)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  return root;
}

const ticket = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n# body\n`;

const pl = (id: string, over: Record<string, string> = {}) =>
  ticket({
    id,
    tool: "planner",
    title: `the ${id} thing`,
    kind: "chore",
    status: "ready",
    milestone: "null",
    depends_on: "[]",
    ...over,
  });

const at = (id: string) => `tools/planner/docs/work/${id}-slug.md`;

/**
 * Run the CLI the way a person does.
 *
 * repo-1's fourth gate found that the CLI had no test at all — `--check`'s two
 * acceptance rows could only ever be `verified`. The flags added here are
 * covered end to end for that reason: `--tool`, `--show` and `--markdown` are
 * argument parsing and formatting, which is precisely what a pure-function
 * suite cannot see.
 *
 * Argument array, never a shell — the repo-wide rule.
 */
function run(args: string[]): { stdout: string; status: number } {
  try {
    return {
      stdout: execFileSync("node", [CLI, ...args], {
        encoding: "utf8",
        shell: false,
        // Piped, not inherited: a CLI case that asserts a *failure* would
        // otherwise print its error into the middle of an otherwise green run
        // and read as one. `spawnSync` captures both streams either way.
        stdio: ["ignore", "pipe", "pipe"],
      }),
      status: 0,
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      status: failure.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// The real tickets
// ---------------------------------------------------------------------------

// **The three tests below are the ones a documentation-only pull request needs
// most, and CI runs at most one of them.** `ci.yml`'s `test` matrix is skipped
// for a change that is all `.md` — which is exactly what filing a ticket or
// flipping one to `done` is — so what runs on such a pull request is the
// unfiltered `check` job, and the only thing it knows about tickets is
// `node scripts/status.mjs --json`. That step had a workflow of its own
// (`status.yml`) until repo-2 folded it in.
//
// So, precisely:
//
// - **Covered by `check`:** the parse and `depends_on` resolution the first
//   test asserts. `--json` walks every ticket through the same reader, so a
//   drifted field, a status outside the taxonomy or a dangling dependency fails
//   there by file and line whether or not vitest runs.
// - **Not covered, on any all-`.md` pull request:** the tool-set assertion in
//   the first test, and both tests after it. The second is only ever violated
//   by a misplaced file; the third — `no tool keeps a status page` — is the
//   regression guard repo-2 added, and a pull request that re-adds a
//   `03-STATUS.md` is by construction all markdown, so it is the one change the
//   guard exists for and the one CI will not run it on. Pre-existing and not
//   worth a second workflow: the fix is to run the matrix, and that trade is
//   argued in `ci.yml`'s header.
//
// The point of the strict parser is that the first test is the one that fails,
// by name and by line, when a ticket's frontmatter drifts.
test("every ticket in the repo parses, and its dependencies resolve", () => {
  const tickets = readTickets(REPO);
  expect(tickets.length).toBeGreaterThan(0);
  // Every tool the repo has, plus `repo` itself for work that belongs to none
  // of them — `docs/work/`, which ADR 003 opened.
  expect([...new Set(tickets.map((t) => t.tool))].toSorted()).toEqual([
    ...fs.readdirSync(path.join(REPO, "tools")).toSorted(),
    "repo",
  ]);
});

test("repo-wide tickets live in docs/work", () => {
  const repoTickets = readTickets(REPO).filter((t) => t.tool === "repo");
  expect(repoTickets.length).toBeGreaterThan(0);
  expect(repoTickets.every((t) => t.file.startsWith("docs/work/"))).toBe(true);
});

// repo-2 deleted both pages. This is the test that fails if one comes back:
// the view is computed on every run, and a copy of it in a file is a copy
// something has to keep true.
test("no tool keeps a status page, and neither does the repo", () => {
  expect(fs.existsSync(path.join(REPO, "docs", "03-STATUS.md"))).toBe(false);
  for (const tool of fs.readdirSync(path.join(REPO, "tools"))) {
    const file = path.join(REPO, "tools", tool, "docs", "03-STATUS.md");
    expect(fs.existsSync(file), `${tool} has a status page again`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// The parser refuses what it does not understand
// ---------------------------------------------------------------------------

test("a field nobody has agreed on is named, not ignored", () => {
  expect(() => parseFrontmatter(pl("pl-1", { owner: "bruno" }), "t.md")).toThrow(
    /"owner" is not a ticket field/,
  );
});

test("a status outside the taxonomy is a failure, not a row", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { status: "blocked" }) });
  expect(() => readTickets(root)).toThrow(/"blocked" is not a status/);
});

test("a kind outside the taxonomy is a failure too", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { kind: "epic" }) });
  expect(() => readTickets(root)).toThrow(/"epic" is not a kind/);
});

test("a missing required field is named", () => {
  const withoutMilestone = ticket({
    id: "pl-1",
    tool: "planner",
    title: "t",
    kind: "chore",
    status: "ready",
    depends_on: "[]",
  });
  expect(() => parseFrontmatter(withoutMilestone, "t.md")).toThrow(/"milestone" is missing/);
});

test("depends_on has to be a list, so a bare id cannot read as a string", () => {
  expect(() => parseFrontmatter(pl("pl-1", { depends_on: "pl-2" }), "t.md")).toThrow(
    /must be an inline list/,
  );
});

test("an id that disagrees with its filename is caught", () => {
  const root = repoWith({ "tools/planner/docs/work/pl-2-slug.md": pl("pl-1") });
  expect(() => readTickets(root)).toThrow(/does not match the filename/);
});

test("a dependency on a ticket that does not exist is caught", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { depends_on: "[pl-99]" }) });
  expect(() => readTickets(root)).toThrow(/depends_on "pl-99", which is not a ticket/);
});

test("a tool with no work directory yet is a young tool, not an error", () => {
  const root = repoWith({ "tools/planner/docs/02-ROADMAP.md": "# roadmap\n" });
  expect(readTickets(root)).toEqual([]);
});

// ---------------------------------------------------------------------------
// The projections
// ---------------------------------------------------------------------------

test("ids sort by number, so pl-9 comes before pl-10", () => {
  const root = repoWith({
    [at("pl-9")]: pl("pl-9"),
    [at("pl-10")]: pl("pl-10"),
    [at("pl-2")]: pl("pl-2"),
  });
  expect(readTickets(root).map((t) => t.id)).toEqual(["pl-2", "pl-9", "pl-10"]);
});

test("ready means ready and unblocked — a ticket waiting on open work is a queue", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "ready", depends_on: "[pl-1]" }),
    [at("pl-3")]: pl("pl-3", { status: "ready", depends_on: "[pl-2]" }),
  });
  expect(readyTickets(readTickets(root)).map((t) => t.id)).toEqual(["pl-2"]);
});

test("a milestone is complete when nothing under it is open, dropped included", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done", milestone: "P1" }),
    [at("pl-2")]: pl("pl-2", { status: "dropped", milestone: "P1" }),
    [at("pl-3")]: pl("pl-3", { status: "ready", milestone: "P2" }),
    [at("pl-4")]: pl("pl-4", { status: "in-flight", milestone: "P3" }),
  });
  expect(milestones(readTickets(root))).toEqual([
    { milestone: "P1", done: 1, open: 0, dropped: 1, state: "complete" },
    { milestone: "P2", done: 0, open: 1, dropped: 0, state: "not started" },
    { milestone: "P3", done: 0, open: 1, dropped: 0, state: "in progress" },
  ]);
});

test("unmilestoned tickets sort last, under their own heading", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { milestone: "null" }),
    [at("pl-2")]: pl("pl-2", { milestone: "P1" }),
  });
  expect(milestones(readTickets(root)).map((row) => row.milestone)).toEqual(["P1", null]);
});

// ---------------------------------------------------------------------------
// One ticket — `--show`
// ---------------------------------------------------------------------------

// The list worth printing is the dependencies that are *not* done, which is not
// the same list as `depends_on`: a mature ticket's are mostly landed, and
// listing them all buries the one that has not.
test("the blockers are the dependencies that are not done, not all of them", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "in-flight" }),
    [at("pl-3")]: pl("pl-3", { depends_on: "[pl-1, pl-2]" }),
  });
  const { ticket: shown, blockers } = describeTicket(readTickets(root), "pl-3");
  expect(shown.file).toBe("tools/planner/docs/work/pl-3-slug.md");
  expect(blockers.map((b) => [b.id, b.status])).toEqual([["pl-2", "in-flight"]]);
});

test("a ticket whose dependencies have all landed reports no blockers", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { depends_on: "[pl-1]" }),
  });
  expect(describeTicket(readTickets(root), "pl-2").blockers).toEqual([]);
});

test("an id nobody filed is named rather than returning nothing", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(() => describeTicket(readTickets(root), "pl-42")).toThrow(/no ticket called "pl-42"/);
});

// ---------------------------------------------------------------------------
// The markdown — `--markdown`
// ---------------------------------------------------------------------------

// The links used to be relative to a `03-STATUS.md` sitting beside `work/`.
// There is no such page any more and the destination is a pull request body, so
// they are repo-root-relative.
test("the markdown links each ticket from the repo root, not from a page beside it", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(renderMarkdown(readTickets(root))).toContain(
    "[pl-1](tools/planner/docs/work/pl-1-slug.md)",
  );
});

test("a note overrides the title, which is the only editorial field there is", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { note: "what the table should say" }) });
  const rendered = renderMarkdown(readTickets(root));
  expect(rendered).toContain("what the table should say");
  expect(rendered).not.toContain("the pl-1 thing");
});

test("a tool with nothing open says so rather than rendering an empty table", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { status: "done" }) });
  expect(renderMarkdown(readTickets(root))).toContain(
    "None. Every ticket this tool has is closed.",
  );
});

test("the markdown heads each tool and counts the closed rather than listing them", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "dropped" }),
    [at("pl-3")]: pl("pl-3"),
  });
  const rendered = renderMarkdown(readTickets(root));
  expect(rendered).toContain("## planner — 1 open of 3");
  expect(rendered).toContain("2 closed tickets not listed.");
  expect(rendered).not.toContain("pl-1-slug.md");
});

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

test("--tool narrows the view to one tool", () => {
  const { stdout, status } = run(["--tool", "downloader", "--ready"]);
  expect(status).toBe(0);
  expect(stdout.length).toBeGreaterThan(0);
  for (const line of stdout.trimEnd().split("\n")) {
    expect(line).toContain("\tdownloader\t");
  }
});

test("--tool with a name no tool has is a named failure, not an empty view", () => {
  const { stdout, status } = run(["--tool", "sniffer"]);
  expect(status).toBe(1);
  expect(stdout).toMatch(/no tickets for a tool called "sniffer"/);
});

test("--show prints a ticket's path and the dependencies still open", () => {
  const { stdout, status } = run(["--show", "pl-2"]);
  expect(status).toBe(0);
  expect(stdout).toContain("tools/planner/docs/work/pl-2-container-image.md");
  expect(stdout).toMatch(/unblocked|blocked by/);
});

test("--markdown emits a table, with no generated-region markers to guard", () => {
  const { stdout, status } = run(["--markdown", "--tool", "downloader"]);
  expect(status).toBe(0);
  expect(stdout).toContain("| Ticket ");
  expect(stdout).not.toContain("generated:tickets");
});

// `--write` and `--check` were real until repo-2 retired the file they wrote.
// Ignoring them would hand a reader with muscle memory the default view and let
// them believe a page had just been regenerated.
test("--write and --check are gone, and say so rather than being ignored", () => {
  for (const flag of ["--write", "--check"]) {
    const { stdout, status } = run([flag]);
    expect(status).toBe(1);
    expect(stdout).toContain(`unrecognised argument "${flag}"`);
  }
});
